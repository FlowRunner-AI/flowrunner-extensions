'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'

const MAPS_BASE = 'https://maps.googleapis.com/maps/api'
const PLACES_BASE = 'https://places.googleapis.com/v1'
const ROUTES_BASE = 'https://routes.googleapis.com'
const ADDRESS_VALIDATION_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress'

describe('Google Maps Service', () => {
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
    // Reset any Files stub installed by individual tests.
    delete service.flowrunner
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with a single required, non-shared apiKey config item', () => {
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

  // ── Geocoding (classic ?key= APIs) ──

  describe('geocodeAddress', () => {
    it('sends the key query param and the address, hitting the geocode endpoint', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [{ place_id: 'X' }], status: 'OK' })

      const result = await service.geocodeAddress('1600 Amphitheatre Parkway, Mountain View, CA')

      expect(result).toEqual({ results: [{ place_id: 'X' }], status: 'OK' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ MAPS_BASE }/geocode/json`)
      expect(mock.history[0].query).toMatchObject({
        key: API_KEY,
        address: '1600 Amphitheatre Parkway, Mountain View, CA',
      })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('includes optional components, region, and language when provided', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'ZERO_RESULTS' })

      await service.geocodeAddress('Springfield', 'country:US|postal_code:94043', 'us', 'en')

      expect(mock.history[0].query).toMatchObject({
        address: 'Springfield',
        components: 'country:US|postal_code:94043',
        region: 'us',
        language: 'en',
        key: API_KEY,
      })
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.geocodeAddress('Springfield')

      const { query } = mock.history[0]

      expect(query).not.toHaveProperty('components')
      expect(query).not.toHaveProperty('region')
      expect(query).not.toHaveProperty('language')
    })

    it('treats ZERO_RESULTS as a success (does not throw)', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'ZERO_RESULTS' })

      await expect(service.geocodeAddress('nowhere at all')).resolves.toEqual({
        results: [],
        status: 'ZERO_RESULTS',
      })
    })

    it('throws on a non-OK status in the 200 body, surfacing error_message', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({
        status: 'REQUEST_DENIED',
        error_message: 'The provided API key is invalid.',
      })

      await expect(service.geocodeAddress('anywhere')).rejects.toThrow(
        'Google Maps Geocoding error: REQUEST_DENIED - The provided API key is invalid.'
      )
    })

    it('throws with just the status when no error_message is present', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ status: 'OVER_QUERY_LIMIT' })

      await expect(service.geocodeAddress('anywhere')).rejects.toThrow(
        'Google Maps Geocoding error: OVER_QUERY_LIMIT'
      )
    })

    it('wraps transport errors from the request layer', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).replyWithError({ message: 'Network down' })

      await expect(service.geocodeAddress('anywhere')).rejects.toThrow(
        'Google Maps API error: Network down'
      )
    })
  })

  describe('reverseGeocode', () => {
    it('builds a latlng pair and maps the location type choice', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.reverseGeocode(40.714224, -73.961452, 'street_address|locality', 'Rooftop', 'en')

      expect(mock.history[0].query).toMatchObject({
        latlng: '40.714224,-73.961452',
        result_type: 'street_address|locality',
        location_type: 'ROOFTOP',
        language: 'en',
        key: API_KEY,
      })
    })

    it('passes through an already-resolved location type value', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.reverseGeocode(1, 2, undefined, 'RANGE_INTERPOLATED')

      expect(mock.history[0].query.location_type).toBe('RANGE_INTERPOLATED')
    })

    it('omits optional filters when not provided', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.reverseGeocode(1, 2)

      const { query } = mock.history[0]

      expect(query).toMatchObject({ latlng: '1,2', key: API_KEY })
      expect(query).not.toHaveProperty('result_type')
      expect(query).not.toHaveProperty('location_type')
      expect(query).not.toHaveProperty('language')
    })
  })

  describe('geocodeByPlaceId', () => {
    it('sends place_id and optional language', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.geocodeByPlaceId('ChIJd8BlQ2BZwokRAFUEcm_qrcA', 'de')

      expect(mock.history[0].query).toMatchObject({
        place_id: 'ChIJd8BlQ2BZwokRAFUEcm_qrcA',
        language: 'de',
        key: API_KEY,
      })
    })

    it('omits language when not provided', async () => {
      mock.onGet(`${ MAPS_BASE }/geocode/json`).reply({ results: [], status: 'OK' })

      await service.geocodeByPlaceId('ChIJd8BlQ2BZwokRAFUEcm_qrcA')

      expect(mock.history[0].query).not.toHaveProperty('language')
    })
  })

  // ── Places API (New) — POST with X-Goog headers ──

  describe('searchPlacesByText', () => {
    it('sends X-Goog-Api-Key and default field mask headers with a POST body', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      await service.searchPlacesByText('coffee shops')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/places:searchText`)
      expect(mock.history[0].headers).toMatchObject({
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types',
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({ textQuery: 'coffee shops' })
    })

    it('uses a custom field mask when provided', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      await service.searchPlacesByText('coffee', 'places.id,places.websiteUri')

      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe('places.id,places.websiteUri')
    })

    it('maps choice params and builds the location bias circle', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      await service.searchPlacesByText(
        'sushi', undefined, 'restaurant', true, 4, ['Moderate', 'Expensive'],
        10, 'token123', 'Distance', '40.7128,-74.0060', 3000, 'en', 'US'
      )

      expect(mock.history[0].body).toEqual({
        textQuery: 'sushi',
        includedType: 'restaurant',
        openNow: true,
        minRating: 4,
        priceLevels: ['PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'],
        pageSize: 10,
        pageToken: 'token123',
        rankPreference: 'DISTANCE',
        locationBias: {
          circle: {
            center: { latitude: 40.7128, longitude: -74.006 },
            radius: 3000,
          },
        },
        languageCode: 'en',
        regionCode: 'US',
      })
    })

    it('defaults the bias circle radius to 5000 when only a bias location is given', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      await service.searchPlacesByText(
        'sushi', undefined, undefined, false, undefined, undefined,
        undefined, undefined, undefined, '40.7,-74.0'
      )

      expect(mock.history[0].body.locationBias.circle.radius).toBe(5000)
    })

    it('omits openNow when false and empty price levels', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      await service.searchPlacesByText('sushi', undefined, undefined, false, undefined, [])

      expect(mock.history[0].body).toEqual({ textQuery: 'sushi' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).replyWithError({
        message: 'Bad',
        body: { error: { message: 'Field mask invalid' } },
      })

      await expect(service.searchPlacesByText('x')).rejects.toThrow(
        'Google Maps API error: Field mask invalid'
      )
    })
  })

  describe('searchNearbyPlaces', () => {
    it('builds a location restriction circle and default field mask', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchNearby`).reply({ places: [] })

      await service.searchNearbyPlaces(37.7937, -122.3965, 1000)

      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/places:searchNearby`)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe(
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types'
      )
      expect(mock.history[0].body).toEqual({
        locationRestriction: {
          circle: {
            center: { latitude: 37.7937, longitude: -122.3965 },
            radius: 1000,
          },
        },
      })
    })

    it('includes types, rank preference, language and region when provided', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchNearby`).reply({ places: [] })

      await service.searchNearbyPlaces(
        1, 2, 500, ['restaurant', 'cafe'], ['gas_station'],
        'places.id', 15, 'Distance', 'en', 'US'
      )

      expect(mock.history[0].body).toEqual({
        locationRestriction: { circle: { center: { latitude: 1, longitude: 2 }, radius: 500 } },
        includedTypes: ['restaurant', 'cafe'],
        excludedTypes: ['gas_station'],
        maxResultCount: 15,
        rankPreference: 'DISTANCE',
        languageCode: 'en',
        regionCode: 'US',
      })
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe('places.id')
    })

    it('omits empty type arrays', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchNearby`).reply({ places: [] })

      await service.searchNearbyPlaces(1, 2, 500, [], [])

      expect(mock.history[0].body).not.toHaveProperty('includedTypes')
      expect(mock.history[0].body).not.toHaveProperty('excludedTypes')
    })
  })

  describe('getPlaceDetails', () => {
    it('encodes the place id in the path and sends the default field mask', async () => {
      mock.onGet(`${ PLACES_BASE }/places/ChIJj61dQgK6j4AR4GeTYWZsKWw`).reply({ id: 'ChIJj61dQgK6j4AR4GeTYWZsKWw' })

      await service.getPlaceDetails('ChIJj61dQgK6j4AR4GeTYWZsKWw')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/places/ChIJj61dQgK6j4AR4GeTYWZsKWw`)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe(
        'id,displayName,formattedAddress,location,rating,types'
      )
      expect(mock.history[0].headers['X-Goog-Api-Key']).toBe(API_KEY)
    })

    it('URL-encodes place ids containing reserved characters', async () => {
      const encoded = `${ PLACES_BASE }/places/${ encodeURIComponent('ChIJ/with space') }`
      mock.onGet(encoded).reply({ id: 'x' })

      await service.getPlaceDetails('ChIJ/with space', '*', 'ja', 'JP')

      expect(mock.history[0].url).toBe(encoded)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe('*')
      expect(mock.history[0].query).toMatchObject({ languageCode: 'ja', regionCode: 'JP' })
    })
  })

  describe('autocompletePlaces', () => {
    it('sends only the api key header (no field mask) and the input body', async () => {
      mock.onPost(`${ PLACES_BASE }/places:autocomplete`).reply({ suggestions: [] })

      await service.autocompletePlaces('Sicilian piz')

      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/places:autocomplete`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Goog-Api-Key': API_KEY })
      expect(mock.history[0].headers).not.toHaveProperty('X-Goog-FieldMask')
      expect(mock.history[0].body).toEqual({ input: 'Sicilian piz' })
    })

    it('builds bias circle, origin lat/lng, and passes region/type restrictions', async () => {
      mock.onPost(`${ PLACES_BASE }/places:autocomplete`).reply({ suggestions: [] })

      await service.autocompletePlaces(
        'amoeba', ['store'], ['us', 'ca'], '48.8566,2.3522', 2000,
        '37.7,-122.4', 'sess-1', 'en', 'US'
      )

      expect(mock.history[0].body).toEqual({
        input: 'amoeba',
        includedPrimaryTypes: ['store'],
        includedRegionCodes: ['us', 'ca'],
        locationBias: { circle: { center: { latitude: 48.8566, longitude: 2.3522 }, radius: 2000 } },
        origin: { latitude: 37.7, longitude: -122.4 },
        sessionToken: 'sess-1',
        languageCode: 'en',
        regionCode: 'US',
      })
    })

    it('omits empty arrays', async () => {
      mock.onPost(`${ PLACES_BASE }/places:autocomplete`).reply({ suggestions: [] })

      await service.autocompletePlaces('x', [], [])

      expect(mock.history[0].body).toEqual({ input: 'x' })
    })

    it('throws a helpful error when the origin is not a lat,lng pair', async () => {
      mock.onPost(`${ PLACES_BASE }/places:autocomplete`).reply({ suggestions: [] })

      await expect(
        service.autocompletePlaces('x', undefined, undefined, undefined, undefined, 'not-a-coord')
      ).rejects.toThrow('Origin must be a "latitude,longitude" pair')
    })
  })

  // ── Place Photo (metadata + binary + Files upload) ──

  describe('getPlacePhoto', () => {
    function stubFiles() {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/flow/photo.jpg' })
      service.flowrunner = { Files: { uploadFile } }
      return uploadFile
    }

    it('fetches photo metadata, downloads the binary, and uploads to Files', async () => {
      const uploadFile = stubFiles()
      const name = 'places/ChIJj61dQgK6j4AR4GeTYWZsKWw/photos/AelY'

      mock
        .onGet(`${ PLACES_BASE }/${ name }/media`)
        .reply({ photoUri: 'https://lh3.googleusercontent.com/place-photos/AJ0go8s' })
      mock.onGet('https://lh3.googleusercontent.com/place-photos/AJ0go8s').reply(Buffer.from('image-bytes'))

      const result = await service.getPlacePhoto(name)

      // First call: metadata with skipHttpRedirect and default max width.
      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/${ name }/media`)
      expect(mock.history[0].headers['X-Goog-Api-Key']).toBe(API_KEY)
      expect(mock.history[0].query).toMatchObject({ maxWidthPx: 1024, skipHttpRedirect: 'true' })

      // Second call: binary download of the resolved photoUri.
      expect(mock.history[1].url).toBe('https://lh3.googleusercontent.com/place-photos/AJ0go8s')
      expect(mock.history[1].encoding).toBeNull()

      expect(uploadFile).toHaveBeenCalledTimes(1)
      const [buffer, opts] = uploadFile.mock.calls[0]
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(opts).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })

      expect(result).toMatchObject({
        url: 'https://files.flowrunner.com/flow/photo.jpg',
        photoUri: 'https://lh3.googleusercontent.com/place-photos/AJ0go8s',
        photoName: name,
      })
    })

    it('strips leading slashes from the photo name', async () => {
      stubFiles()
      const name = 'places/P/photos/Q'

      mock.onGet(`${ PLACES_BASE }/${ name }/media`).reply({ photoUri: 'https://img/x' })
      mock.onGet('https://img/x').reply(Buffer.from('x'))

      const result = await service.getPlacePhoto(`///${ name }`)

      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/${ name }/media`)
      expect(result.photoName).toBe(name)
    })

    it('uses maxHeightPx and skips the default maxWidthPx when height is given', async () => {
      stubFiles()
      const name = 'places/P/photos/Q'

      mock.onGet(`${ PLACES_BASE }/${ name }/media`).reply({ photoUri: 'https://img/y' })
      mock.onGet('https://img/y').reply(Buffer.from('y'))

      await service.getPlacePhoto(name, undefined, 800)

      expect(mock.history[0].query).toMatchObject({ maxHeightPx: 800, skipHttpRedirect: 'true' })
      expect(mock.history[0].query).not.toHaveProperty('maxWidthPx')
    })

    it('passes through custom file options', async () => {
      const uploadFile = stubFiles()
      const name = 'places/P/photos/Q'

      mock.onGet(`${ PLACES_BASE }/${ name }/media`).reply({ photoUri: 'https://img/z' })
      mock.onGet('https://img/z').reply(Buffer.from('z'))

      await service.getPlacePhoto(name, 512, undefined, { scope: 'WORKSPACE' })

      expect(uploadFile.mock.calls[0][1]).toMatchObject({ scope: 'WORKSPACE' })
      expect(mock.history[0].query.maxWidthPx).toBe(512)
    })

    it('throws when metadata has no photoUri', async () => {
      stubFiles()
      const name = 'places/P/photos/Q'

      mock.onGet(`${ PLACES_BASE }/${ name }/media`).reply({})

      await expect(service.getPlacePhoto(name)).rejects.toThrow(
        'Google Maps API error: no photoUri returned for the requested photo'
      )
    })
  })

  // ── Routes API ──

  describe('computeRoute', () => {
    it('sends default drive route with auto-detected waypoints and default field mask', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await service.computeRoute('40.7128,-74.0060', '1600 Amphitheatre Parkway, Mountain View, CA')

      expect(mock.history[0].url).toBe(`${ ROUTES_BASE }/directions/v2:computeRoutes`)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe(
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
      )
      expect(mock.history[0].body).toMatchObject({
        origin: { location: { latLng: { latitude: 40.7128, longitude: -74.006 } } },
        destination: { address: '1600 Amphitheatre Parkway, Mountain View, CA' },
        travelMode: 'DRIVE',
      })
    })

    it('detects place_id: prefixed and bare place-id waypoints', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await service.computeRoute('place_id:ChIJabc', 'ChIJdefGHI123_-')

      expect(mock.history[0].body.origin).toEqual({ placeId: 'ChIJabc' })
      expect(mock.history[0].body.destination).toEqual({ placeId: 'ChIJdefGHI123_-' })
    })

    it('applies route modifiers and routing preference for traffic-capable drive mode', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await service.computeRoute(
        'A', 'B', 'Drive', 'Traffic Aware Optimal', '2030-01-01T00:00:00Z',
        ['Newark, NJ'], true, true, true, true, undefined, 'en-US', 'Imperial'
      )

      const { body } = mock.history[0]

      expect(body.travelMode).toBe('DRIVE')
      expect(body.routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL')
      expect(body.departureTime).toBe('2030-01-01T00:00:00.000Z')
      expect(body.computeAlternativeRoutes).toBe(true)
      expect(body.intermediates).toEqual([{ address: 'Newark, NJ' }])
      expect(body.routeModifiers).toEqual({ avoidTolls: true, avoidHighways: true, avoidFerries: true })
      expect(body.units).toBe('IMPERIAL')
      expect(body.languageCode).toBe('en-US')
    })

    it('omits routing preference and modifiers for non-traffic modes like Walk', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await service.computeRoute('A', 'B', 'Walk', 'Traffic Aware', undefined, undefined, false, true)

      const { body } = mock.history[0]

      expect(body.travelMode).toBe('WALK')
      expect(body).not.toHaveProperty('routingPreference')
      expect(body).not.toHaveProperty('routeModifiers')
    })

    it('converts an epoch-seconds departure time to RFC3339', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await service.computeRoute('A', 'B', 'Drive', undefined, 1893456000)

      expect(mock.history[0].body.departureTime).toBe(new Date(1893456000 * 1000).toISOString())
    })

    it('throws on an invalid departure time', async () => {
      mock.onPost(`${ ROUTES_BASE }/directions/v2:computeRoutes`).reply({ routes: [] })

      await expect(
        service.computeRoute('A', 'B', 'Drive', undefined, 'not-a-date')
      ).rejects.toThrow('Invalid timestamp')
    })
  })

  describe('computeRouteMatrix', () => {
    it('wraps an array response into { elements, count } and builds waypoints', async () => {
      const rows = [
        { originIndex: 0, destinationIndex: 0, distanceMeters: 9218, duration: '1108s', condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 1, distanceMeters: 22103, duration: '1786s', condition: 'ROUTE_EXISTS' },
      ]
      mock.onPost(`${ ROUTES_BASE }/distanceMatrix/v2:computeRouteMatrix`).reply(rows)

      const result = await service.computeRouteMatrix(
        ['40.7128,-74.0060'], ['Newark, NJ', 'ChIJxyz123_-'], 'Drive', 'Traffic Aware'
      )

      expect(mock.history[0].url).toBe(`${ ROUTES_BASE }/distanceMatrix/v2:computeRouteMatrix`)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe(
        'originIndex,destinationIndex,duration,distanceMeters,status,condition'
      )
      expect(mock.history[0].body).toMatchObject({
        origins: [{ waypoint: { location: { latLng: { latitude: 40.7128, longitude: -74.006 } } } }],
        destinations: [{ waypoint: { address: 'Newark, NJ' } }, { waypoint: { placeId: 'ChIJxyz123_-' } }],
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      })
      expect(result).toEqual({ elements: rows, count: 2 })
    })

    it('parses a JSON string response body', async () => {
      const rows = [{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS' }]
      mock.onPost(`${ ROUTES_BASE }/distanceMatrix/v2:computeRouteMatrix`).reply(JSON.stringify(rows))

      const result = await service.computeRouteMatrix(['A'], ['B'])

      expect(result).toEqual({ elements: rows, count: 1 })
    })

    it('wraps a single-object response into a one-element array', async () => {
      mock.onPost(`${ ROUTES_BASE }/distanceMatrix/v2:computeRouteMatrix`).reply({ originIndex: 0, destinationIndex: 0 })

      const result = await service.computeRouteMatrix(['A'], ['B'])

      expect(result.count).toBe(1)
      expect(result.elements).toEqual([{ originIndex: 0, destinationIndex: 0 }])
    })

    it('omits routing preference for non-traffic travel mode', async () => {
      mock.onPost(`${ ROUTES_BASE }/distanceMatrix/v2:computeRouteMatrix`).reply([])

      await service.computeRouteMatrix(['A'], ['B'], 'Transit', 'Traffic Aware')

      expect(mock.history[0].body.travelMode).toBe('TRANSIT')
      expect(mock.history[0].body).not.toHaveProperty('routingPreference')
    })
  })

  // ── Address Validation ──

  describe('validateAddress', () => {
    it('nests address fields and sends the required address lines', async () => {
      mock.onPost(ADDRESS_VALIDATION_URL).reply({ result: {}, responseId: 'r1' })

      await service.validateAddress(['1600 Amphitheatre Pkwy', 'Mountain View, CA 94043'])

      expect(mock.history[0].url).toBe(ADDRESS_VALIDATION_URL)
      expect(mock.history[0].headers['X-Goog-Api-Key']).toBe(API_KEY)
      expect(mock.history[0].body).toEqual({
        address: { addressLines: ['1600 Amphitheatre Pkwy', 'Mountain View, CA 94043'] },
      })
    })

    it('includes region, locality, admin area, postal code, USPS CASS, and previous response id', async () => {
      mock.onPost(ADDRESS_VALIDATION_URL).reply({ result: {}, responseId: 'r2' })

      await service.validateAddress(
        ['1600 Amphitheatre Pkwy'], 'US', 'Mountain View', 'CA', '94043', true, 'prev-1'
      )

      expect(mock.history[0].body).toEqual({
        address: {
          addressLines: ['1600 Amphitheatre Pkwy'],
          regionCode: 'US',
          locality: 'Mountain View',
          administrativeArea: 'CA',
          postalCode: '94043',
        },
        enableUspsCass: true,
        previousResponseId: 'prev-1',
      })
    })

    it('omits enableUspsCass when false', async () => {
      mock.onPost(ADDRESS_VALIDATION_URL).reply({ result: {} })

      await service.validateAddress(['x'], 'US', undefined, undefined, undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('enableUspsCass')
    })
  })

  // ── Geo Data (classic ?key= APIs) ──

  describe('getElevation', () => {
    it('joins lat,lng locations with a pipe and sends the key', async () => {
      mock.onGet(`${ MAPS_BASE }/elevation/json`).reply({ results: [], status: 'OK' })

      await service.getElevation(['39.7391536,-104.9847034', '36.455556,-116.866667'])

      expect(mock.history[0].url).toBe(`${ MAPS_BASE }/elevation/json`)
      expect(mock.history[0].query).toMatchObject({
        locations: '39.7391536,-104.9847034|36.455556,-116.866667',
        key: API_KEY,
      })
    })

    it('throws when a location is not a lat,lng pair', async () => {
      await expect(service.getElevation(['not-a-coord'])).rejects.toThrow(
        'Each location must be a "latitude,longitude" pair'
      )
    })

    it('throws a Time-Zone-style classic error on non-OK status', async () => {
      mock.onGet(`${ MAPS_BASE }/elevation/json`).reply({ status: 'INVALID_REQUEST', error_message: 'bad locations' })

      await expect(service.getElevation(['1,2'])).rejects.toThrow(
        'Google Maps Elevation error: INVALID_REQUEST - bad locations'
      )
    })
  })

  describe('getTimeZone', () => {
    it('sends location and a timestamp in epoch seconds', async () => {
      mock.onGet(`${ MAPS_BASE }/timezone/json`).reply({ status: 'OK', timeZoneId: 'America/Los_Angeles' })

      await service.getTimeZone(39.6034810, -119.6822510, '2030-06-01T00:00:00Z', 'en')

      expect(mock.history[0].url).toBe(`${ MAPS_BASE }/timezone/json`)
      expect(mock.history[0].query).toMatchObject({
        location: '39.603481,-119.682251',
        timestamp: Math.floor(new Date('2030-06-01T00:00:00Z').getTime() / 1000),
        language: 'en',
        key: API_KEY,
      })
    })

    it('defaults the timestamp to now when omitted', async () => {
      mock.onGet(`${ MAPS_BASE }/timezone/json`).reply({ status: 'OK' })

      const before = Math.floor(Date.now() / 1000)
      await service.getTimeZone(1, 2)
      const after = Math.floor(Date.now() / 1000)

      const { timestamp } = mock.history[0].query

      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after + 1)
    })
  })

  // ── Static Maps (binary + Files upload, key baked into URL) ──

  describe('generateStaticMap', () => {
    function stubFiles() {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/flow/map.png' })
      service.flowrunner = { Files: { uploadFile } }
      return uploadFile
    }

    it('builds the static map URL with size/maptype/key and uploads the PNG', async () => {
      const uploadFile = stubFiles()

      // The service assembles the full URL (with query string) before the GET, so
      // match on it exactly. center is URL-encoded and key is appended last. When
      // no map type is supplied the maptype param is omitted (Google defaults to
      // roadmap server-side), though the returned mapType still reports "roadmap".
      const url =
        `${ MAPS_BASE }/staticmap?center=${ encodeURIComponent('Brooklyn Bridge, New York, NY') }` +
        `&zoom=14&size=640x640&key=${ API_KEY }`
      mock.onGet(url).reply(Buffer.from('png-bytes'))

      const result = await service.generateStaticMap('Brooklyn Bridge, New York, NY', 14)

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].url).toContain(`key=${ API_KEY }`)
      expect(mock.history[0].encoding).toBeNull()

      const [buffer, opts] = uploadFile.mock.calls[0]
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(opts).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })

      expect(result).toEqual({
        url: 'https://files.flowrunner.com/flow/map.png',
        width: 640,
        height: 640,
        mapType: 'roadmap',
      })
    })

    it('repeats the markers param and maps the map type', async () => {
      stubFiles()

      const url =
        `${ MAPS_BASE }/staticmap?size=640x640&maptype=satellite` +
        `&markers=${ encodeURIComponent('color:red|label:A|40.7128,-74.0060') }` +
        `&markers=${ encodeURIComponent('color:blue|40.75,-73.99') }` +
        `&key=${ API_KEY }`
      mock.onGet(url).reply(Buffer.from('png'))

      const result = await service.generateStaticMap(
        undefined, undefined, undefined, undefined, 'Satellite',
        ['color:red|label:A|40.7128,-74.0060', 'color:blue|40.75,-73.99']
      )

      expect(mock.history[0].url).toBe(url)
      expect(result.mapType).toBe('satellite')
    })

    it('includes width/height, path, and scale, and returns provided dimensions', async () => {
      const uploadFile = stubFiles()

      const url =
        `${ MAPS_BASE }/staticmap?center=${ encodeURIComponent('40.7,-74.0') }` +
        `&zoom=12&size=300x200&maptype=terrain` +
        `&path=${ encodeURIComponent('weight:3|enc:ENCODED') }&scale=2&key=${ API_KEY }`
      mock.onGet(url).reply(Buffer.from('png'))

      const result = await service.generateStaticMap(
        '40.7,-74.0', 12, 300, 200, 'Terrain', undefined, 'weight:3|enc:ENCODED', 2,
        { scope: 'EXECUTION' }
      )

      expect(mock.history[0].url).toBe(url)
      expect(uploadFile.mock.calls[0][1]).toMatchObject({ scope: 'EXECUTION' })
      expect(result).toEqual({ url: 'https://files.flowrunner.com/flow/map.png', width: 300, height: 200, mapType: 'terrain' })
    })

    it('throws when no center, markers, or path are provided (no request made)', async () => {
      stubFiles()

      await expect(service.generateStaticMap()).rejects.toThrow(
        'Provide a Center (with Zoom), or at least one Marker or a Path'
      )
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Dictionary ──

  describe('searchPlacesDictionary', () => {
    it('returns empty items without a request when search is blank', async () => {
      const result = await service.searchPlacesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items for a null payload without a request', async () => {
      const result = await service.searchPlacesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps places to dictionary items with the place id as the value', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({
        places: [
          {
            id: 'ChIJj61dQgK6j4AR4GeTYWZsKWw',
            displayName: { text: 'Googleplex' },
            formattedAddress: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
          },
          { id: 'ChIJnoName', formattedAddress: '' },
        ],
        nextPageToken: 'AeeoHcKvvP8',
      })

      const result = await service.searchPlacesDictionary({ search: 'google' })

      expect(mock.history[0].url).toBe(`${ PLACES_BASE }/places:searchText`)
      expect(mock.history[0].headers['X-Goog-FieldMask']).toBe(
        'places.id,places.displayName,places.formattedAddress,nextPageToken'
      )
      expect(mock.history[0].body).toEqual({ textQuery: 'google', pageSize: 20 })
      expect(result).toEqual({
        items: [
          {
            label: 'Googleplex',
            value: 'ChIJj61dQgK6j4AR4GeTYWZsKWw',
            note: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
          },
          { label: 'ChIJnoName', value: 'ChIJnoName', note: undefined },
        ],
        cursor: 'AeeoHcKvvP8',
      })
    })

    it('passes the cursor as pageToken and returns null cursor when absent', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).reply({ places: [] })

      const result = await service.searchPlacesDictionary({ search: 'coffee', cursor: 'tok' })

      expect(mock.history[0].body).toEqual({ textQuery: 'coffee', pageSize: 20, pageToken: 'tok' })
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates request errors', async () => {
      mock.onPost(`${ PLACES_BASE }/places:searchText`).replyWithError({ message: 'boom' })

      await expect(service.searchPlacesDictionary({ search: 'x' })).rejects.toThrow(
        'Google Maps API error: boom'
      )
    })
  })
})
