'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Leafy Plant Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('leafy-plant')
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

  // ── Search Plants ──

  describe('searchPlants', () => {
    it('returns results with expected shape', async () => {
      const result = await service.searchPlants('monstera', 5)

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('scientific_name')
      }
    })

    it('returns empty results for nonsense query', async () => {
      const result = await service.searchPlants('zzxxyynonsenseplant', 5)

      expect(result).toHaveProperty('results')
      expect(result.results).toHaveLength(0)
    })

    it('respects the limit parameter', async () => {
      const result = await service.searchPlants('plant', 2)

      expect(result.results.length).toBeLessThanOrEqual(2)
    })
  })

  // ── Identify Plant ──

  describe('identifyPlant', () => {
    it('identifies a plant from an image URL', async () => {
      const imageUrl = testValues.testImageUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Monstera_deliciosa3.jpg/440px-Monstera_deliciosa3.jpg'

      const result = await service.identifyPlant(imageUrl)

      expect(result).toHaveProperty('candidates')
      expect(Array.isArray(result.candidates)).toBe(true)
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('is_plant')
    }, 30000)

    it('accepts a language parameter', async () => {
      const imageUrl = testValues.testImageUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Monstera_deliciosa3.jpg/440px-Monstera_deliciosa3.jpg'

      const result = await service.identifyPlant(imageUrl, 'fr')

      expect(result).toHaveProperty('candidates')
      expect(result).toHaveProperty('confidence')
    }, 30000)
  })

  // ── Get Care Guide ──

  describe('getCareGuide', () => {
    it('returns care guide for a known species', async () => {
      const result = await service.getCareGuide('Monstera deliciosa')

      expect(result).toHaveProperty('scientific_name')
      expect(result).toHaveProperty('watering')
      expect(result).toHaveProperty('light')
    })

    it('accepts a language parameter', async () => {
      const result = await service.getCareGuide('Monstera deliciosa', 'fr')

      expect(result).toHaveProperty('scientific_name')
    })
  })

  // ── Get Toxicity ──

  describe('getToxicity', () => {
    it('returns toxicity info for a known species', async () => {
      const result = await service.getToxicity('Monstera deliciosa')

      expect(result).toHaveProperty('scientific_name')
      expect(result).toHaveProperty('toxicity_data_available')
    })

    it('accepts an animal parameter', async () => {
      const result = await service.getToxicity('Monstera deliciosa', 'cat')

      expect(result).toHaveProperty('scientific_name')
    })
  })

  // ── Dictionary ──

  describe('searchPlantsDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      const result = await service.searchPlantsDictionary({ search: 'monstera' })

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(result.cursor).toBeNull()
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('returns empty items when search is empty', async () => {
      const result = await service.searchPlantsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
