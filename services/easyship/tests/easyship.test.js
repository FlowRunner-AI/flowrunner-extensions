'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'prod_test-api-token'
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
    it('registers with the apiToken config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends a Bearer Authorization header on requests', async () => {
      mock.onGet(`${ BASE }/account`).reply({ account: {} })

      await service.getAccount()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Dictionaries ──

  describe('getAddressesDictionary', () => {
    it('maps addresses to items and sends pagination query', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({
        addresses: [
          { id: 'a1', company_name: 'Acme', city: 'Kyiv', line_1: '1 Main St', country_alpha2: 'UA' },
          { id: 'a2', contact_name: 'Jane', city: 'Berlin', line_1: '2 Side St', country_alpha2: 'DE' },
        ],
        meta: { pagination: { next: 2 } },
      })

      const result = await service.getAddressesDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/addresses`)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
      expect(result.cursor).toBe(2)
      expect(result.items).toEqual([
        { label: 'Acme - Kyiv', note: '1 Main St, Kyiv, UA', value: 'a1' },
        { label: 'Jane - Berlin', note: '2 Side St, Berlin, DE', value: 'a2' },
      ])
    })

    it('uses the cursor as the page number', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [], meta: {} })

      const result = await service.getAddressesDictionary({ cursor: 3 })

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 25 })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term over company, contact, and city', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({
        addresses: [
          { id: 'a1', company_name: 'Acme', city: 'Kyiv' },
          { id: 'a2', company_name: 'Globex', city: 'Berlin' },
        ],
      })

      const result = await service.getAddressesDictionary({ search: 'berlin' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('a2')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [] })

      const result = await service.getAddressesDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/addresses`).replyWithError({ message: 'Boom' })

      await expect(service.getAddressesDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getCouriersDictionary', () => {
    it('maps couriers to items with origin note', async () => {
      mock.onGet(`${ BASE }/couriers`).reply({
        couriers: [
          { id: 'c1', umbrella_name: 'DHL', origin_country_alpha2: 'UA' },
          { id: 'c2', umbrella_name: 'FedEx', origin_country_alpha2: 'US' },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.getCouriersDictionary({})

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
      expect(result.items).toEqual([
        { label: 'DHL', note: 'Origin: UA', value: 'c1' },
        { label: 'FedEx', note: 'Origin: US', value: 'c2' },
      ])
    })

    it('filters by umbrella name', async () => {
      mock.onGet(`${ BASE }/couriers`).reply({
        couriers: [
          { id: 'c1', umbrella_name: 'DHL' },
          { id: 'c2', umbrella_name: 'FedEx' },
        ],
      })

      const result = await service.getCouriersDictionary({ search: 'fed' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/couriers`).replyWithError({ message: 'Boom' })

      await expect(service.getCouriersDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getBoxesDictionary', () => {
    it('maps boxes to items with dimensions and weight', async () => {
      mock.onGet(`${ BASE }/boxes`).reply({
        boxes: [{ id: 'b1', name: 'Small', outer_length: 10, outer_width: 10, outer_height: 5, weight: 0.2 }],
      })

      const result = await service.getBoxesDictionary({})

      expect(result.items).toEqual([
        { label: 'Small (10x10x5 cm)', note: 'Weight: 0.2kg', value: 'b1' },
      ])
    })

    it('filters by box name', async () => {
      mock.onGet(`${ BASE }/boxes`).reply({
        boxes: [
          { id: 'b1', name: 'Small', outer_length: 1, outer_width: 1, outer_height: 1, weight: 0.1 },
          { id: 'b2', name: 'Large', outer_length: 2, outer_width: 2, outer_height: 2, weight: 0.4 },
        ],
      })

      const result = await service.getBoxesDictionary({ search: 'large' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('b2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/boxes`).replyWithError({ message: 'Boom' })

      await expect(service.getBoxesDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getProductsDictionary', () => {
    it('maps products to items with SKU note', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        products: [{ id: 'p1', name: 'Headphones', identifier: 'WH-001' }],
      })

      const result = await service.getProductsDictionary({})

      expect(result.items).toEqual([
        { label: 'Headphones', note: 'SKU: WH-001', value: 'p1' },
      ])
    })

    it('filters by name or identifier', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        products: [
          { id: 'p1', name: 'Headphones', identifier: 'WH-001' },
          { id: 'p2', name: 'Speaker', identifier: 'SPK-9' },
        ],
      })

      const result = await service.getProductsDictionary({ search: 'spk' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.getProductsDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getShipmentsDictionary', () => {
    it('maps shipments to items with destination and state note', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({
        shipments: [
          {
            easyship_shipment_id: 'ESUS1',
            destination_address: { country_alpha2: 'US' },
            shipment_state: 'created',
          },
        ],
      })

      const result = await service.getShipmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'ESUS1', note: 'To: US, State: created', value: 'ESUS1' },
      ])
    })

    it('filters by shipment id or order number', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({
        shipments: [
          { easyship_shipment_id: 'ESUS1', order_data: { platform_order_number: 'ORD-1' } },
          { easyship_shipment_id: 'ESUS2', platform_order_number: 'ORD-2' },
        ],
      })

      const result = await service.getShipmentsDictionary({ search: 'ord-2' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ESUS2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/shipments`).replyWithError({ message: 'Boom' })

      await expect(service.getShipmentsDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getPickupsDictionary', () => {
    it('maps pickups to items with date label and state note', async () => {
      mock.onGet(`${ BASE }/pickups`).reply({
        pickups: [{ id: 'pk1', selected_date: '2026-05-01', state: 'confirmed' }],
      })

      const result = await service.getPickupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Pickup on 2026-05-01', note: 'State: confirmed', value: 'pk1' },
      ])
    })

    it('filters by pickup id or included shipment id', async () => {
      mock.onGet(`${ BASE }/pickups`).reply({
        pickups: [
          { id: 'pk1', easyship_shipment_ids: ['ESUS1'] },
          { id: 'pk2', easyship_shipment_ids: ['ESUS2'] },
        ],
      })

      const result = await service.getPickupsDictionary({ search: 'esus2' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('pk2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/pickups`).replyWithError({ message: 'Boom' })

      await expect(service.getPickupsDictionary({})).rejects.toThrow('Boom')
    })
  })

  describe('getPickupTimeSlotsDictionary', () => {
    it('returns empty items without a courier service id and makes no request', async () => {
      const result = await service.getPickupTimeSlotsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('flattens pickup slots for a courier service', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).reply({
        courier_service_handover_option: {
          provider_name: 'USPS',
          pickup_slots: [
            {
              date: '2026-07-14',
              time_slots: [
                { time_slot_id: 'ts1', from_time: '12:00', to_time: '16:00' },
                { time_slot_id: 'ts2', from_time: '16:00', to_time: '18:00' },
              ],
            },
          ],
        },
      })

      const result = await service.getPickupTimeSlotsDictionary({ criteria: { courierServiceId: 'cs1' } })

      expect(mock.history[0].url).toBe(`${ BASE }/courier_services/cs1/pickup_slots`)
      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: '2026-07-14 12:00 - 16:00', note: 'Provider: USPS', value: 'ts1' },
        { label: '2026-07-14 16:00 - 18:00', note: 'Provider: USPS', value: 'ts2' },
      ])
    })

    it('filters slots locally by search term', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).reply({
        courier_service_handover_option: {
          provider_name: 'USPS',
          pickup_slots: [
            { date: '2026-07-14', time_slots: [{ time_slot_id: 'ts1', from_time: '12:00', to_time: '16:00' }] },
            { date: '2026-07-15', time_slots: [{ time_slot_id: 'ts2', from_time: '09:00', to_time: '11:00' }] },
          ],
        },
      })

      const result = await service.getPickupTimeSlotsDictionary({
        search: '2026-07-15',
        criteria: { courierServiceId: 'cs1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ts2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).replyWithError({ message: 'Boom' })

      await expect(
        service.getPickupTimeSlotsDictionary({ criteria: { courierServiceId: 'cs1' } })
      ).rejects.toThrow('Boom')
    })
  })

  describe('getBatchesDictionary', () => {
    it('maps batches to humanized-type items with state note', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        batches: [{ id: 'ba1', type: 'shipment_batch', state: 'created', created_at: '2022-02-22T12:21:00Z' }],
      })

      const result = await service.getBatchesDictionary({})

      expect(result.items).toEqual([
        { label: 'Shipment Batch - 2022-02-22T12:21:00Z', note: 'State: created', value: 'ba1' },
      ])
    })

    it('filters by id, type, or state', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        batches: [
          { id: 'ba1', type: 'shipment_batch', state: 'created', created_at: 'x' },
          { id: 'ba2', type: 'label_batch', state: 'processed', created_at: 'y' },
        ],
      })

      const result = await service.getBatchesDictionary({ search: 'label' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ba2')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/batches`).replyWithError({ message: 'Boom' })

      await expect(service.getBatchesDictionary({})).rejects.toThrow('Boom')
    })
  })

  // ── Account ──

  describe('getAccount', () => {
    it('fetches account details', async () => {
      mock.onGet(`${ BASE }/account`).reply({ account: { name: 'Company Inc.' } })

      const result = await service.getAccount()

      expect(result).toEqual({ account: { name: 'Company Inc.' } })
      expect(mock.history[0].url).toBe(`${ BASE }/account`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({ message: 'Boom' })

      await expect(service.getAccount()).rejects.toThrow('Boom')
    })
  })

  // ── Addresses ──

  describe('listAddresses', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [], meta: {} })

      await service.listAddresses()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ addresses: [], meta: {} })

      await service.listAddresses(3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/addresses`).replyWithError({ message: 'Boom' })

      await expect(service.listAddresses()).rejects.toThrow('Boom')
    })
  })

  describe('createAddress', () => {
    it('sends required fields only, omitting empty optionals', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ address: { id: 'new' } })

      const result = await service.createAddress(
        '123 Main St', 'Kyiv', 'UA', 'Acme Inc', 'Jane Doe', '+380001', 'jane@acme.com'
      )

      expect(result).toEqual({ address: { id: 'new' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        line_1: '123 Main St',
        city: 'Kyiv',
        country_alpha2: 'UA',
        company_name: 'Acme Inc',
        contact_name: 'Jane Doe',
        contact_phone: '+380001',
        contact_email: 'jane@acme.com',
      })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ address: { id: 'new' } })

      await service.createAddress(
        '123 Main St', 'Kyiv', 'UA', 'Acme Inc', 'Jane Doe', '+380001', 'jane@acme.com',
        'Apt 4', 'Kyiv Oblast', '01001', { sender: true }
      )

      expect(mock.history[0].body).toEqual({
        line_1: '123 Main St',
        line_2: 'Apt 4',
        city: 'Kyiv',
        state: 'Kyiv Oblast',
        postal_code: '01001',
        country_alpha2: 'UA',
        company_name: 'Acme Inc',
        contact_name: 'Jane Doe',
        contact_phone: '+380001',
        contact_email: 'jane@acme.com',
        default_for: { sender: true },
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/addresses`).replyWithError({ message: 'Boom' })

      await expect(
        service.createAddress('l', 'c', 'UA', 'co', 'ct', 'p', 'e')
      ).rejects.toThrow('Boom')
    })
  })

  describe('updateAddress', () => {
    it('sends a PATCH to the address id with all provided fields', async () => {
      mock.onPatch(`${ BASE }/addresses/a1`).reply({ address: { id: 'a1' } })

      await service.updateAddress(
        'a1', '9 New St', 'Lviv', 'UA', 'New Co', 'John Roe', '+380002', 'john@new.com'
      )

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/addresses/a1`)
      expect(mock.history[0].body).toEqual({
        line_1: '9 New St',
        city: 'Lviv',
        country_alpha2: 'UA',
        company_name: 'New Co',
        contact_name: 'John Roe',
        contact_phone: '+380002',
        contact_email: 'john@new.com',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPatch(`${ BASE }/addresses/a1`).replyWithError({ message: 'Boom' })

      await expect(
        service.updateAddress('a1', 'l', 'c', 'UA', 'co', 'ct', 'p', 'e')
      ).rejects.toThrow('Boom')
    })
  })

  describe('deactivateAddress', () => {
    it('posts to the deactivate endpoint', async () => {
      mock.onPost(`${ BASE }/addresses/a1/deactivate`).reply({ success: { message: 'ok' } })

      const result = await service.deactivateAddress('a1')

      expect(result).toEqual({ success: { message: 'ok' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/addresses/a1/deactivate`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/addresses/a1/deactivate`).replyWithError({ message: 'Boom' })

      await expect(service.deactivateAddress('a1')).rejects.toThrow('Boom')
    })
  })

  // ── Boxes ──

  describe('listBoxes', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/boxes`).reply({ boxes: [], meta: {} })

      await service.listBoxes()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/boxes`).reply({ boxes: [], meta: {} })

      await service.listBoxes(2, 10)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 10 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/boxes`).replyWithError({ message: 'Boom' })

      await expect(service.listBoxes()).rejects.toThrow('Boom')
    })
  })

  describe('createBox', () => {
    it('sends the full box body', async () => {
      mock.onPost(`${ BASE }/boxes`).reply({ box: { id: 'b-new' } })

      const result = await service.createBox('Small Box', 10, 10, 5, 0.2)

      expect(result).toEqual({ box: { id: 'b-new' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        name: 'Small Box',
        outer_length: 10,
        outer_width: 10,
        outer_height: 5,
        weight: 0.2,
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/boxes`).replyWithError({ message: 'Boom' })

      await expect(service.createBox('B', 1, 1, 1, 0.1)).rejects.toThrow('Boom')
    })
  })

  describe('updateBox', () => {
    it('sends only the provided toggles', async () => {
      mock.onPatch(`${ BASE }/boxes/b1`).reply({ box: { id: 'b1' } })

      await service.updateBox('b1', true)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/boxes/b1`)
      expect(mock.history[0].body).toEqual({ is_active: true })
    })

    it('includes both toggles when provided', async () => {
      mock.onPatch(`${ BASE }/boxes/b1`).reply({ box: { id: 'b1' } })

      await service.updateBox('b1', false, true)

      expect(mock.history[0].body).toEqual({ is_active: false, auto_selected: true })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPatch(`${ BASE }/boxes/b1`).replyWithError({ message: 'Boom' })

      await expect(service.updateBox('b1', true)).rejects.toThrow('Boom')
    })
  })

  describe('deleteBox', () => {
    it('sends a DELETE to the box id', async () => {
      mock.onDelete(`${ BASE }/boxes/b1`).reply({ status: 'deleted' })

      const result = await service.deleteBox('b1')

      expect(result).toEqual({ status: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/boxes/b1`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onDelete(`${ BASE }/boxes/b1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteBox('b1')).rejects.toThrow('Boom')
    })
  })

  // ── Couriers ──

  describe('listCouriers', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/couriers`).reply({ couriers: [], meta: {} })

      await service.listCouriers()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/couriers`).reply({ couriers: [], meta: {} })

      await service.listCouriers(4, 5)

      expect(mock.history[0].query).toMatchObject({ page: 4, per_page: 5 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/couriers`).replyWithError({ message: 'Boom' })

      await expect(service.listCouriers()).rejects.toThrow('Boom')
    })
  })

  // ── Rates ──

  describe('requestRates', () => {
    it('sends origin, destination, and parcels with required fields only', async () => {
      mock.onPost(`${ BASE }/rates`).reply({ rates: [] })

      const parcels = [{ items: [{ description: 'x', quantity: 1 }] }]
      const result = await service.requestRates({ country_alpha2: 'UA' }, { country_alpha2: 'US' }, parcels)

      expect(result).toEqual({ rates: [] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/rates`)
      expect(mock.history[0].body).toEqual({
        origin_address: { country_alpha2: 'UA' },
        destination_address: { country_alpha2: 'US' },
        parcels,
      })
    })

    it('resolves incoterm labels and includes booleans', async () => {
      mock.onPost(`${ BASE }/rates`).reply({ rates: [] })

      const parcels = [{ items: [] }]
      await service.requestRates(
        { country_alpha2: 'UA' },
        { country_alpha2: 'US' },
        parcels,
        'Delivered Duty Paid (DDP)',
        true,
        false,
        true
      )

      expect(mock.history[0].body).toEqual({
        origin_address: { country_alpha2: 'UA' },
        destination_address: { country_alpha2: 'US' },
        parcels,
        incoterms: 'DDP',
        calculate_tax_and_duties: true,
        set_as_residential: false,
        return: true,
      })
    })

    it('passes through a raw incoterm value not in the label map', async () => {
      mock.onPost(`${ BASE }/rates`).reply({ rates: [] })

      await service.requestRates({ country_alpha2: 'UA' }, { country_alpha2: 'US' }, [{ items: [] }], 'DDU')

      expect(mock.history[0].body.incoterms).toBe('DDU')
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/rates`).replyWithError({ message: 'Boom' })

      await expect(
        service.requestRates({ country_alpha2: 'UA' }, { country_alpha2: 'US' }, [{ items: [] }])
      ).rejects.toThrow('Boom')
    })
  })

  // ── Shipments ──

  describe('listShipments', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [], meta: {} })

      await service.listShipments()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
    })

    it('includes filters and resolves the shipment state label', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [], meta: {} })

      await service.listShipments(2, 40, '2026-01-01', '2026-02-01', 'Cancelled', 'UA', 'US', 'ORD-1')

      expect(mock.history[0].query).toEqual({
        page: 2,
        per_page: 40,
        created_at_from: '2026-01-01',
        created_at_to: '2026-02-01',
        shipment_state: 'cancelled',
        origin_country_alpha2: 'UA',
        destination_country_alpha2: 'US',
        platform_order_number: 'ORD-1',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/shipments`).replyWithError({ message: 'Boom' })

      await expect(service.listShipments()).rejects.toThrow('Boom')
    })
  })

  describe('getShipment', () => {
    it('fetches a shipment by id', async () => {
      mock.onGet(`${ BASE }/shipments/ESUS1`).reply({ shipment: { easyship_shipment_id: 'ESUS1' } })

      const result = await service.getShipment('ESUS1')

      expect(result).toEqual({ shipment: { easyship_shipment_id: 'ESUS1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/shipments/ESUS1`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/shipments/ESUS1`).replyWithError({ message: 'Boom' })

      await expect(service.getShipment('ESUS1')).rejects.toThrow('Boom')
    })
  })

  describe('createShipment', () => {
    it('sends parcels only when other fields are omitted', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ shipment: { easyship_shipment_id: 'ESUS1' } })

      const parcels = [{ items: [{ description: 'x', quantity: 1 }] }]
      await service.createShipment(parcels)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ parcels })
    })

    it('includes all provided fields and resolves incoterms', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ shipment: { easyship_shipment_id: 'ESUS1' } })

      const parcels = [{ items: [] }]
      await service.createShipment(
        parcels,
        { country_alpha2: 'US' },
        undefined,
        'addr-1',
        'cs-1',
        'Duties Unpaid (DDU)',
        { is_insured: true },
        { platform_order_number: 'ORD-1' },
        true,
        { foo: 'bar' }
      )

      expect(mock.history[0].body).toEqual({
        parcels,
        destination_address: { country_alpha2: 'US' },
        origin_address_id: 'addr-1',
        courier_service_id: 'cs-1',
        incoterms: 'DDU',
        insurance: { is_insured: true },
        order_data: { platform_order_number: 'ORD-1' },
        return: true,
        metadata: { foo: 'bar' },
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/shipments`).replyWithError({ message: 'Boom' })

      await expect(service.createShipment([{ items: [] }])).rejects.toThrow('Boom')
    })
  })

  describe('updateShipment', () => {
    it('sends a PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/shipments/ESUS1`).reply({ shipment: { easyship_shipment_id: 'ESUS1' } })

      await service.updateShipment('ESUS1', undefined, undefined, 'cs-2')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/shipments/ESUS1`)
      expect(mock.history[0].body).toEqual({ courier_service_id: 'cs-2' })
    })

    it('includes all provided fields and resolves incoterms', async () => {
      mock.onPatch(`${ BASE }/shipments/ESUS1`).reply({ shipment: {} })

      const parcels = [{ items: [] }]
      await service.updateShipment('ESUS1', parcels, { country_alpha2: 'US' }, 'cs-2', 'Delivered Duty Paid (DDP)', { k: 'v' })

      expect(mock.history[0].body).toEqual({
        parcels,
        destination_address: { country_alpha2: 'US' },
        courier_service_id: 'cs-2',
        incoterms: 'DDP',
        metadata: { k: 'v' },
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPatch(`${ BASE }/shipments/ESUS1`).replyWithError({ message: 'Boom' })

      await expect(service.updateShipment('ESUS1', undefined, undefined, 'cs-2')).rejects.toThrow('Boom')
    })
  })

  describe('cancelShipment', () => {
    it('posts to the cancel endpoint', async () => {
      mock.onPost(`${ BASE }/shipments/ESUS1/cancel`).reply({ shipment: { shipment_state: 'cancelled' } })

      const result = await service.cancelShipment('ESUS1')

      expect(result).toEqual({ shipment: { shipment_state: 'cancelled' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/shipments/ESUS1/cancel`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/shipments/ESUS1/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelShipment('ESUS1')).rejects.toThrow('Boom')
    })
  })

  describe('listShipmentDocuments', () => {
    it('resolves document type and page size labels', async () => {
      mock.onGet(`${ BASE }/shipments/ESUS1/documents`).reply({ documents: [] })

      await service.listShipmentDocuments('ESUS1', 'Commercial Invoice', 'A4')

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/ESUS1/documents`)
      expect(mock.history[0].query).toEqual({
        document_type: 'commercial_invoice',
        page_size: 'A4',
      })
    })

    it('omits page size when not provided', async () => {
      mock.onGet(`${ BASE }/shipments/ESUS1/documents`).reply({ documents: [] })

      await service.listShipmentDocuments('ESUS1', 'Packing Slip')

      expect(mock.history[0].query).toEqual({ document_type: 'packing_slip' })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/shipments/ESUS1/documents`).replyWithError({ message: 'Boom' })

      await expect(service.listShipmentDocuments('ESUS1', 'Commercial Invoice')).rejects.toThrow('Boom')
    })
  })

  // ── Labels ──

  describe('generateLabels', () => {
    it('posts the shipments array to the labels batch endpoint', async () => {
      mock.onPost(`${ BASE }/batches/labels`).reply({ batch: { id: 'ba1', state: 'created' } })

      const shipments = [{ easyship_shipment_id: 'ESUS1', courier_service_id: 'cs-1' }]
      const result = await service.generateLabels(shipments)

      expect(result).toEqual({ batch: { id: 'ba1', state: 'created' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/batches/labels`)
      expect(mock.history[0].body).toEqual({ shipments })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/batches/labels`).replyWithError({ message: 'Boom' })

      await expect(service.generateLabels([])).rejects.toThrow('Boom')
    })
  })

  // ── Pickups ──

  describe('listPickups', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/pickups`).reply({ pickups: [], meta: {} })

      await service.listPickups()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/pickups`).reply({ pickups: [], meta: {} })

      await service.listPickups(2, 30)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 30 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/pickups`).replyWithError({ message: 'Boom' })

      await expect(service.listPickups()).rejects.toThrow('Boom')
    })
  })

  describe('listPickupSlots', () => {
    it('fetches slots for a courier service without an origin address', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).reply({ courier_service_handover_option: {} })

      await service.listPickupSlots('cs1')

      expect(mock.history[0].url).toBe(`${ BASE }/courier_services/cs1/pickup_slots`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the origin address id when provided', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).reply({ courier_service_handover_option: {} })

      await service.listPickupSlots('cs1', 'addr-1')

      expect(mock.history[0].query).toEqual({ origin_address_id: 'addr-1' })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/courier_services/cs1/pickup_slots`).replyWithError({ message: 'Boom' })

      await expect(service.listPickupSlots('cs1')).rejects.toThrow('Boom')
    })
  })

  describe('schedulePickup', () => {
    it('sends required fields with a time slot', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ pickup: { id: 'pk1', state: 'confirmed' } })

      const result = await service.schedulePickup('cs1', '2026-05-01', ['ESUS1'], 'ts1')

      expect(result).toEqual({ pickup: { id: 'pk1', state: 'confirmed' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/pickups`)
      expect(mock.history[0].body).toEqual({
        courier_service_id: 'cs1',
        selected_date: '2026-05-01',
        easyship_shipment_ids: ['ESUS1'],
        time_slot_id: 'ts1',
      })
    })

    it('supports a manual time window instead of a slot', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ pickup: { id: 'pk1' } })

      await service.schedulePickup('cs1', '2026-05-01', ['ESUS1'], undefined, '09:00', '17:00')

      expect(mock.history[0].body).toEqual({
        courier_service_id: 'cs1',
        selected_date: '2026-05-01',
        easyship_shipment_ids: ['ESUS1'],
        selected_from_time: '09:00',
        selected_to_time: '17:00',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/pickups`).replyWithError({ message: 'Boom' })

      await expect(service.schedulePickup('cs1', '2026-05-01', ['ESUS1'], 'ts1')).rejects.toThrow('Boom')
    })
  })

  describe('cancelPickup', () => {
    it('posts to the pickup cancel endpoint', async () => {
      mock.onPost(`${ BASE }/pickups/pk1/cancel`).reply({ pickup: { id: 'pk1', state: 'cancelled' } })

      const result = await service.cancelPickup('pk1')

      expect(result).toEqual({ pickup: { id: 'pk1', state: 'cancelled' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/pickups/pk1/cancel`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/pickups/pk1/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelPickup('pk1')).rejects.toThrow('Boom')
    })
  })

  // ── Manifests ──

  describe('listManifests', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/manifests`).reply({ manifests: [], meta: {} })

      await service.listManifests()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/manifests`).reply({ manifests: [], meta: {} })

      await service.listManifests(3, 15)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 15 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/manifests`).replyWithError({ message: 'Boom' })

      await expect(service.listManifests()).rejects.toThrow('Boom')
    })
  })

  describe('createManifest', () => {
    it('sends the courier id only when no shipment ids are provided', async () => {
      mock.onPost(`${ BASE }/manifests`).reply({ manifest: { id: 'm1' } })

      await service.createManifest('c1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ courier_id: 'c1' })
    })

    it('includes shipment ids when provided', async () => {
      mock.onPost(`${ BASE }/manifests`).reply({ manifest: { id: 'm1' } })

      await service.createManifest('c1', ['ESUS1', 'ESUS2'])

      expect(mock.history[0].body).toEqual({ courier_id: 'c1', shipment_ids: ['ESUS1', 'ESUS2'] })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/manifests`).replyWithError({ message: 'Boom' })

      await expect(service.createManifest('c1')).rejects.toThrow('Boom')
    })
  })

  // ── Tracking ──

  describe('listTrackings', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).reply({ shipments: [], meta: {} })

      await service.listTrackings()

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/trackings`)
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
    })

    it('includes all filters when provided', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).reply({ shipments: [], meta: {} })

      await service.listTrackings(['ESUS1'], ['ORD-1'], true, 2, 50)

      expect(mock.history[0].query).toEqual({
        easyship_shipment_id: ['ESUS1'],
        platform_order_number: ['ORD-1'],
        include_checkpoints: true,
        page: 2,
        per_page: 50,
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).replyWithError({ message: 'Boom' })

      await expect(service.listTrackings()).rejects.toThrow('Boom')
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [], meta: {} })

      await service.listProducts()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [], meta: {} })

      await service.listProducts(2, 25)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 25 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.listProducts()).rejects.toThrow('Boom')
    })
  })

  describe('createProduct', () => {
    it('sends the name only, omitting empty optionals', async () => {
      mock.onPost(`${ BASE }/products`).reply({ product: { id: 'p-new' } })

      const result = await service.createProduct('Headphones')

      expect(result).toEqual({ product: { id: 'p-new' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Headphones' })
    })

    it('includes all provided fields', async () => {
      mock.onPost(`${ BASE }/products`).reply({ product: { id: 'p-new' } })

      await service.createProduct(
        'Headphones', 'WH-001', 0.3, 20, 15, 8, 5000, 'USD', 'CN', '85183000', true, false, true
      )

      expect(mock.history[0].body).toEqual({
        name: 'Headphones',
        identifier: 'WH-001',
        weight: 0.3,
        length: 20,
        width: 15,
        height: 8,
        selling_price: 5000,
        selling_price_currency: 'USD',
        origin_country_alpha2: 'CN',
        hs_code: '85183000',
        contains_liquids: true,
        contains_battery_pi966: false,
        contains_battery_pi967: true,
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.createProduct('X')).rejects.toThrow('Boom')
    })
  })

  describe('updateProduct', () => {
    it('sends a PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/products/p1`).reply({ product: { id: 'p1' } })

      await service.updateProduct('p1', 'New Name')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1`)
      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })

    it('includes all provided fields', async () => {
      mock.onPatch(`${ BASE }/products/p1`).reply({ product: { id: 'p1' } })

      await service.updateProduct('p1', 'Name', 'SKU-2', 0.5, 10, 10, 10, 999, 'EUR', '85183000')

      expect(mock.history[0].body).toEqual({
        name: 'Name',
        identifier: 'SKU-2',
        weight: 0.5,
        length: 10,
        width: 10,
        height: 10,
        selling_price: 999,
        selling_price_currency: 'EUR',
        hs_code: '85183000',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPatch(`${ BASE }/products/p1`).replyWithError({ message: 'Boom' })

      await expect(service.updateProduct('p1', 'Name')).rejects.toThrow('Boom')
    })
  })

  describe('deleteProduct', () => {
    it('sends a DELETE to the product id', async () => {
      mock.onDelete(`${ BASE }/products/p1`).reply({ status: 'deleted' })

      const result = await service.deleteProduct('p1')

      expect(result).toEqual({ status: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onDelete(`${ BASE }/products/p1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteProduct('p1')).rejects.toThrow('Boom')
    })
  })

  describe('listHsCodes', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/hs_codes`).reply({ hs_codes: [], meta: {} })

      await service.listHsCodes()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
    })

    it('includes code and description filters', async () => {
      mock.onGet(`${ BASE }/hs_codes`).reply({ hs_codes: [], meta: {} })

      await service.listHsCodes(2, 10, '8517', 'headphones')

      expect(mock.history[0].query).toEqual({
        page: 2,
        per_page: 10,
        code: '8517',
        description: 'headphones',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/hs_codes`).replyWithError({ message: 'Boom' })

      await expect(service.listHsCodes()).rejects.toThrow('Boom')
    })
  })

  describe('listItemCategories', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/item_categories`).reply({ item_categories: [], meta: {} })

      await service.listItemCategories()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/item_categories`).reply({ item_categories: [], meta: {} })

      await service.listItemCategories(2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 5 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/item_categories`).replyWithError({ message: 'Boom' })

      await expect(service.listItemCategories()).rejects.toThrow('Boom')
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('uses default pagination with no filters', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ batches: [], meta: {} })

      await service.listBatches()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
    })

    it('resolves state and type labels', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ batches: [], meta: {} })

      await service.listBatches(2, 10, 'Processed', 'Label Batch')

      expect(mock.history[0].query).toEqual({
        page: 2,
        per_page: 10,
        state: 'processed',
        type: 'label_batch',
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/batches`).replyWithError({ message: 'Boom' })

      await expect(service.listBatches()).rejects.toThrow('Boom')
    })
  })

  describe('getBatch', () => {
    it('fetches a batch by id', async () => {
      mock.onGet(`${ BASE }/batches/ba1`).reply({ batch: { id: 'ba1', state: 'created' } })

      const result = await service.getBatch('ba1')

      expect(result).toEqual({ batch: { id: 'ba1', state: 'created' } })
      expect(mock.history[0].url).toBe(`${ BASE }/batches/ba1`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/batches/ba1`).replyWithError({ message: 'Boom' })

      await expect(service.getBatch('ba1')).rejects.toThrow('Boom')
    })
  })

  describe('listBatchItems', () => {
    it('uses default pagination', async () => {
      mock.onGet(`${ BASE }/batches/ba1/items`).reply({ batch_items: [], meta: {} })

      await service.listBatchItems('ba1')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/ba1/items`)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/batches/ba1/items`).reply({ batch_items: [], meta: {} })

      await service.listBatchItems('ba1', 2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 5 })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/batches/ba1/items`).replyWithError({ message: 'Boom' })

      await expect(service.listBatchItems('ba1')).rejects.toThrow('Boom')
    })
  })

  // ── Friendly error hints ──

  describe('friendlyError mapping', () => {
    it('prefixes the remediation hint for a known HTTP status', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({
        status: 401,
        body: { error: { message: 'invalid token' } },
      })

      await expect(service.getAccount()).rejects.toThrow(/Authentication failed/)
    })

    it('joins API error details into the message', async () => {
      mock.onGet(`${ BASE }/account`).replyWithError({
        status: 422,
        body: { error: { message: 'Validation failed', details: ['city is required', { field: 'postal_code' }] } },
      })

      await expect(service.getAccount()).rejects.toThrow(/city is required; postal_code/)
    })
  })

  // ── Triggers ──

  describe('onTrackingStatusChanged (polling)', () => {
    it('seeds state and emits nothing on the first run', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).reply({
        shipments: [
          {
            easyship_shipment_id: 'ESUS1',
            platform_order_number: 'ORD-1',
            status: 'in_transit',
            trackings: [{ tracking_number: 'TN1' }],
            checkpoints: [{ checkpoint_time: '2026-04-26T12:00:00Z', order_number: 1, primary_status: 'InTransit' }],
          },
        ],
        meta: { pagination: { next: null } },
      })

      const result = await service.onTrackingStatusChanged({ state: null })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
      expect(result.state.seenIds).toContain('ESUS1|2026-04-26T12:00:00Z|1')
    })

    it('emits one event per new checkpoint on later runs', async () => {
      const nowIso = new Date().toISOString()
      const recent = new Date(Date.now() - 60 * 1000).toISOString()

      mock.onGet(`${ BASE }/shipments/trackings`).reply({
        shipments: [
          {
            easyship_shipment_id: 'ESUS1',
            platform_order_number: 'ORD-1',
            status: 'in_transit',
            tracking_page_url: 'https://track/ESUS1',
            trackings: [{ tracking_number: 'TN1' }],
            checkpoints: [
              { checkpoint_time: recent, order_number: 2, primary_status: 'InTransit', message: 'moved', location: 'Hub' },
            ],
          },
        ],
        meta: { pagination: { next: null } },
      })

      const priorState = { since: new Date(Date.now() - 30 * 60 * 1000).toISOString(), seenIds: [] }
      const result = await service.onTrackingStatusChanged({ state: priorState })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        easyship_shipment_id: 'ESUS1',
        tracking_number: 'TN1',
        status: 'in_transit',
        primary_status: 'InTransit',
        message: 'moved',
        location: 'Hub',
      })
    })

    it('paginates through every trackings page', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).replyWith((call) => {
        if (call.query.page === 1) {
          return {
            shipments: [{ easyship_shipment_id: 'ESUS1', checkpoints: [] }],
            meta: { pagination: { next: 2 } },
          }
        }

        return {
          shipments: [{ easyship_shipment_id: 'ESUS2', checkpoints: [] }],
          meta: { pagination: { next: null } },
        }
      })

      const result = await service.onTrackingStatusChanged({ state: null })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 100, include_checkpoints: true })
      expect(mock.history[1].query).toMatchObject({ page: 2 })
      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event method', async () => {
      mock.onGet(`${ BASE }/shipments/trackings`).reply({
        shipments: [],
        meta: { pagination: { next: null } },
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onTrackingStatusChanged',
        state: null,
      })

      expect(result).toHaveProperty('state')
      expect(result.events).toEqual([])
    })
  })
})
