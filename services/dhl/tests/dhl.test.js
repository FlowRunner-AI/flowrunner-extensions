'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-dhl-api-key'
const BASE = 'https://api-eu.dhl.com'

describe('DHL Service', () => {
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

    it('sends the DHL-API-Key and Accept headers on requests', async () => {
      mock.onGet(`${ BASE }/track/shipments`).reply({ shipments: [] })

      await service.trackShipment('00340434292135100186')

      expect(mock.history[0].headers).toMatchObject({
        'DHL-API-Key': API_KEY,
        'Accept': 'application/json',
      })
    })
  })

  // ── Tracking ──

  describe('trackShipment', () => {
    it('sends a GET to /track/shipments with only the tracking number', async () => {
      mock.onGet(`${ BASE }/track/shipments`).reply({ shipments: [{ id: 'abc' }] })

      const result = await service.trackShipment('00340434292135100186')

      expect(result).toEqual({ shipments: [{ id: 'abc' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/track/shipments`)
      // clean() strips undefined optional fields, leaving only trackingNumber.
      expect(mock.history[0].query).toEqual({ trackingNumber: '00340434292135100186' })
    })

    it('maps the friendly service label to its API value', async () => {
      mock.onGet(`${ BASE }/track/shipments`).reply({ shipments: [] })

      await service.trackShipment('123', 'Parcel Germany')

      expect(mock.history[0].query).toEqual({
        trackingNumber: '123',
        service: 'parcel-de',
      })
    })

    it('passes an unknown service value through unchanged', async () => {
      mock.onGet(`${ BASE }/track/shipments`).reply({ shipments: [] })

      await service.trackShipment('123', 'custom-unit')

      expect(mock.history[0].query).toMatchObject({ service: 'custom-unit' })
    })

    it('includes all optional params when provided', async () => {
      mock.onGet(`${ BASE }/track/shipments`).reply({ shipments: [] })

      await service.trackShipment('123', 'Express', 'US', 'DE', 'en')

      expect(mock.history[0].query).toEqual({
        trackingNumber: '123',
        service: 'express',
        requesterCountryCode: 'US',
        originCountryCode: 'DE',
        language: 'en',
      })
    })

    it('throws a wrapped RFC 7807 error with status, title and detail', async () => {
      mock.onGet(`${ BASE }/track/shipments`).replyWithError({
        message: 'Not Found',
        body: { status: 404, title: 'No Result', detail: 'No shipment found' },
      })

      await expect(service.trackShipment('bad')).rejects.toThrow(
        'DHL API error [404]: No Result - No shipment found'
      )
    })

    it('falls back to error.message when no problem body is present', async () => {
      mock.onGet(`${ BASE }/track/shipments`).replyWithError({ message: 'Network down' })

      await expect(service.trackShipment('bad')).rejects.toThrow('DHL API error: Network down')
    })

    it('uses error.status when the body has no status', async () => {
      mock.onGet(`${ BASE }/track/shipments`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { title: 'Invalid key' },
      })

      await expect(service.trackShipment('bad')).rejects.toThrow('DHL API error [401]: Invalid key')
    })
  })

  // ── Location Finder ──

  describe('findLocationsByAddress', () => {
    it('sends a GET to /location-finder/v1/find-by-address with only the country code', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).reply({ locations: [] })

      const result = await service.findLocationsByAddress('DE')

      expect(result).toEqual({ locations: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/location-finder/v1/find-by-address`)
      expect(mock.history[0].query).toEqual({ countryCode: 'DE' })
    })

    it('maps provider and location type labels and includes all params', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).reply({ locations: [] })

      await service.findLocationsByAddress(
        'DE',
        'Bonn',
        '53113',
        'Charles-de-Gaulle-Str. 20',
        'Parcel',
        'Post Office',
        1000,
        10
      )

      expect(mock.history[0].query).toEqual({
        countryCode: 'DE',
        addressLocality: 'Bonn',
        postalCode: '53113',
        streetAddress: 'Charles-de-Gaulle-Str. 20',
        providerType: 'parcel',
        locationType: 'postoffice',
        radius: 1000,
        limit: 10,
      })
    })

    it('maps every location type label to its API value', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).reply({ locations: [] })

      const expected = {
        'Service Point': 'servicepoint',
        'Post Office': 'postoffice',
        'Postbank': 'postbank',
        'Parcel Locker': 'locker',
        'PO Box': 'pobox',
        'Post Box': 'postbox',
      }

      for (const [label, apiValue] of Object.entries(expected)) {
        mock.reset()
        mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).reply({ locations: [] })

        await service.findLocationsByAddress('DE', undefined, undefined, undefined, undefined, label)

        expect(mock.history[0].query).toMatchObject({ locationType: apiValue })
      }
    })

    it('maps the Express provider label', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).reply({ locations: [] })

      await service.findLocationsByAddress('DE', undefined, undefined, undefined, 'Express')

      expect(mock.history[0].query).toMatchObject({ providerType: 'express' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-address`).replyWithError({
        message: 'Bad Request',
        body: { status: 400, title: 'Invalid', detail: 'countryCode required' },
      })

      await expect(service.findLocationsByAddress('DE')).rejects.toThrow(
        'DHL API error [400]: Invalid - countryCode required'
      )
    })
  })

  describe('findLocationsByGeo', () => {
    it('sends a GET to /location-finder/v1/find-by-geo with only lat/long', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-geo`).reply({ locations: [] })

      const result = await service.findLocationsByGeo(50.7160101, 7.1298043)

      expect(result).toEqual({ locations: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/location-finder/v1/find-by-geo`)
      expect(mock.history[0].query).toEqual({
        latitude: 50.7160101,
        longitude: 7.1298043,
      })
    })

    it('maps labels and includes all optional params', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-geo`).reply({ locations: [] })

      await service.findLocationsByGeo(50.716, 7.129, 'Express', 'Parcel Locker', 2000, 25)

      expect(mock.history[0].query).toEqual({
        latitude: 50.716,
        longitude: 7.129,
        providerType: 'express',
        locationType: 'locker',
        radius: 2000,
        limit: 25,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/find-by-geo`).replyWithError({
        message: 'Server Error',
        body: { status: 500, title: 'Internal', detail: 'Boom' },
      })

      await expect(service.findLocationsByGeo(50.716, 7.129)).rejects.toThrow(
        'DHL API error [500]: Internal - Boom'
      )
    })
  })

  describe('getLocationById', () => {
    it('sends a GET to the encoded location id endpoint', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/locations/8003-4008202`).reply({
        name: 'Postfiliale 502',
      })

      const result = await service.getLocationById('8003-4008202')

      expect(result).toEqual({ name: 'Postfiliale 502' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/location-finder/v1/locations/8003-4008202`)
    })

    it('url-encodes the location id', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/locations/8003%2F4008202`).reply({ name: 'X' })

      await service.getLocationById('8003/4008202')

      expect(mock.history[0].url).toBe(`${ BASE }/location-finder/v1/locations/8003%2F4008202`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/location-finder/v1/locations/missing`).replyWithError({
        message: 'Not Found',
        body: { status: 404, title: 'Not Found', detail: 'Unknown location' },
      })

      await expect(service.getLocationById('missing')).rejects.toThrow(
        'DHL API error [404]: Not Found - Unknown location'
      )
    })
  })
})
