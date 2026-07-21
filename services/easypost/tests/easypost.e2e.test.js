'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('EasyPost Service (e2e)', () => {
  let sandbox
  let service

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
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Static Dictionaries ──

  describe('getLabelFormatsDictionary', () => {
    it('returns label format items', () => {
      const result = service.getLabelFormatsDictionary()

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getContentsTypesDictionary', () => {
    it('returns contents type items', () => {
      const result = service.getContentsTypesDictionary()

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getRestrictionTypesDictionary', () => {
    it('returns restriction type items', () => {
      const result = service.getRestrictionTypesDictionary()

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getNonDeliveryOptionsDictionary', () => {
    it('returns non-delivery option items', () => {
      const result = service.getNonDeliveryOptionsDictionary()

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Schema Loaders ──

  describe('customsItemSchema', () => {
    it('returns schema fields', () => {
      const schema = service.customsItemSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema.length).toBeGreaterThan(0)
      expect(schema[0]).toHaveProperty('name')
      expect(schema[0]).toHaveProperty('type')
    })
  })

  describe('webhookCustomHeaderSchema', () => {
    it('returns schema fields', () => {
      const schema = service.webhookCustomHeaderSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema).toHaveLength(2)
    })
  })

  // ── Addresses ──

  describe('address lifecycle', () => {
    let addressId

    it('creates an address', async () => {
      const result = await service.createAddress(
        'E2E Test User', '417 Montgomery St', 'Floor 5', 'San Francisco', 'CA', '94104', 'US'
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^adr_/)
      addressId = result.id
    })

    it('retrieves the created address', async () => {
      const result = await service.getAddress(addressId)

      expect(result).toHaveProperty('id', addressId)
      expect(result).toHaveProperty('name')
    })

    it('verifies the address', async () => {
      const result = await service.verifyAddress(addressId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('verifications')
    })
  })

  describe('createAddress with verify flag', () => {
    it('creates and verifies in one step', async () => {
      const result = await service.createAddress(
        'E2E Verify Test', '417 Montgomery St', undefined, 'San Francisco', 'CA', '94104', 'US',
        undefined, undefined, undefined, true
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('verifications')
    })
  })

  describe('listAddresses', () => {
    it('returns a paginated list of addresses', async () => {
      const result = await service.listAddresses(5)

      expect(result).toHaveProperty('addresses')
      expect(Array.isArray(result.addresses)).toBe(true)
      expect(result).toHaveProperty('has_more')
    })
  })

  describe('getAddressesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAddressesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Parcels ──

  describe('parcel lifecycle', () => {
    let parcelId

    it('creates a parcel', async () => {
      const result = await service.createParcel(16, 10, 8, 4)

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^prcl_/)
      parcelId = result.id
    })

    it('retrieves the created parcel', async () => {
      const result = await service.getParcel(parcelId)

      expect(result).toHaveProperty('id', parcelId)
      expect(result).toHaveProperty('weight')
    })
  })

  // ── Customs ──

  describe('customs item lifecycle', () => {
    let customsItemId

    it('creates a customs item', async () => {
      const result = await service.createCustomsItem('E2E Test Item', 1, 5, 10, '123456', 'US')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^cstitem_/)
      customsItemId = result.id
    })

    it('retrieves the customs item', async () => {
      const result = await service.getCustomsItem(customsItemId)

      expect(result).toHaveProperty('id', customsItemId)
      expect(result).toHaveProperty('description')
    })
  })

  describe('customs info lifecycle', () => {
    let customsInfoId

    it('creates customs info with inline items', async () => {
      const items = [{
        description: 'E2E Test Product',
        quantity: 1,
        weight: 5,
        value: 10,
        hs_tariff_number: '123456',
        origin_country: 'US',
      }]

      const result = await service.createCustomsInfo(
        'merchandise', 'E2E Signer', true, 'NOEEI 30.37(a)', 'none', items
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^cstinfo_/)
      customsInfoId = result.id
    })

    it('retrieves the customs info', async () => {
      const result = await service.getCustomsInfo(customsInfoId)

      expect(result).toHaveProperty('id', customsInfoId)
      expect(result).toHaveProperty('customs_items')
    })
  })

  // ── Shipments ──

  describe('shipment lifecycle', () => {
    let shipmentId

    it('creates a shipment with inline addresses', async () => {
      const result = await service.createShipment(
        'E2E Sender', '417 Montgomery St', 'San Francisco', 'CA', '94104', 'US',
        'E2E Recipient', '123 Main St', 'New York', 'NY', '10001', 'US',
        16, 10, 8, 4
      )

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^shp_/)
      expect(result).toHaveProperty('rates')
      expect(Array.isArray(result.rates)).toBe(true)
      shipmentId = result.id
    })

    it('retrieves the created shipment', async () => {
      const result = await service.getShipment(shipmentId)

      expect(result).toHaveProperty('id', shipmentId)
      expect(result).toHaveProperty('to_address')
      expect(result).toHaveProperty('from_address')
    })

    it('gets shipment rates dictionary', async () => {
      const result = await service.getShipmentRatesDictionary({
        criteria: { shipmentId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listShipments', () => {
    it('returns a paginated list of shipments', async () => {
      const result = await service.listShipments(5)

      expect(result).toHaveProperty('shipments')
      expect(Array.isArray(result.shipments)).toBe(true)
      expect(result).toHaveProperty('has_more')
    })
  })

  describe('getShipmentsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getShipmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Trackers ──

  describe('tracker lifecycle', () => {
    let trackerId

    it('creates a tracker', async () => {
      const result = await service.createTracker('EZ1000000001', 'USPS')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^trk_/)
      expect(result).toHaveProperty('tracking_code')
      trackerId = result.id
    })

    it('retrieves the tracker', async () => {
      const result = await service.getTracker(trackerId)

      expect(result).toHaveProperty('id', trackerId)
      expect(result).toHaveProperty('status')
    })

    it('deletes the tracker', async () => {
      // EasyPost test mode may not support delete; wrap so it does not block other tests
      try {
        await service.deleteTracker(trackerId)
      } catch {
        // Some tracker IDs cannot be deleted in test mode - acceptable
      }
    })
  })

  describe('listTrackers', () => {
    it('returns a paginated list of trackers', async () => {
      const result = await service.listTrackers(5)

      expect(result).toHaveProperty('trackers')
      expect(Array.isArray(result.trackers)).toBe(true)
    })
  })

  describe('getTrackersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getTrackersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Batches ──

  describe('batch lifecycle', () => {
    let batchId

    it('creates a batch', async () => {
      const result = await service.createBatch('E2E Test Batch')

      expect(result).toHaveProperty('id')
      expect(result.id).toMatch(/^batch_/)
      batchId = result.id
    })

    it('retrieves the batch', async () => {
      const result = await service.getBatch(batchId)

      expect(result).toHaveProperty('id', batchId)
      expect(result).toHaveProperty('state')
    })
  })

  describe('listBatches', () => {
    it('returns a paginated list of batches', async () => {
      const result = await service.listBatches(5)

      expect(result).toHaveProperty('batches')
      expect(Array.isArray(result.batches)).toBe(true)
    })
  })

  describe('getBatchesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getBatchesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Webhooks ──

  describe('webhook lifecycle', () => {
    let webhookId

    it('creates a webhook', async () => {
      const result = await service.createWebhook('https://e2e-test.example.com/easypost-webhook')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('url', 'https://e2e-test.example.com/easypost-webhook')
      webhookId = result.id
    })

    it('retrieves the webhook', async () => {
      const result = await service.getWebhook(webhookId)

      expect(result).toHaveProperty('id', webhookId)
      expect(result).toHaveProperty('url')
    })

    it('updates the webhook', async () => {
      const result = await service.updateWebhook(webhookId, 'new-secret-123')

      expect(result).toHaveProperty('id', webhookId)
    })

    it('deletes the webhook', async () => {
      await service.deleteWebhook(webhookId)
      // If no error thrown, deletion succeeded
    })
  })

  describe('listWebhooks', () => {
    it('returns webhooks list', async () => {
      const result = await service.listWebhooks()

      expect(result).toHaveProperty('webhooks')
      expect(Array.isArray(result.webhooks)).toBe(true)
    })
  })

  describe('getWebhooksDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getWebhooksDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Carrier Accounts ──

  describe('getCarrierAccountsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCarrierAccountsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Polling Trigger ──

  describe('onTrackingUpdated', () => {
    it('initializes state on first poll', async () => {
      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'EZ1000000001', carrier: 'USPS' },
        state: null,
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toHaveProperty('lastStatus')
    })
  })
})
