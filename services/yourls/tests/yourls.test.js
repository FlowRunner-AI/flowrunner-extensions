'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SIGNATURE = 'test-signature-token'
const BASE_URL = 'https://sho.rt'
const ENDPOINT = `${BASE_URL}/yourls-api.php`

describe('YOURLS Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: `  ${BASE_URL}///  `, signature: SIGNATURE })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'signature', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Constructor ──

  describe('constructor', () => {
    it('trims trailing slashes and whitespace from url', () => {
      // The sandbox was created with '  https://sho.rt///  '
      expect(service.baseUrl).toBe('https://sho.rt')
    })

    it('stores the signature', () => {
      expect(service.signature).toBe(SIGNATURE)
    })
  })

  // ── shortenUrl ──

  describe('shortenUrl', () => {
    it('sends correct query params with all arguments', async () => {
      mock.onGet(ENDPOINT).reply({
        url: { keyword: 'abc', url: 'https://example.com', title: 'Example' },
        status: 'success',
        message: 'https://example.com added to database',
        shorturl: 'https://sho.rt/abc',
        statusCode: 200,
      })

      const result = await service.shortenUrl('https://example.com', 'abc', 'Example')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        action: 'shorturl',
        signature: SIGNATURE,
        format: 'json',
        url: 'https://example.com',
        keyword: 'abc',
        title: 'Example',
      })
      expect(result).toHaveProperty('shorturl', 'https://sho.rt/abc')
      expect(result).toHaveProperty('status', 'success')
    })

    it('omits optional keyword and title when not provided', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'success',
        shorturl: 'https://sho.rt/xyz',
        statusCode: 200,
      })

      await service.shortenUrl('https://example.com')

      expect(mock.history[0].query).toMatchObject({
        action: 'shorturl',
        url: 'https://example.com',
      })
      expect(mock.history[0].query).not.toHaveProperty('keyword')
      expect(mock.history[0].query).not.toHaveProperty('title')
    })

    it('returns existing short link on duplicate URL', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        code: 'error:url',
        shorturl: 'https://sho.rt/existing',
        message: 'https://example.com already exists in database',
        statusCode: 200,
      })

      const result = await service.shortenUrl('https://example.com')

      expect(result).toHaveProperty('shorturl', 'https://sho.rt/existing')
      expect(result).toHaveProperty('status', 'fail')
      expect(result).toHaveProperty('code', 'error:url')
    })

    it('throws on fail status without error:url code', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        code: 'error:keyword',
        message: 'Short URL abc already exists',
        statusCode: 200,
      })

      await expect(service.shortenUrl('https://example.com', 'abc'))
        .rejects.toThrow('Short URL abc already exists')
    })

    it('throws on HTTP error with body message', async () => {
      mock.onGet(ENDPOINT).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal server error' },
      })

      await expect(service.shortenUrl('https://example.com'))
        .rejects.toThrow('YOURLS API error: Internal server error')
    })

    it('throws on HTTP error using error.message when body is missing', async () => {
      mock.onGet(ENDPOINT).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.shortenUrl('https://example.com'))
        .rejects.toThrow('YOURLS API error: Network timeout')
    })
  })

  // ── expandUrl ──

  describe('expandUrl', () => {
    it('sends correct query params', async () => {
      mock.onGet(ENDPOINT).reply({
        keyword: 'abc',
        shorturl: 'https://sho.rt/abc',
        longurl: 'https://example.com/page',
        message: 'success',
        statusCode: 200,
      })

      const result = await service.expandUrl('abc')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        action: 'expand',
        signature: SIGNATURE,
        format: 'json',
        shorturl: 'abc',
      })
      expect(result).toHaveProperty('longurl', 'https://example.com/page')
      expect(result).toHaveProperty('keyword', 'abc')
    })

    it('accepts full short URL as shorturl param', async () => {
      mock.onGet(ENDPOINT).reply({
        keyword: 'abc',
        longurl: 'https://example.com',
        message: 'success',
        statusCode: 200,
      })

      await service.expandUrl('https://sho.rt/abc')

      expect(mock.history[0].query).toMatchObject({
        shorturl: 'https://sho.rt/abc',
      })
    })

    it('throws on fail status', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        message: 'Error: short URL not found',
      })

      await expect(service.expandUrl('nonexistent'))
        .rejects.toThrow('Error: short URL not found')
    })

    it('throws on HTTP error', async () => {
      mock.onGet(ENDPOINT).replyWithError({
        message: 'Connection refused',
      })

      await expect(service.expandUrl('abc'))
        .rejects.toThrow('YOURLS API error: Connection refused')
    })
  })

  // ── getUrlStats ──

  describe('getUrlStats', () => {
    it('sends correct query params and returns link data', async () => {
      mock.onGet(ENDPOINT).reply({
        statusCode: 200,
        message: 'success',
        link: {
          shorturl: 'https://sho.rt/abc',
          url: 'https://example.com',
          title: 'Example',
          timestamp: '2026-07-14 10:00:00',
          ip: '203.0.113.7',
          clicks: '42',
        },
      })

      const result = await service.getUrlStats('abc')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        action: 'url-stats',
        signature: SIGNATURE,
        format: 'json',
        shorturl: 'abc',
      })
      expect(result).toHaveProperty('link')
      expect(result.link).toHaveProperty('clicks', '42')
    })

    it('throws on fail status', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        message: 'Error: short URL not found',
      })

      await expect(service.getUrlStats('nonexistent'))
        .rejects.toThrow('Error: short URL not found')
    })

    it('throws on HTTP error with body message', async () => {
      mock.onGet(ENDPOINT).replyWithError({
        message: 'Bad Gateway',
        body: { message: 'Upstream error' },
      })

      await expect(service.getUrlStats('abc'))
        .rejects.toThrow('YOURLS API error: Upstream error')
    })
  })

  // ── getStats ──

  describe('getStats', () => {
    const statsReply = {
      stats: { total_links: '128', total_clicks: '4096' },
      links: {},
      statusCode: 200,
      message: 'success',
    }

    it('sends correct defaults (filter=top, limit=10)', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      const result = await service.getStats()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        action: 'stats',
        signature: SIGNATURE,
        format: 'json',
        filter: 'top',
        limit: 10,
      })
      expect(result).toHaveProperty('stats')
      expect(result.stats).toHaveProperty('total_links', '128')
    })

    it('maps filter choice "Bottom" to "bottom"', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('Bottom', 5)

      expect(mock.history[0].query).toMatchObject({ filter: 'bottom', limit: 5 })
    })

    it('maps filter choice "Random" to "rand"', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('Random')

      expect(mock.history[0].query).toMatchObject({ filter: 'rand' })
    })

    it('maps filter choice "Last" to "last"', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('Last')

      expect(mock.history[0].query).toMatchObject({ filter: 'last' })
    })

    it('maps filter choice "Top" to "top"', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('Top')

      expect(mock.history[0].query).toMatchObject({ filter: 'top' })
    })

    it('falls back to "top" when filter is null', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats(null, 3)

      expect(mock.history[0].query).toMatchObject({ filter: 'top', limit: 3 })
    })

    it('falls back to "top" when filter is undefined', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats(undefined, 20)

      expect(mock.history[0].query).toMatchObject({ filter: 'top', limit: 20 })
    })

    it('passes through unmapped filter value as-is', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('custom_filter')

      expect(mock.history[0].query).toMatchObject({ filter: 'custom_filter' })
    })

    it('uses limit=10 when limit is null', async () => {
      mock.onGet(ENDPOINT).reply(statsReply)

      await service.getStats('Top', null)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })

    it('throws on fail status', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        message: 'No stats available',
      })

      await expect(service.getStats())
        .rejects.toThrow('No stats available')
    })
  })

  // ── getDbStats ──

  describe('getDbStats', () => {
    it('sends correct query params and returns db stats', async () => {
      mock.onGet(ENDPOINT).reply({
        'db-stats': { total_links: '128', total_clicks: '4096' },
        statusCode: 200,
        message: 'success',
      })

      const result = await service.getDbStats()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        action: 'db-stats',
        signature: SIGNATURE,
        format: 'json',
      })
      expect(result).toHaveProperty('db-stats')
      expect(result['db-stats']).toHaveProperty('total_links', '128')
    })

    it('throws on fail status', async () => {
      mock.onGet(ENDPOINT).reply({
        status: 'fail',
        message: 'Database error',
      })

      await expect(service.getDbStats())
        .rejects.toThrow('Database error')
    })

    it('throws on HTTP error', async () => {
      mock.onGet(ENDPOINT).replyWithError({
        message: 'Service unavailable',
      })

      await expect(service.getDbStats())
        .rejects.toThrow('YOURLS API error: Service unavailable')
    })
  })
})
