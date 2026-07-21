'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Easyship Service (e2e)', () => {
  let sandbox
  let service

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
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getAccount', () => {
    it('returns account details with expected shape', async () => {
      const result = await service.getAccount()

      expect(result).toHaveProperty('account')
      expect(result.account).toHaveProperty('name')
    })
  })

  // ── Addresses ──

  describe('address lifecycle', () => {
    let createdAddressId

    it('lists addresses', async () => {
      const result = await service.listAddresses(1, 5)

      expect(result).toHaveProperty('addresses')
      expect(Array.isArray(result.addresses)).toBe(true)
    })

    it('creates an address', async () => {
      const result = await service.createAddress(
        '123 E2E Test Street',
        'New York',
        'US',
        'E2E Test Company',
        'E2E Test Contact',
        '+12125551234',
        'e2e-test@example.com',
        'Suite 100',
        'NY',
        '10001'
      )

      expect(result).toHaveProperty('address')
      expect(result.address).toHaveProperty('id')
      createdAddressId = result.address.id
    })

    it('updates the created address', async () => {
      const result = await service.updateAddress(
        createdAddressId,
        '456 Updated Street',
        'New York',
        'US',
        'Updated Company',
        'Updated Contact',
        '+12125559999',
        'updated@example.com',
        'Floor 2',
        'NY',
        '10002'
      )

      expect(result).toHaveProperty('address')
    })

    it('deactivates the created address', async () => {
      const result = await service.deactivateAddress(createdAddressId)

      expect(result).toBeDefined()
    })
  })

  // ── Addresses Dictionary ──

  describe('getAddressesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAddressesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Boxes ──

  describe('box lifecycle', () => {
    let createdBoxId

    it('lists boxes', async () => {
      const result = await service.listBoxes(1, 5)

      expect(result).toHaveProperty('boxes')
      expect(Array.isArray(result.boxes)).toBe(true)
    })

    it('creates a box', async () => {
      const result = await service.createBox('E2E Test Box', 15, 10, 8, 0.3)

      expect(result).toHaveProperty('box')
      expect(result.box).toHaveProperty('id')
      createdBoxId = result.box.id
    })

    it('updates the created box', async () => {
      const result = await service.updateBox(createdBoxId, true, false)

      expect(result).toHaveProperty('box')
    })

    it('deletes the created box', async () => {
      const result = await service.deleteBox(createdBoxId)

      expect(result).toBeDefined()
    })
  })

  // ── Couriers ──

  describe('listCouriers', () => {
    it('returns couriers with expected shape', async () => {
      const result = await service.listCouriers(1, 5)

      expect(result).toHaveProperty('couriers')
      expect(Array.isArray(result.couriers)).toBe(true)
    })
  })

  describe('getCouriersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCouriersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Products ──

  describe('product lifecycle', () => {
    let createdProductId

    it('lists products', async () => {
      const result = await service.listProducts(1, 5)

      expect(result).toHaveProperty('products')
      expect(Array.isArray(result.products)).toBe(true)
    })

    it('creates a product', async () => {
      const result = await service.createProduct(
        'E2E Test Product',
        `E2E-SKU-${Date.now()}`,
        0.5,
        10,
        8,
        5
      )

      expect(result).toHaveProperty('product')
      expect(result.product).toHaveProperty('id')
      createdProductId = result.product.id
    })

    it('updates the created product', async () => {
      const result = await service.updateProduct(createdProductId, 'E2E Updated Product')

      expect(result).toHaveProperty('product')
    })

    it('deletes the created product', async () => {
      const result = await service.deleteProduct(createdProductId)

      expect(result).toBeDefined()
    })
  })

  // ── Products Dictionary ──

  describe('getProductsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getProductsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Item Categories ──

  describe('listItemCategories', () => {
    it('returns item categories', async () => {
      const result = await service.listItemCategories(1, 5)

      expect(result).toHaveProperty('item_categories')
      expect(Array.isArray(result.item_categories)).toBe(true)
    })
  })

  // ── Shipments ──

  describe('listShipments', () => {
    it('returns shipments with expected shape', async () => {
      const result = await service.listShipments(1, 5)

      expect(result).toHaveProperty('shipments')
      expect(Array.isArray(result.shipments)).toBe(true)
    })
  })

  describe('getShipmentsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getShipmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Trackings ──

  describe('listTrackings', () => {
    it('returns trackings with expected shape', async () => {
      const result = await service.listTrackings(undefined, undefined, false, 1, 5)

      expect(result).toHaveProperty('shipments')
      expect(Array.isArray(result.shipments)).toBe(true)
    })
  })

  // ── Pickups ──

  describe('listPickups', () => {
    it('returns pickups with expected shape', async () => {
      const result = await service.listPickups(1, 5)

      expect(result).toHaveProperty('pickups')
      expect(Array.isArray(result.pickups)).toBe(true)
    })
  })

  describe('getPickupsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getPickupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Manifests ──

  describe('listManifests', () => {
    it('returns manifests with expected shape', async () => {
      const result = await service.listManifests(1, 5)

      expect(result).toHaveProperty('manifests')
      expect(Array.isArray(result.manifests)).toBe(true)
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('returns batches with expected shape', async () => {
      const result = await service.listBatches(1, 5)

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
})
