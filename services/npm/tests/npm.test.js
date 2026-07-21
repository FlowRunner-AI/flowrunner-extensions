'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_TOKEN = 'test-auth-token'
const REGISTRY_BASE = 'https://registry.npmjs.org'
const API_BASE = 'https://api.npmjs.org'

describe('npm Registry Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ authToken: AUTH_TOKEN })
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
            name: 'authToken',
            required: false,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── getPackage ──

  describe('getPackage', () => {
    it('sends GET with correct URL and auth header', async () => {
      const mockResponse = { _id: 'express', name: 'express', description: 'Fast web framework' }
      mock.onGet(`${REGISTRY_BASE}/express`).reply(mockResponse)

      const result = await service.getPackage('express')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      })
    })

    it('encodes scoped package names', async () => {
      mock.onGet(`${REGISTRY_BASE}/@angular%2Fcore`).reply({ name: '@angular/core' })

      await service.getPackage('@angular/core')

      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/@angular%2Fcore`)
    })

    it('encodes unscoped package names with special characters', async () => {
      mock.onGet(`${REGISTRY_BASE}/my%20package`).reply({ name: 'my package' })

      await service.getPackage('my package')

      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/my%20package`)
    })

    it('throws on API error response', async () => {
      mock.onGet(`${REGISTRY_BASE}/nonexistent-pkg-xyz`).reply({ error: 'Not found' })

      await expect(service.getPackage('nonexistent-pkg-xyz')).rejects.toThrow('npm Registry API error: Not found')
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${REGISTRY_BASE}/some-pkg`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid token' },
      })

      await expect(service.getPackage('some-pkg')).rejects.toThrow('npm Registry API error:')
    })
  })

  // ── getPackageVersion ──

  describe('getPackageVersion', () => {
    it('sends GET with package name and version', async () => {
      const mockResponse = { name: 'express', version: '4.19.2' }
      mock.onGet(`${REGISTRY_BASE}/express/4.19.2`).reply(mockResponse)

      const result = await service.getPackageVersion('express', '4.19.2')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/express/4.19.2`)
    })

    it('supports dist-tag as version', async () => {
      mock.onGet(`${REGISTRY_BASE}/express/latest`).reply({ name: 'express', version: '4.19.2' })

      await service.getPackageVersion('express', 'latest')

      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/express/latest`)
    })

    it('encodes scoped package name in URL', async () => {
      mock.onGet(`${REGISTRY_BASE}/@angular%2Fcore/16.0.0`).reply({ name: '@angular/core', version: '16.0.0' })

      await service.getPackageVersion('@angular/core', '16.0.0')

      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/@angular%2Fcore/16.0.0`)
    })

    it('throws on error response', async () => {
      mock.onGet(`${REGISTRY_BASE}/express/99.99.99`).reply({ error: 'version not found: 99.99.99' })

      await expect(service.getPackageVersion('express', '99.99.99')).rejects.toThrow('npm Registry API error:')
    })
  })

  // ── getPackageDistTags ──

  describe('getPackageDistTags', () => {
    it('sends GET to dist-tags endpoint', async () => {
      const mockResponse = { latest: '4.19.2', next: '5.0.0-beta.3' }
      mock.onGet(`${REGISTRY_BASE}/-/package/express/dist-tags`).reply(mockResponse)

      const result = await service.getPackageDistTags('express')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/-/package/express/dist-tags`)
    })

    it('encodes scoped package name', async () => {
      mock.onGet(`${REGISTRY_BASE}/-/package/@babel%2Fcore/dist-tags`).reply({ latest: '7.24.0' })

      await service.getPackageDistTags('@babel/core')

      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/-/package/@babel%2Fcore/dist-tags`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${REGISTRY_BASE}/-/package/nonexistent/dist-tags`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.getPackageDistTags('nonexistent')).rejects.toThrow()
    })
  })

  // ── searchPackages ──

  describe('searchPackages', () => {
    it('sends GET with required text parameter', async () => {
      const mockResponse = { objects: [{ package: { name: 'express' } }], total: 1 }
      mock.onGet(`${REGISTRY_BASE}/-/v1/search`).reply(mockResponse)

      const result = await service.searchPackages('express')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ text: 'express' })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${REGISTRY_BASE}/-/v1/search`).reply({ objects: [], total: 0 })

      await service.searchPackages('react', 10, 20, 0.8, 0.5, 0.9)

      expect(mock.history[0].query).toMatchObject({
        text: 'react',
        size: 10,
        from: 20,
        quality: 0.8,
        popularity: 0.5,
        maintenance: 0.9,
      })
    })

    it('sends undefined optional params when not provided', async () => {
      mock.onGet(`${REGISTRY_BASE}/-/v1/search`).reply({ objects: [], total: 0 })

      await service.searchPackages('lodash')

      const query = mock.history[0].query
      expect(query.text).toBe('lodash')
      expect(query.size).toBeUndefined()
      expect(query.from).toBeUndefined()
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${REGISTRY_BASE}/-/v1/search`).replyWithError({
        message: 'Service Unavailable',
        status: 503,
      })

      await expect(service.searchPackages('test')).rejects.toThrow()
    })
  })

  // ── getDownloadCount ──

  describe('getDownloadCount', () => {
    it('resolves friendly period label to API value', async () => {
      const mockResponse = { downloads: 32100000, start: '2026-07-07', end: '2026-07-13', package: 'express' }
      mock.onGet(`${API_BASE}/downloads/point/last-week/express`).reply(mockResponse)

      const result = await service.getDownloadCount('Last Week', 'express')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/point/last-week/express`)
    })

    it('passes through custom date range period', async () => {
      mock.onGet(`${API_BASE}/downloads/point/2026-01-01%3A2026-01-31/express`).reply({ downloads: 100 })

      await service.getDownloadCount('2026-01-01:2026-01-31', 'express')

      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/point/2026-01-01%3A2026-01-31/express`)
    })

    it('omits package name for registry-wide downloads', async () => {
      mock.onGet(`${API_BASE}/downloads/point/last-day`).reply({ downloads: 999999999 })

      await service.getDownloadCount('Last Day')

      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/point/last-day`)
    })

    it('resolves all period presets correctly', async () => {
      const presets = [
        ['Last Day', 'last-day'],
        ['Last Week', 'last-week'],
        ['Last Month', 'last-month'],
        ['Last Year', 'last-year'],
      ]

      for (const [label, apiValue] of presets) {
        mock.reset()
        mock.onGet(`${API_BASE}/downloads/point/${apiValue}`).reply({ downloads: 0 })

        await service.getDownloadCount(label)

        expect(mock.history[0].url).toBe(`${API_BASE}/downloads/point/${apiValue}`)
      }
    })

    it('encodes scoped package name', async () => {
      mock.onGet(`${API_BASE}/downloads/point/last-week/@babel%2Fcore`).reply({ downloads: 500 })

      await service.getDownloadCount('Last Week', '@babel/core')

      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/point/last-week/@babel%2Fcore`)
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${API_BASE}/downloads/point/last-week/nonexistent`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getDownloadCount('Last Week', 'nonexistent')).rejects.toThrow()
    })
  })

  // ── getDownloadRange ──

  describe('getDownloadRange', () => {
    it('returns per-day download breakdown', async () => {
      const mockResponse = {
        start: '2026-06-14',
        end: '2026-07-13',
        package: 'express',
        downloads: [{ day: '2026-06-14', downloads: 980000 }],
      }
      mock.onGet(`${API_BASE}/downloads/range/last-month/express`).reply(mockResponse)

      const result = await service.getDownloadRange('Last Month', 'express')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/range/last-month/express`)
    })

    it('omits package name for registry-wide range', async () => {
      mock.onGet(`${API_BASE}/downloads/range/last-week`).reply({ downloads: [] })

      await service.getDownloadRange('Last Week')

      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/range/last-week`)
    })

    it('passes through custom date range', async () => {
      mock.onGet(`${API_BASE}/downloads/range/2026-01-01%3A2026-01-31/lodash`).reply({ downloads: [] })

      await service.getDownloadRange('2026-01-01:2026-01-31', 'lodash')

      expect(mock.history[0].url).toBe(`${API_BASE}/downloads/range/2026-01-01%3A2026-01-31/lodash`)
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${API_BASE}/downloads/range/last-month/nonexistent`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.getDownloadRange('Last Month', 'nonexistent')).rejects.toThrow()
    })
  })

  // ── getRegistryInfo ──

  describe('getRegistryInfo', () => {
    it('sends GET to registry root', async () => {
      const mockResponse = { db_name: 'registry', doc_count: 3200000 }
      mock.onGet(`${REGISTRY_BASE}/`).reply(mockResponse)

      const result = await service.getRegistryInfo()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${REGISTRY_BASE}/`)
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${REGISTRY_BASE}/`).replyWithError({
        message: 'Service Unavailable',
        status: 503,
      })

      await expect(service.getRegistryInfo()).rejects.toThrow()
    })
  })

  // ── Error handling edge cases ──

  describe('error handling', () => {
    it('uses error.body.error when available', async () => {
      mock.onGet(`${REGISTRY_BASE}/test-pkg`).replyWithError({
        message: 'Request failed',
        body: { error: 'Package not found' },
      })

      await expect(service.getPackage('test-pkg')).rejects.toThrow('npm Registry API error: Package not found')
    })

    it('uses error.body.message as fallback', async () => {
      mock.onGet(`${REGISTRY_BASE}/test-pkg`).replyWithError({
        message: 'Request failed',
        body: { message: 'Something went wrong' },
      })

      await expect(service.getPackage('test-pkg')).rejects.toThrow('npm Registry API error: Something went wrong')
    })

    it('uses error.message when body is missing', async () => {
      mock.onGet(`${REGISTRY_BASE}/test-pkg`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getPackage('test-pkg')).rejects.toThrow('npm Registry API error: Network timeout')
    })

    it('includes status code in error message', async () => {
      mock.onGet(`${REGISTRY_BASE}/test-pkg`).replyWithError({
        message: 'Forbidden',
        status: 403,
      })

      await expect(service.getPackage('test-pkg')).rejects.toThrow('(status 403)')
    })
  })
})
