'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Tavily Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('tavily')
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

  // ── Search ──

  describe('search', () => {
    it('returns search results with expected shape', async () => {
      const result = await service.search('what is quantum computing', 'Basic', 'General', 3)

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('response_time')
      expect(result).toHaveProperty('request_id')

      const firstResult = result.results[0]
      expect(firstResult).toHaveProperty('title')
      expect(firstResult).toHaveProperty('url')
      expect(firstResult).toHaveProperty('content')
      expect(firstResult).toHaveProperty('score')
    })

    it('returns answer when includeAnswer is set', async () => {
      const result = await service.search('what is the capital of France', 'Basic', 'General', 1, 'Basic')

      expect(result).toHaveProperty('answer')
      expect(typeof result.answer).toBe('string')
      expect(result.answer.length).toBeGreaterThan(0)
    })

    it('returns images when includeImages is enabled', async () => {
      const result = await service.search('sunset landscape', 'Basic', 'General', 3, undefined, undefined, true)

      expect(result).toHaveProperty('images')
      expect(Array.isArray(result.images)).toBe(true)
    })

    it('returns usage when includeUsage is enabled', async () => {
      const result = await service.search(
        'test query', 'Basic', undefined, 1,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, true,
      )

      expect(result).toHaveProperty('usage')
    })

    it('respects domain filters', async () => {
      const result = await service.search(
        'artificial intelligence', 'Basic', 'General', 5,
        undefined, undefined, undefined, undefined, undefined,
        ['wikipedia.org'],
      )

      expect(result.results.length).toBeGreaterThan(0)
      for (const r of result.results) {
        expect(r.url).toContain('wikipedia.org')
      }
    })
  })

  // ── Extract Content ──

  describe('extractContent', () => {
    it('extracts content from a URL', async () => {
      const result = await service.extractContent(['https://en.wikipedia.org/wiki/Artificial_intelligence'])

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('failed_results')
      expect(result).toHaveProperty('response_time')
      expect(result).toHaveProperty('request_id')

      const firstResult = result.results[0]
      expect(firstResult).toHaveProperty('url')
      expect(firstResult).toHaveProperty('raw_content')
      expect(typeof firstResult.raw_content).toBe('string')
      expect(firstResult.raw_content.length).toBeGreaterThan(0)
    }, 30000)

    it('returns failed_results for unreachable URLs', async () => {
      const result = await service.extractContent(['https://this-url-definitely-does-not-exist-12345.com/page'])

      expect(result).toHaveProperty('failed_results')
      expect(Array.isArray(result.failed_results)).toBe(true)
    }, 30000)
  })

  // ── Map Website ──

  describe('mapWebsite', () => {
    it('returns a list of URLs for a website', async () => {
      const result = await service.mapWebsite(
        'https://docs.tavily.com',
        undefined,  // instructions
        1,          // maxDepth
        5,          // maxBreadth
        10,         // limit
      )

      expect(result).toHaveProperty('base_url')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('response_time')
      expect(result).toHaveProperty('request_id')
    }, 60000)
  })

  // ── Get Usage ──

  describe('getUsage', () => {
    it('returns usage data with key and account info', async () => {
      const result = await service.getUsage()

      expect(result).toHaveProperty('key')
      expect(result.key).toHaveProperty('usage')
      expect(typeof result.key.usage).toBe('number')

      expect(result).toHaveProperty('account')
      expect(result.account).toHaveProperty('current_plan')
      expect(result.account).toHaveProperty('plan_usage')
      expect(result.account).toHaveProperty('plan_limit')
    })
  })
})
