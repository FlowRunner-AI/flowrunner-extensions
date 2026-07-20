'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Easyship Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('easyship')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Account ──

  describe('getAccount', () => {
    it('returns account details with expected shape', async () => {
      const response = await service.getAccount()

      expect(response).toHaveProperty('account')
      expect(response.account).toHaveProperty('name')
    })
  })

  // ── Addresses ──

  describe('listAddresses', () => {
    it('returns addresses with expected shape', async () => {
      const response = await service.listAddresses(1, 5)

      expect(response).toHaveProperty('addresses')
      expect(Array.isArray(response.addresses)).toBe(true)
    })
  })

  describe('getAddressesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getAddressesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createAddress + updateAddress + deactivateAddress', () => {
    let addressId

    it('creates an address', async () => {
      const response = await service.createAddress(
        '123 Test Road',
        'Kyiv',
        'UA',
        `E2E Co ${ suffix }`.slice(0, 27),
        'E2E Tester',
        '+380441234567',
        `e2e-${ suffix }@example.com`
      )

      expect(response).toHaveProperty('address')
      expect(response.address).toHaveProperty('id')
      addressId = response.address.id
    })

    it('updates the created address', async () => {
      if (!addressId) return

      const response = await service.updateAddress(
        addressId,
        '456 Updated Road',
        'Lviv',
        'UA',
        `E2E Co ${ suffix }`.slice(0, 27),
        'E2E Tester',
        '+380441234567',
        `e2e-${ suffix }@example.com`
      )

      expect(response).toHaveProperty('address')
    })

    it('deactivates the created address', async () => {
      if (!addressId) return

      const response = await service.deactivateAddress(addressId)

      expect(response).toBeDefined()
    })
  })

  // ── Boxes ──

  describe('listBoxes', () => {
    it('returns boxes with expected shape', async () => {
      const response = await service.listBoxes(1, 5)

      expect(response).toHaveProperty('boxes')
      expect(Array.isArray(response.boxes)).toBe(true)
    })
  })

  describe('getBoxesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBoxesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createBox + updateBox + deleteBox', () => {
    let boxId

    it('creates a box', async () => {
      const response = await service.createBox(`E2E Box ${ suffix }`.slice(0, 27), 10, 10, 5, 0.2)

      expect(response).toHaveProperty('box')
      expect(response.box).toHaveProperty('id')
      boxId = response.box.id
    })

    it('updates the created box', async () => {
      if (!boxId) return

      const response = await service.updateBox(boxId, true)

      expect(response).toBeDefined()
    })

    it('deletes the created box', async () => {
      if (!boxId) return

      const response = await service.deleteBox(boxId)

      expect(response).toBeDefined()
    })
  })

  // ── Couriers ──

  describe('listCouriers', () => {
    it('returns couriers with expected shape', async () => {
      const response = await service.listCouriers(1, 5)

      expect(response).toHaveProperty('couriers')
      expect(Array.isArray(response.couriers)).toBe(true)
    })
  })

  describe('getCouriersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCouriersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('returns products with expected shape', async () => {
      const response = await service.listProducts(1, 5)

      expect(response).toHaveProperty('products')
      expect(Array.isArray(response.products)).toBe(true)
    })
  })

  describe('getProductsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getProductsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createProduct + updateProduct + deleteProduct', () => {
    let productId

    it('creates a product', async () => {
      const response = await service.createProduct(
        `E2E Product ${ suffix }`,
        `E2E-SKU-${ suffix }`,
        0.3,
        20,
        15,
        8
      )

      expect(response).toHaveProperty('product')
      expect(response.product).toHaveProperty('id')
      productId = response.product.id
    })

    it('updates the created product', async () => {
      if (!productId) return

      const response = await service.updateProduct(productId, `E2E Product Updated ${ suffix }`)

      expect(response).toHaveProperty('product')
    })

    it('deletes the created product', async () => {
      if (!productId) return

      const response = await service.deleteProduct(productId)

      expect(response).toBeDefined()
    })
  })

  describe('listItemCategories', () => {
    it('returns item categories with expected shape', async () => {
      const response = await service.listItemCategories(1, 5)

      expect(response).toHaveProperty('item_categories')
      expect(Array.isArray(response.item_categories)).toBe(true)
    })
  })

  describe('listHsCodes', () => {
    // Requires the "public.hs_code:read" advanced scope on the API token, so only
    // runs when the developer confirms the scope is enabled via testValues.hsCodesEnabled.
    it('returns HS codes with expected shape when the scope is enabled', async () => {
      if (!testValues.hsCodesEnabled) {
        console.log('Skipping listHsCodes: set testValues.hsCodesEnabled once the public.hs_code:read scope is on')
        return
      }

      const response = await service.listHsCodes(1, 5)

      expect(response).toHaveProperty('hs_codes')
      expect(Array.isArray(response.hs_codes)).toBe(true)
    })
  })

  // ── Shipments ──

  describe('listShipments', () => {
    it('returns shipments with expected shape', async () => {
      const response = await service.listShipments(1, 5)

      expect(response).toHaveProperty('shipments')
      expect(Array.isArray(response.shipments)).toBe(true)
    })
  })

  describe('getShipmentsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getShipmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getShipment', () => {
    // Needs an existing shipment id; supply testValues.easyshipShipmentId to exercise it.
    it('returns a shipment by id when configured', async () => {
      if (!testValues.easyshipShipmentId) {
        console.log('Skipping getShipment: set testValues.easyshipShipmentId')
        return
      }

      const response = await service.getShipment(testValues.easyshipShipmentId)

      expect(response).toHaveProperty('shipment')
    })
  })

  describe('listShipmentDocuments', () => {
    it('returns documents for a shipment when configured', async () => {
      if (!testValues.easyshipShipmentId) {
        console.log('Skipping listShipmentDocuments: set testValues.easyshipShipmentId')
        return
      }

      const response = await service.listShipmentDocuments(
        testValues.easyshipShipmentId,
        'Commercial Invoice'
      )

      expect(response).toBeDefined()
    })
  })

  // ── Rates ──

  describe('requestRates', () => {
    // Rate quotes need at least one connected courier able to service the lane.
    // The origin/destination and parcel are safe (no shipment is created), but a
    // sandbox account with no couriers returns an error, so gate on testValues.
    it('returns rates for a prospective shipment when a courier lane is available', async () => {
      if (!testValues.enableRateRequest) {
        console.log('Skipping requestRates: set testValues.enableRateRequest once a courier is connected')
        return
      }

      const response = await service.requestRates(
        { country_alpha2: testValues.originCountryAlpha2 || 'US', postal_code: testValues.originPostalCode || '10001' },
        { country_alpha2: testValues.destinationCountryAlpha2 || 'US', postal_code: testValues.destinationPostalCode || '90001' },
        [
          {
            total_actual_weight: 1,
            box: { length: 10, width: 10, height: 10 },
            items: [
              {
                description: 'E2E test item',
                quantity: 1,
                declared_customs_value: 10,
                declared_currency: 'USD',
              },
            ],
          },
        ]
      )

      expect(response).toHaveProperty('rates')
      expect(Array.isArray(response.rates)).toBe(true)
    })
  })

  // ── Pickups ──

  describe('listPickups', () => {
    it('returns pickups with expected shape', async () => {
      const response = await service.listPickups(1, 5)

      expect(response).toHaveProperty('pickups')
      expect(Array.isArray(response.pickups)).toBe(true)
    })
  })

  describe('getPickupsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getPickupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listPickupSlots', () => {
    // Slot availability is scoped to a specific courier service id (from a rate),
    // so it only runs when the developer supplies testValues.courierServiceId.
    it('returns pickup slots for a courier service when configured', async () => {
      if (!testValues.courierServiceId) {
        console.log('Skipping listPickupSlots: set testValues.courierServiceId')
        return
      }

      const response = await service.listPickupSlots(testValues.courierServiceId)

      expect(response).toHaveProperty('courier_service_handover_option')
    })
  })

  describe('getPickupTimeSlotsDictionary', () => {
    it('returns empty items without a courier service id', async () => {
      const result = await service.getPickupTimeSlotsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns dictionary items array for a courier service when configured', async () => {
      if (!testValues.courierServiceId) {
        console.log('Skipping getPickupTimeSlotsDictionary (with criteria): set testValues.courierServiceId')
        return
      }

      const result = await service.getPickupTimeSlotsDictionary({
        criteria: { courierServiceId: testValues.courierServiceId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Manifests ──

  describe('listManifests', () => {
    it('returns manifests with expected shape', async () => {
      const response = await service.listManifests(1, 5)

      expect(response).toHaveProperty('manifests')
      expect(Array.isArray(response.manifests)).toBe(true)
    })
  })

  // ── Tracking ──

  describe('listTrackings', () => {
    it('returns trackings with expected shape', async () => {
      const response = await service.listTrackings(undefined, undefined, false, 1, 5)

      expect(response).toHaveProperty('shipments')
      expect(Array.isArray(response.shipments)).toBe(true)
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('returns batches with expected shape', async () => {
      const response = await service.listBatches(1, 5)

      expect(response).toHaveProperty('batches')
      expect(Array.isArray(response.batches)).toBe(true)
    })
  })

  describe('getBatchesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBatchesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getBatch + listBatchItems', () => {
    // Needs a batch id (e.g. from Generate Labels); supply testValues.batchId to exercise.
    it('returns a batch status by id when configured', async () => {
      if (!testValues.batchId) {
        console.log('Skipping getBatch: set testValues.batchId')
        return
      }

      const response = await service.getBatch(testValues.batchId)

      expect(response).toHaveProperty('batch')
    })

    it('returns batch items by id when configured', async () => {
      if (!testValues.batchId) {
        console.log('Skipping listBatchItems: set testValues.batchId')
        return
      }

      const response = await service.listBatchItems(testValues.batchId, 1, 5)

      expect(response).toHaveProperty('batch_items')
      expect(Array.isArray(response.batch_items)).toBe(true)
    })
  })

  // ── Triggers ──

  describe('onTrackingStatusChanged (polling)', () => {
    it('seeds baseline state and emits nothing on the first run', async () => {
      const result = await service.onTrackingStatusChanged({ state: null })

      expect(result).toHaveProperty('state')
      expect(result.state).toHaveProperty('since')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.events).toEqual([])
    })
  })
})
