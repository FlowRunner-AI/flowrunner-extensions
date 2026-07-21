'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Translate Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('google-translate')
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

  // ── Translate Text ──

  describe('translateText', () => {
    it('translates a single string into the target language', async () => {
      const result = await service.translateText('Hello, how are you?', 'es')

      expect(result).toHaveProperty('translations')
      expect(Array.isArray(result.translations)).toBe(true)
      expect(result.translations).toHaveLength(1)
      expect(typeof result.translations[0].translatedText).toBe('string')
      expect(result.translations[0].translatedText.length).toBeGreaterThan(0)
      // Source language was omitted, so Google should report the detected one.
      expect(result.translations[0]).toHaveProperty('detectedSourceLanguage')
    })

    it('translates an array of strings in a single call', async () => {
      const result = await service.translateText(['Hello', 'Goodbye'], 'fr')

      expect(result.translations).toHaveLength(2)
      expect(typeof result.translations[0].translatedText).toBe('string')
      expect(typeof result.translations[1].translatedText).toBe('string')
    })

    it('honors an explicit source language', async () => {
      const result = await service.translateText('Good morning', 'de', 'en')

      expect(result.translations).toHaveLength(1)
      expect(typeof result.translations[0].translatedText).toBe('string')
    })

    it('decodes HTML entities for text format results', async () => {
      // "It's a test" contains an apostrophe that the v2 API HTML-escapes;
      // the service should decode it back for text format.
      const result = await service.translateText("It's a test", 'es', 'en', 'Text')

      expect(result.translations[0].translatedText).not.toContain('&#39;')
      expect(result.translations[0].translatedText).not.toContain('&amp;')
    })

    it('preserves markup in HTML format', async () => {
      const result = await service.translateText('<b>Hello</b>', 'es', 'en', 'HTML')

      expect(typeof result.translations[0].translatedText).toBe('string')
      expect(result.translations[0].translatedText).toContain('<b>')
    })
  })

  // ── Detect Language ──

  describe('detectLanguage', () => {
    it('detects the language of a single string', async () => {
      const result = await service.detectLanguage('Bonjour tout le monde')

      expect(result).toHaveProperty('language')
      expect(typeof result.language).toBe('string')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('detections')
      expect(Array.isArray(result.detections)).toBe(true)
      expect(result.detections.length).toBeGreaterThan(0)
    })

    it('detects languages for an array of strings', async () => {
      const result = await service.detectLanguage(['Hello world', 'Hola mundo'])

      expect(Array.isArray(result.detections)).toBe(true)
      expect(result.detections.length).toBeGreaterThan(0)
      // Top-level language reflects the first string.
      expect(typeof result.language).toBe('string')
    })
  })

  // ── List Languages ──

  describe('listLanguages', () => {
    it('lists supported languages with default (English) names', async () => {
      const result = await service.listLanguages()

      expect(result).toHaveProperty('languages')
      expect(Array.isArray(result.languages)).toBe(true)
      expect(result.languages.length).toBeGreaterThan(0)
      expect(result.languages[0]).toHaveProperty('language')
      expect(result.languages[0]).toHaveProperty('name')
    })

    it('lists languages with localized display names', async () => {
      const result = await service.listLanguages('es')

      expect(Array.isArray(result.languages)).toBe(true)
      expect(result.languages.length).toBeGreaterThan(0)
    })
  })

  // ── Dictionary Methods ──

  describe('getTargetLanguagesDictionary', () => {
    it('returns a dictionary of translatable languages', async () => {
      const result = await service.getTargetLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
      expect(result).toHaveProperty('cursor', null)
    })

    it('filters the dictionary by search term', async () => {
      const result = await service.getTargetLanguagesDictionary({ search: 'spanish' })

      expect(Array.isArray(result.items)).toBe(true)
      result.items.forEach(item => {
        const haystack = `${ item.label } ${ item.value }`.toLowerCase()
        expect(haystack).toContain('spanish'.slice(0, 3))
      })
    })
  })

  describe('getSourceLanguagesDictionary', () => {
    it('returns a dictionary of source languages', async () => {
      const result = await service.getSourceLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Round-trip using developer-provided test values (optional) ──

  describe('translateText with custom test values', () => {
    it('translates provided sample text into the provided target language', async () => {
      const text = testValues.sampleText || 'The quick brown fox'
      const target = testValues.targetLanguage || 'ja'

      const result = await service.translateText(text, target)

      expect(result.translations).toHaveLength(1)
      expect(typeof result.translations[0].translatedText).toBe('string')
      expect(result.translations[0].translatedText.length).toBeGreaterThan(0)
    })
  })
})
