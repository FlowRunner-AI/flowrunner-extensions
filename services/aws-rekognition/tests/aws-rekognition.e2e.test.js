'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Rekognition Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-rekognition')
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

  // ── Image Analysis ──

  describe('detectLabels', () => {
    it('detects labels from an S3 image', async () => {
      const result = await service.detectLabels(
        null,
        testValues.s3Bucket,
        testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('labels')
      expect(Array.isArray(result.labels)).toBe(true)
      expect(result).toHaveProperty('labelModelVersion')
    })

    it('detects labels from an image URL', async () => {
      if (!testValues.publicImageUrl) {
        console.log('Skipping: no publicImageUrl in testValues')

        return
      }

      const result = await service.detectLabels(testValues.publicImageUrl)

      expect(result).toHaveProperty('labels')
      expect(Array.isArray(result.labels)).toBe(true)
    })

    it('accepts MaxLabels and MinConfidence', async () => {
      const result = await service.detectLabels(
        null,
        testValues.s3Bucket,
        testValues.s3ImageKey,
        5,
        80,
      )

      expect(result.labels.length).toBeLessThanOrEqual(5)
    })
  })

  describe('detectText', () => {
    it('detects text from an S3 image', async () => {
      const result = await service.detectText(
        null,
        testValues.s3Bucket,
        testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('textDetections')
      expect(Array.isArray(result.textDetections)).toBe(true)
      expect(result).toHaveProperty('textModelVersion')
    })
  })

  describe('detectFaces', () => {
    it('detects faces with default attributes', async () => {
      const result = await service.detectFaces(
        null,
        testValues.s3Bucket,
        testValues.s3FaceImageKey || testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('faceDetails')
      expect(Array.isArray(result.faceDetails)).toBe(true)
      expect(result).toHaveProperty('faceModelVersion')
    })

    it('detects faces with all attributes', async () => {
      const result = await service.detectFaces(
        null,
        testValues.s3Bucket,
        testValues.s3FaceImageKey || testValues.s3ImageKey,
        'All',
      )

      expect(result).toHaveProperty('faceDetails')
    })
  })

  describe('detectModerationLabels', () => {
    it('returns moderation labels', async () => {
      const result = await service.detectModerationLabels(
        null,
        testValues.s3Bucket,
        testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('moderationLabels')
      expect(Array.isArray(result.moderationLabels)).toBe(true)
      expect(result).toHaveProperty('moderationModelVersion')
    })
  })

  describe('recognizeCelebrities', () => {
    it('returns celebrity faces array', async () => {
      const result = await service.recognizeCelebrities(
        null,
        testValues.s3Bucket,
        testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('celebrityFaces')
      expect(Array.isArray(result.celebrityFaces)).toBe(true)
      expect(result).toHaveProperty('unrecognizedFaces')
    })
  })

  describe('compareFaces', () => {
    it('compares two S3 images', async () => {
      if (!testValues.s3FaceImageKey || !testValues.s3FaceImageKey2) {
        console.log('Skipping: need s3FaceImageKey and s3FaceImageKey2 in testValues')

        return
      }

      const result = await service.compareFaces(
        null, testValues.s3Bucket, testValues.s3FaceImageKey,
        null, testValues.s3Bucket, testValues.s3FaceImageKey2,
      )

      expect(result).toHaveProperty('faceMatches')
      expect(result).toHaveProperty('unmatchedFaces')
      expect(result).toHaveProperty('sourceImageFace')
    })
  })

  // ── Collections ──

  describe('collection lifecycle', () => {
    const testCollectionId = `e2e-test-${Date.now()}`

    it('creates a collection', async () => {
      const result = await service.createCollection(testCollectionId)

      expect(result).toHaveProperty('collectionArn')
      expect(result).toHaveProperty('statusCode', 200)
    })

    it('lists collections including the new one', async () => {
      const result = await service.listCollections()

      expect(result).toHaveProperty('collectionIds')
      expect(result.collectionIds).toContain(testCollectionId)
    })

    it('indexes faces into the collection', async () => {
      const result = await service.indexFaces(
        testCollectionId,
        null,
        testValues.s3Bucket,
        testValues.s3FaceImageKey || testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('faceRecords')
      expect(Array.isArray(result.faceRecords)).toBe(true)
      expect(result).toHaveProperty('faceModelVersion')
    })

    it('lists faces in the collection', async () => {
      const result = await service.listFaces(testCollectionId)

      expect(result).toHaveProperty('faces')
      expect(Array.isArray(result.faces)).toBe(true)
    })

    it('searches faces by image in the collection', async () => {
      const result = await service.searchFacesByImage(
        testCollectionId,
        null,
        testValues.s3Bucket,
        testValues.s3FaceImageKey || testValues.s3ImageKey,
      )

      expect(result).toHaveProperty('faceMatches')
      expect(Array.isArray(result.faceMatches)).toBe(true)
    })

    it('deletes the collection', async () => {
      const result = await service.deleteCollection(testCollectionId)

      expect(result).toHaveProperty('statusCode', 200)
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })
})
