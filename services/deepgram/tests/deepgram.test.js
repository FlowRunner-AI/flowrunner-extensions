'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.deepgram.com/v1'

describe('Deepgram Service', () => {
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

  // Parse the query string embedded in a request URL (STT / TTS / analyze
  // endpoints append the query to the URL rather than using .query()).
  function parseUrl(url) {
    const [path, qs] = url.split('?')
    const params = {}

    for (const [key, value] of new URLSearchParams(qs || '').entries()) {
      if (params[key] === undefined) {
        params[key] = value
      } else if (Array.isArray(params[key])) {
        params[key].push(value)
      } else {
        params[key] = [params[key], value]
      }
    }

    return { path, params }
  }

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

    it('sends the Authorization: Token header on requests', async () => {
      mock.onGet(`${ BASE }/projects`).reply({ projects: [] })

      await service.listProjects()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token ${ API_KEY }`,
      })
    })
  })

  // ── Speech to Text ──

  describe('transcribeAudioFromUrl', () => {
    it('posts the URL body with default model and no optional flags', async () => {
      mock.onAny().reply({ metadata: { request_id: 'r1' }, results: {} })

      const result = await service.transcribeAudioFromUrl('https://example.com/a.wav')

      expect(result).toEqual({ metadata: { request_id: 'r1' }, results: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      const { path, params } = parseUrl(mock.history[0].url)

      expect(path).toBe(`${ BASE }/listen`)
      expect(params).toEqual({ model: 'nova-3' })
      expect(mock.history[0].body).toEqual({ url: 'https://example.com/a.wav' })
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })

    it('maps boolean flags, choice values, and arrays into the query string', async () => {
      mock.onAny().reply({ ok: true })

      await service.transcribeAudioFromUrl(
        'https://example.com/a.wav',
        'nova-2', // model
        'en-US', // language
        true, // detectLanguage
        true, // smartFormat
        true, // punctuate
        true, // diarize
        true, // utterances
        true, // paragraphs
        true, // summarize
        true, // topics
        ['sports', 'news'], // customTopics
        'Strict', // customTopicMode
        true, // intents
        ['buy'], // customIntents
        'Extended', // customIntentMode
        true, // sentiment
        true, // detectEntities
        ['PII', 'Numbers'], // redact
        ['deepgram'], // keyterms
        ['acme:2'], // keywords
        true, // profanityFilter
        true, // fillerWords
        true, // numerals
        true, // measurements
        true, // dictation
        ['hello'], // searchTerms
        ['ai:AI'], // replaceTerms
        true, // multichannel
        1.2, // uttSplit
        'my-tag', // tag
        'https://cb.example.com', // callbackUrl
        'PUT' // callbackMethod
      )

      const { params } = parseUrl(mock.history[0].url)

      expect(params).toMatchObject({
        model: 'nova-2',
        language: 'en-US',
        detect_language: 'true',
        smart_format: 'true',
        punctuate: 'true',
        diarize: 'true',
        utterances: 'true',
        paragraphs: 'true',
        summarize: 'v2',
        topics: 'true',
        custom_topic: ['sports', 'news'],
        custom_topic_mode: 'strict',
        intents: 'true',
        custom_intent: 'buy',
        custom_intent_mode: 'extended',
        sentiment: 'true',
        detect_entities: 'true',
        redact: ['pii', 'numbers'],
        keyterm: 'deepgram',
        keywords: 'acme:2',
        profanity_filter: 'true',
        filler_words: 'true',
        numerals: 'true',
        measurements: 'true',
        dictation: 'true',
        search: 'hello',
        replace: 'ai:AI',
        multichannel: 'true',
        utt_split: '1.2',
        tag: 'my-tag',
        callback: 'https://cb.example.com',
        callback_method: 'put',
      })
    })

    it('omits custom_topic_mode when no custom topics are supplied', async () => {
      mock.onAny().reply({ ok: true })

      await service.transcribeAudioFromUrl(
        'https://example.com/a.wav', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, 'Strict'
      )

      const { params } = parseUrl(mock.history[0].url)

      expect(params.custom_topic_mode).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onAny().replyWithError({ message: 'Bad', body: { err_msg: 'invalid audio' } })

      await expect(service.transcribeAudioFromUrl('https://example.com/a.wav')).rejects.toThrow(
        'Deepgram API error: invalid audio'
      )
    })
  })

  describe('transcribeAudioFile', () => {
    it('downloads the file and streams it with the given content type', async () => {
      const fileBytes = Buffer.from('fake-audio')

      // First GET downloads the file bytes; the POST is the transcription call.
      mock.onGet('https://files.example.com/a.wav').reply(fileBytes)
      mock.onPost(undefined).reply({ results: { transcript: 'hi' } })

      const result = await service.transcribeAudioFile(
        'https://files.example.com/a.wav',
        'audio/wav',
        'nova-3'
      )

      expect(result).toEqual({ results: { transcript: 'hi' } })

      const download = mock.history[0]
      const post = mock.history[1]

      expect(download.method).toBe('get')
      expect(download.encoding).toBeNull()

      expect(post.method).toBe('post')
      expect(post.headers).toMatchObject({ 'Content-Type': 'audio/wav' })
      expect(Buffer.isBuffer(post.body)).toBe(true)

      const { path, params } = parseUrl(post.url)

      expect(path).toBe(`${ BASE }/listen`)
      expect(params).toEqual({ model: 'nova-3' })
    })

    it('defaults the content type to application/octet-stream', async () => {
      mock.onGet('https://files.example.com/a.wav').reply(Buffer.from('bytes'))
      mock.onPost(undefined).reply({ ok: true })

      await service.transcribeAudioFile('https://files.example.com/a.wav')

      expect(mock.history[1].headers).toMatchObject({
        'Content-Type': 'application/octet-stream',
      })
    })

    it('throws a source-download error when the file cannot be fetched', async () => {
      mock.onGet('https://files.example.com/missing.wav').replyWithError({ message: 'Not found' })

      await expect(
        service.transcribeAudioFile('https://files.example.com/missing.wav')
      ).rejects.toThrow('Failed to download source file: Not found')
    })
  })

  // ── Text to Speech ──

  describe('textToSpeech', () => {
    beforeEach(() => {
      // Files API is injected by the runtime; stub it for the non-callback path.
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn(async () => ({ url: 'https://files.flowrunner.com/out.mp3' })),
        },
      }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('generates audio, uploads it, and returns metadata from response headers', async () => {
      mock.onAny().reply({
        body: Buffer.from('audio-bytes'),
        headers: {
          'dg-model-name': 'aura-2-thalia-en',
          'dg-model-uuid': 'uuid-123',
          'dg-char-count': '42',
          'dg-request-id': 'req-1',
          'content-type': 'audio/mpeg',
        },
      })

      const result = await service.textToSpeech('Hello world')

      const { path, params } = parseUrl(mock.history[0].url)

      expect(path).toBe(`${ BASE }/speak`)
      expect(params).toEqual({ model: 'aura-2-thalia-en', encoding: 'mp3' })
      expect(mock.history[0].body).toEqual({ text: 'Hello world' })
      expect(mock.history[0].encoding).toBeNull()

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)
      const [uploadedBuffer, uploadOptions] = service.flowrunner.Files.uploadFile.mock.calls[0]

      expect(Buffer.isBuffer(uploadedBuffer)).toBe(true)
      expect(uploadOptions).toMatchObject({
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
      expect(uploadOptions.filename).toMatch(/^deepgram_tts_\d+\.mp3$/)

      expect(result).toEqual({
        url: 'https://files.flowrunner.com/out.mp3',
        model: 'aura-2-thalia-en',
        modelUuid: 'uuid-123',
        characterCount: 42,
        requestId: 'req-1',
        contentType: 'audio/mpeg',
      })
    })

    it('resolves the encoding choice and picks the matching file extension', async () => {
      mock.onAny().reply({ body: Buffer.from('wav-bytes'), headers: {} })

      await service.textToSpeech('Hi', 'aura-2-luna-en', 'WAV (Linear16)', 24000, 48000)

      const { params } = parseUrl(mock.history[0].url)

      expect(params).toEqual({
        model: 'aura-2-luna-en',
        encoding: 'linear16',
        sample_rate: '24000',
        bit_rate: '48000',
      })

      const uploadOptions = service.flowrunner.Files.uploadFile.mock.calls[0][1]

      expect(uploadOptions.filename).toMatch(/\.wav$/)
    })

    it('falls back to text length for character count when the header is absent', async () => {
      mock.onAny().reply({ body: Buffer.from('x'), headers: {} })

      const result = await service.textToSpeech('abcde')

      expect(result.characterCount).toBe(5)
      expect(result.model).toBe('aura-2-thalia-en')
    })

    it('returns the raw async response without uploading when a callback URL is given', async () => {
      mock.onAny().reply({ request_id: 'async-req-1' })

      const result = await service.textToSpeech(
        'Hello', undefined, undefined, undefined, undefined, 'https://cb.example.com'
      )

      const { params } = parseUrl(mock.history[0].url)

      expect(params).toMatchObject({ callback: 'https://cb.example.com' })
      expect(mock.history[0].encoding).toBeUndefined()
      expect(result).toEqual({ request_id: 'async-req-1' })
      expect(service.flowrunner.Files.uploadFile).not.toHaveBeenCalled()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onAny().replyWithError({ message: 'nope', body: { reason: 'text too long' } })

      await expect(service.textToSpeech('Hello')).rejects.toThrow('Deepgram API error: text too long')
    })
  })

  // ── Text Intelligence ──

  describe('analyzeText', () => {
    it('posts a text body with the enabled feature flags', async () => {
      mock.onAny().reply({ results: { summary: { text: 'ok' } } })

      const result = await service.analyzeText('Some text', undefined, true)

      expect(result).toEqual({ results: { summary: { text: 'ok' } } })

      const { path, params } = parseUrl(mock.history[0].url)

      expect(path).toBe(`${ BASE }/read`)
      expect(params).toEqual({ summarize: 'true' })
      expect(mock.history[0].body).toEqual({ text: 'Some text' })
    })

    it('posts a url body and maps all analysis options', async () => {
      mock.onAny().reply({ ok: true })

      await service.analyzeText(
        undefined, // text
        'https://example.com/doc.txt', // sourceUrl
        true, // summarize
        true, // topics
        ['sports'], // customTopics
        'Strict', // customTopicMode
        true, // intents
        ['buy'], // customIntents
        'Extended', // customIntentMode
        true, // sentiment
        'en', // language
        'https://cb.example.com', // callbackUrl
        'PUT' // callbackMethod
      )

      const { params } = parseUrl(mock.history[0].url)

      expect(params).toMatchObject({
        summarize: 'true',
        topics: 'true',
        custom_topic: 'sports',
        custom_topic_mode: 'strict',
        intents: 'true',
        custom_intent: 'buy',
        custom_intent_mode: 'extended',
        sentiment: 'true',
        language: 'en',
        callback: 'https://cb.example.com',
        callback_method: 'put',
      })
      expect(mock.history[0].body).toEqual({ url: 'https://example.com/doc.txt' })
    })

    it('throws when neither text nor source URL is provided', async () => {
      await expect(service.analyzeText(undefined, undefined, true)).rejects.toThrow(
        'Either Text or Source URL must be provided.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when both text and source URL are provided', async () => {
      await expect(
        service.analyzeText('text', 'https://example.com/doc.txt', true)
      ).rejects.toThrow('Provide either Text or Source URL, not both.')
    })

    it('throws when no analysis feature is enabled', async () => {
      await expect(service.analyzeText('text')).rejects.toThrow(
        'Enable at least one analysis feature'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onAny().replyWithError({ message: 'boom', body: { message: 'read failed' } })

      await expect(service.analyzeText('text', undefined, true)).rejects.toThrow(
        'Deepgram API error: read failed'
      )
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('gets the projects endpoint', async () => {
      mock.onGet(`${ BASE }/projects`).reply({ projects: [{ project_id: 'p1', name: 'App' }] })

      const result = await service.listProjects()

      expect(result).toEqual({ projects: [{ project_id: 'p1', name: 'App' }] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/projects`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/projects`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listProjects()).rejects.toThrow('Deepgram API error: Unauthorized')
    })
  })

  describe('getProject', () => {
    it('gets a project by id (url encoded)', async () => {
      mock.onGet(`${ BASE }/projects/p%201`).reply({ project_id: 'p 1', name: 'App' })

      const result = await service.getProject('p 1')

      expect(result).toEqual({ project_id: 'p 1', name: 'App' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p%201`)
    })
  })

  // ── API Keys ──

  describe('listApiKeys', () => {
    it('gets the project keys endpoint', async () => {
      mock.onGet(`${ BASE }/projects/p1/keys`).reply({ api_keys: [] })

      const result = await service.listApiKeys('p1')

      expect(result).toEqual({ api_keys: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/keys`)
    })
  })

  describe('createApiKey', () => {
    it('posts with required fields only', async () => {
      mock.onPost(`${ BASE }/projects/p1/keys`).reply({ api_key_id: 'k1' })

      const result = await service.createApiKey('p1', 'CI key', ['usage:write'])

      expect(result).toEqual({ api_key_id: 'k1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        comment: 'CI key',
        scopes: ['usage:write'],
      })
    })

    it('includes optional tags and expiration date', async () => {
      mock.onPost(`${ BASE }/projects/p1/keys`).reply({ api_key_id: 'k2' })

      await service.createApiKey('p1', 'CI key', ['member'], ['ci'], '2026-12-31T00:00:00Z')

      expect(mock.history[0].body).toEqual({
        comment: 'CI key',
        scopes: ['member'],
        tags: ['ci'],
        expiration_date: '2026-12-31T00:00:00Z',
      })
    })

    it('includes time to live when provided instead of expiration', async () => {
      mock.onPost(`${ BASE }/projects/p1/keys`).reply({ api_key_id: 'k3' })

      await service.createApiKey('p1', 'CI key', ['member'], undefined, undefined, 3600)

      expect(mock.history[0].body).toEqual({
        comment: 'CI key',
        scopes: ['member'],
        time_to_live_in_seconds: 3600,
      })
    })

    it('throws when both expiration date and time to live are provided', async () => {
      await expect(
        service.createApiKey('p1', 'CI key', ['member'], undefined, '2026-12-31T00:00:00Z', 3600)
      ).rejects.toThrow('Provide either Expiration Date or Time To Live, not both.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/projects/p1/keys`).replyWithError({ message: 'Forbidden' })

      await expect(service.createApiKey('p1', 'c', ['member'])).rejects.toThrow(
        'Deepgram API error: Forbidden'
      )
    })
  })

  describe('deleteApiKey', () => {
    it('deletes the key and returns success when the API returns nothing', async () => {
      mock.onDelete(`${ BASE }/projects/p1/keys/k1`).reply(undefined)

      const result = await service.deleteApiKey('p1', 'k1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/keys/k1`)
    })

    it('returns the API response object when one is provided', async () => {
      mock.onDelete(`${ BASE }/projects/p1/keys/k1`).reply({ message: 'deleted' })

      const result = await service.deleteApiKey('p1', 'k1')

      expect(result).toEqual({ message: 'deleted' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/projects/p1/keys/k1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteApiKey('p1', 'k1')).rejects.toThrow('Deepgram API error: Boom')
    })
  })

  // ── Usage ──

  describe('getUsageSummary', () => {
    it('sends only the project path with no query values by default', async () => {
      mock.onGet(`${ BASE }/projects/p1/usage`).reply({ results: [] })

      const result = await service.getUsageSummary('p1')

      expect(result).toEqual({ results: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/usage`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps choice filters to Deepgram enum values', async () => {
      mock.onGet(`${ BASE }/projects/p1/usage`).reply({ results: [] })

      await service.getUsageSummary(
        'p1', '2026-06-01', '2026-07-01', 'Speech to Text', 'Async', 'Self-Hosted', 'acc1', 'tag1', 'm1'
      )

      expect(mock.history[0].query).toMatchObject({
        start: '2026-06-01',
        end: '2026-07-01',
        endpoint: 'listen',
        method: 'async',
        deployment: 'self-hosted',
        accessor: 'acc1',
        tag: 'tag1',
        model: 'm1',
      })
    })
  })

  describe('getUsageBreakdown', () => {
    it('maps grouping and filter choices', async () => {
      mock.onGet(`${ BASE }/projects/p1/usage/breakdown`).reply({ results: [] })

      await service.getUsageBreakdown(
        'p1', '2026-06-01', '2026-07-01', 'Feature Set', 'Text to Speech', 'Sync', 'Hosted', 'acc1', 'tag1', 'm1'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/usage/breakdown`)
      expect(mock.history[0].query).toMatchObject({
        start: '2026-06-01',
        end: '2026-07-01',
        grouping: 'feature_set',
        endpoint: 'speak',
        method: 'sync',
        deployment: 'hosted',
        accessor: 'acc1',
        tag: 'tag1',
        model: 'm1',
      })
    })
  })

  describe('listUsageFields', () => {
    it('gets the usage fields endpoint with the date range', async () => {
      mock.onGet(`${ BASE }/projects/p1/usage/fields`).reply({ models: [] })

      await service.listUsageFields('p1', '2026-06-01', '2026-07-01')

      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/usage/fields`)
      expect(mock.history[0].query).toMatchObject({ start: '2026-06-01', end: '2026-07-01' })
    })
  })

  describe('listUsageRequests', () => {
    it('maps status and other choice filters', async () => {
      mock.onGet(`${ BASE }/projects/p1/requests`).reply({ requests: [] })

      await service.listUsageRequests(
        'p1', '2026-06-01', '2026-07-01', 25, 2, 'Succeeded', 'Voice Agent', 'Streaming', 'Beta', 'acc1'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/requests`)
      expect(mock.history[0].query).toMatchObject({
        start: '2026-06-01',
        end: '2026-07-01',
        limit: 25,
        page: 2,
        status: 'succeeded',
        endpoint: 'agent',
        method: 'streaming',
        deployment: 'beta',
        accessor: 'acc1',
      })
    })
  })

  describe('getUsageRequest', () => {
    it('gets a single request by id', async () => {
      mock.onGet(`${ BASE }/projects/p1/requests/req1`).reply({ request_id: 'req1' })

      const result = await service.getUsageRequest('p1', 'req1')

      expect(result).toEqual({ request_id: 'req1' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/requests/req1`)
    })
  })

  // ── Billing ──

  describe('listBalances', () => {
    it('gets the balances endpoint', async () => {
      mock.onGet(`${ BASE }/projects/p1/balances`).reply({ balances: [] })

      const result = await service.listBalances('p1')

      expect(result).toEqual({ balances: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/balances`)
    })
  })

  describe('getBalance', () => {
    it('gets a single balance by id', async () => {
      mock.onGet(`${ BASE }/projects/p1/balances/b1`).reply({ balance_id: 'b1', amount: 10 })

      const result = await service.getBalance('p1', 'b1')

      expect(result).toEqual({ balance_id: 'b1', amount: 10 })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/balances/b1`)
    })
  })

  // ── Models ──

  describe('listModels', () => {
    const modelsResponse = {
      stt: [{ canonical_name: 'nova-3-general', architecture: 'nova-3', batch: true }],
      tts: [{ canonical_name: 'aura-2-thalia-en', architecture: 'aura-2' }],
    }

    it('returns the full response for the All type', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.listModels('All')

      expect(result).toEqual(modelsResponse)
      expect(mock.history[0].query).toEqual({})
    })

    it('returns only stt models for the Speech to Text type', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.listModels('Speech to Text')

      expect(result).toEqual({ stt: modelsResponse.stt })
    })

    it('returns only tts models for the Text to Speech type', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.listModels('Text to Speech')

      expect(result).toEqual({ tts: modelsResponse.tts })
    })

    it('passes include_outdated when enabled', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      await service.listModels('All', true)

      expect(mock.history[0].query).toMatchObject({ include_outdated: true })
    })
  })

  describe('getModel', () => {
    it('gets a model by uuid', async () => {
      mock.onGet(`${ BASE }/models/uuid-1`).reply({ uuid: 'uuid-1' })

      const result = await service.getModel('uuid-1')

      expect(result).toEqual({ uuid: 'uuid-1' })
      expect(mock.history[0].url).toBe(`${ BASE }/models/uuid-1`)
    })
  })

  describe('listProjectModels', () => {
    it('gets the project models endpoint', async () => {
      mock.onGet(`${ BASE }/projects/p1/models`).reply({ stt: [], tts: [] })

      const result = await service.listProjectModels('p1')

      expect(result).toEqual({ stt: [], tts: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/p1/models`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes include_outdated when enabled', async () => {
      mock.onGet(`${ BASE }/projects/p1/models`).reply({ stt: [], tts: [] })

      await service.listProjectModels('p1', true)

      expect(mock.history[0].query).toMatchObject({ include_outdated: true })
    })
  })

  // ── Dictionaries ──

  describe('getSttModelsDictionary', () => {
    const modelsResponse = {
      stt: [
        { canonical_name: 'nova-3-medical', architecture: 'nova-3', batch: true },
        { canonical_name: 'nova-2-general', architecture: 'nova-2', batch: true, multilingual: true },
        { canonical_name: 'streaming-only', architecture: 'nova-2', batch: false },
        { canonical_name: 'nova-3-medical', architecture: 'nova-3', batch: true }, // duplicate
      ],
    }

    it('prepends aliases, filters non-batch and duplicate models, and sorts', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getSttModelsDictionary({})

      const values = result.items.map(i => i.value)

      expect(values.slice(0, 4)).toEqual(['nova-3', 'nova-2', 'enhanced', 'base'])
      expect(values).toContain('nova-3-medical')
      expect(values).toContain('nova-2-general')
      expect(values).not.toContain('streaming-only')
      // deduplicated
      expect(values.filter(v => v === 'nova-3-medical')).toHaveLength(1)
      // note reflects architecture and multilingual flag
      const multi = result.items.find(i => i.value === 'nova-2-general')
      expect(multi.note).toContain('multilingual')
      expect(result.cursor).toBeNull()
    })

    it('filters items by the search term', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getSttModelsDictionary({ search: 'medical' })

      expect(result.items).toEqual([
        { label: 'nova-3-medical', value: 'nova-3-medical', note: 'nova-3 architecture' },
      ])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/models`).reply({ stt: [] })

      const result = await service.getSttModelsDictionary(null)

      expect(result.items.map(i => i.value)).toEqual(['nova-3', 'nova-2', 'enhanced', 'base'])
    })
  })

  describe('getTtsVoicesDictionary', () => {
    const modelsResponse = {
      tts: [
        {
          canonical_name: 'aura-2-thalia-en',
          metadata: { display_name: 'Thalia', accent: 'American', tags: ['clear', 'confident', 'warm', 'extra'] },
        },
        { canonical_name: 'aura-2-luna-en', metadata: { accent: 'British' } },
        { canonical_name: 'aura-2-luna-en', metadata: {} }, // duplicate
      ],
    }

    it('maps voices with display name, accent and up to three tags, deduped and sorted', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getTtsVoicesDictionary({})

      expect(result.items).toEqual([
        { label: 'aura-2-luna-en', value: 'aura-2-luna-en', note: 'British' },
        {
          label: 'Thalia (aura-2-thalia-en)',
          value: 'aura-2-thalia-en',
          note: 'American - clear, confident, warm',
        },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters voices by the search term', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getTtsVoicesDictionary({ search: 'thalia' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('aura-2-thalia-en')
    })
  })

  describe('getProjectsDictionary', () => {
    const projectsResponse = {
      projects: [
        { project_id: 'p1', name: 'Alpha' },
        { project_id: 'p2', name: 'Beta' },
        { project_id: 'p3' },
      ],
    }

    it('maps projects to items, falling back to id when name is missing', async () => {
      mock.onGet(`${ BASE }/projects`).reply(projectsResponse)

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([
        { label: 'Alpha', value: 'p1' },
        { label: 'Beta', value: 'p2' },
        { label: 'p3', value: 'p3' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters projects by the search term', async () => {
      mock.onGet(`${ BASE }/projects`).reply(projectsResponse)

      const result = await service.getProjectsDictionary({ search: 'beta' })

      expect(result.items).toEqual([{ label: 'Beta', value: 'p2' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/projects`).reply({ projects: [] })

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getProjectKeysDictionary', () => {
    const keysResponse = {
      api_keys: [
        { api_key: { api_key_id: 'k1', comment: 'Prod key', scopes: ['member'] } },
        { api_key: { api_key_id: 'k2', scopes: ['admin'] } },
      ],
    }

    it('returns empty items without a project id in criteria (no request made)', async () => {
      const result = await service.getProjectKeysDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps keys for the given project criteria', async () => {
      mock.onGet(`${ BASE }/projects/p1/keys`).reply(keysResponse)

      const result = await service.getProjectKeysDictionary({ criteria: { projectId: 'p1' } })

      expect(result.items).toEqual([
        { label: 'Prod key', value: 'k1', note: 'member' },
        { label: 'k2', value: 'k2', note: 'admin' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters keys by the search term over the comment', async () => {
      mock.onGet(`${ BASE }/projects/p1/keys`).reply(keysResponse)

      const result = await service.getProjectKeysDictionary({
        search: 'prod',
        criteria: { projectId: 'p1' },
      })

      expect(result.items).toEqual([{ label: 'Prod key', value: 'k1', note: 'member' }])
    })
  })
})
