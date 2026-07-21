'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'sand_test-api-token-12345'
const BASE = 'https://public-api.easyship.com/2024-09'

describe('Easyship Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
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
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Auth Headers ──

  describe('auth headers', () => {
    it('sends Bearer token in Authorization header', async () => {
      mock.onGet(`${BASE}/account`).reply({ account: {} })
      await service.getAccount()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Dictionaries ──

  describe('getAddressesDictionary', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/addresses`).reply({
        addresses: [
          { id: 'addr-1', company_name: 'Acme', contact_name: 'John', city: 'Kyiv', country_alpha2: 'UA', line_1: '123 Test Rd' },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.getAddressesDictionary({})

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: 'Acme - Kyiv',
        value: 'addr-1',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/addresses`).reply({
        addresses: [
          { id: 'addr-1', company_name: 'Acme', city: 'Kyiv', line_1: '123' },
          { id: 'addr-2', company_name: 'Beta Corp', city: 'London', line_1: '456' },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.getAddressesDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('addr-1')
    })

    it('paginates with cursor', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [], meta: { pagination: { next: 3 } } })

      const result = await service.getAddressesDictionary({ cursor: 2 })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
      expect(result.cursor).toBe(3)
    })
  })

  describe('getCouriersDictionary', () => {
    it('returns couriers mapped correctly', async () => {
      mock.onGet(`${BASE}/couriers`).reply({
        couriers: [{ id: 'c-1', umbrella_name: 'DHL', origin_country_alpha2: 'UA' }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getCouriersDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'DHL',
        value: 'c-1',
        note: 'Origin: UA',
      })
    })

    it('filters couriers by name', async () => {
      mock.onGet(`${BASE}/couriers`).reply({
        couriers: [
          { id: 'c-1', umbrella_name: 'DHL', origin_country_alpha2: 'UA' },
          { id: 'c-2', umbrella_name: 'FedEx', origin_country_alpha2: 'US' },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.getCouriersDictionary({ search: 'fed' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c-2')
    })
  })

  describe('getBoxesDictionary', () => {
    it('returns boxes with dimensions in label', async () => {
      mock.onGet(`${BASE}/boxes`).reply({
        boxes: [{ id: 'b-1', name: 'Small', outer_length: 10, outer_width: 10, outer_height: 5, weight: 0.2 }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getBoxesDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Small (10x10x5 cm)',
        note: 'Weight: 0.2kg',
        value: 'b-1',
      })
    })
  })

  describe('getProductsDictionary', () => {
    it('returns products with SKU in note', async () => {
      mock.onGet(`${BASE}/products`).reply({
        products: [{ id: 'p-1', name: 'Headphones', identifier: 'WH-001' }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getProductsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Headphones',
        note: 'SKU: WH-001',
        value: 'p-1',
      })
    })

    it('filters by name or SKU', async () => {
      mock.onGet(`${BASE}/products`).reply({
        products: [
          { id: 'p-1', name: 'Headphones', identifier: 'WH-001' },
          { id: 'p-2', name: 'Keyboard', identifier: 'KB-002' },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.getProductsDictionary({ search: 'KB' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p-2')
    })
  })

  describe('getShipmentsDictionary', () => {
    it('returns shipments mapped correctly', async () => {
      mock.onGet(`${BASE}/shipments`).reply({
        shipments: [{
          easyship_shipment_id: 'ESUS100',
          shipment_state: 'created',
          destination_address: { country_alpha2: 'US' },
          order_data: { platform_order_number: 'ORD-1' },
        }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getShipmentsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'ESUS100',
        value: 'ESUS100',
        note: 'To: US, State: created',
      })
    })
  })

  describe('getPickupsDictionary', () => {
    it('returns pickups mapped correctly', async () => {
      mock.onGet(`${BASE}/pickups`).reply({
        pickups: [{ id: 'pk-1', selected_date: '2026-05-01', state: 'confirmed', easyship_shipment_ids: ['ES1'] }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getPickupsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Pickup on 2026-05-01',
        note: 'State: confirmed',
        value: 'pk-1',
      })
    })
  })

  describe('getPickupTimeSlotsDictionary', () => {
    it('returns empty items when no courierServiceId provided', async () => {
      const result = await service.getPickupTimeSlotsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns time slots when courierServiceId is provided', async () => {
      const csId = 'cs-uuid-123'

      mock.onGet(`${BASE}/courier_services/${csId}/pickup_slots`).reply({
        courier_service_handover_option: {
          provider_name: 'USPS',
          pickup_slots: [
            { date: '2026-05-01', time_slots: [{ time_slot_id: 'ts-1', from_time: '09:00', to_time: '17:00' }] },
          ],
        },
      })

      const result = await service.getPickupTimeSlotsDictionary({ criteria: { courierServiceId: csId } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: '2026-05-01 09:00 - 17:00',
        note: 'Provider: USPS',
        value: 'ts-1',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters time slots by search', async () => {
      const csId = 'cs-uuid-123'

      mock.onGet(`${BASE}/courier_services/${csId}/pickup_slots`).reply({
        courier_service_handover_option: {
          provider_name: 'DHL',
          pickup_slots: [
            { date: '2026-05-01', time_slots: [{ time_slot_id: 'ts-1', from_time: '09:00', to_time: '12:00' }] },
            { date: '2026-05-02', time_slots: [{ time_slot_id: 'ts-2', from_time: '14:00', to_time: '18:00' }] },
          ],
        },
      })

      const result = await service.getPickupTimeSlotsDictionary({ search: '05-02', criteria: { courierServiceId: csId } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ts-2')
    })
  })

  describe('getBatchesDictionary', () => {
    it('returns batches with type display label', async () => {
      mock.onGet(`${BASE}/batches`).reply({
        batches: [{ id: 'bat-1', type: 'label_batch', state: 'created', created_at: '2026-01-01T00:00:00Z' }],
        meta: { pagination: { next: null } },
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'Label Batch - 2026-01-01T00:00:00Z',
        note: 'State: created',
        value: 'bat-1',
      })
    })
  })

  // ── Account ──

  describe('getAccount', () => {
    it('sends GET to /account', async () => {
      mock.onGet(`${BASE}/account`).reply({ account: { name: 'Test Co' } })

      const result = await service.getAccount()

      expect(result).toEqual({ account: { name: 'Test Co' } })
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Addresses ──

  describe('listAddresses', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [], meta: {} })

      await service.listAddresses()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${BASE}/addresses`).reply({ addresses: [], meta: {} })

      await service.listAddresses(3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })
  })

  describe('createAddress', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/addresses`).reply({ address: { id: 'new-addr' } })

      await service.createAddress('123 Main St', 'NYC', 'US', 'Acme', 'John', '+1234', 'john@acme.com')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        line_1: '123 Main St',
        city: 'NYC',
        country_alpha2: 'US',
        company_name: 'Acme',
        contact_name: 'John',
        contact_phone: '+1234',
        contact_email: 'john@acme.com',
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/addresses`).reply({ address: { id: 'new-addr' } })

      await service.createAddress('123 Main St', 'NYC', 'US', 'Acme', 'John', '+1234', 'john@acme.com', 'Apt 4', 'NY', '10001', { pickup: true })

      expect(mock.history[0].body).toMatchObject({
        line_2: 'Apt 4',
        state: 'NY',
        postal_code: '10001',
        default_for: { pickup: true },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/addresses`).reply({ address: { id: 'new-addr' } })

      await service.createAddress('123 Main St', 'NYC', 'US', 'Acme', 'John', '+1234', 'john@acme.com')

      expect(mock.history[0].body).not.toHaveProperty('line_2')
      expect(mock.history[0].body).not.toHaveProperty('state')
      expect(mock.history[0].body).not.toHaveProperty('postal_code')
      expect(mock.history[0].body).not.toHaveProperty('default_for')
    })
  })

  describe('updateAddress', () => {
    it('sends PATCH to correct URL with body', async () => {
      mock.onPatch(`${BASE}/addresses/addr-1`).reply({ address: { id: 'addr-1' } })

      await service.updateAddress('addr-1', '456 Oak Ave', 'LA', 'US', 'Beta', 'Jane', '+5678', 'jane@beta.com')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${BASE}/addresses/addr-1`)
      expect(mock.history[0].body).toMatchObject({
        line_1: '456 Oak Ave',
        city: 'LA',
        country_alpha2: 'US',
      })
    })
  })

  describe('deactivateAddress', () => {
    it('sends POST to deactivate URL', async () => {
      mock.onPost(`${BASE}/addresses/addr-1/deactivate`).reply({ success: { message: 'done' } })

      await service.deactivateAddress('addr-1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/addresses/addr-1/deactivate`)
    })
  })

  // ── Boxes ──

  describe('listBoxes', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/boxes`).reply({ boxes: [], meta: {} })

      await service.listBoxes()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  describe('createBox', () => {
    it('sends POST with dimensions and weight', async () => {
      mock.onPost(`${BASE}/boxes`).reply({ box: { id: 'b-new' } })

      await service.createBox('Small Box', 10, 10, 5, 0.2)

      expect(mock.history[0].body).toEqual({
        name: 'Small Box',
        outer_length: 10,
        outer_width: 10,
        outer_height: 5,
        weight: 0.2,
      })
    })
  })

  describe('updateBox', () => {
    it('sends PATCH with toggle fields', async () => {
      mock.onPatch(`${BASE}/boxes/b-1`).reply({ box: { id: 'b-1' } })

      await service.updateBox('b-1', true, false)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toMatchObject({ is_active: true, auto_selected: false })
    })
  })

  describe('deleteBox', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/boxes/b-1`).reply({ status: 'deleted' })

      await service.deleteBox('b-1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/boxes/b-1`)
    })
  })

  // ── Couriers ──

  describe('listCouriers', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/couriers`).reply({ couriers: [], meta: {} })

      await service.listCouriers()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  // ── Rates ──

  describe('requestRates', () => {
    it('sends POST with origin, destination, parcels', async () => {
      const origin = { country_alpha2: 'UA' }
      const dest = { country_alpha2: 'US' }
      const parcels = [{ items: [{ description: 'Widget', quantity: 1, declared_customs_value: 10, declared_currency: 'USD' }] }]

      mock.onPost(`${BASE}/rates`).reply({ rates: [] })

      await service.requestRates(origin, dest, parcels)

      expect(mock.history[0].body).toMatchObject({
        origin_address: origin,
        destination_address: dest,
        parcels,
      })
    })

    it('resolves incoterms dropdown label to API value', async () => {
      mock.onPost(`${BASE}/rates`).reply({ rates: [] })

      await service.requestRates({ country_alpha2: 'UA' }, { country_alpha2: 'US' }, [{ items: [] }], 'Delivered Duty Paid (DDP)')

      expect(mock.history[0].body.incoterms).toBe('DDP')
    })

    it('passes through raw incoterms value', async () => {
      mock.onPost(`${BASE}/rates`).reply({ rates: [] })

      await service.requestRates({ country_alpha2: 'UA' }, { country_alpha2: 'US' }, [{ items: [] }], 'DDU')

      expect(mock.history[0].body.incoterms).toBe('DDU')
    })
  })

  // ── Shipments ──

  describe('listShipments', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/shipments`).reply({ shipments: [], meta: {} })

      await service.listShipments()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes all filter parameters', async () => {
      mock.onGet(`${BASE}/shipments`).reply({ shipments: [], meta: {} })

      await service.listShipments(2, 50, '2026-01-01', '2026-12-31', 'Created', 'UA', 'US', 'ORD-1')

      expect(mock.history[0].query).toMatchObject({
        page: 2,
        per_page: 50,
        created_at_from: '2026-01-01',
        created_at_to: '2026-12-31',
        shipment_state: 'created',
        origin_country_alpha2: 'UA',
        destination_country_alpha2: 'US',
        platform_order_number: 'ORD-1',
      })
    })

    it('resolves shipment state dropdown label', async () => {
      mock.onGet(`${BASE}/shipments`).reply({ shipments: [], meta: {} })

      await service.listShipments(1, 20, undefined, undefined, 'Cancelled')

      expect(mock.history[0].query).toMatchObject({ shipment_state: 'cancelled' })
    })
  })

  describe('getShipment', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/shipments/ESUS100`).reply({ shipment: { easyship_shipment_id: 'ESUS100' } })

      const result = await service.getShipment('ESUS100')

      expect(result.shipment.easyship_shipment_id).toBe('ESUS100')
    })
  })

  describe('createShipment', () => {
    it('sends POST with required and optional fields', async () => {
      const parcels = [{ items: [{ description: 'Widget', quantity: 1, declared_customs_value: 10, declared_currency: 'USD' }] }]
      const dest = { country_alpha2: 'US', city: 'NYC' }

      mock.onPost(`${BASE}/shipments`).reply({ shipment: { easyship_shipment_id: 'ESUS200' } })

      await service.createShipment(parcels, dest, null, 'addr-1', 'cs-1', 'Duties Unpaid (DDU)', null, { platform_order_number: 'ORD-1' })

      expect(mock.history[0].body).toMatchObject({
        parcels,
        destination_address: dest,
        origin_address_id: 'addr-1',
        courier_service_id: 'cs-1',
        incoterms: 'DDU',
        order_data: { platform_order_number: 'ORD-1' },
      })
    })
  })

  describe('updateShipment', () => {
    it('sends PATCH to correct URL', async () => {
      mock.onPatch(`${BASE}/shipments/ESUS100`).reply({ shipment: {} })

      await service.updateShipment('ESUS100', null, null, 'cs-2', 'Delivered Duty Paid (DDP)', { key: 'val' })

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toMatchObject({
        courier_service_id: 'cs-2',
        incoterms: 'DDP',
        metadata: { key: 'val' },
      })
    })
  })

  describe('cancelShipment', () => {
    it('sends POST to cancel URL', async () => {
      mock.onPost(`${BASE}/shipments/ESUS100/cancel`).reply({ shipment: { shipment_state: 'cancelled' } })

      const result = await service.cancelShipment('ESUS100')

      expect(mock.history[0].url).toBe(`${BASE}/shipments/ESUS100/cancel`)
      expect(result.shipment.shipment_state).toBe('cancelled')
    })
  })

  describe('listShipmentDocuments', () => {
    it('sends GET with resolved document type and page size', async () => {
      mock.onGet(`${BASE}/shipments/ESUS100/documents`).reply({ documents: [] })

      await service.listShipmentDocuments('ESUS100', 'Commercial Invoice', '4x6 inch')

      expect(mock.history[0].query).toMatchObject({
        document_type: 'commercial_invoice',
        page_size: '4x6',
      })
    })

    it('passes through raw document type value', async () => {
      mock.onGet(`${BASE}/shipments/ESUS100/documents`).reply({ documents: [] })

      await service.listShipmentDocuments('ESUS100', 'packing_slip')

      expect(mock.history[0].query).toMatchObject({ document_type: 'packing_slip' })
    })
  })

  // ── Labels ──

  describe('generateLabels', () => {
    it('sends POST with shipments array', async () => {
      const shipments = [{ easyship_shipment_id: 'ESUS100', courier_service_id: 'cs-1' }]

      mock.onPost(`${BASE}/batches/labels`).reply({ batch: { id: 'bat-1', state: 'created' } })

      const result = await service.generateLabels(shipments)

      expect(mock.history[0].body).toEqual({ shipments })
      expect(result.batch.state).toBe('created')
    })
  })

  // ── Pickups ──

  describe('listPickups', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/pickups`).reply({ pickups: [], meta: {} })

      await service.listPickups()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  describe('listPickupSlots', () => {
    it('sends GET to correct URL with optional query', async () => {
      mock.onGet(`${BASE}/courier_services/cs-1/pickup_slots`).reply({ courier_service_handover_option: {} })

      await service.listPickupSlots('cs-1', 'addr-1')

      expect(mock.history[0].url).toBe(`${BASE}/courier_services/cs-1/pickup_slots`)
      expect(mock.history[0].query).toMatchObject({ origin_address_id: 'addr-1' })
    })
  })

  describe('schedulePickup', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/pickups`).reply({ pickup: { id: 'pk-1' } })

      await service.schedulePickup('cs-1', '2026-05-01', ['ESUS100'], 'ts-1')

      expect(mock.history[0].body).toMatchObject({
        courier_service_id: 'cs-1',
        selected_date: '2026-05-01',
        easyship_shipment_ids: ['ESUS100'],
        time_slot_id: 'ts-1',
      })
    })

    it('sends manual time window when no slot provided', async () => {
      mock.onPost(`${BASE}/pickups`).reply({ pickup: { id: 'pk-2' } })

      await service.schedulePickup('cs-1', '2026-05-01', ['ESUS100'], undefined, '09:00', '17:00')

      expect(mock.history[0].body).toMatchObject({
        selected_from_time: '09:00',
        selected_to_time: '17:00',
      })
      expect(mock.history[0].body).not.toHaveProperty('time_slot_id')
    })
  })

  describe('cancelPickup', () => {
    it('sends POST to cancel URL', async () => {
      mock.onPost(`${BASE}/pickups/pk-1/cancel`).reply({ pickup: { state: 'cancelled' } })

      await service.cancelPickup('pk-1')

      expect(mock.history[0].url).toBe(`${BASE}/pickups/pk-1/cancel`)
    })
  })

  // ── Manifests ──

  describe('listManifests', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/manifests`).reply({ manifests: [], meta: {} })

      await service.listManifests()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  describe('createManifest', () => {
    it('sends POST with courier ID and optional shipment IDs', async () => {
      mock.onPost(`${BASE}/manifests`).reply({ manifest: { id: 'm-1' } })

      await service.createManifest('c-1', ['ESUS100', 'ESUS200'])

      expect(mock.history[0].body).toEqual({
        courier_id: 'c-1',
        shipment_ids: ['ESUS100', 'ESUS200'],
      })
    })

    it('omits shipment_ids when not provided', async () => {
      mock.onPost(`${BASE}/manifests`).reply({ manifest: { id: 'm-1' } })

      await service.createManifest('c-1')

      expect(mock.history[0].body).toMatchObject({ courier_id: 'c-1' })
      expect(mock.history[0].body).not.toHaveProperty('shipment_ids')
    })
  })

  // ── Tracking ──

  describe('listTrackings', () => {
    it('sends correct query with all params', async () => {
      mock.onGet(`${BASE}/shipments/trackings`).reply({ shipments: [], meta: {} })

      await service.listTrackings(['ESUS100'], ['ORD-1'], true, 2, 50)

      expect(mock.history[0].query).toMatchObject({
        easyship_shipment_id: ['ESUS100'],
        platform_order_number: ['ORD-1'],
        include_checkpoints: true,
        page: 2,
        per_page: 50,
      })
    })

    it('uses defaults when params omitted', async () => {
      mock.onGet(`${BASE}/shipments/trackings`).reply({ shipments: [], meta: {} })

      await service.listTrackings()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/products`).reply({ products: [], meta: {} })

      await service.listProducts()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  describe('createProduct', () => {
    it('sends POST with required and optional fields', async () => {
      mock.onPost(`${BASE}/products`).reply({ product: { id: 'p-new' } })

      await service.createProduct('Headphones', 'WH-001', 0.3, 20, 15, 8, 4999, 'USD', 'CN', '85183000', false, false, true)

      expect(mock.history[0].body).toMatchObject({
        name: 'Headphones',
        identifier: 'WH-001',
        weight: 0.3,
        length: 20,
        width: 15,
        height: 8,
        selling_price: 4999,
        selling_price_currency: 'USD',
        origin_country_alpha2: 'CN',
        hs_code: '85183000',
        contains_liquids: false,
        contains_battery_pi966: false,
        contains_battery_pi967: true,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/products`).reply({ product: { id: 'p-new' } })

      await service.createProduct('Headphones')

      expect(mock.history[0].body).toEqual({ name: 'Headphones' })
    })
  })

  describe('updateProduct', () => {
    it('sends PATCH to correct URL', async () => {
      mock.onPatch(`${BASE}/products/p-1`).reply({ product: { id: 'p-1' } })

      await service.updateProduct('p-1', 'Updated Name', 'WH-002')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${BASE}/products/p-1`)
      expect(mock.history[0].body).toMatchObject({ name: 'Updated Name', identifier: 'WH-002' })
    })
  })

  describe('deleteProduct', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/products/p-1`).reply({ status: 'deleted' })

      await service.deleteProduct('p-1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/products/p-1`)
    })
  })

  describe('listHsCodes', () => {
    it('sends correct query with filters', async () => {
      mock.onGet(`${BASE}/hs_codes`).reply({ hs_codes: [], meta: {} })

      await service.listHsCodes(1, 10, '8517', 'headphones')

      expect(mock.history[0].query).toMatchObject({
        page: 1,
        per_page: 10,
        code: '8517',
        description: 'headphones',
      })
    })
  })

  describe('listItemCategories', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/item_categories`).reply({ item_categories: [], meta: {} })

      await service.listItemCategories()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('sends correct query defaults', async () => {
      mock.onGet(`${BASE}/batches`).reply({ batches: [], meta: {} })

      await service.listBatches()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('resolves state and type dropdown labels', async () => {
      mock.onGet(`${BASE}/batches`).reply({ batches: [], meta: {} })

      await service.listBatches(1, 20, 'Processing', 'Label Batch')

      expect(mock.history[0].query).toMatchObject({
        state: 'processing',
        type: 'label_batch',
      })
    })
  })

  describe('getBatch', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/batches/bat-1`).reply({ batch: { id: 'bat-1', state: 'processed' } })

      const result = await service.getBatch('bat-1')

      expect(result.batch.state).toBe('processed')
    })
  })

  describe('listBatchItems', () => {
    it('sends correct query with batch ID in URL', async () => {
      mock.onGet(`${BASE}/batches/bat-1/items`).reply({ batch_items: [], meta: {} })

      await service.listBatchItems('bat-1', 2, 10)

      expect(mock.history[0].url).toBe(`${BASE}/batches/bat-1/items`)
      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 10 })
    })
  })

  // ── Trigger: On Tracking Status Changed ──

  describe('onTrackingStatusChanged', () => {
    it('seeds state on first run and emits no events', async () => {
      mock.onGet(`${BASE}/shipments/trackings`).reply({
        shipments: [{
          easyship_shipment_id: 'ES1',
          trackings: [{ tracking_number: 'TN1' }],
          checkpoints: [{ checkpoint_time: '2026-01-01T00:00:00Z', primary_status: 'InTransit', message: 'Picked up' }],
        }],
        meta: { pagination: { next: null } },
      })

      const result = await service.onTrackingStatusChanged({})

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
      expect(result.state.seenIds.length).toBeGreaterThan(0)
    })

    it('emits new checkpoints on subsequent runs', async () => {
      const now = new Date().toISOString()
      const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()

      mock.onGet(`${BASE}/shipments/trackings`).reply({
        shipments: [{
          easyship_shipment_id: 'ES1',
          trackings: [{ tracking_number: 'TN1' }],
          checkpoints: [
            { checkpoint_time: recentTime, primary_status: 'InTransit', message: 'In transit', order_number: 1 },
            { checkpoint_time: now, primary_status: 'Delivered', message: 'Delivered', order_number: 2 },
          ],
        }],
        meta: { pagination: { next: null } },
      })

      const priorState = {
        since: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        seenIds: [`ES1|${recentTime}|1`],
      }

      const result = await service.onTrackingStatusChanged({ state: priorState })

      expect(result.events.length).toBeGreaterThanOrEqual(1)
      expect(result.events[0]).toHaveProperty('easyship_shipment_id', 'ES1')
      expect(result.events[0]).toHaveProperty('primary_status', 'Delivered')
    })

    it('paginates through all tracking pages', async () => {
      mock.onGet(`${BASE}/shipments/trackings`).replyWith((call) => {
        const page = call.query.page || 1

        if (page === 1) {
          return {
            shipments: [{ easyship_shipment_id: 'ES1', trackings: [], checkpoints: [] }],
            meta: { pagination: { next: 2 } },
          }
        }

        return {
          shipments: [{ easyship_shipment_id: 'ES2', trackings: [], checkpoints: [] }],
          meta: { pagination: { next: null } },
        }
      })

      const result = await service.onTrackingStatusChanged({})

      expect(mock.history).toHaveLength(2)
      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the named event method', async () => {
      mock.onGet(`${BASE}/shipments/trackings`).reply({
        shipments: [],
        meta: { pagination: { next: null } },
      })

      const result = await service.handleTriggerPollingForEvent({ eventName: 'onTrackingStatusChanged' })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws friendly error on API failure', async () => {
      mock.onGet(`${BASE}/account`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { code: 'unauthorized', message: 'Invalid token' } },
      })

      await expect(service.getAccount()).rejects.toThrow('Authentication failed')
    })

    it('throws friendly error on 404', async () => {
      mock.onGet(`${BASE}/shipments/ESNOTFOUND`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: { code: 'not_found', message: 'Shipment not found' } },
      })

      await expect(service.getShipment('ESNOTFOUND')).rejects.toThrow('Not found')
    })

    it('throws friendly error on 422 validation', async () => {
      mock.onPost(`${BASE}/addresses`).replyWithError({
        message: 'Unprocessable',
        status: 422,
        body: { error: { code: 'validation_failed', message: 'Missing required fields', details: ['city is required'] } },
      })

      await expect(
        service.createAddress('123 Main', undefined, 'US', 'Acme', 'John', '+1', 'j@a.com')
      ).rejects.toThrow('Validation failed')
    })
  })
})
