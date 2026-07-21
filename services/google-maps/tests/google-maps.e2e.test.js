'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Maps Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('google-maps')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // The FlowRunner runtime injects `this.flowrunner` (with the Files API) at
    // execution time; the sandbox does not. Provide a minimal Files stub so the
    // photo / static-map methods can exercise the HTTP paths and return a URL.
    if (!service.flowrunner) {
      service.flowrunner = {
        Files: {
          uploadFile: async (buffer) => ({
            url: `memory://google-maps/${ Buffer.isBuffer(buffer) ? buffer.length : 0 }-bytes`,
          }),
        },
      }
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Defaults are stable, well-known locations; testValues can override them.
  const KNOWN_LAT = 37.4224764
  const KNOWN_LNG = -122.0842499

  const knownAddress = () => (testValues && testValues.address) || '1600 Amphitheatre Parkway, Mountain View, CA'
  const knownPlaceId = () => (testValues && testValues.placeId) || 'ChIJ2eUgeAK6j4ARbn5u_wAGqWA'

  // ── Geocoding ──

  describe('geocodeAddress', () => {
    it('geocodes a known address', async () => {
      const response = await service.geocodeAddress(knownAddress())

      expect(response).toHaveProperty('status')
      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('reverseGeocode', () => {
    it('reverse geocodes a coordinate', async () => {
      const response = await service.reverseGeocode(KNOWN_LAT, KNOWN_LNG)

      expect(response).toHaveProperty('status')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('geocodeByPlaceId', () => {
    it('geocodes a known place id', async () => {
      const response = await service.geocodeByPlaceId(knownPlaceId())

      expect(response).toHaveProperty('status')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  // ── Places API (New) ──

  describe('searchPlacesByText', () => {
    it('returns places for a text query', async () => {
      const response = await service.searchPlacesByText('coffee shops in Mountain View', undefined, undefined, undefined, undefined, undefined, 5)

      expect(response).toHaveProperty('places')
      expect(Array.isArray(response.places)).toBe(true)
    })
  })

  describe('searchNearbyPlaces', () => {
    it('returns nearby places within a radius', async () => {
      const response = await service.searchNearbyPlaces(KNOWN_LAT, KNOWN_LNG, 1000, undefined, undefined, undefined, 5)

      expect(response).toHaveProperty('places')
      expect(Array.isArray(response.places)).toBe(true)
    })
  })

  describe('getPlaceDetails', () => {
    it('returns details for a known place id', async () => {
      const response = await service.getPlaceDetails(knownPlaceId())

      expect(response).toHaveProperty('id')
    })
  })

  describe('autocompletePlaces', () => {
    it('returns predictions for partial input', async () => {
      const response = await service.autocompletePlaces('Amphitheatre Pkwy Mountain')

      expect(response).toHaveProperty('suggestions')
      expect(Array.isArray(response.suggestions)).toBe(true)
    })
  })

  describe('getPlacePhoto', () => {
    it('downloads and stores the first photo of a searched place', async () => {
      // Photo resource names expire quickly, so fetch a fresh one via search.
      const search = await service.searchPlacesByText(
        'Googleplex Mountain View', 'places.id,places.photos', undefined, undefined, undefined, undefined, 1
      )
      const photoName = search?.places?.[0]?.photos?.[0]?.name

      if (!photoName) {
        console.log('Skipping getPlacePhoto: no photo returned for the searched place')
        return
      }

      const response = await service.getPlacePhoto(photoName, 400)

      expect(response).toHaveProperty('url')
      expect(response).toHaveProperty('photoUri')
      expect(response).toHaveProperty('photoName')
    })
  })

  // ── Routes API ──

  describe('computeRoute', () => {
    it('computes a driving route between two addresses', async () => {
      const response = await service.computeRoute(
        'San Francisco, CA', 'Mountain View, CA', 'Drive'
      )

      expect(response).toHaveProperty('routes')
      expect(Array.isArray(response.routes)).toBe(true)
    })
  })

  describe('computeRouteMatrix', () => {
    it('computes a matrix for origins and destinations', async () => {
      const response = await service.computeRouteMatrix(
        ['San Francisco, CA'], ['Mountain View, CA', 'Palo Alto, CA'], 'Drive'
      )

      expect(response).toHaveProperty('elements')
      expect(Array.isArray(response.elements)).toBe(true)
      expect(response).toHaveProperty('count')
    })
  })

  // ── Address Validation ──

  describe('validateAddress', () => {
    it('validates a US address', async () => {
      const response = await service.validateAddress(
        ['1600 Amphitheatre Pkwy', 'Mountain View, CA 94043'], 'US'
      )

      expect(response).toHaveProperty('result')
      expect(response).toHaveProperty('responseId')
    })
  })

  // ── Geo Data ──

  describe('getElevation', () => {
    it('returns elevation for coordinates', async () => {
      const response = await service.getElevation(['39.7391536,-104.9847034'])

      expect(response).toHaveProperty('status')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getTimeZone', () => {
    it('returns the time zone for a coordinate', async () => {
      const response = await service.getTimeZone(39.6034810, -119.6822510)

      expect(response).toHaveProperty('status')
      expect(response).toHaveProperty('timeZoneId')
    })
  })

  // ── Static Maps ──

  describe('generateStaticMap', () => {
    it('renders and stores a static map image', async () => {
      const response = await service.generateStaticMap('Brooklyn Bridge, New York, NY', 14)

      expect(response).toHaveProperty('url')
      expect(response).toHaveProperty('width')
      expect(response).toHaveProperty('height')
      expect(response).toHaveProperty('mapType', 'roadmap')
    })
  })

  // ── Dictionary ──

  describe('searchPlacesDictionary', () => {
    it('returns dictionary items for a search', async () => {
      const result = await service.searchPlacesDictionary({ search: 'Googleplex' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns empty items for a blank search', async () => {
      const result = await service.searchPlacesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
