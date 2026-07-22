'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-runway-api-key'
const BASE = 'https://api.dev.runwayml.com/v1'

describe('Runway Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Helpers: Auth headers ──

  function expectAuthHeaders(callRecord) {
    expect(callRecord.headers).toMatchObject({
      'Authorization': `Bearer ${API_KEY}`,
      'X-Runway-Version': '2024-11-06',
      'Content-Type': 'application/json',
    })
  }

  // ── Image Generation ──

  describe('generateImage', () => {
    it('sends correct POST for Gen-4 Image with defaults', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-1' })
      mock.onGet(`${BASE}/tasks/task-1`).reply({ id: 'task-1', status: 'SUCCEEDED', output: [] })

      const result = await service.generateImage(
        'Gen-4 Image', 'A sunset over mountains', '1920:1080'
      )

      expect(result.status).toBe('SUCCEEDED')
      const postCall = mock.history.find(c => c.method === 'post')
      expectAuthHeaders(postCall)
      expect(postCall.body).toMatchObject({
        model: 'gen4_image',
        promptText: 'A sunset over mountains',
        ratio: '1920:1080',
      })
    })

    it('sends only allowed fields for GPT Image 2', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-2' })
      mock.onGet(`${BASE}/tasks/task-2`).reply({ id: 'task-2', status: 'SUCCEEDED', output: [] })

      await service.generateImage(
        'GPT Image 2', 'A cat', '2048:2048',
        undefined, undefined, 3, 'High', 'Auto'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'gpt_image_2',
        promptText: 'A cat',
        ratio: '2048:2048',
        outputCount: 3,
        quality: 'high',
        background: 'auto',
      })
      // GPT Image 2 does not support seed or contentModeration
      expect(postCall.body.seed).toBeUndefined()
      expect(postCall.body.contentModeration).toBeUndefined()
    })

    it('returns immediately when waitForCompletion is false', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-3' })

      const result = await service.generateImage(
        'Gen-4 Image', 'A test', '1024:1024',
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, false
      )

      expect(result).toEqual({ id: 'task-3', status: 'PENDING' })
      expect(mock.history).toHaveLength(1)
    })

    it('throws on unknown model', async () => {
      await expect(
        service.generateImage('Unknown Model', 'test', '1024:1024')
      ).rejects.toThrow('Unknown image model')
    })

    it('includes referenceImages when provided', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-ref' })
      mock.onGet(`${BASE}/tasks/task-ref`).reply({ id: 'task-ref', status: 'SUCCEEDED', output: [] })

      await service.generateImage(
        'Gen-4 Image', 'A @style test', '1024:1024',
        [{ uri: 'https://example.com/img.png', tag: 'style' }]
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.referenceImages).toEqual([
        { uri: 'https://example.com/img.png', tag: 'style' },
      ])
    })

    it('includes contentModeration for Gen-4 Image with publicFigureThreshold', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-cm' })
      mock.onGet(`${BASE}/tasks/task-cm`).reply({ id: 'task-cm', status: 'SUCCEEDED', output: [] })

      await service.generateImage(
        'Gen-4 Image', 'A portrait', '1024:1024',
        undefined, undefined, undefined, undefined, undefined,
        undefined, 'Low'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.contentModeration).toEqual({ publicFigureThreshold: 'low' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/text_to_image`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid prompt' },
      })

      await expect(
        service.generateImage('Gen-4 Image', '', '1024:1024')
      ).rejects.toThrow('Runway API error')
    })
  })

  describe('upscaleImage', () => {
    it('sends correct POST with scale factor', async () => {
      mock.onPost(`${BASE}/image_upscale`).reply({ id: 'task-up' })
      mock.onGet(`${BASE}/tasks/task-up`).reply({ id: 'task-up', status: 'SUCCEEDED', output: [] })

      await service.upscaleImage('https://example.com/img.png', '4x', 50, 30, 70, 'Photo')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'magnific_precision_upscaler_v2',
        imageUri: 'https://example.com/img.png',
        scaleFactor: 4,
        sharpen: 50,
        smartGrain: 30,
        ultraDetail: 70,
        flavor: 'photo',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/image_upscale`).reply({ id: 'task-up2' })
      mock.onGet(`${BASE}/tasks/task-up2`).reply({ id: 'task-up2', status: 'SUCCEEDED', output: [] })

      await service.upscaleImage('https://example.com/img.png')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({
        model: 'magnific_precision_upscaler_v2',
        imageUri: 'https://example.com/img.png',
      })
    })
  })

  // ── Video Generation ──

  describe('imageToVideo', () => {
    it('sends correct POST for Gen-4.5', async () => {
      mock.onPost(`${BASE}/image_to_video`).reply({ id: 'task-itv' })
      mock.onGet(`${BASE}/tasks/task-itv`).reply({ id: 'task-itv', status: 'SUCCEEDED', output: [] })

      await service.imageToVideo(
        'Gen-4.5', 'https://example.com/img.png', 'Camera pans left', '1280:720', 7
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'gen4.5',
        promptImage: 'https://example.com/img.png',
        promptText: 'Camera pans left',
        ratio: '1280:720',
        duration: 7,
      })
    })

    it('defaults duration for gen4.5 when omitted', async () => {
      mock.onPost(`${BASE}/image_to_video`).reply({ id: 'task-itv2' })
      mock.onGet(`${BASE}/tasks/task-itv2`).reply({ id: 'task-itv2', status: 'SUCCEEDED', output: [] })

      await service.imageToVideo('Gen-4.5', 'https://example.com/img.png', 'pan')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.duration).toBe(5)
    })

    it('forces duration 8 for Veo 3', async () => {
      mock.onPost(`${BASE}/image_to_video`).reply({ id: 'task-itv3' })
      mock.onGet(`${BASE}/tasks/task-itv3`).reply({ id: 'task-itv3', status: 'SUCCEEDED', output: [] })

      await service.imageToVideo('Veo 3', 'https://example.com/img.png', 'test', undefined, 4)

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.duration).toBe(8)
    })

    it('throws on unknown model', async () => {
      await expect(
        service.imageToVideo('Nonexistent', 'https://example.com/img.png')
      ).rejects.toThrow('Unknown image-to-video model')
    })

    it('includes referenceAudio for Seedance 2', async () => {
      mock.onPost(`${BASE}/image_to_video`).reply({ id: 'task-itv-ref' })
      mock.onGet(`${BASE}/tasks/task-itv-ref`).reply({ id: 'task-itv-ref', status: 'SUCCEEDED', output: [] })

      await service.imageToVideo(
        'Seedance 2', 'https://example.com/img.png', 'motion',
        undefined, undefined, undefined, undefined, undefined, undefined,
        ['https://example.com/audio.mp3']
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.referenceAudio).toEqual([
        { uri: 'https://example.com/audio.mp3', type: 'audio' },
      ])
    })
  })

  describe('textToVideo', () => {
    it('sends correct POST for Gen-4.5', async () => {
      mock.onPost(`${BASE}/text_to_video`).reply({ id: 'task-ttv' })
      mock.onGet(`${BASE}/tasks/task-ttv`).reply({ id: 'task-ttv', status: 'SUCCEEDED', output: [] })

      await service.textToVideo('Gen-4.5', 'A cat running', '1280:720', 5, 42)

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'gen4.5',
        promptText: 'A cat running',
        ratio: '1280:720',
        duration: 5,
        seed: 42,
      })
    })

    it('includes reference media for Seedance 2', async () => {
      mock.onPost(`${BASE}/text_to_video`).reply({ id: 'task-ttv2' })
      mock.onGet(`${BASE}/tasks/task-ttv2`).reply({ id: 'task-ttv2', status: 'SUCCEEDED', output: [] })

      await service.textToVideo(
        'Seedance 2', 'A test', undefined, undefined, undefined, true, undefined,
        ['https://example.com/ref.png'],
        ['https://example.com/ref.mp4'],
        ['https://example.com/audio.mp3']
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.references).toEqual([{ uri: 'https://example.com/ref.png' }])
      expect(postCall.body.referenceVideos).toEqual([{ uri: 'https://example.com/ref.mp4', type: 'video' }])
      expect(postCall.body.referenceAudio).toEqual([{ uri: 'https://example.com/audio.mp3', type: 'audio' }])
    })

    it('throws on unknown model', async () => {
      await expect(
        service.textToVideo('Fake Model', 'test')
      ).rejects.toThrow('Unknown text-to-video model')
    })
  })

  describe('videoToVideo', () => {
    it('sends correct POST for Aleph 2', async () => {
      mock.onPost(`${BASE}/video_to_video`).reply({ id: 'task-vtv' })
      mock.onGet(`${BASE}/tasks/task-vtv`).reply({ id: 'task-vtv', status: 'SUCCEEDED', output: [] })

      await service.videoToVideo(
        'Aleph 2', 'https://example.com/video.mp4', 'Make it look like a painting',
        undefined, '16:9',
        [{ uri: 'https://example.com/kf.png', seconds: 2 }]
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'aleph2',
        videoUri: 'https://example.com/video.mp4',
        promptText: 'Make it look like a painting',
        targetAspectRatio: '16:9',
        keyframes: [{ uri: 'https://example.com/kf.png', seconds: 2 }],
      })
    })

    it('sends promptVideo for Seedance 2 models', async () => {
      mock.onPost(`${BASE}/video_to_video`).reply({ id: 'task-vtv2' })
      mock.onGet(`${BASE}/tasks/task-vtv2`).reply({ id: 'task-vtv2', status: 'SUCCEEDED', output: [] })

      await service.videoToVideo(
        'Seedance 2', 'https://example.com/video.mp4', 'restyle',
        '1280:720'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.promptVideo).toBe('https://example.com/video.mp4')
      expect(postCall.body.model).toBe('seedance2')
    })

    it('throws on unknown model', async () => {
      await expect(
        service.videoToVideo('Bad Model', 'https://example.com/video.mp4')
      ).rejects.toThrow('Unknown video-to-video model')
    })
  })

  describe('upscaleVideo', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/video_upscale`).reply({ id: 'task-vu' })
      mock.onGet(`${BASE}/tasks/task-vu`).reply({ id: 'task-vu', status: 'SUCCEEDED', output: [] })

      await service.upscaleVideo('https://example.com/v.mp4', '4K', 50, 30, 20, 'Vivid', true)

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'magnific_video_upscaler_creative',
        videoUri: 'https://example.com/v.mp4',
        resolution: '4k',
        creativity: 50,
        sharpen: 30,
        smartGrain: 20,
        flavor: 'vivid',
        fpsBoost: true,
      })
    })
  })

  describe('characterPerformance', () => {
    it('sends correct POST with image character', async () => {
      mock.onPost(`${BASE}/character_performance`).reply({ id: 'task-cp' })
      mock.onGet(`${BASE}/tasks/task-cp`).reply({ id: 'task-cp', status: 'SUCCEEDED', output: [] })

      await service.characterPerformance(
        'Image', 'https://example.com/char.png', 'https://example.com/ref.mp4',
        '1280:720', true, 4
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'act_two',
        character: { type: 'image', uri: 'https://example.com/char.png' },
        reference: { type: 'video', uri: 'https://example.com/ref.mp4' },
        ratio: '1280:720',
        bodyControl: true,
        expressionIntensity: 4,
      })
    })

    it('sends video character type', async () => {
      mock.onPost(`${BASE}/character_performance`).reply({ id: 'task-cp2' })
      mock.onGet(`${BASE}/tasks/task-cp2`).reply({ id: 'task-cp2', status: 'SUCCEEDED', output: [] })

      await service.characterPerformance(
        'Video', 'https://example.com/char.mp4', 'https://example.com/ref.mp4'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.character.type).toBe('video')
    })
  })

  // ── Audio Generation ──

  describe('generateSoundEffect', () => {
    it('sends correct POST for Eleven model', async () => {
      mock.onPost(`${BASE}/sound_effect`).reply({ id: 'task-se' })
      mock.onGet(`${BASE}/tasks/task-se`).reply({ id: 'task-se', status: 'SUCCEEDED', output: [] })

      await service.generateSoundEffect(
        'Eleven Text to Sound v2', 'Thunder rolling', 10, true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'eleven_text_to_sound_v2',
        promptText: 'Thunder rolling',
        duration: 10,
        loop: true,
      })
    })

    it('sends correct POST for Seed Audio model with audio params', async () => {
      mock.onPost(`${BASE}/sound_effect`).reply({ id: 'task-se2' })
      mock.onGet(`${BASE}/tasks/task-se2`).reply({ id: 'task-se2', status: 'SUCCEEDED', output: [] })

      await service.generateSoundEffect(
        'Seed Audio', 'Ocean waves', undefined, undefined,
        ['https://example.com/ref.mp3'], 10, 20, -5, '48 kHz', 'WAV'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'seed_audio',
        promptText: 'Ocean waves',
        referenceAudios: ['https://example.com/ref.mp3'],
        speechRate: 10,
        loudnessRate: 20,
        pitchRate: -5,
        sampleRate: 48000,
        outputFormat: 'wav',
      })
    })
  })

  describe('textToSpeech', () => {
    it('sends correct POST for Eleven Multilingual v2', async () => {
      mock.onPost(`${BASE}/text_to_speech`).reply({ id: 'task-tts' })
      mock.onGet(`${BASE}/tasks/task-tts`).reply({ id: 'task-tts', status: 'SUCCEEDED', output: [] })

      await service.textToSpeech('Eleven Multilingual v2', 'Hello world', 'Maya')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({
        model: 'eleven_multilingual_v2',
        promptText: 'Hello world',
        voice: { type: 'runway-preset', presetId: 'Maya' },
      })
    })

    it('throws when Eleven model is used without preset voice', async () => {
      await expect(
        service.textToSpeech('Eleven Multilingual v2', 'Hello')
      ).rejects.toThrow('Preset Voice is required')
    })

    it('sends correct POST for Seed Audio with voice cloning', async () => {
      mock.onPost(`${BASE}/text_to_speech`).reply({ id: 'task-tts2' })
      mock.onGet(`${BASE}/tasks/task-tts2`).reply({ id: 'task-tts2', status: 'SUCCEEDED', output: [] })

      await service.textToSpeech(
        'Seed Audio', 'Hello world', undefined, 'https://example.com/voice.mp3',
        10, 20, -3, '24 kHz', 'MP3'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'seed_audio',
        promptText: 'Hello world',
        voice: { type: 'reference-audio', audioUri: 'https://example.com/voice.mp3' },
        speechRate: 10,
        loudnessRate: 20,
        pitchRate: -3,
        sampleRate: 24000,
        outputFormat: 'mp3',
      })
    })
  })

  describe('speechToSpeech', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/speech_to_speech`).reply({ id: 'task-sts' })
      mock.onGet(`${BASE}/tasks/task-sts`).reply({ id: 'task-sts', status: 'SUCCEEDED', output: [] })

      await service.speechToSpeech(
        'Video', 'https://example.com/video.mp4', 'Bernard', true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'eleven_multilingual_sts_v2',
        media: { type: 'video', uri: 'https://example.com/video.mp4' },
        voice: { type: 'runway-preset', presetId: 'Bernard' },
        removeBackgroundNoise: true,
      })
    })
  })

  describe('dubAudio', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/voice_dubbing`).reply({ id: 'task-dub' })
      mock.onGet(`${BASE}/tasks/task-dub`).reply({ id: 'task-dub', status: 'SUCCEEDED', output: [] })

      await service.dubAudio(
        'https://example.com/audio.mp3', 'Spanish', true, false, 3
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'eleven_voice_dubbing',
        audioUri: 'https://example.com/audio.mp3',
        targetLang: 'es',
        disableVoiceCloning: true,
        numSpeakers: 3,
      })
    })
  })

  describe('isolateVoice', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/voice_isolation`).reply({ id: 'task-iso' })
      mock.onGet(`${BASE}/tasks/task-iso`).reply({ id: 'task-iso', status: 'SUCCEEDED', output: [] })

      await service.isolateVoice('https://example.com/noisy.mp3')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({
        model: 'eleven_voice_isolation',
        audioUri: 'https://example.com/noisy.mp3',
      })
    })
  })

  // ── Avatars ──

  describe('listAvatars', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/avatars`).reply({ data: [], hasMore: false, nextCursor: null })

      const result = await service.listAvatars()

      expect(result).toEqual({ data: [], hasMore: false, nextCursor: null })
      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes custom limit and cursor', async () => {
      mock.onGet(`${BASE}/avatars`).reply({ data: [], hasMore: false, nextCursor: null })

      await service.listAvatars(10, 'cur123')

      expect(mock.history[0].query).toMatchObject({ limit: 10, cursor: 'cur123' })
    })
  })

  describe('generateAvatarVideo', () => {
    it('sends correct POST with preset avatar and speech text', async () => {
      mock.onPost(`${BASE}/avatar_videos`).reply({ id: 'task-av' })
      mock.onGet(`${BASE}/tasks/task-av`).reply({ id: 'task-av', status: 'SUCCEEDED', output: [] })

      await service.generateAvatarVideo(
        'Game Character', undefined, 'Hello, I am your avatar', undefined, 'Victoria'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        model: 'gwm1_avatars',
        avatar: { type: 'runway-preset', presetId: 'game-character' },
        speech: {
          type: 'text',
          text: 'Hello, I am your avatar',
          voice: { type: 'preset', presetId: 'victoria' },
        },
      })
    })

    it('uses custom avatar and speech audio', async () => {
      mock.onPost(`${BASE}/avatar_videos`).reply({ id: 'task-av2' })
      mock.onGet(`${BASE}/tasks/task-av2`).reply({ id: 'task-av2', status: 'SUCCEEDED', output: [] })

      await service.generateAvatarVideo(
        undefined, 'custom-avatar-id', undefined, 'https://example.com/speech.mp3'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.avatar).toEqual({ type: 'custom', avatarId: 'custom-avatar-id' })
      expect(postCall.body.speech).toEqual({ type: 'audio', audio: 'https://example.com/speech.mp3' })
    })

    it('throws when no avatar is provided', async () => {
      await expect(
        service.generateAvatarVideo(undefined, undefined, 'Hello')
      ).rejects.toThrow('Provide either a Preset Avatar or a Custom Avatar id.')
    })

    it('throws when no speech is provided', async () => {
      await expect(
        service.generateAvatarVideo('Game Character')
      ).rejects.toThrow('Provide either Speech Text or a Speech Audio URI.')
    })
  })

  describe('createAvatar', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/avatars`).reply({ id: 'avatar-1', status: 'PROCESSING' })

      const result = await service.createAvatar(
        'Test Agent', 'https://example.com/face.png', 'Friendly',
        'Hi there!', 'Victoria'
      )

      expect(result).toMatchObject({ id: 'avatar-1', status: 'PROCESSING' })
      const postCall = mock.history[0]
      expect(postCall.body).toMatchObject({
        name: 'Test Agent',
        referenceImage: 'https://example.com/face.png',
        personality: 'Friendly',
        startScript: 'Hi there!',
        voice: { type: 'runway-live-preset', presetId: 'victoria' },
      })
    })

    it('throws when no voice is provided', async () => {
      await expect(
        service.createAvatar('Agent', 'https://example.com/face.png', 'Nice')
      ).rejects.toThrow('Provide either a Preset Voice or a Custom Voice id.')
    })
  })

  describe('getAvatar', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/avatars/avatar-123`).reply({ id: 'avatar-123', status: 'READY' })

      const result = await service.getAvatar('avatar-123')

      expect(result).toMatchObject({ id: 'avatar-123', status: 'READY' })
    })
  })

  describe('updateAvatar', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/avatars/avatar-123`).reply({ id: 'avatar-123', name: 'Updated' })

      await service.updateAvatar('avatar-123', 'Updated')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toMatchObject({ name: 'Updated' })
    })
  })

  describe('deleteAvatar', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/avatars/avatar-123`).reply(undefined)

      const result = await service.deleteAvatar('avatar-123')

      expect(result).toEqual({ success: true, id: 'avatar-123' })
    })
  })

  describe('listAvatarConversations', () => {
    it('sends GET with filters', async () => {
      mock.onGet(`${BASE}/avatar_conversations`).reply({ data: [], hasMore: false, nextCursor: null })

      await service.listAvatarConversations(10, undefined, 'av-1', '2026-01-01', '2026-02-01')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        avatar: 'av-1',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      })
    })
  })

  describe('getAvatarConversation', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/avatar_conversations/conv-1`).reply({ id: 'conv-1', transcript: [] })

      const result = await service.getAvatarConversation('conv-1')

      expect(result).toMatchObject({ id: 'conv-1' })
    })
  })

  describe('deleteAvatarConversation', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/avatar_conversations/conv-1`).reply(undefined)

      const result = await service.deleteAvatarConversation('conv-1')

      expect(result).toEqual({ success: true, id: 'conv-1' })
    })
  })

  describe('getAvatarUsage', () => {
    it('sends GET with date range', async () => {
      mock.onGet(`${BASE}/avatar_usage`).reply({ totalSeconds: 100, totalSessions: 5 })

      await service.getAvatarUsage('2026-01-01', '2026-02-01')

      expect(mock.history[0].query).toMatchObject({
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      })
    })
  })

  // ── Voices ──

  describe('listVoices', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/voices`).reply({ data: [], hasMore: false, nextCursor: null })

      await service.listVoices()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })
  })

  describe('createVoice', () => {
    it('sends POST with audio URI for cloning', async () => {
      mock.onPost(`${BASE}/voices`).reply({ id: 'voice-1' })

      await service.createVoice('Narrator', 'Deep voice', 'https://example.com/sample.mp3')

      const postCall = mock.history[0]
      expect(postCall.body).toMatchObject({
        name: 'Narrator',
        description: 'Deep voice',
        from: { type: 'audio', audio: 'https://example.com/sample.mp3' },
      })
    })

    it('sends POST with voice prompt for text design', async () => {
      mock.onPost(`${BASE}/voices`).reply({ id: 'voice-2' })

      await service.createVoice('Narrator', undefined, undefined, 'A warm male narrator')

      const postCall = mock.history[0]
      expect(postCall.body.from).toMatchObject({
        type: 'text',
        prompt: 'A warm male narrator',
        model: 'eleven_ttv_v3',
      })
    })

    it('uses custom voice design model', async () => {
      mock.onPost(`${BASE}/voices`).reply({ id: 'voice-3' })

      await service.createVoice(
        'Test', undefined, undefined, 'A voice', 'Eleven Multilingual Text-to-Voice v2'
      )

      const postCall = mock.history[0]
      expect(postCall.body.from.model).toBe('eleven_multilingual_ttv_v2')
    })

    it('throws when neither audio nor prompt is provided', async () => {
      await expect(
        service.createVoice('Test')
      ).rejects.toThrow('Provide either an Audio URI to clone from or a Voice Prompt')
    })
  })

  describe('getVoice', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/voices/voice-123`).reply({ id: 'voice-123', status: 'READY' })

      const result = await service.getVoice('voice-123')

      expect(result).toMatchObject({ id: 'voice-123', status: 'READY' })
    })
  })

  describe('updateVoice', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/voices/voice-123`).reply({ id: 'voice-123', name: 'Updated' })

      await service.updateVoice('voice-123', 'Updated', 'New desc')

      expect(mock.history[0].body).toMatchObject({ name: 'Updated', description: 'New desc' })
    })
  })

  describe('deleteVoice', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/voices/voice-123`).reply(undefined)

      const result = await service.deleteVoice('voice-123')

      expect(result).toEqual({ success: true, id: 'voice-123' })
    })
  })

  describe('previewVoice', () => {
    it('sends POST with prompt and default model', async () => {
      mock.onPost(`${BASE}/voices/preview`).reply({ url: 'https://example.com/preview.mp3', durationSecs: 4.2 })

      const result = await service.previewVoice('A calm narrator')

      expect(result).toMatchObject({ url: 'https://example.com/preview.mp3' })
      expect(mock.history[0].body).toEqual({
        prompt: 'A calm narrator',
        model: 'eleven_ttv_v3',
      })
    })
  })

  // ── Knowledge Documents ──

  describe('listDocuments', () => {
    it('sends GET with default params', async () => {
      mock.onGet(`${BASE}/documents`).reply({ data: [], hasMore: false, nextCursor: null })

      await service.listDocuments()

      expect(mock.history[0].query).toMatchObject({
        limit: 50,
        sort: 'createdAt',
        order: 'desc',
      })
    })

    it('passes custom sort params', async () => {
      mock.onGet(`${BASE}/documents`).reply({ data: [], hasMore: false, nextCursor: null })

      await service.listDocuments(10, undefined, 'Updated At', 'Ascending')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        sort: 'updatedAt',
        order: 'asc',
      })
    })
  })

  describe('createDocument', () => {
    it('sends POST with name and content', async () => {
      mock.onPost(`${BASE}/documents`).reply({ id: 'doc-1', name: 'FAQ', type: 'text' })

      const result = await service.createDocument('FAQ', 'Q: How?')

      expect(result).toMatchObject({ id: 'doc-1' })
      expect(mock.history[0].body).toEqual({ name: 'FAQ', content: 'Q: How?' })
    })
  })

  describe('getDocument', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/documents/doc-1`).reply({ id: 'doc-1', name: 'FAQ' })

      const result = await service.getDocument('doc-1')

      expect(result).toMatchObject({ id: 'doc-1' })
    })
  })

  describe('updateDocument', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/documents/doc-1`).reply({ id: 'doc-1', name: 'FAQ v2' })

      await service.updateDocument('doc-1', 'FAQ v2', 'Updated content')

      expect(mock.history[0].body).toMatchObject({ name: 'FAQ v2', content: 'Updated content' })
    })
  })

  describe('deleteDocument', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/documents/doc-1`).reply(undefined)

      const result = await service.deleteDocument('doc-1')

      expect(result).toEqual({ success: true, id: 'doc-1' })
    })
  })

  // ── Recipes ──

  describe('localizeAdImage', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/recipes/ad_localization`).reply({ id: 'task-loc' })
      mock.onGet(`${BASE}/tasks/task-loc`).reply({ id: 'task-loc', status: 'SUCCEEDED', output: [] })

      await service.localizeAdImage('https://example.com/ad.png', 'Spanish')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({
        version: '2026-06',
        referenceImage: { uri: 'https://example.com/ad.png' },
        targetLanguage: 'es',
      })
    })

    it('resolves Unsafe Latest version', async () => {
      mock.onPost(`${BASE}/recipes/ad_localization`).reply({ id: 'task-loc2' })
      mock.onGet(`${BASE}/tasks/task-loc2`).reply({ id: 'task-loc2', status: 'SUCCEEDED', output: [] })

      await service.localizeAdImage('https://example.com/ad.png', 'French', 'Unsafe Latest')

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.version).toBe('unsafe-latest')
    })
  })

  describe('createMarketingStockImage', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/recipes/marketing_stock_image`).reply({ id: 'task-msi' })
      mock.onGet(`${BASE}/tasks/task-msi`).reply({ id: 'task-msi', status: 'SUCCEEDED', output: [] })

      await service.createMarketingStockImage(
        'A professional office scene', 'https://example.com/ref.png', 4, 'High'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        version: '2026-06',
        prompt: 'A professional office scene',
        referenceImage: { uri: 'https://example.com/ref.png' },
        outputCount: 4,
        quality: 'high',
      })
    })
  })

  describe('createProductAdVideo', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/recipes/product_ad`).reply({ id: 'task-pad' })
      mock.onGet(`${BASE}/tasks/task-pad`).reply({ id: 'task-pad', status: 'SUCCEEDED', output: [] })

      await service.createProductAdVideo(
        ['https://example.com/product.png'],
        ['https://example.com/style.png'],
        'A great product', 'Energetic tone', '1280:720', 10, true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        version: '2026-06',
        productImages: [{ uri: 'https://example.com/product.png' }],
        styleImages: [{ uri: 'https://example.com/style.png' }],
        productInfo: 'A great product',
        userConcept: 'Energetic tone',
        ratio: '1280:720',
        duration: 10,
        audio: true,
      })
    })
  })

  describe('createProductCampaignImages', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/recipes/product_campaign_image`).reply({ id: 'task-pci' })
      mock.onGet(`${BASE}/tasks/task-pci`).reply({ id: 'task-pci', status: 'SUCCEEDED', output: [] })

      await service.createProductCampaignImages(
        'https://example.com/product.png', 'Luxury campaign'
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({
        version: '2026-06',
        image: { uri: 'https://example.com/product.png' },
        prompt: 'Luxury campaign',
      })
    })
  })

  describe('swapProductInVideo', () => {
    it('sends correct POST with product images', async () => {
      mock.onPost(`${BASE}/recipes/product_swap`).reply({ id: 'task-ps' })
      mock.onGet(`${BASE}/tasks/task-ps`).reply({ id: 'task-ps', status: 'SUCCEEDED', output: [] })

      await service.swapProductInVideo(
        'https://example.com/video.mp4',
        'https://example.com/old.png',
        [{ uri: 'https://example.com/new.png', view: 'Front' }],
        10, '1080p', true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        version: '2026-06',
        referenceVideo: { uri: 'https://example.com/video.mp4' },
        originalProductImage: { uri: 'https://example.com/old.png' },
        newProductImages: [{ uri: 'https://example.com/new.png', view: 'front' }],
        duration: 10,
        resolution: '1080p',
        audio: true,
      })
    })
  })

  describe('createMultiShotVideo', () => {
    it('sends correct POST in Auto mode', async () => {
      mock.onPost(`${BASE}/recipes/multi_shot_video`).reply({ id: 'task-msv' })
      mock.onGet(`${BASE}/tasks/task-msv`).reply({ id: 'task-msv', status: 'SUCCEEDED', output: [] })

      await service.createMultiShotVideo(
        'Auto', 'A story about a cat', undefined, undefined, '1280:720', '10 seconds', true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        version: '2026-06',
        mode: 'auto',
        prompt: 'A story about a cat',
        ratio: '1280:720',
        duration: 10,
        audio: true,
      })
      expect(postCall.body.shots).toBeUndefined()
    })

    it('sends correct POST in Custom mode', async () => {
      mock.onPost(`${BASE}/recipes/multi_shot_video`).reply({ id: 'task-msv2' })
      mock.onGet(`${BASE}/tasks/task-msv2`).reply({ id: 'task-msv2', status: 'SUCCEEDED', output: [] })

      const shots = [
        { prompt: 'Opening shot', duration: 3 },
        { prompt: 'Close up', duration: 5 },
      ]

      await service.createMultiShotVideo('Custom', undefined, shots)

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body.mode).toBe('custom')
      expect(postCall.body.shots).toEqual(shots)
      expect(postCall.body.prompt).toBeUndefined()
    })

    it('throws when Custom mode has no shots', async () => {
      await expect(
        service.createMultiShotVideo('Custom', undefined, [])
      ).rejects.toThrow('Custom mode requires at least one shot')
    })

    it('throws when Auto mode has no prompt', async () => {
      await expect(
        service.createMultiShotVideo('Auto')
      ).rejects.toThrow('Auto mode requires a Prompt')
    })
  })

  describe('createProductUgcVideo', () => {
    it('sends correct POST', async () => {
      mock.onPost(`${BASE}/recipes/product_ugc`).reply({ id: 'task-ugc' })
      mock.onGet(`${BASE}/tasks/task-ugc`).reply({ id: 'task-ugc', status: 'SUCCEEDED', output: [] })

      await service.createProductUgcVideo(
        'https://example.com/char.png', 'https://example.com/prod.png',
        'Great product', 'Enthusiastic', 15, '720:1280', true
      )

      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toMatchObject({
        version: '2026-06',
        characterImage: { uri: 'https://example.com/char.png' },
        productImage: { uri: 'https://example.com/prod.png' },
        productInfo: 'Great product',
        userConcept: 'Enthusiastic',
        duration: 15,
        ratio: '720:1280',
        audio: true,
      })
    })
  })

  // ── Tasks ──

  describe('getTask', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/tasks/task-123`).reply({ id: 'task-123', status: 'RUNNING', progress: 0.5 })

      const result = await service.getTask('task-123')

      expect(result).toMatchObject({ id: 'task-123', status: 'RUNNING' })
      expectAuthHeaders(mock.history[0])
    })
  })

  describe('cancelTask', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/tasks/task-123`).reply(undefined)

      const result = await service.cancelTask('task-123')

      expect(result).toEqual({ success: true, id: 'task-123' })
    })
  })

  describe('saveTaskOutputToFiles', () => {
    it('throws when task has not succeeded', async () => {
      mock.onGet(`${BASE}/tasks/task-running`).reply({ id: 'task-running', status: 'RUNNING' })

      await expect(
        service.saveTaskOutputToFiles('task-running')
      ).rejects.toThrow('has status RUNNING')
    })
  })

  // ── Workflows ──

  describe('listWorkflows', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/workflows`).reply({ data: [] })

      const result = await service.listWorkflows()

      expect(result).toEqual({ data: [] })
    })
  })

  describe('getWorkflow', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/workflows/wf-1`).reply({ id: 'wf-1', name: 'Pipeline' })

      const result = await service.getWorkflow('wf-1')

      expect(result).toMatchObject({ id: 'wf-1' })
    })
  })

  describe('runWorkflow', () => {
    it('sends POST and polls until succeeded', async () => {
      mock.onPost(`${BASE}/workflows/wf-1`).reply({ id: 'inv-1' })
      mock.onGet(`${BASE}/workflow_invocations/inv-1`).reply({ id: 'inv-1', status: 'SUCCEEDED', output: {} })

      const result = await service.runWorkflow('wf-1', { node1: 'value' })

      expect(result).toMatchObject({ id: 'inv-1', status: 'SUCCEEDED' })
      const postCall = mock.history.find(c => c.method === 'post')
      expect(postCall.body).toEqual({ nodeOutputs: { node1: 'value' } })
    })

    it('returns immediately when waitForCompletion is false', async () => {
      mock.onPost(`${BASE}/workflows/wf-1`).reply({ id: 'inv-2' })

      const result = await service.runWorkflow('wf-1', undefined, false)

      expect(result).toEqual({ id: 'inv-2', status: 'PENDING' })
      expect(mock.history).toHaveLength(1)
    })

    it('throws when invocation fails', async () => {
      mock.onPost(`${BASE}/workflows/wf-1`).reply({ id: 'inv-3' })
      mock.onGet(`${BASE}/workflow_invocations/inv-3`).reply({
        id: 'inv-3', status: 'FAILED', failure: 'node error', failureCode: 'NODE_ERR',
      })

      await expect(
        service.runWorkflow('wf-1')
      ).rejects.toThrow('Runway workflow invocation inv-3 failed')
    })
  })

  describe('getWorkflowInvocation', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/workflow_invocations/inv-1`).reply({ id: 'inv-1', status: 'RUNNING' })

      const result = await service.getWorkflowInvocation('inv-1')

      expect(result).toMatchObject({ id: 'inv-1', status: 'RUNNING' })
    })
  })

  // ── Account ──

  describe('getOrganizationInfo', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/organization`).reply({ creditBalance: 12500 })

      const result = await service.getOrganizationInfo()

      expect(result).toMatchObject({ creditBalance: 12500 })
      expectAuthHeaders(mock.history[0])
    })
  })

  describe('getCreditUsage', () => {
    it('sends POST with date range', async () => {
      mock.onPost(`${BASE}/organization/usage`).reply({ results: [], models: [] })

      await service.getCreditUsage('2026-01-01', '2026-02-01')

      expect(mock.history[0].body).toEqual({
        startDate: '2026-01-01',
        beforeDate: '2026-02-01',
      })
    })
  })

  // ── Dictionaries ──

  describe('getImageRatiosDictionary', () => {
    it('returns ratios for Gen-4 Image model', async () => {
      const result = await service.getImageRatiosDictionary({
        criteria: { model: 'Gen-4 Image' },
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      const result = await service.getImageRatiosDictionary({
        search: '1920',
        criteria: { model: 'Gen-4 Image' },
      })

      result.items.forEach(item => {
        expect(item.value).toContain('1920')
      })
    })

    it('returns empty items for unknown model', async () => {
      const result = await service.getImageRatiosDictionary({
        criteria: { model: 'Nonexistent' },
      })

      expect(result.items).toEqual([])
    })

    it('handles null payload', async () => {
      const result = await service.getImageRatiosDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getImageToVideoRatiosDictionary', () => {
    it('returns ratios for Gen-4.5', async () => {
      const result = await service.getImageToVideoRatiosDictionary({
        criteria: { model: 'Gen-4.5' },
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.cursor).toBeNull()
    })
  })

  describe('getTextToVideoRatiosDictionary', () => {
    it('returns ratios for Seedance 2', async () => {
      const result = await service.getTextToVideoRatiosDictionary({
        criteria: { model: 'Seedance 2' },
      })

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getVideoToVideoRatiosDictionary', () => {
    it('returns empty for Aleph 2 (no fixed ratios)', async () => {
      const result = await service.getVideoToVideoRatiosDictionary({
        criteria: { model: 'Aleph 2' },
      })

      expect(result.items).toEqual([])
    })

    it('returns ratios for Seedance 2', async () => {
      const result = await service.getVideoToVideoRatiosDictionary({
        criteria: { model: 'Seedance 2' },
      })

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getAvatarsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/avatars`).reply({
        data: [
          { id: 'av-1', name: 'Agent Alpha', status: 'READY' },
          { id: 'av-2', name: 'Agent Beta', status: 'PROCESSING' },
        ],
        nextCursor: null,
      })

      const result = await service.getAvatarsDictionary({})

      expect(result.items).toEqual([
        { label: 'Agent Alpha', value: 'av-1', note: 'READY' },
        { label: 'Agent Beta', value: 'av-2', note: 'PROCESSING' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/avatars`).reply({
        data: [
          { id: 'av-1', name: 'Agent Alpha', status: 'READY' },
          { id: 'av-2', name: 'Agent Beta', status: 'READY' },
        ],
        nextCursor: null,
      })

      const result = await service.getAvatarsDictionary({ search: 'ALPHA' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('av-1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/avatars`).reply({ data: [{ id: 'av-1', name: 'X' }], nextCursor: null })

      const result = await service.getAvatarsDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns mapped items', async () => {
      mock.onGet(`${BASE}/voices`).reply({
        data: [{ id: 'v-1', name: 'Narrator', status: 'READY' }],
        nextCursor: 'next',
      })

      const result = await service.getVoicesDictionary({})

      expect(result.items).toEqual([
        { label: 'Narrator', value: 'v-1', note: 'READY' },
      ])
      expect(result.cursor).toBe('next')
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/voices`).reply({
        data: [
          { id: 'v-1', name: 'Narrator', status: 'READY' },
          { id: 'v-2', name: 'Announcer', status: 'READY' },
        ],
        nextCursor: null,
      })

      const result = await service.getVoicesDictionary({ search: 'narr' })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getWorkflowsDictionary', () => {
    it('returns mapped workflow versions', async () => {
      mock.onGet(`${BASE}/workflows`).reply({
        data: [
          {
            name: 'Pipeline',
            versions: [
              { id: 'wf-v3', version: 3 },
              { id: 'wf-v2', version: 2 },
            ],
          },
        ],
      })

      const result = await service.getWorkflowsDictionary({})

      expect(result.items).toEqual([
        { label: 'Pipeline (v3)', value: 'wf-v3', note: 'Latest version' },
        { label: 'Pipeline (v2)', value: 'wf-v2', note: undefined },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/workflows`).reply({
        data: [
          { name: 'Pipeline A', versions: [{ id: 'wf-a', version: 1 }] },
          { name: 'Pipeline B', versions: [{ id: 'wf-b', version: 1 }] },
        ],
      })

      const result = await service.getWorkflowsDictionary({ search: 'pipeline b' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('wf-b')
    })
  })

  // ── Task polling behavior ──

  describe('task polling - FAILED task', () => {
    it('throws when a generation task fails', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-fail' })
      mock.onGet(`${BASE}/tasks/task-fail`).reply({
        id: 'task-fail', status: 'FAILED', failure: 'Content violation', failureCode: 'CV_001',
      })

      await expect(
        service.generateImage('Gen-4 Image', 'test', '1024:1024')
      ).rejects.toThrow('Runway task task-fail failed: Content violation (code: CV_001)')
    })
  })

  describe('task polling - CANCELLED task', () => {
    it('throws when a generation task is cancelled', async () => {
      mock.onPost(`${BASE}/text_to_image`).reply({ id: 'task-cancel' })
      mock.onGet(`${BASE}/tasks/task-cancel`).reply({
        id: 'task-cancel', status: 'CANCELLED',
      })

      await expect(
        service.generateImage('Gen-4 Image', 'test', '1024:1024')
      ).rejects.toThrow('was cancelled')
    })
  })

  describe('waitForTask', () => {
    it('polls task and returns on success', async () => {
      mock.onGet(`${BASE}/tasks/task-wait`).reply({
        id: 'task-wait', status: 'SUCCEEDED', output: [],
      })

      const result = await service.waitForTask('task-wait')

      expect(result).toMatchObject({ id: 'task-wait', status: 'SUCCEEDED' })
    })

    it('throws when waited task fails', async () => {
      mock.onGet(`${BASE}/tasks/task-wait-fail`).reply({
        id: 'task-wait-fail', status: 'FAILED', failure: 'error',
      })

      await expect(
        service.waitForTask('task-wait-fail')
      ).rejects.toThrow('Runway task task-wait-fail failed')
    })
  })
})
