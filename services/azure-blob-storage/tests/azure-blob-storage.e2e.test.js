'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure Blob Storage Service (e2e)', () => {
  let sandbox
  let service
  let testContainer

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-blob-storage')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    const { testContainer: container } = sandbox.getTestValues()

    testContainer = container || `e2e-test-${ Date.now() }`
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Container lifecycle ──

  describe('container lifecycle', () => {
    it('creates a container', async () => {
      const result = await service.createContainer(testContainer, 'Private')

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('created', true)
      expect(result).toHaveProperty('etag')
      expect(result).toHaveProperty('lastModified')
    })

    it('lists containers and finds the created one', async () => {
      const result = await service.listContainers(testContainer)

      expect(result).toHaveProperty('containers')
      expect(Array.isArray(result.containers)).toBe(true)

      const found = result.containers.find(c => c.name === testContainer)

      expect(found).toBeDefined()
      expect(found).toHaveProperty('leaseState')
    })

    it('gets container properties', async () => {
      const result = await service.getContainerProperties(testContainer)

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('etag')
      expect(result).toHaveProperty('lastModified')
      expect(result).toHaveProperty('leaseState')
      expect(result).toHaveProperty('metadata')
    })

    it('lists containers via dictionary', async () => {
      const result = await service.getContainersDictionary({ search: testContainer })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      const found = result.items.find(i => i.value === testContainer)

      expect(found).toBeDefined()
      expect(found).toHaveProperty('label', testContainer)
      expect(found).toHaveProperty('note', 'Container')
    })
  })

  // ── Blob lifecycle ──

  describe('blob lifecycle', () => {
    const blobName = 'e2e-test-blob.txt'
    const blobContent = 'Hello from e2e test!'

    it('uploads a text blob', async () => {
      const result = await service.uploadBlob(
        testContainer,
        blobName,
        blobContent,
        undefined,
        'text/plain; charset=UTF-8',
        { e2eTest: 'true' }
      )

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('blob', blobName)
      expect(result).toHaveProperty('uploaded', true)
      expect(result).toHaveProperty('contentLength')
      expect(result.contentLength).toBeGreaterThan(0)
    })

    it('lists blobs and finds the uploaded one', async () => {
      const result = await service.listBlobs(testContainer, 'e2e-test')

      expect(result).toHaveProperty('blobs')
      expect(Array.isArray(result.blobs)).toBe(true)

      const found = result.blobs.find(b => b.name === blobName)

      expect(found).toBeDefined()
      expect(found).toHaveProperty('blobType', 'BlockBlob')
      expect(found).toHaveProperty('contentType')
    })

    it('gets blob properties', async () => {
      const result = await service.getBlobProperties(testContainer, blobName)

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('blob', blobName)
      expect(result).toHaveProperty('contentType')
      expect(result).toHaveProperty('contentLength')
      expect(result.contentLength).toBeGreaterThan(0)
      expect(result).toHaveProperty('blobType', 'BlockBlob')
      expect(result).toHaveProperty('etag')
    })

    it('gets blob metadata', async () => {
      const result = await service.getBlobMetadata(testContainer, blobName)

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('blob', blobName)
      expect(result).toHaveProperty('metadata')
      expect(result.metadata).toHaveProperty('e2etest', 'true')
    })

    it('sets blob metadata', async () => {
      const result = await service.setBlobMetadata(testContainer, blobName, {
        updated: 'yes',
        source: 'e2e',
      })

      expect(result).toHaveProperty('updated', true)
      expect(result).toHaveProperty('etag')
    })

    it('verifies updated metadata', async () => {
      const result = await service.getBlobMetadata(testContainer, blobName)

      expect(result.metadata).toHaveProperty('updated', 'yes')
      expect(result.metadata).toHaveProperty('source', 'e2e')
      // Original metadata should be gone (setBlobMetadata replaces all)
      expect(result.metadata).not.toHaveProperty('e2etest')
    })

    it('creates a snapshot', async () => {
      const result = await service.snapshotBlob(testContainer, blobName)

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('blob', blobName)
      expect(result).toHaveProperty('snapshot')
      expect(result.snapshot).toBeTruthy()
      expect(result).toHaveProperty('etag')
    })

    it('copies a blob within the same container', async () => {
      const sourceUrl = `https://${ service.accountName }.blob.core.windows.net/${ testContainer }/${ blobName }`
      const copyName = 'e2e-test-copy.txt'
      const result = await service.copyBlob(testContainer, copyName, sourceUrl)

      expect(result).toHaveProperty('container', testContainer)
      expect(result).toHaveProperty('blob', copyName)
      expect(result).toHaveProperty('copyStatus')
      expect(['success', 'pending']).toContain(result.copyStatus)

      // Clean up the copy
      await service.deleteBlob(testContainer, copyName)
    })

    it('deletes the blob', async () => {
      const result = await service.deleteBlob(testContainer, blobName)

      expect(result).toEqual({
        container: testContainer,
        blob: blobName,
        deleted: true,
      })
    })
  })

  // ── Cleanup: delete the test container ──

  describe('cleanup', () => {
    it('deletes the test container', async () => {
      const result = await service.deleteContainer(testContainer)

      expect(result).toEqual({
        container: testContainer,
        deleted: true,
      })
    })
  })
})
