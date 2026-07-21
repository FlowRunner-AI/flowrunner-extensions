'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Brandfetch Service (e2e)', () => {
  let sandbox
  let service
  let domain
  let searchQuery

  beforeAll(() => {
    sandbox = createE2ESandbox('brandfetch')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    const testValues = sandbox.getTestValues()

    // A known-good brand domain/id and a search query. Fall back to a stable,
    // well-known brand so the suite still runs when only credentials are set.
    domain = testValues.domain || 'nike.com'
    searchQuery = testValues.searchQuery || 'nike'
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Brand ──

  describe('getBrand', () => {
    it('returns a full brand profile with the expected shape', async () => {
      const result = await service.getBrand(domain)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('domain')
      expect(result).toHaveProperty('id')

      // flattened convenience fields are always present on the result object
      expect(result).toHaveProperty('primaryLogoUrl')
      expect(result).toHaveProperty('primaryColor')

      expect(Array.isArray(result.logos)).toBe(true)
      expect(Array.isArray(result.colors)).toBe(true)
    })

    it('accepts the allowNsfw flag', async () => {
      const result = await service.getBrand(domain, true)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('domain')
    })
  })

  describe('searchBrands', () => {
    it('returns an array of matching brands', async () => {
      const results = await service.searchBrands(searchQuery)

      expect(Array.isArray(results)).toBe(true)

      if (results.length > 0) {
        const first = results[0]

        expect(first).toHaveProperty('name')
        expect(first).toHaveProperty('domain')
      }
    })
  })
})
