'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('LingvaNex Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('lingvanex')
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

  // ── Get Languages ──

  describe('getLanguages', () => {
    it('returns a list of supported languages', async () => {
      const result = await service.getLanguages()

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)
      expect(result.result.length).toBeGreaterThan(0)
      expect(result.result[0]).toHaveProperty('full_code')
      expect(result.result[0]).toHaveProperty('englishName')
    })

    it('accepts a custom interface language code', async () => {
      const result = await service.getLanguages('fr_FR')

      expect(result).toHaveProperty('err', null)
      expect(Array.isArray(result.result)).toBe(true)
    })
  })

  // ── Translate ──

  describe('translate', () => {
    it('translates a single string from English to French', async () => {
      const result = await service.translate('fr_FR', ['Hello world'], 'en_GB')

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
      expect(typeof result.result).toBe('string')
      expect(result.result.length).toBeGreaterThan(0)
    })

    it('auto-detects source language when from is omitted', async () => {
      const result = await service.translate('es_ES', ['Good morning'])

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
      expect(typeof result.result).toBe('string')
    })

    it('translates with Text mode', async () => {
      const result = await service.translate('de_DE', ['Hello'], 'en_GB', 'Text')

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
    })

    it('includes transliteration data when enabled', async () => {
      const result = await service.translate('ru_RU', ['Hello'], 'en_GB', 'Text', true)

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
    })

    it('translates multiple strings in one call', async () => {
      const result = await service.translate('fr_FR', ['Hello', 'Goodbye'], 'en_GB')

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Detect Language ──

  describe('detectLanguage', () => {
    it('detects English text', async () => {
      const result = await service.detectLanguage(['This is a test sentence in English'])

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
      expect(typeof result.result).toBe('string')
      expect(result.result).toMatch(/en/)
    })

    it('detects French text', async () => {
      const result = await service.detectLanguage(['Bonjour le monde, comment allez-vous'])

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
      expect(typeof result.result).toBe('string')
      expect(result.result).toMatch(/fr/)
    })

    it('detects language for multiple strings', async () => {
      const result = await service.detectLanguage(['Hello world', 'Bonjour le monde'])

      expect(result).toHaveProperty('err', null)
      expect(result).toHaveProperty('result')
    })
  })
})
