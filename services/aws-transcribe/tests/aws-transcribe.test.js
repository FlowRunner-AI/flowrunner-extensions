'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const REGION = 'us-east-1'

describe('AWS Transcribe Service', () => {
  let sandbox
  let service
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()

    // The service uses its own jsonRequest (Node https + SigV4), not Flowrunner.Request.
    // We stub service.deps.jsonRequest to intercept all AWS API calls.
    jsonRequestMock = jest.fn()
    service.deps.jsonRequest = jsonRequestMock
  })

  afterEach(() => {
    jsonRequestMock.mockReset()
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
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, shared: false }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'accessKeyId', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'roleArn', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'externalId', type: 'STRING', shared: false }),
        ])
      )
    })
  })

  // ── Transcription Jobs ──

  describe('startTranscriptionJob', () => {
    it('sends correct request with required params and language code', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
          LanguageCode: 'en-US',
          Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        },
      })

      const result = await service.startTranscriptionJob(
        'test-job', 's3://bucket/audio.mp3', 'en-US'
      )

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'transcribe',
        target: 'Transcribe.StartTranscriptionJob',
        contentType: 'application/x-amz-json-1.1',
      })

      expect(opts.body).toMatchObject({
        TranscriptionJobName: 'test-job',
        Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        LanguageCode: 'en-US',
      })

      expect(result).toMatchObject({
        transcriptionJobName: 'test-job',
        status: 'IN_PROGRESS',
        languageCode: 'en-US',
        mediaFileUri: 's3://bucket/audio.mp3',
      })
    })

    it('uses identifyLanguage when set instead of languageCode', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'auto-lang-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
          IdentifyLanguage: true,
        },
      })

      await service.startTranscriptionJob(
        'auto-lang-job', 's3://bucket/audio.mp3', null, true
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.IdentifyLanguage).toBe(true)
      expect(body).not.toHaveProperty('LanguageCode')
    })

    it('throws when no languageCode and identifyLanguage is false', async () => {
      await expect(
        service.startTranscriptionJob('job', 's3://bucket/audio.mp3', null, false)
      ).rejects.toThrow('Provide a languageCode or enable identifyLanguage.')
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(
        service.startTranscriptionJob(null, 's3://bucket/audio.mp3', 'en-US')
      ).rejects.toThrow('transcriptionJobName is required.')
    })

    it('throws when mediaFileUri is missing', async () => {
      await expect(
        service.startTranscriptionJob('job', null, 'en-US')
      ).rejects.toThrow('mediaFileUri (an S3 URI) is required.')
    })

    it('includes all optional params when provided', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'full-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      })

      await service.startTranscriptionJob(
        'full-job',
        's3://bucket/audio.mp3',
        'en-US',
        false, // identifyLanguage
        'mp3', // mediaFormat
        'my-bucket', // outputBucketName
        true, // showSpeakerLabels
        5, // maxSpeakerLabels
        false, // channelIdentification
        'my-vocab', // vocabularyName
        ['vtt', 'srt'] // subtitleFormats
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toMatchObject({
        TranscriptionJobName: 'full-job',
        Media: { MediaFileUri: 's3://bucket/audio.mp3' },
        LanguageCode: 'en-US',
        MediaFormat: 'mp3',
        OutputBucketName: 'my-bucket',
        Settings: {
          ShowSpeakerLabels: true,
          MaxSpeakerLabels: 5,
          VocabularyName: 'my-vocab',
        },
        Subtitles: { Formats: ['vtt', 'srt'] },
      })
    })

    it('defaults maxSpeakerLabels to 2 when showSpeakerLabels is true and maxSpeakerLabels not given', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'spk-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'spk-job', 's3://bucket/audio.mp3', 'en-US',
        false, null, null, true, null
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Settings.ShowSpeakerLabels).toBe(true)
      expect(body.Settings.MaxSpeakerLabels).toBe(2)
    })

    it('includes channelIdentification in settings', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'ch-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'ch-job', 's3://bucket/audio.mp3', 'en-US',
        false, null, null, false, null, true
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body.Settings.ChannelIdentification).toBe(true)
    })

    it('omits Settings when no settings are provided', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: { TranscriptionJobName: 'plain-job', TranscriptionJobStatus: 'IN_PROGRESS' },
      })

      await service.startTranscriptionJob(
        'plain-job', 's3://bucket/audio.mp3', 'en-US'
      )

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).not.toHaveProperty('Settings')
    })

    it('handles ConflictException from AWS', async () => {
      const err = new Error('Job already exists')

      err.name = 'ConflictException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(
        service.startTranscriptionJob('dup-job', 's3://bucket/audio.mp3', 'en-US')
      ).rejects.toThrow('Conflict:')
    })
  })

  describe('getTranscriptionJob', () => {
    it('sends correct request and returns formatted job', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'my-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'en-US',
          Media: { MediaFileUri: 's3://bucket/audio.mp3' },
          Transcript: { TranscriptFileUri: 'https://s3.amazonaws.com/transcript.json' },
          CreationTime: '2024-01-01T00:00:00Z',
          CompletionTime: '2024-01-01T00:05:00Z',
        },
      })

      const result = await service.getTranscriptionJob('my-job')

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Transcribe.GetTranscriptionJob')
      expect(opts.body).toEqual({ TranscriptionJobName: 'my-job' })

      expect(result).toMatchObject({
        transcriptionJobName: 'my-job',
        status: 'COMPLETED',
        languageCode: 'en-US',
        transcriptFileUri: 'https://s3.amazonaws.com/transcript.json',
      })
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(service.getTranscriptionJob(null)).rejects.toThrow('transcriptionJobName is required.')
    })

    it('does not fetch transcript text when fetchTranscriptText is false', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJob: {
          TranscriptionJobName: 'my-job',
          TranscriptionJobStatus: 'COMPLETED',
          Transcript: { TranscriptFileUri: 'https://example.com/t.json' },
        },
      })

      const result = await service.getTranscriptionJob('my-job', false)

      expect(result).not.toHaveProperty('transcriptText')
    })

    it('handles NotFoundException', async () => {
      const err = new Error('Job not found')

      err.name = 'NotFoundException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.getTranscriptionJob('missing-job')).rejects.toThrow('Not found:')
    })
  })

  describe('listTranscriptionJobs', () => {
    it('sends correct request with no filters', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJobSummaries: [
          {
            TranscriptionJobName: 'job-1',
            TranscriptionJobStatus: 'COMPLETED',
            LanguageCode: 'en-US',
            CreationTime: '2024-01-01T00:00:00Z',
          },
        ],
        NextToken: 'abc123',
      })

      const result = await service.listTranscriptionJobs()

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListTranscriptionJobs')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({})

      expect(result.jobs).toHaveLength(1)

      expect(result.jobs[0]).toMatchObject({
        transcriptionJobName: 'job-1',
        status: 'COMPLETED',
        languageCode: 'en-US',
      })

      expect(result.cursor).toBe('abc123')
    })

    it('passes all filters', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [], NextToken: null })

      await service.listTranscriptionJobs('COMPLETED', 'meeting', 10, 'cursor-abc')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({
        Status: 'COMPLETED',
        JobNameContains: 'meeting',
        MaxResults: 10,
        NextToken: 'cursor-abc',
      })
    })

    it('returns null cursor when no NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      const result = await service.listTranscriptionJobs()

      expect(result.cursor).toBeNull()
    })
  })

  describe('deleteTranscriptionJob', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteTranscriptionJob('old-job')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.DeleteTranscriptionJob')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ TranscriptionJobName: 'old-job' })
      expect(result).toEqual({ deleted: true, transcriptionJobName: 'old-job' })
    })

    it('throws when transcriptionJobName is missing', async () => {
      await expect(service.deleteTranscriptionJob(null)).rejects.toThrow('transcriptionJobName is required.')
    })
  })

  // ── Custom Vocabularies ──

  describe('createVocabulary', () => {
    it('sends correct request with all required params', async () => {
      jsonRequestMock.mockResolvedValue({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        VocabularyState: 'PENDING',
        LastModifiedTime: '2024-01-01T00:00:00Z',
      })

      const result = await service.createVocabulary('medical-terms', 'en-US', ['aspirin', 'ibuprofen'])

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.CreateVocabulary')

      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        Phrases: ['aspirin', 'ibuprofen'],
      })

      expect(result).toMatchObject({
        vocabularyName: 'medical-terms',
        languageCode: 'en-US',
        vocabularyState: 'PENDING',
      })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.createVocabulary(null, 'en-US', ['word'])).rejects.toThrow('vocabularyName is required.')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.createVocabulary('vocab', null, ['word'])).rejects.toThrow('languageCode is required.')
    })

    it('throws when phrases is empty', async () => {
      await expect(service.createVocabulary('vocab', 'en-US', [])).rejects.toThrow('phrases must be a non-empty array.')
    })

    it('throws when phrases is not an array', async () => {
      await expect(service.createVocabulary('vocab', 'en-US', 'word')).rejects.toThrow('phrases must be a non-empty array.')
    })
  })

  describe('getVocabulary', () => {
    it('sends correct request and returns formatted vocabulary', async () => {
      jsonRequestMock.mockResolvedValue({
        VocabularyName: 'medical-terms',
        LanguageCode: 'en-US',
        VocabularyState: 'READY',
        LastModifiedTime: '2024-01-01T00:00:00Z',
        DownloadUri: 'https://s3.amazonaws.com/vocab.txt',
      })

      const result = await service.getVocabulary('medical-terms')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.GetVocabulary')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ VocabularyName: 'medical-terms' })

      expect(result).toMatchObject({
        vocabularyName: 'medical-terms',
        languageCode: 'en-US',
        vocabularyState: 'READY',
        downloadUri: 'https://s3.amazonaws.com/vocab.txt',
      })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.getVocabulary(null)).rejects.toThrow('vocabularyName is required.')
    })
  })

  describe('listVocabularies', () => {
    it('sends correct request with no filters', async () => {
      jsonRequestMock.mockResolvedValue({
        Vocabularies: [
          { VocabularyName: 'vocab-1', LanguageCode: 'en-US', VocabularyState: 'READY' },
        ],
        NextToken: 'next-page',
      })

      const result = await service.listVocabularies()

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListVocabularies')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({})

      expect(result.vocabularies).toHaveLength(1)

      expect(result.vocabularies[0]).toMatchObject({
        vocabularyName: 'vocab-1',
        vocabularyState: 'READY',
      })

      expect(result.cursor).toBe('next-page')
    })

    it('passes all filters', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      await service.listVocabularies('READY', 'medical', 25, 'cursor-xyz')

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({
        StateEquals: 'READY',
        NameContains: 'medical',
        MaxResults: 25,
        NextToken: 'cursor-xyz',
      })
    })

    it('returns null cursor when no NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      const result = await service.listVocabularies()

      expect(result.cursor).toBeNull()
    })
  })

  describe('deleteVocabulary', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteVocabulary('old-vocab')

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.DeleteVocabulary')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ VocabularyName: 'old-vocab' })
      expect(result).toEqual({ deleted: true, vocabularyName: 'old-vocab' })
    })

    it('throws when vocabularyName is missing', async () => {
      await expect(service.deleteVocabulary(null)).rejects.toThrow('vocabularyName is required.')
    })
  })

  // ── Dictionary Methods ──

  describe('getVocabulariesDictionary', () => {
    it('returns formatted dictionary items', async () => {
      jsonRequestMock.mockResolvedValue({
        Vocabularies: [
          { VocabularyName: 'medical-terms', VocabularyState: 'READY' },
          { VocabularyName: 'legal-terms', VocabularyState: 'PENDING' },
        ],
        NextToken: null,
      })

      const result = await service.getVocabulariesDictionary({})

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListVocabularies')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ MaxResults: 100 })

      expect(result.items).toEqual([
        { label: 'medical-terms', value: 'medical-terms', note: 'READY' },
        { label: 'legal-terms', value: 'legal-terms', note: 'PENDING' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('passes search and cursor', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [], NextToken: 'next' })

      const result = await service.getVocabulariesDictionary({ search: 'med', cursor: 'prev' })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({ MaxResults: 100, NameContains: 'med', NextToken: 'prev' })
      expect(result.cursor).toBe('next')
    })

    it('handles empty payload', async () => {
      jsonRequestMock.mockResolvedValue({ Vocabularies: [] })

      const result = await service.getVocabulariesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTranscriptionJobsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      jsonRequestMock.mockResolvedValue({
        TranscriptionJobSummaries: [
          { TranscriptionJobName: 'meeting-2024', TranscriptionJobStatus: 'COMPLETED' },
        ],
      })

      const result = await service.getTranscriptionJobsDictionary({})

      expect(jsonRequestMock.mock.calls[0][0].target).toBe('Transcribe.ListTranscriptionJobs')
      expect(jsonRequestMock.mock.calls[0][0].body).toEqual({ MaxResults: 100 })

      expect(result.items).toEqual([
        { label: 'meeting-2024', value: 'meeting-2024', note: 'COMPLETED' },
      ])
    })

    it('passes search and cursor', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      await service.getTranscriptionJobsDictionary({ search: 'meeting', cursor: 'tok' })

      const body = jsonRequestMock.mock.calls[0][0].body

      expect(body).toEqual({ MaxResults: 100, JobNameContains: 'meeting', NextToken: 'tok' })
    })

    it('handles empty payload', async () => {
      jsonRequestMock.mockResolvedValue({ TranscriptionJobSummaries: [] })

      const result = await service.getTranscriptionJobsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('maps BadRequestException', async () => {
      const err = new Error('Invalid S3 URI')

      err.name = 'BadRequestException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listTranscriptionJobs()).rejects.toThrow('Invalid request:')
    })

    it('maps LimitExceededException', async () => {
      const err = new Error('Too many requests')

      err.name = 'LimitExceededException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listVocabularies()).rejects.toThrow('Limit exceeded:')
    })

    it('maps unknown errors through mapAwsError', async () => {
      const err = new Error('Something unexpected')

      err.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.listTranscriptionJobs()).rejects.toThrow('throttled by AWS')
    })
  })
})

const SIGNING_URL = 'https://transcribe.us-east-1.amazonaws.com/'
const SIGNING_BODY = '{"MaxResults":5}'
const SIGNING_SERVICE = 'transcribe'
const SESSION_NAME_PREFIX = 'flowrunner-transcribe-'

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules (sigv4.js, aws-client.js, credentials.js, errors.js)
// ─────────────────────────────────────────────────────────────────────────────

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
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

// Well-known credentials from the official AWS SigV4 test suite.
const SIGV4_CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

// The frozen clock used for every signature assertion. Signatures are only ever
// asserted under fake timers — never against a live clock.
const FIXED_NOW = new Date('2015-08-30T12:36:00Z')
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

// ── Independent SigV4 reference implementation ──
//
// Written from the AWS "Create a signed AWS API request" specification, NOT derived
// from src/sigv4.js. It is validated below against the published AWS SigV4 test-suite
// vector (`get-vanilla`), which makes it a trustworthy oracle for the service's signer.

const sha256Hex = data => crypto.createHash('sha256').update(data).digest('hex')
const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest()

function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
}

function referenceSign({ method, url, headers, payloadHash, credentials, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri =
    '/' + parsed.pathname.slice(1).split('/').map(seg => rfc3986Encode(decodeURIComponent(seg))).join('/')

  const canonicalQuery = [...parsed.searchParams.entries()]
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${ key }=${ value }`)
    .join('&')

  const lowered = Object.keys(headers)
    .map(key => [key.toLowerCase(), String(headers[key]).trim()])
    .sort()

  const canonicalHeaders = lowered.map(([key, value]) => `${ key }:${ value }\n`).join('')
  const signedHeaders = lowered.map(([key]) => key).join(';')

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256('AWS4' + credentials.secretAccessKey, dateStamp), region), service),
    'aws4_request'
  )

  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  return {
    signature,
    signedHeaders,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
      `SignedHeaders=${ signedHeaders }, Signature=${ signature }`,
  }
}

// Drives the mocked `https.request` / `http.request` with a canned response.
function stubTransport({
  statusCode = 200,
  body = '',
  error = null,
  responseError = null,
  fireTimeout = false,
  transport = https,
} = {}) {
  const captured = { options: null, written: [], timeoutMs: null, destroyedWith: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.destroy = jest.fn(err => {
      captured.destroyedWith = err

      if (err) {
        process.nextTick(() => req.emit('error', err))
      }
    })

    req.setTimeout = jest.fn((ms, onTimeout) => {
      captured.timeoutMs = ms

      if (fireTimeout) {
        onTimeout()
      }
    })

    req.end = () => {
      if (fireTimeout) {
        return
      }

      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)

        if (responseError) {
          res.emit('error', responseError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

describe('config-items', () => {
  it('exposes the six AWS config items, none of them shared', () => {
    expect(awsConfigItems.map(item => item.name)).toEqual([
      'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
    ])

    expect(awsConfigItems.every(item => item.shared === false)).toBe(true)

    expect(awsConfigItems[0]).toMatchObject({
      type: 'CHOICE',
      required: true,
      defaultValue: 'API Key',
      options: ['API Key', 'IAM Role'],
    })

    expect(awsConfigItems[1]).toMatchObject({ type: 'STRING', required: true, defaultValue: 'us-east-1' })
  })
})

// ── sigv4.js ──

describe('sigv4 reference oracle', () => {
  it('reproduces the published AWS SigV4 test-suite vector (get-vanilla)', () => {
    const { authorization } = referenceSign({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': FIXED_AMZ_DATE },
      payloadHash: sha256Hex(''),
      credentials: SIGV4_CREDS,
      region: 'us-east-1',
      service: 'service',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })
})

describe('sigv4 signRequest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-amz-json-1.1', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || SIGNING_URL,
      headers,
      overrides.body !== undefined ? overrides.body : SIGNING_BODY,
      overrides.credentials || SIGV4_CREDS,
      overrides.region || 'us-east-1',
      overrides.service || SIGNING_SERVICE
    )

    return headers
  }

  // Recomputes the expected authorization header with the independent reference.
  function expectedAuthorization(headers, { region = 'us-east-1', service = SIGNING_SERVICE, method = 'POST', url = SIGNING_URL, credentials = SIGV4_CREDS } = {}) {
    const signedInput = { ...headers }

    delete signedInput.authorization

    return referenceSign({
      method,
      url,
      headers: signedInput,
      payloadHash: headers['x-amz-content-sha256'],
      credentials,
      region,
      service,
      amzDate: headers['x-amz-date'],
    }).authorization
  }

  it('sets the deterministic SigV4 headers under a frozen clock', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe(new URL(SIGNING_URL).hostname)
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(SIGNING_BODY))

    expect(headers['authorization']).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/${ SIGNING_SERVICE }/aws4_request, ` +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('matches the independently derived reference signature', () => {
    const headers = sign()

    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('matches the reference for a GET with a query string and an encoded path', () => {
    const url = `https://${ SIGNING_SERVICE }.eu-west-1.amazonaws.com/2015-03-31/functions/my%20fn?Marker=a&MaxItems=2`
    const headers = sign({ method: 'GET', url, body: '', region: 'eu-west-1' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, region: 'eu-west-1' }))
  })

  it('produces a stable signature for identical input', () => {
    expect(sign()['authorization']).toBe(sign()['authorization'])
  })

  it('changes the signature when the payload, secret, region or service change', () => {
    const baseline = sign()['authorization']

    expect(sign({ body: `${ SIGNING_BODY } ` })['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...SIGV4_CREDS, secretAccessKey: 'OTHER' } })['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })['authorization']).not.toBe(baseline)
    expect(sign({ service: 'other-service' })['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    expect(sign({ body: '' })['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(sign({ body: null })['x-amz-content-sha256']).toBe(sha256Hex(''))
  })

  it('adds the session token to the signed headers when present', () => {
    const headers = sign({ credentials: { ...SIGV4_CREDS, sessionToken: 'SESSION' } })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toBe(
      expectedAuthorization(headers, { credentials: { ...SIGV4_CREDS, sessionToken: 'SESSION' } })
    )
  })

  it('keeps an existing host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    expect(sign({ url: 'https://localhost:4566/' })['host']).toBe('localhost:4566')
    expect(sign({ url: 'https://localhost:443/' })['host']).toBe('localhost')
  })

  it('signs a body with multi-byte and reserved characters identically to the reference', () => {
    const body = 'Message=café & résumé (100%)'
    const headers = sign({ body })

    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(body))
    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('canonicalizes the path and is insensitive to query ordering', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/my bucket/a+b (1).txt?b=2&a=1'
    const reordered = 'https://s3.us-east-1.amazonaws.com/my bucket/a+b (1).txt?a=1&b=2'

    const first = sign({ method: 'GET', url, body: '', service: 's3' })
    const second = sign({ method: 'GET', url: reordered, body: '', service: 's3' })

    expect(first['authorization']).toBe(second['authorization'])
    expect(first['authorization']).toBe(expectedAuthorization(first, { method: 'GET', url, service: 's3' }))
  })

  it('sorts repeated query parameters by value', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/bucket?a=2&a=1'
    const headers = sign({ method: 'GET', url, body: '', service: 's3' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, service: 's3' }))
  })

  it('percent-encodes multi-byte characters in the path and query byte by byte', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/bucket/r\u00e9sum\u00e9.txt?nom=caf\u00e9'
    const headers = sign({ method: 'GET', url, body: '', service: 's3' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, service: 's3' }))
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  // Re-derives the presigned signature from the produced URL using the independent reference.
  function referencePresignedSignature(presigned, { region = 'us-east-1', service = 's3', method = 'GET' } = {}) {
    const parsed = new URL(presigned)

    parsed.searchParams.delete('X-Amz-Signature')

    const port = parsed.port && parsed.port !== '443' && parsed.port !== '80' ? `:${ parsed.port }` : ''

    return referenceSign({
      method,
      url: parsed.toString(),
      headers: { host: `${ parsed.hostname }${ port }` },
      payloadHash: 'UNSIGNED-PAYLOAD',
      credentials: SIGV4_CREDS,
      region,
      service,
      amzDate: parsed.searchParams.get('X-Amz-Date'),
    }).signature
  }

  it('adds every SigV4 query parameter and a reference-verified signature', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      900
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`)
    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
    expect(url.searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('includes the session token and a non-standard port in the signature', () => {
    const presigned = generatePresignedUrl(
      'PUT',
      'https://localhost:4566/bucket/key',
      { ...SIGV4_CREDS, sessionToken: 'SESSION' },
      'us-east-1',
      's3',
      60
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sorts repeated query parameters carried over from the source URL', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://b.s3.amazonaws.com/k?tag=2&tag=1',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      60
    )

    expect(new URL(presigned).searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('is stable for identical input and sensitive to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const longer = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 3600)

    expect(first).toBe(second)
    expect(longer).not.toBe(first)
  })
})

// ── aws-client.js: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag and returns null when absent', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
  })

  it('extracts every matching tag, including multi-line values', () => {
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

// ── aws-client.js: httpRequest ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubTransport({ statusCode: 200, body: '<ok/>' })

    const response = await httpRequest(
      'POST',
      'https://example.us-east-1.amazonaws.com/path?a=1',
      { 'content-type': 'text/plain' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'example.us-east-1.amazonaws.com',
      port: 443,
      path: '/path?a=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(captured.timeoutMs).toBe(30000)
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '<ok/>' })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubTransport({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://example.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('honours an explicit port', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'x' })

    await httpRequest('GET', 'https://localhost:4566/health', {})

    expect(captured.options.port).toBe('4566')
  })

  it('uses the http transport and port 80 for http URLs', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'plain', transport: http })

    const response = await httpRequest('GET', 'http://localhost/health', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options.port).toBe(80)
    expect(response.body).toBe('plain')
  })

  it('rejects on a transport error', async () => {
    stubTransport({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    stubTransport({ responseError: new Error('stream aborted') })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('stream aborted')
  })

  it('destroys the request and rejects when the socket times out', async () => {
    const captured = stubTransport({ fireTimeout: true })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('Request timed out')

    expect(captured.destroyedWith).toBeInstanceOf(Error)
  })
})

// ── aws-client.js: stsAssumeRole ──

describe('stsAssumeRole', () => {
  const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

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

  it('signs the STS call and returns the temporary credentials', async () => {
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(SIGV4_CREDS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

    expect(captured.options).toMatchObject({
      hostname: 'sts.eu-west-1.amazonaws.com',
      port: 443,
      path: '/',
      method: 'POST',
    })

    expect(captured.options.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(captured.options.headers['content-length']).toBeGreaterThan(0)

    expect(captured.written.join('')).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
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

  it('omits the external id when it is not provided', async () => {
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 'session-2')

    expect(captured.written.join('')).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubTransport({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body has no Code or Message', async () => {
    stubTransport({ statusCode: 500, body: '<html>gateway</html>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubTransport({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>A</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSParseError',
      message: expect.stringContaining('missing credential fields'),
    })
  })

  it('propagates a socket error', async () => {
    stubTransport({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow('socket hang up')
  })
})

// ── aws-client.js: AWS JSON protocol ──

describe('buildAwsJsonRequest', () => {
  it('builds a POST with the target header', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'transcribe',
      target: 'Transcribe.ListVocabularies',
      body: { MaxResults: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://transcribe.us-east-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Transcribe.ListVocabularies',
      },
      body: '{"MaxResults":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({ region: 'us-east-1', service: 'x', body: '{"a":1}', contentType: 'application/json' })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'x', contentType: 'application/json' }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('treats an empty or missing body as an empty object', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error for an AWS __type error body', () => {
    try {
      parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest', () => {
  it('signs and sends the built request through the injected transport', async () => {
    const signRequestMock = jest.fn((method, url, headers) => {
      headers.authorization = 'AWS4-HMAC-SHA256 signed'
    })

    const httpRequestMock = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Vocabularies":[]}' })

    const result = await jsonRequest(
      {
        region: 'us-east-1',
        service: 'transcribe',
        target: 'Transcribe.ListVocabularies',
        contentType: 'application/x-amz-json-1.1',
        body: { MaxResults: 1 },
      },
      SIGV4_CREDS,
      { signRequest: signRequestMock, httpRequest: httpRequestMock }
    )

    expect(result).toEqual({ Vocabularies: [] })

    expect(signRequestMock).toHaveBeenCalledWith(
      'POST',
      'https://transcribe.us-east-1.amazonaws.com/',
      expect.any(Object),
      '{"MaxResults":1}',
      SIGV4_CREDS,
      'us-east-1',
      'transcribe'
    )

    expect(httpRequestMock.mock.calls[0][2]).toMatchObject({
      'authorization': 'AWS4-HMAC-SHA256 signed',
      'x-amz-target': 'Transcribe.ListVocabularies',
    })
  })

  it('throws the parsed AWS error for a failed response', async () => {
    await expect(
      jsonRequest({ region: 'us-east-1', service: 'transcribe', contentType: 'application/x-amz-json-1.1' }, SIGV4_CREDS, {
        signRequest: () => {},
        httpRequest: async () => ({ statusCode: 400, body: '{"__type":"x#LimitExceededException","message":"too many"}' }),
      })
    ).rejects.toThrow('too many')
  })

  it('falls back to the real signer and transport when no deps are injected', async () => {
    const captured = stubTransport({ statusCode: 200, body: '{"ok":true}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'transcribe', target: 'T.Op', contentType: 'application/x-amz-json-1.1', body: {} },
      SIGV4_CREDS
    )

    expect(result).toEqual({ ok: true })
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)

    https.request.mockReset()
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('accepts an empty config', async () => {
    await expect(new CredentialProvider().resolve()).rejects.toThrow(/API Key authentication/)
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes past the expiry buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    })

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
      `${ SESSION_NAME_PREFIX }${ now }`,
      'ext'
    )

    // Cache hit — still well inside the 5 minute expiry buffer.
    now += 1000

    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Past the expiry buffer — the credentials are refreshed.
    now += 3400000

    await provider.resolve()
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role', accessKeyId: 'AK' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('defaults to the real stsAssumeRole and Date.now', async () => {
    stubTransport({
      statusCode: 200,
      body:
        '<AssumeRoleResponse><Credentials><AccessKeyId>ASIA9</AccessKeyId>' +
        '<SecretAccessKey>SEC9</SecretAccessKey><SessionToken>TOK9</SessionToken>' +
        '<Expiration>2030-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResponse>',
    })

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      roleArn: 'arn:role',
    })

    await expect(provider.resolve()).resolves.toEqual({
      accessKeyId: 'ASIA9',
      secretAccessKey: 'SEC9',
      sessionToken: 'TOK9',
    })

    https.request.mockReset()
  })
})

// ── errors.js ──

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('Sample')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[Sample Service]', 'info:', 'a'],
      ['[Sample Service]', 'debug:', 'b'],
      ['[Sample Service]', 'warn:', 'c'],
      ['[Sample Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

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

  it('handles an error without a name or message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

// ── index.js: construction, transcript download and remaining error paths ──

describe('Transcribe internals', () => {
  let Transcribe

  // Required lazily: the entry file must only be loaded once the sandbox global exists.
  beforeAll(() => {
    ({ Transcribe } = require('../src/index.js'))
  })

  function makeService() {
    const instance = new Transcribe({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    instance.deps.jsonRequest = jest.fn()

    return instance
  }

  // Drives the mocked `https.get` used by the transcript downloader.
  function stubHttpsGet({ statusCode = 200, body = '', getError = null, throwSync = false } = {}) {
    https.get.mockImplementation((uri, callback) => {
      if (throwSync) {
        throw new Error('Invalid URL')
      }

      const req = new EventEmitter()

      process.nextTick(() => {
        if (getError) {
          req.emit('error', getError)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.resume = jest.fn()

        callback(res)

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })

      return req
    })
  }

  const COMPLETED_JOB = {
    TranscriptionJob: {
      TranscriptionJobName: 'my-job',
      TranscriptionJobStatus: 'COMPLETED',
      Transcript: { TranscriptFileUri: 'https://example.com/transcript.json' },
    },
  }

  afterEach(() => {
    https.get.mockReset()
  })

  it('defaults the region to us-east-1 and builds a credential provider', () => {
    const bare = new Transcribe()

    expect(bare.region).toBe('us-east-1')
    expect(bare.credentials).toBeInstanceOf(CredentialProvider)
    expect(bare.credentials.region).toBe('us-east-1')
    expect(bare.credentials.authenticationMethod).toBe('API Key')
    expect(typeof bare.deps.jsonRequest).toBe('function')
  })

  it('resolves credentials and forwards them to jsonRequest', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue({ Vocabularies: [] })

    await instance.listVocabularies()

    expect(instance.deps.jsonRequest).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1', service: 'transcribe' }),
      { accessKeyId: 'AK', secretAccessKey: 'SK' }
    )
  })

  it('downloads and returns the transcript text when requested', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)

    stubHttpsGet({
      statusCode: 200,
      body: JSON.stringify({ results: { transcripts: [{ transcript: 'Hello and welcome.' }] } }),
    })

    const result = await instance.getTranscriptionJob('my-job', true)

    expect(https.get).toHaveBeenCalledWith('https://example.com/transcript.json', expect.any(Function))
    expect(result.transcriptText).toBe('Hello and welcome.')
  })

  it('returns a null transcript text when the transcript has no transcripts array', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)
    stubHttpsGet({ statusCode: 200, body: JSON.stringify({ results: {} }) })

    await expect(instance.getTranscriptionJob('my-job', true)).resolves.toMatchObject({ transcriptText: null })
  })

  it('returns a null transcript text when the download fails with a non-2xx status', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)
    stubHttpsGet({ statusCode: 403, body: 'denied' })

    await expect(instance.getTranscriptionJob('my-job', true)).resolves.toMatchObject({ transcriptText: null })
  })

  it('returns a null transcript text when the transcript body is not valid JSON', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)
    stubHttpsGet({ statusCode: 200, body: 'not json' })

    await expect(instance.getTranscriptionJob('my-job', true)).resolves.toMatchObject({ transcriptText: null })
  })

  it('returns a null transcript text when the download socket errors', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)
    stubHttpsGet({ getError: new Error('socket hang up') })

    await expect(instance.getTranscriptionJob('my-job', true)).resolves.toMatchObject({ transcriptText: null })
  })

  it('returns a null transcript text when https.get throws synchronously', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue(COMPLETED_JOB)
    stubHttpsGet({ throwSync: true })

    await expect(instance.getTranscriptionJob('my-job', true)).resolves.toMatchObject({ transcriptText: null })
  })

  it('skips the transcript download for jobs that are not COMPLETED', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobName: 'my-job',
        TranscriptionJobStatus: 'IN_PROGRESS',
        Transcript: { TranscriptFileUri: 'https://example.com/transcript.json' },
      },
    })

    const result = await instance.getTranscriptionJob('my-job', true)

    expect(https.get).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('transcriptText')
  })

  it('defaults list results to empty arrays when the response omits them', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue({})

    await expect(instance.listTranscriptionJobs()).resolves.toEqual({ jobs: [], cursor: null })
    await expect(instance.listVocabularies()).resolves.toEqual({ vocabularies: [], cursor: null })
    await expect(instance.getVocabulariesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    await expect(instance.getTranscriptionJobsDictionary({})).resolves.toEqual({ items: [], cursor: null })
  })

  it('formats a vocabulary from an empty response', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue({})

    await expect(instance.getVocabulary('v')).resolves.toEqual({
      vocabularyName: undefined,
      languageCode: undefined,
      vocabularyState: undefined,
      lastModifiedTime: undefined,
      failureReason: undefined,
      downloadUri: undefined,
    })
  })

  it('formats a job and a vocabulary with missing payloads', async () => {
    const instance = makeService()

    instance.deps.jsonRequest.mockResolvedValue({})

    await expect(instance.getTranscriptionJob('my-job')).resolves.toEqual({
      transcriptionJobName: undefined,
      status: undefined,
      languageCode: undefined,
      languageCodes: undefined,
      identifyLanguage: undefined,
      mediaFormat: undefined,
      mediaFileUri: undefined,
      transcriptFileUri: undefined,
      subtitleFileUris: undefined,
      settings: undefined,
      creationTime: undefined,
      startTime: undefined,
      completionTime: undefined,
      failureReason: undefined,
    })
  })

  describe('error mapping for the remaining operations', () => {
    const cases = [
      ['startTranscriptionJob', s => s.startTranscriptionJob('job', 's3://b/a.mp3', 'en-US')],
      ['getTranscriptionJob', s => s.getTranscriptionJob('job')],
      ['listTranscriptionJobs', s => s.listTranscriptionJobs()],
      ['deleteTranscriptionJob', s => s.deleteTranscriptionJob('job')],
      ['createVocabulary', s => s.createVocabulary('v', 'en-US', ['a'])],
      ['getVocabulary', s => s.getVocabulary('v')],
      ['listVocabularies', s => s.listVocabularies()],
      ['deleteVocabulary', s => s.deleteVocabulary('v')],
      ['getVocabulariesDictionary', s => s.getVocabulariesDictionary({})],
      ['getTranscriptionJobsDictionary', s => s.getTranscriptionJobsDictionary({})],
    ]

    it.each(cases)('maps AWS failures raised by %s', async (_name, call) => {
      const instance = makeService()
      const error = new Error('Rate exceeded')

      error.name = 'ThrottlingException'
      instance.deps.jsonRequest.mockRejectedValue(error)

      await expect(call(instance)).rejects.toThrow('Request was throttled by AWS: Rate exceeded')
    })

    it.each([
      ['ConflictException', 'Conflict: '],
      ['BadRequestException', 'Invalid request: '],
      ['NotFoundException', 'Not found: '],
      ['LimitExceededException', 'Limit exceeded: '],
    ])('maps %s to a friendly message', async (name, prefix) => {
      const instance = makeService()
      const error = new Error('boom')

      error.name = name
      instance.deps.jsonRequest.mockRejectedValue(error)

      await expect(instance.getVocabulary('v')).rejects.toThrow(`${ prefix }boom`)
    })

    it('handles a thrown value without a name', async () => {
      const instance = makeService()

      instance.deps.jsonRequest.mockRejectedValue(new Error('plain failure'))

      await expect(instance.deleteVocabulary('v')).rejects.toThrow('plain failure')
    })
  })
})
