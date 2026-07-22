'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Shippo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('shippo')
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

  // ── Static dictionaries & schema (no network) ──

  describe('static dictionaries', () => {
    it('returns every static option list', () => {
      expect(service.getDistanceUnitsDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getMassUnitsDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getLabelFileTypesDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getCarriersDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getCurrenciesDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getCountriesDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getContentsTypesDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getNonDeliveryOptionsDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getIncotermsDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getEELPFCsDictionary({}).items.length).toBeGreaterThan(0)
      expect(service.getOrderStatusesDictionary({}).items.length).toBeGreaterThan(0)
    })

    it('restricts service levels to a carrier', () => {
      const result = service.getServiceLevelsDictionary({ criteria: { carrier: 'usps' } })

      expect(result.items.every(item => item.note === 'usps')).toBe(true)
    })

    it('returns the address schema', async () => {
      const schema = await service.addressSchema()

      expect(schema.map(field => field.name)).toContain('street1')
    })
  })

  // ── API-backed dictionaries ──

  describe('api dictionaries', () => {
    it('lists carrier accounts as dictionary items', async () => {
      const result = await service.getCarrierAccountsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists the resource dictionaries', async () => {
      for (const method of [
        'getAddressesDictionary',
        'getParcelsDictionary',
        'getShipmentsDictionary',
        'getTransactionsDictionary',
        'getRefundsDictionary',
        'getManifestsDictionary',
        'getCustomsItemsDictionary',
        'getCustomsDeclarationsDictionary',
        'getOrdersDictionary',
        'getWebhooksDictionary',
      ]) {
        const result = await service[method]({})

        expect(Array.isArray(result.items)).toBe(true)
      }
    })

    it('lists service groups as dictionary items', async () => {
      const result = await service.getServiceGroupsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Read-only listings ──

  describe('listings', () => {
    it('lists the core Shippo resources', async () => {
      for (const method of [
        'listAddresses',
        'listParcels',
        'listShipments',
        'listTransactions',
        'listRefunds',
        'listManifests',
        'listCustomsItems',
        'listCustomsDeclarations',
      ]) {
        const result = await service[method](1, 5)

        expect(result).toHaveProperty('results')
        expect(Array.isArray(result.results)).toBe(true)
      }
    })

    it('lists carrier accounts', async () => {
      const result = await service.listCarrierAccounts(undefined, undefined, 1, 5)

      expect(result).toHaveProperty('results')
    })

    it('lists orders', async () => {
      const result = await service.listOrders(1, 5)

      expect(result).toHaveProperty('results')
    })

    it('lists webhooks and service groups', async () => {
      const webhooks = await service.listWebhooks()

      expect(webhooks).toBeDefined()

      const serviceGroups = await service.listServiceGroups()

      expect(serviceGroups).toBeDefined()
    })
  })

  // ── Address lifecycle ──

  describe('addresses', () => {
    let addressId

    it('creates an address', async () => {
      const result = await service.createAddress(
        `FlowRunner E2E ${ SUFFIX }`,
        'FlowRunner',
        '215 Clayton St.',
        undefined,
        undefined,
        'San Francisco',
        'CA',
        '94117',
        'US',
        '+15553419393',
        'e2e@example.com',
        false,
        false
      )

      expect(result).toHaveProperty('object_id')
      addressId = result.object_id
    })

    it('fetches the created address', async () => {
      const result = await service.getAddress(addressId)

      expect(result.object_id).toBe(addressId)
    })

    it('validates the created address', async () => {
      const result = await service.validateAddress(addressId)

      expect(result).toHaveProperty('object_id')
    })
  })

  // ── Parcel + shipment + rates ──

  describe('shipments and rates', () => {
    let parcelId
    let shipmentId
    let rateId

    it('creates a parcel', async () => {
      const result = await service.createParcel(10, 5, 2, 'in', 1.5, 'lb')

      expect(result).toHaveProperty('object_id')
      parcelId = result.object_id
    })

    it('fetches the created parcel', async () => {
      const result = await service.getParcel(parcelId)

      expect(result.object_id).toBe(parcelId)
    })

    it('creates a shipment and receives rates', async () => {
      const addressFrom = {
        name: 'FlowRunner Shipper',
        street1: '215 Clayton St.',
        city: 'San Francisco',
        state: 'CA',
        zip: '94117',
        country: 'US',
      }

      const addressTo = {
        name: 'FlowRunner Recipient',
        street1: '965 Mission St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94103',
        country: 'US',
      }

      const shipment = await service.createShipment(addressFrom, addressTo, parcelId)

      expect(shipment).toHaveProperty('object_id')
      shipmentId = shipment.object_id

      const fetched = await service.getShipment(shipmentId)

      expect(fetched.object_id).toBe(shipmentId)

      const rates = await service.getShipmentRates(shipmentId)

      expect(rates).toHaveProperty('results')

      rateId = (rates.results || [])[0]?.object_id
    })

    it('fetches a single rate', async () => {
      if (!rateId) {
        console.log('Skipping getRate: the shipment returned no rates')

        return
      }

      const result = await service.getRate(rateId)

      expect(result.object_id).toBe(rateId)
    })
  })

  // ── Tracking ──

  describe('tracking', () => {
    it('reads the tracking status of the Shippo test tracking number', async () => {
      const carrier = testValues.trackingCarrier || 'shippo'
      const trackingNumber = testValues.trackingNumber || 'SHIPPO_TRANSIT'

      const result = await service.getTrackingStatus(carrier, trackingNumber)

      expect(result).toHaveProperty('tracking_status')
    })

    it('registers a tracker for the test tracking number', async () => {
      const carrier = testValues.trackingCarrier || 'shippo'
      const trackingNumber = testValues.trackingNumber || 'SHIPPO_TRANSIT'

      const result = await service.createTracker(carrier, trackingNumber)

      expect(result).toHaveProperty('tracking_number')
    })

    it('seeds and then reports the polling trigger state', async () => {
      const carrier = testValues.trackingCarrier || 'shippo'
      const trackingNumber = testValues.trackingNumber || 'SHIPPO_TRANSIT'
      const triggerData = { carrier, trackingNumber }

      const seeded = await service.handleTriggerPollingForEvent({
        eventName: 'onTrackingUpdated',
        triggerData,
        state: {},
      })

      expect(seeded.events).toEqual([])
      expect(seeded.state).toHaveProperty('status')

      const second = await service.onTrackingUpdated({ triggerData, state: seeded.state })

      expect(second.events).toEqual([])

      const learning = await service.onTrackingUpdated({ triggerData, learningMode: true })

      expect(learning.events).toHaveLength(1)
      expect(learning.state).toBeNull()
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    let webhookId

    it('creates a test webhook', async () => {
      const result = await service.createWebhook(`https://example.com/flowrunner-e2e-${ SUFFIX }`, 'track_updated', true, true)

      expect(result).toHaveProperty('object_id')
      webhookId = result.object_id
    })

    it('fetches and updates the webhook', async () => {
      if (!webhookId) {
        console.log('Skipping getWebhook/updateWebhook: webhook was not created')

        return
      }

      const fetched = await service.getWebhook(webhookId)

      expect(fetched.object_id).toBe(webhookId)

      const updated = await service.updateWebhook(
        webhookId,
        `https://example.com/flowrunner-e2e-${ SUFFIX }-updated`,
        'track_updated',
        true,
        false
      )

      expect(updated).toHaveProperty('object_id')
    })

    it('deletes the webhook', async () => {
      if (!webhookId) {
        console.log('Skipping deleteWebhook: webhook was not created')

        return
      }

      const result = await service.deleteWebhook(webhookId)

      expect(result).toEqual({ object_id: webhookId, deleted: true })
    })
  })

  // ── Customs ──

  describe('customs', () => {
    let customsItemId

    it('creates a customs item', async () => {
      const result = await service.createCustomsItem('FlowRunner E2E T-Shirt', 1, '0.4', 'lb', '20', 'USD', 'US')

      expect(result).toHaveProperty('object_id')
      customsItemId = result.object_id
    })

    it('fetches the customs item', async () => {
      const result = await service.getCustomsItem(customsItemId)

      expect(result.object_id).toBe(customsItemId)
    })

    it('creates and fetches a customs declaration', async () => {
      const declaration = await service.createCustomsDeclaration(
        'MERCHANDISE',
        '',
        'RETURN',
        true,
        'FlowRunner E2E',
        [customsItemId],
        'DDP'
      )

      expect(declaration).toHaveProperty('object_id')

      const fetched = await service.getCustomsDeclaration(declaration.object_id)

      expect(fetched.object_id).toBe(declaration.object_id)
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('creates and fetches an order', async () => {
      const created = await service.createOrder(
        `FR-E2E-${ SUFFIX }`,
        'PAID',
        {
          name: 'FlowRunner Recipient',
          street1: '965 Mission St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94103',
          country: 'US',
        },
        undefined,
        [],
        new Date().toISOString(),
        '20.00',
        '1.50',
        'USD',
        '0.4',
        'lb'
      )

      expect(created).toHaveProperty('object_id')

      const fetched = await service.getOrder(created.object_id)

      expect(fetched.object_id).toBe(created.object_id)
    })
  })

  // ── Service groups ──

  describe('service groups', () => {
    it('creates and deletes a flat rate service group', async () => {
      const created = await service.createServiceGroup(
        `FlowRunner E2E ${ SUFFIX }`,
        'Created by the FlowRunner e2e suite',
        'Flat Rate',
        [],
        9.99,
        'USD'
      )

      expect(created).toHaveProperty('object_id')

      const deleted = await service.deleteServiceGroup(created.object_id)

      expect(deleted).toBe(created.object_id)
    })

    it('rejects a non-numeric rate adjustment', async () => {
      await expect(service.createServiceGroup('Bad', 'Bad', 'Live Rate', [], null, null, null, null, 'abc'))
        .rejects.toThrow('Rate Adjustment must be an integer percent (for example 5 or -10).')
    })
  })

  // ── Label purchase (opt-in) ──
  //
  // Buying a label costs money on a live token, so this only runs when the
  // developer opts in. With a shippo_test_ token it is free.

  describe('label purchase', () => {
    it('purchases a label, reads the transaction and refunds it when explicitly enabled', async () => {
      if (!testValues.purchaseLabel) {
        console.log('Skipping label purchase: testValues.purchaseLabel not set to true')

        return
      }

      const shipment = await service.createShipment(
        {
          name: 'FlowRunner Shipper',
          street1: '215 Clayton St.',
          city: 'San Francisco',
          state: 'CA',
          zip: '94117',
          country: 'US',
        },
        {
          name: 'FlowRunner Recipient',
          street1: '965 Mission St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94103',
          country: 'US',
        },
        { length: 10, width: 5, height: 2, distance_unit: 'in', weight: 1.5, mass_unit: 'lb' }
      )

      const rate = (shipment.rates || [])[0]

      if (!rate) {
        console.log('Skipping label purchase: the shipment returned no rates')

        return
      }

      const transaction = await service.createTransaction(rate.object_id, 'PDF_4x6')

      expect(transaction).toHaveProperty('object_id')

      const fetched = await service.getTransaction(transaction.object_id)

      expect(fetched.object_id).toBe(transaction.object_id)

      if (transaction.status === 'SUCCESS') {
        const refund = await service.createRefund(transaction.object_id)

        expect(refund).toHaveProperty('object_id')

        const fetchedRefund = await service.getRefund(refund.object_id)

        expect(fetchedRefund.object_id).toBe(refund.object_id)
      }
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown address', async () => {
      await expect(service.getAddress('does-not-exist')).rejects.toThrow(/Shippo API request failed/)
    })

    it('rejects an unknown polling event name', async () => {
      await expect(service.handleTriggerPollingForEvent({ eventName: 'nope' }))
        .rejects.toThrow('Unknown polling event "nope"')
    })
  })
})
