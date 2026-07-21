'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Cockpit Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cockpit')
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

  // The collection (content model) to exercise. Must exist in the target Cockpit
  // instance with a writable "title" text field. Defaults to "posts".
  const model = () => testValues.model || 'posts'

  // ── Content Items (read) ──

  describe('getContentItems', () => {
    it('returns an array of items for the model', async () => {
      const result = await service.getContentItems(model(), undefined, undefined, undefined, 5, 0)

      expect(Array.isArray(result)).toBe(true)
    })

    it('accepts an object filter, sort and field projection', async () => {
      const result = await service.getContentItems(
        model(),
        {},
        { _created: -1 },
        { title: 1 },
        5,
        0,
        0
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('countContentItems', () => {
    it('returns the model name and a numeric count', async () => {
      const result = await service.countContentItems(model())

      expect(result).toHaveProperty('model', model())
      expect(typeof result.count).toBe('number')
    })

    it('counts with a filter without throwing', async () => {
      const result = await service.countContentItems(model(), {})

      expect(typeof result.count).toBe('number')
    })
  })

  // ── Content Items (write lifecycle) ──

  describe('saveContentItem + getContentItem + updateContentItem + deleteContentItem', () => {
    let createdId

    it('creates a new item', async () => {
      const result = await service.saveContentItem(model(), { title: `E2E Item ${ suffix }` })

      expect(result).toHaveProperty('_id')
      createdId = result._id
    })

    it('retrieves the created item by id', async () => {
      const result = await service.getContentItem(model(), createdId)

      expect(result).toHaveProperty('_id', createdId)
    })

    it('updates the item via saveContentItem with an id', async () => {
      const result = await service.saveContentItem(
        model(),
        { title: `E2E Item Updated ${ suffix }` },
        createdId
      )

      expect(result).toHaveProperty('_id', createdId)
    })

    it('updates the item via updateContentItem', async () => {
      const result = await service.updateContentItem(model(), createdId, {
        title: `E2E Item Updated Again ${ suffix }`,
      })

      expect(result).toHaveProperty('_id', createdId)
    })

    it('deletes the item', async () => {
      await expect(service.deleteContentItem(model(), createdId)).resolves.toBeDefined()
    })
  })

  // ── Content Tree ──

  describe('getContentTree', () => {
    // Tree models are optional; only run when a tree model is configured.
    it('returns a tree array when a tree model is configured', async () => {
      if (!testValues.treeModel) {
        console.log('Skipping getContentTree: set testValues.treeModel to a tree-structured model')
        return
      }

      const result = await service.getContentTree(testValues.treeModel)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Singletons ──

  describe('getSingleton', () => {
    it('returns the singleton content when a singleton is configured', async () => {
      if (!testValues.singletonName) {
        console.log('Skipping getSingleton: set testValues.singletonName to a singleton name')
        return
      }

      const result = await service.getSingleton(testValues.singletonName)

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Assets ──

  describe('listAssets', () => {
    it('returns an assets payload with expected shape', async () => {
      const result = await service.listAssets(undefined, { _created: -1 }, 5, 0)

      expect(result).toHaveProperty('assets')
      expect(Array.isArray(result.assets)).toBe(true)
    })
  })

  describe('getAsset', () => {
    it('retrieves a single asset when an asset id is configured', async () => {
      if (!testValues.assetId) {
        console.log('Skipping getAsset: set testValues.assetId to an existing asset id')
        return
      }

      const result = await service.getAsset(testValues.assetId)

      expect(result).toHaveProperty('_id', testValues.assetId)
    })
  })
})
