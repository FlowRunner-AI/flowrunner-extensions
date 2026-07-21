'use strict'

const crypto = require('node:crypto')
const { createSandbox } = require('../../../service-sandbox')

// A real 2048-bit RSA keypair so the service's genuine JWT signing path
// (crypto.createSign('RSA-SHA256').sign(private_key)) executes for real. Only the
// HTTP boundary (Google token endpoint + Vertex AI API) is mocked; signing is not.
const { privateKey: PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'key-file-project',
  client_email: 'svc@key-file-project.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
}

const SERVICE_ACCOUNT_KEY = JSON.stringify(SERVICE_ACCOUNT)
const PROJECT_ID = 'test-project'
const REGION = 'us-central1'
const BASE = `https://${ REGION }-aiplatform.googleapis.com/v1/projects/${ PROJECT_ID }/locations/${ REGION }`
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ACCESS_TOKEN = 'ya29.test-access-token'

function stubToken(mock) {
  mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 3600 })
}

// A minimal generateContent-shaped API response, used to warm the token and as a
// convenient default for token-exchange assertions.
function textResponse(text, modelVersion) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    modelVersion,
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
  }
}

describe('Google Vertex AI Service', () => {
  let sandbox
  let service
  let mock
  let mainFlowrunner

  // Build a service instance backed by its own config + mock, isolated from the
  // shared instance. The service module caches on first require and only calls
  // addService() once, so jest.isolateModules() forces re-registration with the
  // new config. The isolated sandbox reassigns global.Flowrunner, so the returned
  // cleanup() restores the shared instance's global before other tests run.
  function createIsolatedService(config) {
    const isoSandbox = createSandbox(config)

    jest.isolateModules(() => {
      require('../src/index.js')
    })

    const isoService = isoSandbox.getService()

    // Files API is injected by the FlowRunner runtime at execution time; the sandbox
    // does not provide it. Stub it so generateImage's storage path can be exercised.
    isoService.flowrunner = { Files: { uploadFile: jest.fn() } }

    return {
      service: isoService,
      mock: isoSandbox.getRequestMock(),
      cleanup() {
        isoSandbox.cleanup()
        global.Flowrunner = mainFlowrunner
      },
    }
  }

  beforeAll(async () => {
    sandbox = createSandbox({
      serviceAccountKey: SERVICE_ACCOUNT_KEY,
      projectId: PROJECT_ID,
      region: REGION,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    mainFlowrunner = global.Flowrunner

    // Files API is runtime-injected; stub it on the shared instance for generateImage.
    service.flowrunner = { Files: { uploadFile: jest.fn() } }

    // Warm up: perform one request so the access token is signed and cached on the
    // shared service instance. After this, mock.history[0] in every test is the
    // actual Vertex request (the token endpoint is not hit again for ~1h).
    stubToken(mock)
    mock.onPost(`${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`)
      .reply(textResponse('warm', 'gemini-2.5-flash'))
    await service.generateContent('gemini-2.5-flash', 'warm up')
    mock.reset()
  })

  afterEach(() => {
    mock.reset()
    // The Files mock is a persistent jest.fn on the shared instance; clear its call
    // history and per-test resolved values between tests.
    service.flowrunner.Files.uploadFile.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'serviceAccountKey',
          displayName: 'Service Account Key (JSON)',
          required: true,
          shared: false,
          type: 'TEXT',
        }),
        expect.objectContaining({
          name: 'projectId',
          displayName: 'Project ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'region',
          displayName: 'Region',
          required: true,
          shared: false,
          type: 'STRING',
          defaultValue: 'us-central1',
        }),
      ])
    })

    it('sends the bearer token and JSON content-type on requests', async () => {
      mock.onPost(`${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('hi'))

      await service.generateContent('gemini-2.5-flash', 'hi')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Authentication / token exchange ──

  describe('access token exchange', () => {
    it('exchanges a signed JWT for an access token on the first request', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region: REGION,
      })

      stubToken(iso.mock)
      iso.mock.onPost(`${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('hello'))

      await iso.service.generateContent('gemini-2.5-flash', 'hello')

      // First call is the JWT-bearer token exchange to Google.
      expect(iso.mock.history[0].method).toBe('post')
      expect(iso.mock.history[0].url).toBe(TOKEN_URL)
      expect(iso.mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(typeof iso.mock.history[0].body).toBe('string')
      expect(iso.mock.history[0].body).toContain(
        'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
      )
      expect(iso.mock.history[0].body).toContain('assertion=')

      // Second call is the Vertex request carrying the returned token.
      expect(iso.mock.history[1].url).toBe(
        `${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`
      )
      expect(iso.mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
      })

      iso.cleanup()
    })

    it('caches the access token across requests', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region: REGION,
      })

      stubToken(iso.mock)
      iso.mock.onPost(`${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('a'))

      await iso.service.generateContent('gemini-2.5-flash', 'one')
      await iso.service.generateContent('gemini-2.5-flash', 'two')

      const tokenCalls = iso.mock.history.filter(h => h.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      iso.cleanup()
    })

    it('throws a helpful error when the service account key is not valid JSON', async () => {
      const iso = createIsolatedService({ serviceAccountKey: 'not-json', projectId: PROJECT_ID, region: REGION })

      await expect(iso.service.generateContent('gemini-2.5-flash', 'x')).rejects.toThrow(
        'Service account key is not valid JSON'
      )

      iso.cleanup()
    })

    it('throws when the key is missing client_email or private_key', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: JSON.stringify({ project_id: 'x' }),
        projectId: PROJECT_ID,
        region: REGION,
      })

      await expect(iso.service.generateContent('gemini-2.5-flash', 'x')).rejects.toThrow(
        'is missing "client_email" or "private_key"'
      )

      iso.cleanup()
    })

    it('throws when the service account key is not configured', async () => {
      const iso = createIsolatedService({ projectId: PROJECT_ID, region: REGION })

      await expect(iso.service.generateContent('gemini-2.5-flash', 'x')).rejects.toThrow(
        'Service account key is not configured'
      )

      iso.cleanup()
    })

    it('surfaces token endpoint failures with the error_description', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region: REGION,
      })

      iso.mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature' },
      })

      await expect(iso.service.generateContent('gemini-2.5-flash', 'x')).rejects.toThrow(
        'Failed to obtain an access token from Google: Invalid JWT Signature'
      )

      iso.cleanup()
    })

    it('throws when the token endpoint returns no access_token', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region: REGION,
      })

      iso.mock.onPost(TOKEN_URL).reply({ token_type: 'Bearer' })

      await expect(iso.service.generateContent('gemini-2.5-flash', 'x')).rejects.toThrow(
        'Google token endpoint did not return an access token'
      )

      iso.cleanup()
    })

    it('derives the project id from the key file when projectId config is empty', async () => {
      const iso = createIsolatedService({ serviceAccountKey: SERVICE_ACCOUNT_KEY, region: REGION })
      const keyBase =
        `https://${ REGION }-aiplatform.googleapis.com/v1/projects/${ SERVICE_ACCOUNT.project_id }/locations/${ REGION }`

      stubToken(iso.mock)
      iso.mock.onPost(`${ keyBase }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('ok'))

      await iso.service.generateContent('gemini-2.5-flash', 'x')

      const vertexCall = iso.mock.history.find(
        h => h.url === `${ keyBase }/publishers/google/models/gemini-2.5-flash:generateContent`
      )

      expect(vertexCall).toBeDefined()
      iso.cleanup()
    })
  })

  // ── Region / base URL ──

  describe('region-scoped base URL', () => {
    it('threads a non-default region into the request host and path', async () => {
      const region = 'europe-west4'
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region,
      })
      const regionBase =
        `https://${ region }-aiplatform.googleapis.com/v1/projects/${ PROJECT_ID }/locations/${ region }`

      stubToken(iso.mock)
      iso.mock.onPost(`${ regionBase }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('ok'))

      await iso.service.generateContent('gemini-2.5-flash', 'x')

      const vertexCall = iso.mock.history.find(h => h.url.includes(`${ region }-aiplatform`))

      expect(vertexCall).toBeDefined()
      expect(vertexCall.url).toBe(
        `${ regionBase }/publishers/google/models/gemini-2.5-flash:generateContent`
      )
      iso.cleanup()
    })

    it('uses the global endpoint when region is "global"', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        region: 'global',
      })
      const globalBase =
        `https://aiplatform.googleapis.com/v1/projects/${ PROJECT_ID }/locations/global`

      stubToken(iso.mock)
      iso.mock.onPost(`${ globalBase }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('ok'))

      await iso.service.generateContent('gemini-2.5-flash', 'x')

      const vertexCall = iso.mock.history.find(
        h => h.url === `${ globalBase }/publishers/google/models/gemini-2.5-flash:generateContent`
      )

      expect(vertexCall).toBeDefined()
      iso.cleanup()
    })

    it('defaults the region to us-central1 when config omits it', async () => {
      const iso = createIsolatedService({ serviceAccountKey: SERVICE_ACCOUNT_KEY, projectId: PROJECT_ID })
      const defaultBase =
        `https://us-central1-aiplatform.googleapis.com/v1/projects/${ PROJECT_ID }/locations/us-central1`

      stubToken(iso.mock)
      iso.mock.onPost(`${ defaultBase }/publishers/google/models/gemini-2.5-flash:generateContent`)
        .reply(textResponse('ok'))

      await iso.service.generateContent('gemini-2.5-flash', 'x')

      const vertexCall = iso.mock.history.find(h => h.url.includes('us-central1-aiplatform'))

      expect(vertexCall).toBeDefined()
      iso.cleanup()
    })
  })

  // ── Generate Content ──

  describe('generateContent', () => {
    const url = `${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`

    it('sends the minimal body and extracts the text', async () => {
      mock.onPost(url).reply({
        candidates: [
          { content: { parts: [{ text: 'Hello world' }] }, finishReason: 'STOP' },
        ],
        modelVersion: 'gemini-2.5-flash-001',
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      })

      const result = await service.generateContent('gemini-2.5-flash', 'Say hi')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }],
      })
      expect(result).toEqual({
        text: 'Hello world',
        model: 'gemini-2.5-flash-001',
        finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
      })
    })

    it('includes systemInstruction and generationConfig when provided', async () => {
      mock.onPost(url).reply(textResponse('ok'))

      await service.generateContent('gemini-2.5-flash', 'Prompt', 'Be terse', 0.2, 256)

      expect(mock.history[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Prompt' }] }],
        systemInstruction: { parts: [{ text: 'Be terse' }] },
        generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
      })
    })

    it('includes temperature 0 (a falsy-but-present value)', async () => {
      mock.onPost(url).reply(textResponse('ok'))

      await service.generateContent('gemini-2.5-flash', 'Prompt', undefined, 0)

      expect(mock.history[0].body.generationConfig).toEqual({ temperature: 0 })
    })

    it('filters out thought parts and joins remaining text', async () => {
      mock.onPost(url).reply({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking...', thought: true },
                { text: 'Answer part 1. ' },
                { text: 'Answer part 2.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      })

      const result = await service.generateContent('gemini-2.5-flash', 'q')

      expect(result.text).toBe('Answer part 1. Answer part 2.')
      expect(result.model).toBe('gemini-2.5-flash')
      expect(result.usageMetadata).toBeNull()
    })

    it('returns empty text and null finishReason when there are no candidates', async () => {
      mock.onPost(url).reply({})

      const result = await service.generateContent('gemini-2.5-flash', 'q')

      expect(result).toEqual({
        text: '',
        model: 'gemini-2.5-flash',
        finishReason: null,
        usageMetadata: null,
      })
    })

    it('wraps API errors from the error body message', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Model not found', code: 404 } },
      })

      await expect(service.generateContent('gemini-2.5-flash', 'q')).rejects.toThrow(
        'Vertex AI API error: Model not found'
      )
    })
  })

  // ── Generate Content (Advanced) ──

  describe('generateContentAdvanced', () => {
    const url = `${ BASE }/publishers/google/models/gemini-2.5-flash:generateContent`

    it('sends only the current user turn with required params', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced('gemini-2.5-flash', 'Hi there')

      expect(mock.history[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Hi there' }] }],
      })
    })

    it('prepends conversation history before the current prompt', async () => {
      mock.onPost(url).reply(textResponse('done'))

      const history = [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello!' }] },
      ]

      await service.generateContentAdvanced('gemini-2.5-flash', 'Continue', undefined, history)

      expect(mock.history[0].body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello!' }] },
        { role: 'user', parts: [{ text: 'Continue' }] },
      ])
    })

    it('downloads media URLs and inlines them as base64 before the prompt text', async () => {
      const mediaUrl = 'https://cdn.example.com/pic.png'

      mock.onGet(mediaUrl).reply(Buffer.from('fake-image-bytes'))
      mock.onPost(url).reply(textResponse('described'))

      await service.generateContentAdvanced('gemini-2.5-flash', 'Describe', [mediaUrl])

      // Binary download uses setEncoding(null).
      const mediaCall = mock.history.find(h => h.url === mediaUrl)

      expect(mediaCall).toBeDefined()
      expect(mediaCall.encoding).toBeNull()

      const parts = mock.history.find(h => h.url === url).body.contents[0].parts

      expect(parts[0]).toEqual({
        inline_data: {
          mime_type: 'image/png',
          data: Buffer.from('fake-image-bytes').toString('base64'),
        },
      })
      expect(parts[1]).toEqual({ text: 'Describe' })
    })

    it('builds a full generationConfig from all sampling controls', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, 'System',
        0.7, 0.9, 40, 512, ['STOP', 'END'], 1234
      )

      expect(mock.history[0].body.systemInstruction).toEqual({ parts: [{ text: 'System' }] })
      expect(mock.history[0].body.generationConfig).toEqual({
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 512,
        seed: 1234,
        stopSequences: ['STOP', 'END'],
      })
    })

    it('maps the JSON response format to responseMimeType', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        'JSON'
      )

      expect(mock.history[0].body.generationConfig).toEqual({ responseMimeType: 'application/json' })
    })

    it('does not set responseMimeType for the default Text format', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        'Text'
      )

      expect(mock.history[0].body.generationConfig).toBeUndefined()
    })

    it('adds a response schema and defaults the mime type to JSON', async () => {
      mock.onPost(url).reply(textResponse('done'))

      const schema = { type: 'OBJECT', properties: { name: { type: 'STRING' } } }

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, schema
      )

      expect(mock.history[0].body.generationConfig).toEqual({
        responseSchema: schema,
        responseMimeType: 'application/json',
      })
    })

    it('builds a thinkingConfig from thinkingBudget and includeThoughts', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, -1, true
      )

      expect(mock.history[0].body.generationConfig).toEqual({
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      })
    })

    it('adds function declarations and the google search tool', async () => {
      mock.onPost(url).reply(textResponse('done'))

      const declarations = [{ name: 'lookup', description: 'Look up', parameters: { type: 'OBJECT' } }]

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        true, declarations
      )

      expect(mock.history[0].body.tools).toEqual([
        { functionDeclarations: declarations },
        { googleSearch: {} },
      ])
    })

    it('maps friendly safety-setting labels to API enums', async () => {
      mock.onPost(url).reply(textResponse('done'))

      await service.generateContentAdvanced(
        'gemini-2.5-flash', 'Prompt', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined,
        [{ category: 'Hate Speech', threshold: 'Block Only High' }]
      )

      expect(mock.history[0].body.safetySettings).toEqual([
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      ])
    })

    it('extracts text, thoughts, function calls and grounding metadata', async () => {
      const grounding = { webSearchQueries: ['q'], groundingChunks: [] }

      mock.onPost(url).reply({
        candidates: [
          {
            content: {
              parts: [
                { text: 'reasoning', thought: true },
                { text: 'The answer.' },
                { functionCall: { name: 'lookup', args: { id: 1 } } },
              ],
            },
            groundingMetadata: grounding,
            finishReason: 'STOP',
          },
        ],
        modelVersion: 'gemini-2.5-flash-002',
        usageMetadata: { totalTokenCount: 20 },
      })

      const result = await service.generateContentAdvanced('gemini-2.5-flash', 'q')

      expect(result).toEqual({
        text: 'The answer.',
        thoughts: 'reasoning',
        functionCalls: [{ name: 'lookup', args: { id: 1 } }],
        groundingMetadata: grounding,
        finishReason: 'STOP',
        model: 'gemini-2.5-flash-002',
        usageMetadata: { totalTokenCount: 20 },
      })
    })

    it('returns null thoughts and empty function calls for a plain text response', async () => {
      mock.onPost(url).reply({
        candidates: [{ content: { parts: [{ text: 'Plain' }] }, finishReason: 'STOP' }],
      })

      const result = await service.generateContentAdvanced('gemini-2.5-flash', 'q')

      expect(result.text).toBe('Plain')
      expect(result.thoughts).toBeNull()
      expect(result.functionCalls).toEqual([])
      expect(result.groundingMetadata).toBeNull()
    })

    it('wraps API errors', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid argument' } },
      })

      await expect(service.generateContentAdvanced('gemini-2.5-flash', 'q')).rejects.toThrow(
        'Vertex AI API error: Invalid argument'
      )
    })
  })

  // ── Count Tokens ──

  describe('countTokens', () => {
    const url = `${ BASE }/publishers/google/models/gemini-2.5-flash:countTokens`

    it('posts the text as a user turn and returns the raw response', async () => {
      mock.onPost(url).reply({ totalTokens: 31, totalBillableCharacters: 128 })

      const result = await service.countTokens('gemini-2.5-flash', 'Count me')

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Count me' }] }],
      })
      expect(result).toEqual({ totalTokens: 31, totalBillableCharacters: 128 })
    })

    it('wraps API errors', async () => {
      mock.onPost(url).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Model not found' } },
      })

      await expect(service.countTokens('gemini-2.5-flash', 'x')).rejects.toThrow(
        'Vertex AI API error: Model not found'
      )
    })
  })

  // ── Create Embeddings ──

  describe('createEmbeddings', () => {
    const url = `${ BASE }/publishers/google/models/gemini-embedding-001:predict`

    it('embeds each text in its own request and returns vectors in order', async () => {
      mock.onPost(url).replyWith((call) => {
        const content = call.body.instances[0].content

        return {
          predictions: [
            { embeddings: { values: content === 'first' ? [0.1, 0.2] : [0.3, 0.4], statistics: { token_count: 1 } } },
          ],
        }
      })

      const result = await service.createEmbeddings('gemini-embedding-001', ['first', 'second'])

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body).toEqual({ instances: [{ content: 'first' }] })
      expect(mock.history[1].body).toEqual({ instances: [{ content: 'second' }] })
      expect(result).toEqual({
        embeddings: [
          { values: [0.1, 0.2], statistics: { token_count: 1 } },
          { values: [0.3, 0.4], statistics: { token_count: 1 } },
        ],
        count: 2,
        model: 'gemini-embedding-001',
      })
    })

    it('maps the friendly task type and passes output dimensionality', async () => {
      mock.onPost(url).reply({ predictions: [{ embeddings: { values: [0.1] } }] })

      await service.createEmbeddings('gemini-embedding-001', ['q'], 'Retrieval Document', 768)

      expect(mock.history[0].body).toEqual({
        instances: [{ content: 'q', task_type: 'RETRIEVAL_DOCUMENT' }],
        parameters: { outputDimensionality: 768 },
      })
    })

    it('defaults statistics to null when the model omits them', async () => {
      mock.onPost(url).reply({ predictions: [{ embeddings: { values: [0.5] } }] })

      const result = await service.createEmbeddings('gemini-embedding-001', ['q'])

      expect(result.embeddings[0]).toEqual({ values: [0.5], statistics: null })
    })

    it('throws when no texts are provided', async () => {
      await expect(service.createEmbeddings('gemini-embedding-001', [])).rejects.toThrow(
        'At least one text is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the model returns no embedding', async () => {
      mock.onPost(url).reply({ predictions: [{}] })

      await expect(service.createEmbeddings('gemini-embedding-001', ['q'])).rejects.toThrow(
        'The embedding model did not return an embedding'
      )
    })

    it('wraps API errors', async () => {
      mock.onPost(url).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Permission denied' } },
      })

      await expect(service.createEmbeddings('gemini-embedding-001', ['q'])).rejects.toThrow(
        'Vertex AI API error: Permission denied'
      )
    })
  })

  // ── Generate Image ──

  describe('generateImage', () => {
    const url = `${ BASE }/publishers/google/models/imagen-4.0-generate-001:predict`

    it('posts default parameters, saves images to storage and returns URLs', async () => {
      mock.onPost(url).reply({
        predictions: [
          { bytesBase64Encoded: Buffer.from('img-a').toString('base64'), mimeType: 'image/png' },
        ],
      })
      service.flowrunner.Files.uploadFile.mockResolvedValue({
        url: 'https://files.flowrunner.com/flow/imagen_0.png',
      })

      const result = await service.generateImage('imagen-4.0-generate-001', 'A cat')

      expect(mock.history[0].body).toEqual({
        instances: [{ prompt: 'A cat' }],
        parameters: { sampleCount: 1 },
      })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)

      const [buffer, options] = service.flowrunner.Files.uploadFile.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('img-a')
      expect(options).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      expect(options.filename).toMatch(/^imagen_\d+_0\.png$/)

      expect(result).toEqual({
        fileURLs: ['https://files.flowrunner.com/flow/imagen_0.png'],
        count: 1,
        model: 'imagen-4.0-generate-001',
      })
    })

    it('passes sampleCount, aspectRatio, negativePrompt and honors file options scope', async () => {
      mock.onPost(url).reply({
        predictions: [
          { bytesBase64Encoded: Buffer.from('one').toString('base64'), mimeType: 'image/png' },
          { bytesBase64Encoded: Buffer.from('two').toString('base64'), mimeType: 'image/jpeg' },
        ],
      })
      service.flowrunner.Files.uploadFile
        .mockResolvedValueOnce({ url: 'https://files/0.png' })
        .mockResolvedValueOnce({ url: 'https://files/1.jpeg' })

      const result = await service.generateImage(
        'imagen-4.0-generate-001', 'A dog', 2, '16:9', 'blurry', { scope: 'WORKSPACE' }
      )

      expect(mock.history[0].body).toEqual({
        instances: [{ prompt: 'A dog' }],
        parameters: { sampleCount: 2, aspectRatio: '16:9', negativePrompt: 'blurry' },
      })
      expect(service.flowrunner.Files.uploadFile.mock.calls[0][1]).toMatchObject({ scope: 'WORKSPACE' })
      expect(result.fileURLs).toEqual(['https://files/0.png', 'https://files/1.jpeg'])
      expect(result.count).toBe(2)
    })

    it('throws with the RAI filter reason when no image is returned', async () => {
      mock.onPost(url).reply({
        predictions: [{ raiFilteredReason: 'Unsafe prompt' }],
      })

      await expect(service.generateImage('imagen-4.0-generate-001', 'x')).rejects.toThrow(
        'No image was returned by the model (filtered: Unsafe prompt)'
      )
    })

    it('throws a generic message when nothing is returned and no filter reason', async () => {
      mock.onPost(url).reply({ predictions: [] })

      await expect(service.generateImage('imagen-4.0-generate-001', 'x')).rejects.toThrow(
        'No image was returned by the model'
      )
    })

    it('wraps API errors', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid model' } },
      })

      await expect(service.generateImage('imagen-4.0-generate-001', 'x')).rejects.toThrow(
        'Vertex AI API error: Invalid model'
      )
    })
  })

  // ── Call Partner Model ──

  describe('callPartnerModel', () => {
    it('posts the raw body to the publisher rawPredict endpoint and returns it verbatim', async () => {
      const url = `${ BASE }/publishers/anthropic/models/claude-sonnet-4-5@20250929:rawPredict`
      const requestBody = {
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      }
      const apiResponse = {
        id: 'msg_01',
        type: 'message',
        content: [{ type: 'text', text: 'Hi!' }],
      }

      mock.onPost(url).reply(apiResponse)

      const result = await service.callPartnerModel(
        'anthropic', 'claude-sonnet-4-5@20250929', requestBody
      )

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual(requestBody)
      expect(result).toEqual(apiResponse)
    })

    it('url-encodes the publisher segment', async () => {
      const url = `${ BASE }/publishers/ai21%20labs/models/jamba:rawPredict`

      mock.onPost(url).reply({ ok: true })

      await service.callPartnerModel('ai21 labs', 'jamba', { messages: [] })

      expect(mock.history[0].url).toBe(url)
    })

    it('wraps API errors', async () => {
      const url = `${ BASE }/publishers/meta/models/llama:rawPredict`

      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Model unavailable' } },
      })

      await expect(service.callPartnerModel('meta', 'llama', {})).rejects.toThrow(
        'Vertex AI API error: Model unavailable'
      )
    })
  })

  // ── Predict ──

  describe('predict', () => {
    it('treats a bare model id as a google publisher model', async () => {
      const url = `${ BASE }/publishers/google/models/text-embedding-005:predict`

      mock.onPost(url).reply({ predictions: [{ embeddings: {} }] })

      await service.predict('text-embedding-005', [{ content: 'hi' }])

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({ instances: [{ content: 'hi' }] })
    })

    it('passes an endpoint resource path through verbatim with parameters', async () => {
      const url = `${ BASE }/endpoints/1234567890:predict`

      mock.onPost(url).reply({ predictions: [{ score: 0.9 }] })

      await service.predict('endpoints/1234567890', [{ f1: 1 }], { threshold: 0.5 })

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({
        instances: [{ f1: 1 }],
        parameters: { threshold: 0.5 },
      })
    })

    it('passes a full publisher path through verbatim', async () => {
      const url = `${ BASE }/publishers/google/models/text-bison:predict`

      mock.onPost(url).reply({ predictions: [] })

      await service.predict('publishers/google/models/text-bison', [{ content: 'x' }])

      expect(mock.history[0].url).toBe(url)
    })

    it('throws when no instances are provided', async () => {
      await expect(service.predict('some-model', [])).rejects.toThrow(
        'At least one instance is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      const url = `${ BASE }/publishers/google/models/m:predict`

      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { message: 'Prediction failed' },
      })

      await expect(service.predict('m', [{ content: 'x' }])).rejects.toThrow(
        'Vertex AI API error: Prediction failed'
      )
    })
  })
})
