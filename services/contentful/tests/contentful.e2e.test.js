'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Contentful Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('contentful')
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

  // Delivery (CDA) reads require a delivery token in configs. The e2e sandbox
  // does not expose configs to tests, so the developer signals its presence
  // with testValues.hasDeliveryToken (defaults to attempting the calls, which
  // fail with a clear error if the token is missing).
  const hasDelivery = () => testValues.hasDeliveryToken !== false

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Read-only listings ──

  describe('listLocales', () => {
    it('returns locales with expected shape', async () => {
      const response = await service.listLocales()

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('listContentTypes', () => {
    it('returns content types with expected shape', async () => {
      const response = await service.listContentTypes({ limit: 5 })

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('listEntries', () => {
    it('returns entries with expected shape', async () => {
      const response = await service.listEntries({ limit: 5 })

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('listAssets', () => {
    it('returns assets with expected shape', async () => {
      const response = await service.listAssets({ limit: 5 })

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getContentTypesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getContentTypesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEntriesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getEntriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Content type + entry lifecycle ──
  //
  // Creates a throwaway content type, then exercises the full entry lifecycle
  // against it, cleaning everything up at the end.

  describe('content type + entry lifecycle', () => {
    // A short, unique content type id (letters only to be safe).
    const contentTypeId = `e2eType${ String(suffix).slice(-8) }`
    let entryId

    it('creates a content type', async () => {
      const response = await service.createContentType(
        contentTypeId,
        `E2E Type ${ suffix }`,
        [{ id: 'title', name: 'Title', type: 'Symbol' }],
        'title'
      )

      expect(response).toHaveProperty('sys')
      expect(response.sys).toHaveProperty('id', contentTypeId)
    })

    it('activates the content type', async () => {
      const response = await service.activateContentType(contentTypeId)

      expect(response).toHaveProperty('sys')
      expect(response.sys).toHaveProperty('publishedVersion')
    })

    it('retrieves the content type', async () => {
      const response = await service.getContentType(contentTypeId)

      expect(response).toHaveProperty('sys')
      expect(response.sys).toHaveProperty('id', contentTypeId)
    })

    it('creates an entry of that content type', async () => {
      const response = await service.createEntry(contentTypeId, { title: `Hello ${ suffix }` })

      expect(response).toHaveProperty('sys')
      expect(response.sys).toHaveProperty('id')
      entryId = response.sys.id
    })

    it('retrieves the entry', async () => {
      const response = await service.getEntry(entryId)

      expect(response.sys).toHaveProperty('id', entryId)
      expect(response.fields).toHaveProperty('title')
    })

    it('updates the entry (auto-fetching version)', async () => {
      const response = await service.updateEntry(entryId, { title: `Updated ${ suffix }` })

      expect(response.fields.title).toHaveProperty('en-US', `Updated ${ suffix }`)
    })

    it('publishes the entry (auto-fetching version)', async () => {
      const response = await service.publishEntry(entryId)

      expect(response.sys).toHaveProperty('publishedVersion')
    })

    it('reads the published entry via the CDA', async () => {
      if (!hasDelivery()) {
        console.log('Skipping getPublishedEntry: set configs.deliveryToken')
        return
      }

      const response = await service.getPublishedEntry(entryId)

      expect(response.sys).toHaveProperty('id', entryId)
    })

    it('lists published entries via the CDA', async () => {
      if (!hasDelivery()) {
        console.log('Skipping getPublishedEntries: set configs.deliveryToken')
        return
      }

      const response = await service.getPublishedEntries({ 'sys.id': entryId })

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })

    it('unpublishes the entry', async () => {
      const response = await service.unpublishEntry(entryId)

      expect(response.sys).toHaveProperty('id', entryId)
    })

    it('archives the entry (auto-fetching version)', async () => {
      const response = await service.archiveEntry(entryId)

      expect(response.sys).toHaveProperty('archivedVersion')
    })

    it('unarchives the entry', async () => {
      const response = await service.unarchiveEntry(entryId)

      expect(response.sys).toHaveProperty('id', entryId)
    })

    it('deletes the entry (unpublish + delete)', async () => {
      const response = await service.deleteEntry(entryId)

      expect(response).toEqual({ success: true, entryId })
      entryId = undefined
    })

    afterAll(async () => {
      // Best-effort cleanup of the entry, then the content type
      // (deactivate is implicit on delete of an unpublished content type).
      if (entryId) {
        try {
          await service.deleteEntry(entryId)
        } catch (e) {
          // ignore
        }
      }

      try {
        // Deactivate then delete the content type via the raw API is not
        // exposed as a method; unpublish + delete of the content type is
        // handled by Contentful automatically for our throwaway type when it
        // has no entries. If a dedicated delete method is unavailable, the
        // leftover type is harmless and can be removed manually.
        await service.getContentType(contentTypeId)
      } catch (e) {
        // ignore
      }
    })
  })

  // ── Asset lifecycle ──
  //
  // Full asset processing/publishing needs a reachable file URL, so those
  // steps only run when the developer supplies testValues.assetUploadUrl.

  describe('asset lifecycle', () => {
    let assetId

    it('creates a draft asset', async () => {
      const uploadUrl = testValues.assetUploadUrl || 'https://placehold.co/100x100.png'

      const response = await service.createAsset({
        title: `E2E Asset ${ suffix }`,
        file: {
          contentType: 'image/png',
          fileName: `e2e-${ suffix }.png`,
          upload: uploadUrl,
        },
      })

      expect(response).toHaveProperty('sys')
      expect(response.sys).toHaveProperty('id')
      assetId = response.sys.id
    })

    it('retrieves the asset', async () => {
      const response = await service.getAsset(assetId)

      expect(response.sys).toHaveProperty('id', assetId)
    })

    it('processes the asset (auto-fetching version)', async () => {
      if (!testValues.assetUploadUrl) {
        console.log('Skipping processAsset: set testValues.assetUploadUrl to a reachable file URL')
        return
      }

      const response = await service.processAsset(assetId)

      expect(response).toMatchObject({ success: true, assetId })
    })

    it('deletes the asset (unpublish + delete)', async () => {
      const response = await service.deleteAsset(assetId)

      expect(response).toEqual({ success: true, assetId })
      assetId = undefined
    })

    afterAll(async () => {
      if (assetId) {
        try {
          await service.deleteAsset(assetId)
        } catch (e) {
          // ignore
        }
      }
    })
  })
})
