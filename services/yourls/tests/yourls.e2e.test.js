'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('YOURLS Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('yourls')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── getDbStats ──

  describe('getDbStats', () => {
    it('returns global database statistics', async () => {
      const result = await service.getDbStats()

      expect(result).toHaveProperty('db-stats')
      expect(result['db-stats']).toHaveProperty('total_links')
      expect(result['db-stats']).toHaveProperty('total_clicks')
    })
  })

  // ── getStats ──

  describe('getStats', () => {
    it('returns stats with default filter and limit', async () => {
      const result = await service.getStats()

      expect(result).toHaveProperty('stats')
      expect(result.stats).toHaveProperty('total_links')
      expect(result.stats).toHaveProperty('total_clicks')
    })

    it('returns stats with custom filter and limit', async () => {
      const result = await service.getStats('Last', 3)

      expect(result).toHaveProperty('stats')
      expect(result).toHaveProperty('statusCode', 200)
    })
  })

  // ── shortenUrl + expandUrl + getUrlStats ──

  describe('shortenUrl + expandUrl + getUrlStats lifecycle', () => {
    const testUrl = 'https://example.com/yourls-e2e-test-' + Date.now()
    let shortUrl
    let keyword

    it('shortens a URL', async () => {
      const result = await service.shortenUrl(testUrl)

      expect(result).toHaveProperty('shorturl')
      expect(result).toHaveProperty('status', 'success')
      shortUrl = result.shorturl
      keyword = result.url && result.url.keyword
    })

    it('returns existing short link on duplicate shorten', async () => {
      const result = await service.shortenUrl(testUrl)

      expect(result).toHaveProperty('shorturl')
      // Should either succeed or return the existing duplicate
      expect(['success', 'fail']).toContain(result.status)
      if (result.status === 'fail') {
        expect(result).toHaveProperty('code', 'error:url')
      }
    })

    it('expands the shortened URL back to the original', async () => {
      if (!keyword) {
        console.log('Skipping expandUrl: keyword not available from shortenUrl result')
        return
      }

      const result = await service.expandUrl(keyword)

      expect(result).toHaveProperty('longurl', testUrl)
      expect(result).toHaveProperty('keyword', keyword)
    })

    it('retrieves click stats for the shortened URL', async () => {
      if (!keyword) {
        console.log('Skipping getUrlStats: keyword not available from shortenUrl result')
        return
      }

      const result = await service.getUrlStats(keyword)

      expect(result).toHaveProperty('link')
      expect(result.link).toHaveProperty('clicks')
      expect(result.link).toHaveProperty('url', testUrl)
    })
  })

  // ── shortenUrl with custom keyword ──

  describe('shortenUrl with custom keyword', () => {
    it('creates a short URL with a custom keyword', async () => {
      const { customKeyword } = testValues

      if (!customKeyword) {
        console.log('Skipping: testValues.customKeyword not set')
        return
      }

      const testUrl = 'https://example.com/yourls-custom-' + Date.now()
      const result = await service.shortenUrl(testUrl, customKeyword + '-' + Date.now(), 'E2E Custom Test')

      expect(result).toHaveProperty('shorturl')
    })
  })
})
