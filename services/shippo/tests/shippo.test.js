'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'shippo_test_token'
const BASE = 'https://api.goshippo.com'

const AUTH_HEADERS = {
  Authorization: `ShippoToken ${ API_KEY }`,
  'Shippo-API-Version': '2018-02-08',
  'Content-Type': 'application/json',
}

describe('Shippo Service', () => {
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
    it('registers the API token config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiKey',
            displayName: 'API Token',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )
    })

    it('stores the API token on the instance', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Shared request behaviour ──

  describe('request behaviour', () => {
    it('sends the Shippo auth and version headers', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ results: [] })

      await service.listAddresses()

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })

    it('adds a status-specific hint to the error message', async () => {
      mock.onGet(`${ BASE }/addresses`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { detail: 'Invalid token.' },
      })

      await expect(service.listAddresses()).rejects.toThrow(
        'Shippo API request failed (401): Authentication failed - verify the Shippo API token. {"detail":"Invalid token."}'
      )
    })

    it('covers the other documented status hints', async () => {
      for (const [status, hint] of [
        [400, 'Bad request'],
        [403, 'Forbidden'],
        [404, 'Not found'],
        [429, 'Rate limited'],
      ]) {
        mock.reset()
        mock.onGet(`${ BASE }/addresses`).replyWithError({ message: 'boom', status, body: 'oops' })

        await expect(service.listAddresses()).rejects.toThrow(`Shippo API request failed (${ status }): ${ hint }`)
      }
    })

    it('falls back to the error message and reports a missing status', async () => {
      mock.onGet(`${ BASE }/addresses`).replyWithError({ message: 'Network timeout' })

      await expect(service.listAddresses()).rejects.toThrow(
        'Shippo API request failed (no-status): Network timeout'
      )
    })

    it('reads statusCode when status is absent', async () => {
      mock.onGet(`${ BASE }/addresses`).replyWithError({ message: 'boom', statusCode: 404, body: 'gone' })

      await expect(service.listAddresses()).rejects.toThrow('Shippo API request failed (404): Not found')
    })
  })

  // ── Dictionaries backed by the API ──

  describe('getCarrierAccountsDictionary', () => {
    it('masks the account id and reports the active flag', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({
        next: null,
        results: [
          { object_id: 'ca1', carrier: 'usps', account_id: '1234567890', active: true },
          { object_id: 'ca2', carrier: 'fedex', account_id: '12', active: false },
          { object_id: 'ca3', carrier: 'ups', account_id: '', active: true },
        ],
      })

      const result = await service.getCarrierAccountsDictionary({})

      expect(mock.history[0].query).toEqual({ page: 1, results: 25 })

      expect(result).toEqual({
        items: [
          { label: 'USPS (****7890)', value: 'ca1', note: 'active' },
          { label: 'FEDEX (****12)', value: 'ca2', note: 'inactive' },
          { label: 'UPS', value: 'ca3', note: 'active' },
        ],
        cursor: null,
      })
    })

    it('filters by search and advances the cursor when there is a next page', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({
        next: `${ BASE }/carrier_accounts?page=3`,
        results: [
          { object_id: 'ca1', carrier: 'usps', account_id: '1234567890', active: true },
          { object_id: 'ca2', carrier: 'fedex', account_id: '9999', active: true },
        ],
      })

      const result = await service.getCarrierAccountsDictionary({ search: 'fed', cursor: '2' })

      expect(mock.history[0].query).toEqual({ page: 2, results: 25 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ca2')
      expect(result.cursor).toBe('3')
    })

    it('handles a missing payload and an empty result set', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({ results: [] })

      expect(await service.getCarrierAccountsDictionary()).toEqual({ items: [], cursor: null })
    })
  })

  describe('resource dictionaries', () => {
    it('maps addresses', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({
        results: [
          { object_id: 'a1', name: 'Mr Hippo', city: 'San Francisco', street1: '215 Clayton St.', state: 'CA', country: 'US' },
          { object_id: 'a2' },
        ],
      })

      const result = await service.getAddressesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Mr Hippo - San Francisco', value: 'a1', note: '215 Clayton St., San Francisco, CA, US' },
          { label: 'a2', value: 'a2', note: '' },
        ],
        cursor: null,
      })
    })

    it('maps parcels, preferring the template name', async () => {
      mock.onGet(`${ BASE }/parcels`).reply({
        results: [
          { object_id: 'p1', template: 'USPS_FlatRateEnvelope', object_state: 'VALID' },
          { object_id: 'p2', length: '10', width: '5', height: '2', distance_unit: 'in', weight: '1.5', mass_unit: 'lb' },
        ],
      })

      const result = await service.getParcelsDictionary({})

      expect(result.items).toEqual([
        { label: 'USPS_FlatRateEnvelope', value: 'p1', note: 'VALID' },
        { label: '10x5x2 in, 1.5 lb', value: 'p2', note: '' },
      ])
    })

    it('maps shipments with and without a destination city', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({
        results: [
          { object_id: 's1', status: 'SUCCESS', address_to: { city: 'Las Vegas' } },
          { object_id: 's2', status: 'QUEUED' },
        ],
      })

      const result = await service.getShipmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'To Las Vegas (SUCCESS)', value: 's1', note: 'SUCCESS' },
        { label: 'Shipment (QUEUED)', value: 's2', note: 'QUEUED' },
      ])
    })

    it('maps transactions with and without a tracking number', async () => {
      mock.onGet(`${ BASE }/transactions`).reply({
        results: [
          { object_id: 't1', status: 'SUCCESS', tracking_number: '9499907123' },
          { object_id: 't2', status: 'ERROR' },
        ],
      })

      const result = await service.getTransactionsDictionary({})

      expect(result.items).toEqual([
        { label: '9499907123 (SUCCESS)', value: 't1', note: 'SUCCESS' },
        { label: 'Label (ERROR)', value: 't2', note: 'ERROR' },
      ])
    })

    it('maps refunds', async () => {
      mock.onGet(`${ BASE }/refunds`).reply({
        results: [
          { object_id: 'r1', status: 'SUCCESS', transaction: 't1' },
          { object_id: 'r2', status: 'QUEUED' },
        ],
      })

      const result = await service.getRefundsDictionary({})

      expect(result.items).toEqual([
        { label: 'Refund SUCCESS', value: 'r1', note: 'transaction t1' },
        { label: 'Refund QUEUED', value: 'r2', note: '' },
      ])
    })

    it('maps manifests', async () => {
      mock.onGet(`${ BASE }/manifests`).reply({
        results: [
          { object_id: 'm1', status: 'SUCCESS', shipment_date: '2024-04-12T08:00:00Z' },
          { object_id: 'm2', status: 'QUEUED' },
        ],
      })

      const result = await service.getManifestsDictionary({})

      expect(result.items).toEqual([
        { label: '2024-04-12T08:00:00Z (SUCCESS)', value: 'm1', note: 'SUCCESS' },
        { label: 'Manifest (QUEUED)', value: 'm2', note: 'QUEUED' },
      ])
    })

    it('maps customs items', async () => {
      mock.onGet(`${ BASE }/customs/items`).reply({
        results: [
          { object_id: 'ci1', description: 'T-Shirt', quantity: 2 },
          { object_id: 'ci2' },
        ],
      })

      const result = await service.getCustomsItemsDictionary({})

      expect(result.items).toEqual([
        { label: 'T-Shirt', value: 'ci1', note: 'qty 2' },
        { label: 'ci2', value: 'ci2', note: '' },
      ])
    })

    it('maps customs declarations', async () => {
      mock.onGet(`${ BASE }/customs/declarations`).reply({
        results: [{ object_id: 'cd1', contents_type: 'MERCHANDISE', status: 'SUCCESS' }],
      })

      const result = await service.getCustomsDeclarationsDictionary({})

      expect(result.items).toEqual([{ label: 'MERCHANDISE (SUCCESS)', value: 'cd1', note: 'SUCCESS' }])
    })

    it('maps orders', async () => {
      mock.onGet(`${ BASE }/orders`).reply({
        results: [
          { object_id: 'o1', order_number: '#1068', order_status: 'PAID' },
          { object_id: 'o2' },
        ],
      })

      const result = await service.getOrdersDictionary({})

      expect(result.items).toEqual([
        { label: '#1068 (PAID)', value: 'o1', note: 'PAID' },
        { label: 'o2', value: 'o2', note: '' },
      ])
    })

    it('maps webhooks', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({
        results: [
          { object_id: 'w1', url: 'https://example.com/hook', event: 'track_updated', active: true },
          { object_id: 'w2', event: 'batch_created', active: false },
          { object_id: 'w3', active: false },
        ],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items).toEqual([
        { label: 'track_updated - https://example.com/hook', value: 'w1', note: 'active' },
        { label: 'batch_created', value: 'w2', note: 'inactive' },
        { label: 'w3', value: 'w3', note: 'inactive' },
      ])
    })

    it('handles a null results payload', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({})

      expect(await service.getAddressesDictionary(null)).toEqual({ items: [], cursor: null })
    })
  })

  describe('getServiceGroupsDictionary', () => {
    it('accepts a bare array response', async () => {
      mock.onGet(`${ BASE }/service-groups`).reply([
        { object_id: 'sg1', name: 'Ground', type: 'LIVE_RATE' },
        { object_id: 'sg2', name: 'Flat', type: 'FLAT_RATE' },
      ])

      const result = await service.getServiceGroupsDictionary({})

      expect(mock.history[0].query).toEqual({})

      expect(result).toEqual({
        items: [
          { label: 'Ground', value: 'sg1', note: 'LIVE_RATE' },
          { label: 'Flat', value: 'sg2', note: 'FLAT_RATE' },
        ],
      })
    })

    it('accepts a paged response and filters by search', async () => {
      mock.onGet(`${ BASE }/service-groups`).reply({
        results: [
          { object_id: 'sg1', name: 'Ground' },
          { object_id: 'sg2', name: 'Flat' },
        ], 
      })

      const result = await service.getServiceGroupsDictionary({ search: 'flat' })

      expect(result.items).toEqual([{ label: 'Flat', value: 'sg2', note: '' }])
    })

    it('handles a missing payload and an empty response', async () => {
      mock.onGet(`${ BASE }/service-groups`).reply(null)

      expect(await service.getServiceGroupsDictionary()).toEqual({ items: [] })
    })
  })

  // ── Static dictionaries ──

  describe('static dictionaries', () => {
    const cases = [
      ['getDistanceUnitsDictionary', 'in'],
      ['getMassUnitsDictionary', 'lb'],
      ['getLabelFileTypesDictionary', 'PDF'],
      ['getCarriersDictionary', 'usps'],
      ['getCurrenciesDictionary', 'USD'],
      ['getCountriesDictionary', 'US'],
      ['getContentsTypesDictionary', 'MERCHANDISE'],
      ['getNonDeliveryOptionsDictionary', 'RETURN'],
      ['getIncotermsDictionary', 'DDP'],
      ['getEELPFCsDictionary', 'AES_ITN'],
      ['getOrderStatusesDictionary', 'PAID'],
    ]

    it.each(cases)('%s returns items containing %s and issues no request', (method, expectedValue) => {
      const result = service[method]()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.map(item => item.value)).toContain(expectedValue)
      expect(result.items.every(item => item.label && item.note)).toBe(true)
      expect(mock.history).toHaveLength(0)
    })

    it('filters static dictionaries by case-insensitive search on label and value', () => {
      expect(service.getMassUnitsDictionary({ search: 'POUND' }).items)
        .toEqual([{ label: 'Pounds (lb)', value: 'lb', note: 'Imperial' }])

      expect(service.getCurrenciesDictionary({ search: 'gbp' }).items).toHaveLength(1)
      expect(service.getCountriesDictionary({ search: 'zzz' }).items).toEqual([])
    })
  })

  describe('getServiceLevelsDictionary', () => {
    it('returns every carrier service level when no carrier criteria is given', () => {
      const result = service.getServiceLevelsDictionary({})

      expect(result.items.length).toBeGreaterThan(20)
      expect(result.items.some(item => item.note === 'usps')).toBe(true)
      expect(result.items.some(item => item.note === 'royal_mail')).toBe(true)
    })

    it('restricts the levels to the selected carrier', () => {
      const result = service.getServiceLevelsDictionary({ criteria: { carrier: 'ups' } })

      expect(result.items.every(item => item.note === 'ups')).toBe(true)
      expect(result.items.map(item => item.value)).toContain('ups_ground')
    })

    it('falls back to all carriers for an unknown carrier', () => {
      const result = service.getServiceLevelsDictionary({ criteria: { carrier: 'nope' } })

      expect(result.items.some(item => item.note === 'fedex')).toBe(true)
    })

    it('filters by search and handles a missing payload', () => {
      const filtered = service.getServiceLevelsDictionary({ search: 'media mail' })

      expect(filtered.items).toEqual([{ label: 'USPS Media Mail', value: 'usps_media_mail', note: 'usps' }])
      expect(service.getServiceLevelsDictionary().items.length).toBeGreaterThan(0)
    })
  })

  // ── Schema loader ──

  describe('addressSchema', () => {
    it('describes the address fields and binds the country dictionary', async () => {
      const schema = await service.addressSchema()

      expect(schema.map(field => field.name)).toEqual([
        'name', 'company', 'street1', 'street2', 'city', 'state', 'zip', 'country', 'phone', 'email',
      ])

      expect(schema.find(field => field.name === 'country').dictionary).toBe('getCountriesDictionary')
      expect(schema.filter(field => field.required).map(field => field.name)).toEqual(['name', 'street1', 'city', 'country'])
    })
  })

  // ── Addresses ──

  describe('addresses', () => {
    it('creates an address with validation disabled by default', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ object_id: 'a1' })

      const result = await service.createAddress('Mr Hippo', 'Shippo', '215 Clayton St.', undefined, undefined,
        'San Francisco', 'CA', '94117', 'US', '+15553419393', 'hippo@example.com', true)

      expect(result).toEqual({ object_id: 'a1' })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        name: 'Mr Hippo',
        company: 'Shippo',
        street1: '215 Clayton St.',
        street2: undefined,
        street3: undefined,
        city: 'San Francisco',
        state: 'CA',
        zip: '94117',
        country: 'US',
        phone: '+15553419393',
        email: 'hippo@example.com',
        is_residential: true,
        validate: false,
      })
    })

    it('enables validation only for a strict true', async () => {
      mock.onPost(`${ BASE }/addresses`).reply({ object_id: 'a2' })

      await service.createAddress('Mr Hippo', null, '215 Clayton St.', null, null, 'San Francisco', 'CA', '94117', 'US',
        null, null, null, true)

      expect(mock.history[0].body.validate).toBe(true)
    })

    it('lists addresses without paging by default', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ results: [] })

      await service.listAddresses()

      expect(mock.history[0].query).toEqual({})
    })

    it('applies paging and caps the page size at 100', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ results: [] })

      await service.listAddresses(2, 500)

      expect(mock.history[0].query).toEqual({ page: 2, results: 100 })
    })

    it('ignores non-positive paging values', async () => {
      mock.onGet(`${ BASE }/addresses`).reply({ results: [] })

      await service.listAddresses(0, -5)

      expect(mock.history[0].query).toEqual({})
    })

    it('fetches and validates a single address, url-encoding the id', async () => {
      mock.onGet(`${ BASE }/addresses/a%2F1`).reply({ object_id: 'a/1' })
      mock.onGet(`${ BASE }/addresses/a1/validate`).reply({ validation_results: { is_valid: true } })

      expect(await service.getAddress('a/1')).toEqual({ object_id: 'a/1' })
      expect(await service.validateAddress('a1')).toEqual({ validation_results: { is_valid: true } })
    })
  })

  // ── Parcels ──

  describe('parcels', () => {
    it('creates a parcel and nulls a missing template', async () => {
      mock.onPost(`${ BASE }/parcels`).reply({ object_id: 'p1' })

      await service.createParcel(10, 5, 2, 'in', 1.5, 'lb')

      expect(mock.history[0].body).toEqual({
        length: 10,
        width: 5,
        height: 2,
        distance_unit: 'in',
        weight: 1.5,
        mass_unit: 'lb',
        template: null,
      })
    })

    it('passes a carrier template through', async () => {
      mock.onPost(`${ BASE }/parcels`).reply({ object_id: 'p2' })

      await service.createParcel(10, 5, 2, 'in', 1.5, 'lb', 'USPS_FlatRateEnvelope')

      expect(mock.history[0].body.template).toBe('USPS_FlatRateEnvelope')
    })

    it('lists and fetches parcels', async () => {
      mock.onGet(`${ BASE }/parcels`).reply({ results: [] })
      mock.onGet(`${ BASE }/parcels/p1`).reply({ object_id: 'p1' })

      await service.listParcels(1, 10)
      expect(mock.history[0].query).toEqual({ page: 1, results: 10 })

      expect(await service.getParcel('p1')).toEqual({ object_id: 'p1' })
    })
  })

  // ── Shipments & rates ──

  describe('shipments', () => {
    it('wraps a single parcel in an array and omits the optional blocks', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ object_id: 's1' })

      await service.createShipment('a1', 'a2', 'p1')

      expect(mock.history[0].body).toEqual({
        address_from: 'a1',
        address_to: 'a2',
        parcels: ['p1'],
        async: false,
      })
    })

    it('keeps an array of parcels and includes customs and extra', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ object_id: 's2' })

      await service.createShipment('a1', 'a2', ['p1', 'p2'], 'cd1', { signature_confirmation: 'STANDARD' }, true)

      expect(mock.history[0].body).toEqual({
        address_from: 'a1',
        address_to: 'a2',
        parcels: ['p1', 'p2'],
        async: true,
        customs_declaration: 'cd1',
        extra: { signature_confirmation: 'STANDARD' },
      })
    })

    it('drops a falsy parcel value', async () => {
      mock.onPost(`${ BASE }/shipments`).reply({ object_id: 's3' })

      await service.createShipment('a1', 'a2', null)

      expect(mock.history[0].body.parcels).toEqual([])
    })

    it('lists and fetches shipments', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ results: [] })
      mock.onGet(`${ BASE }/shipments/s1`).reply({ object_id: 's1' })

      await service.listShipments(3)
      expect(mock.history[0].query).toEqual({ page: 3 })

      expect(await service.getShipment('s1')).toEqual({ object_id: 's1' })
    })

    it('fetches shipment rates without a currency', async () => {
      mock.onGet(`${ BASE }/shipments/s1/rates`).reply({ results: [] })

      await service.getShipmentRates('s1')

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/s1/rates`)
      expect(mock.history[0].query).toEqual({})
    })

    it('appends the currency segment and paging', async () => {
      mock.onGet(`${ BASE }/shipments/s1/rates/EUR`).reply({ results: [] })

      await service.getShipmentRates('s1', 'EUR', 1, 5)

      expect(mock.history[0].url).toBe(`${ BASE }/shipments/s1/rates/EUR`)
      expect(mock.history[0].query).toEqual({ page: 1, results: 5 })
    })

    it('fetches a rate by id', async () => {
      mock.onGet(`${ BASE }/rates/r1`).reply({ object_id: 'r1', amount: '5.50' })

      expect(await service.getRate('r1')).toEqual({ object_id: 'r1', amount: '5.50' })
    })
  })

  // ── Transactions ──

  describe('transactions', () => {
    it('creates a transaction with nulled optional fields', async () => {
      mock.onPost(`${ BASE }/transactions`).reply({ object_id: 't1' })

      await service.createTransaction('r1')

      expect(mock.history[0].body).toEqual({
        rate: 'r1',
        label_file_type: null,
        metadata: null,
        async: false,
      })
    })

    it('passes the label file type, metadata and async flag', async () => {
      mock.onPost(`${ BASE }/transactions`).reply({ object_id: 't2' })

      await service.createTransaction('r1', 'PDF_4x6', 'Order #1068', true)

      expect(mock.history[0].body).toEqual({
        rate: 'r1',
        label_file_type: 'PDF_4x6',
        metadata: 'Order #1068',
        async: true,
      })
    })

    it('maps the status labels to Shippo enum values', async () => {
      mock.onGet(`${ BASE }/transactions`).reply({ results: [] })

      await service.listTransactions(1, 10, 'r1', 'ca1', 'Refund Pending', 'In Transit')

      expect(mock.history[0].query).toEqual({
        page: 1,
        results: 10,
        rate: 'r1',
        carrier_account: 'ca1',
        object_status: 'REFUNDPENDING',
        tracking_status: 'TRANSIT',
      })
    })

    it('passes already-normalized statuses through and omits empty filters', async () => {
      mock.onGet(`${ BASE }/transactions`).reply({ results: [] })

      await service.listTransactions(undefined, undefined, undefined, undefined, 'SUCCESS', 'DELIVERED')

      expect(mock.history[0].query).toEqual({ object_status: 'SUCCESS', tracking_status: 'DELIVERED' })
    })

    it('fetches a single transaction', async () => {
      mock.onGet(`${ BASE }/transactions/t1`).reply({ object_id: 't1' })

      expect(await service.getTransaction('t1')).toEqual({ object_id: 't1' })
    })
  })

  // ── Batches ──

  describe('batches', () => {
    it('creates a batch and wraps a single shipment', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ object_id: 'b1' })

      await service.createBatch('ca1', 'usps_priority', { shipment: {} })

      expect(mock.history[0].body).toEqual({
        default_carrier_account: 'ca1',
        default_servicelevel_token: 'usps_priority',
        batch_shipments: [{ shipment: {} }],
      })
    })

    it('includes the optional label file type and metadata', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ object_id: 'b2' })

      await service.createBatch('ca1', 'usps_priority', [{ shipment: {} }], 'PDF_4x6', 'batch 1')

      expect(mock.history[0].body).toMatchObject({ label_filetype: 'PDF_4x6', metadata: 'batch 1' })
    })

    it('fetches a batch with paging', async () => {
      mock.onGet(`${ BASE }/batches/b1`).reply({ object_id: 'b1' })

      await service.getBatch('b1', 2, 20)

      expect(mock.history[0].query).toEqual({ page: 2, results: 20 })
    })

    it('purchases a batch', async () => {
      mock.onPost(`${ BASE }/batches/b1/purchase`).reply({ object_id: 'b1', status: 'PURCHASING' })

      const result = await service.purchaseBatch('b1')

      expect(result).toEqual({ object_id: 'b1', status: 'PURCHASING' })
      expect(mock.history[0].body).toBeNull()
    })

    it('adds shipments to a batch, wrapping a single value', async () => {
      mock.onPost(`${ BASE }/batches/b1/add_shipments`).reply({ object_id: 'b1' })

      await service.addShipmentsToBatch('b1', { shipment: 's1' })

      expect(mock.history[0].body).toEqual([{ shipment: 's1' }])
    })

    it('removes shipments from a batch, splitting a comma-separated string', async () => {
      mock.onPost(`${ BASE }/batches/b1/remove_shipments`).reply({ object_id: 'b1' })

      await service.removeShipmentsFromBatch('b1', 'bs1, bs2 ,, bs3')

      expect(mock.history[0].body).toEqual(['bs1', 'bs2', 'bs3'])
    })

    it('removes shipments from a batch given an array', async () => {
      mock.onPost(`${ BASE }/batches/b1/remove_shipments`).reply({ object_id: 'b1' })

      await service.removeShipmentsFromBatch('b1', ['bs1', 'bs2'])

      expect(mock.history[0].body).toEqual(['bs1', 'bs2'])
    })
  })

  // ── Tracking ──

  describe('tracking', () => {
    it('registers a tracker', async () => {
      mock.onPost(`${ BASE }/tracks`).reply({ tracking_number: '9499907123' })

      await service.createTracker('usps', '9499907123')

      expect(mock.history[0].body).toEqual({ carrier: 'usps', tracking_number: '9499907123', metadata: null })
    })

    it('passes tracker metadata', async () => {
      mock.onPost(`${ BASE }/tracks`).reply({ tracking_number: '9499907123' })

      await service.createTracker('usps', '9499907123', 'Order #1068')

      expect(mock.history[0].body.metadata).toBe('Order #1068')
    })

    it('fetches the tracking status, url-encoding both segments', async () => {
      mock.onGet(`${ BASE }/tracks/usps/9499907123`).reply({ tracking_status: { status: 'DELIVERED' } })

      const result = await service.getTrackingStatus('usps', '9499907123')

      expect(result).toEqual({ tracking_status: { status: 'DELIVERED' } })
    })
  })

  // ── Refunds ──

  describe('refunds', () => {
    it('creates a refund', async () => {
      mock.onPost(`${ BASE }/refunds`).reply({ object_id: 'rf1', status: 'QUEUED' })

      await service.createRefund('t1')

      expect(mock.history[0].body).toEqual({ transaction: 't1', async: false })
    })

    it('creates an async refund', async () => {
      mock.onPost(`${ BASE }/refunds`).reply({ object_id: 'rf2' })

      await service.createRefund('t1', true)

      expect(mock.history[0].body.async).toBe(true)
    })

    it('lists and fetches refunds', async () => {
      mock.onGet(`${ BASE }/refunds`).reply({ results: [] })
      mock.onGet(`${ BASE }/refunds/rf1`).reply({ object_id: 'rf1' })

      await service.listRefunds(1, 5)
      expect(mock.history[0].query).toEqual({ page: 1, results: 5 })

      expect(await service.getRefund('rf1')).toEqual({ object_id: 'rf1' })
    })
  })

  // ── Manifests ──

  describe('manifests', () => {
    it('creates a manifest and wraps a single transaction', async () => {
      mock.onPost(`${ BASE }/manifests`).reply({ object_id: 'm1' })

      await service.createManifest('ca1', '2024-04-12', 'a1', 't1')

      expect(mock.history[0].body).toEqual({
        carrier_account: 'ca1',
        shipment_date: '2024-04-12',
        address_from: 'a1',
        transactions: ['t1'],
        async: false,
      })
    })

    it('keeps an array of transactions and honours the async flag', async () => {
      mock.onPost(`${ BASE }/manifests`).reply({ object_id: 'm2' })

      await service.createManifest('ca1', '2024-04-12', 'a1', ['t1', 't2'], true)

      expect(mock.history[0].body).toMatchObject({ transactions: ['t1', 't2'], async: true })
    })

    it('lists and fetches manifests', async () => {
      mock.onGet(`${ BASE }/manifests`).reply({ results: [] })
      mock.onGet(`${ BASE }/manifests/m1`).reply({ object_id: 'm1' })

      await service.listManifests()
      expect(await service.getManifest('m1')).toEqual({ object_id: 'm1' })
    })
  })

  // ── Customs ──

  describe('customs items', () => {
    it('creates a customs item with nulled optional fields', async () => {
      mock.onPost(`${ BASE }/customs/items`).reply({ object_id: 'ci1' })

      await service.createCustomsItem('T-Shirt', 2, '0.4', 'lb', '20', 'USD', 'US')

      expect(mock.history[0].body).toEqual({
        description: 'T-Shirt',
        quantity: 2,
        net_weight: '0.4',
        mass_unit: 'lb',
        value_amount: '20',
        value_currency: 'USD',
        origin_country: 'US',
        tariff_number: null,
        sku_code: null,
        hs_code: null,
        metadata: null,
      })
    })

    it('passes the optional customs codes', async () => {
      mock.onPost(`${ BASE }/customs/items`).reply({ object_id: 'ci2' })

      await service.createCustomsItem('T-Shirt', 2, '0.4', 'lb', '20', 'USD', 'US', '6109', 'SKU-1', '610910', 'meta')

      expect(mock.history[0].body).toMatchObject({
        tariff_number: '6109',
        sku_code: 'SKU-1',
        hs_code: '610910',
        metadata: 'meta',
      })
    })

    it('lists and fetches customs items', async () => {
      mock.onGet(`${ BASE }/customs/items`).reply({ results: [] })
      mock.onGet(`${ BASE }/customs/items/ci1`).reply({ object_id: 'ci1' })

      await service.listCustomsItems(1, 10)
      expect(mock.history[0].query).toEqual({ page: 1, results: 10 })

      expect(await service.getCustomsItem('ci1')).toEqual({ object_id: 'ci1' })
    })
  })

  describe('customs declarations', () => {
    it('creates a declaration with the minimum fields', async () => {
      mock.onPost(`${ BASE }/customs/declarations`).reply({ object_id: 'cd1' })

      await service.createCustomsDeclaration('MERCHANDISE', undefined, 'RETURN', true, 'Mr Hippo', 'ci1')

      expect(mock.history[0].body).toEqual({
        contents_type: 'MERCHANDISE',
        contents_explanation: '',
        non_delivery_option: 'RETURN',
        certify: true,
        certify_signer: 'Mr Hippo',
        items: ['ci1'],
      })
    })

    it('maps the B13A filing option label and includes the optional fields', async () => {
      mock.onPost(`${ BASE }/customs/declarations`).reply({ object_id: 'cd2' })

      await service.createCustomsDeclaration('OTHER', 'Spare parts', 'ABANDON', false, 'Mr Hippo',
        ['ci1', 'ci2'], 'DDP', 'NOEEI_30_37_a', 'Filed Electronically', 'B13A-1')

      expect(mock.history[0].body).toEqual({
        contents_type: 'OTHER',
        contents_explanation: 'Spare parts',
        non_delivery_option: 'ABANDON',
        certify: false,
        certify_signer: 'Mr Hippo',
        items: ['ci1', 'ci2'],
        incoterm: 'DDP',
        eel_pfc: 'NOEEI_30_37_a',
        b13a_filing_option: 'FILED_ELECTRONICALLY',
        b13a_number: 'B13A-1',
      })
    })

    it('passes an already-normalized B13A value through', async () => {
      mock.onPost(`${ BASE }/customs/declarations`).reply({ object_id: 'cd3' })

      await service.createCustomsDeclaration('GIFT', '', 'RETURN', true, 'Mr Hippo', [], undefined, undefined,
        'NOT_REQUIRED')

      expect(mock.history[0].body.b13a_filing_option).toBe('NOT_REQUIRED')
      expect(mock.history[0].body.items).toEqual([])
    })

    it('lists and fetches customs declarations', async () => {
      mock.onGet(`${ BASE }/customs/declarations`).reply({ results: [] })
      mock.onGet(`${ BASE }/customs/declarations/cd1`).reply({ object_id: 'cd1' })

      await service.listCustomsDeclarations(2)
      expect(mock.history[0].query).toEqual({ page: 2 })

      expect(await service.getCustomsDeclaration('cd1')).toEqual({ object_id: 'cd1' })
    })
  })

  // ── Carrier accounts ──

  describe('carrier accounts', () => {
    it('lists carrier accounts with filters', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({ results: [] })

      await service.listCarrierAccounts('usps', true, 1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, results: 10, carrier: 'usps', service_levels: true })
    })

    it('omits the filters when they are not requested', async () => {
      mock.onGet(`${ BASE }/carrier_accounts`).reply({ results: [] })

      await service.listCarrierAccounts()

      expect(mock.history[0].query).toEqual({})
    })

    it('fetches a single carrier account', async () => {
      mock.onGet(`${ BASE }/carrier_accounts/ca1`).reply({ object_id: 'ca1' })

      expect(await service.getCarrierAccount('ca1')).toEqual({ object_id: 'ca1' })
    })

    it('creates a carrier account with only the required fields', async () => {
      mock.onPost(`${ BASE }/carrier_accounts`).reply({ object_id: 'ca2' })

      await service.createCarrierAccount('ups', '1234')

      expect(mock.history[0].body).toEqual({ carrier: 'ups', account_id: '1234' })
    })

    it('includes parameters, the active flag and metadata when supplied', async () => {
      mock.onPost(`${ BASE }/carrier_accounts`).reply({ object_id: 'ca3' })

      await service.createCarrierAccount('ups', '1234', { zip: '94117' }, false, 'meta')

      expect(mock.history[0].body).toEqual({
        carrier: 'ups',
        account_id: '1234',
        parameters: { zip: '94117' },
        active: false,
        metadata: 'meta',
      })
    })

    it('ignores non-object parameters', async () => {
      mock.onPost(`${ BASE }/carrier_accounts`).reply({ object_id: 'ca4' })

      await service.createCarrierAccount('ups', '1234', 'not-an-object')

      expect(mock.history[0].body).not.toHaveProperty('parameters')
    })

    it('updates a carrier account with a PUT containing only the supplied fields', async () => {
      mock.onPut(`${ BASE }/carrier_accounts/ca1`).reply({ object_id: 'ca1', active: true })

      await service.updateCarrierAccount('ca1', true, { zip: '94117' }, 'meta')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ active: true, parameters: { zip: '94117' }, metadata: 'meta' })
    })

    it('sends an empty update payload when nothing is supplied', async () => {
      mock.onPut(`${ BASE }/carrier_accounts/ca1`).reply({ object_id: 'ca1' })

      await service.updateCarrierAccount('ca1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('lists orders with the optional filters', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ results: [] })

      await service.listOrders(1, 10, 'PAID', 'hippo')

      expect(mock.history[0].query).toEqual({ page: 1, results: 10, order_status: 'PAID', q: 'hippo' })
    })

    it('fetches a single order', async () => {
      mock.onGet(`${ BASE }/orders/o1`).reply({ object_id: 'o1' })

      expect(await service.getOrder('o1')).toEqual({ object_id: 'o1' })
    })

    it('creates an order and defaults the line items to an array', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ object_id: 'o2' })

      const toAddress = { name: 'Mr Hippo', city: 'San Francisco', country: 'US' }

      await service.createOrder('#1068', 'PAID', toAddress, undefined, undefined, '2024-04-12T08:00:00Z',
        '20.00', '1.50', 'USD', '0.4', 'lb', '5.00', 'USD', 'USPS Priority', 'notes')

      expect(mock.history[0].body).toEqual({
        order_number: '#1068',
        order_status: 'PAID',
        to_address: toAddress,
        from_address: undefined,
        line_items: [],
        placed_at: '2024-04-12T08:00:00Z',
        total_price: '20.00',
        total_tax: '1.50',
        currency: 'USD',
        weight: '0.4',
        weight_unit: 'lb',
        shipping_cost: '5.00',
        shipping_cost_currency: 'USD',
        shipping_method: 'USPS Priority',
        notes: 'notes',
      })
    })

    it('keeps supplied line items and the from address', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ object_id: 'o3' })

      await service.createOrder('#1069', 'PAID', { name: 'A' }, { name: 'B' }, [{ title: 'T-Shirt', quantity: 1 }],
        '2024-04-12T08:00:00Z')

      expect(mock.history[0].body.from_address).toEqual({ name: 'B' })
      expect(mock.history[0].body.line_items).toEqual([{ title: 'T-Shirt', quantity: 1 }])
    })
  })

  // ── Pickups ──

  describe('pickups', () => {
    it('creates a pickup with defaults', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ object_id: 'pk1' })

      await service.createPickup('ca1', undefined, '2024-04-12T08:00:00Z', '2024-04-12T18:00:00Z', 't1')

      expect(mock.history[0].body).toEqual({
        carrier_account: 'ca1',
        location: {},
        requested_start_time: '2024-04-12T08:00:00Z',
        requested_end_time: '2024-04-12T18:00:00Z',
        transactions: ['t1'],
        is_test: false,
      })
    })

    it('maps the building location and building type labels', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ object_id: 'pk2' })

      await service.createPickup('ca1', {
        address: 'a1',
        building_location_type: 'Security Deck (DHL Express only)',
        building_type: 'Suite',
      }, '2024-04-12T08:00:00Z', '2024-04-12T18:00:00Z', ['t1', 't2'], true)

      expect(mock.history[0].body.location).toEqual({
        address: 'a1',
        building_location_type: 'Security Deck',
        building_type: 'suite',
      })

      expect(mock.history[0].body.is_test).toBe(true)
      expect(mock.history[0].body.transactions).toEqual(['t1', 't2'])
    })

    it('passes already-normalized location values through', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ object_id: 'pk3' })

      await service.createPickup('ca1', { building_location_type: 'Front Door', building_type: 'floor' },
        '2024-04-12T08:00:00Z', '2024-04-12T18:00:00Z', [])

      expect(mock.history[0].body.location).toEqual({ building_location_type: 'Front Door', building_type: 'floor' })
    })

    it('does not mutate the caller-supplied location object', async () => {
      mock.onPost(`${ BASE }/pickups`).reply({ object_id: 'pk4' })

      const location = { building_type: 'Suite' }

      await service.createPickup('ca1', location, 'a', 'b', [])

      expect(location.building_type).toBe('Suite')
    })

    it('fetches a pickup', async () => {
      mock.onGet(`${ BASE }/pickups/pk1`).reply({ object_id: 'pk1' })

      expect(await service.getPickup('pk1')).toEqual({ object_id: 'pk1' })
    })
  })

  // ── Service groups ──

  describe('service groups', () => {
    it('lists service groups', async () => {
      mock.onGet(`${ BASE }/service-groups`).reply([{ object_id: 'sg1' }])

      expect(await service.listServiceGroups()).toEqual([{ object_id: 'sg1' }])
    })

    it('maps the type label and posts the minimum payload', async () => {
      mock.onPost(`${ BASE }/service-groups`).reply({ object_id: 'sg1' })

      await service.createServiceGroup('Ground', 'Cheapest', 'Live Rate', [{ account_object_id: 'ca1' }])

      expect(mock.history[0].body).toEqual({
        name: 'Ground',
        description: 'Cheapest',
        type: 'LIVE_RATE',
        service_levels: [{ account_object_id: 'ca1' }],
      })
    })

    it('includes the flat rate and free shipping fields as strings', async () => {
      mock.onPost(`${ BASE }/service-groups`).reply({ object_id: 'sg2' })

      await service.createServiceGroup('Flat', 'Flat rate', 'Flat Rate', [], 9.99, 'USD', 50, 'USD', '-10')

      expect(mock.history[0].body).toEqual({
        name: 'Flat',
        description: 'Flat rate',
        type: 'FLAT_RATE',
        service_levels: [],
        flat_rate: '9.99',
        flat_rate_currency: 'USD',
        free_shipping_threshold_min: '50',
        free_shipping_threshold_currency: 'USD',
        rate_adjustment: -10,
      })
    })

    it('defaults non-array service levels to an empty array', async () => {
      mock.onPost(`${ BASE }/service-groups`).reply({ object_id: 'sg3' })

      await service.createServiceGroup('Free', 'Free', 'FREE_SHIPPING', undefined)

      expect(mock.history[0].body.type).toBe('FREE_SHIPPING')
      expect(mock.history[0].body.service_levels).toEqual([])
    })

    it('rejects a non-numeric rate adjustment before issuing a request', async () => {
      await expect(service.createServiceGroup('Bad', 'Bad', 'Live Rate', [], null, null, null, null, 'abc'))
        .rejects.toThrow('Rate Adjustment must be an integer percent (for example 5 or -10).')

      expect(mock.history).toHaveLength(0)
    })

    it('deletes a service group and echoes back the id', async () => {
      mock.onDelete(`${ BASE }/service-groups/sg1`).reply('')

      const result = await service.deleteServiceGroup('sg1')

      expect(result).toBe('sg1')
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    it('lists and fetches webhooks', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ results: [] })
      mock.onGet(`${ BASE }/webhooks/w1`).reply({ object_id: 'w1' })

      expect(await service.listWebhooks()).toEqual({ results: [] })
      expect(await service.getWebhook('w1')).toEqual({ object_id: 'w1' })
    })

    it('creates a webhook with is_test defaulted to false', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ object_id: 'w1' })

      await service.createWebhook('https://example.com/hook', 'track_updated')

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/hook',
        event: 'track_updated',
        is_test: false,
      })
    })

    it('includes the active flag when supplied', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ object_id: 'w2' })

      await service.createWebhook('https://example.com/hook', 'track_updated', true, false)

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/hook',
        event: 'track_updated',
        is_test: true,
        active: false,
      })
    })

    it('updates a webhook with a PUT', async () => {
      mock.onPut(`${ BASE }/webhooks/w1`).reply({ object_id: 'w1' })

      await service.updateWebhook('w1', 'https://example.com/hook2', 'batch_created', false, true)

      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/hook2',
        event: 'batch_created',
        is_test: false,
        active: true,
      })
    })

    it('deletes a webhook and returns a confirmation object', async () => {
      mock.onDelete(`${ BASE }/webhooks/w1`).reply('')

      const result = await service.deleteWebhook('w1')

      expect(result).toEqual({ object_id: 'w1', deleted: true })
    })
  })

  // ── Polling trigger ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${ BASE }/tracks/usps/9499907123`).reply({ tracking_status: { status: 'TRANSIT' } })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onTrackingUpdated',
        triggerData: { carrier: 'usps', trackingNumber: '9499907123' },
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ status: 'TRANSIT', statusDate: null })
    })

    it('rejects an unknown event name', async () => {
      await expect(service.handleTriggerPollingForEvent({ eventName: 'nope' }))
        .rejects.toThrow('Unknown polling event "nope"')
    })

    it('rejects a missing event name', async () => {
      await expect(service.handleTriggerPollingForEvent({})).rejects.toThrow('Unknown polling event "undefined"')
    })
  })

  describe('onTrackingUpdated', () => {
    const TRACK_URL = `${ BASE }/tracks/usps/9499907123`
    const triggerData = { carrier: 'usps', trackingNumber: '9499907123' }

    it('requires both the carrier and the tracking number', async () => {
      await expect(service.onTrackingUpdated({ triggerData: { carrier: 'usps' } }))
        .rejects.toThrow('Both "carrier" and "trackingNumber" are required for the On Tracking Status Updated trigger.')

      await expect(service.onTrackingUpdated({})).rejects.toThrow(/are required/)
      expect(mock.history).toHaveLength(0)
    })

    it('returns the tracker as a sample event in learning mode', async () => {
      const tracker = { tracking_status: { status: 'TRANSIT', status_date: '2024-04-12T08:00:00Z' } }

      mock.onGet(TRACK_URL).reply(tracker)

      const result = await service.onTrackingUpdated({ triggerData, learningMode: true, state: { status: 'PRE_TRANSIT' } })

      expect(result).toEqual({ events: [tracker], state: null })
    })

    it('seeds the state on the first poll without emitting events', async () => {
      mock.onGet(TRACK_URL).reply({ tracking_status: { status: 'PRE_TRANSIT', status_date: '2024-04-12T08:00:00Z' } })

      const result = await service.onTrackingUpdated({ triggerData, state: {} })

      expect(result).toEqual({ events: [], state: { status: 'PRE_TRANSIT', statusDate: '2024-04-12T08:00:00Z' } })
    })

    it('handles a tracker with no tracking status at all', async () => {
      mock.onGet(TRACK_URL).reply({})

      const result = await service.onTrackingUpdated({ triggerData })

      expect(result).toEqual({ events: [], state: { status: null, statusDate: null } })
    })

    it('emits an event when the status changes', async () => {
      const tracker = { tracking_status: { status: 'DELIVERED', status_date: '2024-04-13T08:00:00Z' } }

      mock.onGet(TRACK_URL).reply(tracker)

      const result = await service.onTrackingUpdated({
        triggerData,
        state: { status: 'TRANSIT', statusDate: '2024-04-12T08:00:00Z' },
      })

      expect(result.events).toEqual([tracker])
      expect(result.state).toEqual({ status: 'DELIVERED', statusDate: '2024-04-13T08:00:00Z' })
    })

    it('emits an event when only the status date changes', async () => {
      mock.onGet(TRACK_URL).reply({ tracking_status: { status: 'TRANSIT', status_date: '2024-04-13T08:00:00Z' } })

      const result = await service.onTrackingUpdated({
        triggerData,
        state: { status: 'TRANSIT', statusDate: '2024-04-12T08:00:00Z' },
      })

      expect(result.events).toHaveLength(1)
    })

    it('emits nothing when nothing changed', async () => {
      mock.onGet(TRACK_URL).reply({ tracking_status: { status: 'TRANSIT', status_date: '2024-04-12T08:00:00Z' } })

      const result = await service.onTrackingUpdated({
        triggerData,
        state: { status: 'TRANSIT', statusDate: '2024-04-12T08:00:00Z' },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ status: 'TRANSIT', statusDate: '2024-04-12T08:00:00Z' })
    })
  })
})
