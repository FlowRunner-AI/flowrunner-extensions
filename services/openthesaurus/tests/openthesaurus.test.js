'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE = 'https://www.openthesaurus.de'

describe('OpenThesaurus Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({})
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
    it('registers with no config items', () => {
      expect(sandbox.getConfigItems()).toEqual([])
    })
  })

  // ── getSynonyms ──

  describe('getSynonyms', () => {
    const SYNONYMS_URL = `${BASE}/synonyme/search`

    const sampleResponse = {
      metaData: {
        apiVersion: '0.2',
        copyright: 'Copyright (C) 2026 Daniel Naber',
        license: 'Creative Commons',
        source: 'https://www.openthesaurus.de',
      },
      synsets: [
        {
          id: 292,
          categories: [],
          terms: [
            { term: 'Erprobung' },
            { term: 'Probe' },
            { term: 'Test' },
          ],
        },
      ],
    }

    it('sends correct request with required word parameter only', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      const result = await service.getSynonyms('Test')

      expect(result).toEqual(sampleResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(SYNONYMS_URL)
      expect(mock.history[0].headers).toMatchObject({
        'User-Agent': 'FlowRunner-OpenThesaurus-Extension (https://flowrunner.io)',
      })
      expect(mock.history[0].query).toEqual({
        q: 'Test',
        format: 'application/json',
      })
    })

    it('includes similar param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        similar: 'true',
      })
    })

    it('includes substring param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        substring: 'true',
      })
      expect(mock.history[0].query.similar).toBeUndefined()
    })

    it('includes startswith param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, false, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        startswith: 'true',
      })
    })

    it('includes subsynsets param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, false, false, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        subsynsets: 'true',
      })
    })

    it('includes supersynsets param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, false, false, false, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        supersynsets: 'true',
      })
    })

    it('includes baseform param when true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, false, false, false, false, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'Test',
        format: 'application/json',
        baseform: 'true',
      })
    })

    it('includes all optional params when all are true', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('gehen', true, true, true, true, true, true)

      expect(mock.history[0].query).toEqual({
        q: 'gehen',
        format: 'application/json',
        similar: 'true',
        substring: 'true',
        startswith: 'true',
        subsynsets: 'true',
        supersynsets: 'true',
        baseform: 'true',
      })
    })

    it('omits optional params when false', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', false, false, false, false, false, false)

      expect(mock.history[0].query).toEqual({
        q: 'Test',
        format: 'application/json',
      })
    })

    it('omits optional params when undefined', async () => {
      mock.onGet(SYNONYMS_URL).reply(sampleResponse)

      await service.getSynonyms('Test', undefined, undefined, undefined, undefined, undefined, undefined)

      expect(mock.history[0].query).toEqual({
        q: 'Test',
        format: 'application/json',
      })
    })

    it('returns empty synsets for unknown word', async () => {
      const emptyResponse = { metaData: {}, synsets: [] }
      mock.onGet(SYNONYMS_URL).reply(emptyResponse)

      const result = await service.getSynonyms('xyznonexistent')

      expect(result).toEqual(emptyResponse)
      expect(result.synsets).toHaveLength(0)
    })

    it('throws on API error', async () => {
      mock.onGet(SYNONYMS_URL).replyWithError({
        message: 'Internal Server Error',
        body: { message: 'Something went wrong' },
      })

      await expect(service.getSynonyms('Test')).rejects.toThrow('OpenThesaurus API error')
    })

    it('throws with status code in error message when available', async () => {
      mock.onGet(SYNONYMS_URL).replyWithError({
        message: 'Too Many Requests',
        status: 429,
      })

      await expect(service.getSynonyms('Test')).rejects.toThrow('(429)')
    })

    it('uses error.message when body is missing', async () => {
      mock.onGet(SYNONYMS_URL).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getSynonyms('Test')).rejects.toThrow('Network timeout')
    })
  })
})
