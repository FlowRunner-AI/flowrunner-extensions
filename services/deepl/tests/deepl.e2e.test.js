'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('DeepL Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('deepl')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Account ──

  describe('getUsage', () => {
    it('returns usage with character count and limit', async () => {
      const response = await service.getUsage()

      expect(response).toHaveProperty('character_count')
      expect(response).toHaveProperty('character_limit')
      expect(typeof response.character_count).toBe('number')
    })
  })

  // ── Languages ──

  describe('listSourceLanguages', () => {
    it('returns a non-empty array of source languages', async () => {
      const response = await service.listSourceLanguages()

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('language')
      expect(response[0]).toHaveProperty('name')
    })
  })

  describe('listTargetLanguages', () => {
    it('returns target languages that expose formality support', async () => {
      const response = await service.listTargetLanguages()

      expect(Array.isArray(response)).toBe(true)
      expect(response.length).toBeGreaterThan(0)
      expect(response[0]).toHaveProperty('language')
      expect(response[0]).toHaveProperty('supports_formality')
    })
  })

  describe('getSourceLanguagesDictionary', () => {
    it('returns dictionary items with label/value pairs', async () => {
      const result = await service.getSourceLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters items by search', async () => {
      const result = await service.getSourceLanguagesDictionary({ search: 'english' })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items.every(item => /english/i.test(item.label))).toBe(true)
    })
  })

  describe('getTargetLanguagesDictionary', () => {
    it('returns dictionary items and marks formality support', async () => {
      const result = await service.getTargetLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      // At least one target language supports formality (e.g. German).
      expect(result.items.some(item => item.note === 'Supports formality')).toBe(true)
    })
  })

  // ── Translation ──

  describe('translateText', () => {
    it('translates English to German', async () => {
      const response = await service.translateText('Hello, world!', 'DE')

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
      expect(response).toHaveProperty('detectedSourceLanguage')
      expect(Array.isArray(response.translations)).toBe(true)
    })

    it('honors an explicit source language and formality', async () => {
      const response = await service.translateText('How are you?', 'DE', 'EN', 'More Formal')

      expect(response).toHaveProperty('text')
      expect(response.detectedSourceLanguage).toBe('EN')
    })
  })

  // ── Writing (DeepL Write) ──

  describe('improveText', () => {
    // DeepL Write is not available on every plan/key. Only run when the developer
    // opts in via testValues.runWrite === true.
    const canRun = () => testValues.runWrite === true

    it('improves English text when DeepL Write is enabled', async () => {
      if (!canRun()) {
        console.log('Skipping improveText: set testValues.runWrite = true to exercise DeepL Write')
        return
      }

      const response = await service.improveText('Their going too the store tommorow.', 'en-US')

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response).toHaveProperty('detectedSourceLanguage')
    })
  })

  // ── Glossaries ──

  describe('createGlossary + get + entries + edit + delete', () => {
    let glossaryId

    it('creates a glossary from an entries object', async () => {
      const response = await service.createGlossary(
        `E2E Glossary ${ suffix }`,
        'EN',
        'DE',
        { artist: 'Künstler', prize: 'Gewinn' }
      )

      expect(response).toHaveProperty('glossary_id')
      glossaryId = response.glossary_id
    })

    it('retrieves the created glossary metadata', async () => {
      const response = await service.getGlossary(glossaryId)

      expect(response).toHaveProperty('glossary_id', glossaryId)
      expect(response).toHaveProperty('dictionaries')
    })

    it('reads the glossary entries and parses them into an object', async () => {
      const response = await service.getGlossaryEntries(glossaryId, 'EN', 'DE')

      expect(response).toHaveProperty('entries')
      expect(response.entries).toHaveProperty('artist', 'Künstler')
      expect(response).toHaveProperty('entriesTsv')
    })

    it('appears in the glossaries dictionary', async () => {
      const result = await service.getGlossariesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.some(item => item.value === glossaryId)).toBe(true)
    })

    it('lists glossaries including the created one', async () => {
      const response = await service.listGlossaries()

      expect(response).toHaveProperty('glossaries')
      expect(Array.isArray(response.glossaries)).toBe(true)
      expect(response.glossaries.some(g => g.glossary_id === glossaryId)).toBe(true)
    })

    it('edits the glossary name and replaces entries', async () => {
      const response = await service.editGlossary(
        glossaryId,
        `E2E Glossary Renamed ${ suffix }`,
        'EN',
        'DE',
        { artist: 'Künstler', hello: 'hallo' }
      )

      expect(response).toHaveProperty('glossary_id', glossaryId)
    })

    it('deletes the glossary', async () => {
      const response = await service.deleteGlossary(glossaryId)

      expect(response).toEqual({ glossaryId, deleted: true })
    })

    afterAll(async () => {
      // Safety-net cleanup if an assertion aborted before the delete step.
      if (glossaryId) {
        try {
          await service.deleteGlossary(glossaryId)
        } catch (e) {
          // ignore — already deleted or never created
        }
      }
    })
  })

  // ── Documents ──

  describe('uploadDocument + getDocumentStatus + downloadTranslatedDocument', () => {
    // Document translation is billed at a 50,000-character minimum per document,
    // and downloadTranslatedDocument writes to FlowRunner file storage. Only run
    // when the developer opts in and supplies a document URL.
    const canRun = () => testValues.runDocument === true && Boolean(testValues.documentUrl)

    let documentId
    let documentKey

    it('uploads a document for translation when enabled', async () => {
      if (!canRun()) {
        console.log(
          'Skipping document translation: set testValues.runDocument = true and testValues.documentUrl'
        )
        return
      }

      const response = await service.uploadDocument(testValues.documentUrl, 'DE')

      expect(response).toHaveProperty('document_id')
      expect(response).toHaveProperty('document_key')
      documentId = response.document_id
      documentKey = response.document_key
    })

    it('checks the translation status', async () => {
      if (!canRun() || !documentId) {
        return
      }

      const response = await service.getDocumentStatus(documentId, documentKey)

      expect(response).toHaveProperty('document_id', documentId)
      expect(response).toHaveProperty('status')
    })
  })
})
