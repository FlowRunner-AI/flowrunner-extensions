'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ElevenLabs Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('elevenlabs')
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

  describe('getUserInfo', () => {
    it('returns account info with a subscription block', async () => {
      const response = await service.getUserInfo()

      expect(response).toHaveProperty('subscription')
      expect(response.subscription).toHaveProperty('character_limit')
    })
  })

  // ── Voices ──

  describe('getVoices', () => {
    it('returns voices with expected shape', async () => {
      const response = await service.getVoices()

      expect(response).toHaveProperty('voices')
      expect(Array.isArray(response.voices)).toBe(true)
    })
  })

  describe('getVoice', () => {
    it('returns details for the first available voice', async () => {
      const { voices } = await service.getVoices()

      if (!voices || voices.length === 0) {
        console.log('Skipping getVoice: account has no voices')
        return
      }

      const response = await service.getVoice(voices[0].voice_id)

      expect(response).toHaveProperty('voice_id', voices[0].voice_id)
      expect(response).toHaveProperty('name')
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('filters voices by a search term without error', async () => {
      const result = await service.getVoicesDictionary({ search: 'zzzz-no-match' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Models ──

  describe('getModels', () => {
    it('returns a models array', async () => {
      const response = await service.getModels()

      expect(Array.isArray(response)).toBe(true)
      if (response.length > 0) {
        expect(response[0]).toHaveProperty('model_id')
      }
    })
  })

  describe('getModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── History ──

  describe('getHistory', () => {
    it('returns a history payload', async () => {
      const response = await service.getHistory(5)

      expect(response).toHaveProperty('history')
      expect(Array.isArray(response.history)).toBe(true)
    })
  })

  // ── Speech to Text ──

  describe('speechToText', () => {
    // Requires a publicly accessible audio file URL, supplied by the developer.
    it('transcribes an audio file when a URL is configured', async () => {
      if (!testValues.audioFileUrl) {
        console.log('Skipping speechToText: set testValues.audioFileUrl to a public audio URL')
        return
      }

      const response = await service.speechToText(testValues.audioFileUrl, 'scribe_v1')

      expect(response).toHaveProperty('text')
    })
  })

  // ── Professional Voice Clone lifecycle (metadata only, no Files API) ──

  describe('createVoicePVC + deleteVoice', () => {
    // PVC creation requires an eligible subscription tier. Gated so free
    // accounts are not failed by an expected 403.
    let voiceId

    it('creates a professional voice clone when enabled', async () => {
      if (!testValues.canCreatePVC) {
        console.log('Skipping createVoicePVC: set testValues.canCreatePVC=true on an eligible plan')
        return
      }

      const response = await service.createVoicePVC(`E2E PVC ${ suffix }`, 'en')

      expect(response).toHaveProperty('voice_id')
      voiceId = response.voice_id
    })

    it('deletes the created professional voice clone', async () => {
      if (!voiceId) {
        console.log('Skipping deleteVoice: no PVC was created')
        return
      }

      const response = await service.deleteVoice(voiceId)

      expect(response).toEqual({
        success: true,
        voiceId,
        message: 'Voice deleted successfully',
      })
    })
  })

  // ── File-producing methods (require runtime Files API) ──

  // textToSpeech, textToSoundEffects, designVoice and getHistoryItemAudio call
  // this.flowrunner.Files.uploadFile, which is injected by the FlowRunner runtime
  // and is not available in the e2e sandbox. They are covered by the unit tests
  // (with a stubbed Files API) and validated in-platform, so they are intentionally
  // not exercised here.
  describe('file-producing methods', () => {
    it('are covered by unit tests and validated in FlowRunner (Files API not sandboxed)', () => {
      expect(typeof service.textToSpeech).toBe('function')
      expect(typeof service.textToSoundEffects).toBe('function')
      expect(typeof service.designVoice).toBe('function')
      expect(typeof service.getHistoryItemAudio).toBe('function')
    })
  })
})
