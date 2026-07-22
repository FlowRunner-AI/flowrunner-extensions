'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-lingvanex-api-key'
const BASE = 'https://api-b2b.backenster.com/b1/api/v3'

describe('LingvaNex Service', () => {
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

    it('sends the Authorization Bearer header on requests', async () => {
      mock.onGet(`${ BASE }/getLanguages`).reply({ err: null, result: [] })

      await service.getLanguages()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Translate ──

  describe('translate', () => {
    it('sends correct POST with required params only', async () => {
      mock.onPost(`${ BASE }/translate`).reply({
        err: null,
        result: 'Bonjour le monde',
      })

      const result = await service.translate('fr_FR', ['Hello world'])

      expect(result).toEqual({ err: null, result: 'Bonjour le monde' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/translate`)
      expect(mock.history[0].body).toEqual({
        platform: 'api',
        to: 'fr_FR',
        data: 'Hello world',
        translateMode: 'html',
      })
    })

    it('unwraps single-element arrays to a string in data', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Hola' })

      await service.translate('es_ES', ['Hello'])

      expect(mock.history[0].body.data).toBe('Hello')
    })

    it('sends multi-element arrays as-is', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'translated' })

      await service.translate('fr_FR', ['Hello', 'World'])

      expect(mock.history[0].body.data).toEqual(['Hello', 'World'])
    })

    it('includes from language when provided', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'], 'en_GB')

      expect(mock.history[0].body.from).toBe('en_GB')
    })

    it('omits from when not provided', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'])

      expect(mock.history[0].body).not.toHaveProperty('from')
    })

    it('maps translateMode "Text" to "text"', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'], undefined, 'Text')

      expect(mock.history[0].body.translateMode).toBe('text')
    })

    it('maps translateMode "HTML" to "html"', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'], undefined, 'HTML')

      expect(mock.history[0].body.translateMode).toBe('html')
    })

    it('defaults translateMode to html when not provided', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'])

      expect(mock.history[0].body.translateMode).toBe('html')
    })

    it('includes enableTransliteration when true', async () => {
      mock.onPost(`${ BASE }/translate`).reply({
        err: null,
        result: 'Bonjour',
        sourceTransliteration: 'Hello',
        targetTransliteration: 'Bonjour',
      })

      await service.translate('fr_FR', ['Hello'], undefined, undefined, true)

      expect(mock.history[0].body.enableTransliteration).toBe(true)
    })

    it('omits enableTransliteration when false', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'], undefined, undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('enableTransliteration')
    })

    it('omits enableTransliteration when not provided', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello'])

      expect(mock.history[0].body).not.toHaveProperty('enableTransliteration')
    })

    it('sends all optional params together', async () => {
      mock.onPost(`${ BASE }/translate`).reply({ err: null, result: 'Bonjour' })

      await service.translate('fr_FR', ['Hello', 'World'], 'en_GB', 'Text', true)

      expect(mock.history[0].body).toEqual({
        platform: 'api',
        from: 'en_GB',
        to: 'fr_FR',
        data: ['Hello', 'World'],
        translateMode: 'text',
        enableTransliteration: true,
      })
    })

    it('throws on API error in err field', async () => {
      mock.onPost(`${ BASE }/translate`).reply({
        err: 'Invalid language code',
        result: null,
      })

      await expect(service.translate('xx_XX', ['Hello'])).rejects.toThrow(
        'LingvaNex API error: Invalid language code'
      )
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${ BASE }/translate`).replyWithError({
        message: 'Unauthorized',
        body: { err: 'Invalid API key' },
      })

      await expect(service.translate('fr_FR', ['Hello'])).rejects.toThrow('LingvaNex API error')
    })
  })

  // ── Get Languages ──

  describe('getLanguages', () => {
    it('sends GET with default code en_GB', async () => {
      mock.onGet(`${ BASE }/getLanguages`).reply({
        err: null,
        result: [{ full_code: 'en_GB', englishName: 'English' }],
      })

      const result = await service.getLanguages()

      expect(result).toEqual({
        err: null,
        result: [{ full_code: 'en_GB', englishName: 'English' }],
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/getLanguages`)
      expect(mock.history[0].query).toMatchObject({
        platform: 'api',
        code: 'en_GB',
      })
    })

    it('sends custom code when provided', async () => {
      mock.onGet(`${ BASE }/getLanguages`).reply({ err: null, result: [] })

      await service.getLanguages('fr_FR')

      expect(mock.history[0].query).toMatchObject({
        platform: 'api',
        code: 'fr_FR',
      })
    })

    it('defaults to en_GB when code is empty string', async () => {
      mock.onGet(`${ BASE }/getLanguages`).reply({ err: null, result: [] })

      await service.getLanguages('')

      expect(mock.history[0].query).toMatchObject({
        code: 'en_GB',
      })
    })

    it('throws on API error in err field', async () => {
      mock.onGet(`${ BASE }/getLanguages`).reply({
        err: 'Something went wrong',
        result: null,
      })

      await expect(service.getLanguages()).rejects.toThrow(
        'LingvaNex API error: Something went wrong'
      )
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${ BASE }/getLanguages`).replyWithError({
        message: 'Service unavailable',
      })

      await expect(service.getLanguages()).rejects.toThrow('LingvaNex API error')
    })
  })

  // ── Detect Language ──

  describe('detectLanguage', () => {
    it('sends POST with single-element array unwrapped', async () => {
      mock.onPost(`${ BASE }/detect`).reply({ err: null, result: 'en_GB' })

      const result = await service.detectLanguage(['Hello world'])

      expect(result).toEqual({ err: null, result: 'en_GB' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/detect`)
      expect(mock.history[0].body).toEqual({
        platform: 'api',
        data: 'Hello world',
      })
    })

    it('sends multi-element array as-is', async () => {
      mock.onPost(`${ BASE }/detect`).reply({ err: null, result: 'en_GB' })

      await service.detectLanguage(['Hello', 'Bonjour'])

      expect(mock.history[0].body.data).toEqual(['Hello', 'Bonjour'])
    })

    it('throws on API error in err field', async () => {
      mock.onPost(`${ BASE }/detect`).reply({
        err: 'Detection failed',
        result: null,
      })

      await expect(service.detectLanguage(['test'])).rejects.toThrow(
        'LingvaNex API error: Detection failed'
      )
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${ BASE }/detect`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid input' },
      })

      await expect(service.detectLanguage(['test'])).rejects.toThrow('LingvaNex API error')
    })
  })
})
