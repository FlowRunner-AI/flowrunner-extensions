'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://commentanalyzer.googleapis.com/v1alpha1'
const ANALYZE_URL = `${ BASE }/comments:analyze`
const SUGGEST_URL = `${ BASE }/comments:suggestscore`

describe('Perspective Service', () => {
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
    it('registers a single required apiKey config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems[0]).toEqual(
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        })
      )

      expect(typeof configItems[0].hint).toBe('string')
    })
  })

  // ── analyzeComment ──

  describe('analyzeComment', () => {
    const RESPONSE = {
      attributeScores: {
        TOXICITY: { summaryScore: { value: 0.91, type: 'PROBABILITY' } },
      },
      languages: ['en'],
      detectedLanguages: ['en'],
    }

    it('posts to the analyze endpoint with the API key as a query parameter', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      const result = await service.analyzeComment('you are awful')

      expect(result).toEqual(RESPONSE)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(ANALYZE_URL)
      expect(mock.history[0].query).toEqual({ key: API_KEY })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('defaults to TOXICITY, English, doNotStore true and no span annotations', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('hello there')

      expect(mock.history[0].body).toEqual({
        comment: { text: 'hello there', type: 'PLAIN_TEXT' },
        languages: ['en'],
        requestedAttributes: { TOXICITY: {} },
        doNotStore: true,
        spanAnnotations: false,
      })
    })

    it('maps friendly attribute labels to raw Perspective attribute names', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('text', ['Severe Toxicity', 'Identity Attack', 'Sexually Explicit'])

      expect(mock.history[0].body.requestedAttributes).toEqual({
        SEVERE_TOXICITY: {},
        IDENTITY_ATTACK: {},
        SEXUALLY_EXPLICIT: {},
      })
    })

    it('passes raw attribute names straight through when they are not known labels', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('text', ['PROFANITY', 'Threat'])

      expect(mock.history[0].body.requestedAttributes).toEqual({ PROFANITY: {}, THREAT: {} })
    })

    it('falls back to Toxicity when attributes is an empty array or not an array', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('text', [])
      await service.analyzeComment('text', 'not-an-array')

      expect(mock.history[0].body.requestedAttributes).toEqual({ TOXICITY: {} })
      expect(mock.history[1].body.requestedAttributes).toEqual({ TOXICITY: {} })
    })

    it('honours explicit languages, doNotStore false and span annotations', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('bonjour', ['Insult'], ['fr', 'en'], false, true)

      expect(mock.history[0].body).toEqual({
        comment: { text: 'bonjour', type: 'PLAIN_TEXT' },
        languages: ['fr', 'en'],
        requestedAttributes: { INSULT: {} },
        doNotStore: false,
        spanAnnotations: true,
      })
    })

    it('treats a non-boolean spanAnnotations value as false', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('text', ['Toxicity'], ['en'], true, 'yes')

      expect(mock.history[0].body.spanAnnotations).toBe(false)
    })

    it('defaults languages to en when an empty array is supplied', async () => {
      mock.onPost(ANALYZE_URL).reply(RESPONSE)

      await service.analyzeComment('text', ['Toxicity'], [])

      expect(mock.history[0].body.languages).toEqual(['en'])
    })

    it('wraps the Perspective error body in a readable message', async () => {
      mock.onPost(ANALYZE_URL).replyWithError({
        message: 'Request failed with status code 400',
        status: 400,
        body: {
          error: {
            message: 'Attribute SEXUALLY_EXPLICIT does not support request languages: fr',
            status: 'INVALID_ARGUMENT',
          },
        },
      })

      await expect(service.analyzeComment('texte', ['Sexually Explicit'], ['fr'])).rejects.toThrow(
        'Perspective API error: Attribute SEXUALLY_EXPLICIT does not support request languages: fr'
      )
    })

    it('falls back to the transport error message when no error body is present', async () => {
      mock.onPost(ANALYZE_URL).replyWithError({ message: 'Network timeout' })

      await expect(service.analyzeComment('text')).rejects.toThrow('Perspective API error: Network timeout')
    })
  })

  // ── suggestCommentScore ──

  describe('suggestCommentScore', () => {
    const RESPONSE = { clientToken: '', detectedLanguages: ['en'] }

    it('posts the suggested score under the resolved attribute name', async () => {
      mock.onPost(SUGGEST_URL).reply(RESPONSE)

      const result = await service.suggestCommentScore('this is fine', 'Toxicity', 0.1)

      expect(result).toEqual(RESPONSE)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(SUGGEST_URL)
      expect(mock.history[0].query).toEqual({ key: API_KEY })

      expect(mock.history[0].body).toEqual({
        comment: { text: 'this is fine' },
        attributeScores: { TOXICITY: { summaryScore: { value: 0.1 } } },
        languages: ['en'],
      })
    })

    it('maps a friendly attribute label and honours explicit languages', async () => {
      mock.onPost(SUGGEST_URL).reply(RESPONSE)

      await service.suggestCommentScore('texto', 'Identity Attack', 0.85, ['es'])

      expect(mock.history[0].body.attributeScores).toEqual({
        IDENTITY_ATTACK: { summaryScore: { value: 0.85 } },
      })

      expect(mock.history[0].body.languages).toEqual(['es'])
    })

    it('passes a raw attribute name straight through', async () => {
      mock.onPost(SUGGEST_URL).reply(RESPONSE)

      await service.suggestCommentScore('text', 'FLIRTATION', 0.5)

      expect(Object.keys(mock.history[0].body.attributeScores)).toEqual(['FLIRTATION'])
    })

    it('defaults languages to en when an empty array is supplied', async () => {
      mock.onPost(SUGGEST_URL).reply(RESPONSE)

      await service.suggestCommentScore('text', 'Insult', 0.4, [])

      expect(mock.history[0].body.languages).toEqual(['en'])
    })

    it('surfaces API errors with the Perspective prefix', async () => {
      mock.onPost(SUGGEST_URL).replyWithError({
        message: 'Request failed with status code 403',
        status: 403,
        body: { error: { message: 'Perspective API has not been used in project 123', status: 'PERMISSION_DENIED' } },
      })

      await expect(service.suggestCommentScore('text', 'Toxicity', 0.9)).rejects.toThrow(
        'Perspective API error: Perspective API has not been used in project 123'
      )
    })
  })
})
