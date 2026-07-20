'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Deepgram Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('deepgram')
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

  const suffix = Date.now()

  // Resolved in the Projects describe below and reused by usage/billing/models.
  let projectId

  // ── Models (public catalog, no project required) ──

  describe('listModels', () => {
    it('returns stt and tts model catalogs', async () => {
      const response = await service.listModels('All')

      expect(response).toHaveProperty('stt')
      expect(response).toHaveProperty('tts')
      expect(Array.isArray(response.stt)).toBe(true)
      expect(Array.isArray(response.tts)).toBe(true)
    })

    it('returns only stt models when filtered', async () => {
      const response = await service.listModels('Speech to Text')

      expect(response).toHaveProperty('stt')
      expect(response).not.toHaveProperty('tts')
    })
  })

  describe('getModel', () => {
    it('retrieves a model by uuid discovered from listModels', async () => {
      const catalog = await service.listModels('Speech to Text')

      if (!catalog.stt.length) {
        console.log('Skipping getModel: no STT models available')
        return
      }

      const uuid = catalog.stt[0].uuid
      const response = await service.getModel(uuid)

      expect(response).toHaveProperty('uuid', uuid)
      expect(response).toHaveProperty('canonical_name')
    })
  })

  describe('getSttModelsDictionary', () => {
    it('returns dictionary items array including aliases', async () => {
      const result = await service.getSttModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['nova-3', 'nova-2', 'enhanced', 'base'])
      )
    })
  })

  describe('getTtsVoicesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTtsVoicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns projects and captures a project id for later tests', async () => {
      const response = await service.listProjects()

      expect(response).toHaveProperty('projects')
      expect(Array.isArray(response.projects)).toBe(true)

      // Prefer a developer-supplied project id, else the first available one.
      projectId = testValues.projectId || (response.projects[0] && response.projects[0].project_id)
    })
  })

  describe('getProject', () => {
    it('retrieves the resolved project', async () => {
      if (!projectId) {
        console.log('Skipping getProject: no project id available')
        return
      }

      const response = await service.getProject(projectId)

      expect(response).toHaveProperty('project_id', projectId)
      expect(response).toHaveProperty('name')
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listProjectModels', () => {
    it('returns models available to the project', async () => {
      if (!projectId) {
        console.log('Skipping listProjectModels: no project id available')
        return
      }

      const response = await service.listProjectModels(projectId)

      expect(response).toHaveProperty('stt')
      expect(response).toHaveProperty('tts')
    })
  })

  // ── API Keys ──

  describe('listApiKeys', () => {
    it('returns api keys with expected shape', async () => {
      if (!projectId) {
        console.log('Skipping listApiKeys: no project id available')
        return
      }

      const response = await service.listApiKeys(projectId)

      expect(response).toHaveProperty('api_keys')
      expect(Array.isArray(response.api_keys)).toBe(true)
    })
  })

  describe('getProjectKeysDictionary', () => {
    it('returns dictionary items array for the project', async () => {
      if (!projectId) {
        console.log('Skipping getProjectKeysDictionary: no project id available')
        return
      }

      const result = await service.getProjectKeysDictionary({ criteria: { projectId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createApiKey + deleteApiKey', () => {
    // Creating a key requires the configured API key to have the keys:write
    // scope, so this lifecycle only runs when the developer opts in.
    const canManageKeys = () => Boolean(projectId && testValues.manageApiKeys === true)
    let createdKeyId

    it('creates an api key', async () => {
      if (!canManageKeys()) {
        console.log('Skipping createApiKey: set testValues.manageApiKeys to true (needs keys:write scope)')
        return
      }

      const response = await service.createApiKey(
        projectId,
        `e2e-test-key-${ suffix }`,
        ['usage:read'],
        ['e2e'],
        undefined,
        3600
      )

      expect(response).toHaveProperty('api_key_id')
      createdKeyId = response.api_key_id
    })

    it('deletes the created api key', async () => {
      if (!canManageKeys() || !createdKeyId) {
        console.log('Skipping deleteApiKey: no key created')
        return
      }

      const response = await service.deleteApiKey(projectId, createdKeyId)

      expect(response).toBeDefined()
    })
  })

  // ── Usage ──

  describe('getUsageSummary', () => {
    it('returns aggregated usage for the project', async () => {
      if (!projectId) {
        console.log('Skipping getUsageSummary: no project id available')
        return
      }

      const response = await service.getUsageSummary(projectId)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getUsageBreakdown', () => {
    it('returns a usage breakdown for the project', async () => {
      if (!projectId) {
        console.log('Skipping getUsageBreakdown: no project id available')
        return
      }

      const response = await service.getUsageBreakdown(projectId)

      expect(response).toHaveProperty('results')
    })
  })

  describe('listUsageFields', () => {
    it('returns usage fields for the project', async () => {
      if (!projectId) {
        console.log('Skipping listUsageFields: no project id available')
        return
      }

      const response = await service.listUsageFields(projectId)

      expect(response).toBeDefined()
      expect(typeof response).toBe('object')
    })
  })

  describe('listUsageRequests', () => {
    let firstRequestId

    it('returns a page of usage requests', async () => {
      if (!projectId) {
        console.log('Skipping listUsageRequests: no project id available')
        return
      }

      const response = await service.listUsageRequests(projectId, undefined, undefined, 5)

      expect(response).toHaveProperty('requests')
      expect(Array.isArray(response.requests)).toBe(true)

      if (response.requests.length) {
        firstRequestId = response.requests[0].request_id
      }
    })

    it('retrieves a single usage request by id', async () => {
      if (!projectId || !firstRequestId) {
        console.log('Skipping getUsageRequest: no usage requests available')
        return
      }

      const response = await service.getUsageRequest(projectId, firstRequestId)

      expect(response).toHaveProperty('request_id', firstRequestId)
    })
  })

  // ── Billing ──

  describe('listBalances', () => {
    let firstBalanceId

    it('returns balances for the project', async () => {
      if (!projectId) {
        console.log('Skipping listBalances: no project id available')
        return
      }

      const response = await service.listBalances(projectId)

      expect(response).toHaveProperty('balances')
      expect(Array.isArray(response.balances)).toBe(true)

      if (response.balances.length) {
        firstBalanceId = response.balances[0].balance_id
      }
    })

    it('retrieves a single balance by id', async () => {
      if (!projectId || !firstBalanceId) {
        console.log('Skipping getBalance: no balances available')
        return
      }

      const response = await service.getBalance(projectId, firstBalanceId)

      expect(response).toHaveProperty('balance_id', firstBalanceId)
    })
  })

  // ── Speech to Text (consumes credits; opt-in via test values) ──

  describe('transcribeAudioFromUrl', () => {
    // Needs a publicly accessible audio URL supplied by the developer.
    const canTranscribe = () => Boolean(testValues.audioUrl)

    it('transcribes audio from a public URL', async () => {
      if (!canTranscribe()) {
        console.log('Skipping transcribeAudioFromUrl: set testValues.audioUrl to a public audio URL')
        return
      }

      const response = await service.transcribeAudioFromUrl(
        testValues.audioUrl,
        'nova-3',
        undefined,
        undefined,
        true // smartFormat
      )

      expect(response).toHaveProperty('metadata')
      expect(response).toHaveProperty('results')
    })
  })

  // ── Text Intelligence (consumes credits) ──

  describe('analyzeText', () => {
    it('summarizes provided text', async () => {
      const response = await service.analyzeText(
        'Deepgram provides fast and accurate speech-to-text and text-to-speech APIs for developers.',
        undefined,
        true // summarize
      )

      expect(response).toHaveProperty('metadata')
      expect(response).toHaveProperty('results')
    })
  })

  // ── Text to Speech (consumes credits; writes to file storage) ──

  describe('textToSpeech', () => {
    // The non-callback path uploads audio to FlowRunner file storage, which is
    // only available in the FlowRunner runtime. Outside it, run this only when
    // the developer supplies a callback URL so no file upload is attempted.
    const canRunAsync = () => Boolean(testValues.ttsCallbackUrl)

    it('generates speech asynchronously when a callback URL is configured', async () => {
      if (!canRunAsync()) {
        console.log('Skipping textToSpeech: set testValues.ttsCallbackUrl to run the async (callback) path')
        return
      }

      const response = await service.textToSpeech(
        'Hello from the Deepgram end to end test.',
        undefined,
        undefined,
        undefined,
        undefined,
        testValues.ttsCallbackUrl
      )

      expect(response).toHaveProperty('request_id')
    })
  })
})
