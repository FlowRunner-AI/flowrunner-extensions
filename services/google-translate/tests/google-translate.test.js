'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://translation.googleapis.com/language/translate/v2'

describe('Google Translate Service', () => {
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
    it('registers with correct config items', () => {
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

    it('sends the api key as a query param and JSON content type', async () => {
      mock.onPost(BASE).reply({ data: { translations: [{ translatedText: 'Hola' }] } })

      await service.translateText('Hello', 'es')

      expect(mock.history[0].query).toMatchObject({ key: API_KEY })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })

  // ── Translate Text ──

  describe('translateText', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(BASE).reply({
        data: { translations: [{ translatedText: 'Hola, ¿cómo estás?', detectedSourceLanguage: 'en' }] },
      })

      const result = await service.translateText('Hello, how are you?', 'es')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(BASE)
      expect(mock.history[0].body).toEqual({
        q: ['Hello, how are you?'],
        target: 'es',
        format: 'text',
      })
      expect(result).toEqual({
        translations: [{ translatedText: 'Hola, ¿cómo estás?', detectedSourceLanguage: 'en' }],
      })
    })

    it('wraps a string input into a single-element array', async () => {
      mock.onPost(BASE).reply({ data: { translations: [{ translatedText: 'Hola' }] } })

      await service.translateText('Hello', 'es')

      expect(mock.history[0].body.q).toEqual(['Hello'])
    })

    it('passes an array of strings through unchanged', async () => {
      mock.onPost(BASE).reply({
        data: { translations: [{ translatedText: 'Hola' }, { translatedText: 'Adiós' }] },
      })

      await service.translateText(['Hello', 'Goodbye'], 'es')

      expect(mock.history[0].body.q).toEqual(['Hello', 'Goodbye'])
    })

    it('includes source when provided and resolves HTML format choice', async () => {
      mock.onPost(BASE).reply({ data: { translations: [{ translatedText: '<b>Hola</b>' }] } })

      await service.translateText('<b>Hello</b>', 'es', 'en', 'HTML')

      expect(mock.history[0].body).toEqual({
        q: ['<b>Hello</b>'],
        target: 'es',
        source: 'en',
        format: 'html',
      })
    })

    it('resolves the "Text" format choice to text', async () => {
      mock.onPost(BASE).reply({ data: { translations: [{ translatedText: 'Hola' }] } })

      await service.translateText('Hello', 'es', undefined, 'Text')

      expect(mock.history[0].body.format).toBe('text')
    })

    it('passes an already-lowercase api format value through unchanged', async () => {
      mock.onPost(BASE).reply({ data: { translations: [{ translatedText: 'Hola' }] } })

      await service.translateText('Hello', 'es', undefined, 'html')

      expect(mock.history[0].body.format).toBe('html')
    })

    it('decodes HTML entities in text format results', async () => {
      mock.onPost(BASE).reply({
        data: {
          translations: [
            { translatedText: 'It&#39;s a &quot;test&quot; &amp; more &#x2764; &lt;here&gt;' },
          ],
        },
      })

      const result = await service.translateText('input', 'es')

      expect(result.translations[0].translatedText).toBe('It\'s a "test" & more ❤ <here>')
    })

    it('does NOT decode HTML entities when format is HTML', async () => {
      mock.onPost(BASE).reply({
        data: { translations: [{ translatedText: 'It&#39;s &amp; markup' }] },
      })

      const result = await service.translateText('input', 'es', undefined, 'HTML')

      expect(result.translations[0].translatedText).toBe('It&#39;s &amp; markup')
    })

    it('preserves extra translation fields like detectedSourceLanguage while decoding', async () => {
      mock.onPost(BASE).reply({
        data: { translations: [{ translatedText: 'caf&#233;', detectedSourceLanguage: 'en', model: 'nmt' }] },
      })

      const result = await service.translateText('input', 'es')

      expect(result.translations[0]).toEqual({
        translatedText: 'café',
        detectedSourceLanguage: 'en',
        model: 'nmt',
      })
    })

    it('returns an empty translations array when the API returns no data', async () => {
      mock.onPost(BASE).reply({})

      const result = await service.translateText('Hello', 'es')

      expect(result).toEqual({ translations: [] })
    })

    it('throws a wrapped error using the nested API error message', async () => {
      mock.onPost(BASE).replyWithError({
        message: 'Bad Request',
        body: { error: { code: 400, message: 'Invalid target language' } },
      })

      await expect(service.translateText('Hello', 'zz')).rejects.toThrow(
        'Google Translate API error: Invalid target language'
      )
    })

    it('falls back to error.body.message when there is no nested error object', async () => {
      mock.onPost(BASE).replyWithError({
        message: 'Bad Request',
        body: { message: 'Quota exceeded' },
      })

      await expect(service.translateText('Hello', 'es')).rejects.toThrow(
        'Google Translate API error: Quota exceeded'
      )
    })

    it('falls back to error.message when there is no body', async () => {
      mock.onPost(BASE).replyWithError({ message: 'Network Error' })

      await expect(service.translateText('Hello', 'es')).rejects.toThrow(
        'Google Translate API error: Network Error'
      )
    })
  })

  // ── Detect Language ──

  describe('detectLanguage', () => {
    it('sends correct request with a string input', async () => {
      mock.onPost(`${ BASE }/detect`).reply({
        data: { detections: [[{ language: 'en', confidence: 0.98, isReliable: false }]] },
      })

      const result = await service.detectLanguage('Hello world')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/detect`)
      expect(mock.history[0].body).toEqual({ q: ['Hello world'] })
      expect(result).toEqual({
        language: 'en',
        confidence: 0.98,
        detections: [{ language: 'en', confidence: 0.98, isReliable: false }],
      })
    })

    it('wraps an array input and flattens nested detection arrays', async () => {
      mock.onPost(`${ BASE }/detect`).reply({
        data: {
          detections: [
            [{ language: 'en', confidence: 0.9 }],
            [{ language: 'fr', confidence: 0.8 }],
          ],
        },
      })

      const result = await service.detectLanguage(['Hello', 'Bonjour'])

      expect(mock.history[0].body).toEqual({ q: ['Hello', 'Bonjour'] })
      expect(result.language).toBe('en')
      expect(result.confidence).toBe(0.9)
      expect(result.detections).toEqual([
        { language: 'en', confidence: 0.9 },
        { language: 'fr', confidence: 0.8 },
      ])
    })

    it('handles a flat (non-nested) detections array', async () => {
      mock.onPost(`${ BASE }/detect`).reply({
        data: { detections: [{ language: 'de', confidence: 0.75 }] },
      })

      const result = await service.detectLanguage('Hallo')

      expect(result).toEqual({
        language: 'de',
        confidence: 0.75,
        detections: [{ language: 'de', confidence: 0.75 }],
      })
    })

    it('returns undefined fields when the API returns no detections', async () => {
      mock.onPost(`${ BASE }/detect`).reply({ data: { detections: [] } })

      const result = await service.detectLanguage('???')

      expect(result).toEqual({
        language: undefined,
        confidence: undefined,
        detections: [],
      })
    })

    it('returns undefined fields when the API returns no data at all', async () => {
      mock.onPost(`${ BASE }/detect`).reply({})

      const result = await service.detectLanguage('???')

      expect(result).toEqual({
        language: undefined,
        confidence: undefined,
        detections: [],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/detect`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'API key not valid' } },
      })

      await expect(service.detectLanguage('Hello')).rejects.toThrow(
        'Google Translate API error: API key not valid'
      )
    })
  })

  // ── List Languages ──

  describe('listLanguages', () => {
    it('sends correct request with default names target', async () => {
      mock.onGet(`${ BASE }/languages`).reply({
        data: { languages: [{ language: 'en', name: 'English' }, { language: 'es', name: 'Spanish' }] },
      })

      const result = await service.listLanguages()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/languages`)
      expect(mock.history[0].query).toMatchObject({ target: 'en', key: API_KEY })
      expect(result).toEqual({
        languages: [{ language: 'en', name: 'English' }, { language: 'es', name: 'Spanish' }],
      })
    })

    it('passes a custom names language as the target query param', async () => {
      mock.onGet(`${ BASE }/languages`).reply({ data: { languages: [{ language: 'en', name: 'anglais' }] } })

      await service.listLanguages('fr')

      expect(mock.history[0].query).toMatchObject({ target: 'fr' })
    })

    it('returns an empty languages array when the API returns no data', async () => {
      mock.onGet(`${ BASE }/languages`).reply({})

      const result = await service.listLanguages()

      expect(result).toEqual({ languages: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/languages`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Requests to this API are blocked' } },
      })

      await expect(service.listLanguages()).rejects.toThrow(
        'Google Translate API error: Requests to this API are blocked'
      )
    })
  })

  // ── Dictionary Methods ──

  const LANGUAGES_RESPONSE = {
    data: {
      languages: [
        { language: 'en', name: 'English' },
        { language: 'es', name: 'Spanish' },
        { language: 'fr', name: 'French' },
        { language: 'de', name: 'German' },
      ],
    },
  }

  describe('getTargetLanguagesDictionary', () => {
    it('fetches the languages list with the default target and maps to items', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getTargetLanguagesDictionary({})

      expect(mock.history[0].query).toMatchObject({ target: 'en', key: API_KEY })
      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(4)
      expect(result.items[0]).toEqual({ label: 'English', value: 'en', note: 'en' })
      expect(result.items[1]).toEqual({ label: 'Spanish', value: 'es', note: 'es' })
    })

    it('filters items by name (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getTargetLanguagesDictionary({ search: 'span' })

      expect(result.items).toEqual([{ label: 'Spanish', value: 'es', note: 'es' }])
    })

    it('filters items by language code', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getTargetLanguagesDictionary({ search: 'de' })

      expect(result.items).toEqual([{ label: 'German', value: 'de', note: 'de' }])
    })

    it('returns an empty items array when nothing matches the search', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getTargetLanguagesDictionary({ search: 'zzz' })

      expect(result.items).toEqual([])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getTargetLanguagesDictionary(null)

      expect(result.items).toHaveLength(4)
      expect(result.cursor).toBeNull()
    })

    it('falls back to the language code as label when name is missing', async () => {
      mock.onGet(`${ BASE }/languages`).reply({ data: { languages: [{ language: 'zh' }] } })

      const result = await service.getTargetLanguagesDictionary({})

      expect(result.items).toEqual([{ label: 'zh', value: 'zh', note: 'zh' }])
    })

    it('returns empty items when the API returns no languages', async () => {
      mock.onGet(`${ BASE }/languages`).reply({})

      const result = await service.getTargetLanguagesDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getSourceLanguagesDictionary', () => {
    it('fetches the languages list and maps to items', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getSourceLanguagesDictionary({})

      expect(mock.history[0].query).toMatchObject({ target: 'en', key: API_KEY })
      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(4)
      expect(result.items[2]).toEqual({ label: 'French', value: 'fr', note: 'fr' })
    })

    it('filters items by search term', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getSourceLanguagesDictionary({ search: 'french' })

      expect(result.items).toEqual([{ label: 'French', value: 'fr', note: 'fr' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/languages`).reply(LANGUAGES_RESPONSE)

      const result = await service.getSourceLanguagesDictionary(null)

      expect(result.items).toHaveLength(4)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/languages`).replyWithError({
        message: 'Server Error',
        body: { error: { message: 'Internal error' } },
      })

      await expect(service.getSourceLanguagesDictionary({})).rejects.toThrow(
        'Google Translate API error: Internal error'
      )
    })
  })
})
