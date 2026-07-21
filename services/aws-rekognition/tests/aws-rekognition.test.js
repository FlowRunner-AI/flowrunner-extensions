'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const REGION = 'us-east-1'

describe('AWS Rekognition Service', () => {
  let sandbox
  let service
  let mock
  let jsonRequestSpy

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    // Stub the native jsonRequest so we never hit real AWS.
    // sendJson calls this.deps.jsonRequest which normally uses native https.
    jsonRequestSpy = jest.fn()
    service.deps.jsonRequest = jsonRequestSpy
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessKeyId', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'secretAccessKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'roleArn', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'externalId', required: false, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('has exactly 6 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(6)
    })
  })

  // ── Image Analysis ──

  describe('detectLabels', () => {
    it('sends correct request with S3 image and defaults', async () => {
      jsonRequestSpy.mockResolvedValue({
        Labels: [{ Name: 'Dog', Confidence: 98.2 }],
        LabelModelVersion: '3.0',
      })

      const result = await service.detectLabels(null, 'my-bucket', 'photo.jpg')

      expect(jsonRequestSpy).toHaveBeenCalledTimes(1)

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.region).toBe(REGION)
      expect(opts.service).toBe('rekognition')
      expect(opts.target).toBe('RekognitionService.DetectLabels')
      expect(opts.body).toEqual({
        Image: { S3Object: { Bucket: 'my-bucket', Name: 'photo.jpg' } },
      })

      expect(result).toEqual({
        labels: [{ Name: 'Dog', Confidence: 98.2 }],
        imageProperties: null,
        labelModelVersion: '3.0',
      })
    })

    it('includes MaxLabels and MinConfidence when provided', async () => {
      jsonRequestSpy.mockResolvedValue({ Labels: [], LabelModelVersion: '3.0' })

      await service.detectLabels(null, 'b', 'k', 10, 70)

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.MaxLabels).toBe(10)
      expect(opts.body.MinConfidence).toBe(70)
    })

    it('includes Features when includeImageProperties is true', async () => {
      jsonRequestSpy.mockResolvedValue({
        Labels: [],
        ImageProperties: { DominantColors: [] },
        LabelModelVersion: '3.0',
      })

      const result = await service.detectLabels(null, 'b', 'k', null, null, true)
      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Features).toEqual(['GENERAL_LABELS', 'IMAGE_PROPERTIES'])
      expect(result.imageProperties).toEqual({ DominantColors: [] })
    })

    it('downloads image bytes when URL is provided instead of S3', async () => {
      const fakeBytes = Buffer.from('fake-image-data')

      mock.onGet('https://example.com/photo.jpg').reply(fakeBytes)
      jsonRequestSpy.mockResolvedValue({ Labels: [], LabelModelVersion: '3.0' })

      await service.detectLabels('https://example.com/photo.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Image).toHaveProperty('Bytes')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBeNull()
    })

    it('throws when API returns an error', async () => {
      jsonRequestSpy.mockRejectedValue(new Error('Something went wrong'))

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow()
    })

    it('throws when neither image URL nor S3 are provided', async () => {
      await expect(service.detectLabels(null, null, null)).rejects.toThrow(
        'Provide either an image URL or both an S3 bucket and object name.'
      )
    })
  })

  describe('detectText', () => {
    it('sends correct request and returns text detections', async () => {
      jsonRequestSpy.mockResolvedValue({
        TextDetections: [{ DetectedText: 'STOP', Type: 'LINE', Confidence: 99.1 }],
        TextModelVersion: '3.0',
      })

      const result = await service.detectText(null, 'bucket', 'sign.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.DetectText')
      expect(opts.body.Image).toEqual({ S3Object: { Bucket: 'bucket', Name: 'sign.jpg' } })
      expect(result).toEqual({
        textDetections: [{ DetectedText: 'STOP', Type: 'LINE', Confidence: 99.1 }],
        textModelVersion: '3.0',
      })
    })

    it('returns empty arrays when response has no detections', async () => {
      jsonRequestSpy.mockResolvedValue({})

      const result = await service.detectText(null, 'b', 'k')

      expect(result).toEqual({ textDetections: [], textModelVersion: null })
    })
  })

  // ── Face Analysis ──

  describe('detectFaces', () => {
    it('sends DEFAULT attributes by default', async () => {
      jsonRequestSpy.mockResolvedValue({
        FaceDetails: [{ Confidence: 99.9 }],
        FaceModelVersion: '7.0',
      })

      const result = await service.detectFaces(null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.DetectFaces')
      expect(opts.body.Attributes).toEqual(['DEFAULT'])
      expect(result).toEqual({
        faceDetails: [{ Confidence: 99.9 }],
        faceModelVersion: '7.0',
      })
    })

    it('resolves "All" dropdown value to "ALL"', async () => {
      jsonRequestSpy.mockResolvedValue({ FaceDetails: [], FaceModelVersion: '7.0' })

      await service.detectFaces(null, 'b', 'k', 'All')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Attributes).toEqual(['ALL'])
    })

    it('passes through unknown attribute values', async () => {
      jsonRequestSpy.mockResolvedValue({ FaceDetails: [], FaceModelVersion: '7.0' })

      await service.detectFaces(null, 'b', 'k', 'CUSTOM')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Attributes).toEqual(['CUSTOM'])
    })
  })

  describe('detectModerationLabels', () => {
    it('sends correct request without optional params', async () => {
      jsonRequestSpy.mockResolvedValue({
        ModerationLabels: [{ Name: 'Nudity', Confidence: 92.4 }],
        ModerationModelVersion: '7.0',
      })

      const result = await service.detectModerationLabels(null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.DetectModerationLabels')
      expect(opts.body).not.toHaveProperty('MinConfidence')
      expect(result).toEqual({
        moderationLabels: [{ Name: 'Nudity', Confidence: 92.4 }],
        moderationModelVersion: '7.0',
      })
    })

    it('includes MinConfidence when provided', async () => {
      jsonRequestSpy.mockResolvedValue({ ModerationLabels: [], ModerationModelVersion: '7.0' })

      await service.detectModerationLabels(null, 'b', 'k', 80)

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.MinConfidence).toBe(80)
    })
  })

  describe('recognizeCelebrities', () => {
    it('sends correct request and returns celebrity data', async () => {
      jsonRequestSpy.mockResolvedValue({
        CelebrityFaces: [{ Name: 'Jane Doe', MatchConfidence: 98.7 }],
        UnrecognizedFaces: [{ BoundingBox: {} }],
      })

      const result = await service.recognizeCelebrities(null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.RecognizeCelebrities')
      expect(result).toEqual({
        celebrityFaces: [{ Name: 'Jane Doe', MatchConfidence: 98.7 }],
        unrecognizedFaces: [{ BoundingBox: {} }],
      })
    })
  })

  describe('compareFaces', () => {
    it('sends correct request with two S3 images', async () => {
      jsonRequestSpy.mockResolvedValue({
        FaceMatches: [{ Similarity: 99.2 }],
        UnmatchedFaces: [],
        SourceImageFace: { Confidence: 99.9 },
      })

      const result = await service.compareFaces(
        null, 'src-bucket', 'src.jpg',
        null, 'tgt-bucket', 'tgt.jpg'
      )

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.CompareFaces')
      expect(opts.body.SourceImage).toEqual({ S3Object: { Bucket: 'src-bucket', Name: 'src.jpg' } })
      expect(opts.body.TargetImage).toEqual({ S3Object: { Bucket: 'tgt-bucket', Name: 'tgt.jpg' } })
      expect(result).toEqual({
        faceMatches: [{ Similarity: 99.2 }],
        unmatchedFaces: [],
        sourceImageFace: { Confidence: 99.9 },
      })
    })

    it('includes SimilarityThreshold when provided', async () => {
      jsonRequestSpy.mockResolvedValue({ FaceMatches: [], UnmatchedFaces: [], SourceImageFace: null })

      await service.compareFaces(null, 'sb', 'sk', null, 'tb', 'tk', 90)

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.SimilarityThreshold).toBe(90)
    })

    it('omits SimilarityThreshold when not provided', async () => {
      jsonRequestSpy.mockResolvedValue({ FaceMatches: [], UnmatchedFaces: [], SourceImageFace: null })

      await service.compareFaces(null, 'sb', 'sk', null, 'tb', 'tk')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body).not.toHaveProperty('SimilarityThreshold')
    })
  })

  describe('detectProtectiveEquipment', () => {
    it('sends correct request without optional params', async () => {
      jsonRequestSpy.mockResolvedValue({
        Persons: [{ Id: 0 }],
        Summary: { PersonsWithRequiredEquipment: [0] },
        ProtectiveEquipmentModelVersion: '1.0',
      })

      const result = await service.detectProtectiveEquipment(null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.DetectProtectiveEquipment')
      expect(opts.body).not.toHaveProperty('SummarizationAttributes')
      expect(result).toEqual({
        persons: [{ Id: 0 }],
        summary: { PersonsWithRequiredEquipment: [0] },
        protectiveEquipmentModelVersion: '1.0',
      })
    })

    it('includes SummarizationAttributes with MinConfidence and equipment types', async () => {
      jsonRequestSpy.mockResolvedValue({ Persons: [], Summary: null, ProtectiveEquipmentModelVersion: '1.0' })

      await service.detectProtectiveEquipment(null, 'b', 'k', 90, ['Face Cover', 'Head Cover'])

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.SummarizationAttributes).toEqual({
        MinConfidence: 90,
        RequiredEquipmentTypes: ['FACE_COVER', 'HEAD_COVER'],
      })
    })

    it('omits SummarizationAttributes when no optional params given', async () => {
      jsonRequestSpy.mockResolvedValue({ Persons: [], ProtectiveEquipmentModelVersion: '1.0' })

      await service.detectProtectiveEquipment(null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body).not.toHaveProperty('SummarizationAttributes')
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends correct request', async () => {
      jsonRequestSpy.mockResolvedValue({
        CollectionArn: 'arn:aws:rekognition:us-east-1:111:collection/my-faces',
        FaceModelVersion: '7.0',
        StatusCode: 200,
      })

      const result = await service.createCollection('my-faces')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.CreateCollection')
      expect(opts.body).toEqual({ CollectionId: 'my-faces' })
      expect(result).toEqual({
        collectionArn: 'arn:aws:rekognition:us-east-1:111:collection/my-faces',
        faceModelVersion: '7.0',
        statusCode: 200,
      })
    })

    it('throws when collectionId is not provided', async () => {
      await expect(service.createCollection()).rejects.toThrow('collectionId is required.')
    })
  })

  describe('listCollections', () => {
    it('sends correct request with defaults', async () => {
      jsonRequestSpy.mockResolvedValue({
        CollectionIds: ['col1', 'col2'],
        FaceModelVersions: ['7.0', '7.0'],
      })

      const result = await service.listCollections()

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.ListCollections')
      expect(opts.body).toEqual({})
      expect(result).toEqual({
        collectionIds: ['col1', 'col2'],
        faceModelVersions: ['7.0', '7.0'],
        cursor: null,
      })
    })

    it('includes MaxResults and NextToken when provided', async () => {
      jsonRequestSpy.mockResolvedValue({
        CollectionIds: ['col1'],
        FaceModelVersions: ['7.0'],
        NextToken: 'page2',
      })

      const result = await service.listCollections(10, 'page1')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.MaxResults).toBe(10)
      expect(opts.body.NextToken).toBe('page1')
      expect(result.cursor).toBe('page2')
    })
  })

  describe('deleteCollection', () => {
    it('sends correct request', async () => {
      jsonRequestSpy.mockResolvedValue({ StatusCode: 200 })

      const result = await service.deleteCollection('my-faces')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.DeleteCollection')
      expect(opts.body).toEqual({ CollectionId: 'my-faces' })
      expect(result).toEqual({ statusCode: 200 })
    })

    it('throws when collectionId is not provided', async () => {
      await expect(service.deleteCollection()).rejects.toThrow('collectionId is required.')
    })
  })

  describe('indexFaces', () => {
    it('sends correct request with required params and S3 image', async () => {
      jsonRequestSpy.mockResolvedValue({
        FaceRecords: [{ Face: { FaceId: 'abc' } }],
        UnindexedFaces: [],
        FaceModelVersion: '7.0',
      })

      const result = await service.indexFaces('col1', null, 'bucket', 'photo.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.IndexFaces')
      expect(opts.body.CollectionId).toBe('col1')
      expect(opts.body.Image).toEqual({ S3Object: { Bucket: 'bucket', Name: 'photo.jpg' } })
      expect(result).toEqual({
        faceRecords: [{ Face: { FaceId: 'abc' } }],
        unindexedFaces: [],
        faceModelVersion: '7.0',
      })
    })

    it('includes optional params when provided', async () => {
      jsonRequestSpy.mockResolvedValue({ FaceRecords: [], UnindexedFaces: [], FaceModelVersion: '7.0' })

      await service.indexFaces('col1', null, 'b', 'k', 'user-42', 5, 'High')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.ExternalImageId).toBe('user-42')
      expect(opts.body.MaxFaces).toBe(5)
      expect(opts.body.QualityFilter).toBe('HIGH')
    })

    it('throws when collectionId is not provided', async () => {
      await expect(service.indexFaces()).rejects.toThrow('collectionId is required.')
    })
  })

  describe('searchFacesByImage', () => {
    it('sends correct request with required params', async () => {
      jsonRequestSpy.mockResolvedValue({
        SearchedFaceBoundingBox: { Width: 0.2 },
        SearchedFaceConfidence: 99.9,
        FaceMatches: [{ Similarity: 99.1 }],
        FaceModelVersion: '7.0',
      })

      const result = await service.searchFacesByImage('col1', null, 'b', 'k')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.SearchFacesByImage')
      expect(opts.body.CollectionId).toBe('col1')
      expect(result).toEqual({
        searchedFaceBoundingBox: { Width: 0.2 },
        searchedFaceConfidence: 99.9,
        faceMatches: [{ Similarity: 99.1 }],
        faceModelVersion: '7.0',
      })
    })

    it('includes optional params when provided', async () => {
      jsonRequestSpy.mockResolvedValue({
        SearchedFaceBoundingBox: null,
        SearchedFaceConfidence: null,
        FaceMatches: [],
        FaceModelVersion: '7.0',
      })

      await service.searchFacesByImage('col1', null, 'b', 'k', 70, 10, 'None')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.FaceMatchThreshold).toBe(70)
      expect(opts.body.MaxFaces).toBe(10)
      expect(opts.body.QualityFilter).toBe('NONE')
    })

    it('throws when collectionId is not provided', async () => {
      await expect(service.searchFacesByImage()).rejects.toThrow('collectionId is required.')
    })
  })

  describe('listFaces', () => {
    it('sends correct request with required params', async () => {
      jsonRequestSpy.mockResolvedValue({
        Faces: [{ FaceId: 'abc', Confidence: 99.9 }],
        FaceModelVersion: '7.0',
      })

      const result = await service.listFaces('col1')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.target).toBe('RekognitionService.ListFaces')
      expect(opts.body).toEqual({ CollectionId: 'col1' })
      expect(result).toEqual({
        faces: [{ FaceId: 'abc', Confidence: 99.9 }],
        cursor: null,
        faceModelVersion: '7.0',
      })
    })

    it('includes optional params when provided', async () => {
      jsonRequestSpy.mockResolvedValue({ Faces: [], NextToken: 'tok2', FaceModelVersion: '7.0' })

      const result = await service.listFaces('col1', 10, 'tok1')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.MaxResults).toBe(10)
      expect(opts.body.NextToken).toBe('tok1')
      expect(result.cursor).toBe('tok2')
    })

    it('throws when collectionId is not provided', async () => {
      await expect(service.listFaces()).rejects.toThrow('collectionId is required.')
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns all collections as dictionary items', async () => {
      jsonRequestSpy.mockResolvedValue({ CollectionIds: ['faces', 'employees'], NextToken: null })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'faces', value: 'faces' },
          { label: 'employees', value: 'employees' },
        ],
        cursor: null,
      })
    })

    it('filters by search term case-insensitively', async () => {
      jsonRequestSpy.mockResolvedValue({ CollectionIds: ['faces', 'employees', 'face-test'] })

      const result = await service.getCollectionsDictionary({ search: 'FACE' })

      expect(result.items).toEqual([
        { label: 'faces', value: 'faces' },
        { label: 'face-test', value: 'face-test' },
      ])
    })

    it('passes cursor for pagination', async () => {
      jsonRequestSpy.mockResolvedValue({ CollectionIds: ['col3'], NextToken: 'page3' })

      const result = await service.getCollectionsDictionary({ cursor: 'page2' })

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.NextToken).toBe('page2')
      expect(result.cursor).toBe('page3')
    })

    it('handles empty payload gracefully', async () => {
      jsonRequestSpy.mockResolvedValue({ CollectionIds: [] })

      const result = await service.getCollectionsDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps ResourceNotFoundException', async () => {
      const err = new Error('Collection xyz not found')

      err.name = 'ResourceNotFoundException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow('Resource not found')
    })

    it('maps ResourceAlreadyExistsException', async () => {
      const err = new Error('Collection already exists')

      err.name = 'ResourceAlreadyExistsException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.createCollection('existing')).rejects.toThrow('Collection already exists')
    })

    it('maps InvalidImageFormatException', async () => {
      const err = new Error('Bad format')

      err.name = 'InvalidImageFormatException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow('Invalid image format')
    })

    it('maps ImageTooLargeException', async () => {
      const err = new Error('Too large')

      err.name = 'ImageTooLargeException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow('Image too large')
    })

    it('maps InvalidParameterException', async () => {
      const err = new Error('Bad param')

      err.name = 'InvalidParameterException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow('Invalid request')
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('Something broke')

      err.name = 'ThrottlingException'
      jsonRequestSpy.mockRejectedValue(err)

      await expect(service.detectLabels(null, 'b', 'k')).rejects.toThrow('throttled')
    })
  })
})
