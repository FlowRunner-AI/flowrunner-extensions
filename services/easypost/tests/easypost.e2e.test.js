'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// These e2e tests are designed to run against an EasyPost TEST-MODE API key
// (starts with "EZTK..."). Test mode returns realistic objects and rates without
// spending money or generating real postage. Create/read flows create their own
// resources so no pre-existing IDs are required; optional testValues let you point
// tests at a known carrier account or tracking code.
describe('EasyPost Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('easypost')
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

  // ── Addresses ──

  describe('addresses', () => {
    let addressId

    it('creates an address', async () => {
      const result = await service.createAddress(
        'John Smith', '417 Montgomery Street', 'Floor 5', 'San Francisco', 'CA', '94104', 'US', 'EasyPost', '4155551234', 'john@example.com'
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^adr_/)
      addressId = result.id
    })

    it('retrieves the created address', async () => {
      const result = await service.getAddress(addressId)

      expect(result.id).toBe(addressId)
      expect(result).toHaveProperty('street1')
    })

    it('verifies the created address', async () => {
      const result = await service.verifyAddress(addressId)

      expect(result).toHaveProperty('verifications')
    })

    it('creates and verifies an address in one step', async () => {
      const result = await service.createAddress(
        'John Smith', '417 Montgomery Street', undefined, 'San Francisco', 'CA', '94104', 'US', undefined, undefined, undefined, true
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('verifications')
    })

    it('lists addresses', async () => {
      const result = await service.listAddresses(5)

      expect(result).toHaveProperty('addresses')
      expect(Array.isArray(result.addresses)).toBe(true)
    })

    it('lists addresses via the dictionary', async () => {
      const result = await service.getAddressesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Parcels ──

  describe('parcels', () => {
    let parcelId

    it('creates a parcel', async () => {
      const result = await service.createParcel(16, 10, 8, 4)

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^prcl_/)
      parcelId = result.id
    })

    it('retrieves the created parcel', async () => {
      const result = await service.getParcel(parcelId)

      expect(result.id).toBe(parcelId)
      expect(result.weight).toBeDefined()
    })
  })

  // ── Customs ──

  describe('customs', () => {
    let customsItemId
    let customsInfoId

    it('creates a customs item', async () => {
      const result = await service.createCustomsItem('T-shirt', 1, 5, 10, '123456', 'US')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^cstitem_/)
      customsItemId = result.id
    })

    it('retrieves the created customs item', async () => {
      const result = await service.getCustomsItem(customsItemId)

      expect(result.id).toBe(customsItemId)
    })

    it('creates a customs info declaration', async () => {
      const result = await service.createCustomsInfo(
        'merchandise', 'Steve Brule', true, 'NOEEI 30.37(a)', 'none',
        [{ description: 'T-shirt', quantity: 1, weight: 5, value: 10, hs_tariff_number: '123456', origin_country: 'US' }]
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^cstinfo_/)
      customsInfoId = result.id
    })

    it('retrieves the created customs info declaration', async () => {
      const result = await service.getCustomsInfo(customsInfoId)

      expect(result.id).toBe(customsInfoId)
    })
  })

  // ── Static Dictionaries ──

  describe('static dictionaries', () => {
    it('returns label formats', () => {
      expect(service.getLabelFormatsDictionary().items.length).toBeGreaterThan(0)
    })

    it('returns contents types', () => {
      expect(service.getContentsTypesDictionary().items.length).toBeGreaterThan(0)
    })

    it('returns restriction types', () => {
      expect(service.getRestrictionTypesDictionary().items.length).toBeGreaterThan(0)
    })

    it('returns non-delivery options', () => {
      expect(service.getNonDeliveryOptionsDictionary().items.length).toBeGreaterThan(0)
    })
  })

  // ── Carrier Accounts ──

  describe('carrier accounts', () => {
    it('lists carrier accounts via the dictionary', async () => {
      const result = await service.getCarrierAccountsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Shipments ──

  describe('shipments', () => {
    let shipmentId
    let rateId

    it('creates a shipment with rates', async () => {
      const result = await service.createShipment(
        'John Smith', '417 Montgomery Street', 'San Francisco', 'CA', '94104', 'US',
        'Dr. Steve Brule', '179 N Harbor Dr', 'Redondo Beach', 'CA', '90277', 'US',
        16, 10, 8, 4
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^shp_/)
      expect(Array.isArray(result.rates)).toBe(true)
      shipmentId = result.id
      rateId = result.rates && result.rates.length ? result.rates[0].id : undefined
    })

    it('retrieves the created shipment', async () => {
      const result = await service.getShipment(shipmentId)

      expect(result.id).toBe(shipmentId)
    })

    it('lists rates for the shipment via the dictionary', async () => {
      const result = await service.getShipmentRatesDictionary({ criteria: { shipmentId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists shipments', async () => {
      const result = await service.listShipments(5)

      expect(result).toHaveProperty('shipments')
      expect(Array.isArray(result.shipments)).toBe(true)
    })

    it('lists shipments via the dictionary', async () => {
      const result = await service.getShipmentsDictionary({})

      expect(result).toHaveProperty('items')
    })

    it('buys the shipment at the first rate', async () => {
      if (!rateId) {
        console.log('No rate available to buy - skipping buyShipment')
        return
      }

      const result = await service.buyShipment(shipmentId, rateId)

      expect(result.id).toBe(shipmentId)
      expect(result).toHaveProperty('postage_label')
    })

    it('converts the purchased label to PDF', async () => {
      const result = await service.convertLabelFormat(shipmentId, 'PDF')

      expect(result.id).toBe(shipmentId)
    })

    it('refunds the purchased shipment', async () => {
      const result = await service.refundShipment(shipmentId)

      expect(result.id).toBe(shipmentId)
    })
  })

  // ── Create and Buy in one step ──

  describe('createAndBuyShipment', () => {
    it('creates and buys a shipment when a carrier account is provided', async () => {
      if (!testValues.carrierAccountId) {
        console.log('No carrierAccountId testValue - skipping createAndBuyShipment')
        return
      }

      const result = await service.createAndBuyShipment(
        'John Smith', '417 Montgomery Street', 'San Francisco', 'CA', '94104', 'US',
        'Dr. Steve Brule', '179 N Harbor Dr', 'Redondo Beach', 'CA', '90277', 'US',
        16, 10, 8, 4,
        testValues.service || 'First', testValues.carrierAccountId
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('tracking_code')
    })
  })

  // ── Trackers ──

  describe('trackers', () => {
    let trackerId

    it('creates a tracker', async () => {
      const result = await service.createTracker('EZ1000000001', 'USPS')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^trk_/)
      trackerId = result.id
    })

    it('retrieves the created tracker', async () => {
      const result = await service.getTracker(trackerId)

      expect(result.id).toBe(trackerId)
    })

    it('lists trackers', async () => {
      const result = await service.listTrackers(5)

      expect(result).toHaveProperty('trackers')
      expect(Array.isArray(result.trackers)).toBe(true)
    })

    it('lists trackers via the dictionary', async () => {
      const result = await service.getTrackersDictionary({})

      expect(result).toHaveProperty('items')
    })

    it('deletes the created tracker', async () => {
      await expect(service.deleteTracker(trackerId)).resolves.toBeDefined()
    })
  })

  // ── Polling Trigger ──

  describe('onTrackingUpdated', () => {
    it('returns a sample tracker in learning mode', async () => {
      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'EZ2000000002', carrier: 'USPS' },
        learningMode: true,
      })

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
    })
  })

  // ── Batches ──

  describe('batches', () => {
    let batchId

    it('creates a batch', async () => {
      const result = await service.createBatch('E2E Test Batch')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^batch_/)
      batchId = result.id
    })

    it('retrieves the created batch', async () => {
      const result = await service.getBatch(batchId)

      expect(result.id).toBe(batchId)
    })

    it('lists batches', async () => {
      const result = await service.listBatches(5)

      expect(result).toHaveProperty('batches')
      expect(Array.isArray(result.batches)).toBe(true)
    })

    it('lists batches via the dictionary', async () => {
      const result = await service.getBatchesDictionary({})

      expect(result).toHaveProperty('items')
    })
  })

  // ── Insurance ──

  describe('insurance', () => {
    let insuranceId

    it('creates an insurance policy', async () => {
      const result = await service.createInsurance('EZ1000000001', 'USPS', '100.00')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^ins_/)
      insuranceId = result.id
    })

    it('retrieves the created insurance policy', async () => {
      const result = await service.getInsurance(insuranceId)

      expect(result.id).toBe(insuranceId)
    })

    it('lists insurances via the dictionary', async () => {
      const result = await service.getInsurancesDictionary({})

      expect(result).toHaveProperty('items')
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    let webhookId

    it('creates a webhook', async () => {
      const result = await service.createWebhook(`https://example.com/easypost-e2e-${ Date.now() }`)

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^hook_/)
      webhookId = result.id
    })

    it('retrieves the created webhook', async () => {
      const result = await service.getWebhook(webhookId)

      expect(result.id).toBe(webhookId)
    })

    it('updates the webhook custom headers', async () => {
      const result = await service.updateWebhook(webhookId, undefined, [{ name: 'X-E2E', value: 'test' }])

      expect(result.id).toBe(webhookId)
    })

    it('lists webhooks', async () => {
      const result = await service.listWebhooks()

      expect(result).toHaveProperty('webhooks')
    })

    it('lists webhooks via the dictionary', async () => {
      const result = await service.getWebhooksDictionary({})

      expect(result).toHaveProperty('items')
    })

    it('deletes the created webhook', async () => {
      await expect(service.deleteWebhook(webhookId)).resolves.toBeDefined()
    })
  })
})
