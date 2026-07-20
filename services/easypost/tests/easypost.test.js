'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.easypost.com/v2'
const EXPECTED_AUTH = `Basic ${ Buffer.from(API_KEY + ':').toString('base64') }`

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

  // ── Registration & Auth ──

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

    it('sends Basic auth header (base64 of apiKey + colon) and JSON content type', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [] })

      await service.listAddresses()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getAddressesDictionary', () => {
    it('maps addresses to items and sends page_size 20', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({
        addresses: [
          { id: 'adr_1', name: 'John Smith', street1: '123 Main St', city: 'New York', state: 'NY' },
        ],
      })

      const result = await service.getAddressesDictionary({})

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
      expect(result.items).toEqual([
        { label: 'John Smith, 123 Main St, New York NY', value: 'adr_1', note: 'ID: adr_1' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes cursor as before_id', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [] })

      await service.getAddressesDictionary({ cursor: 'adr_prev' })

      expect(mock.history[0].query).toMatchObject({ page_size: 20, before_id: 'adr_prev' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({
        addresses: [
          { id: 'adr_1', name: 'John Smith', street1: '123 Main St', city: 'New York', state: 'NY' },
          { id: 'adr_2', name: 'Jane Doe', street1: '456 Oak Ave', city: 'Boston', state: 'MA' },
        ],
      })

      const result = await service.getAddressesDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('adr_2')
    })

    it('returns next cursor when a full page of 20 is returned', async () => {
      const addresses = Array.from({ length: 20 }, (_, i) => ({
        id: `adr_${ i }`, name: `Name ${ i }`, street1: 'St', city: 'City', state: 'ST',
      }))
      mock.onGet(`${ BASE }/addresses`).reply({ addresses })

      const result = await service.getAddressesDictionary({})

      expect(result.cursor).toBe('adr_19')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [] })

      const result = await service.getAddressesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getCarrierAccountsDictionary', () => {
    it('maps carrier accounts returned as an array', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply([
        { id: 'ca_1', type: 'UpsAccount', description: 'Primary' },
        { id: 'ca_2', type: 'FedexAccount' },
      ])

      const result = await service.getCarrierAccountsDictionary({})

      expect(result.items).toEqual([
        { label: 'UpsAccount - Primary', value: 'ca_1', note: 'ID: ca_1' },
        { label: 'FedexAccount', value: 'ca_2', note: 'ID: ca_2' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('maps carrier accounts returned under carrier_accounts key', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({
        carrier_accounts: [{ id: 'ca_3', type: 'DhlAccount' }],
      })

      const result = await service.getCarrierAccountsDictionary({})

      expect(result.items).toEqual([
        { label: 'DhlAccount', value: 'ca_3', note: 'ID: ca_3' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply([
        { id: 'ca_1', type: 'UpsAccount' },
        { id: 'ca_2', type: 'FedexAccount' },
      ])

      const result = await service.getCarrierAccountsDictionary({ search: 'fedex' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ca_2')
    })
  })

  describe('getShipmentsDictionary', () => {
    it('maps shipments to items with status note', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({
        shipments: [
          { id: 'shp_1', status: 'delivered', to_address: { name: 'Jane', city: 'LA', state: 'CA', zip: '90001' } },
        ],
      })

      const result = await service.getShipmentsDictionary({})

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
      expect(result.items).toEqual([
        { label: 'Jane, LA CA 90001', value: 'shp_1', note: 'delivered' },
      ])
    })

    it('filters by search term and passes cursor', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({
        shipments: [
          { id: 'shp_1', status: 'delivered', to_address: { name: 'Jane', city: 'LA', state: 'CA', zip: '90001' } },
          { id: 'shp_2', status: 'unknown', to_address: { name: 'Bob', city: 'NY', state: 'NY', zip: '10001' } },
        ],
      })

      const result = await service.getShipmentsDictionary({ search: 'bob', cursor: 'shp_prev' })

      expect(mock.history[0].query).toMatchObject({ before_id: 'shp_prev' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('shp_2')
    })
  })

  describe('getBatchesDictionary', () => {
    it('maps batches to items with state note', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        batches: [{ id: 'batch_1', reference: 'Holiday', state: 'created' }],
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items).toEqual([
        { label: 'Holiday', value: 'batch_1', note: 'created' },
      ])
    })

    it('falls back to id as label when reference missing', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        batches: [{ id: 'batch_2', state: 'purchased' }],
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items[0].label).toBe('batch_2')
    })
  })

  describe('getShipmentRatesDictionary', () => {
    it('returns empty items when no shipment id in criteria', async () => {
      const result = await service.getShipmentRatesDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('fetches the shipment and maps its rates', async () => {
      mock.onGet(`${ BASE }/shipments/shp_1`).reply({
        rates: [
          { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '7.58', delivery_days: 2 },
        ],
      })

      const result = await service.getShipmentRatesDictionary({ criteria: { shipmentId: 'shp_1' } })

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/shp_1`)
      expect(result.items).toEqual([
        { label: 'USPS Priority @ $7.58', value: 'rate_1', note: 'delivery_days: 2' },
      ])
    })

    it('filters rates by search term', async () => {
      mock.onGet(`${ BASE }/shipments/shp_1`).reply({
        rates: [
          { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '7.58', delivery_days: 2 },
          { id: 'rate_2', carrier: 'UPS', service: 'Ground', rate: '9.10', delivery_days: 4 },
        ],
      })

      const result = await service.getShipmentRatesDictionary({ search: 'ups', criteria: { shipmentId: 'shp_1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('rate_2')
    })
  })

  describe('static dictionaries', () => {
    it('getLabelFormatsDictionary returns the four label formats', () => {
      const result = service.getLabelFormatsDictionary()

      expect(result.items.map(i => i.value)).toEqual(['PNG', 'PDF', 'ZPL', 'EPL2'])
    })

    it('getContentsTypesDictionary includes merchandise', () => {
      const result = service.getContentsTypesDictionary()

      expect(result.items.map(i => i.value)).toContain('merchandise')
    })

    it('getRestrictionTypesDictionary includes none', () => {
      const result = service.getRestrictionTypesDictionary()

      expect(result.items.map(i => i.value)).toContain('none')
    })

    it('getNonDeliveryOptionsDictionary returns return and abandon', () => {
      const result = service.getNonDeliveryOptionsDictionary()

      expect(result.items.map(i => i.value)).toEqual(['return', 'abandon'])
    })
  })

  describe('getTrackersDictionary', () => {
    it('maps trackers to items with status note', async () => {
      mock.onGet(`${ BASE }/trackers`).reply({
        trackers: [{ id: 'trk_1', tracking_code: '9400111899223456789012', carrier: 'USPS', status: 'delivered' }],
      })

      const result = await service.getTrackersDictionary({})

      expect(result.items).toEqual([
        { label: '9400111899223456789012 (USPS)', value: 'trk_1', note: 'delivered' },
      ])
    })
  })

  describe('getPickupsDictionary', () => {
    it('maps pickups to items falling back to Pickup <id>', async () => {
      mock.onGet(`${ BASE }/pickups`).reply({
        pickups: [{ id: 'pickup_1', status: 'scheduled' }],
      })

      const result = await service.getPickupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Pickup pickup_1', value: 'pickup_1', note: 'scheduled' },
      ])
    })
  })

  describe('getInsurancesDictionary', () => {
    it('maps insurances to items with amount and status', async () => {
      mock.onGet(`${ BASE }/insurances`).reply({
        insurances: [{ id: 'ins_1', tracking_code: '9400111899223456789012', amount: '100.00', status: 'purchased' }],
      })

      const result = await service.getInsurancesDictionary({})

      expect(result.items).toEqual([
        { label: '9400111899223456789012 - $100.00', value: 'ins_1', note: 'purchased' },
      ])
    })
  })

  describe('getWebhooksDictionary', () => {
    it('maps webhooks with active/disabled note', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({
        webhooks: [
          { id: 'hook_1', url: 'https://example.com/a', disabled_at: null },
          { id: 'hook_2', url: 'https://example.com/b', disabled_at: '2025-01-01T00:00:00Z' },
        ],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items).toEqual([
        { label: 'https://example.com/a', value: 'hook_1', note: 'active' },
        { label: 'https://example.com/b', value: 'hook_2', note: 'disabled' },
      ])
    })

    it('filters webhooks by url search term', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({
        webhooks: [
          { id: 'hook_1', url: 'https://example.com/a', disabled_at: null },
          { id: 'hook_2', url: 'https://other.com/b', disabled_at: null },
        ],
      })

      const result = await service.getWebhooksDictionary({ search: 'other' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('hook_2')
    })
  })

  // ── Schema Loaders ──

  describe('schema loaders', () => {
    it('customsItemSchema returns required customs-item fields', () => {
      const schema = service.customsItemSchema()

      const names = schema.map(f => f.name)
      expect(names).toEqual(expect.arrayContaining(['description', 'quantity', 'weight', 'value', 'hs_tariff_number', 'origin_country']))
    })

    it('webhookCustomHeaderSchema returns name and value fields', () => {
      const schema = service.webhookCustomHeaderSchema()

      expect(schema.map(f => f.name)).toEqual(['name', 'value'])
    })
  })

  // ── Actions: Addresses ──

  describe('createAddress', () => {
    it('posts to /addresses with cleaned body and defaults country to US', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ id: 'adr_new' })

      const result = await service.createAddress('John', '123 Main St', undefined, 'New York', 'NY', '10001')

      expect(result).toEqual({ id: 'adr_new' })
      expect(mock.history[0].url).toBe(`${ BASE }/addresses`)
      expect(mock.history[0].body).toEqual({
        address: { name: 'John', street1: '123 Main St', city: 'New York', state: 'NY', zip: '10001', country: 'US' },
      })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ id: 'adr_new' })

      await service.createAddress('John', '123 Main St', 'Suite 100', 'New York', 'NY', '10001', 'CA', 'Acme', '5551234567', 'john@example.com', false)

      expect(mock.history[0].body).toEqual({
        address: {
          name: 'John', street1: '123 Main St', street2: 'Suite 100', city: 'New York', state: 'NY',
          zip: '10001', country: 'CA', company: 'Acme', phone: '5551234567', email: 'john@example.com',
        },
      })
    })

    it('uses the create_and_verify endpoint and unwraps address when verify is true', async () => {
      mock.onPost(`${ BASE }/addresses/create_and_verify`).reply({ address: { id: 'adr_verified' } })

      const result = await service.createAddress('John', '123 Main St', undefined, 'New York', 'NY', '10001', undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].url).toBe(`${ BASE }/addresses/create_and_verify`)
      expect(result).toEqual({ id: 'adr_verified' })
    })

    it('propagates the API error hint on failure', async () => {
      mock.onPost(`${ BASE }/addresses`).replyWithError({
        status: 422,
        body: { error: { message: 'Address is invalid' } },
      })

      await expect(
        service.createAddress('John', '123 Main St', undefined, 'New York', 'NY', '10001')
      ).rejects.toThrow('Address is invalid')
    })
  })

  describe('getAddress', () => {
    it('gets /addresses/:id', async () => {
      mock.onGet(`${ BASE }/addresses/adr_1`).reply({ id: 'adr_1', name: 'John' })

      const result = await service.getAddress('adr_1')

      expect(result).toEqual({ id: 'adr_1', name: 'John' })
      expect(mock.history[0].method).toBe('get')
    })

    it('throws with the 404 hint when not found', async () => {
      mock.onGet(`${ BASE }/addresses/bad`).replyWithError({
        status: 404,
        body: { error: { message: 'The requested resource could not be found.' } },
      })

      await expect(service.getAddress('bad')).rejects.toThrow('Not found')
    })
  })

  describe('verifyAddress', () => {
    it('gets the verify endpoint and unwraps address', async () => {
      mock.onGet(`${ BASE }/addresses/adr_1/verify`).reply({ address: { id: 'adr_1', verifications: {} } })

      const result = await service.verifyAddress('adr_1')

      expect(mock.history[0].url).toBe(`${ BASE }/addresses/adr_1/verify`)
      expect(result).toEqual({ id: 'adr_1', verifications: {} })
    })

    it('returns the raw response when no address key present', async () => {
      mock.onGet(`${ BASE }/addresses/adr_1/verify`).reply({ id: 'adr_1' })

      const result = await service.verifyAddress('adr_1')

      expect(result).toEqual({ id: 'adr_1' })
    })
  })

  describe('listAddresses', () => {
    it('defaults page_size to 20', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [], has_more: false })

      const result = await service.listAddresses()

      expect(result).toEqual({ addresses: [], has_more: false })
      expect(mock.history[0].query).toEqual({ page_size: 20 })
    })

    it('passes page size and pagination cursors', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [] })

      await service.listAddresses(50, 'adr_before', 'adr_after')

      expect(mock.history[0].query).toEqual({ page_size: 50, before_id: 'adr_before', after_id: 'adr_after' })
    })
  })

  // ── Actions: Parcels ──

  describe('createParcel', () => {
    it('posts required weight only', async () => {
      mock.onPost(`${ BASE }/parcels`).reply({ id: 'prcl_1' })

      const result = await service.createParcel(16)

      expect(result).toEqual({ id: 'prcl_1' })
      expect(mock.history[0].body).toEqual({ parcel: { weight: 16 } })
    })

    it('includes dimensions and predefined package', async () => {
      mock.onPost(`${ BASE }/parcels`).reply({ id: 'prcl_1' })

      await service.createParcel(16, 10, 8, 4, 'FlatRateEnvelope')

      expect(mock.history[0].body).toEqual({
        parcel: { weight: 16, length: 10, width: 8, height: 4, predefined_package: 'FlatRateEnvelope' },
      })
    })
  })

  describe('getParcel', () => {
    it('gets /parcels/:id', async () => {
      mock.onGet(`${ BASE }/parcels/prcl_1`).reply({ id: 'prcl_1', weight: 16 })

      const result = await service.getParcel('prcl_1')

      expect(result).toEqual({ id: 'prcl_1', weight: 16 })
    })
  })

  // ── Actions: Customs ──

  describe('createCustomsInfo', () => {
    const items = [{ description: 'T-shirt', quantity: 1, weight: 5, value: 10, hs_tariff_number: '123456', origin_country: 'US' }]

    it('throws when no customs items provided', async () => {
      await expect(
        service.createCustomsInfo('merchandise', 'Steve', true, 'NOEEI 30.37(a)', 'none', [])
      ).rejects.toThrow('At least one customs item is required.')
    })

    it('posts customs info with customs_certify preserved even when false', async () => {
      mock.onPost(`${ BASE }/customs_infos`).reply({ id: 'cstinfo_1' })

      await service.createCustomsInfo('merchandise', 'Steve', false, 'NOEEI 30.37(a)', 'none', items)

      expect(mock.history[0].body).toEqual({
        customs_info: {
          customs_signer: 'Steve',
          contents_type: 'merchandise',
          restriction_type: 'none',
          eel_pfc: 'NOEEI 30.37(a)',
          customs_items: items,
          customs_certify: false,
        },
      })
    })

    it('includes optional explanation, non-delivery option and restriction comments', async () => {
      mock.onPost(`${ BASE }/customs_infos`).reply({ id: 'cstinfo_1' })

      await service.createCustomsInfo('other', 'Steve', true, 'NOEEI 30.37(a)', 'other', items, 'Books', 'abandon', 'Fragile')

      expect(mock.history[0].body.customs_info).toMatchObject({
        contents_explanation: 'Books',
        non_delivery_option: 'abandon',
        restriction_comments: 'Fragile',
        customs_certify: true,
      })
    })
  })

  describe('getCustomsInfo', () => {
    it('gets /customs_infos/:id', async () => {
      mock.onGet(`${ BASE }/customs_infos/cstinfo_1`).reply({ id: 'cstinfo_1' })

      const result = await service.getCustomsInfo('cstinfo_1')

      expect(result).toEqual({ id: 'cstinfo_1' })
    })
  })

  describe('createCustomsItem', () => {
    it('posts required fields only', async () => {
      mock.onPost(`${ BASE }/customs_items`).reply({ id: 'cstitem_1' })

      await service.createCustomsItem('T-shirt', 1, 5, 10, '123456', 'US')

      expect(mock.history[0].body).toEqual({
        customs_item: {
          description: 'T-shirt', quantity: 1, weight: 5, value: 10, hs_tariff_number: '123456', origin_country: 'US',
        },
      })
    })

    it('includes optional customs-item fields', async () => {
      mock.onPost(`${ BASE }/customs_items`).reply({ id: 'cstitem_1' })

      await service.createCustomsItem('T-shirt', 1, 5, 10, '123456', 'US', 'USD', 'Acme', 'SKU1', 'ECCN1', 'PCI1')

      expect(mock.history[0].body.customs_item).toMatchObject({
        currency: 'USD', manufacturer: 'Acme', code: 'SKU1', eccn: 'ECCN1', printed_commodity_identifier: 'PCI1',
      })
    })
  })

  describe('getCustomsItem', () => {
    it('gets /customs_items/:id', async () => {
      mock.onGet(`${ BASE }/customs_items/cstitem_1`).reply({ id: 'cstitem_1' })

      const result = await service.getCustomsItem('cstitem_1')

      expect(result).toEqual({ id: 'cstitem_1' })
    })
  })

  // ── Actions: Shipments ──

  describe('createShipment', () => {
    it('posts nested from/to/parcel with required params and defaulted countries', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1' })

      await service.createShipment(
        'John', '123 Main St', 'New York', 'NY', '10001', undefined,
        'Jane', '456 Oak Ave', 'LA', 'CA', '90001', undefined,
        16
      )

      expect(mock.history[0].body).toEqual({
        shipment: {
          from_address: { name: 'John', street1: '123 Main St', city: 'New York', state: 'NY', zip: '10001', country: 'US' },
          to_address: { name: 'Jane', street1: '456 Oak Ave', city: 'LA', state: 'CA', zip: '90001', country: 'US' },
          parcel: { weight: 16 },
        },
      })
    })

    it('adds options, carrier account and customs info when provided', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1' })

      await service.createShipment(
        'John', '123 Main St', 'New York', 'NY', '10001', 'US',
        'Jane', '456 Oak Ave', 'LA', 'CA', '90001', 'US',
        16, 10, 8, 4, 'FlatRateEnvelope', 'PDF', 'ca_1', 'cstinfo_1'
      )

      const body = mock.history[0].body.shipment
      expect(body.parcel).toEqual({ weight: 16, length: 10, width: 8, height: 4, predefined_package: 'FlatRateEnvelope' })
      expect(body.options).toEqual({ label_format: 'PDF' })
      expect(body.carrier_accounts).toEqual(['ca_1'])
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
    })
  })

  describe('createShipmentFromSaved', () => {
    it('posts saved address and parcel ids', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1' })

      await service.createShipmentFromSaved('adr_from', 'adr_to', 'prcl_1')

      expect(mock.history[0].body).toEqual({
        shipment: {
          from_address: { id: 'adr_from' },
          to_address: { id: 'adr_to' },
          parcel: { id: 'prcl_1' },
        },
      })
    })

    it('adds options, carrier account and customs info when provided', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1' })

      await service.createShipmentFromSaved('adr_from', 'adr_to', 'prcl_1', 'ZPL', 'ca_1', 'cstinfo_1')

      const body = mock.history[0].body.shipment
      expect(body.options).toEqual({ label_format: 'ZPL' })
      expect(body.carrier_accounts).toEqual(['ca_1'])
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
    })
  })

  describe('createAndBuyShipment', () => {
    it('posts shipment with service and carrier account, no customs/options by default', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1', tracking_code: 'TRK' })

      await service.createAndBuyShipment(
        'John', '123 Main St', 'New York', 'NY', '10001', undefined,
        'Jane', '456 Oak Ave', 'LA', 'CA', '90001', undefined,
        16, undefined, undefined, undefined,
        'NextDayAir', 'ca_1'
      )

      const body = mock.history[0].body.shipment
      expect(body.service).toBe('NextDayAir')
      expect(body.carrier_accounts).toEqual(['ca_1'])
      expect(body.from_address).toEqual({ name: 'John', street1: '123 Main St', city: 'New York', state: 'NY', zip: '10001', country: 'US' })
      expect(body.parcel).toEqual({ weight: 16 })
      expect(body.customs_info).toBeUndefined()
      expect(body.options).toBeUndefined()
    })

    it('adds customs info and label format options when provided', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ id: 'shp_1' })

      await service.createAndBuyShipment(
        'John', '123 Main St', 'New York', 'NY', '10001', 'US',
        'Jane', '456 Oak Ave', 'LA', 'CA', '90001', 'US',
        16, 10, 8, 4,
        'Priority', 'ca_1', 'cstinfo_1', 'PDF'
      )

      const body = mock.history[0].body.shipment
      expect(body.customs_info).toEqual({ id: 'cstinfo_1' })
      expect(body.options).toEqual({ label_format: 'PDF' })
    })
  })

  describe('getShipment', () => {
    it('gets /shipments/:id', async () => {
      mock.onGet(`${ BASE }/shipments/shp_1`).reply({ id: 'shp_1' })

      const result = await service.getShipment('shp_1')

      expect(result).toEqual({ id: 'shp_1' })
    })
  })

  describe('listShipments', () => {
    it('defaults page_size to 20', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [] })

      await service.listShipments()

      expect(mock.history[0].query).toEqual({ page_size: 20 })
    })

    it('passes pagination cursors', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [] })

      await service.listShipments(10, 'shp_before', 'shp_after')

      expect(mock.history[0].query).toEqual({ page_size: 10, before_id: 'shp_before', after_id: 'shp_after' })
    })
  })

  describe('buyShipment', () => {
    it('posts rate id to buy endpoint without insurance by default', async () => {
      mock.onPost(`${ BASE }/shipments/shp_1/buy`).reply({ id: 'shp_1', tracking_code: 'TRK' })

      await service.buyShipment('shp_1', 'rate_1')

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/shp_1/buy`)
      expect(mock.history[0].body).toEqual({ rate: { id: 'rate_1' } })
    })

    it('includes insurance when provided', async () => {
      mock.onPost(`${ BASE }/shipments/shp_1/buy`).reply({ id: 'shp_1' })

      await service.buyShipment('shp_1', 'rate_1', '100.00')

      expect(mock.history[0].body).toEqual({ rate: { id: 'rate_1' }, insurance: '100.00' })
    })
  })

  describe('convertLabelFormat', () => {
    it('gets the label endpoint with file_format query', async () => {
      mock.onGet(`${ BASE }/shipments/shp_1/label`).reply({ id: 'shp_1' })

      await service.convertLabelFormat('shp_1', 'PDF')

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/shp_1/label`)
      expect(mock.history[0].query).toEqual({ file_format: 'PDF' })
    })
  })

  describe('refundShipment', () => {
    it('posts to the refund endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/shipments/shp_1/refund`).reply({ id: 'shp_1', refund_status: 'submitted' })

      const result = await service.refundShipment('shp_1')

      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ id: 'shp_1', refund_status: 'submitted' })
    })
  })

  // ── Actions: Tracking ──

  describe('createTracker', () => {
    it('posts tracking code and carrier', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1' })

      await service.createTracker('9400111899223456789012', 'USPS')

      expect(mock.history[0].body).toEqual({
        tracker: { tracking_code: '9400111899223456789012', carrier: 'USPS' },
      })
    })
  })

  describe('getTracker', () => {
    it('gets /trackers/:id', async () => {
      mock.onGet(`${ BASE }/trackers/trk_1`).reply({ id: 'trk_1', status: 'delivered' })

      const result = await service.getTracker('trk_1')

      expect(result).toEqual({ id: 'trk_1', status: 'delivered' })
    })
  })

  describe('listTrackers', () => {
    it('defaults page_size to 20', async () => {
      mock.onGet(`${ BASE }/trackers`).reply({ trackers: [] })

      await service.listTrackers()

      expect(mock.history[0].query).toEqual({ page_size: 20 })
    })

    it('passes all filters', async () => {
      mock.onGet(`${ BASE }/trackers`).reply({ trackers: [] })

      await service.listTrackers(10, 'trk_before', 'trk_after', '9400111899223456789012', 'USPS')

      expect(mock.history[0].query).toEqual({
        page_size: 10, before_id: 'trk_before', after_id: 'trk_after', tracking_code: '9400111899223456789012', carrier: 'USPS',
      })
    })
  })

  describe('deleteTracker', () => {
    it('sends a DELETE to /trackers/:id', async () => {
      mock.onDelete(`${ BASE }/trackers/trk_1`).reply({ success: true })

      const result = await service.deleteTracker('trk_1')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({ success: true })
    })
  })

  // ── Actions: Batches ──

  describe('createBatch', () => {
    it('posts an empty batch body when nothing provided', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_1' })

      await service.createBatch()

      expect(mock.history[0].body).toEqual({ batch: {} })
    })

    it('includes reference and shipment ids from an array', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_1' })

      await service.createBatch('Holiday', ['shp_1', 'shp_2'])

      expect(mock.history[0].body).toEqual({
        batch: { reference: 'Holiday', shipments: [{ id: 'shp_1' }, { id: 'shp_2' }] },
      })
    })

    it('accepts a comma-separated shipment id string', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_1' })

      await service.createBatch(undefined, 'shp_1, shp_2 ,shp_3')

      expect(mock.history[0].body).toEqual({
        batch: { shipments: [{ id: 'shp_1' }, { id: 'shp_2' }, { id: 'shp_3' }] },
      })
    })
  })

  describe('getBatch', () => {
    it('gets /batches/:id', async () => {
      mock.onGet(`${ BASE }/batches/batch_1`).reply({ id: 'batch_1' })

      const result = await service.getBatch('batch_1')

      expect(result).toEqual({ id: 'batch_1' })
    })
  })

  describe('listBatches', () => {
    it('defaults page_size to 20', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ batches: [] })

      await service.listBatches()

      expect(mock.history[0].query).toEqual({ page_size: 20 })
    })
  })

  describe('addShipmentsToBatch', () => {
    it('throws when no shipment ids provided', async () => {
      await expect(service.addShipmentsToBatch('batch_1', [])).rejects.toThrow('At least one shipment ID is required.')
    })

    it('posts shipment ids to add_shipments', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/add_shipments`).reply({ id: 'batch_1' })

      await service.addShipmentsToBatch('batch_1', ['shp_1', 'shp_2'])

      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1/add_shipments`)
      expect(mock.history[0].body).toEqual({ shipments: [{ id: 'shp_1' }, { id: 'shp_2' }] })
    })
  })

  describe('removeShipmentsFromBatch', () => {
    it('throws when no shipment ids provided', async () => {
      await expect(service.removeShipmentsFromBatch('batch_1', '')).rejects.toThrow('At least one shipment ID is required.')
    })

    it('posts shipment ids to remove_shipments', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/remove_shipments`).reply({ id: 'batch_1' })

      await service.removeShipmentsFromBatch('batch_1', ['shp_1'])

      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1/remove_shipments`)
      expect(mock.history[0].body).toEqual({ shipments: [{ id: 'shp_1' }] })
    })
  })

  describe('buyBatch', () => {
    it('posts an empty body to the buy endpoint', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/buy`).reply({ id: 'batch_1', state: 'purchasing' })

      await service.buyBatch('batch_1')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1/buy`)
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('generateBatchLabel', () => {
    it('posts the file_format to the label endpoint', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/label`).reply({ id: 'batch_1' })

      await service.generateBatchLabel('batch_1', 'PDF')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1/label`)
      expect(mock.history[0].body).toEqual({ file_format: 'PDF' })
    })
  })

  // ── Actions: Pickups ──

  describe('createPickup', () => {
    it('posts shipment, address and datetime window', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ id: 'pickup_1' })

      await service.createPickup('shp_1', 'adr_1', '2025-01-20T09:00:00Z', '2025-01-20T17:00:00Z')

      expect(mock.history[0].body).toEqual({
        pickup: {
          shipment: { id: 'shp_1' },
          address: { id: 'adr_1' },
          min_datetime: '2025-01-20T09:00:00Z',
          max_datetime: '2025-01-20T17:00:00Z',
        },
      })
    })

    it('includes instructions when provided', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ id: 'pickup_1' })

      await service.createPickup('shp_1', 'adr_1', '2025-01-20T09:00:00Z', '2025-01-20T17:00:00Z', 'Ring doorbell')

      expect(mock.history[0].body.pickup.instructions).toBe('Ring doorbell')
    })
  })

  describe('getPickup', () => {
    it('gets /pickups/:id', async () => {
      mock.onGet(`${ BASE }/pickups/pickup_1`).reply({ id: 'pickup_1' })

      const result = await service.getPickup('pickup_1')

      expect(result).toEqual({ id: 'pickup_1' })
    })
  })

  describe('buyPickup', () => {
    it('posts carrier and service to the buy endpoint', async () => {
      mock.onPost(`${ BASE }/pickups/pickup_1/buy`).reply({ id: 'pickup_1', status: 'scheduled' })

      await service.buyPickup('pickup_1', 'USPS', 'NextDay')

      expect(mock.history[0].url).toBe(`${ BASE }/pickups/pickup_1/buy`)
      expect(mock.history[0].body).toEqual({ carrier: 'USPS', service: 'NextDay' })
    })
  })

  describe('cancelPickup', () => {
    it('posts an empty body to the cancel endpoint', async () => {
      mock.onPost(`${ BASE }/pickups/pickup_1/cancel`).reply({ id: 'pickup_1', status: 'canceled' })

      await service.cancelPickup('pickup_1')

      expect(mock.history[0].url).toBe(`${ BASE }/pickups/pickup_1/cancel`)
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Actions: Insurance ──

  describe('createInsurance', () => {
    it('posts required insurance fields', async () => {
      mock.onPost(`${ BASE }/insurances`).reply({ id: 'ins_1' })

      await service.createInsurance('9400111899223456789012', 'USPS', '100.00')

      expect(mock.history[0].body).toEqual({
        insurance: { tracking_code: '9400111899223456789012', carrier: 'USPS', amount: '100.00' },
      })
    })

    it('includes reference and to/from addresses when provided', async () => {
      mock.onPost(`${ BASE }/insurances`).reply({ id: 'ins_1' })

      await service.createInsurance('9400111899223456789012', 'USPS', '100.00', 'adr_to', 'adr_from', 'ORDER-1')

      expect(mock.history[0].body.insurance).toEqual({
        tracking_code: '9400111899223456789012',
        carrier: 'USPS',
        amount: '100.00',
        reference: 'ORDER-1',
        to_address: { id: 'adr_to' },
        from_address: { id: 'adr_from' },
      })
    })
  })

  describe('getInsurance', () => {
    it('gets /insurances/:id', async () => {
      mock.onGet(`${ BASE }/insurances/ins_1`).reply({ id: 'ins_1' })

      const result = await service.getInsurance('ins_1')

      expect(result).toEqual({ id: 'ins_1' })
    })
  })

  describe('refundInsurance', () => {
    it('posts an empty body to the refund endpoint', async () => {
      mock.onPost(`${ BASE }/insurances/ins_1/refund`).reply({ id: 'ins_1', status: 'cancelled' })

      await service.refundInsurance('ins_1')

      expect(mock.history[0].url).toBe(`${ BASE }/insurances/ins_1/refund`)
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Actions: Refunds ──

  describe('createRefund', () => {
    it('throws when no tracking codes provided', async () => {
      await expect(service.createRefund('USPS', '')).rejects.toThrow('At least one tracking code is required.')
    })

    it('posts carrier and tracking codes from an array', async () => {
      mock.onPost(`${ BASE }/refunds`).reply([{ id: 'rfnd_1' }])

      await service.createRefund('USPS', ['9400111899223456789012', '9400111899223456789013'])

      expect(mock.history[0].body).toEqual({
        refund: { carrier: 'USPS', tracking_codes: ['9400111899223456789012', '9400111899223456789013'] },
      })
    })

    it('accepts a comma-separated tracking code string', async () => {
      mock.onPost(`${ BASE }/refunds`).reply([{ id: 'rfnd_1' }])

      await service.createRefund('UPS', 'code1, code2')

      expect(mock.history[0].body.refund.tracking_codes).toEqual(['code1', 'code2'])
    })
  })

  // ── Actions: Webhooks ──

  describe('listWebhooks', () => {
    it('gets /webhooks', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ webhooks: [] })

      const result = await service.listWebhooks()

      expect(result).toEqual({ webhooks: [] })
    })
  })

  describe('createWebhook', () => {
    it('posts the url only when no secret or headers', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'hook_1' })

      await service.createWebhook('https://example.com/hook')

      expect(mock.history[0].body).toEqual({ webhook: { url: 'https://example.com/hook' } })
    })

    it('includes secret and custom headers when provided', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'hook_1' })

      const headers = [{ name: 'X-Header-Name', value: 'header_value' }]
      await service.createWebhook('https://example.com/hook', 'secret123', headers)

      expect(mock.history[0].body).toEqual({
        webhook: { url: 'https://example.com/hook', webhook_secret: 'secret123', custom_headers: headers },
      })
    })
  })

  describe('getWebhook', () => {
    it('gets /webhooks/:id', async () => {
      mock.onGet(`${ BASE }/webhooks/hook_1`).reply({ id: 'hook_1' })

      const result = await service.getWebhook('hook_1')

      expect(result).toEqual({ id: 'hook_1' })
    })
  })

  describe('updateWebhook', () => {
    it('throws when nothing to update', async () => {
      await expect(service.updateWebhook('hook_1')).rejects.toThrow('Provide a webhook secret or custom headers to update.')
    })

    it('PATCHes the secret and headers', async () => {
      mock.onPatch(`${ BASE }/webhooks/hook_1`).reply({ id: 'hook_1' })

      const headers = [{ name: 'X-H', value: 'v' }]
      await service.updateWebhook('hook_1', 'newsecret', headers)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ webhook_secret: 'newsecret', custom_headers: headers })
    })
  })

  describe('deleteWebhook', () => {
    it('sends a DELETE to /webhooks/:id', async () => {
      mock.onDelete(`${ BASE }/webhooks/hook_1`).reply({})

      const result = await service.deleteWebhook('hook_1')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({})
    })
  })

  // ── Polling Trigger ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onTrackingUpdated',
        triggerData: { trackingCode: 'CODE', carrier: 'USPS' },
        learningMode: true,
      })

      expect(result.events).toEqual([{ id: 'trk_1', status: 'in_transit' }])
    })
  })

  describe('onTrackingUpdated', () => {
    it('returns the tracker as a sample event in learning mode with null state', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'CODE', carrier: 'USPS' },
        learningMode: true,
      })

      expect(mock.history[0].body).toEqual({ tracker: { tracking_code: 'CODE', carrier: 'USPS' } })
      expect(result).toEqual({ events: [{ id: 'trk_1', status: 'in_transit' }], state: null })
    })

    it('initializes baseline state without firing on first poll', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'CODE', carrier: 'USPS' },
        state: {},
      })

      expect(result).toEqual({ events: [], state: { lastStatus: 'in_transit' } })
    })

    it('fires an event when the status changes', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1', status: 'delivered' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'CODE', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result).toEqual({ events: [{ id: 'trk_1', status: 'delivered' }], state: { lastStatus: 'delivered' } })
    })

    it('does not fire when the status is unchanged', async () => {
      mock.onPost(`${ BASE }/trackers`).reply({ id: 'trk_1', status: 'in_transit' })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'CODE', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result).toEqual({ events: [], state: { lastStatus: 'in_transit' } })
    })

    it('returns empty events and preserves state when tracker fetch fails', async () => {
      mock.onPost(`${ BASE }/trackers`).replyWithError({ status: 422, body: { error: { message: 'Invalid tracking code' } } })

      const result = await service.onTrackingUpdated({
        triggerData: { trackingCode: 'BAD', carrier: 'USPS' },
        state: { lastStatus: 'in_transit' },
      })

      expect(result).toEqual({ events: [], state: { lastStatus: 'in_transit' } })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('appends the auth hint on a 401', async () => {
      mock.onGet(`${ BASE }/shipments/shp_x`).replyWithError({
        status: 401,
        body: { error: { message: 'Unauthorized' } },
      })

      await expect(service.getShipment('shp_x')).rejects.toThrow('Authentication failed')
    })

    it('joins field errors from the error body', async () => {
      mock.onPost(`${ BASE }/addresses`).replyWithError({
        status: 422,
        body: { error: { errors: [{ field: 'zip', message: 'is required' }] } },
      })

      await expect(
        service.createAddress('John', '123 Main St', undefined, 'New York', 'NY', '10001')
      ).rejects.toThrow('zip: is required')
    })

    it('falls back to error.message when no structured body', async () => {
      mock.onGet(`${ BASE }/parcels/prcl_x`).replyWithError({ message: 'Network down' })

      await expect(service.getParcel('prcl_x')).rejects.toThrow('Network down')
    })
  })
})
