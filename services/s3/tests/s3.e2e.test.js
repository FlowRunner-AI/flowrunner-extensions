'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()
const PREFIX = `flowrunner-e2e/${ SUFFIX }`

describe('S3 Storage Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('s3')
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

  // ── Buckets ──

  describe('listBuckets', () => {
    it('returns the buckets of the configured account', async () => {
      const result = await service.listBuckets()

      expect(result).toHaveProperty('buckets')
      expect(Array.isArray(result.buckets)).toBe(true)
    })
  })

  describe('getBucketsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getBucketsDictionary({})

      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('createBucket + deleteBucket', () => {
    it('creates and removes a temporary bucket when explicitly enabled', async () => {
      const { createBucket } = testValues

      if (!createBucket) {
        console.log('Skipping createBucket/deleteBucket: testValues.createBucket not set')

        return
      }

      const bucketName = `flowrunner-e2e-${ SUFFIX }`
      const created = await service.createBucket(bucketName)

      expect(created).toEqual({ success: true, bucketName })

      const deleted = await service.deleteBucket(bucketName)

      expect(deleted).toEqual({ success: true, bucketName })
    })
  })

  // ── Objects ──

  describe('object lifecycle', () => {
    const textKey = `${ PREFIX }/hello.txt`
    const copyKey = `${ PREFIX }/hello-copy.txt`
    const binKey = `${ PREFIX }/hello.bin`

    it('uploads a text object', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping uploadObject: testValues.bucketName not set')

        return
      }

      const result = await service.uploadObject(bucketName, textKey, 'hello from flowrunner', 'text/plain')

      expect(result).toEqual({
        success: true,
        bucketName,
        objectKey: textKey,
        contentType: 'text/plain',
      })
    })

    it('uploads base64 content as binary', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping uploadObject (base64): testValues.bucketName not set')

        return
      }

      const content = Buffer.from('binary-payload').toString('base64')
      const result = await service.uploadObject(bucketName, binKey, content, 'application/octet-stream', 'STANDARD', true)

      expect(result).toHaveProperty('success', true)
    })

    it('confirms the object exists and reads its metadata', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping checkObjectExists/getObjectMetadata: testValues.bucketName not set')

        return
      }

      const exists = await service.checkObjectExists(bucketName, textKey)

      expect(exists).toHaveProperty('exists', true)

      const metadata = await service.getObjectMetadata(bucketName, textKey)

      expect(metadata).toMatchObject({ bucketName, objectKey: textKey })
      expect(metadata.contentLength).toBeGreaterThan(0)
    })

    it('reports a missing object as non-existent', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping checkObjectExists (missing): testValues.bucketName not set')

        return
      }

      await expect(service.checkObjectExists(bucketName, `${ PREFIX }/definitely-missing.txt`)).resolves.toEqual({ exists: false })
    })

    it('lists objects under the test prefix', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping listObjects: testValues.bucketName not set')

        return
      }

      const result = await service.listObjects(bucketName, `${ PREFIX }/`, undefined, 10)

      expect(Array.isArray(result.objects)).toBe(true)
      expect(result.objects.some(object => object.key === textKey)).toBe(true)
    })

    it('copies the object', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping copyObject: testValues.bucketName not set')

        return
      }

      const result = await service.copyObject(bucketName, textKey, bucketName, copyKey)

      expect(result).toMatchObject({ success: true, destinationKey: copyKey })
    })

    it('generates a presigned GET URL', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping getPresignedUrl: testValues.bucketName not set')

        return
      }

      const result = await service.getPresignedUrl(bucketName, textKey, '15 minutes', 'GET')

      expect(result).toMatchObject({ expiresIn: 900, expiresInLabel: '15 minutes', operation: 'GET', objectKey: textKey })
      expect(result.presignedUrl).toContain('X-Amz-Signature=')
    })

    it('uploads an object downloaded from a URL', async () => {
      const { bucketName, sourceUrl } = testValues

      if (!bucketName || !sourceUrl) {
        console.log('Skipping uploadObjectFromUrl: testValues.bucketName or testValues.sourceUrl not set')

        return
      }

      const result = await service.uploadObjectFromUrl(bucketName, `${ PREFIX }/from-url.bin`, sourceUrl)

      expect(result).toHaveProperty('success', true)

      await service.deleteObject(bucketName, `${ PREFIX }/from-url.bin`)
    })

    it('deletes the copied object', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping deleteObject: testValues.bucketName not set')

        return
      }

      await expect(service.deleteObject(bucketName, copyKey)).resolves.toEqual({
        success: true,
        bucketName,
        objectKey: copyKey,
      })
    })

    it('deletes the remaining test objects in one request', async () => {
      const { bucketName } = testValues

      if (!bucketName) {
        console.log('Skipping deleteMultipleObjects: testValues.bucketName not set')

        return
      }

      const result = await service.deleteMultipleObjects(bucketName, `${ textKey }, ${ binKey }`)

      expect(result.totalFailed).toBe(0)
      expect(result.totalDeleted).toBeGreaterThan(0)
    })
  })

  // ── Dictionaries ──

  describe('getStorageClassesDictionary', () => {
    it('returns the static storage class list', async () => {
      const result = await service.getStorageClassesDictionary({ search: 'glacier' })

      expect(result.cursor).toBeNull()
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('reports a missing bucket clearly', async () => {
      await expect(service.listObjects(`flowrunner-missing-${ SUFFIX }`)).rejects.toThrow()
    })
  })
})
