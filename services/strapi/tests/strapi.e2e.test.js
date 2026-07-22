'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Strapi Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('strapi')
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

  // ── Entries ──

  describe('listEntries', () => {
    it('lists entries from the configured collection', async () => {
      const { collection } = testValues

      if (!collection) {
        console.log('Skipping listEntries: testValues.collection not set')

        return
      }

      const result = await service.listEntries(collection, undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('meta')
    })

    it('accepts populate, sort and status parameters', async () => {
      const { collection } = testValues

      if (!collection) {
        console.log('Skipping listEntries (params): testValues.collection not set')

        return
      }

      const result = await service.listEntries(
        collection,
        '*',
        undefined,
        'createdAt:desc',
        undefined,
        1,
        5,
        undefined,
        'Published'
      )

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('rejects an unknown collection', async () => {
      await expect(service.listEntries(`missing-collection-${ SUFFIX }`)).rejects.toThrow(/Strapi API error/)
    })

    it('rejects when no collection is supplied', async () => {
      await expect(service.listEntries('')).rejects.toThrow(/collection \(plural API ID/)
    })
  })

  describe('entry lifecycle', () => {
    let documentId

    it('creates an entry', async () => {
      const { collection, entryData } = testValues

      if (!collection || !entryData) {
        console.log('Skipping entry lifecycle: testValues.collection or testValues.entryData not set')

        return
      }

      const result = await service.createEntry(collection, { ...entryData })

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('documentId')
      documentId = result.data.documentId
    })

    it('reads the created entry back', async () => {
      if (!documentId) {
        console.log('Skipping getEntry: no entry was created')

        return
      }

      const result = await service.getEntry(testValues.collection, documentId, '*', undefined, 'Draft')

      expect(result.data).toHaveProperty('documentId', documentId)
    })

    it('updates the created entry', async () => {
      if (!documentId) {
        console.log('Skipping updateEntry: no entry was created')

        return
      }

      const { updateData } = testValues
      const result = await service.updateEntry(
        testValues.collection,
        documentId,
        updateData || { ...testValues.entryData }
      )

      expect(result).toHaveProperty('data')
    })

    it('deletes the created entry', async () => {
      if (!documentId) {
        console.log('Skipping deleteEntry: no entry was created')

        return
      }

      await expect(service.deleteEntry(testValues.collection, documentId)).resolves.toBeDefined()
    })
  })

  describe('parameter validation', () => {
    it('requires a documentId on getEntry', async () => {
      await expect(service.getEntry('articles', '')).rejects.toThrow(/documentId is required/)
    })

    it('requires a data object on createEntry', async () => {
      await expect(service.createEntry('articles', null)).rejects.toThrow(/data object/)
    })

    it('requires a media file id', async () => {
      await expect(service.getMediaFile('')).rejects.toThrow(/media file id is required/)
    })

    it('requires a file to upload', async () => {
      await expect(service.uploadFile('')).rejects.toThrow(/file to upload is required/)
    })
  })

  // ── Media ──

  describe('listMediaFiles', () => {
    it('lists media library files', async () => {
      const result = await service.listMediaFiles()

      expect(Array.isArray(result)).toBe(true)
    })

    it('applies filters and sorting', async () => {
      const result = await service.listMediaFiles({ mime: { $contains: 'image' } }, 'createdAt:desc')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('media lifecycle', () => {
    let fileId

    it('uploads a file', async () => {
      const { uploadFileUrl } = testValues

      if (!uploadFileUrl) {
        console.log('Skipping uploadFile: testValues.uploadFileUrl not set')

        return
      }

      const result = await service.uploadFile(uploadFileUrl, `e2e-${ SUFFIX }.png`)

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('id')
      fileId = result[0].id
    })

    it('reads the uploaded file metadata', async () => {
      if (!fileId) {
        console.log('Skipping getMediaFile: no file was uploaded')

        return
      }

      const result = await service.getMediaFile(fileId)

      expect(result).toHaveProperty('id', fileId)
    })

    it('deletes the uploaded file', async () => {
      if (!fileId) {
        console.log('Skipping deleteMediaFile: no file was uploaded')

        return
      }

      await expect(service.deleteMediaFile(fileId)).resolves.toBeDefined()
    })
  })
})
