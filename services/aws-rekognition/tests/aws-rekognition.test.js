'use strict'

const crypto = require('crypto')
const { EventEmitter } = require('events')

jest.mock('https')

const https = require('https')

const { createSandbox } = require('../../../service-sandbox')

const { signRequest, generatePresignedUrl } = require('../src/sigv4')
const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')
const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { awsConfigItems } = require('../src/config-items')

const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const REGION = 'us-east-1'

/**
 * Drives the mocked `https.request` with a canned response, a transport error,
 * or a mid-stream response error.
 */
function stubHttps({ statusCode = 200, body = '', error = null, responseError = null } = {}) {
  const captured = { options: null, written: [], request: null }

  https.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    req.end = () => {
      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'application/json' }

        callback(res)

        if (responseError) {
          res.emit('error', responseError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    captured.request = req

    return req
  })

  return captured
}

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

    it('routes every operation through the error mapper', async () => {
      const calls = [
        ['detectText', () => service.detectText(null, 'b', 'k')],
        ['detectFaces', () => service.detectFaces(null, 'b', 'k')],
        ['detectModerationLabels', () => service.detectModerationLabels(null, 'b', 'k')],
        ['recognizeCelebrities', () => service.recognizeCelebrities(null, 'b', 'k')],
        ['compareFaces', () => service.compareFaces(null, 'sb', 'sk', null, 'tb', 'tk')],
        ['detectProtectiveEquipment', () => service.detectProtectiveEquipment(null, 'b', 'k')],
        ['listCollections', () => service.listCollections()],
        ['deleteCollection', () => service.deleteCollection('col1')],
        ['indexFaces', () => service.indexFaces('col1', null, 'b', 'k')],
        ['searchFacesByImage', () => service.searchFacesByImage('col1', null, 'b', 'k')],
        ['listFaces', () => service.listFaces('col1')],
        ['getCollectionsDictionary', () => service.getCollectionsDictionary({})],
        ['createCollection', () => service.createCollection('col1')],
      ]

      const logSpy = jest.spyOn(service.logger, 'error').mockImplementation(() => {})

      for (const [method, invoke] of calls) {
        const error = new Error('User is not authorized')

        error.name = 'AccessDeniedException'
        jsonRequestSpy.mockRejectedValue(error)
        logSpy.mockClear()

        await expect(invoke()).rejects.toThrow('Access denied: User is not authorized')
        expect(logSpy).toHaveBeenCalledWith(`[${ method }]`, 'User is not authorized')
      }

      logSpy.mockRestore()
    })
  })

  // ── Image input handling ──

  describe('image input handling', () => {
    it('base64 encodes a non-Buffer download payload', async () => {
      mock.onGet('https://example.com/photo.jpg').reply('raw-image-bytes')
      jsonRequestSpy.mockResolvedValue({ Labels: [], LabelModelVersion: '3.0' })

      await service.detectLabels('https://example.com/photo.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Image).toEqual({ Bytes: Buffer.from('raw-image-bytes').toString('base64') })
    })

    it('prefers the S3 object over the image URL and never downloads', async () => {
      jsonRequestSpy.mockResolvedValue({ Labels: [], LabelModelVersion: '3.0' })

      await service.detectLabels('https://example.com/photo.jpg', 'bucket', 'photo.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.Image).toEqual({ S3Object: { Bucket: 'bucket', Name: 'photo.jpg' } })
      expect(mock.history).toHaveLength(0)
    })

    it('rejects raw bytes larger than the 5 MB limit', async () => {
      mock.onGet('https://example.com/huge.jpg').reply(Buffer.alloc(6 * 1024 * 1024))

      await expect(service.detectLabels('https://example.com/huge.jpg')).rejects.toThrow(
        /exceeding the 5 MB limit for raw image bytes/
      )
    })

    it('downloads both the source and the target image for compareFaces', async () => {
      mock.onGet('https://example.com/src.jpg').reply(Buffer.from('src'))
      mock.onGet('https://example.com/tgt.jpg').reply(Buffer.from('tgt'))
      jsonRequestSpy.mockResolvedValue({ FaceMatches: [], UnmatchedFaces: [], SourceImageFace: null })

      await service.compareFaces('https://example.com/src.jpg', null, null, 'https://example.com/tgt.jpg')

      const [opts] = jsonRequestSpy.mock.calls[0]

      expect(opts.body.SourceImage).toEqual({ Bytes: Buffer.from('src').toString('base64') })
      expect(opts.body.TargetImage).toEqual({ Bytes: Buffer.from('tgt').toString('base64') })
      expect(mock.history.every(call => call.encoding === null)).toBe(true)
    })

    it('requires an image for every image-based operation', async () => {
      await expect(service.detectText()).rejects.toThrow(/Provide either an image URL/)
      await expect(service.detectFaces()).rejects.toThrow(/Provide either an image URL/)
      await expect(service.indexFaces('col1')).rejects.toThrow(/Provide either an image URL/)
      await expect(service.compareFaces(null, null, null, null, 'tb', 'tk')).rejects.toThrow(/Provide either an image URL/)
      expect(jsonRequestSpy).not.toHaveBeenCalled()
    })
  })

  // ── Credential wiring ──

  describe('credential wiring', () => {
    it('resolves credentials before each request and forwards them', async () => {
      jsonRequestSpy.mockResolvedValue({ CollectionIds: [] })

      await service.listCollections()

      expect(jsonRequestSpy.mock.calls[0][1]).toEqual({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY })
      expect(jsonRequestSpy.mock.calls[0][0].contentType).toBe('application/x-amz-json-1.1')
    })

    it('defaults the region and builds a credential provider', () => {
      const { Rekognition } = require('../src/index.js')
      const bare = new Rekognition()

      expect(bare.region).toBe('us-east-1')
      expect(bare.credentials).toBeInstanceOf(CredentialProvider)
      expect(bare.credentials.authenticationMethod).toBe('API Key')
      expect(typeof bare.deps.jsonRequest).toBe('function')
    })

    it('propagates credential resolution failures', async () => {
      const { Rekognition } = require('../src/index.js')
      const incomplete = new Rekognition({ region: 'eu-west-1', accessKeyId: 'AK' })

      await expect(incomplete.sendJson('ListCollections', {})).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules: sigv4.js, aws-client.js, credentials.js, errors.js
//
// These modules are exercised directly — the service talks to them through
// `deps`, so the suites above never reach them.
// ─────────────────────────────────────────────────────────────────────────────

const CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }

/** A fixed instant so every signature in these suites is reproducible. */
const FIXED_NOW = Date.UTC(2015, 7, 30, 12, 36, 0)
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

/**
 * An independent, from-the-spec SigV4 calculation used to verify the service's
 * own implementation. It follows the published AWS "Signature Version 4 signing
 * process" steps directly rather than mirroring `src/sigv4.js`, so agreement
 * between the two is meaningful.
 */
function referenceSignature({ method, url, signedHeaderValues, payload, credentials, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const rfc3986 = value =>
    encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ ch.charCodeAt(0).toString(16).toUpperCase() }`)

  // Step 1 — canonical request.
  const canonicalUri = parsed.pathname
    .split('/')
    .map(segment => rfc3986(decodeURIComponent(segment)))
    .join('/') || '/'

  const canonicalQueryString = Array.from(parsed.searchParams.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([key, value]) => `${ key }=${ value }`)
    .join('&')

  const names = Object.keys(signedHeaderValues).map(name => name.toLowerCase()).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ String(signedHeaderValues[name]).trim() }\n`).join('')
  const signedHeaders = names.join(';')
  const payloadHash = crypto.createHash('sha256').update(payload || '').digest('hex')

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n')

  // Step 2 — string to sign.
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  // Step 3 — signing key and signature.
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
  let key = hmac(`AWS4${ credentials.secretAccessKey }`, dateStamp)

  key = hmac(key, region)
  key = hmac(key, service)
  key = hmac(key, 'aws4_request')

  return { signature: hmac(key, stringToSign).toString('hex'), signedHeaders, scope, payloadHash }
}

describe('sigv4 signRequest', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('matches an independently calculated SigV4 signature', () => {
    const body = '{"CollectionId":"faces"}'
    const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' }

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, body, CREDENTIALS, 'us-east-1', 'svc')

    const expected = referenceSignature({
      method: 'POST',
      url: 'https://svc.us-east-1.amazonaws.com/',
      signedHeaderValues: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Svc.Op',
        'host': 'svc.us-east-1.amazonaws.com',
        'x-amz-date': FIXED_AMZ_DATE,
        'x-amz-content-sha256': crypto.createHash('sha256').update(body).digest('hex'),
      },
      payload: body,
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 'svc',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe('svc.us-east-1.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(expected.payloadHash)

    expect(headers['authorization']).toBe(
      `AWS4-HMAC-SHA256 Credential=${ CREDENTIALS.accessKeyId }/${ expected.scope }, ` +
      `SignedHeaders=${ expected.signedHeaders }, ` +
      `Signature=${ expected.signature }`
    )
  })

  it('matches the reference for temporary credentials, a path and a query string', () => {
    const credentials = { ...CREDENTIALS, sessionToken: 'SESSION-TOKEN' }
    const url = 'https://svc.eu-west-1.amazonaws.com/some/path.txt?b=2&a=1'
    const headers = {}

    signRequest('GET', url, headers, '', credentials, 'eu-west-1', 'svc')

    const expected = referenceSignature({
      method: 'GET',
      url,
      signedHeaderValues: {
        'host': 'svc.eu-west-1.amazonaws.com',
        'x-amz-date': FIXED_AMZ_DATE,
        'x-amz-content-sha256': crypto.createHash('sha256').update('').digest('hex'),
        'x-amz-security-token': 'SESSION-TOKEN',
      },
      payload: '',
      credentials,
      region: 'eu-west-1',
      service: 'svc',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(headers['x-amz-security-token']).toBe('SESSION-TOKEN')

    expect(headers['authorization']).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toContain(`Signature=${ expected.signature }`)
  })

  it('uses the credential scope for the frozen date, region and service', () => {
    const headers = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(headers['authorization']).toContain(
      `Credential=${ CREDENTIALS.accessKeyId }/${ FIXED_DATE_STAMP }/us-east-1/svc/aws4_request`
    )
  })

  it('is stable for identical input and sensitive to payload, secret, region and service', () => {
    function sign(overrides = {}) {
      const headers = { 'content-type': 'application/x-amz-json-1.1' }

      signRequest(
        'POST',
        'https://svc.us-east-1.amazonaws.com/',
        headers,
        overrides.body !== undefined ? overrides.body : '{}',
        overrides.credentials || CREDENTIALS,
        overrides.region || 'us-east-1',
        overrides.service || 'svc'
      )

      return headers['authorization']
    }

    const baseline = sign()

    expect(sign()).toBe(baseline)
    expect(sign({ body: '{"a":1}' })).not.toBe(baseline)
    expect(sign({ credentials: { ...CREDENTIALS, secretAccessKey: 'other-secret' } })).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })).not.toBe(baseline)
    expect(sign({ service: 'other' })).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is supplied', () => {
    const headers = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, undefined, CREDENTIALS, 'us-east-1', 'svc')

    expect(headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
  })

  it('keeps an explicit host header and adds the port for non-standard ports', () => {
    const explicit = { Host: 'custom.example.com' }

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', explicit, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    const ported = {}

    signRequest('POST', 'https://localhost:4566/', ported, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(ported['host']).toBe('localhost:4566')

    const standard = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com:443/', standard, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(standard['host']).toBe('svc.us-east-1.amazonaws.com')
  })

  it('canonicalizes the path and sorts the query string', () => {
    const a = {}
    const b = {}

    signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?b=2&a=1', a, '', CREDENTIALS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?a=1&b=2', b, '', CREDENTIALS, 'us-east-1', 's3')

    // Query ordering must not change the signature.
    expect(a['authorization']).toBe(b['authorization'])
    expect(a['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('sorts repeated query keys by value and encodes multi-byte characters', () => {
    const repeated = {}
    const unicode = {}

    signRequest('GET', 'https://s3.amazonaws.com/b?a=2&a=1&a=1', repeated, '', CREDENTIALS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.amazonaws.com/b/ü.txt', unicode, '', CREDENTIALS, 'us-east-1', 's3')

    expect(repeated['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(unicode['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('returns the same headers object it mutates', () => {
    const headers = {}

    expect(
      signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, '', CREDENTIALS, 'us-east-1', 'svc')
    ).toBe(headers)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('adds every SigV4 query parameter and matches an independent signature', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://bucket.s3.us-east-1.amazonaws.com/key.txt',
      CREDENTIALS,
      'us-east-1',
      's3',
      900
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')

    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      `${ CREDENTIALS.accessKeyId }/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`
    )

    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

    // Recompute the query-string signature independently, from the spec.
    const unsigned = new URL(presigned)

    unsigned.searchParams.delete('X-Amz-Signature')

    const canonicalQueryString = Array.from(unsigned.searchParams.entries())
      .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
      .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
      .map(([key, value]) => `${ key }=${ value }`)
      .join('&')

    const canonicalRequest = [
      'GET',
      '/key.txt',
      canonicalQueryString,
      'host:bucket.s3.us-east-1.amazonaws.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      FIXED_AMZ_DATE,
      `${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')

    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
    let key = hmac(`AWS4${ CREDENTIALS.secretAccessKey }`, FIXED_DATE_STAMP)

    key = hmac(key, 'us-east-1')
    key = hmac(key, 's3')
    key = hmac(key, 'aws4_request')

    expect(url.searchParams.get('X-Amz-Signature')).toBe(hmac(key, stringToSign).toString('hex'))
  })

  it('includes the session token and reacts to the expiry window and the port', () => {
    const withToken = generatePresignedUrl(
      'PUT',
      'https://localhost:4566/bucket/key.txt',
      { ...CREDENTIALS, sessionToken: 'SESSION-TOKEN' },
      'us-east-1',
      's3',
      60
    )

    expect(new URL(withToken).searchParams.get('X-Amz-Security-Token')).toBe('SESSION-TOKEN')
    expect(new URL(withToken).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    const short = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 60)
    const long = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 3600)

    expect(short).toBe(generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 60))

    expect(new URL(short).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(long).searchParams.get('X-Amz-Signature')
    )
  })
})

// ── aws-client.js: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag', () => {
    expect(parseXmlTag('<r><Code>Throttling</Code><Code>Other</Code></r>', 'Code')).toBe('Throttling')
  })

  it('returns null when the tag is absent', () => {
    expect(parseXmlTag('<r/>', 'Code')).toBeNull()
  })

  it('extracts every matching tag including multi-line values', () => {
    expect(parseXmlTags('<r><m>one</m><m>two\nlines</m></r>', 'm')).toEqual(['one', 'two\nlines'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parseXmlTags('<r/>', 'm')).toEqual([])
  })
})

// ── aws-client.js: request building and response parsing ──

describe('buildAwsJsonRequest', () => {
  it('builds the regional endpoint, target header and serialized body', () => {
    expect(buildAwsJsonRequest({
      region: 'eu-west-1',
      service: 'svc',
      target: 'Svc.Operation',
      body: { A: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://svc.eu-west-1.amazonaws.com/',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Operation' },
      body: '{"A":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'svc',
      body: '{"a":1}',
      contentType: 'application/json',
    })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'svc', contentType: 'application/json' }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns an empty object for an empty or a missing body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '   ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error derived from the __type field', () => {
    expect.assertions(3)

    try {
      parseJsonResponse({
        statusCode: 400,
        body: '{"__type":"com.amazonaws.service#InvalidParameterException","message":"bad input"}',
      })
    } catch (error) {
      expect(error.name).toBe('InvalidParameterException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDeniedException","Message":"nope"}' })
    } catch (error) {
      expect(error.name).toBe('AccessDeniedException')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest with an injected transport', () => {
  it('signs the built request and parses the response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Items":[]}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: { A: 1 }, contentType: 'application/x-amz-json-1.1' },
      CREDENTIALS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ Items: [] })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://svc.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
      '{"A":1}',
      CREDENTIALS,
      'us-east-1',
      'svc'
    )

    expect(send).toHaveBeenCalledWith(
      'POST',
      'https://svc.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
      '{"A":1}'
    )
  })

  it('propagates an AWS error status as a named error', async () => {
    const send = jest.fn().mockResolvedValue({
      statusCode: 400,
      body: '{"__type":"#ValidationException","message":"bad"}',
    })

    await expect(
      jsonRequest(
        { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: {}, contentType: 'application/x-amz-json-1.1' },
        CREDENTIALS,
        { signRequest: jest.fn(), httpRequest: send }
      )
    ).rejects.toMatchObject({ name: 'ValidationException', message: 'bad', statusCode: 400 })
  })

  it('signs with the real signer when no transport override is given', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' })

    await jsonRequest(
      { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: {}, contentType: 'application/x-amz-json-1.1' },
      CREDENTIALS,
      { httpRequest: send }
    )

    expect(send.mock.calls[0][2]['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
  })
})

// ── aws-client.js: low level HTTP transport ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const response = await httpRequest(
      'POST',
      'https://svc.us-east-1.amazonaws.com/?a=1',
      { 'content-type': 'application/x-amz-json-1.1' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'svc.us-east-1.amazonaws.com',
      port: 443,
      path: '/?a=1',
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('registers a 30s timeout that destroys the request', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})

    expect(captured.request.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function))

    captured.request.setTimeout.mock.calls[0][1]()

    expect(captured.request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Request timed out' }))
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    stubHttps({ responseError: new Error('stream aborted') })

    await expect(httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})).rejects.toThrow('stream aborted')
  })
})

// ── aws-client.js: STS AssumeRole ──

describe('stsAssumeRole', () => {
  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  afterEach(() => {
    https.request.mockReset()
  })

  it('posts a signed AssumeRole form and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(CREDENTIALS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(captured.options.headers['authorization']).toContain('/sts/aws4_request')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not supplied', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body carries no Code or Message', async () => {
    stubHttps({ statusCode: 500, body: '' })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>A</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSParseError',
    })
  })

  it('rejects when the socket errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toThrow('socket hang up')
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('applies the documented defaults', () => {
    const provider = new CredentialProvider()

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')
    expect(typeof provider._stsAssumeRole).toBe('function')
    expect(typeof provider._now()).toBe('number')
  })

  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes inside the expiry buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockImplementation(async () => ({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    }))

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        roleArn: 'arn:role',
        externalId: 'ext',
      },
      { stsAssumeRole: stsAssumeRoleSpy, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

    expect(stsAssumeRoleSpy).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:role',
      `flowrunner-dynamodb-${ now }`,
      'ext'
    )

    // Well inside the validity window — served from the cache.
    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Within the 5 minute refresh buffer before expiry — assumed again.
    now += 3400000

    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for IAM Role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })
})

// ── errors.js ──

describe('mapAwsError', () => {
  function mapped(name, message, extra = {}) {
    return mapAwsError(Object.assign(new Error(message), { name }, extra))
  }

  it('maps throttling errors', () => {
    expect(mapped('ThrottlingException', 'Rate exceeded').message).toMatch(/throttled by AWS: Rate exceeded/)
    expect(mapped('Throttling', 'x').message).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x').message).toMatch(/throttled by AWS/)
  })

  it('maps credential errors', () => {
    expect(mapped('InvalidSignatureException', 'bad sig').message).toMatch(/Invalid AWS credentials: bad sig/)
    expect(mapped('UnrecognizedClientException', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('InvalidClientTokenId', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('SomethingElse', 'The security credential is invalid').message).toMatch(/Invalid AWS credentials/)
  })

  it('maps access denied errors', () => {
    expect(mapped('AccessDeniedException', 'nope').message).toMatch(/Access denied: nope/)
    expect(mapped('AccessDenied', 'nope').message).toMatch(/Access denied/)
  })

  it('maps connectivity errors', () => {
    expect(mapped('Error', 'Request timed out').message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ECONNREFUSED' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ENOTFOUND' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ETIMEDOUT' }).message).toMatch(/Connection to AWS failed/)
  })

  it('passes unknown errors through with the original as the cause', () => {
    const original = new Error('something odd')
    const result = mapAwsError(original)

    expect(result.message).toBe('something odd')
    expect(result.cause).toBe(original)
  })

  it('handles an error without a name or a message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('Example')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[Example Service]', 'info:', 'a'],
      ['[Example Service]', 'debug:', 'b'],
      ['[Example Service]', 'warn:', 'c'],
      ['[Example Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

// ── config-items.js ──

describe('awsConfigItems', () => {
  it('declares the six AWS credential items in order and never shares them', () => {
    expect(awsConfigItems.map(item => item.name)).toEqual([
      'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
    ])

    expect(awsConfigItems.every(item => item.shared === false)).toBe(true)
    expect(awsConfigItems.every(item => typeof item.hint === 'string')).toBe(true)

    expect(awsConfigItems[0]).toMatchObject({
      type: 'CHOICE',
      required: true,
      defaultValue: 'API Key',
      options: ['API Key', 'IAM Role'],
    })

    expect(awsConfigItems[1]).toMatchObject({ type: 'STRING', required: true, defaultValue: 'us-east-1' })
    expect(awsConfigItems.some(item => Object.prototype.hasOwnProperty.call(item, 'order'))).toBe(false)
  })
})
