'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Comprehend Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-comprehend')
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

  // ── Detect Sentiment ──

  describe('detectSentiment', () => {
    it('returns sentiment and scores for positive text', async () => {
      const result = await service.detectSentiment('I absolutely love this amazing product!', 'English')

      expect(result).toHaveProperty('sentiment')
      expect(result).toHaveProperty('sentimentScore')
      expect(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']).toContain(result.sentiment)
      expect(result.sentimentScore).toHaveProperty('Positive')
      expect(result.sentimentScore).toHaveProperty('Negative')
      expect(result.sentimentScore).toHaveProperty('Neutral')
      expect(result.sentimentScore).toHaveProperty('Mixed')
    })

    it('throws when text is empty', async () => {
      await expect(service.detectSentiment('', 'English')).rejects.toThrow('text is required')
    })
  })

  // ── Detect Entities ──

  describe('detectEntities', () => {
    it('returns entities with expected shape', async () => {
      const result = await service.detectEntities('John Smith works at Amazon in Seattle', 'English')

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result.entities.length).toBeGreaterThan(0)

      const entity = result.entities[0]

      expect(entity).toHaveProperty('Type')
      expect(entity).toHaveProperty('Text')
      expect(entity).toHaveProperty('Score')
      expect(entity).toHaveProperty('BeginOffset')
      expect(entity).toHaveProperty('EndOffset')
    })
  })

  // ── Detect Key Phrases ──

  describe('detectKeyPhrases', () => {
    it('returns key phrases with expected shape', async () => {
      const result = await service.detectKeyPhrases(
        'The quarterly financial report shows strong revenue growth in the technology sector',
        'English'
      )

      expect(result).toHaveProperty('keyPhrases')
      expect(Array.isArray(result.keyPhrases)).toBe(true)
      expect(result.keyPhrases.length).toBeGreaterThan(0)

      const phrase = result.keyPhrases[0]

      expect(phrase).toHaveProperty('Text')
      expect(phrase).toHaveProperty('Score')
      expect(phrase).toHaveProperty('BeginOffset')
      expect(phrase).toHaveProperty('EndOffset')
    })
  })

  // ── Detect Dominant Language ──

  describe('detectDominantLanguage', () => {
    it('detects English text', async () => {
      const result = await service.detectDominantLanguage('This is a test sentence in English')

      expect(result).toHaveProperty('languages')
      expect(Array.isArray(result.languages)).toBe(true)
      expect(result.languages.length).toBeGreaterThan(0)
      expect(result.languages[0]).toHaveProperty('LanguageCode')
      expect(result.languages[0]).toHaveProperty('Score')
    })

    it('detects Spanish text', async () => {
      const result = await service.detectDominantLanguage('Esta es una frase de prueba en espanol')

      expect(result.languages.length).toBeGreaterThan(0)
      expect(result.languages[0].LanguageCode).toBe('es')
    })
  })

  // ── Detect PII Entities ──

  describe('detectPiiEntities', () => {
    it('detects PII in text with expected shape', async () => {
      const result = await service.detectPiiEntities(
        'My name is John Smith and my email is john@example.com',
        'English'
      )

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result.entities.length).toBeGreaterThan(0)

      const entity = result.entities[0]

      expect(entity).toHaveProperty('Type')
      expect(entity).toHaveProperty('Score')
      expect(entity).toHaveProperty('BeginOffset')
      expect(entity).toHaveProperty('EndOffset')
    })

    it('works without explicit languageCode (defaults to English)', async () => {
      const result = await service.detectPiiEntities('Contact me at test@example.com')

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
    })
  })

  // ── Detect Syntax ──

  describe('detectSyntax', () => {
    it('returns syntax tokens with expected shape', async () => {
      const result = await service.detectSyntax('They quickly ran to the store', 'English')

      expect(result).toHaveProperty('tokens')
      expect(Array.isArray(result.tokens)).toBe(true)
      expect(result.tokens.length).toBeGreaterThan(0)

      const token = result.tokens[0]

      expect(token).toHaveProperty('TokenId')
      expect(token).toHaveProperty('Text')
      expect(token).toHaveProperty('BeginOffset')
      expect(token).toHaveProperty('EndOffset')
      expect(token).toHaveProperty('PartOfSpeech')
      expect(token.PartOfSpeech).toHaveProperty('Tag')
      expect(token.PartOfSpeech).toHaveProperty('Score')
    })
  })

  // ── Detect Targeted Sentiment ──

  describe('detectTargetedSentiment', () => {
    it('returns targeted sentiment entities with expected shape', async () => {
      const result = await service.detectTargetedSentiment(
        'The food was excellent but the service was terrible',
        'English'
      )

      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result.entities.length).toBeGreaterThan(0)

      const entity = result.entities[0]

      expect(entity).toHaveProperty('DescriptiveMentionIndex')
      expect(entity).toHaveProperty('Mentions')
      expect(Array.isArray(entity.Mentions)).toBe(true)
    })
  })

  // ── Batch Detect Sentiment ──

  describe('batchDetectSentiment', () => {
    it('returns results for multiple documents', async () => {
      const result = await service.batchDetectSentiment(
        ['I love this', 'I hate this', 'It is okay'],
        'English'
      )

      expect(result).toHaveProperty('resultList')
      expect(result).toHaveProperty('errorList')
      expect(Array.isArray(result.resultList)).toBe(true)
      expect(result.resultList.length).toBe(3)

      const item = result.resultList[0]

      expect(item).toHaveProperty('Index')
      expect(item).toHaveProperty('Sentiment')
      expect(item).toHaveProperty('SentimentScore')
    })
  })

  // ── Batch Detect Entities ──

  describe('batchDetectEntities', () => {
    it('returns entities for multiple documents', async () => {
      const result = await service.batchDetectEntities(
        ['John lives in New York', 'Amazon is based in Seattle'],
        'English'
      )

      expect(result).toHaveProperty('resultList')
      expect(result).toHaveProperty('errorList')
      expect(Array.isArray(result.resultList)).toBe(true)
      expect(result.resultList.length).toBe(2)

      const item = result.resultList[0]

      expect(item).toHaveProperty('Index')
      expect(item).toHaveProperty('Entities')
      expect(Array.isArray(item.Entities)).toBe(true)
    })
  })
})
