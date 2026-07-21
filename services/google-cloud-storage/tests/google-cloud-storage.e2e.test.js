'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Cloud Storage Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('google-cloud-storage')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // downloadObject writes to FlowRunner file storage via this.flowrunner.Files.*,
    // which is injected by the FlowRunner runtime and not available in a bare e2e run.
    // Stub it so the download path can still be exercised end-to-end against real GCS.
    service.flowrunner = {
      Files: {
        uploadFile: async () => ({ url: 'https://files.flowrunner.com/files/flow/e2e-download' }),
      },
    }
  })

  afterAll(async () => {
    // Best-effort cleanup: remove the object then the bucket created during the run.
    try {
      await service.deleteObject(bucketName, objectName)
    } catch (e) {
      // ignore
    }

    try {
      await service.deleteObject(bucketName, copyObjectName)
    } catch (e) {
      // ignore
    }

    try {
      await service.deleteBucket(bucketName)
    } catch (e) {
      // ignore
    }

    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide on globally-unique bucket
  // names. Bucket names allow lowercase letters, numbers, hyphens, and underscores.
  const suffix = Date.now()
  // Prefer a developer-provided bucket-name prefix so names stay within any org policy.
  const bucketName = `${ testValues.bucketPrefix || 'flowrunner-e2e' }-${ suffix }`
  const objectName = 'e2e/hello.txt'
  const copyObjectName = 'e2e/hello-copy.txt'
  // A small publicly-accessible source file to upload. Overridable via testValues.
  const sourceFileUrl = testValues.sourceFileUrl ||
    'https://raw.githubusercontent.com/git/git/master/README.md'

  // ── Buckets ──

  describe('createBucket + getBucket + listBuckets', () => {
    it('creates a bucket', async () => {
      const response = await service.createBucket(bucketName, testValues.location, 'Standard')

      expect(response).toHaveProperty('name', bucketName)
      expect(response).toHaveProperty('storageClass')
      expect(response).toHaveProperty('location')
    })

    it('retrieves the bucket metadata', async () => {
      const response = await service.getBucket(bucketName)

      expect(response).toHaveProperty('name', bucketName)
      expect(response).toHaveProperty('storageClass')
    })

    it('lists buckets and includes the created one', async () => {
      const response = await service.listBuckets(undefined, 1000)

      expect(response).toHaveProperty('buckets')
      expect(Array.isArray(response.buckets)).toBe(true)
      expect(response.buckets.some(b => b.name === bucketName)).toBe(true)
    })

    // Bucket is deleted in the afterAll below, after the object lifecycle.
  })

  describe('getBucketsDictionary', () => {
    it('returns dictionary items array with a cursor field', async () => {
      const result = await service.getBucketsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Objects ──

  describe('uploadObject + getObjectMetadata + listObjects', () => {
    it('uploads an object fetched from a source URL', async () => {
      const response = await service.uploadObject(bucketName, objectName, sourceFileUrl, 'text/plain')

      expect(response).toHaveProperty('name', objectName)
      expect(response).toHaveProperty('bucket', bucketName)
      expect(response).toHaveProperty('size')
      expect(response).toHaveProperty('contentType')
    })

    it('retrieves the object metadata', async () => {
      const response = await service.getObjectMetadata(bucketName, objectName)

      expect(response).toHaveProperty('name', objectName)
      expect(response).toHaveProperty('bucket', bucketName)
      expect(response).toHaveProperty('size')
    })

    it('lists objects and includes the uploaded one', async () => {
      const response = await service.listObjects(bucketName)

      expect(response).toHaveProperty('objects')
      expect(Array.isArray(response.objects)).toBe(true)
      expect(response.objects.some(o => o.name === objectName)).toBe(true)
    })

    it('lists objects with a prefix and delimiter (folder-style)', async () => {
      const response = await service.listObjects(bucketName, 'e2e/', '/')

      expect(response).toHaveProperty('objects')
      expect(response).toHaveProperty('prefixes')
      expect(Array.isArray(response.prefixes)).toBe(true)
    })
  })

  describe('getObjectsDictionary', () => {
    it('returns items for the bucket criteria', async () => {
      const result = await service.getObjectsDictionary({ criteria: { bucket: bucketName } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns empty items without a bucket criterion', async () => {
      const result = await service.getObjectsDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('updateObjectMetadata', () => {
    it('updates the object cache control and custom metadata', async () => {
      const response = await service.updateObjectMetadata(
        bucketName,
        objectName,
        undefined,
        'public, max-age=3600',
        { source: 'e2e' }
      )

      expect(response).toHaveProperty('name', objectName)
      expect(response).toHaveProperty('cacheControl', 'public, max-age=3600')
      expect(response.metadata).toMatchObject({ source: 'e2e' })
    })
  })

  describe('downloadObject', () => {
    it('downloads the object into (stubbed) file storage', async () => {
      const response = await service.downloadObject(bucketName, objectName)

      expect(response).toHaveProperty('url')
      expect(response).toHaveProperty('fileName')
      expect(response).toHaveProperty('size')
      expect(response).toHaveProperty('bucket', bucketName)
      expect(response).toHaveProperty('objectName', objectName)
    })
  })

  describe('copyObject', () => {
    it('copies the object to a new name in the same bucket', async () => {
      const response = await service.copyObject(bucketName, objectName, bucketName, copyObjectName)

      expect(response).toHaveProperty('name', copyObjectName)
      expect(response).toHaveProperty('bucket', bucketName)
    })
  })

  // ── Signed URLs (no network; local RSA signing) ──

  describe('generateSignedUrl', () => {
    it('generates a V4 signed GET url', async () => {
      const response = await service.generateSignedUrl(bucketName, objectName, 'GET', 900)

      expect(response).toHaveProperty('signedUrl')
      expect(response.signedUrl).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256')
      expect(response.signedUrl).toContain('X-Goog-Signature=')
      expect(response).toHaveProperty('method', 'GET')
      expect(response).toHaveProperty('expiresAt')
    })

    it('generates a V4 signed PUT url', async () => {
      const response = await service.generateSignedUrl(bucketName, 'uploads/new.bin', 'PUT', 600)

      expect(response).toHaveProperty('method', 'PUT')
      expect(response.signedUrl).toContain('X-Goog-Expires=600')
    })
  })

  // ── Delete (object then copy) — bucket deleted in afterAll ──

  describe('deleteObject', () => {
    it('deletes the copied object', async () => {
      const response = await service.deleteObject(bucketName, copyObjectName)

      expect(response).toEqual({ success: true, bucket: bucketName, objectName: copyObjectName })
    })
  })
})
