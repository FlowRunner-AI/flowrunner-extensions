'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-leafy-api-key'
const BASE = 'https://leafyplant.app/v1'

describe('Leafy Plant Service', () => {
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

    it('sends the x-api-key header on requests', async () => {
      mock.onGet(`${ BASE }/search`).reply({ query: 'test', count: 0, results: [] })

      await service.searchPlants('test')

      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
    })
  })

  // ── Identify Plant ──

  describe('identifyPlant', () => {
    it('sends POST with image URL and default language', async () => {
      const mockResponse = {
        candidates: [{ scientificName: 'Monstera deliciosa', commonName: 'Swiss Cheese Plant', cosine: 0.83 }],
        confidence: 'probable',
        is_plant: true,
      }

      mock.onPost(`${ BASE }/identify/url`).reply(mockResponse)

      const result = await service.identifyPlant('https://example.com/plant.jpg')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/plant.jpg',
        language: 'en',
      })
    })

    it('sends custom language when provided', async () => {
      mock.onPost(`${ BASE }/identify/url`).reply({ candidates: [], confidence: 'low' })

      await service.identifyPlant('https://example.com/plant.jpg', 'fr')

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/plant.jpg',
        language: 'fr',
      })
    })

    it('throws on API error response', async () => {
      mock.onPost(`${ BASE }/identify/url`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid image URL' },
      })

      await expect(service.identifyPlant('bad-url')).rejects.toThrow('Leafy Plant API error')
    })
  })

  // ── Get Care Guide ──

  describe('getCareGuide', () => {
    it('sends GET with species and default language', async () => {
      const mockResponse = {
        scientific_name: 'Monstera deliciosa',
        watering: { days: 7, summary: 'Moderate watering.' },
        light: { level: 'brightIndirect' },
      }

      mock.onGet(`${ BASE }/care`).reply(mockResponse)

      const result = await service.getCareGuide('Monstera deliciosa')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        species: 'Monstera deliciosa',
        lang: 'en',
      })
    })

    it('passes custom language', async () => {
      mock.onGet(`${ BASE }/care`).reply({ scientific_name: 'Monstera deliciosa' })

      await service.getCareGuide('Monstera deliciosa', 'pt')

      expect(mock.history[0].query).toMatchObject({
        species: 'Monstera deliciosa',
        lang: 'pt',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/care`).replyWithError({
        message: 'Not Found',
        body: { message: 'Species not found' },
      })

      await expect(service.getCareGuide('Unknown species')).rejects.toThrow('Leafy Plant API error')
    })
  })

  // ── Search Plants ──

  describe('searchPlants', () => {
    it('sends GET with query and default limit', async () => {
      const mockResponse = {
        query: 'monstera',
        count: 2,
        results: [
          { scientific_name: 'Monstera deliciosa', common_en: 'Swiss Cheese Plant' },
          { scientific_name: 'Monstera adansonii', common_en: 'Swiss cheese vine' },
        ],
      }

      mock.onGet(`${ BASE }/search`).reply(mockResponse)

      const result = await service.searchPlants('monstera')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        q: 'monstera',
        limit: 10,
      })
    })

    it('passes custom limit', async () => {
      mock.onGet(`${ BASE }/search`).reply({ query: 'fern', count: 0, results: [] })

      await service.searchPlants('fern', 5)

      expect(mock.history[0].query).toMatchObject({
        q: 'fern',
        limit: 5,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/search`).replyWithError({
        message: 'Internal Server Error',
      })

      await expect(service.searchPlants('test')).rejects.toThrow('Leafy Plant API error')
    })
  })

  // ── Get Toxicity ──

  describe('getToxicity', () => {
    it('sends GET with species only', async () => {
      const mockResponse = {
        scientific_name: 'Monstera deliciosa',
        toxicity_data_available: false,
        note: 'Toxicity data not yet sourced for this species.',
      }

      mock.onGet(`${ BASE }/toxicity`).reply(mockResponse)

      const result = await service.getToxicity('Monstera deliciosa')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        species: 'Monstera deliciosa',
      })
    })

    it('sends GET with species and animal', async () => {
      mock.onGet(`${ BASE }/toxicity`).reply({
        scientific_name: 'Lilium longiflorum',
        toxicity_data_available: true,
        toxic_to: ['cat'],
      })

      await service.getToxicity('Lilium longiflorum', 'cat')

      expect(mock.history[0].query).toMatchObject({
        species: 'Lilium longiflorum',
        animal: 'cat',
      })
    })

    it('omits animal from query when not provided', async () => {
      mock.onGet(`${ BASE }/toxicity`).reply({ scientific_name: 'Test' })

      await service.getToxicity('Test')

      // The clean() helper strips undefined/null/empty values
      expect(mock.history[0].query).not.toHaveProperty('animal')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/toxicity`).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.getToxicity('Test')).rejects.toThrow('Leafy Plant API error')
    })
  })

  // ── Dictionary ──

  describe('searchPlantsDictionary', () => {
    it('returns empty items when search is empty', async () => {
      const result = await service.searchPlantsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.searchPlantsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('searches and maps results to dictionary format', async () => {
      mock.onGet(`${ BASE }/search`).reply({
        results: [
          { scientific_name: 'Monstera deliciosa', common_en: 'Swiss Cheese Plant', family: 'Araceae' },
          { scientific_name: 'Monstera adansonii', common_en: 'Swiss cheese vine', family: 'Araceae' },
        ],
      })

      const result = await service.searchPlantsDictionary({ search: 'monstera' })

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Monstera deliciosa (Swiss Cheese Plant)',
        value: 'Monstera deliciosa',
        note: 'Araceae - Swiss Cheese Plant',
      })
      expect(result.items[1]).toEqual({
        label: 'Monstera adansonii (Swiss cheese vine)',
        value: 'Monstera adansonii',
        note: 'Araceae - Swiss cheese vine',
      })
    })

    it('sends correct query params to search endpoint', async () => {
      mock.onGet(`${ BASE }/search`).reply({ results: [] })

      await service.searchPlantsDictionary({ search: 'fern' })

      expect(mock.history[0].query).toMatchObject({
        q: 'fern',
        limit: 10,
      })
    })

    it('handles results without common_en', async () => {
      mock.onGet(`${ BASE }/search`).reply({
        results: [
          { scientific_name: 'Rareplantus obscurus', family: 'Testaceae' },
        ],
      })

      const result = await service.searchPlantsDictionary({ search: 'rare' })

      expect(result.items[0]).toEqual({
        label: 'Rareplantus obscurus',
        value: 'Rareplantus obscurus',
        note: 'Testaceae',
      })
    })

    it('handles results without family or common_en', async () => {
      mock.onGet(`${ BASE }/search`).reply({
        results: [
          { scientific_name: 'Unknown species' },
        ],
      })

      const result = await service.searchPlantsDictionary({ search: 'unknown' })

      expect(result.items[0]).toEqual({
        label: 'Unknown species',
        value: 'Unknown species',
        note: undefined,
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on API-level error status in response body', async () => {
      mock.onGet(`${ BASE }/search`).reply({ status: 'error', message: 'Rate limit exceeded' })

      await expect(service.searchPlants('test')).rejects.toThrow('Leafy Plant API error: Rate limit exceeded')
    })

    it('throws with unknown error when API error has no message', async () => {
      mock.onGet(`${ BASE }/search`).reply({ status: 'error' })

      await expect(service.searchPlants('test')).rejects.toThrow('Leafy Plant API error: Unknown error')
    })
  })
})
