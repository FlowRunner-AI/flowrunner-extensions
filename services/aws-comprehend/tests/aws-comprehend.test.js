'use strict'

const { createSandbox } = require('../../../service-sandbox')

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
})
