const logger = {
  info: (...args) => console.log('[Google Maps] info:', ...args),
  debug: (...args) => console.log('[Google Maps] debug:', ...args),
  error: (...args) => console.log('[Google Maps] error:', ...args),
  warn: (...args) => console.log('[Google Maps] warn:', ...args),
}

const MAPS_API_BASE_URL = 'https://maps.googleapis.com/maps/api'
const PLACES_API_BASE_URL = 'https://places.googleapis.com/v1'
const ROUTES_API_BASE_URL = 'https://routes.googleapis.com'
const ADDRESS_VALIDATION_URL = 'https://addressvalidation.googleapis.com/v1:validateAddress'

const DEFAULT_PLACES_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types'
const DEFAULT_PLACE_DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location,rating,types'
const DEFAULT_ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
const DEFAULT_ROUTE_MATRIX_FIELD_MASK = 'originIndex,destinationIndex,duration,distanceMeters,status,condition'

const LAT_LNG_REGEX = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

const TRAVEL_MODE_MAP = {
  'Drive': 'DRIVE',
  'Walk': 'WALK',
  'Bicycle': 'BICYCLE',
  'Transit': 'TRANSIT',
  'Two-Wheeler': 'TWO_WHEELER',
}

const ROUTING_PREFERENCE_MAP = {
  'Traffic Unaware': 'TRAFFIC_UNAWARE',
  'Traffic Aware': 'TRAFFIC_AWARE',
  'Traffic Aware Optimal': 'TRAFFIC_AWARE_OPTIMAL',
}

const PRICE_LEVEL_MAP = {
  'Inexpensive': 'PRICE_LEVEL_INEXPENSIVE',
  'Moderate': 'PRICE_LEVEL_MODERATE',
  'Expensive': 'PRICE_LEVEL_EXPENSIVE',
  'Very Expensive': 'PRICE_LEVEL_VERY_EXPENSIVE',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @usesFileStorage
 * @integrationName Google Maps
 * @integrationIcon /icon.svg
 */
class GoogleMapsService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, headers, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url.split('?')[0] }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json', ...(headers || {}) })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.error_message || error.body?.message || error.message

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Google Maps API error: ${ message }`)
    }
  }

  // Classic web-service APIs (Geocoding, Elevation, Time Zone) authenticate with ?key= and
  // report failures via a top-level "status" field even on HTTP 200.
  async #classicRequest({ endpoint, query, logTag, apiName }) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ MAPS_API_BASE_URL }/${ endpoint }/json`,
      query: { ...query, key: this.apiKey },
    })

    if (response.status && response.status !== 'OK' && response.status !== 'ZERO_RESULTS') {
      const details = response.error_message || response.errorMessage || ''

      throw new Error(`Google Maps ${ apiName } error: ${ response.status }${ details ? ` - ${ details }` : '' }`)
    }

    return response
  }

  async #binaryRequest({ url, query, headers, logTag }) {
    try {
      logger.debug(`${ logTag } - [GET::${ url.split('?')[0] }] (binary)`)

      const bytes = await Flowrunner.Request.get(url)
        .set(headers || {})
        .query(clean(query) || {})
        .setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - binary request failed: ${ message }`)

      throw new Error(`Google Maps API error: ${ message }`)
    }
  }

  #newApiHeaders(fieldMask) {
    return clean({
      'X-Goog-Api-Key': this.apiKey,
      'X-Goog-FieldMask': fieldMask,
    })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #parseLatLng(value, label) {
    const match = String(value).trim().match(LAT_LNG_REGEX)

    if (!match) {
      throw new Error(`${ label } must be a "latitude,longitude" pair, e.g. "40.7128,-74.0060"`)
    }

    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) }
  }

  // Routes API waypoints accept an address, a "lat,lng" pair, or a place ID. Auto-detect the
  // form and build the matching waypoint object.
  #toWaypoint(value) {
    const raw = String(value).trim()
    const latLng = raw.match(LAT_LNG_REGEX)

    if (latLng) {
      return { location: { latLng: { latitude: parseFloat(latLng[1]), longitude: parseFloat(latLng[2]) } } }
    }

    if (raw.toLowerCase().startsWith('place_id:')) {
      return { placeId: raw.slice('place_id:'.length).trim() }
    }

    if (/^ChIJ[A-Za-z0-9_-]+$/.test(raw)) {
      return { placeId: raw }
    }

    return { address: raw }
  }

  #toRfc3339(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const numeric = Number(value)

    if (!isNaN(numeric) && String(value).trim() !== '') {
      // Epoch value: treat < 10^12 as seconds, otherwise milliseconds.
      const ms = numeric < 1e12 ? numeric * 1000 : numeric

      return new Date(ms).toISOString()
    }

    const date = new Date(value)

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp "${ value }". Use an ISO 8601 date-time or an epoch value.`)
    }

    return date.toISOString()
  }

  #toEpochSeconds(value) {
    if (value === undefined || value === null || value === '') {
      return Math.floor(Date.now() / 1000)
    }

    const numeric = Number(value)

    if (!isNaN(numeric) && String(value).trim() !== '') {
      return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }

    const date = new Date(value)

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp "${ value }". Use an ISO 8601 date-time or an epoch value.`)
    }

    return Math.floor(date.getTime() / 1000)
  }

  #buildCircle(centerValue, radiusMeters, label) {
    if (!centerValue) {
      return undefined
    }

    return {
      circle: {
        center: this.#parseLatLng(centerValue, label),
        radius: radiusMeters || 5000,
      },
    }
  }

  /**
   * @operationName Geocode Address
   * @category Geocoding
   * @description Converts a street address or place name into geographic coordinates and structured address data using the Google Geocoding API. Returns latitude/longitude, a formatted address, address components (street, city, state, country, postal code), the place ID, and location precision (ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, or APPROXIMATE). Use the components filter (e.g. "country:US|postal_code:94043") to restrict matches. Requires the Geocoding API to be enabled for your key.
   * @route GET /geocode-address
   *
   * @paramDef {"type":"String","label":"Address","name":"address","required":true,"description":"The street address or place name to geocode, e.g. \"1600 Amphitheatre Parkway, Mountain View, CA\"."}
   * @paramDef {"type":"String","label":"Components Filter","name":"components","description":"Pipe-separated component filters that restrict results, e.g. \"country:US|postal_code:94043\". Supported components: country, postal_code, locality, administrative_area, route."}
   * @paramDef {"type":"String","label":"Region","name":"region","description":"Two-letter ccTLD region code that biases results toward a region, e.g. \"us\", \"uk\", \"de\"."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language code for the returned address, e.g. \"en\", \"fr\", \"ja\". Defaults to the API's best guess."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"formatted_address":"1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA","geometry":{"location":{"lat":37.4224764,"lng":-122.0842499},"location_type":"ROOFTOP"},"place_id":"ChIJ2eUgeAK6j4ARbn5u_wAGqWA","types":["street_address"],"address_components":[{"long_name":"1600","short_name":"1600","types":["street_number"]}]}],"status":"OK"}
   */
  async geocodeAddress(address, components, region, language) {
    return await this.#classicRequest({
      logTag: '[geocodeAddress]',
      endpoint: 'geocode',
      apiName: 'Geocoding',
      query: clean({ address, components, region, language }),
    })
  }

  /**
   * @operationName Reverse Geocode
   * @category Geocoding
   * @description Converts geographic coordinates into human-readable addresses using the Google Geocoding API. Returns all matching addresses ordered from most to least specific (street address, neighborhood, city, state, country), each with address components and a place ID. Optionally filter by result type (e.g. street_address, locality) or location precision. Requires the Geocoding API to be enabled for your key.
   * @route GET /reverse-geocode
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude of the point to reverse geocode, e.g. 40.714224."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude of the point to reverse geocode, e.g. -73.961452."}
   * @paramDef {"type":"String","label":"Result Type Filter","name":"resultType","description":"Pipe-separated list of address types to return, e.g. \"street_address|locality\". Leave empty for all types."}
   * @paramDef {"type":"String","label":"Location Type Filter","name":"locationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Rooftop","Range Interpolated","Geometric Center","Approximate"]}},"description":"Restrict results to a location precision level. Leave empty for all precision levels."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language code for the returned addresses, e.g. \"en\", \"es\", \"ja\"."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"formatted_address":"277 Bedford Ave, Brooklyn, NY 11211, USA","geometry":{"location":{"lat":40.7142205,"lng":-73.9612903},"location_type":"ROOFTOP"},"place_id":"ChIJd8BlQ2BZwokRAFUEcm_qrcA","types":["street_address"]}],"status":"OK"}
   */
  async reverseGeocode(latitude, longitude, resultType, locationType, language) {
    return await this.#classicRequest({
      logTag: '[reverseGeocode]',
      endpoint: 'geocode',
      apiName: 'Geocoding',
      query: clean({
        latlng: `${ latitude },${ longitude }`,
        result_type: resultType,
        location_type: this.#resolveChoice(locationType, {
          'Rooftop': 'ROOFTOP',
          'Range Interpolated': 'RANGE_INTERPOLATED',
          'Geometric Center': 'GEOMETRIC_CENTER',
          'Approximate': 'APPROXIMATE',
        }),
        language,
      }),
    })
  }

  /**
   * @operationName Geocode by Place ID
   * @category Geocoding
   * @description Retrieves the full geocoding result (coordinates, formatted address, and address components) for a known Google place ID using the Geocoding API. Useful for turning a place ID from Places search or Autocomplete into a structured postal address. Requires the Geocoding API to be enabled for your key.
   * @route GET /geocode-by-place-id
   *
   * @paramDef {"type":"String","label":"Place ID","name":"placeId","required":true,"dictionary":"searchPlacesDictionary","description":"The Google place ID to geocode, e.g. \"ChIJd8BlQ2BZwokRAFUEcm_qrcA\". Search and select a place, or paste an ID directly."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language code for the returned address, e.g. \"en\", \"de\", \"pt-BR\"."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"formatted_address":"277 Bedford Ave, Brooklyn, NY 11211, USA","geometry":{"location":{"lat":40.7142205,"lng":-73.9612903}},"place_id":"ChIJd8BlQ2BZwokRAFUEcm_qrcA","types":["street_address"]}],"status":"OK"}
   */
  async geocodeByPlaceId(placeId, language) {
    return await this.#classicRequest({
      logTag: '[geocodeByPlaceId]',
      endpoint: 'geocode',
      apiName: 'Geocoding',
      query: clean({ place_id: placeId, language }),
    })
  }

  /**
   * @operationName Search Places by Text
   * @category Places
   * @description Searches for places using a free-text query (e.g. "vegan restaurants in Austin") via the Places API (New) Text Search. Returns up to 20 places per page (60 max across pages via the page token) with the fields selected in the field mask. Supports filtering by place type, open-now status, minimum rating, and price levels, plus an optional circular location bias. Requires the Places API (New) to be enabled for your key.
   * @route GET /search-places-by-text
   *
   * @paramDef {"type":"String","label":"Text Query","name":"textQuery","required":true,"description":"Free-text search query, e.g. \"coffee shops near Central Park\" or \"plumbers in Denver\"."}
   * @paramDef {"type":"String","label":"Field Mask","name":"fieldMask","defaultValue":"places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types","description":"Comma-separated list of place fields to return (prefixed with \"places.\"). Add fields like places.internationalPhoneNumber, places.websiteUri, places.currentOpeningHours, places.priceLevel, places.photos as needed. Use \"*\" for all fields (highest billing tier)."}
   * @paramDef {"type":"String","label":"Included Type","name":"includedType","description":"Restrict results to a single place type, e.g. \"restaurant\", \"gas_station\", \"lodging\". See the Places API Table A type list."}
   * @paramDef {"type":"Boolean","label":"Open Now","name":"openNow","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Only return places that are currently open for business."}
   * @paramDef {"type":"Number","label":"Minimum Rating","name":"minRating","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return places with at least this average user rating (0.0-5.0, in 0.5 increments)."}
   * @paramDef {"type":"Array<String>","label":"Price Levels","name":"priceLevels","uiComponent":{"type":"DROPDOWN","options":{"values":["Inexpensive","Moderate","Expensive","Very Expensive"]}},"description":"Only return places at the selected price levels."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of results per page (1-20). Defaults to 20."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken from a previous response, to fetch the next page of results."}
   * @paramDef {"type":"String","label":"Rank By","name":"rankPreference","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevance","Distance"]}},"defaultValue":"Relevance","description":"Order results by relevance to the query or by distance from the bias location."}
   * @paramDef {"type":"String","label":"Bias Location","name":"biasLocation","description":"Optional \"latitude,longitude\" center point to bias results toward, e.g. \"40.7128,-74.0060\"."}
   * @paramDef {"type":"Number","label":"Bias Radius (meters)","name":"biasRadiusMeters","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Radius in meters around the bias location (up to 50000). Defaults to 5000 when a bias location is set."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","description":"Language code for results, e.g. \"en\", \"fr\", \"ja\"."}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"Two-letter CLDR region code used to format the response, e.g. \"US\", \"GB\"."}
   *
   * @returns {Object}
   * @sampleResult {"places":[{"id":"ChIJj61dQgK6j4AR4GeTYWZsKWw","displayName":{"text":"Blue Bottle Coffee","languageCode":"en"},"formattedAddress":"300 Webster St, Oakland, CA 94607, USA","location":{"latitude":37.7955,"longitude":-122.2668},"rating":4.5,"types":["cafe","food"]}],"nextPageToken":"AeeoHcKvvP8"}
   */
  async searchPlacesByText(
    textQuery, fieldMask, includedType, openNow, minRating, priceLevels,
    pageSize, pageToken, rankPreference, biasLocation, biasRadiusMeters, languageCode, regionCode
  ) {
    return await this.#apiRequest({
      logTag: '[searchPlacesByText]',
      url: `${ PLACES_API_BASE_URL }/places:searchText`,
      method: 'post',
      headers: this.#newApiHeaders(fieldMask || DEFAULT_PLACES_FIELD_MASK),
      body: clean({
        textQuery,
        includedType,
        openNow: openNow || undefined,
        minRating,
        priceLevels: priceLevels?.length
          ? priceLevels.map(level => this.#resolveChoice(level, PRICE_LEVEL_MAP))
          : undefined,
        pageSize,
        pageToken,
        rankPreference: this.#resolveChoice(rankPreference, { 'Relevance': 'RELEVANCE', 'Distance': 'DISTANCE' }),
        locationBias: this.#buildCircle(biasLocation, biasRadiusMeters, 'Bias Location'),
        languageCode,
        regionCode,
      }),
    })
  }

  /**
   * @operationName Search Nearby Places
   * @category Places
   * @description Finds places within a circular area around a coordinate using the Places API (New) Nearby Search. Returns up to 20 places with the fields selected in the field mask, optionally filtered by included/excluded place types and ranked by popularity or distance. Requires the Places API (New) to be enabled for your key.
   * @route GET /search-nearby-places
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude of the search area center, e.g. 37.7937."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude of the search area center, e.g. -122.3965."}
   * @paramDef {"type":"Number","label":"Radius (meters)","name":"radiusMeters","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1000,"description":"Search radius in meters around the center point (greater than 0, up to 50000)."}
   * @paramDef {"type":"Array<String>","label":"Included Types","name":"includedTypes","description":"Place types to include (up to 50), e.g. [\"restaurant\",\"cafe\"]. See the Places API Table A type list. Leave empty for all types."}
   * @paramDef {"type":"Array<String>","label":"Excluded Types","name":"excludedTypes","description":"Place types to exclude (up to 50), e.g. [\"gas_station\"]."}
   * @paramDef {"type":"String","label":"Field Mask","name":"fieldMask","defaultValue":"places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types","description":"Comma-separated list of place fields to return (prefixed with \"places.\"). Add fields like places.internationalPhoneNumber, places.websiteUri, places.currentOpeningHours, places.photos as needed."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResultCount","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Maximum number of places to return (1-20). Defaults to 20."}
   * @paramDef {"type":"String","label":"Rank By","name":"rankPreference","uiComponent":{"type":"DROPDOWN","options":{"values":["Popularity","Distance"]}},"defaultValue":"Popularity","description":"Order results by popularity or by distance from the center point."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","description":"Language code for results, e.g. \"en\", \"es\"."}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"Two-letter CLDR region code used to format the response, e.g. \"US\"."}
   *
   * @returns {Object}
   * @sampleResult {"places":[{"id":"ChIJs9Wo7MB-j4ARnZq_bXUdWmk","displayName":{"text":"Ferry Building Marketplace","languageCode":"en"},"formattedAddress":"1 Ferry Building, San Francisco, CA 94111, USA","location":{"latitude":37.7955,"longitude":-122.3937},"rating":4.6,"types":["shopping_mall","tourist_attraction"]}]}
   */
  async searchNearbyPlaces(
    latitude, longitude, radiusMeters, includedTypes, excludedTypes,
    fieldMask, maxResultCount, rankPreference, languageCode, regionCode
  ) {
    return await this.#apiRequest({
      logTag: '[searchNearbyPlaces]',
      url: `${ PLACES_API_BASE_URL }/places:searchNearby`,
      method: 'post',
      headers: this.#newApiHeaders(fieldMask || DEFAULT_PLACES_FIELD_MASK),
      body: clean({
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        },
        includedTypes: includedTypes?.length ? includedTypes : undefined,
        excludedTypes: excludedTypes?.length ? excludedTypes : undefined,
        maxResultCount,
        rankPreference: this.#resolveChoice(rankPreference, { 'Popularity': 'POPULARITY', 'Distance': 'DISTANCE' }),
        languageCode,
        regionCode,
      }),
    })
  }

  /**
   * @operationName Get Place Details
   * @category Places
   * @description Retrieves detailed information about a single place by its place ID using the Places API (New). The field mask controls which fields are returned - request contact data (internationalPhoneNumber, websiteUri), opening hours (currentOpeningHours, regularOpeningHours), ratings, reviews, photos, priceLevel, and more. Requires the Places API (New) to be enabled for your key.
   * @route GET /place-details
   *
   * @paramDef {"type":"String","label":"Place ID","name":"placeId","required":true,"dictionary":"searchPlacesDictionary","description":"The Google place ID, e.g. \"ChIJj61dQgK6j4AR4GeTYWZsKWw\". Search and select a place, or paste an ID directly."}
   * @paramDef {"type":"String","label":"Field Mask","name":"fieldMask","defaultValue":"id,displayName,formattedAddress,location,rating,types","description":"Comma-separated list of place fields to return, WITHOUT the \"places.\" prefix (e.g. \"id,displayName,internationalPhoneNumber,websiteUri,currentOpeningHours,photos\"). Use \"*\" for all fields (highest billing tier)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","description":"Language code for the returned details, e.g. \"en\", \"ja\"."}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"Two-letter CLDR region code used to format the response, e.g. \"US\"."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ChIJj61dQgK6j4AR4GeTYWZsKWw","displayName":{"text":"Googleplex","languageCode":"en"},"formattedAddress":"1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA","location":{"latitude":37.4224764,"longitude":-122.0842499},"rating":4.3,"types":["corporate_office","point_of_interest"]}
   */
  async getPlaceDetails(placeId, fieldMask, languageCode, regionCode) {
    return await this.#apiRequest({
      logTag: '[getPlaceDetails]',
      url: `${ PLACES_API_BASE_URL }/places/${ encodeURIComponent(placeId) }`,
      headers: this.#newApiHeaders(fieldMask || DEFAULT_PLACE_DETAILS_FIELD_MASK),
      query: clean({ languageCode, regionCode }),
    })
  }

  /**
   * @operationName Autocomplete Places
   * @category Places
   * @description Returns up to five place and query predictions for a partial text input using the Places API (New) Autocomplete - ideal for resolving user-typed place names into place IDs. Supports restricting predictions by primary place types and country codes, plus a circular location bias. Requires the Places API (New) to be enabled for your key.
   * @route GET /autocomplete-places
   *
   * @paramDef {"type":"String","label":"Input","name":"input","required":true,"description":"The text to get predictions for - a partial address, place name, or plus code, e.g. \"Sicilian piz\"."}
   * @paramDef {"type":"Array<String>","label":"Included Primary Types","name":"includedPrimaryTypes","description":"Restrict predictions to up to five primary place types, e.g. [\"restaurant\"] or [\"(cities)\"]."}
   * @paramDef {"type":"Array<String>","label":"Included Region Codes","name":"includedRegionCodes","description":"Restrict predictions to up to 15 two-letter country codes, e.g. [\"us\",\"ca\"]."}
   * @paramDef {"type":"String","label":"Bias Location","name":"biasLocation","description":"Optional \"latitude,longitude\" center point to bias predictions toward, e.g. \"48.8566,2.3522\"."}
   * @paramDef {"type":"Number","label":"Bias Radius (meters)","name":"biasRadiusMeters","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Radius in meters around the bias location. Defaults to 5000 when a bias location is set."}
   * @paramDef {"type":"String","label":"Origin","name":"origin","description":"Optional \"latitude,longitude\" point used to calculate straight-line distanceMeters for each prediction."}
   * @paramDef {"type":"String","label":"Session Token","name":"sessionToken","description":"Optional session token string that groups Autocomplete calls with a following Place Details call into one billing session."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","description":"Language code for predictions, e.g. \"en\", \"fr\"."}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"Two-letter region code used to format the response, e.g. \"US\"."}
   *
   * @returns {Object}
   * @sampleResult {"suggestions":[{"placePrediction":{"placeId":"ChIJ5YQQf1GGhYARPKG7WLIaOko","text":{"text":"Amoeba Music, Haight Street, San Francisco, CA, USA"},"structuredFormat":{"mainText":{"text":"Amoeba Music"},"secondaryText":{"text":"Haight Street, San Francisco, CA, USA"}},"types":["store","point_of_interest"]}}]}
   */
  async autocompletePlaces(
    input, includedPrimaryTypes, includedRegionCodes, biasLocation, biasRadiusMeters,
    origin, sessionToken, languageCode, regionCode
  ) {
    return await this.#apiRequest({
      logTag: '[autocompletePlaces]',
      url: `${ PLACES_API_BASE_URL }/places:autocomplete`,
      method: 'post',
      headers: this.#newApiHeaders(),
      body: clean({
        input,
        includedPrimaryTypes: includedPrimaryTypes?.length ? includedPrimaryTypes : undefined,
        includedRegionCodes: includedRegionCodes?.length ? includedRegionCodes : undefined,
        locationBias: this.#buildCircle(biasLocation, biasRadiusMeters, 'Bias Location'),
        origin: origin ? this.#parseLatLng(origin, 'Origin') : undefined,
        sessionToken,
        languageCode,
        regionCode,
      }),
    })
  }

  /**
   * @operationName Get Place Photo
   * @category Places
   * @description Downloads a place photo by its photo resource name (from the photos field of Place Details or a Places search with \"places.photos\" in the field mask) and saves it to FlowRunner file storage. Returns the stored file URL plus the source photo URI. Photos are scaled to fit the requested max dimensions while keeping aspect ratio. Requires the Places API (New) to be enabled for your key.
   * @route POST /place-photo
   *
   * @paramDef {"type":"String","label":"Photo Name","name":"photoName","required":true,"description":"The full photo resource name in the form \"places/PLACE_ID/photos/PHOTO_RESOURCE\", taken from a place's photos[].name field. Photo names expire, so always use a freshly fetched one."}
   * @paramDef {"type":"Number","label":"Max Width (px)","name":"maxWidthPx","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1024,"description":"Maximum image width in pixels (1-4800). Defaults to 1024 when no max height is set."}
   * @paramDef {"type":"Number","label":"Max Height (px)","name":"maxHeightPx","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum image height in pixels (1-4800)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved photo. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flow/place_photo_1721224156000.jpg","photoUri":"https://lh3.googleusercontent.com/place-photos/AJ0go8s","photoName":"places/ChIJj61dQgK6j4AR4GeTYWZsKWw/photos/AelY_CvGb8"}
   */
  async getPlacePhoto(photoName, maxWidthPx, maxHeightPx, fileOptions) {
    const logTag = '[getPlacePhoto]'
    const normalizedName = String(photoName).trim().replace(/^\/+/, '')

    const metadata = await this.#apiRequest({
      logTag,
      url: `${ PLACES_API_BASE_URL }/${ normalizedName }/media`,
      headers: this.#newApiHeaders(),
      query: clean({
        maxWidthPx: maxWidthPx || (maxHeightPx ? undefined : 1024),
        maxHeightPx,
        skipHttpRedirect: 'true',
      }),
    })

    if (!metadata?.photoUri) {
      throw new Error('Google Maps API error: no photoUri returned for the requested photo')
    }

    const buffer = await this.#binaryRequest({ logTag, url: metadata.photoUri })

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `place_photo_${ Date.now() }.jpg`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url, photoUri: metadata.photoUri, photoName: normalizedName }
  }

  /**
   * @operationName Compute Route
   * @category Routes
   * @description Calculates a route between an origin and destination using the Google Routes API, with optional intermediate stops. Returns duration, distance, and an encoded polyline by default - extend the field mask for turn-by-turn steps (routes.legs), toll info, or traffic-aware durations. Origins, destinations, and stops accept a street address, a \"latitude,longitude\" pair, or a place ID (auto-detected). Requires the Routes API to be enabled for your key.
   * @route POST /compute-route
   *
   * @paramDef {"type":"String","label":"Origin","name":"origin","required":true,"description":"Starting point: a street address, a \"latitude,longitude\" pair, or a place ID (e.g. \"ChIJ...\" or \"place_id:ChIJ...\")."}
   * @paramDef {"type":"String","label":"Destination","name":"destination","required":true,"description":"End point: a street address, a \"latitude,longitude\" pair, or a place ID."}
   * @paramDef {"type":"String","label":"Travel Mode","name":"travelMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Drive","Walk","Bicycle","Transit","Two-Wheeler"]}},"defaultValue":"Drive","description":"How the route is traveled. Two-Wheeler (motorized) is only available in supported countries."}
   * @paramDef {"type":"String","label":"Routing Preference","name":"routingPreference","uiComponent":{"type":"DROPDOWN","options":{"values":["Traffic Unaware","Traffic Aware","Traffic Aware Optimal"]}},"defaultValue":"Traffic Aware","description":"How live traffic is considered. Only applies to Drive and Two-Wheeler modes; ignored otherwise."}
   * @paramDef {"type":"String","label":"Departure Time","name":"departureTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Departure time as an ISO 8601 date-time or epoch timestamp. Must be in the future for traffic-aware routing. Defaults to now."}
   * @paramDef {"type":"Array<String>","label":"Intermediate Stops","name":"intermediates","description":"Up to 25 waypoints to pass through, each an address, \"latitude,longitude\" pair, or place ID, in visit order."}
   * @paramDef {"type":"Boolean","label":"Compute Alternative Routes","name":"computeAlternativeRoutes","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Also return up to three alternative routes. Not available when intermediate stops are set."}
   * @paramDef {"type":"Boolean","label":"Avoid Tolls","name":"avoidTolls","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Avoid toll roads where possible (Drive and Two-Wheeler modes)."}
   * @paramDef {"type":"Boolean","label":"Avoid Highways","name":"avoidHighways","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Avoid highways where possible (Drive and Two-Wheeler modes)."}
   * @paramDef {"type":"Boolean","label":"Avoid Ferries","name":"avoidFerries","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Avoid ferries where possible (Drive and Two-Wheeler modes)."}
   * @paramDef {"type":"String","label":"Field Mask","name":"fieldMask","defaultValue":"routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline","description":"Comma-separated list of route fields to return, e.g. add routes.legs for turn-by-turn steps, routes.travelAdvisory.tollInfo for tolls, or routes.staticDuration for the no-traffic duration."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","description":"Language code for route instructions, e.g. \"en-US\", \"de\"."}
   * @paramDef {"type":"String","label":"Units","name":"units","uiComponent":{"type":"DROPDOWN","options":{"values":["Metric","Imperial"]}},"description":"Unit system for display fields in instructions. Defaults to the origin country's convention."}
   *
   * @returns {Object}
   * @sampleResult {"routes":[{"distanceMeters":772,"duration":"165s","polyline":{"encodedPolyline":"ipkcFfichVnP@j@BLoFVwM{E?"}}]}
   */
  async computeRoute(
    origin, destination, travelMode, routingPreference, departureTime, intermediates,
    computeAlternativeRoutes, avoidTolls, avoidHighways, avoidFerries, fieldMask, languageCode, units
  ) {
    const mode = this.#resolveChoice(travelMode, TRAVEL_MODE_MAP) || 'DRIVE'
    const trafficCapable = mode === 'DRIVE' || mode === 'TWO_WHEELER'
    const modifiers = trafficCapable
      ? clean({
        avoidTolls: avoidTolls || undefined,
        avoidHighways: avoidHighways || undefined,
        avoidFerries: avoidFerries || undefined,
      })
      : undefined

    return await this.#apiRequest({
      logTag: '[computeRoute]',
      url: `${ ROUTES_API_BASE_URL }/directions/v2:computeRoutes`,
      method: 'post',
      headers: this.#newApiHeaders(fieldMask || DEFAULT_ROUTES_FIELD_MASK),
      body: clean({
        origin: this.#toWaypoint(origin),
        destination: this.#toWaypoint(destination),
        intermediates: intermediates?.length ? intermediates.map(stop => this.#toWaypoint(stop)) : undefined,
        travelMode: mode,
        routingPreference: trafficCapable
          ? this.#resolveChoice(routingPreference, ROUTING_PREFERENCE_MAP)
          : undefined,
        departureTime: this.#toRfc3339(departureTime),
        computeAlternativeRoutes: computeAlternativeRoutes || undefined,
        routeModifiers: modifiers && Object.keys(modifiers).length ? modifiers : undefined,
        languageCode,
        units: this.#resolveChoice(units, { 'Metric': 'METRIC', 'Imperial': 'IMPERIAL' }),
      }),
    })
  }

  /**
   * @operationName Compute Route Matrix
   * @category Routes
   * @description Calculates travel duration and distance for every origin-destination combination using the Google Routes API route matrix (up to 625 elements per request, 100 for Transit or Traffic Aware Optimal, and max 50 address/place-ID waypoints). Each origin and destination accepts an address, a \"latitude,longitude\" pair, or a place ID (auto-detected). Returns one element per pair with origin/destination indexes, duration, distance, and route condition. Requires the Routes API to be enabled for your key.
   * @route POST /compute-route-matrix
   *
   * @paramDef {"type":"Array<String>","label":"Origins","name":"origins","required":true,"description":"Starting points, each an address, \"latitude,longitude\" pair, or place ID, e.g. [\"40.7128,-74.0060\",\"Newark, NJ\"]."}
   * @paramDef {"type":"Array<String>","label":"Destinations","name":"destinations","required":true,"description":"End points, each an address, \"latitude,longitude\" pair, or place ID."}
   * @paramDef {"type":"String","label":"Travel Mode","name":"travelMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Drive","Walk","Bicycle","Transit","Two-Wheeler"]}},"defaultValue":"Drive","description":"How the routes are traveled."}
   * @paramDef {"type":"String","label":"Routing Preference","name":"routingPreference","uiComponent":{"type":"DROPDOWN","options":{"values":["Traffic Unaware","Traffic Aware","Traffic Aware Optimal"]}},"defaultValue":"Traffic Aware","description":"How live traffic is considered. Only applies to Drive and Two-Wheeler modes; ignored otherwise."}
   * @paramDef {"type":"String","label":"Field Mask","name":"fieldMask","defaultValue":"originIndex,destinationIndex,duration,distanceMeters,status,condition","description":"Comma-separated list of matrix element fields to return."}
   *
   * @returns {Object}
   * @sampleResult {"elements":[{"originIndex":0,"destinationIndex":0,"status":{},"distanceMeters":9218,"duration":"1108s","condition":"ROUTE_EXISTS"},{"originIndex":0,"destinationIndex":1,"status":{},"distanceMeters":22103,"duration":"1786s","condition":"ROUTE_EXISTS"}],"count":2}
   */
  async computeRouteMatrix(origins, destinations, travelMode, routingPreference, fieldMask) {
    const mode = this.#resolveChoice(travelMode, TRAVEL_MODE_MAP) || 'DRIVE'
    const trafficCapable = mode === 'DRIVE' || mode === 'TWO_WHEELER'

    const response = await this.#apiRequest({
      logTag: '[computeRouteMatrix]',
      url: `${ ROUTES_API_BASE_URL }/distanceMatrix/v2:computeRouteMatrix`,
      method: 'post',
      headers: this.#newApiHeaders(fieldMask || DEFAULT_ROUTE_MATRIX_FIELD_MASK),
      body: clean({
        origins: (origins || []).map(value => ({ waypoint: this.#toWaypoint(value) })),
        destinations: (destinations || []).map(value => ({ waypoint: this.#toWaypoint(value) })),
        travelMode: mode,
        routingPreference: trafficCapable
          ? this.#resolveChoice(routingPreference, ROUTING_PREFERENCE_MAP)
          : undefined,
      }),
    })

    // The REST endpoint streams the matrix as a JSON array; normalize to a stable object shape.
    const elements = Array.isArray(response)
      ? response
      : typeof response === 'string' ? JSON.parse(response) : [response]

    return { elements, count: elements.length }
  }

  /**
   * @operationName Validate Address
   * @category Address Validation
   * @description Validates and standardizes a postal address using the Google Address Validation API. Returns a verdict (completeness, inferred/replaced components), the standardized address with per-component confirmation levels, and a geocode for the address. For US and Puerto Rico addresses, optional USPS CASS processing adds delivery-point validation. Requires the Address Validation API to be enabled for your key (available in supported countries only).
   * @route POST /validate-address
   *
   * @paramDef {"type":"Array<String>","label":"Address Lines","name":"addressLines","required":true,"description":"The address lines to validate, e.g. [\"1600 Amphitheatre Pkwy\",\"Mountain View, CA 94043\"]. At least one line is required."}
   * @paramDef {"type":"String","label":"Region Code","name":"regionCode","description":"Two-letter CLDR country code of the address, e.g. \"US\", \"CA\", \"DE\". Strongly recommended for accurate validation."}
   * @paramDef {"type":"String","label":"Locality","name":"locality","description":"City or town, e.g. \"Mountain View\". Optional if included in the address lines."}
   * @paramDef {"type":"String","label":"Administrative Area","name":"administrativeArea","description":"State, province, or region, e.g. \"CA\"."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code, e.g. \"94043\"."}
   * @paramDef {"type":"Boolean","label":"Enable USPS CASS","name":"enableUspsCass","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Run USPS CASS delivery-point validation. US and Puerto Rico addresses only."}
   * @paramDef {"type":"String","label":"Previous Response ID","name":"previousResponseId","description":"The responseId from a previous validation of this address, used when re-validating after a correction."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"verdict":{"inputGranularity":"PREMISE","validationGranularity":"PREMISE","geocodeGranularity":"PREMISE","addressComplete":true},"address":{"formattedAddress":"1600 Amphitheatre Parkway, Mountain View, CA 94043-1351, USA","postalAddress":{"regionCode":"US","postalCode":"94043-1351","locality":"Mountain View","addressLines":["1600 Amphitheatre Pkwy"]}},"geocode":{"location":{"latitude":37.4223878,"longitude":-122.0841877},"placeId":"ChIJj38IfwK6j4ARNcyPDnEGa9g"}},"responseId":"87db0bde-c114-4c8c-a8a4-b1c1d47e38e6"}
   */
  async validateAddress(addressLines, regionCode, locality, administrativeArea, postalCode, enableUspsCass, previousResponseId) {
    return await this.#apiRequest({
      logTag: '[validateAddress]',
      url: ADDRESS_VALIDATION_URL,
      method: 'post',
      headers: this.#newApiHeaders(),
      body: clean({
        address: clean({
          addressLines,
          regionCode,
          locality,
          administrativeArea,
          postalCode,
        }),
        enableUspsCass: enableUspsCass || undefined,
        previousResponseId,
      }),
    })
  }

  /**
   * @operationName Get Elevation
   * @category Geo Data
   * @description Returns the elevation above sea level in meters for one or more coordinates using the Google Elevation API, including a resolution value indicating sample accuracy. Negative elevations indicate locations below sea level (e.g. ocean floor). Requires the Elevation API to be enabled for your key.
   * @route GET /elevation
   *
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locations","required":true,"description":"One or more \"latitude,longitude\" pairs to sample, e.g. [\"39.7391536,-104.9847034\",\"36.455556,-116.866667\"]. Up to 512 locations per request."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"elevation":1608.637939453125,"location":{"lat":39.7391536,"lng":-104.9847034},"resolution":4.771975994110107}],"status":"OK"}
   */
  async getElevation(locations) {
    const formatted = (locations || []).map(location => {
      const { latitude, longitude } = this.#parseLatLng(location, 'Each location')

      return `${ latitude },${ longitude }`
    })

    return await this.#classicRequest({
      logTag: '[getElevation]',
      endpoint: 'elevation',
      apiName: 'Elevation',
      query: { locations: formatted.join('|') },
    })
  }

  /**
   * @operationName Get Time Zone
   * @category Geo Data
   * @description Returns the time zone for a coordinate using the Google Time Zone API: the IANA time zone ID (e.g. America/New_York), localized name, raw UTC offset, and daylight-saving offset in effect at the given time. Requires the Time Zone API to be enabled for your key.
   * @route GET /time-zone
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude of the location, e.g. 39.6034810."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude of the location, e.g. -119.6822510."}
   * @paramDef {"type":"String","label":"Timestamp","name":"timestamp","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Point in time used to determine daylight-saving offsets, as an ISO 8601 date-time or epoch timestamp. Defaults to now."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language code for the time zone name, e.g. \"en\", \"es\"."}
   *
   * @returns {Object}
   * @sampleResult {"dstOffset":0,"rawOffset":-28800,"status":"OK","timeZoneId":"America/Los_Angeles","timeZoneName":"Pacific Standard Time"}
   */
  async getTimeZone(latitude, longitude, timestamp, language) {
    return await this.#classicRequest({
      logTag: '[getTimeZone]',
      endpoint: 'timezone',
      apiName: 'Time Zone',
      query: clean({
        location: `${ latitude },${ longitude }`,
        timestamp: this.#toEpochSeconds(timestamp),
        language,
      }),
    })
  }

  /**
   * @operationName Generate Static Map
   * @category Static Maps
   * @description Renders a map image (PNG) using the Google Maps Static API and saves it to FlowRunner file storage, returning the file URL. Supports center/zoom framing, roadmap/satellite/terrain/hybrid map types, multiple marker definitions, and an encoded or pipe-delimited path overlay. If only markers or a path are provided, the map auto-frames to fit them. Requires the Maps Static API to be enabled for your key.
   * @route POST /static-map
   *
   * @paramDef {"type":"String","label":"Center","name":"center","description":"Map center as an address or \"latitude,longitude\" pair, e.g. \"Brooklyn Bridge, New York, NY\". Optional when markers or a path define the viewport."}
   * @paramDef {"type":"Number","label":"Zoom","name":"zoom","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zoom level 0 (world) to 21+ (building). Common values: 5 landmass, 10 city, 15 streets, 20 buildings. Optional when markers or a path define the viewport."}
   * @paramDef {"type":"Number","label":"Width (px)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":640,"description":"Image width in pixels (max 640 at scale 1). Defaults to 640."}
   * @paramDef {"type":"Number","label":"Height (px)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":640,"description":"Image height in pixels (max 640 at scale 1). Defaults to 640."}
   * @paramDef {"type":"String","label":"Map Type","name":"mapType","uiComponent":{"type":"DROPDOWN","options":{"values":["Roadmap","Satellite","Terrain","Hybrid"]}},"defaultValue":"Roadmap","description":"The type of map imagery to render."}
   * @paramDef {"type":"Array<String>","label":"Markers","name":"markers","description":"Marker definitions, each a Static Maps markers value like \"color:red|label:A|40.7128,-74.0060\" or \"size:mid|color:blue|Brooklyn Bridge, NY\". Multiple entries render multiple marker groups."}
   * @paramDef {"type":"String","label":"Path","name":"path","description":"A path overlay as a Static Maps path value, e.g. \"color:0x0000ff|weight:5|40.737102,-73.990318|40.749825,-73.987963\" or \"weight:3|enc:ENCODED_POLYLINE\" (use the polyline from Compute Route)."}
   * @paramDef {"type":"Number","label":"Scale","name":"scale","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pixel density multiplier: 1 (default) or 2 for high-DPI images (doubles output resolution)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved map image. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flow/static_map_1721224156000.png","width":640,"height":640,"mapType":"roadmap"}
   */
  async generateStaticMap(center, zoom, width, height, mapType, markers, path, scale, fileOptions) {
    const logTag = '[generateStaticMap]'

    if (!center && !markers?.length && !path) {
      throw new Error('Provide a Center (with Zoom), or at least one Marker or a Path, to define the map viewport.')
    }

    const resolvedMapType = this.#resolveChoice(mapType, {
      'Roadmap': 'roadmap',
      'Satellite': 'satellite',
      'Terrain': 'terrain',
      'Hybrid': 'hybrid',
    })

    // Build the query string manually: the markers parameter may repeat, which
    // object-based query serialization cannot express.
    const params = []

    const pushParam = (name, value) => {
      if (value !== undefined && value !== null && value !== '') {
        params.push(`${ name }=${ encodeURIComponent(value) }`)
      }
    }

    pushParam('center', center)
    pushParam('zoom', zoom)
    pushParam('size', `${ width || 640 }x${ height || 640 }`)
    pushParam('maptype', resolvedMapType)
    pushParam('path', path)
    pushParam('scale', scale)

    for (const marker of markers || []) {
      pushParam('markers', marker)
    }

    pushParam('key', this.apiKey)

    const buffer = await this.#binaryRequest({
      logTag,
      url: `${ MAPS_API_BASE_URL }/staticmap?${ params.join('&') }`,
    })

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `static_map_${ Date.now() }.png`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      width: width || 640,
      height: height || 640,
      mapType: resolvedMapType || 'roadmap',
    }
  }

  /**
   * @typedef {Object} searchPlacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text place search, e.g. a business name, address, or landmark."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the nextPageToken from the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Search Places Dictionary
   * @description Provides a searchable list of Google places for selecting a place ID in dependent parameters. Searches by name, address, or landmark via Places Text Search; the option value is the place ID.
   * @route POST /search-places-dictionary
   * @paramDef {"type":"searchPlacesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor used to look up places."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Googleplex","value":"ChIJj61dQgK6j4AR4GeTYWZsKWw","note":"1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA"}],"cursor":"AeeoHcKvvP8"}
   */
  async searchPlacesDictionary(payload) {
    const { search, cursor } = payload || {}

    if (!search) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: '[searchPlacesDictionary]',
      url: `${ PLACES_API_BASE_URL }/places:searchText`,
      method: 'post',
      headers: this.#newApiHeaders('places.id,places.displayName,places.formattedAddress,nextPageToken'),
      body: clean({
        textQuery: search,
        pageSize: 20,
        pageToken: cursor,
      }),
    })

    const places = response.places || []

    return {
      items: places.map(place => ({
        label: place.displayName?.text || place.id,
        value: place.id,
        note: place.formattedAddress || undefined,
      })),
      cursor: response.nextPageToken || null,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleMapsService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Google Cloud API key with billing enabled and the Maps Platform APIs you plan to use turned on: Geocoding API, Places API (New), Routes API, Address Validation API, Elevation API, Time Zone API, and Maps Static API. Create it in Google Cloud Console under APIs & Services > Credentials.',
  },
])
