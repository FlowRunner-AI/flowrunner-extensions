'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('HeyGen Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('heygen')
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

  // ── Account & Brand ──

  describe('getCurrentUser', () => {
    it('returns user info with expected shape', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('username')
      expect(result).toHaveProperty('email')
    })
  })

  describe('listBrandKits', () => {
    it('returns paginated list', async () => {
      const result = await service.listBrandKits(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('listBrandGlossaries', () => {
    it('returns paginated list', async () => {
      const result = await service.listBrandGlossaries(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Voices & Audio ──

  describe('listVoices', () => {
    it('returns voices with expected shape', async () => {
      const result = await service.listVoices('Public', undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('voice_id')
        expect(result.data[0]).toHaveProperty('name')
      }
    })
  })

  describe('searchAudioLibrary', () => {
    it('returns music results', async () => {
      const result = await service.searchAudioLibrary('upbeat', 'Music', 3)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Avatars ──

  describe('listAvatarGroups', () => {
    it('returns avatar groups', async () => {
      const result = await service.listAvatarGroups('Public', 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('id')
        expect(result.data[0]).toHaveProperty('name')
      }
    })
  })

  describe('listAvatarLooks', () => {
    it('returns avatar looks', async () => {
      const result = await service.listAvatarLooks(undefined, undefined, 'Public', 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('id')
        expect(result.data[0]).toHaveProperty('name')
      }
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('returns paginated template list', async () => {
      const result = await service.listTemplates(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Videos ──

  describe('listVideos', () => {
    it('returns paginated video list', async () => {
      const result = await service.listVideos(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Lipsync ──

  describe('listLipsyncs', () => {
    it('returns paginated lipsync list', async () => {
      const result = await service.listLipsyncs(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Video Translation ──

  describe('listVideoTranslations', () => {
    it('returns paginated translation list', async () => {
      const result = await service.listVideoTranslations(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('listTranslationTargetLanguages', () => {
    it('returns supported languages', async () => {
      const result = await service.listTranslationTargetLanguages()

      expect(result).toHaveProperty('languages')
      expect(Array.isArray(result.languages)).toBe(true)
      expect(result.languages.length).toBeGreaterThan(0)
    })
  })

  // ── Video Agent ──

  describe('listVideoAgentSessions', () => {
    it('returns paginated sessions list', async () => {
      const result = await service.listVideoAgentSessions(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('listVideoAgentStyles', () => {
    it('returns styles list', async () => {
      const result = await service.listVideoAgentStyles(undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── AI Clipping ──

  describe('listAiClippingJobs', () => {
    it('returns paginated jobs list', async () => {
      const result = await service.listAiClippingJobs(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Background Removal ──

  describe('listBackgroundRemovals', () => {
    it('returns paginated list', async () => {
      const result = await service.listBackgroundRemovals(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── HyperFrames ──

  describe('listHyperframesRenders', () => {
    it('returns paginated renders list', async () => {
      const result = await service.listHyperframesRenders(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Webhooks ──

  describe('listWebhookEndpoints', () => {
    it('returns paginated endpoints list', async () => {
      const result = await service.listWebhookEndpoints(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('listWebhookEventTypes', () => {
    it('returns event types', async () => {
      const result = await service.listWebhookEventTypes()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Workflows ──

  describe('listWorkflows', () => {
    it('returns available workflow types', async () => {
      const result = await service.listWorkflows()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('avatarLooksDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.avatarLooksDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('voicesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.voicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('targetLanguagesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.targetLanguagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })
})
