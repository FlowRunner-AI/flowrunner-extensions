'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OpenThesaurus Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('openthesaurus')
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

  // ── getSynonyms ──

  describe('getSynonyms', () => {
    it('returns synsets for a known German word', async () => {
      const result = await service.getSynonyms('Test')

      expect(result).toHaveProperty('metaData')
      expect(result).toHaveProperty('synsets')
      expect(Array.isArray(result.synsets)).toBe(true)
      expect(result.synsets.length).toBeGreaterThan(0)
      expect(result.synsets[0]).toHaveProperty('terms')
      expect(Array.isArray(result.synsets[0].terms)).toBe(true)
      expect(result.synsets[0].terms[0]).toHaveProperty('term')
    })

    it('returns empty synsets for an unknown word', async () => {
      const result = await service.getSynonyms('xyznonexistentword12345')

      expect(result).toHaveProperty('synsets')
      expect(result.synsets).toHaveLength(0)
    })

    it('returns similar terms when similar flag is true', async () => {
      const result = await service.getSynonyms('Test', true)

      expect(result).toHaveProperty('similarterms')
      expect(Array.isArray(result.similarterms)).toBe(true)
    })

    it('returns substring matches when substring flag is true', async () => {
      const result = await service.getSynonyms('Test', false, true)

      expect(result).toHaveProperty('substringterms')
      expect(Array.isArray(result.substringterms)).toBe(true)
    })

    it('returns startswith matches when startsWith flag is true', async () => {
      const result = await service.getSynonyms('Test', false, false, true)

      expect(result).toHaveProperty('startsWithterms')
      expect(Array.isArray(result.startsWithterms)).toBe(true)
    })

    it('returns baseforms when baseForm flag is true', async () => {
      const result = await service.getSynonyms('gehend', false, false, false, false, false, true)

      expect(result).toHaveProperty('baseforms')
      expect(Array.isArray(result.baseforms)).toBe(true)
    })

    it('includes all optional data when all flags are true', async () => {
      const result = await service.getSynonyms('Test', true, true, true, true, true, true)

      expect(result).toHaveProperty('metaData')
      expect(result).toHaveProperty('synsets')
      expect(result).toHaveProperty('similarterms')
      expect(result).toHaveProperty('substringterms')
      expect(result).toHaveProperty('startsWithterms')
    })
  })
})
