'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('DHL Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('dhl')
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

  // ── Tracking (requires the "Shipment Tracking - Unified" product) ──

  describe('trackShipment', () => {
    // A live tracking number is needed to get a populated result. Supply one via
    // testValues.trackingNumber (and optionally testValues.trackingService).
    it('tracks a shipment and returns a shipments array', async () => {
      if (!testValues.trackingNumber) {
        console.log('Skipping trackShipment: set testValues.trackingNumber')
        return
      }

      const response = await service.trackShipment(
        testValues.trackingNumber,
        testValues.trackingService
      )

      expect(response).toHaveProperty('shipments')
      expect(Array.isArray(response.shipments)).toBe(true)
    })
  })

  // ── Location Finder (requires the "Location Finder" product) ──

  describe('findLocationsByAddress', () => {
    it('finds locations near an address and returns a locations array', async () => {
      const countryCode = testValues.countryCode || 'DE'
      const addressLocality = testValues.addressLocality || 'Bonn'
      const postalCode = testValues.postalCode || '53113'

      const response = await service.findLocationsByAddress(
        countryCode,
        addressLocality,
        postalCode
      )

      expect(response).toHaveProperty('locations')
      expect(Array.isArray(response.locations)).toBe(true)
    })
  })

  describe('findLocationsByGeo', () => {
    it('finds locations near a geo coordinate and returns a locations array', async () => {
      const latitude = testValues.latitude !== undefined ? testValues.latitude : 50.7160101
      const longitude = testValues.longitude !== undefined ? testValues.longitude : 7.1298043

      const response = await service.findLocationsByGeo(latitude, longitude, undefined, undefined, undefined, 5)

      expect(response).toHaveProperty('locations')
      expect(Array.isArray(response.locations)).toBe(true)
    })
  })

  describe('getLocationById', () => {
    // Prefers a developer-supplied testValues.locationId; otherwise it derives one
    // from a geo search so the test can run unattended.
    it('retrieves a single location by id', async () => {
      let locationId = testValues.locationId

      if (!locationId) {
        const found = await service.findLocationsByGeo(50.7160101, 7.1298043, undefined, undefined, undefined, 5)
        const first = (found.locations || [])[0]
        const ids = first && first.location && first.location.ids

        locationId = Array.isArray(ids) && ids[0] ? ids[0].locationId : undefined
      }

      if (!locationId) {
        console.log('Skipping getLocationById: no locationId available (set testValues.locationId)')
        return
      }

      const response = await service.getLocationById(locationId)

      expect(response).toHaveProperty('location')
      expect(response).toHaveProperty('place')
    })
  })
})
