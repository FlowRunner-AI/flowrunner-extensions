'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('NASA Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('nasa')
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

  // ── Astronomy Picture of the Day ──

  describe('getAPOD', () => {
    it('returns today APOD with expected shape', async () => {
      const result = await service.getAPOD()

      expect(result).toHaveProperty('date')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('media_type')
    })

    it('returns APOD for a specific date', async () => {
      const result = await service.getAPOD('2024-01-01')

      expect(result).toHaveProperty('date', '2024-01-01')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('explanation')
    })

    it('returns multiple APODs for a date range', async () => {
      const result = await service.getAPOD(undefined, '2024-01-01', '2024-01-03')

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toHaveProperty('date')
      expect(result[0]).toHaveProperty('title')
    })

    it('returns random APODs with count', async () => {
      const result = await service.getAPOD(undefined, undefined, undefined, 2)

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
    })
  })

  // ── Mars Rover Photos ──

  describe('getMarsRoverPhotos', () => {
    it('returns photos for Curiosity on sol 1000', async () => {
      const result = await service.getMarsRoverPhotos('Curiosity', 1000)

      expect(result).toHaveProperty('photos')
      expect(Array.isArray(result.photos)).toBe(true)
      expect(result.photos.length).toBeGreaterThan(0)
      expect(result.photos[0]).toHaveProperty('img_src')
      expect(result.photos[0]).toHaveProperty('camera')
    })

    it('returns photos filtered by camera', async () => {
      const result = await service.getMarsRoverPhotos('Curiosity', 1000, undefined, 'Front Hazard Avoidance Camera', 1)

      expect(result).toHaveProperty('photos')
      expect(Array.isArray(result.photos)).toBe(true)
      if (result.photos.length > 0) {
        expect(result.photos[0].camera.name).toBe('FHAZ')
      }
    })
  })

  // ── Rover Manifest ──

  describe('getRoverManifest', () => {
    it('returns manifest for Curiosity', async () => {
      const result = await service.getRoverManifest('Curiosity')

      expect(result).toHaveProperty('photo_manifest')
      expect(result.photo_manifest).toHaveProperty('name', 'Curiosity')
      expect(result.photo_manifest).toHaveProperty('status')
      expect(result.photo_manifest).toHaveProperty('max_sol')
      expect(result.photo_manifest).toHaveProperty('total_photos')
    })
  })

  // ── Latest Photos ──

  describe('getLatestPhotos', () => {
    it('returns latest photos for Curiosity', async () => {
      const result = await service.getLatestPhotos('Curiosity')

      expect(result).toHaveProperty('latest_photos')
      expect(Array.isArray(result.latest_photos)).toBe(true)
      expect(result.latest_photos.length).toBeGreaterThan(0)
    })
  })

  // ── Asteroids NeoWs ──

  describe('getAsteroidsFeed', () => {
    it('returns near-earth objects feed', async () => {
      const today = new Date().toISOString().split('T')[0]
      const result = await service.getAsteroidsFeed(today, today)

      expect(result).toHaveProperty('element_count')
      expect(result).toHaveProperty('near_earth_objects')
      expect(typeof result.element_count).toBe('number')
    })
  })

  describe('lookupAsteroid', () => {
    it('returns details for asteroid 3542519', async () => {
      const result = await service.lookupAsteroid('3542519')

      expect(result).toHaveProperty('id', '3542519')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('is_potentially_hazardous_asteroid')
      expect(result).toHaveProperty('estimated_diameter')
    })
  })

  describe('browseAsteroids', () => {
    it('returns paginated asteroid list', async () => {
      const result = await service.browseAsteroids(0, 5)

      expect(result).toHaveProperty('near_earth_objects')
      expect(Array.isArray(result.near_earth_objects)).toBe(true)
      expect(result.near_earth_objects.length).toBeLessThanOrEqual(5)
      expect(result).toHaveProperty('page')
    })
  })

  // ── EPIC Earth Imagery ──

  describe('getEPICNatural', () => {
    it('returns recent natural-color imagery', async () => {
      const result = await service.getEPICNatural()

      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('identifier')
        expect(result[0]).toHaveProperty('image')
        expect(result[0]).toHaveProperty('date')
      }
    })
  })

  describe('getEPICEnhanced', () => {
    it('returns recent enhanced-color imagery', async () => {
      const result = await service.getEPICEnhanced()

      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('identifier')
        expect(result[0]).toHaveProperty('image')
      }
    })
  })

  // ── Earth ──

  describe('getEarthAssets', () => {
    it('returns asset list for Houston coordinates', async () => {
      const result = await service.getEarthAssets(29.78, -95.33, '2018-01-01')

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('results')
    })
  })

  // ── DONKI Space Weather ──

  describe('getSolarFlares', () => {
    it('returns solar flare events', async () => {
      const result = await service.getSolarFlares('2024-05-01', '2024-05-15')

      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('flrID')
        expect(result[0]).toHaveProperty('classType')
      }
    })
  })

  describe('getGeomagneticStorms', () => {
    it('returns geomagnetic storm events', async () => {
      const result = await service.getGeomagneticStorms('2024-05-01', '2024-05-15')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getCMEs', () => {
    it('returns coronal mass ejection events', async () => {
      const result = await service.getCMEs('2024-05-01', '2024-05-15')

      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('activityID')
      }
    })
  })

  // ── Image Library ──

  describe('searchNASAImages', () => {
    it('returns search results for a query', async () => {
      const result = await service.searchNASAImages('apollo 11')

      expect(result).toHaveProperty('collection')
      expect(result.collection).toHaveProperty('items')
      expect(Array.isArray(result.collection.items)).toBe(true)
      expect(result.collection.items.length).toBeGreaterThan(0)
    })

    it('filters results by media type', async () => {
      const result = await service.searchNASAImages('moon', 'Image')

      expect(result).toHaveProperty('collection')
      expect(result.collection).toHaveProperty('items')
      expect(Array.isArray(result.collection.items)).toBe(true)
    })
  })
})
