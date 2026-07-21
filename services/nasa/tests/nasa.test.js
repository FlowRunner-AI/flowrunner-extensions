'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-nasa-api-key'
const BASE = 'https://api.nasa.gov'
const IMAGES_BASE = 'https://images-api.nasa.gov'

describe('NASA Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiKey',
            required: true,
            shared: false,
            defaultValue: 'DEMO_KEY',
          }),
        ])
      )
    })
  })

  // ── Astronomy Picture of the Day ──

  describe('getAPOD', () => {
    const url = `${BASE}/planetary/apod`

    it('sends request with defaults (no params)', async () => {
      const mockResponse = { date: '2026-07-14', title: 'A Double Asteroid', media_type: 'image' }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getAPOD()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('passes date parameter', async () => {
      mock.onGet(url).reply({ date: '2026-01-01', title: 'Test' })

      await service.getAPOD('2026-01-01')

      expect(mock.history[0].query).toMatchObject({ date: '2026-01-01', api_key: API_KEY })
    })

    it('passes start_date and end_date parameters', async () => {
      mock.onGet(url).reply([{ date: '2026-01-01' }, { date: '2026-01-02' }])

      await service.getAPOD(undefined, '2026-01-01', '2026-01-02')

      expect(mock.history[0].query).toMatchObject({
        start_date: '2026-01-01',
        end_date: '2026-01-02',
        api_key: API_KEY,
      })
    })

    it('passes count parameter', async () => {
      mock.onGet(url).reply([{ date: '2020-05-05' }])

      await service.getAPOD(undefined, undefined, undefined, 3)

      expect(mock.history[0].query).toMatchObject({ count: 3, api_key: API_KEY })
    })

    it('passes thumbs parameter', async () => {
      mock.onGet(url).reply({ date: '2026-07-14', media_type: 'video' })

      await service.getAPOD(undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].query).toMatchObject({ thumbs: true, api_key: API_KEY })
    })

    it('omits undefined optional parameters from query', async () => {
      mock.onGet(url).reply({ date: '2026-07-14' })

      await service.getAPOD('2026-07-14')

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('start_date')
      expect(query).not.toHaveProperty('end_date')
      expect(query).not.toHaveProperty('count')
      expect(query).not.toHaveProperty('thumbs')
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Bad Request', body: { error: { message: 'Invalid date', code: 400 } } })

      await expect(service.getAPOD('invalid')).rejects.toThrow('NASA API error (400): Invalid date')
    })
  })

  // ── Mars Rover Photos ──

  describe('getMarsRoverPhotos', () => {
    it('sends request with rover resolved from display name', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/photos`
      mock.onGet(url).reply({ photos: [] })

      const result = await service.getMarsRoverPhotos('Curiosity', 1000)

      expect(result).toEqual({ photos: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ sol: 1000, api_key: API_KEY })
    })

    it('resolves camera choice to abbreviation', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/photos`
      mock.onGet(url).reply({ photos: [] })

      await service.getMarsRoverPhotos('Curiosity', 1000, undefined, 'Front Hazard Avoidance Camera')

      expect(mock.history[0].query).toMatchObject({ sol: 1000, camera: 'FHAZ' })
    })

    it('passes earth_date and page parameters', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/perseverance/photos`
      mock.onGet(url).reply({ photos: [{ id: 1 }] })

      await service.getMarsRoverPhotos('Perseverance', undefined, '2024-01-15', undefined, 2)

      expect(mock.history[0].query).toMatchObject({ earth_date: '2024-01-15', page: 2, api_key: API_KEY })
    })

    it('passes through raw rover value if not in mapping', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/custom-rover/photos`
      mock.onGet(url).reply({ photos: [] })

      await service.getMarsRoverPhotos('custom-rover', 1)

      expect(mock.history).toHaveLength(1)
    })

    it('throws on API error', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/photos`
      mock.onGet(url).replyWithError({ message: 'Not Found' })

      await expect(service.getMarsRoverPhotos('Curiosity', 1000)).rejects.toThrow('NASA API error')
    })
  })

  // ── Rover Manifest ──

  describe('getRoverManifest', () => {
    it('sends request for the correct rover', async () => {
      const url = `${BASE}/mars-photos/api/v1/manifests/opportunity`
      const mockManifest = { photo_manifest: { name: 'Opportunity', status: 'complete' } }
      mock.onGet(url).reply(mockManifest)

      const result = await service.getRoverManifest('Opportunity')

      expect(result).toEqual(mockManifest)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('throws on API error', async () => {
      const url = `${BASE}/mars-photos/api/v1/manifests/spirit`
      mock.onGet(url).replyWithError({ message: 'Server Error', status: 500 })

      await expect(service.getRoverManifest('Spirit')).rejects.toThrow('NASA API error')
    })
  })

  // ── Latest Photos ──

  describe('getLatestPhotos', () => {
    it('sends request for the correct rover', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/latest_photos`
      const mockPhotos = { latest_photos: [{ id: 999 }] }
      mock.onGet(url).reply(mockPhotos)

      const result = await service.getLatestPhotos('Curiosity')

      expect(result).toEqual(mockPhotos)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })
  })

  // ── Asteroids NeoWs ──

  describe('getAsteroidsFeed', () => {
    const url = `${BASE}/neo/rest/v1/feed`

    it('sends request with date range', async () => {
      const mockFeed = { element_count: 5, near_earth_objects: {} }
      mock.onGet(url).reply(mockFeed)

      const result = await service.getAsteroidsFeed('2026-07-01', '2026-07-07')

      expect(result).toEqual(mockFeed)
      expect(mock.history[0].query).toMatchObject({
        start_date: '2026-07-01',
        end_date: '2026-07-07',
        api_key: API_KEY,
      })
    })

    it('sends request without dates (defaults)', async () => {
      mock.onGet(url).reply({ element_count: 0, near_earth_objects: {} })

      await service.getAsteroidsFeed()

      const query = mock.history[0].query
      expect(query).toMatchObject({ api_key: API_KEY })
      expect(query).not.toHaveProperty('start_date')
      expect(query).not.toHaveProperty('end_date')
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Date range exceeds 7 days' })

      await expect(service.getAsteroidsFeed('2026-01-01', '2026-02-01')).rejects.toThrow('NASA API error')
    })
  })

  describe('lookupAsteroid', () => {
    it('sends request with asteroid ID', async () => {
      const url = `${BASE}/neo/rest/v1/neo/3542519`
      const mockAsteroid = { id: '3542519', name: '(2010 PK9)', is_potentially_hazardous_asteroid: true }
      mock.onGet(url).reply(mockAsteroid)

      const result = await service.lookupAsteroid('3542519')

      expect(result).toEqual(mockAsteroid)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('throws on API error', async () => {
      const url = `${BASE}/neo/rest/v1/neo/invalid`
      mock.onGet(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.lookupAsteroid('invalid')).rejects.toThrow('NASA API error')
    })
  })

  describe('browseAsteroids', () => {
    const url = `${BASE}/neo/rest/v1/neo/browse`

    it('sends request with pagination parameters', async () => {
      const mockBrowse = { page: { number: 2, size: 10 }, near_earth_objects: [] }
      mock.onGet(url).reply(mockBrowse)

      const result = await service.browseAsteroids(2, 10)

      expect(result).toEqual(mockBrowse)
      expect(mock.history[0].query).toMatchObject({ page: 2, size: 10, api_key: API_KEY })
    })

    it('sends request without params (defaults)', async () => {
      mock.onGet(url).reply({ page: { number: 0 }, near_earth_objects: [] })

      await service.browseAsteroids()

      const query = mock.history[0].query
      expect(query).toMatchObject({ api_key: API_KEY })
      expect(query).not.toHaveProperty('page')
      expect(query).not.toHaveProperty('size')
    })
  })

  // ── EPIC Earth Imagery ──

  describe('getEPICNatural', () => {
    it('sends request without date (most recent)', async () => {
      const url = `${BASE}/EPIC/api/natural`
      mock.onGet(url).reply([{ identifier: '20260712010436', image: 'epic_1b_20260712010436' }])

      const result = await service.getEPICNatural()

      expect(result).toEqual([{ identifier: '20260712010436', image: 'epic_1b_20260712010436' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('sends request with specific date', async () => {
      const url = `${BASE}/EPIC/api/natural/date/2026-07-01`
      mock.onGet(url).reply([{ identifier: '20260701' }])

      const result = await service.getEPICNatural('2026-07-01')

      expect(result).toEqual([{ identifier: '20260701' }])
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getEPICEnhanced', () => {
    it('sends request without date (most recent)', async () => {
      const url = `${BASE}/EPIC/api/enhanced`
      mock.onGet(url).reply([{ identifier: '20260712010436', image: 'epic_RGB_20260712010436' }])

      const result = await service.getEPICEnhanced()

      expect(result).toEqual([{ identifier: '20260712010436', image: 'epic_RGB_20260712010436' }])
      expect(mock.history).toHaveLength(1)
    })

    it('sends request with specific date', async () => {
      const url = `${BASE}/EPIC/api/enhanced/date/2026-06-15`
      mock.onGet(url).reply([{ identifier: '20260615' }])

      await service.getEPICEnhanced('2026-06-15')

      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Earth ──

  describe('getEarthImagery', () => {
    const url = `${BASE}/planetary/earth/imagery`

    it('sends request with required lat/lon', async () => {
      const mockResult = { date: '2018-01-01T00:00:00', url: 'https://example.com/image.png' }
      mock.onGet(url).reply(mockResult)

      const result = await service.getEarthImagery(29.78, -95.33)

      expect(result).toEqual(mockResult)
      expect(mock.history[0].query).toMatchObject({ lat: 29.78, lon: -95.33, api_key: API_KEY })
    })

    it('passes optional date and dim parameters', async () => {
      mock.onGet(url).reply({ date: '2018-01-01T00:00:00' })

      await service.getEarthImagery(29.78, -95.33, '2018-01-01', 0.1)

      expect(mock.history[0].query).toMatchObject({
        lat: 29.78,
        lon: -95.33,
        date: '2018-01-01',
        dim: 0.1,
        api_key: API_KEY,
      })
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(url).reply({ date: '2018-01-01T00:00:00' })

      await service.getEarthImagery(29.78, -95.33)

      const query = mock.history[0].query
      expect(query).not.toHaveProperty('date')
      expect(query).not.toHaveProperty('dim')
    })
  })

  describe('getEarthAssets', () => {
    const url = `${BASE}/planetary/earth/assets`

    it('sends request with required lat/lon', async () => {
      const mockResult = { count: 1, results: [{ date: '2018-01-01T00:00:00' }] }
      mock.onGet(url).reply(mockResult)

      const result = await service.getEarthAssets(29.78, -95.33)

      expect(result).toEqual(mockResult)
      expect(mock.history[0].query).toMatchObject({ lat: 29.78, lon: -95.33, api_key: API_KEY })
    })

    it('passes optional date and dim parameters', async () => {
      mock.onGet(url).reply({ count: 0, results: [] })

      await service.getEarthAssets(29.78, -95.33, '2018-01-01', 0.1)

      expect(mock.history[0].query).toMatchObject({
        lat: 29.78,
        lon: -95.33,
        date: '2018-01-01',
        dim: 0.1,
      })
    })
  })

  // ── DONKI Space Weather ──

  describe('getSolarFlares', () => {
    const url = `${BASE}/DONKI/FLR`

    it('sends request with date range', async () => {
      const mockFlares = [{ flrID: '2024-05-01T05:53:00-FLR-001', classType: 'C5.3' }]
      mock.onGet(url).reply(mockFlares)

      const result = await service.getSolarFlares('2024-05-01', '2024-05-31')

      expect(result).toEqual(mockFlares)
      expect(mock.history[0].query).toMatchObject({
        startDate: '2024-05-01',
        endDate: '2024-05-31',
        api_key: API_KEY,
      })
    })

    it('sends request without dates (defaults to last 30 days)', async () => {
      mock.onGet(url).reply([])

      await service.getSolarFlares()

      const query = mock.history[0].query
      expect(query).toMatchObject({ api_key: API_KEY })
      expect(query).not.toHaveProperty('startDate')
      expect(query).not.toHaveProperty('endDate')
    })
  })

  describe('getGeomagneticStorms', () => {
    const url = `${BASE}/DONKI/GST`

    it('sends request with date range', async () => {
      const mockStorms = [{ gstID: '2024-05-02T15:00:00-GST-001' }]
      mock.onGet(url).reply(mockStorms)

      const result = await service.getGeomagneticStorms('2024-05-01', '2024-05-31')

      expect(result).toEqual(mockStorms)
      expect(mock.history[0].query).toMatchObject({
        startDate: '2024-05-01',
        endDate: '2024-05-31',
        api_key: API_KEY,
      })
    })

    it('sends request without dates', async () => {
      mock.onGet(url).reply([])

      await service.getGeomagneticStorms()

      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })
  })

  describe('getCMEs', () => {
    const url = `${BASE}/DONKI/CME`

    it('sends request with date range', async () => {
      const mockCMEs = [{ activityID: '2024-05-02T14:09:00-CME-001', startTime: '2024-05-02T14:09Z' }]
      mock.onGet(url).reply(mockCMEs)

      const result = await service.getCMEs('2024-05-01', '2024-05-31')

      expect(result).toEqual(mockCMEs)
      expect(mock.history[0].query).toMatchObject({
        startDate: '2024-05-01',
        endDate: '2024-05-31',
        api_key: API_KEY,
      })
    })

    it('sends request without dates', async () => {
      mock.onGet(url).reply([])

      await service.getCMEs()

      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Service Unavailable' })

      await expect(service.getCMEs()).rejects.toThrow('NASA API error')
    })
  })

  // ── Image Library ──

  describe('searchNASAImages', () => {
    const url = `${IMAGES_BASE}/search`

    it('sends request with query term and no api_key', async () => {
      const mockResult = { collection: { items: [{ data: [{ title: 'Moon' }] }], metadata: { total_hits: 1 } } }
      mock.onGet(url).reply(mockResult)

      const result = await service.searchNASAImages('moon')

      expect(result).toEqual(mockResult)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ q: 'moon' })
      expect(mock.history[0].query).not.toHaveProperty('api_key')
    })

    it('resolves media type from display name', async () => {
      mock.onGet(url).reply({ collection: { items: [] } })

      await service.searchNASAImages('apollo', 'Video')

      expect(mock.history[0].query).toMatchObject({ q: 'apollo', media_type: 'video' })
    })

    it('resolves Audio media type', async () => {
      mock.onGet(url).reply({ collection: { items: [] } })

      await service.searchNASAImages('shuttle', 'Audio')

      expect(mock.history[0].query).toMatchObject({ q: 'shuttle', media_type: 'audio' })
    })

    it('resolves Image media type', async () => {
      mock.onGet(url).reply({ collection: { items: [] } })

      await service.searchNASAImages('nebula', 'Image')

      expect(mock.history[0].query).toMatchObject({ q: 'nebula', media_type: 'image' })
    })

    it('omits media_type when not provided', async () => {
      mock.onGet(url).reply({ collection: { items: [] } })

      await service.searchNASAImages('mars')

      expect(mock.history[0].query).not.toHaveProperty('media_type')
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Bad Request' })

      await expect(service.searchNASAImages('test')).rejects.toThrow('NASA API error')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts error.body.error.message and code', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'An error occurred', code: 'API_KEY_INVALID' } },
      })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error (API_KEY_INVALID): An error occurred')
    })

    it('falls back to error.body.error_message', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({
        message: 'Fail',
        body: { error_message: 'Rate limit exceeded' },
      })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error: Rate limit exceeded')
    })

    it('falls back to error.body.msg', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({
        message: 'Fail',
        body: { msg: 'Something went wrong' },
      })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error: Something went wrong')
    })

    it('falls back to error.message when body has no recognized fields', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({ message: 'Network timeout' })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error: Network timeout')
    })

    it('includes status code from error.status', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error (401): Unauthorized')
    })

    it('includes statusCode from error.statusCode when status is absent', async () => {
      const url = `${BASE}/planetary/apod`
      mock.onGet(url).replyWithError({ message: 'Forbidden', statusCode: 403 })

      await expect(service.getAPOD()).rejects.toThrow('NASA API error (403): Forbidden')
    })
  })

  // ── Private helper: #resolveChoice ──

  describe('choice resolution edge cases', () => {
    it('passes through empty string camera (treated as undefined by cleanQuery)', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/photos`
      mock.onGet(url).reply({ photos: [] })

      await service.getMarsRoverPhotos('Curiosity', 100, undefined, '')

      expect(mock.history[0].query).not.toHaveProperty('camera')
    })

    it('passes through null camera (treated as undefined by cleanQuery)', async () => {
      const url = `${BASE}/mars-photos/api/v1/rovers/curiosity/photos`
      mock.onGet(url).reply({ photos: [] })

      await service.getMarsRoverPhotos('Curiosity', 100, undefined, null)

      expect(mock.history[0].query).not.toHaveProperty('camera')
    })
  })
})
