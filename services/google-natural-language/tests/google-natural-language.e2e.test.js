'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// Text long enough (>20 tokens) for classifyText to return categories, and rich
// enough to yield entities and sentiment.
const CLASSIFICATION_TEXT =
  'Google Cloud Platform provides a wide range of computing, storage, networking, ' +
  'machine learning, and data analytics services that developers use to build and ' +
  'deploy scalable web and mobile applications in the cloud.'

const SENTIMENT_TEXT = 'I absolutely love this product, it works wonderfully and I am very happy.'

describe('Google Cloud Natural Language Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('google-natural-language')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Entity analysis (v2) ──

  describe('analyzeEntities', () => {
    it('returns entities with expected shape', async () => {
      const result = await service.analyzeEntities(
        'Google is headquartered in Mountain View, California.'
      )

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result).toHaveProperty('languageCode')
      if (result.entities.length) {
        expect(result.entities[0]).toHaveProperty('name')
        expect(result.entities[0]).toHaveProperty('type')
      }
    })

    it('honors an explicit language and encoding', async () => {
      const result = await service.analyzeEntities(
        'Barack Obama was the 44th President of the United States.',
        'Plain Text',
        'en',
        'UTF8'
      )

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
    })
  })

  // ── Sentiment analysis (v2) ──

  describe('analyzeSentiment', () => {
    it('returns document sentiment with score and magnitude', async () => {
      const result = await service.analyzeSentiment(SENTIMENT_TEXT)

      expect(result).toHaveProperty('documentSentiment')
      expect(result.documentSentiment).toHaveProperty('score')
      expect(result.documentSentiment).toHaveProperty('magnitude')
      expect(result).toHaveProperty('languageCode')
    })
  })

  // ── Entity sentiment (v1) ──

  describe('analyzeEntitySentiment', () => {
    it('returns entities with per-entity sentiment', async () => {
      const result = await service.analyzeEntitySentiment(
        'The food was delicious but the service was terrible.'
      )

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result).toHaveProperty('language')
    })
  })

  // ── Syntax analysis (v1) ──

  describe('analyzeSyntax', () => {
    it('returns tokens and sentences', async () => {
      const result = await service.analyzeSyntax('The quick brown fox jumps over the lazy dog.')

      expect(result).toHaveProperty('tokens')
      expect(Array.isArray(result.tokens)).toBe(true)
      expect(result).toHaveProperty('sentences')
      expect(Array.isArray(result.sentences)).toBe(true)
      if (result.tokens.length) {
        expect(result.tokens[0]).toHaveProperty('partOfSpeech')
      }
    })
  })

  // ── Classification (v2) ──

  describe('classifyText', () => {
    it('returns content categories for a sufficiently long document', async () => {
      const result = await service.classifyText(CLASSIFICATION_TEXT)

      expect(result).toHaveProperty('categories')
      expect(Array.isArray(result.categories)).toBe(true)
    })
  })

  // ── Moderation (v2) ──

  describe('moderateText', () => {
    it('returns moderation categories', async () => {
      const result = await service.moderateText(
        'This is a friendly and completely harmless sentence about kittens.'
      )

      expect(result).toHaveProperty('moderationCategories')
      expect(Array.isArray(result.moderationCategories)).toBe(true)
    })
  })

  // ── Annotate (v2, combined) ──

  describe('annotateText', () => {
    it('runs entities and sentiment by default', async () => {
      const result = await service.annotateText(SENTIMENT_TEXT)

      expect(result).toHaveProperty('entities')
      expect(result).toHaveProperty('documentSentiment')
    })

    it('runs all features when every toggle is enabled', async () => {
      const result = await service.annotateText(
        CLASSIFICATION_TEXT,
        'Plain Text',
        true, // extractEntities
        true, // extractDocumentSentiment
        true, // classifyText
        true, // moderateText
        'en',
        'UTF8'
      )

      expect(result).toHaveProperty('entities')
      expect(result).toHaveProperty('documentSentiment')
      expect(result).toHaveProperty('categories')
      expect(result).toHaveProperty('moderationCategories')
    })
  })
})
