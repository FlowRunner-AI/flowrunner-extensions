'use strict'

const { createSandbox } = require('../../../service-sandbox')

const LOGIN = 'test-login'
const PASSWORD = 'test-password'
const BASE = 'https://api.dataforseo.com/v3'
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ LOGIN }:${ PASSWORD }`).toString('base64') }`

/**
 * Build a well-formed DataForSEO envelope.
 *
 * The service unwraps: top-level status_code -> tasks[0].status_code -> tasks[0].result.
 * Every action method returns the task's `result` (or a slice of it), so tests
 * shape the mock reply as a full envelope.
 */
function envelope(result, overrides = {}) {
  return {
    status_code: 20000,
    status_message: 'Ok.',
    tasks: [
      {
        status_code: 20000,
        status_message: 'Ok.',
        result,
        ...overrides.task,
      },
    ],
    ...overrides.top,
  }
}

describe('DataForSEO Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ login: LOGIN, password: PASSWORD })
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
          name: 'login',
          displayName: 'API Login',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'password',
          displayName: 'API Password',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Basic auth header and JSON content type on requests', async () => {
      mock.onPost(`${ BASE }/serp/google/organic/live/regular`).reply(envelope([{ keyword: 'x' }]))

      await service.serpGoogleOrganic('x')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('wraps the POST body in a task array', async () => {
      mock.onPost(`${ BASE }/serp/google/organic/live/regular`).reply(envelope([{ keyword: 'x' }]))

      await service.serpGoogleOrganic('x')

      expect(Array.isArray(mock.history[0].body)).toBe(true)
      expect(mock.history[0].body).toHaveLength(1)
    })
  })

  // ── SERP Actions ──

  describe('serpGoogleOrganic', () => {
    const url = `${ BASE }/serp/google/organic/live/regular`

    it('sends request with defaults and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ keyword: 'flowrunner', type: 'organic' }]))

      const result = await service.serpGoogleOrganic('flowrunner')

      expect(result).toEqual({ keyword: 'flowrunner', type: 'organic' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'flowrunner',
          location_code: 2840,
          language_code: 'en',
          depth: 10,
          device: 'desktop',
        },
      ])
    })

    it('passes all custom params and hits the advanced endpoint', async () => {
      const advUrl = `${ BASE }/serp/google/organic/live/advanced`
      mock.onPost(advUrl).reply(envelope([{ keyword: 'seo' }]))

      await service.serpGoogleOrganic('seo', 2826, 'fr', 20, 'mobile', 'advanced')

      expect(mock.history[0].url).toBe(advUrl)
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo',
          location_code: 2826,
          language_code: 'fr',
          depth: 20,
          device: 'mobile',
        },
      ])
    })

    it('returns an empty object when the task result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      const result = await service.serpGoogleOrganic('flowrunner')

      expect(result).toEqual({})
    })

    it('throws on an invalid resultFormat before making any request', async () => {
      await expect(service.serpGoogleOrganic('x', undefined, undefined, undefined, undefined, 'bogus'))
        .rejects.toThrow("Invalid resultFormat 'bogus'. Must be 'regular' or 'advanced'.")

      expect(mock.history).toHaveLength(0)
    })

    it('throws with the top-level status_message on API-level error', async () => {
      mock.onPost(url).reply({
        status_code: 40000,
        status_message: 'Invalid Field',
        tasks: [],
      })

      await expect(service.serpGoogleOrganic('x')).rejects.toThrow('Invalid Field')
    })

    it('throws with the task status_message on task-level error', async () => {
      mock.onPost(url).reply({
        status_code: 20000,
        status_message: 'Ok.',
        tasks: [{ status_code: 40501, status_message: 'Invalid keyword' }],
      })

      await expect(service.serpGoogleOrganic('x')).rejects.toThrow('Invalid keyword')
    })

    it('throws when no tasks are returned', async () => {
      mock.onPost(url).reply({ status_code: 20000, status_message: 'Ok.', tasks: [] })

      await expect(service.serpGoogleOrganic('x')).rejects.toThrow('No tasks returned in API response')
    })

    it('propagates a network/transport error', async () => {
      mock.onPost(url).replyWithError({ message: 'Network down' })

      await expect(service.serpGoogleOrganic('x')).rejects.toThrow('Network down')
    })
  })

  describe('serpGoogleMaps', () => {
    const url = `${ BASE }/serp/google/maps/live/advanced`

    it('sends request with defaults (depth 100) and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ keyword: 'pizza', type: 'maps' }]))

      const result = await service.serpGoogleMaps('pizza near me')

      expect(result).toEqual({ keyword: 'pizza', type: 'maps' })
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'pizza near me',
          location_code: 2840,
          language_code: 'en',
          depth: 100,
        },
      ])
    })

    it('passes custom params', async () => {
      mock.onPost(url).reply(envelope([{ keyword: 'cafe' }]))

      await service.serpGoogleMaps('cafe', 2826, 'de', 200)

      expect(mock.history[0].body).toEqual([
        {
          keyword: 'cafe',
          location_code: 2826,
          language_code: 'de',
          depth: 200,
        },
      ])
    })

    it('returns an empty object when result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.serpGoogleMaps('pizza')).toEqual({})
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.serpGoogleMaps('pizza')).rejects.toThrow('Boom')
    })
  })

  describe('serpBingOrganic', () => {
    const url = `${ BASE }/serp/bing/organic/live/regular`

    it('sends request with defaults and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ keyword: 'flowrunner', se_domain: 'bing.com' }]))

      const result = await service.serpBingOrganic('flowrunner')

      expect(result).toEqual({ keyword: 'flowrunner', se_domain: 'bing.com' })
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'flowrunner',
          location_code: 2840,
          language_code: 'en',
          depth: 10,
        },
      ])
    })

    it('passes custom params and hits the advanced endpoint', async () => {
      const advUrl = `${ BASE }/serp/bing/organic/live/advanced`
      mock.onPost(advUrl).reply(envelope([{ keyword: 'seo' }]))

      await service.serpBingOrganic('seo', 2826, 'es', 30, 'advanced')

      expect(mock.history[0].url).toBe(advUrl)
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo',
          location_code: 2826,
          language_code: 'es',
          depth: 30,
        },
      ])
    })

    it('throws on invalid resultFormat before making any request', async () => {
      await expect(service.serpBingOrganic('x', undefined, undefined, undefined, 'bogus'))
        .rejects.toThrow("Invalid resultFormat 'bogus'. Must be 'regular' or 'advanced'.")

      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty object when result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.serpBingOrganic('flowrunner')).toEqual({})
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.serpBingOrganic('flowrunner')).rejects.toThrow('Boom')
    })
  })

  // ── Keywords Data Actions ──

  describe('keywordsSearchVolume', () => {
    const url = `${ BASE }/keywords_data/google_ads/search_volume/live`

    it('parses keywords, dedupes/trims/lowercases, and returns the full result array', async () => {
      const result = [{ keyword: 'seo tools', search_volume: 12100 }]
      mock.onPost(url).reply(envelope(result))

      const returned = await service.keywordsSearchVolume(' SEO tools , seo tools ,  cheap SEO , ')

      expect(returned).toEqual(result)
      expect(mock.history[0].body).toEqual([
        {
          keywords: ['seo tools', 'cheap seo'],
          location_code: 2840,
          language_code: 'en',
        },
      ])
    })

    it('passes custom location and language', async () => {
      mock.onPost(url).reply(envelope([]))

      await service.keywordsSearchVolume('a, b', 2826, 'en-GB')

      expect(mock.history[0].body).toEqual([
        {
          keywords: ['a', 'b'],
          location_code: 2826,
          language_code: 'en-GB',
        },
      ])
    })

    it('throws when the keyword count exceeds the limit, without making a request', async () => {
      const many = Array.from({ length: 1001 }, (_, i) => `kw${ i }`).join(',')

      await expect(service.keywordsSearchVolume(many)).rejects.toThrow(
        /exceeds maximum \(1000\) for Get Keyword Search Volume/
      )
      expect(mock.history).toHaveLength(0)
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.keywordsSearchVolume('a')).rejects.toThrow('Boom')
    })
  })

  // ── Keyword Research Actions (DataForSEO Labs) ──

  describe('labsKeywordOverview', () => {
    const url = `${ BASE }/dataforseo_labs/google/keyword_overview/live`

    it('parses keywords and returns the nested items array', async () => {
      const items = [{ keyword: 'seo tools' }, { keyword: 'seo software' }]
      mock.onPost(url).reply(envelope([{ items }]))

      const result = await service.labsKeywordOverview('SEO tools, seo software')

      expect(result).toEqual(items)
      expect(mock.history[0].body).toEqual([
        {
          keywords: ['seo tools', 'seo software'],
          location_code: 2840,
          language_code: 'en',
        },
      ])
    })

    it('returns an empty array when the result has no items', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.labsKeywordOverview('x')).toEqual([])
    })

    it('enforces the 700-keyword maximum', async () => {
      const many = Array.from({ length: 701 }, (_, i) => `kw${ i }`).join(',')

      await expect(service.labsKeywordOverview(many)).rejects.toThrow(
        /exceeds maximum \(700\) for Get Keyword Overview/
      )
      expect(mock.history).toHaveLength(0)
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.labsKeywordOverview('x')).rejects.toThrow('Boom')
    })
  })

  describe('labsBulkKeywordDifficulty', () => {
    const url = `${ BASE }/dataforseo_labs/google/bulk_keyword_difficulty/live`

    it('parses keywords and returns the nested items array', async () => {
      const items = [{ keyword: 'seo tools', keyword_difficulty: 72 }]
      mock.onPost(url).reply(envelope([{ items }]))

      const result = await service.labsBulkKeywordDifficulty('SEO tools')

      expect(result).toEqual(items)
      expect(mock.history[0].body).toEqual([
        {
          keywords: ['seo tools'],
          location_code: 2840,
          language_code: 'en',
        },
      ])
    })

    it('returns an empty array when the result has no items', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.labsBulkKeywordDifficulty('x')).toEqual([])
    })

    it('enforces the 1000-keyword maximum', async () => {
      const many = Array.from({ length: 1001 }, (_, i) => `kw${ i }`).join(',')

      await expect(service.labsBulkKeywordDifficulty(many)).rejects.toThrow(
        /exceeds maximum \(1000\) for Get Bulk Keyword Difficulty/
      )
      expect(mock.history).toHaveLength(0)
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.labsBulkKeywordDifficulty('x')).rejects.toThrow('Boom')
    })
  })

  describe('labsRelatedKeywords', () => {
    const url = `${ BASE }/dataforseo_labs/google/related_keywords/live`

    it('sends request with defaults and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ seed_keyword: 'seo tools', items_count: 15 }]))

      const result = await service.labsRelatedKeywords('seo tools')

      expect(result).toEqual({ seed_keyword: 'seo tools', items_count: 15 })
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo tools',
          location_code: 2840,
          language_code: 'en',
          depth: 1,
          limit: 100,
        },
      ])
    })

    it('passes custom params including depth 0', async () => {
      mock.onPost(url).reply(envelope([{ seed_keyword: 'seo' }]))

      await service.labsRelatedKeywords('seo', 2826, 'fr', 0, 500)

      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo',
          location_code: 2826,
          language_code: 'fr',
          depth: 0,
          limit: 500,
        },
      ])
    })

    it('throws when depth is out of range (too high)', async () => {
      await expect(service.labsRelatedKeywords('seo', undefined, undefined, 5))
        .rejects.toThrow('Invalid depth (5). Must be between 0 and 4.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when depth is negative', async () => {
      await expect(service.labsRelatedKeywords('seo', undefined, undefined, -1))
        .rejects.toThrow('Invalid depth (-1). Must be between 0 and 4.')
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty object when result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.labsRelatedKeywords('seo')).toEqual({})
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.labsRelatedKeywords('seo')).rejects.toThrow('Boom')
    })
  })

  describe('labsKeywordSuggestions', () => {
    const url = `${ BASE }/dataforseo_labs/google/keyword_suggestions/live`

    it('sends request with defaults and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ seed_keyword: 'seo tools', items_count: 10 }]))

      const result = await service.labsKeywordSuggestions('seo tools')

      expect(result).toEqual({ seed_keyword: 'seo tools', items_count: 10 })
      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo tools',
          location_code: 2840,
          language_code: 'en',
          limit: 100,
        },
      ])
    })

    it('passes custom params', async () => {
      mock.onPost(url).reply(envelope([{ seed_keyword: 'seo' }]))

      await service.labsKeywordSuggestions('seo', 2826, 'es', 250)

      expect(mock.history[0].body).toEqual([
        {
          keyword: 'seo',
          location_code: 2826,
          language_code: 'es',
          limit: 250,
        },
      ])
    })

    it('returns an empty object when result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.labsKeywordSuggestions('seo')).toEqual({})
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.labsKeywordSuggestions('seo')).rejects.toThrow('Boom')
    })
  })

  describe('labsKeywordsForSite', () => {
    const url = `${ BASE }/dataforseo_labs/google/keywords_for_site/live`

    it('normalizes the target, sends defaults, and returns the first result', async () => {
      mock.onPost(url).reply(envelope([{ target: 'example.com', items_count: 10 }]))

      const result = await service.labsKeywordsForSite('https://www.Example.com/blog/')

      expect(result).toEqual({ target: 'example.com', items_count: 10 })
      expect(mock.history[0].body).toEqual([
        {
          target: 'example.com',
          location_code: 2840,
          language_code: 'en',
          limit: 100,
          include_subdomains: true,
        },
      ])
    })

    it('passes custom params including include_subdomains false', async () => {
      mock.onPost(url).reply(envelope([{ target: 'shop.example.com' }]))

      await service.labsKeywordsForSite('shop.example.com', 2826, 'de', 500, false)

      expect(mock.history[0].body).toEqual([
        {
          target: 'shop.example.com',
          location_code: 2826,
          language_code: 'de',
          limit: 500,
          include_subdomains: false,
        },
      ])
    })

    it('returns an empty object when result is empty', async () => {
      mock.onPost(url).reply(envelope([]))

      expect(await service.labsKeywordsForSite('example.com')).toEqual({})
    })

    it('propagates errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(service.labsKeywordsForSite('example.com')).rejects.toThrow('Boom')
    })
  })

  // ── Dictionary Methods ──

  describe('getLocationsDictionary', () => {
    const url = `${ BASE }/serp/google/locations`

    // The service caches locations on the instance for 24h; clear it so each
    // test exercises a fresh fetch rather than a warm cache from a prior test.
    beforeEach(() => {
      service._locationsCache = null
    })

    const locationsResponse = {
      tasks: [
        {
          result: [
            { location_name: 'United States', location_code: 2840, country_iso_code: 'US' },
            { location_name: 'United Kingdom', location_code: 2826, country_iso_code: 'GB' },
            { location_name: 'Germany', location_code: 2276, country_iso_code: 'DE' },
          ],
        },
      ],
    }

    it('sends a GET with the Basic auth header and maps locations to items', async () => {
      mock.onGet(url).reply(locationsResponse)

      const result = await service.getLocationsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': EXPECTED_AUTH })
      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'United States', value: 2840, note: 'US' },
        { label: 'United Kingdom', value: 2826, note: 'GB' },
        { label: 'Germany', value: 2276, note: 'DE' },
      ])
    })

    it('caches results and does not re-fetch on the second call', async () => {
      mock.onGet(url).reply(locationsResponse)

      await service.getLocationsDictionary({})
      expect(mock.history).toHaveLength(1)

      await service.getLocationsDictionary({})
      // Still one request — the second call is served from cache.
      expect(mock.history).toHaveLength(1)
    })

    it('filters cached items by search over label and country note', async () => {
      mock.onGet(url).reply(locationsResponse)

      const byLabel = await service.getLocationsDictionary({ search: 'united' })
      expect(byLabel.items.map(i => i.value)).toEqual([2840, 2826])

      const byNote = await service.getLocationsDictionary({ search: 'de' })
      expect(byNote.items.map(i => i.value)).toEqual([2276])
    })

    it('handles a null payload', async () => {
      mock.onGet(url).reply(locationsResponse)

      const result = await service.getLocationsDictionary(null)

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.cursor).toBeNull()
    })

    it('caps returned items at 50', async () => {
      const many = Array.from({ length: 75 }, (_, i) => ({
        location_name: `Loc ${ i }`,
        location_code: i,
        country_iso_code: 'XX',
      }))
      mock.onGet(url).reply({ tasks: [{ result: many }] })

      const result = await service.getLocationsDictionary({})

      expect(result.items).toHaveLength(50)
    })
  })

  describe('getLanguagesDictionary', () => {
    const url = `${ BASE }/serp/google/languages`

    const languagesResponse = {
      tasks: [
        {
          result: [
            { language_name: 'English', language_code: 'en' },
            { language_name: 'Spanish', language_code: 'es' },
            { language_name: 'French', language_code: 'fr' },
          ],
        },
      ],
    }

    it('sends a GET with Basic auth and maps languages to items', async () => {
      mock.onGet(url).reply(languagesResponse)

      const result = await service.getLanguagesDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': EXPECTED_AUTH })
      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'English', value: 'en' },
        { label: 'Spanish', value: 'es' },
        { label: 'French', value: 'fr' },
      ])
    })

    it('re-fetches on every call (no caching)', async () => {
      mock.onGet(url).reply(languagesResponse)

      await service.getLanguagesDictionary({})
      await service.getLanguagesDictionary({})

      expect(mock.history).toHaveLength(2)
    })

    it('filters by search over label and language code', async () => {
      mock.onGet(url).reply(languagesResponse)

      const byLabel = await service.getLanguagesDictionary({ search: 'span' })
      expect(byLabel.items).toEqual([{ label: 'Spanish', value: 'es' }])

      mock.reset()
      mock.onGet(url).reply(languagesResponse)

      const byCode = await service.getLanguagesDictionary({ search: 'fr' })
      expect(byCode.items).toEqual([{ label: 'French', value: 'fr' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(url).reply(languagesResponse)

      const result = await service.getLanguagesDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('returns an empty list when the API returns no tasks', async () => {
      mock.onGet(url).reply({ tasks: [] })

      const result = await service.getLanguagesDictionary({})

      expect(result.items).toEqual([])
    })
  })
})
