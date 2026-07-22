'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

const RECIPIENT = {
  name: 'FlowRunner E2E',
  address1: '19749 Dearborn St',
  city: 'Chicago',
  country_code: 'US',
  state_code: 'IL',
  zip: '60618',
}

describe('Printful Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('printful')
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

  // ── Stores ──

  describe('stores', () => {
    it('lists stores accessible to the token', async () => {
      const result = await service.listStores(0, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(typeof result.total).toBe('number')
    })

    it('returns the current store info', async () => {
      const result = await service.getStoreInfo()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })

    it('returns a stores dictionary', async () => {
      const result = await service.getStoresDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })
  })

  // ── Catalog ──

  describe('catalog', () => {
    let catalogProductId
    let catalogVariantId

    it('lists catalog products', async () => {
      const result = await service.listCatalogProducts(undefined, 0, 5)

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)

      catalogProductId = result.items[0].id
    })

    it('lists catalog categories', async () => {
      const result = await service.listCategories()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('lists catalog products of a category', async () => {
      const categories = await service.listCategories()
      const result = await service.listCatalogProducts(categories.items[0].id, 0, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets a catalog product with its variants', async () => {
      const result = await service.getCatalogProduct(catalogProductId || 71)

      expect(result).toHaveProperty('product')
      expect(Array.isArray(result.variants)).toBe(true)

      catalogVariantId = result.variants[0]?.id
    })

    it('gets a catalog variant', async () => {
      if (!catalogVariantId) {
        console.log('Skipping getCatalogVariant: no variant id resolved')

        return
      }

      const result = await service.getCatalogVariant(catalogVariantId)

      expect(result).toHaveProperty('variant')
      expect(result.variant).toHaveProperty('id', catalogVariantId)
    })

    it('returns a catalog products dictionary filtered by search', async () => {
      const result = await service.getCatalogProductsDictionary({ search: 'shirt' })

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Countries, shipping & tax ──

  describe('countries, shipping and tax', () => {
    it('lists countries', async () => {
      const result = await service.listCountries()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('returns a countries dictionary filtered by code', async () => {
      const result = await service.getCountriesDictionary({ search: 'us' })

      expect(result.items.some(item => item.value === 'US')).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('calculates shipping rates', async () => {
      const variantId = testValues.catalogVariantId

      if (!variantId) {
        console.log('Skipping getShippingRates: testValues.catalogVariantId not set')

        return
      }

      const result = await service.getShippingRates(RECIPIENT, [{ quantity: 1, variant_id: variantId }], 'USD')

      expect(Array.isArray(result)).toBe(true)
    })

    it('calculates the tax rate for a US address', async () => {
      const result = await service.getTaxRate('US', 'CA', 'San Francisco', '94103')

      expect(result).toHaveProperty('required')
    })
  })

  // ── Files ──

  describe('files', () => {
    let fileId

    it('lists files in the library', async () => {
      const result = await service.listFiles(0, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('adds a file by URL', async () => {
      const { printFileUrl } = testValues

      if (!printFileUrl) {
        console.log('Skipping addFile: testValues.printFileUrl not set')

        return
      }

      const result = await service.addFile(printFileUrl, 'default', `e2e-${ SUFFIX }.png`)

      expect(result).toHaveProperty('id')

      fileId = result.id
    })

    it('gets the added file', async () => {
      if (!fileId) {
        console.log('Skipping getFile: no file was added')

        return
      }

      const result = await service.getFile(fileId)

      expect(result).toHaveProperty('id', fileId)
      expect(result).toHaveProperty('status')
    })
  })

  // ── Sync products ──

  describe('sync products', () => {
    let syncProductId
    let syncVariantId

    it('lists sync products', async () => {
      const result = await service.listSyncProducts(undefined, 0, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns a sync products dictionary', async () => {
      const result = await service.getSyncProductsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('creates a sync product', async () => {
      const { catalogVariantId, printFileUrl } = testValues

      if (!catalogVariantId || !printFileUrl) {
        console.log('Skipping createSyncProduct: testValues.catalogVariantId or testValues.printFileUrl not set')

        return
      }

      const result = await service.createSyncProduct(
        `FlowRunner E2E Tee ${ SUFFIX }`,
        [{ variant_id: catalogVariantId, retail_price: '24.00', files: [{ url: printFileUrl }] }],
        undefined,
        `flowrunner-e2e-${ SUFFIX }`
      )

      expect(result).toHaveProperty('id')

      syncProductId = result.id
    })

    it('gets the created sync product with its variants', async () => {
      if (!syncProductId) {
        console.log('Skipping getSyncProduct: no product was created')

        return
      }

      const result = await service.getSyncProduct(syncProductId)

      expect(result).toHaveProperty('sync_product')
      expect(Array.isArray(result.sync_variants)).toBe(true)

      syncVariantId = result.sync_variants[0]?.id
    })

    it('updates the sync product name', async () => {
      if (!syncProductId) {
        console.log('Skipping updateSyncProduct: no product was created')

        return
      }

      const result = await service.updateSyncProduct(syncProductId, `FlowRunner E2E Tee ${ SUFFIX } (updated)`)

      expect(result).toHaveProperty('id')
    })

    it('gets and updates the sync variant', async () => {
      if (!syncVariantId) {
        console.log('Skipping sync variant operations: no variant was created')

        return
      }

      const variant = await service.getSyncVariant(syncVariantId)

      expect(variant).toHaveProperty('id', syncVariantId)

      const updated = await service.updateSyncVariant(syncVariantId, '26.00')

      expect(updated).toHaveProperty('id', syncVariantId)
    })

    it('deletes the created sync product', async () => {
      if (!syncProductId) {
        console.log('Skipping deleteSyncProduct: no product was created')

        return
      }

      await expect(service.deleteSyncProduct(syncProductId)).resolves.toEqual({ success: true })
    })
  })

  // ── Orders ──

  describe('orders', () => {
    let orderId

    it('lists orders', async () => {
      const result = await service.listOrders(undefined, 0, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists draft orders', async () => {
      const result = await service.listOrders('Draft', 0, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('estimates order costs', async () => {
      const { catalogVariantId, printFileUrl } = testValues

      if (!catalogVariantId || !printFileUrl) {
        console.log('Skipping estimateOrderCosts: testValues.catalogVariantId or testValues.printFileUrl not set')

        return
      }

      const result = await service.estimateOrderCosts(RECIPIENT, [
        { quantity: 1, variant_id: catalogVariantId, files: [{ url: printFileUrl }] },
      ])

      expect(result).toHaveProperty('costs')
    })

    it('creates a draft order', async () => {
      const { catalogVariantId, printFileUrl } = testValues

      if (!catalogVariantId || !printFileUrl) {
        console.log('Skipping createOrder: testValues.catalogVariantId or testValues.printFileUrl not set')

        return
      }

      const result = await service.createOrder(
        RECIPIENT,
        [{ quantity: 1, variant_id: catalogVariantId, files: [{ url: printFileUrl }] }],
        false,
        `flowrunner-e2e-order-${ SUFFIX }`
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'draft')

      orderId = result.id
    })

    it('gets the draft order', async () => {
      if (!orderId) {
        console.log('Skipping getOrder: no order was created')

        return
      }

      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
    })

    it('updates the draft order', async () => {
      if (!orderId) {
        console.log('Skipping updateOrder: no order was created')

        return
      }

      const result = await service.updateOrder(orderId, { ...RECIPIENT, name: 'FlowRunner E2E Updated' })

      expect(result).toHaveProperty('id', orderId)
    })

    it('cancels the draft order', async () => {
      if (!orderId) {
        console.log('Skipping cancelOrder: no order was created')

        return
      }

      const result = await service.cancelOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
    })
  })

  // ── Webhooks ──
  // Writing webhook config replaces the store's live configuration, so the
  // write path only runs when testValues.webhookUrl is set. It is restored /
  // disabled afterwards.

  describe('webhooks', () => {
    it('returns the current webhook configuration', async () => {
      const result = await service.getWebhookConfig()

      expect(result).toBeDefined()
    })

    it('sets and disables the webhook configuration', async () => {
      const { webhookUrl } = testValues

      if (!webhookUrl) {
        console.log('Skipping setWebhookConfig: testValues.webhookUrl not set')

        return
      }

      const set = await service.setWebhookConfig(webhookUrl, ['Package Shipped', 'Order Failed'])

      expect(set).toHaveProperty('url', webhookUrl)
      expect(set.types).toEqual(expect.arrayContaining(['package_shipped', 'order_failed']))

      const disabled = await service.disableWebhooks()

      expect(disabled).toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown order', async () => {
      await expect(service.getOrder(`missing-${ SUFFIX }`)).rejects.toThrow(/Printful API error/)
    })
  })
})
