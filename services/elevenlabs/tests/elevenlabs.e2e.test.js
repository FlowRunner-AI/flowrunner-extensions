'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ElevenLabs Service (e2e)', () => {
  let sandbox
  let service

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
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getUserInfo', () => {
    it('returns user info with expected shape', async () => {
      const result = await service.getUserInfo()

      expect(result).toHaveProperty('user_id')
      expect(result).toHaveProperty('subscription')
      expect(result.subscription).toHaveProperty('tier')
      expect(result.subscription).toHaveProperty('character_count')
      expect(result.subscription).toHaveProperty('character_limit')
    })
  })

  // ── Voice Management ──

  describe('getVoices', () => {
    it('returns voices with expected shape', async () => {
      const result = await service.getVoices()

      expect(result).toHaveProperty('voices')
      expect(Array.isArray(result.voices)).toBe(true)
      expect(result.voices.length).toBeGreaterThan(0)
      expect(result.voices[0]).toHaveProperty('voice_id')
      expect(result.voices[0]).toHaveProperty('name')
    })
  })

  describe('getVoice', () => {
    it('returns details for a specific voice', async () => {
      const voices = await service.getVoices()
      const firstVoiceId = voices.voices[0].voice_id

      const result = await service.getVoice(firstVoiceId)

      expect(result).toHaveProperty('voice_id', firstVoiceId)
      expect(result).toHaveProperty('name')
    })
  })

  // ── Models ──

  describe('getModels', () => {
    it('returns models list with expected shape', async () => {
      const result = await service.getModels()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('model_id')
      expect(result[0]).toHaveProperty('name')
    })
  })

  // ── Dictionaries ──

  describe('getVoicesDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters results by search string', async () => {
      const all = await service.getVoicesDictionary({})
      const firstName = all.items[0].label.split(' ')[0]

      const filtered = await service.getVoicesDictionary({ search: firstName })

      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
      expect(filtered.items.length).toBeGreaterThan(0)
    })
  })

  describe('getModelsDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })
  })

  // ── History ──

  describe('getHistory', () => {
    it('returns history with expected shape', async () => {
      const result = await service.getHistory(5)

      expect(result).toHaveProperty('history')
      expect(Array.isArray(result.history)).toBe(true)
      expect(result).toHaveProperty('has_more')
    })
  })

  // ── PVC Voice Create ──

  describe('createVoicePVC + deleteVoice', () => {
    let createdVoiceId

    it('creates a PVC voice', async () => {
      const result = await service.createVoicePVC('E2E Test Voice PVC', 'en', 'E2E test voice')

      expect(result).toHaveProperty('voice_id')
      createdVoiceId = result.voice_id
    })

    it('deletes the created PVC voice', async () => {
      if (!createdVoiceId) {
        throw new Error('No voice was created to delete')
      }

      const result = await service.deleteVoice(createdVoiceId)

      expect(result).toEqual({
        success: true,
        voiceId: createdVoiceId,
        message: 'Voice deleted successfully',
      })
    })
  })
})
