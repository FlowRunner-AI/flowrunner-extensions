'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-xi-api-key'
const BASE = 'https://api.elevenlabs.io/'

// Helper: install a fake Files API on the service so methods that upload audio
// (this.flowrunner.Files.uploadFile) resolve to a predictable URL. The sandbox
// does NOT provide this.flowrunner — it is runtime-injected by FlowRunner — so
// stubbing it here is expected, not a workaround for a bug.
function stubFiles(service, url = 'https://files.example.com/elevenlabs/audio.mp3') {
  const calls = []

  service.flowrunner = {
    Files: {
      uploadFile: async (buffer, options) => {
        calls.push({ buffer, options })

        return { url }
      },
    },
  }

  return calls
}

describe('ElevenLabs Service', () => {
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
    delete service.flowrunner
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
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

    it('sends the xi-api-key header on requests', async () => {
      mock.onGet(`${ BASE }v1/user`).reply({ user_id: 'u1' })

      await service.getUserInfo()

      expect(mock.history[0].headers).toMatchObject({ 'xi-api-key': API_KEY })
    })
  })

  // ── Text to Speech (binary + Files upload) ──

  describe('textToSpeech', () => {
    it('sends required params, uploads audio and returns the file url', async () => {
      mock.onPost(`${ BASE }v1/text-to-speech/voice-1`).reply({ body: Buffer.from('audio') })
      const uploads = stubFiles(service)

      const result = await service.textToSpeech('Hello world', 'voice-1')

      expect(result).toBe('https://files.example.com/elevenlabs/audio.mp3')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }v1/text-to-speech/voice-1`)
      expect(mock.history[0].headers).toMatchObject({ 'xi-api-key': API_KEY })
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].body).toEqual({
        text: 'Hello world',
        model_id: 'eleven_turbo_v2_5',
      })
      // audio buffer forwarded to the uploader, default scope applied
      expect(Buffer.isBuffer(uploads[0].buffer)).toBe(true)
      expect(uploads[0].options).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      expect(uploads[0].options.filename).toMatch(/^audio_\d+\.mp3$/)
    })

    it('builds voice_settings, language_code and output_format query for all params', async () => {
      mock.onPost(`${ BASE }v1/text-to-speech/voice-2`).reply({ body: Buffer.from('audio') })
      const uploads = stubFiles(service)

      await service.textToSpeech(
        'Hi',
        'voice-2',
        'eleven_multilingual_v2',
        0.4,
        0.8,
        0.2,
        true,
        'en',
        'pcm_24000',
        { scope: 'APP' }
      )

      expect(mock.history[0].body).toEqual({
        text: 'Hi',
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
        language_code: 'en',
      })
      expect(mock.history[0].query).toMatchObject({ output_format: 'pcm_24000' })
      // pcm output produces a .pcm extension and custom scope is forwarded
      expect(uploads[0].options.filename).toMatch(/^audio_\d+\.pcm$/)
      expect(uploads[0].options).toMatchObject({ scope: 'APP' })
    })

    it('uses a .ulaw extension for ulaw output formats', async () => {
      mock.onPost(`${ BASE }v1/text-to-speech/voice-3`).reply({ body: Buffer.from('audio') })
      const uploads = stubFiles(service)

      await service.textToSpeech('Hi', 'voice-3', undefined, undefined, undefined, undefined, undefined, undefined, 'ulaw_8000')

      expect(uploads[0].options.filename).toMatch(/^audio_\d+\.ulaw$/)
    })

    it('throws when stability is out of range', async () => {
      await expect(service.textToSpeech('Hi', 'voice-1', undefined, 1.5)).rejects.toThrow(
        'Stability must be between 0 and 1'
      )
    })

    it('throws when similarity boost is out of range', async () => {
      await expect(
        service.textToSpeech('Hi', 'voice-1', undefined, undefined, -0.1)
      ).rejects.toThrow('Similarity boost must be between 0 and 1')
    })

    it('throws when style is out of range', async () => {
      await expect(
        service.textToSpeech('Hi', 'voice-1', undefined, undefined, undefined, 2)
      ).rejects.toThrow('Style must be between 0 and 1')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/text-to-speech/voice-1`).replyWithError({
        message: 'Bad request',
        body: { detail: { message: 'voice_not_found' } },
      })

      await expect(service.textToSpeech('Hi', 'voice-1')).rejects.toThrow('voice_not_found')
    })
  })

  // ── Text to Sound Effects (binary + Files upload) ──

  describe('textToSoundEffects', () => {
    it('sends required params and uploads the generated sound', async () => {
      mock.onPost(`${ BASE }v1/sound-generation`).reply({ body: Buffer.from('sfx') })
      const uploads = stubFiles(service, 'https://files.example.com/elevenlabs/sfx.mp3')

      const result = await service.textToSoundEffects('thunder storm')

      expect(result).toBe('https://files.example.com/elevenlabs/sfx.mp3')
      expect(mock.history[0].url).toBe(`${ BASE }v1/sound-generation`)
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].body).toEqual({ text: 'thunder storm' })
      expect(uploads[0].options.filename).toMatch(/^sfx_\d+\.mp3$/)
      expect(uploads[0].options).toMatchObject({ scope: 'FLOW' })
    })

    it('includes duration and prompt influence when provided', async () => {
      mock.onPost(`${ BASE }v1/sound-generation`).reply({ body: Buffer.from('sfx') })
      stubFiles(service)

      await service.textToSoundEffects('dog barking', 5, 0.7, { scope: 'APP' })

      expect(mock.history[0].body).toEqual({
        text: 'dog barking',
        duration_seconds: 5,
        prompt_influence: 0.7,
      })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/sound-generation`).replyWithError({
        message: 'fail',
        body: { detail: 'quota exceeded' },
      })

      await expect(service.textToSoundEffects('rain')).rejects.toThrow('quota exceeded')
    })
  })

  // ── Speech to Text (multipart) ──

  describe('speechToText', () => {
    it('sends a multipart form with default model', async () => {
      mock.onPost(`${ BASE }v1/speech-to-text`).reply({ text: 'transcribed', audio_duration: 5.2 })

      const result = await service.speechToText('https://example.com/audio.mp3')

      expect(result).toEqual({ text: 'transcribed', audio_duration: 5.2 })
      expect(mock.history[0].headers).toMatchObject({
        'xi-api-key': API_KEY,
        'Content-Type': 'multipart/form-data',
      })
      const fields = mock.history[0].formData._fields
      expect(fields).toEqual([
        { name: 'model_id', value: 'scribe_v1', filename: undefined },
        { name: 'cloud_storage_url', value: 'https://example.com/audio.mp3', filename: undefined },
      ])
    })

    it('includes model and language when provided', async () => {
      mock.onPost(`${ BASE }v1/speech-to-text`).reply({ text: 'hola' })

      await service.speechToText('https://example.com/audio.mp3', 'scribe_v1', 'es')

      const fields = mock.history[0].formData._fields

      expect(fields).toContainEqual({ name: 'language', value: 'es', filename: undefined })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/speech-to-text`).replyWithError({ message: 'bad audio' })

      await expect(service.speechToText('https://example.com/audio.mp3')).rejects.toThrow('bad audio')
    })
  })

  // ── User / Account ──

  describe('getUserInfo', () => {
    it('sends a GET to the user endpoint', async () => {
      mock.onGet(`${ BASE }v1/user`).reply({ user_id: 'u1', subscription: { tier: 'free' } })

      const result = await service.getUserInfo()

      expect(result).toEqual({ user_id: 'u1', subscription: { tier: 'free' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }v1/user`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/user`).replyWithError({ message: 'unauthorized' })

      await expect(service.getUserInfo()).rejects.toThrow('unauthorized')
    })
  })

  // ── Voice Management ──

  describe('getVoice', () => {
    it('sends a GET for a specific voice', async () => {
      mock.onGet(`${ BASE }v1/voices/voice-1`).reply({ voice_id: 'voice-1', name: 'Rachel' })

      const result = await service.getVoice('voice-1')

      expect(result).toEqual({ voice_id: 'voice-1', name: 'Rachel' })
      expect(mock.history[0].url).toBe(`${ BASE }v1/voices/voice-1`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/voices/voice-1`).replyWithError({ message: 'not found' })

      await expect(service.getVoice('voice-1')).rejects.toThrow('not found')
    })
  })

  describe('getVoices', () => {
    it('sends a GET for all voices', async () => {
      mock.onGet(`${ BASE }v1/voices`).reply({ voices: [{ voice_id: 'v1', name: 'Rachel' }] })

      const result = await service.getVoices()

      expect(result).toEqual({ voices: [{ voice_id: 'v1', name: 'Rachel' }] })
      expect(mock.history[0].url).toBe(`${ BASE }v1/voices`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/voices`).replyWithError({ message: 'boom' })

      await expect(service.getVoices()).rejects.toThrow('boom')
    })
  })

  describe('deleteVoice', () => {
    it('sends a DELETE and returns a success object', async () => {
      mock.onDelete(`${ BASE }v1/voices/voice-1`).reply({})

      const result = await service.deleteVoice('voice-1')

      expect(result).toEqual({
        success: true,
        voiceId: 'voice-1',
        message: 'Voice deleted successfully',
      })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }v1/voices/voice-1`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onDelete(`${ BASE }v1/voices/voice-1`).replyWithError({ message: 'cannot delete premade' })

      await expect(service.deleteVoice('voice-1')).rejects.toThrow('cannot delete premade')
    })
  })

  describe('editVoice', () => {
    it('sends only the provided fields as multipart form data', async () => {
      mock.onPost(`${ BASE }v1/voices/voice-1/edit`).reply({ status: 'ok' })

      const result = await service.editVoice('voice-1', 'New Name')

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].url).toBe(`${ BASE }v1/voices/voice-1/edit`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'multipart/form-data' })
      expect(mock.history[0].formData._fields).toEqual([
        { name: 'name', value: 'New Name', filename: undefined },
      ])
    })

    it('serializes object labels to JSON and stringifies the boolean flag', async () => {
      mock.onPost(`${ BASE }v1/voices/voice-1/edit`).reply({ status: 'ok' })

      await service.editVoice('voice-1', 'Name', 'Desc', { accent: 'american' }, true)

      expect(mock.history[0].formData._fields).toEqual([
        { name: 'name', value: 'Name', filename: undefined },
        { name: 'description', value: 'Desc', filename: undefined },
        { name: 'labels', value: '{"accent":"american"}', filename: undefined },
        { name: 'remove_background_noise', value: 'true', filename: undefined },
      ])
    })

    it('passes through a string labels value unchanged', async () => {
      mock.onPost(`${ BASE }v1/voices/voice-1/edit`).reply({ status: 'ok' })

      await service.editVoice('voice-1', undefined, undefined, '{"age":"young"}')

      expect(mock.history[0].formData._fields).toEqual([
        { name: 'labels', value: '{"age":"young"}', filename: undefined },
      ])
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/voices/voice-1/edit`).replyWithError({ message: 'edit failed' })

      await expect(service.editVoice('voice-1', 'Name')).rejects.toThrow('edit failed')
    })
  })

  describe('createVoiceIVC', () => {
    it('downloads the sample, then posts a multipart clone request', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock.onPost(`${ BASE }v1/voices/add`).reply({ voice_id: 'new-voice', requires_verification: false })

      const result = await service.createVoiceIVC('My Clone', 'https://example.com/sample.mp3')

      expect(result).toEqual({ voice_id: 'new-voice', requires_verification: false })
      expect(mock.history).toHaveLength(2)
      // first call: binary download
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://example.com/sample.mp3')
      expect(mock.history[0].encoding).toBeNull()
      // second call: the multipart add
      expect(mock.history[1].url).toBe(`${ BASE }v1/voices/add`)
      const fields = mock.history[1].formData._fields
      expect(fields[0]).toMatchObject({ name: 'name', value: 'My Clone' })
      expect(fields[1]).toMatchObject({ name: 'files', filename: { filename: 'audio.mp3' } })
      expect(Buffer.isBuffer(fields[1].value)).toBe(true)
    })

    it('includes description, labels and background-noise flag when provided', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock.onPost(`${ BASE }v1/voices/add`).reply({ voice_id: 'new-voice' })

      await service.createVoiceIVC(
        'My Clone',
        'https://example.com/sample.mp3',
        'A clone',
        { gender: 'male' },
        false
      )

      const fields = mock.history[1].formData._fields

      expect(fields).toContainEqual({ name: 'description', value: 'A clone', filename: undefined })
      expect(fields).toContainEqual({ name: 'labels', value: '{"gender":"male"}', filename: undefined })
      expect(fields).toContainEqual({
        name: 'remove_background_noise',
        value: 'false',
        filename: undefined,
      })
    })

    it('throws a normalized error when the download fails', async () => {
      mock.onGet('https://example.com/sample.mp3').replyWithError({ message: 'no such file' })

      await expect(
        service.createVoiceIVC('Clone', 'https://example.com/sample.mp3')
      ).rejects.toThrow('Failed to download file: no such file')
    })

    it('throws a normalized error when the add request fails', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock.onPost(`${ BASE }v1/voices/add`).replyWithError({ message: 'clone failed' })

      await expect(
        service.createVoiceIVC('Clone', 'https://example.com/sample.mp3')
      ).rejects.toThrow('clone failed')
    })
  })

  describe('createVoicePVC', () => {
    it('sends a JSON body with required params only', async () => {
      mock.onPost(`${ BASE }v1/voices/pvc`).reply({ voice_id: 'pvc-1' })

      const result = await service.createVoicePVC('Pro Voice', 'en')

      expect(result).toEqual({ voice_id: 'pvc-1' })
      expect(mock.history[0].url).toBe(`${ BASE }v1/voices/pvc`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].body).toEqual({ name: 'Pro Voice', language: 'en' })
    })

    it('includes description and labels when provided', async () => {
      mock.onPost(`${ BASE }v1/voices/pvc`).reply({ voice_id: 'pvc-2' })

      await service.createVoicePVC('Pro', 'es', 'desc', { age: 'young' })

      expect(mock.history[0].body).toEqual({
        name: 'Pro',
        language: 'es',
        description: 'desc',
        labels: { age: 'young' },
      })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/voices/pvc`).replyWithError({ message: 'pvc failed' })

      await expect(service.createVoicePVC('Pro', 'en')).rejects.toThrow('pvc failed')
    })
  })

  describe('addVoiceSamples', () => {
    it('downloads the sample and posts it to the PVC samples endpoint', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock
        .onPost(`${ BASE }v1/voices/pvc/voice-1/samples`)
        .reply([{ sample_id: 's1', file_name: 'sample.mp3' }])

      const result = await service.addVoiceSamples('voice-1', 'https://example.com/sample.mp3')

      expect(result).toEqual([{ sample_id: 's1', file_name: 'sample.mp3' }])
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].url).toBe(`${ BASE }v1/voices/pvc/voice-1/samples`)
      const fields = mock.history[1].formData._fields
      expect(fields[0]).toMatchObject({ name: 'files', filename: { filename: 'sample.mp3' } })
    })

    it('includes the background-noise flag when provided', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock.onPost(`${ BASE }v1/voices/pvc/voice-1/samples`).reply([])

      await service.addVoiceSamples('voice-1', 'https://example.com/sample.mp3', true)

      expect(mock.history[1].formData._fields).toContainEqual({
        name: 'remove_background_noise',
        value: 'true',
        filename: undefined,
      })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet('https://example.com/sample.mp3').reply({ body: Buffer.from('sample') })
      mock.onPost(`${ BASE }v1/voices/pvc/voice-1/samples`).replyWithError({ message: 'sample failed' })

      await expect(
        service.addVoiceSamples('voice-1', 'https://example.com/sample.mp3')
      ).rejects.toThrow('sample failed')
    })
  })

  // ── Voice Generation ──

  describe('designVoice', () => {
    it('auto-generates text when none is provided and uploads base64 previews', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice/design`).reply({
        previews: [
          { generated_voice_id: 'g1', audio_base_64: Buffer.from('audio').toString('base64') },
        ],
        is_already_pro: false,
      })
      const uploads = stubFiles(service, 'https://files.example.com/elevenlabs/preview.mp3')

      const result = await service.designVoice('A deep male voice')

      expect(mock.history[0].url).toBe(`${ BASE }v1/text-to-voice/design`)
      expect(mock.history[0].body).toEqual({
        voice_description: 'A deep male voice',
        model_id: 'eleven_multilingual_ttv_v2',
        auto_generate_text: true,
      })
      // preview base64 replaced with an uploaded url
      expect(result.previews[0].audio_url).toBe('https://files.example.com/elevenlabs/preview.mp3')
      expect(result.previews[0]).not.toHaveProperty('audio_base_64')
      expect(uploads[0].options.filename).toBe('voice_preview_g1.mp3')
    })

    it('uses provided text/model and forwards the output format query', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice/design`).reply({ previews: [], is_already_pro: false })
      stubFiles(service)

      await service.designVoice('Cheerful voice', 'Sample text', 'eleven_ttv_v3', 'mp3_44100_192')

      expect(mock.history[0].body).toEqual({
        voice_description: 'Cheerful voice',
        model_id: 'eleven_ttv_v3',
        text: 'Sample text',
        auto_generate_text: false,
      })
      expect(mock.history[0].query).toMatchObject({ output_format: 'mp3_44100_192' })
    })

    it('returns previews unchanged when they carry no base64 audio', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice/design`).reply({
        previews: [{ generated_voice_id: 'g2' }],
      })

      const result = await service.designVoice('Voice')

      expect(result.previews[0]).toEqual({ generated_voice_id: 'g2' })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice/design`).replyWithError({ message: 'design failed' })

      await expect(service.designVoice('Voice')).rejects.toThrow('design failed')
    })
  })

  describe('createVoiceFromGeneration', () => {
    it('sends the generated voice id and required fields', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice`).reply({ voice_id: 'v-final' })

      const result = await service.createVoiceFromGeneration('My Voice', 'A voice', 'gen-1')

      expect(result).toEqual({ voice_id: 'v-final' })
      expect(mock.history[0].url).toBe(`${ BASE }v1/text-to-voice`)
      expect(mock.history[0].body).toEqual({
        voice_name: 'My Voice',
        voice_description: 'A voice',
        generated_voice_id: 'gen-1',
      })
    })

    it('includes labels when provided', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice`).reply({ voice_id: 'v-final' })

      await service.createVoiceFromGeneration('My Voice', 'A voice', 'gen-1', { age: 'young' })

      expect(mock.history[0].body).toMatchObject({ labels: { age: 'young' } })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }v1/text-to-voice`).replyWithError({ message: 'create failed' })

      await expect(
        service.createVoiceFromGeneration('My Voice', 'A voice', 'gen-1')
      ).rejects.toThrow('create failed')
    })
  })

  // ── Models ──

  describe('getModels', () => {
    it('sends a GET for the models list', async () => {
      mock.onGet(`${ BASE }v1/models`).reply([{ model_id: 'eleven_turbo_v2_5', name: 'Turbo' }])

      const result = await service.getModels()

      expect(result).toEqual([{ model_id: 'eleven_turbo_v2_5', name: 'Turbo' }])
      expect(mock.history[0].url).toBe(`${ BASE }v1/models`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/models`).replyWithError({ message: 'boom' })

      await expect(service.getModels()).rejects.toThrow('boom')
    })
  })

  // ── History ──

  describe('getHistory', () => {
    it('sends a GET with no query params by default', async () => {
      mock.onGet(`${ BASE }v1/history`).reply({ history: [], has_more: false })

      const result = await service.getHistory()

      expect(result).toEqual({ history: [], has_more: false })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all query params when provided', async () => {
      mock.onGet(`${ BASE }v1/history`).reply({ history: [] })

      await service.getHistory(50, 'hist-1', 'voice-1')

      expect(mock.history[0].query).toEqual({
        page_size: 50,
        start_after_history_item_id: 'hist-1',
        voice_id: 'voice-1',
      })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/history`).replyWithError({ message: 'boom' })

      await expect(service.getHistory()).rejects.toThrow('boom')
    })
  })

  describe('getHistoryItemAudio', () => {
    it('downloads history item audio and uploads it', async () => {
      mock.onGet(`${ BASE }v1/history/hist-1/audio`).reply({ body: Buffer.from('audio') })
      const uploads = stubFiles(service, 'https://files.example.com/elevenlabs/history.mp3')

      const result = await service.getHistoryItemAudio('hist-1')

      expect(result).toBe('https://files.example.com/elevenlabs/history.mp3')
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }v1/history/hist-1/audio`)
      expect(mock.history[0].encoding).toBeNull()
      expect(uploads[0].options.filename).toBe('history_hist-1.mp3')
      expect(uploads[0].options).toMatchObject({ scope: 'FLOW' })
    })

    it('forwards custom file options', async () => {
      mock.onGet(`${ BASE }v1/history/hist-1/audio`).reply({ body: Buffer.from('audio') })
      const uploads = stubFiles(service)

      await service.getHistoryItemAudio('hist-1', { scope: 'APP' })

      expect(uploads[0].options).toMatchObject({ scope: 'APP' })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/history/hist-1/audio`).replyWithError({ message: 'no audio' })

      await expect(service.getHistoryItemAudio('hist-1')).rejects.toThrow('no audio')
    })
  })

  describe('deleteHistoryItem', () => {
    it('sends a DELETE for the history item', async () => {
      mock.onDelete(`${ BASE }v1/history/hist-1`).reply({ status: 'ok' })

      const result = await service.deleteHistoryItem('hist-1')

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }v1/history/hist-1`)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onDelete(`${ BASE }v1/history/hist-1`).replyWithError({ message: 'boom' })

      await expect(service.deleteHistoryItem('hist-1')).rejects.toThrow('boom')
    })
  })

  // ── Dictionaries ──

  describe('getVoicesDictionary', () => {
    const voicesResponse = {
      voices: [
        { voice_id: 'v1', name: 'Rachel', category: 'premade' },
        { voice_id: 'v2', name: 'Domi', category: 'premade' },
        { voice_id: 'v3', name: 'Custom Guy' },
      ],
    }

    it('maps voices to dictionary items', async () => {
      mock.onGet(`${ BASE }v1/voices`).reply(voicesResponse)

      const result = await service.getVoicesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Rachel (premade)', value: 'v1', note: 'Category: premade' },
        { label: 'Domi (premade)', value: 'v2', note: 'Category: premade' },
        { label: 'Custom Guy (custom)', value: 'v3', note: 'Category: custom' },
      ])
    })

    it('filters voices by search term', async () => {
      mock.onGet(`${ BASE }v1/voices`).reply(voicesResponse)

      const result = await service.getVoicesDictionary({ search: 'rachel' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('v1')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }v1/voices`).reply({ voices: [] })

      const result = await service.getVoicesDictionary(null)

      expect(result.items).toEqual([])
    })

    it('handles a response without a voices array', async () => {
      mock.onGet(`${ BASE }v1/voices`).reply({})

      const result = await service.getVoicesDictionary({})

      expect(result.items).toEqual([])
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/voices`).replyWithError({ message: 'boom' })

      await expect(service.getVoicesDictionary({})).rejects.toThrow('boom')
    })
  })

  describe('getModelsDictionary', () => {
    const modelsResponse = [
      { model_id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', description: 'Fast' },
      { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
    ]

    it('maps models to dictionary items', async () => {
      mock.onGet(`${ BASE }v1/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Turbo v2.5', value: 'eleven_turbo_v2_5', note: 'Fast' },
        { label: 'Multilingual v2', value: 'eleven_multilingual_v2', note: 'eleven_multilingual_v2' },
      ])
    })

    it('filters models by name or model_id', async () => {
      mock.onGet(`${ BASE }v1/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'multilingual' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('eleven_multilingual_v2')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }v1/models`).reply([])

      const result = await service.getModelsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }v1/models`).replyWithError({ message: 'boom' })

      await expect(service.getModelsDictionary({})).rejects.toThrow('boom')
    })
  })
})
