'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'tvly-test-api-key-12345'
const BASE = 'https://api.tavily.com'

describe('Tavily Service', () => {
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
            required: true,
            shared: false,
            type: 'STRING',
          }),
        ])
      )
    })
  })

  // ── Search ──

  describe('search', () => {
    const searchResponse = {
      query: 'quantum computing',
      answer: null,
      images: [],
      results: [{ title: 'Test', url: 'https://example.com', content: 'snippet', score: 0.95 }],
      response_time: 1.2,
      request_id: 'abc-123',
    }

    it('sends POST with query only (defaults)', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      const result = await service.search('quantum computing')

      expect(result).toEqual(searchResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({ query: 'quantum computing' })
    })

    it('resolves CHOICE values for searchDepth, topic, timeRange, includeAnswer, includeRawContent', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search(
        'test query',    // query
        'Advanced',      // searchDepth
        'News',          // topic
        10,              // maxResults
        'Advanced',      // includeAnswer
        'Markdown',      // includeRawContent
        true,            // includeImages
        true,            // includeImageDescriptions
        true,            // includeFavicon
      )

      expect(mock.history[0].body).toMatchObject({
        query: 'test query',
        search_depth: 'advanced',
        topic: 'news',
        max_results: 10,
        include_answer: 'advanced',
        include_raw_content: 'markdown',
        include_images: true,
        include_image_descriptions: true,
        include_favicon: true,
      })
    })

    it('passes domain filters and date parameters', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search(
        'test',           // query
        undefined,        // searchDepth
        undefined,        // topic
        undefined,        // maxResults
        undefined,        // includeAnswer
        undefined,        // includeRawContent
        undefined,        // includeImages
        undefined,        // includeImageDescriptions
        undefined,        // includeFavicon
        ['nature.com'],   // includeDomains
        ['pinterest.com'],// excludeDomains
        'Week',           // timeRange
        '2025-01-01',     // startDate
        '2025-06-30',     // endDate
        'Germany',        // country
        2,                // chunksPerSource
        true,             // autoParameters
        true,             // exactMatch
        true,             // includeUsage
      )

      expect(mock.history[0].body).toMatchObject({
        query: 'test',
        include_domains: ['nature.com'],
        exclude_domains: ['pinterest.com'],
        time_range: 'week',
        start_date: '2025-01-01',
        end_date: '2025-06-30',
        country: 'germany',
        chunks_per_source: 2,
        auto_parameters: true,
        exact_match: true,
        include_usage: true,
      })
    })

    it('omits undefined/null/empty values via clean()', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search('test', undefined, null, undefined, '')

      const body = mock.history[0].body
      expect(body).toEqual({ query: 'test' })
      expect(body).not.toHaveProperty('search_depth')
      expect(body).not.toHaveProperty('topic')
      expect(body).not.toHaveProperty('max_results')
      expect(body).not.toHaveProperty('include_answer')
    })

    it('omits empty arrays via clean()', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search(
        'test', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, [], [],
      )

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('include_domains')
      expect(body).not.toHaveProperty('exclude_domains')
    })

    it('resolves all search depth values', async () => {
      const depths = { 'Basic': 'basic', 'Advanced': 'advanced', 'Fast': 'fast', 'Ultra Fast': 'ultra-fast' }

      for (const [label, expected] of Object.entries(depths)) {
        mock.onPost(`${BASE}/search`).reply(searchResponse)
        await service.search('q', label)
        expect(mock.history[mock.history.length - 1].body.search_depth).toBe(expected)
      }
    })

    it('resolves all topic values', async () => {
      const topics = { 'General': 'general', 'News': 'news', 'Finance': 'finance' }

      for (const [label, expected] of Object.entries(topics)) {
        mock.onPost(`${BASE}/search`).reply(searchResponse)
        await service.search('q', undefined, label)
        expect(mock.history[mock.history.length - 1].body.topic).toBe(expected)
      }
    })

    it('resolves all time range values', async () => {
      const ranges = { 'Day': 'day', 'Week': 'week', 'Month': 'month', 'Year': 'year' }

      for (const [label, expected] of Object.entries(ranges)) {
        mock.onPost(`${BASE}/search`).reply(searchResponse)
        await service.search('q', undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, label)
        expect(mock.history[mock.history.length - 1].body.time_range).toBe(expected)
      }
    })

    it('formats date from timestamp', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      // Pass a numeric timestamp for startDate
      const timestamp = new Date('2025-03-15').getTime()
      await service.search('q', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, timestamp)

      expect(mock.history[0].body.start_date).toBe('2025-03-15')
    })

    it('formats date from ISO string', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search('q', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, '2025-03-15T10:00:00Z')

      expect(mock.history[0].body.start_date).toBe('2025-03-15')
    })

    it('passes through already formatted YYYY-MM-DD date', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search('q', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, '2025-03-15')

      expect(mock.history[0].body.start_date).toBe('2025-03-15')
    })

    it('lowercases country', async () => {
      mock.onPost(`${BASE}/search`).reply(searchResponse)

      await service.search('q', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'United States')

      expect(mock.history[0].body.country).toBe('united states')
    })

    it('throws on API error with detail.error', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Bad Request',
        body: { detail: { error: 'Invalid query' } },
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error: Invalid query')
    })

    it('throws on API error with detail string', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid API key' },
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error: Invalid API key')
    })

    it('throws on API error with body.error', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Server Error',
        body: { error: 'Internal server error' },
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error: Internal server error')
    })

    it('throws on API error with body.message', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Bad Gateway',
        body: { message: 'Service unavailable' },
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error: Service unavailable')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error: Network timeout')
    })

    it('stringifies non-string error messages', async () => {
      mock.onPost(`${BASE}/search`).replyWithError({
        message: 'Error',
        body: { detail: { error: { code: 400, info: 'bad' } } },
      })

      await expect(service.search('test')).rejects.toThrow('Tavily API error:')
    })
  })

  // ── Extract Content ──

  describe('extractContent', () => {
    const extractResponse = {
      results: [{ url: 'https://example.com', raw_content: '# Hello', images: [] }],
      failed_results: [],
      response_time: 0.87,
      request_id: 'ext-123',
    }

    it('sends POST with urls only (defaults)', async () => {
      mock.onPost(`${BASE}/extract`).reply(extractResponse)

      const result = await service.extractContent(['https://example.com'])

      expect(result).toEqual(extractResponse)
      expect(mock.history[0].body).toEqual({ urls: ['https://example.com'] })
    })

    it('passes all optional parameters', async () => {
      mock.onPost(`${BASE}/extract`).reply(extractResponse)

      await service.extractContent(
        ['https://example.com'],  // urls
        'Advanced',               // extractDepth
        'Text',                   // format
        'pricing info',           // query
        2,                        // chunksPerSource
        true,                     // includeImages
        true,                     // includeFavicon
        30,                       // timeout
        true,                     // includeUsage
      )

      expect(mock.history[0].body).toMatchObject({
        urls: ['https://example.com'],
        extract_depth: 'advanced',
        format: 'text',
        query: 'pricing info',
        chunks_per_source: 2,
        include_images: true,
        include_favicon: true,
        timeout: 30,
        include_usage: true,
      })
    })

    it('resolves extract depth choices', async () => {
      mock.onPost(`${BASE}/extract`).reply(extractResponse)

      await service.extractContent(['https://example.com'], 'Basic')
      expect(mock.history[0].body.extract_depth).toBe('basic')
    })

    it('resolves format choices', async () => {
      mock.onPost(`${BASE}/extract`).reply(extractResponse)

      await service.extractContent(['https://example.com'], undefined, 'Markdown')
      expect(mock.history[0].body.format).toBe('markdown')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/extract`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'URL not accessible' },
      })

      await expect(service.extractContent(['https://bad.url'])).rejects.toThrow('Tavily API error:')
    })
  })

  // ── Crawl Website ──

  describe('crawlWebsite', () => {
    const crawlResponse = {
      base_url: 'docs.example.com',
      results: [{ url: 'https://docs.example.com/page1', raw_content: '# Page 1' }],
      response_time: 4.5,
      request_id: 'crawl-123',
    }

    it('sends POST with url only (defaults)', async () => {
      mock.onPost(`${BASE}/crawl`).reply(crawlResponse)

      const result = await service.crawlWebsite('https://docs.example.com')

      expect(result).toEqual(crawlResponse)
      expect(mock.history[0].body).toEqual({ url: 'https://docs.example.com' })
    })

    it('passes all optional parameters', async () => {
      mock.onPost(`${BASE}/crawl`).reply(crawlResponse)

      await service.crawlWebsite(
        'https://docs.example.com',  // url
        'Find SDK pages',            // instructions
        3,                           // maxDepth
        50,                          // maxBreadth
        100,                         // limit
        ['/docs/.*'],                // selectPaths
        ['^docs\\.example\\.com$'],  // selectDomains
        ['/private/.*'],             // excludePaths
        ['^legacy\\..*$'],           // excludeDomains
        false,                       // allowExternal
        'Advanced',                  // extractDepth
        'Text',                      // format
        2,                           // chunksPerSource
        true,                        // includeImages
        true,                        // includeFavicon
        60,                          // timeout
        true,                        // includeUsage
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://docs.example.com',
        instructions: 'Find SDK pages',
        max_depth: 3,
        max_breadth: 50,
        limit: 100,
        select_paths: ['/docs/.*'],
        select_domains: ['^docs\\.example\\.com$'],
        exclude_paths: ['/private/.*'],
        exclude_domains: ['^legacy\\..*$'],
        allow_external: false,
        extract_depth: 'advanced',
        format: 'text',
        chunks_per_source: 2,
        include_images: true,
        include_favicon: true,
        timeout: 60,
        include_usage: true,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/crawl`).replyWithError({
        message: 'Timeout',
        body: { detail: 'Crawl timed out' },
      })

      await expect(service.crawlWebsite('https://example.com')).rejects.toThrow('Tavily API error:')
    })
  })

  // ── Map Website ──

  describe('mapWebsite', () => {
    const mapResponse = {
      base_url: 'docs.example.com',
      results: ['https://docs.example.com/page1', 'https://docs.example.com/page2'],
      response_time: 2.1,
      request_id: 'map-123',
    }

    it('sends POST with url only (defaults)', async () => {
      mock.onPost(`${BASE}/map`).reply(mapResponse)

      const result = await service.mapWebsite('https://docs.example.com')

      expect(result).toEqual(mapResponse)
      expect(mock.history[0].body).toEqual({ url: 'https://docs.example.com' })
    })

    it('passes all optional parameters', async () => {
      mock.onPost(`${BASE}/map`).reply(mapResponse)

      await service.mapWebsite(
        'https://docs.example.com',  // url
        'Find pricing pages',        // instructions
        2,                           // maxDepth
        30,                          // maxBreadth
        50,                          // limit
        ['/docs/.*'],                // selectPaths
        ['^docs\\.example\\.com$'],  // selectDomains
        ['/admin/.*'],               // excludePaths
        ['^private\\..*$'],          // excludeDomains
        false,                       // allowExternal
        120,                         // timeout
        true,                        // includeUsage
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://docs.example.com',
        instructions: 'Find pricing pages',
        max_depth: 2,
        max_breadth: 30,
        limit: 50,
        select_paths: ['/docs/.*'],
        select_domains: ['^docs\\.example\\.com$'],
        exclude_paths: ['/admin/.*'],
        exclude_domains: ['^private\\..*$'],
        allow_external: false,
        timeout: 120,
        include_usage: true,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/map`).replyWithError({
        message: 'Error',
        body: { error: 'URL not reachable' },
      })

      await expect(service.mapWebsite('https://bad.example.com')).rejects.toThrow('Tavily API error:')
    })
  })

  // ── Start Research ──

  describe('startResearch', () => {
    const researchResponse = {
      request_id: 'res-123',
      created_at: '2026-07-17T12:00:00Z',
      status: 'pending',
      input: 'Compare vector databases',
      model: 'auto',
    }

    it('sends POST with input only (defaults)', async () => {
      mock.onPost(`${BASE}/research`).reply(researchResponse)

      const result = await service.startResearch('Compare vector databases')

      expect(result).toEqual(researchResponse)
      expect(mock.history[0].body).toEqual({
        input: 'Compare vector databases',
        stream: false,
      })
    })

    it('passes all optional parameters with choice resolution', async () => {
      mock.onPost(`${BASE}/research`).reply(researchResponse)

      await service.startResearch(
        'Compare vector databases',  // input
        'Pro',                       // model
        'Long',                      // outputLength
        'APA',                       // citationFormat
        ['arxiv.org'],               // includeDomains
        ['reddit.com'],              // excludeDomains
        { type: 'object', properties: { summary: { type: 'string' } } },  // outputSchema
      )

      expect(mock.history[0].body).toMatchObject({
        input: 'Compare vector databases',
        model: 'pro',
        output_length: 'long',
        citation_format: 'apa',
        include_domains: ['arxiv.org'],
        exclude_domains: ['reddit.com'],
        output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
        stream: false,
      })
    })

    it('resolves all model values', async () => {
      const models = { 'Auto': 'auto', 'Mini': 'mini', 'Pro': 'pro' }

      for (const [label, expected] of Object.entries(models)) {
        mock.onPost(`${BASE}/research`).reply(researchResponse)
        await service.startResearch('q', label)
        expect(mock.history[mock.history.length - 1].body.model).toBe(expected)
      }
    })

    it('resolves all citation format values', async () => {
      const formats = { 'Numbered': 'numbered', 'MLA': 'mla', 'APA': 'apa', 'Chicago': 'chicago' }

      for (const [label, expected] of Object.entries(formats)) {
        mock.onPost(`${BASE}/research`).reply(researchResponse)
        await service.startResearch('q', undefined, undefined, label)
        expect(mock.history[mock.history.length - 1].body.citation_format).toBe(expected)
      }
    })

    it('resolves all output length values', async () => {
      const lengths = { 'Short': 'short', 'Standard': 'standard', 'Long': 'long' }

      for (const [label, expected] of Object.entries(lengths)) {
        mock.onPost(`${BASE}/research`).reply(researchResponse)
        await service.startResearch('q', undefined, label)
        expect(mock.history[mock.history.length - 1].body.output_length).toBe(expected)
      }
    })

    it('always includes stream: false', async () => {
      mock.onPost(`${BASE}/research`).reply(researchResponse)
      await service.startResearch('q')
      expect(mock.history[0].body.stream).toBe(false)
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/research`).replyWithError({
        message: 'Error',
        body: { detail: 'Insufficient credits' },
      })

      await expect(service.startResearch('q')).rejects.toThrow('Tavily API error: Insufficient credits')
    })
  })

  // ── Get Research Results ──

  describe('getResearchResults', () => {
    const resultsResponse = {
      request_id: 'res-123',
      created_at: '2026-07-17T12:00:00Z',
      status: 'completed',
      content: '## Report\n\nFindings...',
      sources: [{ title: 'Source 1', url: 'https://example.com' }],
      response_time: 184,
    }

    it('sends GET with encoded request ID', async () => {
      mock.onGet(`${BASE}/research/res-123`).reply(resultsResponse)

      const result = await service.getResearchResults('res-123')

      expect(result).toEqual(resultsResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
      })
    })

    it('encodes special characters in request ID', async () => {
      mock.onGet(`${BASE}/research/id%20with%20spaces`).reply(resultsResponse)

      await service.getResearchResults('id with spaces')

      expect(mock.history[0].url).toBe(`${BASE}/research/id%20with%20spaces`)
    })

    it('does not send a body for GET requests', async () => {
      mock.onGet(`${BASE}/research/res-123`).reply(resultsResponse)

      await service.getResearchResults('res-123')

      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/research/bad-id`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Research task not found' },
      })

      await expect(service.getResearchResults('bad-id')).rejects.toThrow('Tavily API error: Research task not found')
    })
  })

  // ── Get Usage ──

  describe('getUsage', () => {
    const usageResponse = {
      key: { usage: 1250, limit: null, search_usage: 900, extract_usage: 200 },
      account: { current_plan: 'Bootstrap', plan_usage: 1250, plan_limit: 15000 },
    }

    it('sends GET with no body', async () => {
      mock.onGet(`${BASE}/usage`).reply(usageResponse)

      const result = await service.getUsage()

      expect(result).toEqual(usageResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/usage`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
      })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/usage`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid API key' },
      })

      await expect(service.getUsage()).rejects.toThrow('Tavily API error: Invalid API key')
    })
  })
})
