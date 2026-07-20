'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key-123'
const BASE = 'https://api.brandfetch.io/v2'

describe('Brandfetch Service', () => {
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
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── getBrand ──

  describe('getBrand', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${ BASE }/brands/nike.com`).reply({
        id: 'id_0dwKPKT',
        name: 'Nike',
        domain: 'nike.com',
      })

      const result = await service.getBrand('nike.com')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/brands/nike.com`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(result).toMatchObject({ id: 'id_0dwKPKT', name: 'Nike', domain: 'nike.com' })
    })

    it('omits allowNsfw from query when not provided', async () => {
      mock.onGet(`${ BASE }/brands/nike.com`).reply({ id: 'x', name: 'Nike' })

      await service.getBrand('nike.com')

      expect(mock.history[0].query).toEqual({})
    })

    it('omits allowNsfw from query when false', async () => {
      mock.onGet(`${ BASE }/brands/nike.com`).reply({ id: 'x', name: 'Nike' })

      await service.getBrand('nike.com', false)

      expect(mock.history[0].query).toEqual({})
    })

    it('includes allowNsfw in query when true', async () => {
      mock.onGet(`${ BASE }/brands/nike.com`).reply({ id: 'x', name: 'Nike' })

      await service.getBrand('nike.com', true)

      expect(mock.history[0].query).toEqual({ allowNsfw: true })
    })

    it('url-encodes the domain or brand id', async () => {
      mock.onGet(`${ BASE }/brands/${ encodeURIComponent('my brand & co') }`).reply({ id: 'x' })

      await service.getBrand('my brand & co')

      expect(mock.history[0].url).toBe(`${ BASE }/brands/my%20brand%20%26%20co`)
    })

    it('flattens primaryLogoUrl and primaryColor and spreads the raw brand', async () => {
      const brand = {
        id: 'id_0dwKPKT',
        name: 'Nike',
        domain: 'nike.com',
        logos: [
          {
            type: 'logo',
            formats: [
              { src: 'https://asset.brandfetch.io/nike.com/logo.svg', format: 'svg' },
              { src: 'https://asset.brandfetch.io/nike.com/logo.png', format: 'png' },
            ],
          },
        ],
        colors: [
          { hex: '#111111', type: 'dark' },
          { hex: '#FF6B35', type: 'accent' },
        ],
      }

      mock.onGet(`${ BASE }/brands/nike.com`).reply(brand)

      const result = await service.getBrand('nike.com')

      // prefers non-svg raster format
      expect(result.primaryLogoUrl).toBe('https://asset.brandfetch.io/nike.com/logo.png')
      // prefers accent color
      expect(result.primaryColor).toBe('#FF6B35')
      // raw brand fields are spread through
      expect(result).toMatchObject({ id: 'id_0dwKPKT', name: 'Nike', domain: 'nike.com' })
      expect(result.logos).toBe(brand.logos)
      expect(result.colors).toBe(brand.colors)
    })

    it('falls back through the logo type priority list', async () => {
      const brand = {
        name: 'Acme',
        logos: [
          { type: 'symbol', formats: [{ src: 'https://x/symbol.png', format: 'png' }] },
          { type: 'icon', formats: [{ src: 'https://x/icon.png', format: 'png' }] },
        ],
      }

      mock.onGet(`${ BASE }/brands/acme.com`).reply(brand)

      const result = await service.getBrand('acme.com')

      // 'logo' absent -> falls to 'symbol'
      expect(result.primaryLogoUrl).toBe('https://x/symbol.png')
    })

    it('uses svg logo when no raster format is available', async () => {
      const brand = {
        name: 'Acme',
        logos: [
          { type: 'logo', formats: [{ src: 'https://x/logo.svg', format: 'svg' }] },
        ],
      }

      mock.onGet(`${ BASE }/brands/acme.com`).reply(brand)

      const result = await service.getBrand('acme.com')

      expect(result.primaryLogoUrl).toBe('https://x/logo.svg')
    })

    it('falls back to first logo when no priority type matches', async () => {
      const brand = {
        name: 'Acme',
        logos: [
          { type: 'banner', formats: [{ src: 'https://x/banner.png', format: 'png' }] },
        ],
      }

      mock.onGet(`${ BASE }/brands/acme.com`).reply(brand)

      const result = await service.getBrand('acme.com')

      expect(result.primaryLogoUrl).toBe('https://x/banner.png')
    })

    it('uses first color when no accent color exists', async () => {
      const brand = {
        name: 'Acme',
        colors: [
          { hex: '#123456', type: 'dark' },
          { hex: '#654321', type: 'light' },
        ],
      }

      mock.onGet(`${ BASE }/brands/acme.com`).reply(brand)

      const result = await service.getBrand('acme.com')

      expect(result.primaryColor).toBe('#123456')
    })

    it('returns undefined primary fields when logos and colors are missing', async () => {
      mock.onGet(`${ BASE }/brands/acme.com`).reply({ name: 'Acme' })

      const result = await service.getBrand('acme.com')

      expect(result.primaryLogoUrl).toBeUndefined()
      expect(result.primaryColor).toBeUndefined()
      expect(result.name).toBe('Acme')
    })

    it('returns undefined primary fields when logos and colors are empty arrays', async () => {
      mock.onGet(`${ BASE }/brands/acme.com`).reply({ name: 'Acme', logos: [], colors: [] })

      const result = await service.getBrand('acme.com')

      expect(result.primaryLogoUrl).toBeUndefined()
      expect(result.primaryColor).toBeUndefined()
    })

    it('returns undefined primaryLogoUrl when matched logo has no formats', async () => {
      const brand = {
        name: 'Acme',
        logos: [{ type: 'logo', formats: [] }],
      }

      mock.onGet(`${ BASE }/brands/acme.com`).reply(brand)

      const result = await service.getBrand('acme.com')

      expect(result.primaryLogoUrl).toBeUndefined()
    })

    it('throws a wrapped error with status and body message on API failure', async () => {
      mock.onGet(`${ BASE }/brands/missing.com`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Brand not found' },
      })

      await expect(service.getBrand('missing.com')).rejects.toThrow(
        'Brandfetch API error (404): Brand not found'
      )
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${ BASE }/brands/missing.com`).replyWithError({
        message: 'Network failure',
        status: 500,
      })

      await expect(service.getBrand('missing.com')).rejects.toThrow(
        'Brandfetch API error (500): Network failure'
      )
    })

    it('uses statusCode when status is absent', async () => {
      mock.onGet(`${ BASE }/brands/missing.com`).replyWithError({
        message: 'Unauthorized',
        statusCode: 401,
        body: { message: 'Invalid API key' },
      })

      await expect(service.getBrand('missing.com')).rejects.toThrow(
        'Brandfetch API error (401): Invalid API key'
      )
    })

    it('omits the status suffix when no status is present', async () => {
      mock.onGet(`${ BASE }/brands/missing.com`).replyWithError({
        message: 'boom',
      })

      await expect(service.getBrand('missing.com')).rejects.toThrow(
        'Brandfetch API error: boom'
      )
    })
  })

  // ── searchBrands ──

  describe('searchBrands', () => {
    it('sends correct request and returns the results array', async () => {
      const results = [
        { brandId: 'id_0dwKPKT', name: 'Nike', domain: 'nike.com', icon: 'https://x/icon.png', claimed: true },
      ]

      mock.onGet(`${ BASE }/search/nike`).reply(results)

      const result = await service.searchBrands('nike')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/search/nike`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(result).toEqual(results)
    })

    it('sends no query parameters', async () => {
      mock.onGet(`${ BASE }/search/nike`).reply([])

      await service.searchBrands('nike')

      expect(mock.history[0].query).toEqual({})
    })

    it('url-encodes the query', async () => {
      mock.onGet(`${ BASE }/search/${ encodeURIComponent('air bnb') }`).reply([])

      await service.searchBrands('air bnb')

      expect(mock.history[0].url).toBe(`${ BASE }/search/air%20bnb`)
    })

    it('returns an empty array when the API returns a non-array', async () => {
      mock.onGet(`${ BASE }/search/nothing`).reply({ message: 'no results' })

      const result = await service.searchBrands('nothing')

      expect(result).toEqual([])
    })

    it('returns an empty array when the API returns undefined', async () => {
      mock.onGet(`${ BASE }/search/nothing`).reply(undefined)

      const result = await service.searchBrands('nothing')

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/search/bad`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { message: 'Rate limit exceeded' },
      })

      await expect(service.searchBrands('bad')).rejects.toThrow(
        'Brandfetch API error (429): Rate limit exceeded'
      )
    })
  })
})
