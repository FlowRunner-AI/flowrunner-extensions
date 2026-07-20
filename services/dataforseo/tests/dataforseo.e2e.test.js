'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * E2E tests for DataForSEO.
 *
 * NOTE: DataForSEO bills per API call. The "live" SERP and Labs endpoints each
 * cost real money, so these tests keep depth/limit at their minimum and issue a
 * single call per method. Run against a funded DataForSEO account.
 *
 * Auth: Basic auth (login + password) supplied via e2e-config.json:
 *   {
 *     "dataforseo": {
 *       "configs": { "login": "...", "password": "..." },
 *       "testValues": { "keyword": "seo tools", "targetDomain": "example.com" }
 *     }
 *   }
 */
describe('DataForSEO Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('dataforseo')
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

  // Fallbacks so the suite runs even if the developer leaves testValues empty.
  const keyword = () => testValues.keyword || 'seo tools'
  const seedKeyword = () => testValues.seedKeyword || 'seo tools'
  const targetDomain = () => testValues.targetDomain || 'example.com'
  const locationCode = () => testValues.locationCode || 2840
  const languageCode = () => testValues.languageCode || 'en'

  // ── Dictionary Methods (cheapest — free metadata endpoints) ──

  describe('getLocationsDictionary', () => {
    it('returns location items with the expected shape', async () => {
      const result = await service.getLocationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters by a search term', async () => {
      const result = await service.getLocationsDictionary({ search: 'united' })

      expect(Array.isArray(result.items)).toBe(true)
      for (const item of result.items) {
        const haystack = `${ item.label } ${ item.note || '' }`.toLowerCase()
        expect(haystack).toContain('united')
      }
    })
  })

  describe('getLanguagesDictionary', () => {
    it('returns language items with the expected shape', async () => {
      const result = await service.getLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by a search term', async () => {
      const result = await service.getLanguagesDictionary({ search: 'english' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Keyword Research Actions (DataForSEO Labs) ──

  describe('labsKeywordOverview', () => {
    it('returns an array of keyword metrics', async () => {
      const result = await service.labsKeywordOverview(keyword(), locationCode(), languageCode())

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('keyword')
      }
    })
  })

  describe('labsBulkKeywordDifficulty', () => {
    it('returns an array of difficulty scores', async () => {
      const result = await service.labsBulkKeywordDifficulty(keyword(), locationCode(), languageCode())

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('keyword')
        expect(result[0]).toHaveProperty('keyword_difficulty')
      }
    })
  })

  describe('labsRelatedKeywords', () => {
    it('returns a related-keywords result with items', async () => {
      // depth 1, limit 10 keeps this call cheap.
      const result = await service.labsRelatedKeywords(seedKeyword(), locationCode(), languageCode(), 1, 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('labsKeywordSuggestions', () => {
    it('returns a suggestions result with items', async () => {
      const result = await service.labsKeywordSuggestions(seedKeyword(), locationCode(), languageCode(), 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('labsKeywordsForSite', () => {
    it('returns a keywords-for-site result with items', async () => {
      const result = await service.labsKeywordsForSite(targetDomain(), locationCode(), languageCode(), 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Keywords Data (Google Ads) ──

  describe('keywordsSearchVolume', () => {
    it('returns an array of search-volume rows', async () => {
      const result = await service.keywordsSearchVolume(keyword(), locationCode(), languageCode())

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('keyword')
      }
    })
  })

  // ── SERP Actions (most expensive — one small call each) ──

  describe('serpGoogleOrganic', () => {
    it('returns an organic SERP result at minimum depth', async () => {
      const result = await service.serpGoogleOrganic(keyword(), locationCode(), languageCode(), 10)

      expect(result).toHaveProperty('keyword')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('serpGoogleMaps', () => {
    it('returns a Google Maps SERP result', async () => {
      const result = await service.serpGoogleMaps(
        testValues.mapsKeyword || 'coffee shop',
        locationCode(),
        languageCode()
      )

      expect(result).toHaveProperty('keyword')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('serpBingOrganic', () => {
    it('returns a Bing organic SERP result at minimum depth', async () => {
      const result = await service.serpBingOrganic(keyword(), locationCode(), languageCode(), 10)

      expect(result).toHaveProperty('keyword')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
