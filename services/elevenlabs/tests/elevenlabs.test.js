'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.elevenlabs.io/'

describe('ElevenLabs Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.example.com/audio.mp3' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
      },
    }
  })

  afterEach(() => {
    mock.reset()
    uploadFileMock.mockClear()
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

  // ── getUserInfo ──

  describe('getUserInfo', () => {
    it('sends GET to v1/user with correct auth header', async () => {
      const mockResponse = { user_id: 'u123', subscription: { tier: 'free' } }
      mock.onGet(`${BASE}v1/user`).reply(mockResponse)

      const result = await service.getUserInfo()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'xi-api-key': API_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}v1/user`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid API key' },
      })

      await expect(service.getUserInfo()).rejects.toThrow('Invalid API key')
    })
  })

  // ── getVoices ──

  describe('getVoices', () => {
    it('sends GET to v1/voices', async () => {
      const mockResponse = { voices: [{ voice_id: 'v1', name: 'Rachel' }] }
      mock.onGet(`${BASE}v1/voices`).reply(mockResponse)

      const result = await service.getVoices()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].headers).toMatchObject({ 'xi-api-key': API_KEY })
    })
  })

  // ── getVoice ──

  describe('getVoice', () => {
    it('sends GET to v1/voices/{voiceId}', async () => {
      const voiceId = 'voice123'
      const mockResponse = { voice_id: voiceId, name: 'Rachel', category: 'premade' }
      mock.onGet(`${BASE}v1/voices/${voiceId}`).reply(mockResponse)

      const result = await service.getVoice(voiceId)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}v1/voices/${voiceId}`)
    })
  })

  // ── getModels ──

  describe('getModels', () => {
    it('sends GET to v1/models', async () => {
      const mockResponse = [{ model_id: 'eleven_monolingual_v1', name: 'Eleven Monolingual v1' }]
      mock.onGet(`${BASE}v1/models`).reply(mockResponse)

      const result = await service.getModels()

      expect(result).toEqual(mockResponse)
    })
  })

  // ── deleteVoice ──

  describe('deleteVoice', () => {
    it('sends DELETE to v1/voices/{voiceId} and returns success object', async () => {
      const voiceId = 'voice123'
      mock.onDelete(`${BASE}v1/voices/${voiceId}`).reply({})

      const result = await service.deleteVoice(voiceId)

      expect(result).toEqual({
        success: true,
        voiceId: 'voice123',
        message: 'Voice deleted successfully',
      })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── textToSpeech ──

  describe('textToSpeech', () => {
    const voiceId = 'voice123'
    const ttsUrl = `${BASE}v1/text-to-speech/${voiceId}`

    it('sends POST with required params and defaults', async () => {
      const audioBuffer = Buffer.from('audio-data')
      mock.onPost(ttsUrl).reply({ body: audioBuffer })

      await service.textToSpeech('Hello world', voiceId)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        text: 'Hello world',
        model_id: 'eleven_turbo_v2_5',
      })
      expect(mock.history[0].headers).toMatchObject({ 'xi-api-key': API_KEY })
    })

    it('uses custom modelId when provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, 'eleven_multilingual_v2')

      expect(mock.history[0].body.model_id).toBe('eleven_multilingual_v2')
    })

    it('includes voice_settings when stability/similarityBoost/style/useSpeakerBoost are provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, undefined, 0.5, 0.8, 0.3, true)

      expect(mock.history[0].body.voice_settings).toEqual({
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.3,
        use_speaker_boost: true,
      })
    })

    it('omits voice_settings when none of the voice setting params are provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId)

      expect(mock.history[0].body).not.toHaveProperty('voice_settings')
    })

    it('includes language_code when provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hola', voiceId, undefined, undefined, undefined, undefined, undefined, 'es')

      expect(mock.history[0].body.language_code).toBe('es')
    })

    it('includes output_format query param when provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, undefined, undefined, undefined, undefined, undefined, undefined, 'pcm_44100')

      expect(mock.history[0].query).toMatchObject({ output_format: 'pcm_44100' })
    })

    it('uploads audio via flowrunner.Files.uploadFile with mp3 extension by default', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })
      uploadFileMock.mockResolvedValueOnce({ url: 'https://files.example.com/audio_123.mp3' })

      await service.textToSpeech('Hello', voiceId)

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: expect.stringMatching(/^audio_\d+\.mp3$/),
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('uses pcm extension for pcm output format', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, undefined, undefined, undefined, undefined, undefined, undefined, 'pcm_44100')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: expect.stringMatching(/\.pcm$/),
        })
      )
    })

    it('uses ulaw extension for ulaw output format', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, undefined, undefined, undefined, undefined, undefined, undefined, 'ulaw_8000')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: expect.stringMatching(/\.ulaw$/),
        })
      )
    })

    it('passes fileOptions when provided', async () => {
      mock.onPost(ttsUrl).reply({ body: Buffer.from('audio') })

      await service.textToSpeech('Hello', voiceId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { scope: 'APP' })

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: 'APP' })
      )
    })

    it('throws when stability is out of range', async () => {
      await expect(
        service.textToSpeech('Hello', voiceId, undefined, 1.5)
      ).rejects.toThrow('Stability must be between 0 and 1')
    })

    it('throws when similarityBoost is out of range', async () => {
      await expect(
        service.textToSpeech('Hello', voiceId, undefined, undefined, -0.1)
      ).rejects.toThrow('Similarity boost must be between 0 and 1')
    })

    it('throws when style is out of range', async () => {
      await expect(
        service.textToSpeech('Hello', voiceId, undefined, undefined, undefined, 2)
      ).rejects.toThrow('Style must be between 0 and 1')
    })
  })

  // ── textToSoundEffects ──

  describe('textToSoundEffects', () => {
    const sfxUrl = `${BASE}v1/sound-generation`

    it('sends POST with text only', async () => {
      mock.onPost(sfxUrl).reply({ body: Buffer.from('sfx-audio') })

      await service.textToSoundEffects('dog barking')

      expect(mock.history[0].body).toEqual({ text: 'dog barking' })
    })

    it('includes durationSeconds and promptInfluence when provided', async () => {
      mock.onPost(sfxUrl).reply({ body: Buffer.from('sfx-audio') })

      await service.textToSoundEffects('thunder', 5.0, 0.8)

      expect(mock.history[0].body).toEqual({
        text: 'thunder',
        duration_seconds: 5.0,
        prompt_influence: 0.8,
      })
    })

    it('uploads audio with sfx_ prefix', async () => {
      mock.onPost(sfxUrl).reply({ body: Buffer.from('sfx-audio') })

      await service.textToSoundEffects('rain')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: expect.stringMatching(/^sfx_\d+\.mp3$/),
          scope: 'FLOW',
        })
      )
    })
  })

  // ── speechToText ──

  describe('speechToText', () => {
    const sttUrl = `${BASE}v1/speech-to-text`

    it('sends POST with multipart form data', async () => {
      const mockResponse = { text: 'Hello world', audio_duration: 5.2 }
      mock.onPost(sttUrl).reply(mockResponse)

      const result = await service.speechToText('https://example.com/audio.mp3', 'scribe_v1')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].formData).toBeDefined()
      expect(mock.history[0].formData._fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'model_id', value: 'scribe_v1' }),
          expect.objectContaining({ name: 'cloud_storage_url', value: 'https://example.com/audio.mp3' }),
        ])
      )
    })

    it('defaults model to scribe_v1', async () => {
      mock.onPost(sttUrl).reply({ text: 'Hello' })

      await service.speechToText('https://example.com/audio.mp3')

      const modelField = mock.history[0].formData._fields.find(f => f.name === 'model_id')
      expect(modelField.value).toBe('scribe_v1')
    })

    it('includes language when provided', async () => {
      mock.onPost(sttUrl).reply({ text: 'Hola' })

      await service.speechToText('https://example.com/audio.mp3', 'scribe_v1', 'es')

      expect(mock.history[0].formData._fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'language', value: 'es' }),
        ])
      )
    })

    it('omits language when not provided', async () => {
      mock.onPost(sttUrl).reply({ text: 'Hello' })

      await service.speechToText('https://example.com/audio.mp3', 'scribe_v1')

      const langField = mock.history[0].formData._fields.find(f => f.name === 'language')
      expect(langField).toBeUndefined()
    })
  })

  // ── editVoice ──

  describe('editVoice', () => {
    const voiceId = 'voice123'
    const editUrl = `${BASE}v1/voices/${voiceId}/edit`

    it('sends POST with multipart form data containing name', async () => {
      mock.onPost(editUrl).reply({ status: 'ok' })

      const result = await service.editVoice(voiceId, 'New Name')

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].formData._fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'name', value: 'New Name' }),
        ])
      )
    })

    it('includes description, labels, and removeBackgroundNoise when provided', async () => {
      mock.onPost(editUrl).reply({ status: 'ok' })

      await service.editVoice(voiceId, 'Name', 'A calm voice', { accent: 'british' }, true)

      const fields = mock.history[0].formData._fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'name', value: 'Name' }),
          expect.objectContaining({ name: 'description', value: 'A calm voice' }),
          expect.objectContaining({ name: 'labels', value: '{"accent":"british"}' }),
          expect.objectContaining({ name: 'remove_background_noise', value: 'true' }),
        ])
      )
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(editUrl).reply({ status: 'ok' })

      await service.editVoice(voiceId)

      expect(mock.history[0].formData._fields).toHaveLength(0)
    })
  })

  // ── createVoiceIVC ──

  describe('createVoiceIVC', () => {
    const addUrl = `${BASE}v1/voices/add`
    const audioUrl = 'https://example.com/sample.mp3'

    it('downloads audio and sends multipart POST', async () => {
      const audioBuffer = Buffer.from('audio-sample')
      mock.onGet(audioUrl).reply({ body: audioBuffer })
      mock.onPost(addUrl).reply({ voice_id: 'new-voice-id' })

      const result = await service.createVoiceIVC('My Voice', audioUrl)

      expect(result).toEqual({ voice_id: 'new-voice-id' })
      // First request: download audio, second: create voice
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('post')

      const fields = mock.history[1].formData._fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'name', value: 'My Voice' }),
          expect.objectContaining({ name: 'files' }),
        ])
      )
    })

    it('includes optional fields when provided', async () => {
      mock.onGet(audioUrl).reply({ body: Buffer.from('audio') })
      mock.onPost(addUrl).reply({ voice_id: 'v1' })

      await service.createVoiceIVC('Voice', audioUrl, 'desc', { accent: 'us' }, true)

      const fields = mock.history[1].formData._fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'description', value: 'desc' }),
          expect.objectContaining({ name: 'labels', value: '{"accent":"us"}' }),
          expect.objectContaining({ name: 'remove_background_noise', value: 'true' }),
        ])
      )
    })
  })

  // ── createVoicePVC ──

  describe('createVoicePVC', () => {
    const pvcUrl = `${BASE}v1/voices/pvc`

    it('sends POST with required fields', async () => {
      mock.onPost(pvcUrl).reply({ voice_id: 'pvc-id' })

      const result = await service.createVoicePVC('Pro Voice', 'en')

      expect(result).toEqual({ voice_id: 'pvc-id' })
      expect(mock.history[0].body).toEqual({ name: 'Pro Voice', language: 'en' })
    })

    it('includes optional description and labels', async () => {
      mock.onPost(pvcUrl).reply({ voice_id: 'pvc-id' })

      await service.createVoicePVC('Pro Voice', 'en', 'A professional voice', { gender: 'male' })

      expect(mock.history[0].body).toEqual({
        name: 'Pro Voice',
        language: 'en',
        description: 'A professional voice',
        labels: { gender: 'male' },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(pvcUrl).reply({ voice_id: 'pvc-id' })

      await service.createVoicePVC('Voice', 'fr')

      expect(mock.history[0].body).toEqual({ name: 'Voice', language: 'fr' })
    })
  })

  // ── addVoiceSamples ──

  describe('addVoiceSamples', () => {
    const voiceId = 'voice123'
    const samplesUrl = `${BASE}v1/voices/pvc/${voiceId}/samples`
    const audioUrl = 'https://example.com/sample.mp3'

    it('downloads audio and sends multipart POST', async () => {
      mock.onGet(audioUrl).reply({ body: Buffer.from('sample-audio') })
      mock.onPost(samplesUrl).reply([{ sample_id: 's1' }])

      const result = await service.addVoiceSamples(voiceId, audioUrl)

      expect(result).toEqual([{ sample_id: 's1' }])
      expect(mock.history).toHaveLength(2)

      const fields = mock.history[1].formData._fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'files' }),
        ])
      )
    })

    it('includes removeBackgroundNoise when provided', async () => {
      mock.onGet(audioUrl).reply({ body: Buffer.from('audio') })
      mock.onPost(samplesUrl).reply([{ sample_id: 's1' }])

      await service.addVoiceSamples(voiceId, audioUrl, true)

      const fields = mock.history[1].formData._fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'remove_background_noise', value: 'true' }),
        ])
      )
    })
  })

  // ── designVoice ──

  describe('designVoice', () => {
    const designUrl = `${BASE}v1/text-to-voice/design`

    it('sends POST with voiceDescription and default model', async () => {
      mock.onPost(designUrl).reply({ previews: [] })

      const result = await service.designVoice('A deep male voice')

      expect(result).toEqual({ previews: [] })
      expect(mock.history[0].body).toMatchObject({
        voice_description: 'A deep male voice',
        model_id: 'eleven_multilingual_ttv_v2',
        auto_generate_text: true,
      })
    })

    it('sets auto_generate_text to false when text is provided', async () => {
      mock.onPost(designUrl).reply({ previews: [] })

      await service.designVoice('A calm voice', 'Hello world')

      expect(mock.history[0].body).toMatchObject({
        text: 'Hello world',
        auto_generate_text: false,
      })
    })

    it('uses custom modelId when provided', async () => {
      mock.onPost(designUrl).reply({ previews: [] })

      await service.designVoice('A voice', undefined, 'eleven_ttv_v3')

      expect(mock.history[0].body.model_id).toBe('eleven_ttv_v3')
    })

    it('includes output_format query param when provided', async () => {
      mock.onPost(designUrl).reply({ previews: [] })

      await service.designVoice('A voice', undefined, undefined, 'mp3_44100_192')

      expect(mock.history[0].query).toMatchObject({ output_format: 'mp3_44100_192' })
    })

    it('uploads preview audio from base64 and replaces with URL', async () => {
      const audioBase64 = Buffer.from('preview-audio').toString('base64')
      mock.onPost(designUrl).reply({
        previews: [
          { generated_voice_id: 'gen1', audio_base_64: audioBase64 },
        ],
      })
      uploadFileMock.mockResolvedValueOnce({ url: 'https://files.example.com/preview.mp3' })

      const result = await service.designVoice('A voice')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'voice_preview_gen1.mp3',
          generateUrl: true,
        })
      )
      expect(result.previews[0].audio_url).toBe('https://files.example.com/preview.mp3')
      expect(result.previews[0]).not.toHaveProperty('audio_base_64')
    })
  })

  // ── createVoiceFromGeneration ──

  describe('createVoiceFromGeneration', () => {
    const createUrl = `${BASE}v1/text-to-voice`

    it('sends POST with required fields', async () => {
      mock.onPost(createUrl).reply({ voice_id: 'created1' })

      const result = await service.createVoiceFromGeneration('My Voice', 'A deep voice', 'gen123')

      expect(result).toEqual({ voice_id: 'created1' })
      expect(mock.history[0].body).toEqual({
        voice_name: 'My Voice',
        voice_description: 'A deep voice',
        generated_voice_id: 'gen123',
      })
    })

    it('includes labels when provided', async () => {
      mock.onPost(createUrl).reply({ voice_id: 'created1' })

      await service.createVoiceFromGeneration('Voice', 'Desc', 'gen1', { accent: 'uk' })

      expect(mock.history[0].body.labels).toEqual({ accent: 'uk' })
    })
  })

  // ── getHistory ──

  describe('getHistory', () => {
    const historyUrl = `${BASE}v1/history`

    it('sends GET with no query params by default', async () => {
      const mockResponse = { history: [], has_more: false }
      mock.onGet(historyUrl).reply(mockResponse)

      const result = await service.getHistory()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pageSize, startAfterHistoryItemId, and voiceId in query', async () => {
      mock.onGet(historyUrl).reply({ history: [], has_more: false })

      await service.getHistory(50, 'item123', 'voice456')

      expect(mock.history[0].query).toEqual({
        page_size: 50,
        start_after_history_item_id: 'item123',
        voice_id: 'voice456',
      })
    })

    it('omits falsy query params', async () => {
      mock.onGet(historyUrl).reply({ history: [] })

      await service.getHistory(25)

      expect(mock.history[0].query).toEqual({ page_size: 25 })
    })
  })

  // ── getHistoryItemAudio ──

  describe('getHistoryItemAudio', () => {
    const itemId = 'hist123'
    const audioUrl = `${BASE}v1/history/${itemId}/audio`

    it('sends GET with binary flag and uploads result', async () => {
      mock.onGet(audioUrl).reply({ body: Buffer.from('history-audio') })

      const result = await service.getHistoryItemAudio(itemId)

      expect(typeof result).toBe('string')
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: `history_${itemId}.mp3`,
          generateUrl: true,
          scope: 'FLOW',
        })
      )
    })

    it('passes fileOptions when provided', async () => {
      mock.onGet(audioUrl).reply({ body: Buffer.from('audio') })

      await service.getHistoryItemAudio(itemId, { scope: 'APP' })

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: 'APP' })
      )
    })
  })

  // ── deleteHistoryItem ──

  describe('deleteHistoryItem', () => {
    it('sends DELETE to v1/history/{id}', async () => {
      const itemId = 'hist123'
      mock.onDelete(`${BASE}v1/history/${itemId}`).reply({})

      const result = await service.deleteHistoryItem(itemId)

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── getVoicesDictionary ──

  describe('getVoicesDictionary', () => {
    const voicesUrl = `${BASE}v1/voices`

    it('returns formatted items from API response', async () => {
      mock.onGet(voicesUrl).reply({
        voices: [
          { voice_id: 'v1', name: 'Rachel', category: 'premade' },
          { voice_id: 'v2', name: 'Custom Voice', category: 'cloned' },
        ],
      })

      const result = await service.getVoicesDictionary({})

      expect(result.items).toEqual([
        { label: 'Rachel (premade)', value: 'v1', note: 'Category: premade' },
        { label: 'Custom Voice (cloned)', value: 'v2', note: 'Category: cloned' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search string', async () => {
      mock.onGet(voicesUrl).reply({
        voices: [
          { voice_id: 'v1', name: 'Rachel', category: 'premade' },
          { voice_id: 'v2', name: 'Domi', category: 'premade' },
        ],
      })

      const result = await service.getVoicesDictionary({ search: 'rach' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('v1')
    })

    it('handles empty voices array', async () => {
      mock.onGet(voicesUrl).reply({ voices: [] })

      const result = await service.getVoicesDictionary({})

      expect(result.items).toEqual([])
    })

    it('uses "custom" as default category', async () => {
      mock.onGet(voicesUrl).reply({
        voices: [{ voice_id: 'v1', name: 'My Voice' }],
      })

      const result = await service.getVoicesDictionary({})

      expect(result.items[0].label).toBe('My Voice (custom)')
      expect(result.items[0].note).toBe('Category: custom')
    })

    it('handles null payload', async () => {
      mock.onGet(voicesUrl).reply({ voices: [{ voice_id: 'v1', name: 'Test' }] })

      const result = await service.getVoicesDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  // ── getModelsDictionary ──

  describe('getModelsDictionary', () => {
    const modelsUrl = `${BASE}v1/models`

    it('returns formatted items from API response', async () => {
      mock.onGet(modelsUrl).reply([
        { model_id: 'eleven_monolingual_v1', name: 'Eleven Monolingual v1', description: 'English only' },
      ])

      const result = await service.getModelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Eleven Monolingual v1', value: 'eleven_monolingual_v1', note: 'English only' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by model name', async () => {
      mock.onGet(modelsUrl).reply([
        { model_id: 'm1', name: 'Monolingual', description: 'd1' },
        { model_id: 'm2', name: 'Multilingual', description: 'd2' },
      ])

      const result = await service.getModelsDictionary({ search: 'multi' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('m2')
    })

    it('filters by model_id', async () => {
      mock.onGet(modelsUrl).reply([
        { model_id: 'eleven_turbo_v2', name: 'Turbo v2', description: 'Fast' },
        { model_id: 'eleven_mono_v1', name: 'Mono v1', description: 'Slow' },
      ])

      const result = await service.getModelsDictionary({ search: 'turbo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('eleven_turbo_v2')
    })

    it('uses model_id as note fallback when description is missing', async () => {
      mock.onGet(modelsUrl).reply([
        { model_id: 'test_model', name: 'Test' },
      ])

      const result = await service.getModelsDictionary({})

      expect(result.items[0].note).toBe('test_model')
    })
  })
})
