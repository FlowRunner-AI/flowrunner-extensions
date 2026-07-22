'use strict'

const crypto = require('crypto')
const { EventEmitter } = require('events')

const { createSandbox } = require('../../../service-sandbox')

// ── Transport stub ─────────────────────────────────────────────────────────
// The AWS helper modules sign and send their own requests through node's
// `https`/`http` modules instead of Flowrunner.Request, so both transports are
// replaced with an EventEmitter-based stub. That keeps the suite offline and
// lets every branch (success, socket error, response-stream error, timeout) be
// driven explicitly.

let mockCalls = []
let mockResponse = { statusCode: 200, body: '{}', headers: {} }
let mockSocketError = null
let mockResponseError = null
let mockHang = false

function mockCreateTransport(protocol) {
  return {
    request(options, callback) {
      const req = new EventEmitter()
      const call = { protocol, options, written: [], req }

      mockCalls.push(call)

      req.write = chunk => {
        call.written.push(chunk)

        return true
      }

      req.setTimeout = (ms, handler) => {
        call.timeoutMs = ms
        call.fireTimeout = handler

        return req
      }

      req.destroy = error => {
        call.destroyedWith = error
        req.emit('error', error)
      }

      req.end = () => {
        if (mockHang) {
          return
        }

        if (mockSocketError) {
          req.emit('error', mockSocketError)

          return
        }

        const res = new EventEmitter()

        res.statusCode = mockResponse.statusCode
        res.headers = mockResponse.headers || {}

        callback(res)

        if (mockResponseError) {
          res.emit('error', mockResponseError)

          return
        }

        res.emit('data', Buffer.from(mockResponse.body || ''))
        res.emit('end')
      }

      return req
    },
  }
}

jest.mock('https', () => mockCreateTransport('https:'))
jest.mock('http', () => mockCreateTransport('http:'))

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

const ACCESS_KEY_ID = 'test-access-key-id'
const SECRET_ACCESS_KEY = 'test-secret-access-key'
const REGION = 'us-west-2'

describe('AWS Comprehend Service', () => {
  let sandbox
  let service
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()

    // The service uses its own HTTP client (Node https + SigV4), not Flowrunner.Request.
    // We mock deps.jsonRequest which sendJson() delegates to.
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

  // ── Detect Sentiment ──

  describe('detectSentiment', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        Sentiment: 'POSITIVE',
        SentimentScore: { Positive: 0.98, Negative: 0.001, Neutral: 0.018, Mixed: 0.001 },
      })

      const result = await service.detectSentiment('I love this product', 'English')

      expect(result).toEqual({
        sentiment: 'POSITIVE',
        sentimentScore: { Positive: 0.98, Negative: 0.001, Neutral: 0.018, Mixed: 0.001 },
      })

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)
      const [opts, creds] = jsonRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'comprehend',
        target: 'Comprehend_20171127.DetectSentiment',
        contentType: 'application/x-amz-json-1.1',
        body: { Text: 'I love this product', LanguageCode: 'en' },
      })

      expect(creds).toEqual({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY })
    })

    it('resolves language dropdown label to code', async () => {
      jsonRequestMock.mockResolvedValue({ Sentiment: 'NEUTRAL', SentimentScore: {} })

      await service.detectSentiment('Hola mundo', 'Spanish')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.LanguageCode).toBe('es')
    })

    it('passes through raw language code unchanged', async () => {
      jsonRequestMock.mockResolvedValue({ Sentiment: 'NEUTRAL', SentimentScore: {} })

      await service.detectSentiment('Some text', 'de')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.LanguageCode).toBe('de')
    })

    it('throws when text is empty', async () => {
      await expect(service.detectSentiment('', 'English')).rejects.toThrow('text is required')
    })

    it('throws when text is not a string', async () => {
      await expect(service.detectSentiment(123, 'English')).rejects.toThrow('text is required')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.detectSentiment('Some text')).rejects.toThrow('languageCode is required')
    })

    it('returns null fields when API response has no data', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectSentiment('text', 'en')

      expect(result).toEqual({ sentiment: null, sentimentScore: null })
    })

    it('handles TextSizeLimitExceededException', async () => {
      const err = new Error('Text too large')

      err.name = 'TextSizeLimitExceededException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('Text size limit exceeded')
    })

    it('handles UnsupportedLanguageException', async () => {
      const err = new Error('Language not supported')

      err.name = 'UnsupportedLanguageException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('Unsupported language')
    })

    it('handles InvalidRequestException', async () => {
      const err = new Error('Bad input')

      err.name = 'InvalidRequestException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('Invalid request')
    })

    it('handles ThrottlingException via mapAwsError', async () => {
      const err = new Error('Rate exceeded')

      err.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('throttled')
    })

    it('handles AccessDeniedException via mapAwsError', async () => {
      const err = new Error('Not authorized')

      err.name = 'AccessDeniedException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('Access denied')
    })

    it('handles InvalidSignatureException via mapAwsError', async () => {
      const err = new Error('Signature mismatch')

      err.name = 'InvalidSignatureException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectSentiment('text', 'en')).rejects.toThrow('Invalid AWS credentials')
    })
  })

  // ── Detect Entities ──

  describe('detectEntities', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        Entities: [{ Type: 'PERSON', Text: 'John', Score: 0.999, BeginOffset: 0, EndOffset: 4 }],
      })

      const result = await service.detectEntities('John went to Paris', 'English')

      expect(result).toEqual({
        entities: [{ Type: 'PERSON', Text: 'John', Score: 0.999, BeginOffset: 0, EndOffset: 4 }],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectEntities')
      expect(opts.body).toEqual({ Text: 'John went to Paris', LanguageCode: 'en' })
    })

    it('returns empty array when no entities found', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectEntities('text', 'en')

      expect(result).toEqual({ entities: [] })
    })

    it('throws when text is missing', async () => {
      await expect(service.detectEntities(null, 'en')).rejects.toThrow('text is required')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.detectEntities('text')).rejects.toThrow('languageCode is required')
    })
  })

  // ── Detect Key Phrases ──

  describe('detectKeyPhrases', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        KeyPhrases: [{ Text: 'the quick report', Score: 0.999, BeginOffset: 0, EndOffset: 16 }],
      })

      const result = await service.detectKeyPhrases('Read the quick report', 'French')

      expect(result).toEqual({
        keyPhrases: [{ Text: 'the quick report', Score: 0.999, BeginOffset: 0, EndOffset: 16 }],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectKeyPhrases')
      expect(opts.body).toEqual({ Text: 'Read the quick report', LanguageCode: 'fr' })
    })

    it('returns empty array when no key phrases found', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectKeyPhrases('a', 'en')

      expect(result).toEqual({ keyPhrases: [] })
    })
  })

  // ── Detect Dominant Language ──

  describe('detectDominantLanguage', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        Languages: [{ LanguageCode: 'en', Score: 0.99 }],
      })

      const result = await service.detectDominantLanguage('Hello world')

      expect(result).toEqual({
        languages: [{ LanguageCode: 'en', Score: 0.99 }],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectDominantLanguage')
      expect(opts.body).toEqual({ Text: 'Hello world' })
    })

    it('does not require languageCode parameter', async () => {
      jsonRequestMock.mockResolvedValue({ Languages: [] })

      const result = await service.detectDominantLanguage('text')

      expect(result).toEqual({ languages: [] })
    })

    it('throws when text is missing', async () => {
      await expect(service.detectDominantLanguage('')).rejects.toThrow('text is required')
    })
  })

  // ── Detect PII Entities ──

  describe('detectPiiEntities', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        Entities: [{ Type: 'EMAIL', Score: 0.999, BeginOffset: 10, EndOffset: 27 }],
      })

      const result = await service.detectPiiEntities('Contact me at test@example.com', 'English')

      expect(result).toEqual({
        entities: [{ Type: 'EMAIL', Score: 0.999, BeginOffset: 10, EndOffset: 27 }],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectPiiEntities')
      expect(opts.body).toEqual({ Text: 'Contact me at test@example.com', LanguageCode: 'en' })
    })

    it('defaults to English when languageCode is not provided', async () => {
      jsonRequestMock.mockResolvedValue({ Entities: [] })

      await service.detectPiiEntities('some text')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.LanguageCode).toBe('en')
    })

    it('defaults to English when languageCode is empty string', async () => {
      jsonRequestMock.mockResolvedValue({ Entities: [] })

      await service.detectPiiEntities('some text', '')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.LanguageCode).toBe('en')
    })

    it('returns empty array when no PII entities found', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectPiiEntities('text')

      expect(result).toEqual({ entities: [] })
    })
  })

  // ── Detect Syntax ──

  describe('detectSyntax', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        SyntaxTokens: [
          { TokenId: 1, Text: 'They', BeginOffset: 0, EndOffset: 4, PartOfSpeech: { Tag: 'PRON', Score: 0.99 } },
        ],
      })

      const result = await service.detectSyntax('They ran fast', 'English')

      expect(result).toEqual({
        tokens: [
          { TokenId: 1, Text: 'They', BeginOffset: 0, EndOffset: 4, PartOfSpeech: { Tag: 'PRON', Score: 0.99 } },
        ],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectSyntax')
      expect(opts.body).toEqual({ Text: 'They ran fast', LanguageCode: 'en' })
    })

    it('returns empty array when no tokens found', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectSyntax('x', 'en')

      expect(result).toEqual({ tokens: [] })
    })
  })

  // ── Detect Targeted Sentiment ──

  describe('detectTargetedSentiment', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        Entities: [{
          DescriptiveMentionIndex: [0],
          Mentions: [{
            Text: 'food',
            Type: 'OTHER',
            Score: 0.99,
            MentionSentiment: { Sentiment: 'POSITIVE', SentimentScore: { Positive: 0.98 } },
          }],
        }],
      })

      const result = await service.detectTargetedSentiment('The food was great', 'English')

      expect(result).toHaveProperty('entities')
      expect(result.entities).toHaveLength(1)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.DetectTargetedSentiment')
      expect(opts.body).toEqual({ Text: 'The food was great', LanguageCode: 'en' })
    })

    it('defaults to English when languageCode is not provided', async () => {
      jsonRequestMock.mockResolvedValue({ Entities: [] })

      await service.detectTargetedSentiment('text')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.LanguageCode).toBe('en')
    })

    it('returns empty array when no entities found', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.detectTargetedSentiment('x')

      expect(result).toEqual({ entities: [] })
    })
  })

  // ── Batch Detect Sentiment ──

  describe('batchDetectSentiment', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        ResultList: [
          { Index: 0, Sentiment: 'POSITIVE', SentimentScore: { Positive: 0.98 } },
          { Index: 1, Sentiment: 'NEGATIVE', SentimentScore: { Negative: 0.95 } },
        ],
        ErrorList: [],
      })

      const result = await service.batchDetectSentiment(['I love it', 'I hate it'], 'English')

      expect(result).toEqual({
        resultList: [
          { Index: 0, Sentiment: 'POSITIVE', SentimentScore: { Positive: 0.98 } },
          { Index: 1, Sentiment: 'NEGATIVE', SentimentScore: { Negative: 0.95 } },
        ],
        errorList: [],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.BatchDetectSentiment')
      expect(opts.body).toEqual({ TextList: ['I love it', 'I hate it'], LanguageCode: 'en' })
    })

    it('throws when textList is not an array', async () => {
      await expect(service.batchDetectSentiment('not an array', 'en')).rejects.toThrow('textList must be a non-empty array')
    })

    it('throws when textList is empty', async () => {
      await expect(service.batchDetectSentiment([], 'en')).rejects.toThrow('textList must be a non-empty array')
    })

    it('throws when textList exceeds 25 documents', async () => {
      const textList = Array.from({ length: 26 }, (_, i) => `doc ${ i }`)

      await expect(service.batchDetectSentiment(textList, 'en')).rejects.toThrow('maximum of 25 documents')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.batchDetectSentiment(['text'])).rejects.toThrow('languageCode is required')
    })

    it('handles BatchSizeLimitExceededException', async () => {
      const err = new Error('Batch too large')

      err.name = 'BatchSizeLimitExceededException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.batchDetectSentiment(['text'], 'en')).rejects.toThrow('Batch size limit exceeded')
    })

    it('returns empty arrays when API response is sparse', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.batchDetectSentiment(['text'], 'en')

      expect(result).toEqual({ resultList: [], errorList: [] })
    })
  })

  // ── Batch Detect Entities ──

  describe('batchDetectEntities', () => {
    it('sends correct request and returns shaped response', async () => {
      jsonRequestMock.mockResolvedValue({
        ResultList: [
          { Index: 0, Entities: [{ Type: 'PERSON', Text: 'John', Score: 0.99 }] },
        ],
        ErrorList: [],
      })

      const result = await service.batchDetectEntities(['John is here'], 'English')

      expect(result).toEqual({
        resultList: [
          { Index: 0, Entities: [{ Type: 'PERSON', Text: 'John', Score: 0.99 }] },
        ],
        errorList: [],
      })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('Comprehend_20171127.BatchDetectEntities')
      expect(opts.body).toEqual({ TextList: ['John is here'], LanguageCode: 'en' })
    })

    it('throws when textList is not an array', async () => {
      await expect(service.batchDetectEntities('string', 'en')).rejects.toThrow('textList must be a non-empty array')
    })

    it('throws when textList is empty', async () => {
      await expect(service.batchDetectEntities([], 'en')).rejects.toThrow('textList must be a non-empty array')
    })

    it('throws when textList exceeds 25 documents', async () => {
      const textList = Array.from({ length: 26 }, (_, i) => `doc ${ i }`)

      await expect(service.batchDetectEntities(textList, 'en')).rejects.toThrow('maximum of 25 documents')
    })

    it('throws when languageCode is missing', async () => {
      await expect(service.batchDetectEntities(['text'])).rejects.toThrow('languageCode is required')
    })
  })

  // ── Language Resolution ──

  describe('language code resolution', () => {
    it('resolves Chinese (Simplified) to zh', async () => {
      jsonRequestMock.mockResolvedValue({ Sentiment: 'NEUTRAL', SentimentScore: {} })

      await service.detectSentiment('text', 'Chinese (Simplified)')

      expect(jsonRequestMock.mock.calls[0][0].body.LanguageCode).toBe('zh')
    })

    it('resolves Chinese (Traditional) to zh-TW', async () => {
      jsonRequestMock.mockResolvedValue({ Sentiment: 'NEUTRAL', SentimentScore: {} })

      await service.detectSentiment('text', 'Chinese (Traditional)')

      expect(jsonRequestMock.mock.calls[0][0].body.LanguageCode).toBe('zh-TW')
    })

    it('resolves all supported language labels', async () => {
      const expected = {
        'English': 'en', 'Spanish': 'es', 'French': 'fr', 'German': 'de',
        'Italian': 'it', 'Portuguese': 'pt', 'Arabic': 'ar', 'Hindi': 'hi',
        'Japanese': 'ja', 'Korean': 'ko',
      }

      for (const [label, code] of Object.entries(expected)) {
        jsonRequestMock.mockResolvedValue({ Sentiment: 'NEUTRAL', SentimentScore: {} })

        await service.detectSentiment('text', label)

        expect(jsonRequestMock.mock.calls[0][0].body.LanguageCode).toBe(code)
        jsonRequestMock.mockReset()
      }
    })
  })

  // ── Error propagation from every operation ──

  describe('error propagation across operations', () => {
    // Each operation funnels transport failures through #handleError; this
    // covers the catch branch of the operations not exercised above.
    const operations = [
      ['detectSentiment', svc => svc.detectSentiment('text', 'English')],
      ['detectEntities', svc => svc.detectEntities('text', 'English')],
      ['detectKeyPhrases', svc => svc.detectKeyPhrases('text', 'English')],
      ['detectDominantLanguage', svc => svc.detectDominantLanguage('text')],
      ['detectPiiEntities', svc => svc.detectPiiEntities('text', 'English')],
      ['detectSyntax', svc => svc.detectSyntax('text', 'English')],
      ['detectTargetedSentiment', svc => svc.detectTargetedSentiment('text', 'English')],
      ['batchDetectSentiment', svc => svc.batchDetectSentiment(['a', 'b'], 'English')],
      ['batchDetectEntities', svc => svc.batchDetectEntities(['a', 'b'], 'English')],
    ]

    it.each(operations)('%s maps an InvalidRequestException', async (name, invoke) => {
      const error = new Error('bad input')

      error.name = 'InvalidRequestException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(invoke(service)).rejects.toThrow('Invalid request: bad input.')
    })

    it.each(operations)('%s falls through to the generic AWS mapping', async (name, invoke) => {
      const error = new Error('slow down')

      error.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(invoke(service)).rejects.toThrow(/^Request was throttled by AWS/)
    })

    it.each([
      ['TextSizeLimitExceededException', /^Text size limit exceeded/],
      ['UnsupportedLanguageException', /^Unsupported language/],
      ['BatchSizeLimitExceededException', /^Batch size limit exceeded/],
    ])('maps the %s error name', async (name, expected) => {
      const error = new Error('boom')

      error.name = name
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.detectSentiment('text', 'English')).rejects.toThrow(expected)
    })
  })

})

// ═══════════════════════════════════════════════════════════════════════════
// Helper modules (src/sigv4.js, src/aws-client.js, src/credentials.js,
// src/errors.js). These are exercised directly because index.js stubs the
// transport through `service.deps.jsonRequest`.
// ═══════════════════════════════════════════════════════════════════════════

const AWS_SERVICE = 'comprehend'
const ENDPOINT = `https://${ AWS_SERVICE }.us-east-1.amazonaws.com/`

const SIG_CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

/** A fixed instant so every signature in this suite is reproducible. */
const FIXED_NOW = Date.UTC(2015, 7, 30, 12, 36, 0)
const AMZ_DATE = '20150830T123600Z'
const DATE_STAMP = '20150830'

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex')
}

/**
 * Percent-encoding per RFC 3986, written from the spec (encodeURIComponent
 * leaves ! ' ( ) * unescaped, so those are patched up).
 */
function rfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  )
}

/**
 * An independent reference implementation of the AWS Signature Version 4
 * "Authorization header" calculation, written from the published AWS signing
 * specification rather than derived from src/sigv4.js. Golden values in this
 * suite come from here so the tests do not merely restate the implementation.
 *
 * @param {Object} input
 * @param {string} input.method
 * @param {string} input.url
 * @param {Object} input.headers every header that must be signed
 * @param {string} input.payload payload hash, or UNSIGNED-PAYLOAD
 * @param {string} input.secretAccessKey
 * @param {string} input.region
 * @param {string} input.service
 * @param {string} input.amzDate YYYYMMDD'T'HHmmss'Z'
 * @returns {{signature: string, signedHeaders: string, scope: string}}
 */
function referenceSigV4({ method, url, headers, payload, secretAccessKey, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const canonicalQueryString = Array.from(parsed.searchParams.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(pair => pair.join('='))
    .join('&')

  const lowered = {}

  Object.keys(headers).forEach(key => {
    lowered[key.toLowerCase()] = String(headers[key]).trim()
  })

  const names = Object.keys(lowered).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ lowered[name] }\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    method,
    parsed.pathname || '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payload,
  ].join('\n')

  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  let key = Buffer.from(`AWS4${ secretAccessKey }`, 'utf8')

  for (const part of [dateStamp, region, service, 'aws4_request']) {
    key = crypto.createHmac('sha256', key).update(part).digest()
  }

  return {
    signature: crypto.createHmac('sha256', key).update(stringToSign).digest('hex'),
    signedHeaders,
    scope,
  }
}

// ── sigv4.js ──

describe('AWS Comprehend sigv4', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('signRequest', () => {
    it('matches an independently computed SigV4 authorization header', () => {
      const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' }

      const returned = signRequest('POST', ENDPOINT, headers, '{}', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(returned).toBe(headers)
      expect(headers['x-amz-date']).toBe(AMZ_DATE)
      expect(headers['x-amz-content-sha256']).toBe(sha256Hex('{}'))
      expect(headers.host).toBe(`${ AWS_SERVICE }.us-east-1.amazonaws.com`)

      // The exact set of headers that must have been signed, stated up front.
      const expectedSignedHeaders = {
        'content-type': 'application/x-amz-json-1.1',
        'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
        'x-amz-content-sha256': sha256Hex('{}'),
        'x-amz-date': AMZ_DATE,
        'x-amz-target': 'Svc.Op',
      }

      const actualSignedHeaders = { ...headers }

      delete actualSignedHeaders.authorization

      expect(actualSignedHeaders).toEqual(expectedSignedHeaders)

      const reference = referenceSigV4({
        method: 'POST',
        url: ENDPOINT,
        headers: expectedSignedHeaders,
        payload: sha256Hex('{}'),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(reference.signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target')

      expect(headers.authorization).toBe(
        `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request, ` +
          `SignedHeaders=${ reference.signedHeaders }, ` +
          `Signature=${ reference.signature }`
      )
    })

    it('is stable for a fixed clock and sensitive to body, secret, region and service', () => {
      function sign(overrides = {}) {
        const headers = { 'content-type': 'application/x-amz-json-1.1' }

        signRequest(
          'POST',
          overrides.url || ENDPOINT,
          headers,
          overrides.body === undefined ? '{}' : overrides.body,
          overrides.credentials || SIG_CREDENTIALS,
          overrides.region || 'us-east-1',
          overrides.service || AWS_SERVICE
        )

        return headers.authorization
      }

      const baseline = sign()

      expect(sign()).toBe(baseline)
      expect(sign({ body: '{"a":1}' })).not.toBe(baseline)
      expect(sign({ credentials: { ...SIG_CREDENTIALS, secretAccessKey: 'other' } })).not.toBe(baseline)
      expect(sign({ region: 'eu-west-1' })).not.toBe(baseline)
      expect(sign({ service: 'sts' })).not.toBe(baseline)
    })

    it('signs the security token for temporary credentials', () => {
      const headers = {}

      signRequest(
        'POST',
        ENDPOINT,
        headers,
        '',
        { ...SIG_CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        AWS_SERVICE
      )

      expect(headers['x-amz-security-token']).toBe('SESSION')

      expect(headers.authorization).toContain(
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
      )

      const reference = referenceSigV4({
        method: 'POST',
        url: ENDPOINT,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
          'x-amz-security-token': 'SESSION',
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(headers.authorization).toContain(`Signature=${ reference.signature }`)
    })

    it('keeps a caller supplied host header and appends non-standard ports', () => {
      const provided = { Host: 'custom.example.com' }

      signRequest('POST', ENDPOINT, provided, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(provided.host).toBeUndefined()
      expect(provided.Host).toBe('custom.example.com')
      expect(provided.authorization).toContain('SignedHeaders=host;')

      const ported = {}

      signRequest('POST', 'https://localhost:4566/', ported, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(ported.host).toBe('localhost:4566')

      const standard = {}

      signRequest('POST', 'https://example.com:443/', standard, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(standard.host).toBe('example.com')
    })

    it('canonicalizes the path and sorts the query string', () => {
      const unsorted = {}
      const sorted = {}

      signRequest('GET', `${ ENDPOINT }a?b=2&a=1`, unsorted, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)
      signRequest('GET', `${ ENDPOINT }a?a=1&b=2`, sorted, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      // Query ordering must not change the signature.
      expect(unsorted.authorization).toBe(sorted.authorization)

      const dupes = {}

      signRequest('GET', `${ ENDPOINT }x?a=2&a=1`, dupes, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      expect(dupes.authorization).toMatch(/Signature=[0-9a-f]{64}$/)

      // A space in the path is percent-encoded as %20, never '+'.
      const spaced = {}

      signRequest('GET', `${ ENDPOINT }my folder/a b.txt`, spaced, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      const reference = referenceSigV4({
        method: 'GET',
        url: `${ ENDPOINT }my%20folder/a%20b.txt`,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(spaced.authorization).toContain(`Signature=${ reference.signature }`)
    })

    it('encodes multi-byte characters byte by byte', () => {
      const headers = {}

      signRequest('GET', `${ ENDPOINT }caf%C3%A9`, headers, '', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE)

      const reference = referenceSigV4({
        method: 'GET',
        url: `${ ENDPOINT }caf%C3%A9`,
        headers: {
          'host': `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
          'x-amz-content-sha256': sha256Hex(''),
          'x-amz-date': AMZ_DATE,
        },
        payload: sha256Hex(''),
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(headers.authorization).toContain(`Signature=${ reference.signature }`)
    })
  })

  describe('generatePresignedUrl', () => {
    it('adds every SigV4 query parameter and an independently computed signature', () => {
      const url = new URL(
        generatePresignedUrl('GET', `${ ENDPOINT }object.txt`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 900)
      )

      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')

      expect(url.searchParams.get('X-Amz-Credential')).toBe(
        `AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request`
      )

      expect(url.searchParams.get('X-Amz-Date')).toBe(AMZ_DATE)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
      expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

      // Rebuild the canonical URL exactly as the spec prescribes: every SigV4
      // query parameter except the signature itself, host as the only signed
      // header, and UNSIGNED-PAYLOAD in place of the payload hash.
      const canonical = new URL(`${ ENDPOINT }object.txt`)

      canonical.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')

      canonical.searchParams.set(
        'X-Amz-Credential',
        `AKIDEXAMPLE/${ DATE_STAMP }/us-east-1/${ AWS_SERVICE }/aws4_request`
      )

      canonical.searchParams.set('X-Amz-Date', AMZ_DATE)
      canonical.searchParams.set('X-Amz-Expires', '900')
      canonical.searchParams.set('X-Amz-SignedHeaders', 'host')

      const reference = referenceSigV4({
        method: 'GET',
        url: canonical.toString(),
        headers: { host: `${ AWS_SERVICE }.us-east-1.amazonaws.com` },
        payload: 'UNSIGNED-PAYLOAD',
        secretAccessKey: SIG_CREDENTIALS.secretAccessKey,
        region: 'us-east-1',
        service: AWS_SERVICE,
        amzDate: AMZ_DATE,
      })

      expect(url.searchParams.get('X-Amz-Signature')).toBe(reference.signature)
    })

    it('includes the session token and reacts to the expiry window and the port', () => {
      const withToken = generatePresignedUrl(
        'GET',
        `${ ENDPOINT }object.txt`,
        { ...SIG_CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        AWS_SERVICE,
        900
      )

      expect(new URL(withToken).searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

      const short = generatePresignedUrl('GET', `${ ENDPOINT }o`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)
      const long = generatePresignedUrl('GET', `${ ENDPOINT }o`, SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 3600)

      expect(new URL(short).searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(long).searchParams.get('X-Amz-Signature')
      )

      // A non-standard port is part of the signed host value, so the signature
      // differs from the same path served on the default port.
      const ported = generatePresignedUrl('GET', 'https://localhost:4566/o', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)
      const plain = generatePresignedUrl('GET', 'https://localhost/o', SIG_CREDENTIALS, 'us-east-1', AWS_SERVICE, 60)

      expect(new URL(ported).searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(plain).searchParams.get('X-Amz-Signature')
      )
    })
  })
})

// ── aws-client.js ──

describe('AWS Comprehend aws-client', () => {
  beforeEach(() => {
    mockCalls = []
    mockSocketError = null
    mockResponseError = null
    mockHang = false
    mockResponse = { statusCode: 200, body: '{}', headers: {} }
  })

  describe('XML helpers', () => {
    it('extracts single and repeated tags', () => {
      const xml = '<Root><Code>Denied</Code><Item>a</Item><Item>b</Item></Root>'

      expect(parseXmlTag(xml, 'Code')).toBe('Denied')
      expect(parseXmlTag(xml, 'Missing')).toBeNull()
      expect(parseXmlTags(xml, 'Item')).toEqual(['a', 'b'])
      expect(parseXmlTags(xml, 'Missing')).toEqual([])
    })

    it('matches across newlines', () => {
      expect(parseXmlTag('<A>\nline\n</A>', 'A')).toBe('\nline\n')
    })
  })

  describe('buildAwsJsonRequest', () => {
    it('builds a POST for the regional endpoint', () => {
      expect(
        buildAwsJsonRequest({
          region: 'eu-west-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        })
      ).toEqual({
        method: 'POST',
        url: `https://${ AWS_SERVICE }.eu-west-1.amazonaws.com/`,
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
        body: '{"A":1}',
      })
    })

    it('keeps a pre-serialized body and omits the target when absent', () => {
      const built = buildAwsJsonRequest({
        region: 'us-east-1',
        service: AWS_SERVICE,
        contentType: 'application/json',
        body: '{"raw":true}',
      })

      expect(built.body).toBe('{"raw":true}')
      expect(built.headers).toEqual({ 'content-type': 'application/json' })
    })

    it('serializes a missing body as an empty object', () => {
      expect(buildAwsJsonRequest({ region: 'us-east-1', service: AWS_SERVICE }).body).toBe('{}')
    })
  })

  describe('parseJsonResponse', () => {
    it('parses a successful body', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
    })

    it('treats an empty or absent body as an empty object', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '   ' })).toEqual({})
      expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
    })

    it('throws a named error for an AWS __type error body', () => {
      const response = {
        statusCode: 400,
        body: '{"__type":"com.amazonaws.svc#InvalidParameterException","message":"bad input"}',
      }

      expect(() => parseJsonResponse(response)).toThrow('bad input')

      try {
        parseJsonResponse(response)
      } catch (error) {
        expect(error.name).toBe('InvalidParameterException')
        expect(error.statusCode).toBe(400)
      }
    })

    it('falls back to code, Message and a generic message', () => {
      expect.assertions(4)

      try {
        parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
      } catch (error) {
        expect(error.name).toBe('AccessDenied')
        expect(error.message).toBe('nope')
      }

      try {
        parseJsonResponse({ statusCode: 500, body: '{}' })
      } catch (error) {
        expect(error.name).toBe('AwsError')
        expect(error.message).toBe('Request failed with status 500')
      }
    })
  })

  describe('httpRequest', () => {
    it('sends the body over https and resolves the raw response', async () => {
      mockResponse = { statusCode: 200, body: '{"ok":true}', headers: { 'x-amzn-requestid': 'r-1' } }

      const result = await httpRequest(
        'POST',
        `${ ENDPOINT }?a=1`,
        { 'content-type': 'application/json' },
        '{"a":1}'
      )

      expect(result).toEqual({
        statusCode: 200,
        headers: { 'x-amzn-requestid': 'r-1' },
        body: '{"ok":true}',
      })

      expect(mockCalls).toHaveLength(1)
      expect(mockCalls[0].protocol).toBe('https:')

      expect(mockCalls[0].options).toMatchObject({
        hostname: `${ AWS_SERVICE }.us-east-1.amazonaws.com`,
        port: 443,
        path: '/?a=1',
        method: 'POST',
      })

      expect(mockCalls[0].options.headers['content-length']).toBe(Buffer.byteLength('{"a":1}'))
      expect(mockCalls[0].written.join('')).toBe('{"a":1}')
      expect(mockCalls[0].timeoutMs).toBe(30000)
    })

    it('omits the body and the content-length for a bodyless request', async () => {
      await httpRequest('GET', ENDPOINT, {})

      expect(mockCalls[0].options.headers['content-length']).toBeUndefined()
      expect(mockCalls[0].written).toEqual([])
    })

    it('uses the http transport and port 80 for plain http URLs', async () => {
      await httpRequest('GET', 'http://localhost/path', {})

      expect(mockCalls[0].protocol).toBe('http:')
      expect(mockCalls[0].options.port).toBe(80)
    })

    it('honours an explicit port', async () => {
      await httpRequest('GET', 'http://localhost:4566/path', {})

      expect(mockCalls[0].options.port).toBe('4566')
    })

    it('rejects when the socket errors', async () => {
      mockSocketError = new Error('socket hang up')

      await expect(httpRequest('GET', ENDPOINT, {})).rejects.toThrow('socket hang up')
    })

    it('rejects when the response stream errors', async () => {
      mockResponseError = new Error('stream aborted')

      await expect(httpRequest('GET', ENDPOINT, {})).rejects.toThrow('stream aborted')
    })

    it('rejects with a timeout error when the request stalls', async () => {
      mockHang = true

      const pending = httpRequest('GET', ENDPOINT, {})

      mockCalls[0].fireTimeout()

      await expect(pending).rejects.toThrow('Request timed out')
      expect(mockCalls[0].destroyedWith.message).toBe('Request timed out')
    })
  })

  describe('jsonRequest', () => {
    it('signs and sends the built request through the injected transport', async () => {
      const sent = []

      const httpRequestMock = jest.fn(async (method, url, headers, body) => {
        sent.push({ method, url, headers, body })

        return { statusCode: 200, body: '{"Result":[]}' }
      })

      const signRequestMock = jest.fn((method, url, headers) => {
        headers.authorization = 'AWS4-HMAC-SHA256 signed'
      })

      const result = await jsonRequest(
        {
          region: 'us-east-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        },
        SIG_CREDENTIALS,
        { signRequest: signRequestMock, httpRequest: httpRequestMock }
      )

      expect(result).toEqual({ Result: [] })

      expect(signRequestMock).toHaveBeenCalledWith(
        'POST',
        ENDPOINT,
        expect.any(Object),
        '{"A":1}',
        SIG_CREDENTIALS,
        'us-east-1',
        AWS_SERVICE
      )

      expect(sent[0].headers).toMatchObject({
        'authorization': 'AWS4-HMAC-SHA256 signed',
        'x-amz-target': 'Svc.Op',
      })
    })

    it('throws the parsed AWS error for a failed response', async () => {
      await expect(
        jsonRequest(
          { region: 'us-east-1', service: AWS_SERVICE, contentType: 'application/x-amz-json-1.1' },
          SIG_CREDENTIALS,
          {
            signRequest: () => {},
            httpRequest: async () => ({
              statusCode: 400,
              body: '{"__type":"x#ThrottlingException","message":"slow down"}',
            }),
          }
        )
      ).rejects.toThrow('slow down')
    })

    it('falls back to the real signer and transport when no deps are injected', async () => {
      mockResponse = { statusCode: 200, body: '{"Ok":1}', headers: {} }

      const result = await jsonRequest(
        {
          region: 'us-east-1',
          service: AWS_SERVICE,
          target: 'Svc.Op',
          contentType: 'application/x-amz-json-1.1',
          body: { A: 1 },
        },
        SIG_CREDENTIALS
      )

      expect(result).toEqual({ Ok: 1 })

      expect(mockCalls[0].options.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//
      )
    })
  })

  describe('stsAssumeRole', () => {
    const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

    it('signs the STS call and returns the temporary credentials', async () => {
      mockResponse = {
        statusCode: 200,
        body: `<AssumeRoleResponse><Credentials>
                 <AccessKeyId>ASIA1</AccessKeyId>
                 <SecretAccessKey>SECRET1</SecretAccessKey>
                 <SessionToken>TOKEN1</SessionToken>
                 <Expiration>2026-01-01T00:00:00Z</Expiration>
               </Credentials></AssumeRoleResponse>`,
        headers: {},
      }

      const result = await stsAssumeRole(SIG_CREDENTIALS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

      expect(result).toEqual({
        accessKeyId: 'ASIA1',
        secretAccessKey: 'SECRET1',
        sessionToken: 'TOKEN1',
        expiration: new Date('2026-01-01T00:00:00Z'),
      })

      expect(mockCalls).toHaveLength(1)

      expect(mockCalls[0].options).toMatchObject({
        hostname: 'sts.eu-west-1.amazonaws.com',
        port: 443,
        path: '/',
        method: 'POST',
      })

      expect(mockCalls[0].options.headers['content-type']).toBe('application/x-www-form-urlencoded')

      expect(mockCalls[0].options.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/sts\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
      )

      expect(mockCalls[0].written.join('')).toBe(
        'Action=AssumeRole&Version=2011-06-15' +
          `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
          '&RoleSessionName=session-1' +
          '&ExternalId=ext-1'
      )
    })

    it('omits the external id when not provided', async () => {
      mockResponse = {
        statusCode: 200,
        body:
          '<r><AccessKeyId>A</AccessKeyId><SecretAccessKey>S</SecretAccessKey>' +
          '<SessionToken>T</SessionToken><Expiration>2026-01-01T00:00:00Z</Expiration></r>',
        headers: {},
      }

      await stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 'session-2')

      expect(mockCalls[0].written.join('')).not.toContain('ExternalId')
    })

    it('throws a named error for an STS error response', async () => {
      mockResponse = {
        statusCode: 403,
        body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>not allowed</Message></Error></ErrorResponse>',
        headers: {},
      }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'AccessDenied',
        message: 'not allowed',
        statusCode: 403,
      })
    })

    it('falls back to a generic STS error when the body carries no code', async () => {
      mockResponse = { statusCode: 500, body: '<html>oops</html>', headers: {} }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'STSError',
        message: 'STS AssumeRole failed',
      })
    })

    it('throws when the response is missing credential fields', async () => {
      mockResponse = { statusCode: 200, body: '<r><AccessKeyId>A</AccessKeyId></r>', headers: {} }

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
        name: 'STSParseError',
        message: 'Failed to parse STS AssumeRole response: missing credential fields',
      })
    })

    it('rejects when the socket errors', async () => {
      mockSocketError = new Error('socket hang up')

      await expect(stsAssumeRole(SIG_CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow('socket hang up')
    })
  })
})

// ── credentials.js ──

describe('AWS Comprehend CredentialProvider', () => {
  it('returns the static keys for API Key authentication', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API Key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider().resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )
  })

  it('requires a role ARN and base keys for IAM Role authentication', async () => {
    await expect(new CredentialProvider({ authenticationMethod: 'IAM Role' }).resolve()).rejects.toThrow(
      'IAM Role ARN is required for IAM Role authentication.'
    )

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    await expect(
      new CredentialProvider({
        authenticationMethod: 'IAM Role',
        roleArn: 'arn:role',
        accessKeyId: 'AK',
      }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('assumes the role, caches the result and refreshes inside the expiry buffer', async () => {
    let now = 1000000
    let call = 0

    const stsAssumeRoleMock = jest.fn(async () => {
      call += 1

      return {
        accessKeyId: `AK${ call }`,
        secretAccessKey: `SK${ call }`,
        sessionToken: `ST${ call }`,
        expiration: new Date(now + 3600000),
      }
    })

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'BASE_AK',
        secretAccessKey: 'BASE_SK',
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        externalId: 'ext-1',
      },
      { stsAssumeRole: stsAssumeRoleMock, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'AK1', secretAccessKey: 'SK1', sessionToken: 'ST1' })

    expect(stsAssumeRoleMock).toHaveBeenCalledWith(
      { accessKeyId: 'BASE_AK', secretAccessKey: 'BASE_SK' },
      'eu-west-1',
      'arn:aws:iam::123456789012:role/MyRole',
      'flowrunner-comprehend-1000000',
      'ext-1'
    )

    // Well inside the validity window: served from cache.
    now += 60000
    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleMock).toHaveBeenCalledTimes(1)

    // Inside the 5 minute expiry buffer: a fresh session is requested.
    now += 3400000
    const second = await provider.resolve()

    expect(second.accessKeyId).toBe('AK2')
    expect(stsAssumeRoleMock).toHaveBeenCalledTimes(2)
  })

  it('defaults its clock to Date.now and delegates to the real stsAssumeRole', async () => {
    mockCalls = []
    mockSocketError = null
    mockResponseError = null
    mockHang = false

    mockResponse = {
      statusCode: 200,
      body:
        '<r><AccessKeyId>ASIA</AccessKeyId><SecretAccessKey>SEC</SecretAccessKey>' +
        '<SessionToken>TOK</SessionToken><Expiration>2999-01-01T00:00:00Z</Expiration></r>',
      headers: {},
    }

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'BASE_AK',
      secretAccessKey: 'BASE_SK',
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
    })

    await expect(provider.resolve()).resolves.toEqual({
      accessKeyId: 'ASIA',
      secretAccessKey: 'SEC',
      sessionToken: 'TOK',
    })

    expect(mockCalls[0].written.join('')).toContain('RoleSessionName=flowrunner-comprehend-')
  })
})

// ── errors.js ──

describe('AWS Comprehend errors', () => {
  describe('createLogger', () => {
    it('prefixes every level with the service name', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const logger = createLogger('Demo')

      spy.mockClear()

      logger.info('a')
      logger.debug('b')
      logger.warn('c')
      logger.error('d')

      expect(spy.mock.calls).toEqual([
        ['[Demo Service]', 'info:', 'a'],
        ['[Demo Service]', 'debug:', 'b'],
        ['[Demo Service]', 'warn:', 'c'],
        ['[Demo Service]', 'error:', 'd'],
      ])

      spy.mockRestore()
    })
  })

  describe('mapAwsError', () => {
    it.each([
      ['ThrottlingException', 'slow down', /^Request was throttled by AWS/],
      ['Throttling', 'slow down', /^Request was throttled by AWS/],
      ['ProvisionedThroughputExceededException', 'slow down', /^Request was throttled by AWS/],
      ['InvalidSignatureException', 'bad sig', /^Invalid AWS credentials/],
      ['UnrecognizedClientException', 'bad sig', /^Invalid AWS credentials/],
      ['InvalidClientTokenId', 'bad sig', /^Invalid AWS credentials/],
      ['SomethingElse', 'the credential is wrong', /^Invalid AWS credentials/],
      ['AccessDeniedException', 'nope', /^Access denied/],
      ['AccessDenied', 'nope', /^Access denied/],
      ['Whatever', 'Request timed out', /^Connection to AWS failed/],
    ])('maps %s into guidance', (name, message, expected) => {
      expect(mapAwsError(Object.assign(new Error(message), { name })).message).toMatch(expected)
    })

    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'])('maps the %s socket code', code => {
      expect(mapAwsError(Object.assign(new Error('socket'), { code })).message).toMatch(
        /^Connection to AWS failed/
      )
    })

    it('passes unknown errors through with the original as cause', () => {
      const original = new Error('mystery')
      const mapped = mapAwsError(original)

      expect(mapped.message).toBe('mystery')
      expect(mapped.cause).toBe(original)
    })

    it('defaults an empty error to "Unknown error"', () => {
      expect(mapAwsError({}).message).toBe('Unknown error')
    })
  })
})
