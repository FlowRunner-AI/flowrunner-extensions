'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-easypost-api-key'
const AUTH = Buffer.from(API_KEY + ':').toString('base64')
const BASE = 'https://api.easypost.com/v2'

describe('EasyPost Service', () => {
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
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionary Methods (static) ──

  describe('getLabelFormatsDictionary', () => {
    it('returns static label formats', () => {
      const result = service.getLabelFormatsDictionary()

      expect(result.items).toHaveLength(4)
      expect(result.items[0]).toEqual({ label: 'PNG', value: 'PNG', note: 'Portable Network Graphics image format' })
    })
  })

  describe('getContentsTypesDictionary', () => {
    it('returns static contents types', () => {
      const result = service.getContentsTypesDictionary()

      expect(result.items).toHaveLength(8)
      expect(result.items[0]).toMatchObject({ value: 'documents' })
    })
  })

  describe('getRestrictionTypesDictionary', () => {
    it('returns static restriction types', () => {
      const result = service.getRestrictionTypesDictionary()

      expect(result.items).toHaveLength(4)
      expect(result.items[0]).toMatchObject({ value: 'none' })
    })
  })

  describe('getNonDeliveryOptionsDictionary', () => {
    it('returns static non-delivery options', () => {
      const result = service.getNonDeliveryOptionsDictionary()

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ value: 'return' })
    })
  })

  // ── Dictionary Methods (API-backed) ──

  describe('getAddressesDictionary', () => {
    it('fetches addresses and maps items', async () => {
      mock.onGet(`${BASE}/addresses`).reply({
        addresses: [
          { id: 'adr_1', name: 'John', street1: '123 Main', city: 'NYC', state: 'NY' },
        ],
      })

      const result = await service.getAddressesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'adr_1', note: 'ID: adr_1' })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Basic ${AUTH}` })
      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })

    it('passes cursor as before_id', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [] })

      await service.getAddressesDictionary({ cursor: 'adr_prev' })

      expect(mock.history[0].query).toMatchObject({ before_id: 'adr_prev' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/addresses`).reply({
        addresses: [
          { id: 'adr_1', name: 'John', street1: '123 Main', city: 'NYC', state: 'NY' },
          { id: 'adr_2', name: 'Jane', street1: '456 Oak', city: 'LA', state: 'CA' },
        ],
      })

      const result = await service.getAddressesDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('adr_2')
    })

    it('returns cursor when page is full (20 items)', async () => {
      const addresses = Array.from({ length: 20 }, (_, i) => ({
        id: `adr_${i}`, name: `Name ${i}`, street1: 'St', city: 'C', state: 'S',
      }))
      mock.onGet(`${BASE}/addresses`).reply({ addresses })

      const result = await service.getAddressesDictionary({})

      expect(result.cursor).toBe('adr_19')
    })

    it('returns null cursor when page is not full', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [{ id: 'adr_1', name: 'A', street1: '', city: '', state: '' }] })

      const result = await service.getAddressesDictionary({})

      expect(result.cursor).toBeNull()
    })
  })

  describe('getCarrierAccountsDictionary', () => {
    it('fetches carrier accounts and maps items', async () => {
      mock.onGet(`${BASE}/carrier_accounts`).reply({
        carrier_accounts: [
          { id: 'ca_1', type: 'UPS', description: 'Primary' },
        ],
      })

      const result = await service.getCarrierAccountsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'UPS - Primary', value: 'ca_1' })
      expect(result.cursor).toBeNull()
    })

    it('handles array response format', async () => {
      mock.onGet(`${BASE}/carrier_accounts`).reply([
        { id: 'ca_1', type: 'FedEx' },
      ])

      const result = await service.getCarrierAccountsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'FedEx', value: 'ca_1' })
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/carrier_accounts`).reply({
        carrier_accounts: [
          { id: 'ca_1', type: 'UPS' },
          { id: 'ca_2', type: 'FedEx' },
        ],
      })

      const result = await service.getCarrierAccountsDictionary({ search: 'ups' })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getShipmentsDictionary', () => {
    it('fetches shipments and maps items', async () => {
      mock.onGet(`${BASE}/shipments`).reply({
        shipments: [
          { id: 'shp_1', to_address: { name: 'Jane', city: 'LA', state: 'CA', zip: '90001' }, status: 'delivered' },
        ],
      })

      const result = await service.getShipmentsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: 'shp_1', note: 'delivered' })
    })
  })

  describe('getBatchesDictionary', () => {
    it('fetches batches and maps items', async () => {
      mock.onGet(`${BASE}/batches`).reply({
        batches: [{ id: 'batch_1', reference: 'Holiday', state: 'created' }],
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'Holiday', value: 'batch_1', note: 'created' })
    })

    it('uses batch id when reference is missing', async () => {
      mock.onGet(`${BASE}/batches`).reply({
        batches: [{ id: 'batch_1', state: 'created' }],
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items[0].label).toBe('batch_1')
    })
  })

  describe('getShipmentRatesDictionary', () => {
    it('returns empty items when no shipmentId in criteria', async () => {
      const result = await service.getShipmentRatesDictionary({})

      expect(result.items).toEqual([])
      expect(mock.history).toHaveLength(0)
    })

    it('fetches rates for a shipment', async () => {
      mock.onGet(`${BASE}/shipments/shp_1`).reply({
        rates: [
          { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '7.58', delivery_days: 2 },
        ],
      })

      const result = await service.getShipmentRatesDictionary({ criteria: { shipmentId: 'shp_1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: 'USPS Priority @ $7.58',
        value: 'rate_1',
        note: 'delivery_days: 2',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters rates by search', async () => {
      mock.onGet(`${BASE}/shipments/shp_1`).reply({
        rates: [
          { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '7.58', delivery_days: 2 },
          { id: 'rate_2', carrier: 'UPS', service: 'Ground', rate: '12.00', delivery_days: 5 },
        ],
      })

      const result = await service.getShipmentRatesDictionary({ search: 'ups g', criteria: { shipmentId: 'shp_1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('rate_2')
    })
  })

  describe('getTrackersDictionary', () => {
    it('fetches trackers and maps items', async () => {
      mock.onGet(`${BASE}/trackers`).reply({
        trackers: [{ id: 'trk_1', tracking_code: 'TRACK123', carrier: 'USPS', status: 'in_transit' }],
      })

      const result = await service.getTrackersDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'TRACK123 (USPS)', value: 'trk_1', note: 'in_transit' })
    })
  })

  describe('getPickupsDictionary', () => {
    it('fetches pickups and maps items', async () => {
      mock.onGet(`${BASE}/pickups`).reply({
        pickups: [{ id: 'pickup_1', reference: 'My Pickup', status: 'scheduled' }],
      })

      const result = await service.getPickupsDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'My Pickup', value: 'pickup_1', note: 'scheduled' })
    })

    it('uses id when reference is missing', async () => {
      mock.onGet(`${BASE}/pickups`).reply({
        pickups: [{ id: 'pickup_1', status: 'unknown' }],
      })

      const result = await service.getPickupsDictionary({})

      expect(result.items[0].label).toBe('Pickup pickup_1')
    })
  })

  describe('getInsurancesDictionary', () => {
    it('fetches insurances and maps items', async () => {
      mock.onGet(`${BASE}/insurances`).reply({
        insurances: [{ id: 'ins_1', tracking_code: 'TRACK1', amount: '100.00', status: 'purchased' }],
      })

      const result = await service.getInsurancesDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'TRACK1 - $100.00', value: 'ins_1', note: 'purchased' })
    })
  })

  describe('getWebhooksDictionary', () => {
    it('fetches webhooks and maps items', async () => {
      mock.onGet(`${BASE}/webhooks`).reply({
        webhooks: [{ id: 'hook_1', url: 'https://example.com', disabled_at: null }],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'https://example.com', value: 'hook_1', note: 'active' })
    })

    it('marks disabled webhooks', async () => {
      mock.onGet(`${BASE}/webhooks`).reply({
        webhooks: [{ id: 'hook_1', url: 'https://example.com', disabled_at: '2025-01-01' }],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items[0].note).toBe('disabled')
    })
  })

  // ── Schema Loaders ──

  describe('customsItemSchema', () => {
    it('returns schema array with required fields', () => {
      const schema = service.customsItemSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema.length).toBeGreaterThan(5)
      expect(schema[0]).toMatchObject({ name: 'description', required: true })
    })
  })

  describe('webhookCustomHeaderSchema', () => {
    it('returns schema array with name and value', () => {
      const schema = service.webhookCustomHeaderSchema()

      expect(schema).toHaveLength(2)
      expect(schema[0]).toMatchObject({ name: 'name', required: true })
      expect(schema[1]).toMatchObject({ name: 'value', required: true })
    })
  })

  // ── Actions: Addresses ──

  describe('createAddress', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/addresses`).reply({ id: 'adr_1', name: 'John' })

      const result = await service.createAddress('John', '123 Main', undefined, 'NYC', 'NY', '10001')

      expect(result).toMatchObject({ id: 'adr_1' })
      expect(mock.history[0].body).toEqual({
        address: {
          name: 'John', street1: '123 Main', city: 'NYC', state: 'NY', zip: '10001', country: 'US',
        },
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/addresses`).reply({ id: 'adr_1' })

      await service.createAddress('John', '123 Main', 'Suite 5', 'NYC', 'NY', '10001', 'CA', 'Acme', '555-1234', 'j@e.com')

      expect(mock.history[0].body.address).toMatchObject({
        street2: 'Suite 5', country: 'CA', company: 'Acme', phone: '555-1234', email: 'j@e.com',
      })
    })

    it('uses create_and_verify endpoint when verify is true', async () => {
      mock.onPost(`${BASE}/addresses/create_and_verify`).reply({ address: { id: 'adr_1', verifications: {} } })

      const result = await service.createAddress('John', '123 Main', undefined, 'NYC', 'NY', '10001', undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].url).toBe(`${BASE}/addresses/create_and_verify`)
      expect(result).toMatchObject({ id: 'adr_1' })
    })
  })

  describe('getAddress', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/addresses/adr_1`).reply({ id: 'adr_1', name: 'John' })

      const result = await service.getAddress('adr_1')

      expect(result).toMatchObject({ id: 'adr_1' })
    })
  })

  describe('verifyAddress', () => {
    it('sends GET and unwraps address', async () => {
      mock.onGet(`${BASE}/addresses/adr_1/verify`).reply({ address: { id: 'adr_1', verifications: { delivery: { success: true } } } })

      const result = await service.verifyAddress('adr_1')

      expect(result).toMatchObject({ id: 'adr_1' })
    })
  })

  describe('listAddresses', () => {
    it('sends GET with default page size', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [], has_more: false })

      await service.listAddresses()

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })

    it('passes custom pagination params', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [], has_more: false })

      await service.listAddresses(10, 'adr_before', 'adr_after')

      expect(mock.history[0].query).toMatchObject({ page_size: 10, before_id: 'adr_before', after_id: 'adr_after' })
    })
  })

  // ── Actions: Parcels ──

  describe('createParcel', () => {
    it('sends POST with parcel data', async () => {
      mock.onPost(`${BASE}/parcels`).reply({ id: 'prcl_1', weight: 16 })

      const result = await service.createParcel(16, 10, 8, 4)

      expect(result).toMatchObject({ id: 'prcl_1' })
      expect(mock.history[0].body).toEqual({
        parcel: { weight: 16, length: 10, width: 8, height: 4 },
      })
    })

    it('includes predefined package when provided', async () => {
      mock.onPost(`${BASE}/parcels`).reply({ id: 'prcl_1' })

      await service.createParcel(16, undefined, undefined, undefined, 'FlatRateEnvelope')

      expect(mock.history[0].body.parcel).toMatchObject({ predefined_package: 'FlatRateEnvelope' })
    })
  })

  describe('getParcel', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/parcels/prcl_1`).reply({ id: 'prcl_1', weight: 16 })

      const result = await service.getParcel('prcl_1')

      expect(result).toMatchObject({ id: 'prcl_1' })
    })
  })

  // ── Actions: Customs ──

  describe('createCustomsInfo', () => {
    const items = [{ description: 'T-shirt', quantity: 1, weight: 5, value: 10, hs_tariff_number: '123456', origin_country: 'US' }]

    it('sends POST with customs data', async () => {
      mock.onPost(`${BASE}/customs_infos`).reply({ id: 'cstinfo_1' })

      await service.createCustomsInfo('merchandise', 'Steve', true, 'NOEEI 30.37(a)', 'none', items)

      const body = mock.history[0].body
      expect(body.customs_info.contents_type).toBe('merchandise')
      expect(body.customs_info.customs_signer).toBe('Steve')
      expect(body.customs_info.customs_certify).toBe(true)
      expect(body.customs_info.customs_items).toEqual(items)
    })

    it('throws when customsItems is empty', async () => {
      await expect(service.createCustomsInfo('merchandise', 'Steve', true, 'code', 'none', []))
        .rejects.toThrow('At least one customs item is required.')
    })

    it('throws when customsItems is not an array', async () => {
      await expect(service.createCustomsInfo('merchandise', 'Steve', true, 'code', 'none', null))
        .rejects.toThrow('At least one customs item is required.')
    })

    it('preserves customs_certify as false', async () => {
      mock.onPost(`${BASE}/customs_infos`).reply({ id: 'cstinfo_1' })

      await service.createCustomsInfo('merchandise', 'Steve', false, 'NOEEI 30.37(a)', 'none', items)

      expect(mock.history[0].body.customs_info.customs_certify).toBe(false)
    })
  })

  describe('getCustomsInfo', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/customs_infos/cstinfo_1`).reply({ id: 'cstinfo_1' })

      const result = await service.getCustomsInfo('cstinfo_1')

      expect(result).toMatchObject({ id: 'cstinfo_1' })
    })
  })

  describe('createCustomsItem', () => {
    it('sends POST with item data', async () => {
      mock.onPost(`${BASE}/customs_items`).reply({ id: 'cstitem_1' })

      await service.createCustomsItem('T-shirt', 1, 5, 10, '123456', 'US')

      expect(mock.history[0].body).toEqual({
        customs_item: {
          description: 'T-shirt', quantity: 1, weight: 5, value: 10,
          hs_tariff_number: '123456', origin_country: 'US',
        },
      })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${BASE}/customs_items`).reply({ id: 'cstitem_1' })

      await service.createCustomsItem('T-shirt', 1, 5, 10, '123456', 'US', 'USD', 'Acme', 'SKU1', 'ECC1', 'CID1')

      expect(mock.history[0].body.customs_item).toMatchObject({
        currency: 'USD', manufacturer: 'Acme', code: 'SKU1', eccn: 'ECC1', printed_commodity_identifier: 'CID1',
      })
    })
  })

  describe('getCustomsItem', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/customs_items/cstitem_1`).reply({ id: 'cstitem_1' })

      const result = await service.getCustomsItem('cstitem_1')

      expect(result).toMatchObject({ id: 'cstitem_1' })
    })
  })

  // ── Actions: Shipments ──

  describe('createShipment', () => {
    it('sends POST with inline addresses and parcel', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1', rates: [] })

      await service.createShipment(
        'John', '123 Main', 'NYC', 'NY', '10001', undefined,
        'Jane', '456 Oak', 'LA', 'CA', '90001', undefined,
        16, 10, 8, 4
      )

      const body = mock.history[0].body.shipment
      expect(body.from_address).toMatchObject({ name: 'John', street1: '123 Main', country: 'US' })
      expect(body.to_address).toMatchObject({ name: 'Jane', street1: '456 Oak', country: 'US' })
      expect(body.parcel).toMatchObject({ weight: 16 })
    })

    it('includes optional label format, carrier account, and customs info', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1' })

      await service.createShipment(
        'John', '123 Main', 'NYC', 'NY', '10001', 'US',
        'Jane', '456 Oak', 'LA', 'CA', '90001', 'US',
        16, 10, 8, 4, undefined, 'PDF', 'ca_1', 'cstinfo_1'
      )

      const body = mock.history[0].body.shipment
      expect(body.options).toEqual({ label_format: 'PDF' })
      expect(body.carrier_accounts).toEqual(['ca_1'])
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
    })
  })

  describe('createShipmentFromSaved', () => {
    it('sends POST with address and parcel IDs', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1' })

      await service.createShipmentFromSaved('adr_from', 'adr_to', 'prcl_1')

      const body = mock.history[0].body.shipment
      expect(body.from_address).toEqual({ id: 'adr_from' })
      expect(body.to_address).toEqual({ id: 'adr_to' })
      expect(body.parcel).toEqual({ id: 'prcl_1' })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1' })

      await service.createShipmentFromSaved('adr_from', 'adr_to', 'prcl_1', 'PDF', 'ca_1', 'cstinfo_1')

      const body = mock.history[0].body.shipment
      expect(body.options).toEqual({ label_format: 'PDF' })
      expect(body.carrier_accounts).toEqual(['ca_1'])
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
    })
  })

  describe('createAndBuyShipment', () => {
    it('sends POST with service and carrier account', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1', tracking_code: 'TRACK1' })

      await service.createAndBuyShipment(
        'John', '123 Main', 'NYC', 'NY', '10001', undefined,
        'Jane', '456 Oak', 'LA', 'CA', '90001', undefined,
        16, 10, 8, 4, 'Priority', 'ca_1'
      )

      const body = mock.history[0].body.shipment
      expect(body.service).toBe('Priority')
      expect(body.carrier_accounts).toEqual(['ca_1'])
    })

    it('includes customs info and label format', async () => {
      mock.onPost(`${BASE}/shipments`).reply({ id: 'shp_1' })

      await service.createAndBuyShipment(
        'John', '123 Main', 'NYC', 'NY', '10001', undefined,
        'Jane', '456 Oak', 'LA', 'CA', '90001', undefined,
        16, undefined, undefined, undefined, 'Priority', 'ca_1', 'cstinfo_1', 'PDF'
      )

      const body = mock.history[0].body.shipment
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
      expect(body.options).toEqual({ label_format: 'PDF' })
    })
  })

  describe('getShipment', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/shipments/shp_1`).reply({ id: 'shp_1', status: 'delivered' })

      const result = await service.getShipment('shp_1')

      expect(result).toMatchObject({ id: 'shp_1', status: 'delivered' })
    })
  })

  describe('listShipments', () => {
    it('sends GET with default page size', async () => {
      mock.onGet(`${BASE}/shipments`).reply({ shipments: [], has_more: false })

      await service.listShipments()

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })

    it('passes pagination params', async () => {
      mock.onGet(`${BASE}/shipments`).reply({ shipments: [], has_more: false })

      await service.listShipments(5, 'shp_before', 'shp_after')

      expect(mock.history[0].query).toMatchObject({ page_size: 5, before_id: 'shp_before', after_id: 'shp_after' })
    })
  })

  describe('buyShipment', () => {
    it('sends POST with rate ID', async () => {
      mock.onPost(`${BASE}/shipments/shp_1/buy`).reply({ id: 'shp_1', tracking_code: 'TRACK1' })

      await service.buyShipment('shp_1', 'rate_1')

      expect(mock.history[0].body).toEqual({ rate: { id: 'rate_1' } })
    })

    it('includes insurance when provided', async () => {
      mock.onPost(`${BASE}/shipments/shp_1/buy`).reply({ id: 'shp_1' })

      await service.buyShipment('shp_1', 'rate_1', '100.00')

      expect(mock.history[0].body).toEqual({ rate: { id: 'rate_1' }, insurance: '100.00' })
    })
  })

  describe('convertLabelFormat', () => {
    it('sends GET with file_format query', async () => {
      mock.onGet(`${BASE}/shipments/shp_1/label`).reply({ id: 'shp_1', postage_label: {} })

      await service.convertLabelFormat('shp_1', 'PDF')

      expect(mock.history[0].query).toMatchObject({ file_format: 'PDF' })
    })
  })

  describe('refundShipment', () => {
    it('sends POST to refund endpoint', async () => {
      mock.onPost(`${BASE}/shipments/shp_1/refund`).reply({ id: 'shp_1', refund_status: 'submitted' })

      const result = await service.refundShipment('shp_1')

      expect(result).toMatchObject({ refund_status: 'submitted' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Actions: Tracking ──

  describe('createTracker', () => {
    it('sends POST with tracking code and carrier', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', tracking_code: 'TRACK1', carrier: 'USPS' })

      await service.createTracker('TRACK1', 'USPS')

      expect(mock.history[0].body).toEqual({ tracker: { tracking_code: 'TRACK1', carrier: 'USPS' } })
    })
  })

  describe('getTracker', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/trackers/trk_1`).reply({ id: 'trk_1' })

      const result = await service.getTracker('trk_1')

      expect(result).toMatchObject({ id: 'trk_1' })
    })
  })

  describe('listTrackers', () => {
    it('sends GET with default page size', async () => {
      mock.onGet(`${BASE}/trackers`).reply({ trackers: [], has_more: false })

      await service.listTrackers()

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })

    it('passes filter params', async () => {
      mock.onGet(`${BASE}/trackers`).reply({ trackers: [], has_more: false })

      await service.listTrackers(10, undefined, undefined, 'TRACK1', 'USPS')

      expect(mock.history[0].query).toMatchObject({ page_size: 10, tracking_code: 'TRACK1', carrier: 'USPS' })
    })
  })

  describe('deleteTracker', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/trackers/trk_1`).reply({ success: true })

      const result = await service.deleteTracker('trk_1')

      expect(result).toMatchObject({ success: true })
    })
  })

  // ── Actions: Batches ──

  describe('createBatch', () => {
    it('sends POST with reference', async () => {
      mock.onPost(`${BASE}/batches`).reply({ id: 'batch_1', state: 'created' })

      await service.createBatch('Holiday')

      expect(mock.history[0].body).toEqual({ batch: { reference: 'Holiday' } })
    })

    it('includes shipment IDs when provided', async () => {
      mock.onPost(`${BASE}/batches`).reply({ id: 'batch_1' })

      await service.createBatch('Holiday', 'shp_1,shp_2')

      expect(mock.history[0].body.batch.shipments).toEqual([{ id: 'shp_1' }, { id: 'shp_2' }])
    })

    it('accepts array of shipment IDs', async () => {
      mock.onPost(`${BASE}/batches`).reply({ id: 'batch_1' })

      await service.createBatch(undefined, ['shp_1', 'shp_2'])

      expect(mock.history[0].body.batch.shipments).toEqual([{ id: 'shp_1' }, { id: 'shp_2' }])
    })
  })

  describe('getBatch', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/batches/batch_1`).reply({ id: 'batch_1' })

      const result = await service.getBatch('batch_1')

      expect(result).toMatchObject({ id: 'batch_1' })
    })
  })

  describe('listBatches', () => {
    it('sends GET with default page size', async () => {
      mock.onGet(`${BASE}/batches`).reply({ batches: [], has_more: false })

      await service.listBatches()

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })
  })

  describe('addShipmentsToBatch', () => {
    it('sends POST with shipment IDs', async () => {
      mock.onPost(`${BASE}/batches/batch_1/add_shipments`).reply({ id: 'batch_1' })

      await service.addShipmentsToBatch('batch_1', ['shp_1', 'shp_2'])

      expect(mock.history[0].body).toEqual({ shipments: [{ id: 'shp_1' }, { id: 'shp_2' }] })
    })

    it('throws when no shipment IDs provided', async () => {
      await expect(service.addShipmentsToBatch('batch_1', ''))
        .rejects.toThrow('At least one shipment ID is required.')
    })
  })

  describe('removeShipmentsFromBatch', () => {
    it('sends POST with shipment IDs', async () => {
      mock.onPost(`${BASE}/batches/batch_1/remove_shipments`).reply({ id: 'batch_1' })

      await service.removeShipmentsFromBatch('batch_1', 'shp_1')

      expect(mock.history[0].body).toEqual({ shipments: [{ id: 'shp_1' }] })
    })

    it('throws when no shipment IDs provided', async () => {
      await expect(service.removeShipmentsFromBatch('batch_1', []))
        .rejects.toThrow('At least one shipment ID is required.')
    })
  })

  describe('buyBatch', () => {
    it('sends POST to buy endpoint', async () => {
      mock.onPost(`${BASE}/batches/batch_1/buy`).reply({ id: 'batch_1', state: 'purchasing' })

      const result = await service.buyBatch('batch_1')

      expect(result).toMatchObject({ state: 'purchasing' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('generateBatchLabel', () => {
    it('sends POST with file format', async () => {
      mock.onPost(`${BASE}/batches/batch_1/label`).reply({ id: 'batch_1', state: 'label_generating' })

      await service.generateBatchLabel('batch_1', 'PDF')

      expect(mock.history[0].body).toEqual({ file_format: 'PDF' })
    })
  })

  // ── Actions: Pickups ──

  describe('createPickup', () => {
    it('sends POST with pickup data', async () => {
      mock.onPost(`${BASE}/pickups`).reply({ id: 'pickup_1' })

      await service.createPickup('shp_1', 'adr_1', '2025-01-20T09:00:00Z', '2025-01-20T17:00:00Z', 'Ring doorbell')

      const body = mock.history[0].body.pickup
      expect(body.shipment).toEqual({ id: 'shp_1' })
      expect(body.address).toEqual({ id: 'adr_1' })
      expect(body.min_datetime).toBe('2025-01-20T09:00:00Z')
      expect(body.instructions).toBe('Ring doorbell')
    })
  })

  describe('getPickup', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/pickups/pickup_1`).reply({ id: 'pickup_1' })

      const result = await service.getPickup('pickup_1')

      expect(result).toMatchObject({ id: 'pickup_1' })
    })
  })

  describe('buyPickup', () => {
    it('sends POST with carrier and service', async () => {
      mock.onPost(`${BASE}/pickups/pickup_1/buy`).reply({ id: 'pickup_1', status: 'scheduled' })

      await service.buyPickup('pickup_1', 'USPS', 'NextDay')

      expect(mock.history[0].body).toEqual({ carrier: 'USPS', service: 'NextDay' })
    })
  })

  describe('cancelPickup', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${BASE}/pickups/pickup_1/cancel`).reply({ id: 'pickup_1', status: 'canceled' })

      const result = await service.cancelPickup('pickup_1')

      expect(result).toMatchObject({ status: 'canceled' })
    })
  })

  // ── Actions: Insurance ──

  describe('createInsurance', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/insurances`).reply({ id: 'ins_1' })

      await service.createInsurance('TRACK1', 'USPS', '100.00')

      expect(mock.history[0].body).toEqual({
        insurance: { tracking_code: 'TRACK1', carrier: 'USPS', amount: '100.00' },
      })
    })

    it('includes address IDs and reference when provided', async () => {
      mock.onPost(`${BASE}/insurances`).reply({ id: 'ins_1' })

      await service.createInsurance('TRACK1', 'USPS', '100.00', 'adr_to', 'adr_from', 'ORDER-123')

      const body = mock.history[0].body.insurance
      expect(body.to_address).toEqual({ id: 'adr_to' })
      expect(body.from_address).toEqual({ id: 'adr_from' })
      expect(body.reference).toBe('ORDER-123')
    })
  })

  describe('getInsurance', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/insurances/ins_1`).reply({ id: 'ins_1' })

      const result = await service.getInsurance('ins_1')

      expect(result).toMatchObject({ id: 'ins_1' })
    })
  })

  describe('refundInsurance', () => {
    it('sends POST to refund endpoint', async () => {
      mock.onPost(`${BASE}/insurances/ins_1/refund`).reply({ id: 'ins_1', status: 'cancelled' })

      const result = await service.refundInsurance('ins_1')

      expect(result).toMatchObject({ status: 'cancelled' })
    })
  })

  // ── Actions: Refunds ──

  describe('createRefund', () => {
    it('sends POST with carrier and tracking codes', async () => {
      mock.onPost(`${BASE}/refunds`).reply([{ id: 'rfnd_1', status: 'submitted' }])

      await service.createRefund('USPS', ['TRACK1', 'TRACK2'])

      expect(mock.history[0].body).toEqual({
        refund: { carrier: 'USPS', tracking_codes: ['TRACK1', 'TRACK2'] },
      })
    })

    it('accepts comma-separated tracking codes', async () => {
      mock.onPost(`${BASE}/refunds`).reply([{ id: 'rfnd_1' }])

      await service.createRefund('USPS', 'TRACK1, TRACK2')

      expect(mock.history[0].body.refund.tracking_codes).toEqual(['TRACK1', 'TRACK2'])
    })

    it('throws when no tracking codes provided', async () => {
      await expect(service.createRefund('USPS', ''))
        .rejects.toThrow('At least one tracking code is required.')
    })
  })

  // ── Actions: Webhooks ──

  describe('listWebhooks', () => {
    it('sends GET to webhooks endpoint', async () => {
      mock.onGet(`${BASE}/webhooks`).reply({ webhooks: [] })

      const result = await service.listWebhooks()

      expect(result).toMatchObject({ webhooks: [] })
    })
  })

  describe('createWebhook', () => {
    it('sends POST with URL', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: 'hook_1', url: 'https://example.com' })

      await service.createWebhook('https://example.com')

      expect(mock.history[0].body).toEqual({ webhook: { url: 'https://example.com' } })
    })

    it('includes secret and custom headers', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: 'hook_1' })

      const headers = [{ name: 'X-Auth', value: 'secret' }]
      await service.createWebhook('https://example.com', 'my-secret', headers)

      expect(mock.history[0].body.webhook).toMatchObject({
        webhook_secret: 'my-secret',
        custom_headers: headers,
      })
    })
  })

  describe('getWebhook', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/webhooks/hook_1`).reply({ id: 'hook_1' })

      const result = await service.getWebhook('hook_1')

      expect(result).toMatchObject({ id: 'hook_1' })
    })
  })

  describe('updateWebhook', () => {
    it('sends PATCH with secret', async () => {
      mock.onPatch(`${BASE}/webhooks/hook_1`).reply({ id: 'hook_1' })

      await service.updateWebhook('hook_1', 'new-secret')

      expect(mock.history[0].body).toEqual({ webhook_secret: 'new-secret' })
    })

    it('sends PATCH with custom headers', async () => {
      mock.onPatch(`${BASE}/webhooks/hook_1`).reply({ id: 'hook_1' })

      const headers = [{ name: 'X-Auth', value: 'val' }]
      await service.updateWebhook('hook_1', undefined, headers)

      expect(mock.history[0].body).toEqual({ custom_headers: headers })
    })

    it('throws when no fields provided', async () => {
      await expect(service.updateWebhook('hook_1'))
        .rejects.toThrow('Provide a webhook secret or custom headers to update.')
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/webhooks/hook_1`).reply({})

      await service.deleteWebhook('hook_1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Polling Trigger ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the named event method', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', status: 'in_transit', tracking_code: 'T1', carrier: 'USPS' })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onTrackingUpdated',
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        state: null,
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  describe('onTrackingUpdated', () => {
    it('returns sample tracker in learning mode', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        learningMode: true,
        state: null,
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('initializes state on first poll', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', status: 'pre_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        state: null,
      })

      expect(result.events).toHaveLength(0)
      expect(result.state).toEqual({ lastStatus: 'pre_transit' })
    })

    it('emits event when status changes', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', status: 'delivered' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toEqual({ lastStatus: 'delivered' })
    })

    it('does not emit event when status unchanged', async () => {
      mock.onPost(`${BASE}/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result.events).toHaveLength(0)
      expect(result.state).toEqual({ lastStatus: 'in_transit' })
    })

    it('handles API error gracefully', async () => {
      mock.onPost(`${BASE}/trackers`).replyWithError({ message: 'Network error' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'T1', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result.events).toHaveLength(0)
      expect(result.state).toEqual({ lastStatus: 'in_transit' })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with hint for 401 errors', async () => {
      mock.onGet(`${BASE}/addresses/adr_bad`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' }, status: 401 },
        status: 401,
      })

      await expect(service.getAddress('adr_bad')).rejects.toThrow('Authentication failed')
    })

    it('throws with hint for 404 errors', async () => {
      mock.onGet(`${BASE}/addresses/adr_bad`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'not found' }, status: 404 },
        status: 404,
      })

      await expect(service.getAddress('adr_bad')).rejects.toThrow('Not found')
    })

    it('includes field errors in message', async () => {
      mock.onPost(`${BASE}/addresses`).replyWithError({
        message: 'Unprocessable',
        body: {
          error: {
            message: 'Invalid',
            errors: [{ field: 'zip', message: 'is required' }],
          },
          status: 422,
        },
        status: 422,
      })

      await expect(
        service.createAddress('John', '123', undefined, 'NYC', 'NY', undefined)
      ).rejects.toThrow('zip: is required')
    })
  })
})
