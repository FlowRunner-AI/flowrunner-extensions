'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const API_BASE_URL = 'https://language.googleapis.com'
const V1 = `${ API_BASE_URL }/v1`
const V2 = `${ API_BASE_URL }/v2`

const SAMPLE_TEXT = 'Google is headquartered in Mountain View and I love their products.'

describe('Google Cloud Natural Language Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with the correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the api key as a query param and JSON content-type header', async () => {
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).reply({ languageCode: 'en' })

      await service.analyzeSentiment('hello')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toEqual({ key: API_KEY })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })

  // ── analyzeEntities (v2) ──

  describe('analyzeEntities', () => {
    it('sends the required body with PLAIN_TEXT and UTF8 defaults to the v2 endpoint', async () => {
      const responsePayload = {
        entities: [{ name: 'Google', type: 'ORGANIZATION' }],
        languageCode: 'en',
      }
      mock.onPost(`${ V2 }/documents:analyzeEntities`).reply(responsePayload)

      const result = await service.analyzeEntities(SAMPLE_TEXT)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ V2 }/documents:analyzeEntities`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
        encodingType: 'UTF8',
      })
      expect(result).toEqual(responsePayload)
    })

    it('maps the HTML document type, sets languageCode and a custom encoding', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).reply({})

      await service.analyzeEntities('<b>Google</b>', 'HTML', 'en', 'UTF16')

      expect(mock.history[0].body).toEqual({
        document: { type: 'HTML', content: '<b>Google</b>', languageCode: 'en' },
        encodingType: 'UTF16',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid text content', status: 'INVALID_ARGUMENT' } },
      })

      await expect(service.analyzeEntities(SAMPLE_TEXT)).rejects.toThrow(
        'Google Cloud Natural Language API error: Invalid text content'
      )
    })
  })

  // ── analyzeSentiment (v2) ──

  describe('analyzeSentiment', () => {
    it('sends the required body to the v2 endpoint', async () => {
      const responsePayload = {
        documentSentiment: { magnitude: 0.8, score: 0.8 },
        languageCode: 'en',
      }
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).reply(responsePayload)

      const result = await service.analyzeSentiment(SAMPLE_TEXT)

      expect(mock.history[0].url).toBe(`${ V2 }/documents:analyzeSentiment`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
        encodingType: 'UTF8',
      })
      expect(result).toEqual(responsePayload)
    })

    it('passes document type, language (languageCode) and encoding', async () => {
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).reply({})

      await service.analyzeSentiment('bonjour', 'Plain Text', 'fr', 'UTF32')

      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: 'bonjour', languageCode: 'fr' },
        encodingType: 'UTF32',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { message: 'API key not valid' } },
      })

      await expect(service.analyzeSentiment(SAMPLE_TEXT)).rejects.toThrow(
        'Google Cloud Natural Language API error: API key not valid'
      )
    })
  })

  // ── analyzeEntitySentiment (v1) ──

  describe('analyzeEntitySentiment', () => {
    it('sends the required body to the v1 endpoint', async () => {
      const responsePayload = {
        entities: [{ name: 'food', sentiment: { score: 0.9 } }],
        language: 'en',
      }
      mock.onPost(`${ V1 }/documents:analyzeEntitySentiment`).reply(responsePayload)

      const result = await service.analyzeEntitySentiment(SAMPLE_TEXT)

      expect(mock.history[0].url).toBe(`${ V1 }/documents:analyzeEntitySentiment`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
        encodingType: 'UTF8',
      })
      expect(result).toEqual(responsePayload)
    })

    it('uses the v1 "language" field (not languageCode) for the language', async () => {
      mock.onPost(`${ V1 }/documents:analyzeEntitySentiment`).reply({})

      await service.analyzeEntitySentiment('hola', 'HTML', 'es', 'NONE')

      expect(mock.history[0].body).toEqual({
        document: { type: 'HTML', content: 'hola', language: 'es' },
        encodingType: 'NONE',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V1 }/documents:analyzeEntitySentiment`).replyWithError({
        message: 'Server Error',
        body: { error: { message: 'Internal error' } },
      })

      await expect(service.analyzeEntitySentiment(SAMPLE_TEXT)).rejects.toThrow(
        'Google Cloud Natural Language API error: Internal error'
      )
    })
  })

  // ── analyzeSyntax (v1) ──

  describe('analyzeSyntax', () => {
    it('sends the required body to the v1 endpoint', async () => {
      const responsePayload = {
        tokens: [{ text: { content: 'The' }, partOfSpeech: { tag: 'DET' } }],
        language: 'en',
      }
      mock.onPost(`${ V1 }/documents:analyzeSyntax`).reply(responsePayload)

      const result = await service.analyzeSyntax('The cat sat.')

      expect(mock.history[0].url).toBe(`${ V1 }/documents:analyzeSyntax`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: 'The cat sat.' },
        encodingType: 'UTF8',
      })
      expect(result).toEqual(responsePayload)
    })

    it('passes all optional parameters using the v1 "language" field', async () => {
      mock.onPost(`${ V1 }/documents:analyzeSyntax`).reply({})

      await service.analyzeSyntax('Der Hund', 'Plain Text', 'de', 'UTF16')

      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: 'Der Hund', language: 'de' },
        encodingType: 'UTF16',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V1 }/documents:analyzeSyntax`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Document too long' } },
      })

      await expect(service.analyzeSyntax('x')).rejects.toThrow(
        'Google Cloud Natural Language API error: Document too long'
      )
    })
  })

  // ── classifyText (v2, no encodingType) ──

  describe('classifyText', () => {
    it('sends only the document (no encodingType) to the v2 endpoint', async () => {
      const responsePayload = {
        categories: [{ name: '/Computers & Electronics', confidence: 0.9 }],
        languageCode: 'en',
      }
      mock.onPost(`${ V2 }/documents:classifyText`).reply(responsePayload)

      const result = await service.classifyText(SAMPLE_TEXT)

      expect(mock.history[0].url).toBe(`${ V2 }/documents:classifyText`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
      })
      expect(mock.history[0].body).not.toHaveProperty('encodingType')
      expect(result).toEqual(responsePayload)
    })

    it('passes document type and language (languageCode)', async () => {
      mock.onPost(`${ V2 }/documents:classifyText`).reply({})

      await service.classifyText('<p>text</p>', 'HTML', 'en')

      expect(mock.history[0].body).toEqual({
        document: { type: 'HTML', content: '<p>text</p>', languageCode: 'en' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V2 }/documents:classifyText`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Too few tokens to classify' } },
      })

      await expect(service.classifyText('short')).rejects.toThrow(
        'Google Cloud Natural Language API error: Too few tokens to classify'
      )
    })
  })

  // ── moderateText (v2, no encodingType) ──

  describe('moderateText', () => {
    it('sends only the document (no encodingType) to the v2 endpoint', async () => {
      const responsePayload = {
        moderationCategories: [{ name: 'Toxic', confidence: 0.02 }],
        languageCode: 'en',
      }
      mock.onPost(`${ V2 }/documents:moderateText`).reply(responsePayload)

      const result = await service.moderateText(SAMPLE_TEXT)

      expect(mock.history[0].url).toBe(`${ V2 }/documents:moderateText`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
      })
      expect(mock.history[0].body).not.toHaveProperty('encodingType')
      expect(result).toEqual(responsePayload)
    })

    it('passes document type and language (languageCode)', async () => {
      mock.onPost(`${ V2 }/documents:moderateText`).reply({})

      await service.moderateText('some text', 'Plain Text', 'en')

      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: 'some text', languageCode: 'en' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V2 }/documents:moderateText`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Unsupported language' } },
      })

      await expect(service.moderateText('text')).rejects.toThrow(
        'Google Cloud Natural Language API error: Unsupported language'
      )
    })
  })

  // ── annotateText (v2, feature toggles) ──

  describe('annotateText', () => {
    it('defaults entities+sentiment on, classify+moderate off, UTF8 encoding', async () => {
      const responsePayload = {
        entities: [{ name: 'Google', type: 'ORGANIZATION' }],
        documentSentiment: { score: 0.8 },
        languageCode: 'en',
      }
      mock.onPost(`${ V2 }/documents:annotateText`).reply(responsePayload)

      const result = await service.annotateText(SAMPLE_TEXT)

      expect(mock.history[0].url).toBe(`${ V2 }/documents:annotateText`)
      expect(mock.history[0].body).toEqual({
        document: { type: 'PLAIN_TEXT', content: SAMPLE_TEXT },
        features: {
          extractEntities: true,
          extractDocumentSentiment: true,
          classifyText: false,
          moderateText: false,
        },
        encodingType: 'UTF8',
      })
      expect(result).toEqual(responsePayload)
    })

    it('honors all feature toggles when explicitly provided', async () => {
      mock.onPost(`${ V2 }/documents:annotateText`).reply({})

      await service.annotateText(
        SAMPLE_TEXT,
        'HTML',
        false, // extractEntities
        false, // extractDocumentSentiment
        true, // classifyText
        true, // moderateText
        'en',
        'UTF16'
      )

      expect(mock.history[0].body).toEqual({
        document: { type: 'HTML', content: SAMPLE_TEXT, languageCode: 'en' },
        features: {
          extractEntities: false,
          extractDocumentSentiment: false,
          classifyText: true,
          moderateText: true,
        },
        encodingType: 'UTF16',
      })
    })

    it('treats non-false entity/sentiment flags as true and non-true classify/moderate as false', async () => {
      mock.onPost(`${ V2 }/documents:annotateText`).reply({})

      // Pass "truthy but not === true" for classify/moderate and "falsy but not === false"
      // for entities/sentiment to lock down the exact boolean coercion.
      await service.annotateText(SAMPLE_TEXT, undefined, undefined, null, 'yes', 1)

      expect(mock.history[0].body.features).toEqual({
        extractEntities: true, // undefined !== false
        extractDocumentSentiment: true, // null !== false
        classifyText: false, // 'yes' !== true
        moderateText: false, // 1 !== true
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ V2 }/documents:annotateText`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Feature not supported' } },
      })

      await expect(service.annotateText(SAMPLE_TEXT)).rejects.toThrow(
        'Google Cloud Natural Language API error: Feature not supported'
      )
    })
  })

  // ── Shared helper behavior (document build, encoding, error extraction) ──

  describe('document + encoding handling', () => {
    it('defaults content to an empty string when none is provided', async () => {
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).reply({})

      await service.analyzeSentiment()

      expect(mock.history[0].body.document).toEqual({ type: 'PLAIN_TEXT', content: '' })
    })

    it('passes an unknown document type through unchanged (no mapping)', async () => {
      mock.onPost(`${ V2 }/documents:analyzeSentiment`).reply({})

      await service.analyzeSentiment('hi', 'MARKDOWN')

      expect(mock.history[0].body.document.type).toBe('MARKDOWN')
    })

    it('omits the language field when language is not provided', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).reply({})

      await service.analyzeEntities('hi')

      expect(mock.history[0].body.document).not.toHaveProperty('languageCode')
      expect(mock.history[0].body.document).not.toHaveProperty('language')
    })

    it('falls back to UTF8 for an invalid encoding type', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).reply({})

      await service.analyzeEntities('hi', undefined, undefined, 'INVALID')

      expect(mock.history[0].body.encodingType).toBe('UTF8')
    })

    it('extracts the message from error.body.message when error.body.error is absent', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).replyWithError({
        message: 'ignored',
        body: { message: 'Flat body message' },
      })

      await expect(service.analyzeEntities('hi')).rejects.toThrow(
        'Google Cloud Natural Language API error: Flat body message'
      )
    })

    it('falls back to error.message when there is no error body', async () => {
      mock.onPost(`${ V2 }/documents:analyzeEntities`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.analyzeEntities('hi')).rejects.toThrow(
        'Google Cloud Natural Language API error: Network timeout'
      )
    })
  })
})
