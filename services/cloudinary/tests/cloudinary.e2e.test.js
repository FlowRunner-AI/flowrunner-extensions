'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// A small, always-available public sample image Cloudinary can fetch server-side.
const DEFAULT_SAMPLE_URL = 'https://res.cloudinary.com/demo/image/upload/sample.jpg'

describe('Cloudinary Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cloudinary')
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
  const sampleUrl = () => testValues.sampleImageUrl || DEFAULT_SAMPLE_URL

  // ── Account ──

  describe('ping', () => {
    it('confirms credentials are valid', async () => {
      const response = await service.ping()

      expect(response).toHaveProperty('status', 'ok')
    })
  })

  describe('getUsage', () => {
    it('returns the usage report with plan and credits', async () => {
      const response = await service.getUsage()

      expect(response).toHaveProperty('plan')
      expect(response).toHaveProperty('credits')
    })
  })

  // ── Read-only listing ──

  describe('listResources', () => {
    it('returns image resources with expected shape', async () => {
      const response = await service.listResources('Image', undefined, 5)

      expect(response).toHaveProperty('resources')
      expect(Array.isArray(response.resources)).toBe(true)
    })
  })

  describe('searchAssets', () => {
    it('returns search results with a total count', async () => {
      const response = await service.searchAssets('', undefined, undefined, 5)

      expect(response).toHaveProperty('total_count')
      expect(response).toHaveProperty('resources')
      expect(Array.isArray(response.resources)).toBe(true)
    })
  })

  describe('listTags', () => {
    it('returns tags with expected shape', async () => {
      const response = await service.listTags('Image', undefined, 5)

      expect(response).toHaveProperty('tags')
      expect(Array.isArray(response.tags)).toBe(true)
    })
  })

  describe('listRootFolders', () => {
    it('returns root folders with expected shape', async () => {
      const response = await service.listRootFolders(5)

      expect(response).toHaveProperty('folders')
      expect(Array.isArray(response.folders)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getFoldersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFoldersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTagsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getRecentAssetsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getRecentAssetsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Delivery URL (no API call) ──

  describe('generateDeliveryUrl', () => {
    it('builds an unsigned delivery URL', async () => {
      const result = await service.generateDeliveryUrl('sample', 'w_200,c_fill', 'jpg', 'Image')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain('/image/upload/w_200,c_fill/sample.jpg')
      expect(result).toHaveProperty('signed', false)
    })

    it('builds a signed delivery URL', async () => {
      const result = await service.generateDeliveryUrl('sample', 'w_200', 'jpg', 'Image', undefined, true)

      expect(result).toHaveProperty('signed', true)
      expect(result.url).toContain('/s--')
    })
  })

  // ── Full asset lifecycle: upload → transform → details → update → tags → rename → destroy ──

  describe('asset lifecycle', () => {
    const publicId = `flowrunner-e2e/asset_${ suffix }`
    const renamedId = `flowrunner-e2e/renamed_${ suffix }`
    let currentId = publicId

    it('uploads an image from a URL', async () => {
      const response = await service.uploadFromUrl(sampleUrl(), publicId, 'flowrunner-e2e', 'e2e', true, undefined, 'Image')

      expect(response).toHaveProperty('public_id', publicId)
      expect(response).toHaveProperty('secure_url')
    })

    it('applies an eager transformation', async () => {
      const response = await service.applyTransformation(publicId, 'w_100,h_100,c_fill', 'Image')

      expect(response).toHaveProperty('public_id', publicId)
      expect(response).toHaveProperty('eager')
      expect(Array.isArray(response.eager)).toBe(true)
    })

    it('gets asset details', async () => {
      const response = await service.getAssetDetails(publicId, 'Image')

      expect(response).toHaveProperty('public_id', publicId)
      expect(response).toHaveProperty('secure_url')
    })

    it('updates the asset tags and context', async () => {
      const response = await service.updateAsset(publicId, 'Image', 'e2e,updated', 'alt=E2E test image')

      expect(response).toHaveProperty('public_id', publicId)
    })

    it('adds a tag via manageTags', async () => {
      const response = await service.manageTags('Add', [publicId], `e2e-tag-${ suffix }`, 'Image')

      expect(response).toHaveProperty('public_ids')
      expect(response.public_ids).toContain(publicId)
    })

    it('renames the asset', async () => {
      const response = await service.renameAsset(publicId, renamedId, true, 'Image')

      expect(response).toHaveProperty('public_id', renamedId)
      currentId = renamedId
    })

    it('destroys the asset', async () => {
      const response = await service.destroyAsset(currentId, true, 'Image')

      expect(response).toHaveProperty('result', 'ok')
    })

    afterAll(async () => {
      // Best-effort cleanup in case a step above failed mid-lifecycle.
      for (const id of [publicId, renamedId]) {
        try {
          await service.destroyAsset(id, false, 'Image')
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Bulk delete by prefix ──

  describe('uploadAsset + deleteAssets by prefix', () => {
    const prefix = `flowrunner-e2e-bulk-${ suffix }`
    const publicId = `${ prefix }/img`

    it('uploads an image via uploadAsset (source URL)', async () => {
      const response = await service.uploadAsset(
        undefined,
        sampleUrl(),
        publicId,
        undefined,
        'bulk',
        true,
        undefined,
        undefined,
        undefined,
        'Image'
      )

      expect(response).toHaveProperty('public_id', publicId)
    })

    it('deletes assets by prefix', async () => {
      const response = await service.deleteAssets(undefined, `${ prefix }/`, 'Image')

      expect(response).toHaveProperty('deleted')
    })

    afterAll(async () => {
      try {
        await service.deleteAssets([publicId], undefined, 'Image')
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── deleteAssets by explicit public ids ──

  describe('uploadAsset + deleteAssets by public ids', () => {
    const publicId = `flowrunner-e2e/list_${ suffix }`

    it('uploads then deletes by explicit public id list', async () => {
      await service.uploadFromUrl(sampleUrl(), publicId, undefined, undefined, true, undefined, 'Image')

      const response = await service.deleteAssets([publicId], undefined, 'Image')

      expect(response).toHaveProperty('deleted')
      expect(response.deleted).toHaveProperty(publicId)
    })
  })

  // ── Folders lifecycle: create → list subfolders → delete ──

  describe('folder lifecycle', () => {
    const parent = `flowrunner-e2e-folders-${ suffix }`
    const child = `${ parent }/child`

    it('creates a nested folder', async () => {
      const response = await service.createFolder(child)

      expect(response).toHaveProperty('success', true)
    })

    it('lists subfolders of the parent', async () => {
      const response = await service.listSubfolders(parent)

      expect(response).toHaveProperty('folders')
      expect(Array.isArray(response.folders)).toBe(true)
    })

    it('deletes the child folder', async () => {
      const response = await service.deleteFolder(child)

      expect(response).toHaveProperty('deleted')
    })

    afterAll(async () => {
      for (const path of [child, parent]) {
        try {
          await service.deleteFolder(path)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })
})
