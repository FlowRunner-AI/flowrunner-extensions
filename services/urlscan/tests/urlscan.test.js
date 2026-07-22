'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-urlscan-key'
const API_BASE = 'https://urlscan.io/api/v1'
const SITE_BASE = 'https://urlscan.io'
const UUID = '0e37e828-a9d9-45c0-ac50-1ca579b86c72'

describe('urlscan.io Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock the flowrunner.Files API that the runtime normally provides
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.example.com/shot.png' })
    service.flowrunner = { Files: { uploadFile: uploadFileMock } }
  })

  afterEach(() => {
    mock.reset()
    uploadFileMock.mockClear()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers the apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Scanning ──

  describe('submitScan', () => {
    it('posts the url with the API-Key header', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID, message: 'Submission successful' })

      const result = await service.submitScan('https://example.com')

      expect(result).toEqual({ uuid: UUID, message: 'Submission successful' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].headers).toMatchObject({
        'API-Key': API_KEY,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('maps the friendly visibility label and sends all options', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })

      await service.submitScan(
        'https://example.com',
        'Unlisted',
        ['phishing', 'test'],
        'Mozilla/5.0',
        'https://ref.example',
        'de'
      )

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com',
        visibility: 'unlisted',
        tags: ['phishing', 'test'],
        customagent: 'Mozilla/5.0',
        referer: 'https://ref.example',
        country: 'de',
      })
    })

    it('passes an unmapped visibility value through unchanged', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })

      await service.submitScan('https://example.com', 'private')

      expect(mock.history[0].body.visibility).toBe('private')
    })

    it('omits empty tag arrays', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })

      await service.submitScan('https://example.com', undefined, [])

      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('throws a wrapped error including message and description', async () => {
      mock.onPost(`${ API_BASE }/scan/`).replyWithError({
        message: 'Request failed',
        status: 400,
        body: { message: 'DNS Error', description: 'Domain did not resolve' },
      })

      await expect(service.submitScan('https://bad.example')).rejects.toThrow(
        'urlscan.io API error: DNS Error - Domain did not resolve'
      )
    })

    it('adds rate-limit guidance on HTTP 429', async () => {
      mock.onPost(`${ API_BASE }/scan/`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { message: 'Rate limited' },
      })

      await expect(service.submitScan('https://example.com')).rejects.toThrow(/Rate limit exceeded \(HTTP 429\)/)
    })

    it('falls back to error.message when no body details exist', async () => {
      mock.onPost(`${ API_BASE }/scan/`).replyWithError({ message: 'Network down' })

      await expect(service.submitScan('https://example.com')).rejects.toThrow('urlscan.io API error: Network down')
    })

    it('exposes the HTTP status on the thrown error', async () => {
      mock.onPost(`${ API_BASE }/scan/`).replyWithError({ message: 'Nope', statusCode: 401 })

      await expect(service.submitScan('https://example.com')).rejects.toMatchObject({ status: 401 })
    })
  })

  describe('getScanResult', () => {
    it('gets the result by uuid', async () => {
      mock.onGet(`${ API_BASE }/result/${ UUID }/`).reply({ task: { uuid: UUID }, page: { domain: 'example.com' } })

      const result = await service.getScanResult(UUID)

      expect(result.page.domain).toBe('example.com')
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ API_BASE }/result/${ UUID }/`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('url-encodes the uuid', async () => {
      mock.onGet(`${ API_BASE }/result/a%2Fb/`).reply({ task: {} })

      await service.getScanResult('a/b')

      expect(mock.history[0].url).toBe(`${ API_BASE }/result/a%2Fb/`)
    })

    it('throws when the scan is not ready', async () => {
      mock.onGet(`${ API_BASE }/result/${ UUID }/`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Scan is not finished yet' },
      })

      await expect(service.getScanResult(UUID)).rejects.toThrow('urlscan.io API error: Scan is not finished yet')
    })
  })

  describe('scanAndWait', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('returns the finished result once available', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })
      mock.onGet(`${ API_BASE }/result/${ UUID }/`).reply({ task: { uuid: UUID }, verdicts: { overall: { malicious: false } } })

      const promise = service.scanAndWait('https://example.com', 'Public')

      await jest.advanceTimersByTimeAsync(10000)

      const result = await promise

      expect(result.ready).toBe(true)
      expect(result.uuid).toBe(UUID)
      expect(result.result.task.uuid).toBe(UUID)
      expect(mock.history[0].body).toMatchObject({ visibility: 'public' })
    })

    it('retries while the result returns 404 and then succeeds', async () => {
      let attempts = 0

      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })

      mock.onGet(`${ API_BASE }/result/${ UUID }/`).replyWith(() => {
        attempts += 1

        if (attempts < 3) {
          throw Object.assign(new Error('Not Found'), { status: 404 })
        }

        return { task: { uuid: UUID } }
      })

      const promise = service.scanAndWait('https://example.com')

      await jest.advanceTimersByTimeAsync(30000)

      const result = await promise

      expect(result.ready).toBe(true)
      expect(attempts).toBe(3)
    })

    it('gives up and returns the submission when the timeout is reached', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID, message: 'Submission successful' })
      mock.onGet(`${ API_BASE }/result/${ UUID }/`).replyWithError({ message: 'Not Found', status: 404 })

      const promise = service.scanAndWait('https://example.com')

      await jest.advanceTimersByTimeAsync(60000)

      const result = await promise

      expect(result).toEqual({
        ready: false,
        uuid: UUID,
        submission: { uuid: UUID, message: 'Submission successful' },
      })
    })

    it('rethrows non-404 errors from the result poll', async () => {
      mock.onPost(`${ API_BASE }/scan/`).reply({ uuid: UUID })
      mock.onGet(`${ API_BASE }/result/${ UUID }/`).replyWithError({ message: 'Gone', status: 410 })

      const promise = service.scanAndWait('https://example.com')
      const assertion = expect(promise).rejects.toThrow('urlscan.io API error: Gone')

      await jest.advanceTimersByTimeAsync(15000)

      await assertion
    })
  })

  // ── Search ──

  describe('searchScans', () => {
    it('sends the query with the default size', async () => {
      mock.onGet(`${ API_BASE }/search/`).reply({ results: [], total: 0 })

      const result = await service.searchScans('domain:example.com')

      expect(result).toEqual({ results: [], total: 0 })
      expect(mock.history[0].query).toEqual({ q: 'domain:example.com', size: 100 })
    })

    it('sends a custom size and pagination cursor', async () => {
      mock.onGet(`${ API_BASE }/search/`).reply({ results: [], total: 0 })

      await service.searchScans('ip:1.2.3.4', 25, '1720958400000,0e37e828')

      expect(mock.history[0].query).toEqual({
        q: 'ip:1.2.3.4',
        size: 25,
        search_after: '1720958400000,0e37e828',
      })
    })

    it('throws on API failure', async () => {
      mock.onGet(`${ API_BASE }/search/`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'Invalid query' },
      })

      await expect(service.searchScans('???')).rejects.toThrow('urlscan.io API error: Invalid query')
    })
  })

  // ── Artifacts ──

  describe('getScreenshot', () => {
    it('downloads the png as binary and uploads it to file storage', async () => {
      mock.onGet(`${ SITE_BASE }/screenshots/${ UUID }.png`).reply(Buffer.from('png-bytes'))

      const result = await service.getScreenshot(UUID)

      expect(mock.history[0].headers).toMatchObject({ 'API-Key': API_KEY })
      expect(mock.history[0].encoding).toBeNull()
      expect(uploadFileMock).toHaveBeenCalledTimes(1)

      const [buffer, options] = uploadFileMock.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('png-bytes')

      expect(options).toMatchObject({
        filename: `urlscan_${ UUID }.png`,
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        uuid: UUID,
        url: 'https://files.example.com/shot.png',
        filename: `urlscan_${ UUID }.png`,
      })
    })

    it('forwards custom file options', async () => {
      mock.onGet(`${ SITE_BASE }/screenshots/${ UUID }.png`).reply(Buffer.from('png'))

      await service.getScreenshot(UUID, { scope: 'WORKSPACE' })

      expect(uploadFileMock.mock.calls[0][1]).toMatchObject({ scope: 'WORKSPACE' })
    })

    it('converts non-buffer responses to a buffer', async () => {
      mock.onGet(`${ SITE_BASE }/screenshots/${ UUID }.png`).reply('raw-string')

      await service.getScreenshot(UUID)

      expect(uploadFileMock.mock.calls[0][0].toString()).toBe('raw-string')
    })

    it('throws a friendly error when the screenshot is not ready', async () => {
      mock.onGet(`${ SITE_BASE }/screenshots/${ UUID }.png`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getScreenshot(UUID)).rejects.toThrow(/is not available yet/)
      expect(uploadFileMock).not.toHaveBeenCalled()
    })

    it('wraps other download errors', async () => {
      mock.onGet(`${ SITE_BASE }/screenshots/${ UUID }.png`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Storage unavailable' },
      })

      await expect(service.getScreenshot(UUID)).rejects.toThrow('urlscan.io API error: Storage unavailable')
    })
  })

  describe('getDomSnapshot', () => {
    it('returns the DOM string', async () => {
      mock.onGet(`${ SITE_BASE }/dom/${ UUID }/`).reply('<html>hi</html>')

      const result = await service.getDomSnapshot(UUID)

      expect(result).toEqual({ uuid: UUID, dom: '<html>hi</html>' })
      expect(mock.history[0].headers).toMatchObject({ 'API-Key': API_KEY })
    })

    it('stringifies a non-string response', async () => {
      mock.onGet(`${ SITE_BASE }/dom/${ UUID }/`).reply({ foo: 'bar' })

      const result = await service.getDomSnapshot(UUID)

      expect(result.dom).toBe('{"foo":"bar"}')
    })

    it('throws a friendly error when the snapshot is not ready', async () => {
      mock.onGet(`${ SITE_BASE }/dom/${ UUID }/`).replyWithError({ message: 'Not Found', statusCode: 404 })

      await expect(service.getDomSnapshot(UUID)).rejects.toThrow(/is not available yet/)
    })

    it('wraps other errors', async () => {
      mock.onGet(`${ SITE_BASE }/dom/${ UUID }/`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getDomSnapshot(UUID)).rejects.toThrow('urlscan.io API error: Boom')
    })
  })

  describe('getLiveScreenshot', () => {
    it('captures a liveshot and uploads it', async () => {
      const target = 'https://example.com/a?b=c'
      const liveshotUrl = `${ SITE_BASE }/liveshot/?url=${ encodeURIComponent(target) }`

      mock.onGet(liveshotUrl).reply(Buffer.from('live-png'))

      const result = await service.getLiveScreenshot(target)

      expect(mock.history[0].url).toBe(liveshotUrl)
      expect(mock.history[0].encoding).toBeNull()
      expect(uploadFileMock).toHaveBeenCalledTimes(1)
      expect(result.url).toBe('https://files.example.com/shot.png')
      expect(result.filename).toMatch(/^liveshot_\d+\.png$/)
    })

    it('forwards custom file options', async () => {
      const liveshotUrl = `${ SITE_BASE }/liveshot/?url=${ encodeURIComponent('https://example.com') }`

      mock.onGet(liveshotUrl).reply(Buffer.from('live'))

      await service.getLiveScreenshot('https://example.com', { scope: 'EXECUTION' })

      expect(uploadFileMock.mock.calls[0][1]).toMatchObject({ scope: 'EXECUTION' })
    })

    it('wraps download errors', async () => {
      const liveshotUrl = `${ SITE_BASE }/liveshot/?url=${ encodeURIComponent('https://example.com') }`

      mock.onGet(liveshotUrl).replyWithError({ message: 'Timeout' })

      await expect(service.getLiveScreenshot('https://example.com')).rejects.toThrow('urlscan.io API error: Timeout')
      expect(uploadFileMock).not.toHaveBeenCalled()
    })
  })

  // ── Account ──

  describe('getQuotas', () => {
    it('gets the account quotas', async () => {
      mock.onGet(`${ SITE_BASE }/user/quotas/`).reply({ limits: { public: { day: { limit: 1000 } } } })

      const result = await service.getQuotas()

      expect(result.limits.public.day.limit).toBe(1000)
      expect(mock.history[0].url).toBe(`${ SITE_BASE }/user/quotas/`)
      expect(mock.history[0].headers).toMatchObject({ 'API-Key': API_KEY })
    })

    it('throws on an invalid API key', async () => {
      mock.onGet(`${ SITE_BASE }/user/quotas/`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid API key' },
      })

      await expect(service.getQuotas()).rejects.toThrow('urlscan.io API error: Invalid API key')
    })
  })
})
