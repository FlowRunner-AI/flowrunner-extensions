'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-heygen-api-key'
const BASE = 'https://api.heygen.com'

describe('HeyGen Service', () => {
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

  // ── Videos ──

  describe('createAvatarVideo', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_123', status: 'pending' } })

      const result = await service.createAvatarVideo('avatar_001', 'Hello world')

      expect(result).toEqual({ video_id: 'vid_123', status: 'pending' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
      expect(mock.history[0].body).toMatchObject({
        type: 'avatar',
        avatar_id: 'avatar_001',
        script: 'Hello world',
      })
    })

    it('sends optional fields when provided', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_456', status: 'pending' } })

      await service.createAvatarVideo(
        'avatar_001', 'Hello', 'voice_1', undefined, undefined,
        'My Video', '4K', '16:9', 'Contain',
        '#008000', undefined, undefined, true, 'wave hands',
        'High', 'Avatar V', 1.2, 5, 'en-US',
        'Sidecar File (SRT)', 'WebM', 'https://cb.test', 'cb_1'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'avatar',
        avatar_id: 'avatar_001',
        script: 'Hello',
        voice_id: 'voice_1',
        title: 'My Video',
        resolution: '4k',
        aspect_ratio: '16:9',
        fit: 'contain',
        background: { type: 'color', value: '#008000' },
        remove_background: true,
        motion_prompt: 'wave hands',
        expressiveness: 'high',
        engine: { type: 'avatar_v' },
        voice_settings: { speed: 1.2, pitch: 5, locale: 'en-US' },
        caption: { file_format: 'srt' },
        output_format: 'webm',
        callback_url: 'https://cb.test',
        callback_id: 'cb_1',
      })
    })

    it('builds burned-in caption correctly', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_789' } })

      await service.createAvatarVideo(
        'avatar_001', 'Hello', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        'Burned Into Video'
      )

      expect(mock.history[0].body.caption).toEqual({ file_format: 'srt', style: 'default' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/v3/videos`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid avatar_id' } },
      })

      await expect(service.createAvatarVideo('bad_id')).rejects.toThrow('HeyGen API error')
    })
  })

  describe('getVideo', () => {
    it('sends GET with video ID', async () => {
      mock.onGet(`${BASE}/v3/videos/vid_123`).reply({ data: { id: 'vid_123', status: 'completed' } })

      const result = await service.getVideo('vid_123')

      expect(result).toEqual({ id: 'vid_123', status: 'completed' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/v3/videos/vid_123`)
    })
  })

  describe('listVideos', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/v3/videos`).reply({ data: [], has_more: false })

      await service.listVideos(10, 'tok_abc', 'folder_1', 'My Video')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        token: 'tok_abc',
        folder_id: 'folder_1',
        title: 'My Video',
      })
    })
  })

  describe('deleteVideo', () => {
    it('sends DELETE with video ID', async () => {
      mock.onDelete(`${BASE}/v3/videos/vid_123`).reply({ data: { id: 'vid_123', deleted: true } })

      const result = await service.deleteVideo('vid_123')

      expect(result).toEqual({ id: 'vid_123', deleted: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getBulkVideoStatuses', () => {
    it('joins video IDs and batch IDs with commas', async () => {
      mock.onGet(`${BASE}/v3/videos/statuses`).reply({ data: [] })

      await service.getBulkVideoStatuses(['v1', 'v2'], ['b1'])

      expect(mock.history[0].query).toMatchObject({
        video_ids: 'v1,v2',
        batch_ids: 'b1',
      })
    })
  })

  describe('createVideoBatch', () => {
    it('sends POST with videos array', async () => {
      mock.onPost(`${BASE}/v3/videos/batches`).reply({ data: { batch_id: 'btch_1' } })

      const videos = [{ type: 'avatar', avatar_id: 'a1', script: 'Hi' }]
      const result = await service.createVideoBatch(videos, 'Batch 1', 'https://cb.test')

      expect(result).toEqual({ batch_id: 'btch_1' })
      expect(mock.history[0].body).toMatchObject({
        videos,
        title: 'Batch 1',
        callback_url: 'https://cb.test',
      })
    })
  })

  describe('getVideoBatch', () => {
    it('sends GET with batch ID and pagination', async () => {
      mock.onGet(`${BASE}/v3/videos/batches/btch_1`).reply({ data: { batch_id: 'btch_1' } })

      await service.getVideoBatch('btch_1', 20, 'tok_x')

      expect(mock.history[0].query).toMatchObject({ limit: 20, token: 'tok_x' })
    })
  })

  describe('createVideoFromImage', () => {
    it('sends correct body with image URL', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_img1' } })

      await service.createVideoFromImage(
        'https://example.com/photo.jpg', undefined,
        'Hello from image', 'voice_1'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'image',
        image: { type: 'url', url: 'https://example.com/photo.jpg' },
        script: 'Hello from image',
        voice_id: 'voice_1',
      })
    })

    it('sends correct body with image asset ID', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_img2' } })

      await service.createVideoFromImage(
        undefined, 'ast_photo1',
        'Hello from asset', 'voice_2'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'image',
        image: { type: 'asset_id', asset_id: 'ast_photo1' },
      })
    })
  })

  describe('createCinematicAvatarVideo', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/v3/videos`).reply({ data: { video_id: 'vid_cin1' } })

      await service.createCinematicAvatarVideo(
        'A cinematic scene', ['av_1', 'av_2'],
        ['https://ref.com/img.png'], ['ast_ref1'],
        '16:9', '1080p', 10, false, true, 'Cinematic Test'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'cinematic_avatar',
        prompt: 'A cinematic scene',
        avatar_id: ['av_1', 'av_2'],
        references: [
          { type: 'url', url: 'https://ref.com/img.png' },
          { type: 'asset_id', asset_id: 'ast_ref1' },
        ],
        aspect_ratio: '16:9',
        resolution: '1080p',
        duration: 10,
        enhance_prompt: true,
        title: 'Cinematic Test',
      })
    })
  })

  // ── Video Agent ──

  describe('createVideoAgentSession', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/v3/video-agents`).reply({ data: { session_id: 'vas_1' } })

      await service.createVideoAgentSession(
        'Make a product demo', 'Generate', 'av_1', 'voice_1',
        'style_1', 'bk_1', 'Landscape',
        ['https://file.com/ref.mp4'], ['ast_f1'],
        true, 'https://cb.test', 'cb_1'
      )

      expect(mock.history[0].body).toMatchObject({
        prompt: 'Make a product demo',
        mode: 'generate',
        avatar_id: 'av_1',
        voice_id: 'voice_1',
        style_id: 'style_1',
        brand_kit_id: 'bk_1',
        orientation: 'landscape',
        files: [
          { type: 'url', url: 'https://file.com/ref.mp4' },
          { type: 'asset_id', asset_id: 'ast_f1' },
        ],
        incognito_mode: true,
        callback_url: 'https://cb.test',
        callback_id: 'cb_1',
      })
    })
  })

  describe('getVideoAgentSession', () => {
    it('sends GET with session ID', async () => {
      mock.onGet(`${BASE}/v3/video-agents/vas_1`).reply({ data: { session_id: 'vas_1', status: 'completed' } })

      const result = await service.getVideoAgentSession('vas_1')

      expect(result).toEqual({ session_id: 'vas_1', status: 'completed' })
    })
  })

  describe('listVideoAgentSessions', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/video-agents`).reply({ data: [], has_more: false })

      await service.listVideoAgentSessions(25, 'tok_va')

      expect(mock.history[0].query).toMatchObject({ limit: 25, token: 'tok_va' })
    })
  })

  describe('listVideoAgentSessionVideos', () => {
    it('sends GET with session ID', async () => {
      mock.onGet(`${BASE}/v3/video-agents/vas_1/videos`).reply({ data: [] })

      await service.listVideoAgentSessionVideos('vas_1')

      expect(mock.history[0].url).toBe(`${BASE}/v3/video-agents/vas_1/videos`)
    })
  })

  describe('listVideoAgentStyles', () => {
    it('sends GET with tag and pagination', async () => {
      mock.onGet(`${BASE}/v3/video-agents/styles`).reply({ data: [] })

      await service.listVideoAgentStyles('cinematic', 10, 'tok_s')

      expect(mock.history[0].query).toMatchObject({ tag: 'cinematic', limit: 10, token: 'tok_s' })
    })
  })

  describe('getVideoAgentSessionResource', () => {
    it('sends GET with session and resource ID', async () => {
      mock.onGet(`${BASE}/v3/video-agents/vas_1/resources/res_1`).reply({ data: { resource_id: 'res_1' } })

      const result = await service.getVideoAgentSessionResource('vas_1', 'res_1')

      expect(result).toEqual({ resource_id: 'res_1' })
    })
  })

  describe('sendVideoAgentMessage', () => {
    it('sends POST with message and overrides', async () => {
      mock.onPost(`${BASE}/v3/video-agents/vas_1`).reply({ data: { session_id: 'vas_1' } })

      await service.sendVideoAgentMessage(
        'vas_1', 'Make it more energetic', 'av_2', 'voice_2', 'bk_2',
        ['https://file.com/new.png'], undefined
      )

      expect(mock.history[0].body).toMatchObject({
        message: 'Make it more energetic',
        avatar_id: 'av_2',
        voice_id: 'voice_2',
        brand_kit_id: 'bk_2',
        files: [{ type: 'url', url: 'https://file.com/new.png' }],
      })
    })
  })

  describe('stopVideoAgentSession', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/v3/video-agents/vas_1/stop`).reply({ data: { session_id: 'vas_1' } })

      await service.stopVideoAgentSession('vas_1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Avatars ──

  describe('createPhotoAvatar', () => {
    it('sends POST with photo URL', async () => {
      mock.onPost(`${BASE}/v3/avatars`).reply({ data: { avatar_item: { id: 'lk_1' } } })

      await service.createPhotoAvatar('Alex', 'https://photo.com/face.jpg')

      expect(mock.history[0].body).toMatchObject({
        type: 'photo',
        name: 'Alex',
        file: { type: 'url', url: 'https://photo.com/face.jpg' },
      })
    })

    it('sends POST with photo asset ID', async () => {
      mock.onPost(`${BASE}/v3/avatars`).reply({ data: { avatar_item: { id: 'lk_2' } } })

      await service.createPhotoAvatar('Alex', undefined, 'ast_photo1', 'ag_1')

      expect(mock.history[0].body).toMatchObject({
        type: 'photo',
        name: 'Alex',
        file: { type: 'asset_id', asset_id: 'ast_photo1' },
        avatar_group_id: 'ag_1',
      })
    })
  })

  describe('createDigitalTwinAvatar', () => {
    it('sends POST with footage URL', async () => {
      mock.onPost(`${BASE}/v3/avatars`).reply({ data: { avatar_item: { id: 'lk_dt1' } } })

      await service.createDigitalTwinAvatar('Twin', 'https://footage.com/video.mp4')

      expect(mock.history[0].body).toMatchObject({
        type: 'digital_twin',
        name: 'Twin',
        file: { type: 'url', url: 'https://footage.com/video.mp4' },
      })
    })
  })

  describe('createAiAvatarFromPrompt', () => {
    it('sends POST with prompt and references', async () => {
      mock.onPost(`${BASE}/v3/avatars`).reply({ data: { avatar_item: { id: 'lk_ai1' } } })

      await service.createAiAvatarFromPrompt(
        'Nova', 'Professional woman in a suit',
        ['https://ref.com/img.jpg'], undefined, 'ag_1', 'av_ref1'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'prompt',
        name: 'Nova',
        prompt: 'Professional woman in a suit',
        reference_images: [{ type: 'url', url: 'https://ref.com/img.jpg' }],
        avatar_group_id: 'ag_1',
        avatar_id: 'av_ref1',
      })
    })
  })

  describe('createAvatarConsent', () => {
    it('sends POST with group ID', async () => {
      mock.onPost(`${BASE}/v3/avatars/ag_1/consent`).reply({ data: { avatar_group: { id: 'ag_1' } } })

      await service.createAvatarConsent('ag_1', 'https://redirect.com', 'I consent')

      expect(mock.history[0].body).toMatchObject({
        reroute_url: 'https://redirect.com',
        consent_text: 'I consent',
      })
    })
  })

  describe('listAvatarGroups', () => {
    it('sends GET with ownership filter', async () => {
      mock.onGet(`${BASE}/v3/avatars`).reply({ data: [], has_more: false })

      await service.listAvatarGroups('Private', 50, 'tok_ag')

      expect(mock.history[0].query).toMatchObject({
        ownership: 'private',
        limit: 50,
        token: 'tok_ag',
      })
    })
  })

  describe('getAvatarGroup', () => {
    it('sends GET with group ID', async () => {
      mock.onGet(`${BASE}/v3/avatars/ag_1`).reply({ data: { id: 'ag_1', name: 'Alex' } })

      const result = await service.getAvatarGroup('ag_1')

      expect(result).toEqual({ id: 'ag_1', name: 'Alex' })
    })
  })

  describe('deleteAvatarGroup', () => {
    it('sends DELETE with group ID', async () => {
      mock.onDelete(`${BASE}/v3/avatars/ag_1`).reply({ data: { id: 'ag_1' } })

      const result = await service.deleteAvatarGroup('ag_1')

      expect(result).toEqual({ id: 'ag_1' })
    })
  })

  describe('listAvatarLooks', () => {
    it('resolves avatar type and ownership choices', async () => {
      mock.onGet(`${BASE}/v3/avatars/looks`).reply({ data: [], has_more: false })

      await service.listAvatarLooks('ag_1', 'Studio Avatar', 'Public', 25)

      expect(mock.history[0].query).toMatchObject({
        group_id: 'ag_1',
        avatar_type: 'studio_avatar',
        ownership: 'public',
        limit: 25,
      })
    })
  })

  describe('getAvatarLook', () => {
    it('sends GET with look ID', async () => {
      mock.onGet(`${BASE}/v3/avatars/looks/lk_1`).reply({ data: { id: 'lk_1' } })

      const result = await service.getAvatarLook('lk_1')

      expect(result).toEqual({ id: 'lk_1' })
    })
  })

  describe('updateAvatarLook', () => {
    it('sends PATCH with new name', async () => {
      mock.onPatch(`${BASE}/v3/avatars/looks/lk_1`).reply({ data: { id: 'lk_1', name: 'Updated' } })

      await service.updateAvatarLook('lk_1', 'Updated')

      expect(mock.history[0].body).toEqual({ name: 'Updated' })
    })
  })

  describe('deleteAvatarLook', () => {
    it('sends DELETE with look ID', async () => {
      mock.onDelete(`${BASE}/v3/avatars/looks/lk_1`).reply({ data: { id: 'lk_1' } })

      const result = await service.deleteAvatarLook('lk_1')

      expect(result).toEqual({ id: 'lk_1' })
    })
  })

  // ── Voices & Audio ──

  describe('listVoices', () => {
    it('sends GET with resolved filters', async () => {
      mock.onGet(`${BASE}/v3/voices`).reply({ data: [], has_more: false })

      await service.listVoices('Private', 'starfish', 'English', 'Female', 50, 'tok_v')

      expect(mock.history[0].query).toMatchObject({
        type: 'private',
        engine: 'starfish',
        language: 'English',
        gender: 'female',
        limit: 50,
        token: 'tok_v',
      })
    })
  })

  describe('getVoice', () => {
    it('sends GET with voice ID', async () => {
      mock.onGet(`${BASE}/v3/voices/vc_1`).reply({ data: { voice_id: 'vc_1', name: 'Test Voice' } })

      const result = await service.getVoice('vc_1')

      expect(result).toEqual({ voice_id: 'vc_1', name: 'Test Voice' })
    })
  })

  describe('designVoice', () => {
    it('sends POST with prompt and filters', async () => {
      mock.onPost(`${BASE}/v3/voices`).reply({ data: { voices: [], seed: 0 } })

      await service.designVoice('warm narrator', 'Female', 'en-US', 1)

      expect(mock.history[0].body).toMatchObject({
        prompt: 'warm narrator',
        gender: 'female',
        locale: 'en-US',
        seed: 1,
      })
    })
  })

  describe('cloneVoice', () => {
    it('sends POST with audio URL', async () => {
      mock.onPost(`${BASE}/v3/voices/clone`).reply({ data: { voice_clone_id: 'vc_clone1' } })

      await service.cloneVoice('https://audio.com/sample.mp3', undefined, 'My Voice', 'en', true)

      expect(mock.history[0].body).toMatchObject({
        audio: { type: 'url', url: 'https://audio.com/sample.mp3' },
        voice_name: 'My Voice',
        language: 'en',
        remove_background_noise: true,
      })
    })
  })

  describe('deleteVoice', () => {
    it('sends DELETE with voice ID', async () => {
      mock.onDelete(`${BASE}/v3/voices/vc_1`).reply({ data: { voice_id: 'vc_1' } })

      const result = await service.deleteVoice('vc_1')

      expect(result).toEqual({ voice_id: 'vc_1' })
    })
  })

  describe('generateSpeech', () => {
    it('sends POST with text and voice', async () => {
      mock.onPost(`${BASE}/v3/voices/speech`).reply({ data: { audio_url: 'https://audio.com/out.mp3', duration: 5.5 } })

      const result = await service.generateSpeech('Hello world', 'vc_1', 'Text', 1.5, 'en', 'en-US')

      expect(result).toEqual({ audio_url: 'https://audio.com/out.mp3', duration: 5.5 })
      expect(mock.history[0].body).toMatchObject({
        text: 'Hello world',
        voice_id: 'vc_1',
        input_type: 'text',
        speed: 1.5,
        language: 'en',
        locale: 'en-US',
      })
    })

    it('resolves SSML input type', async () => {
      mock.onPost(`${BASE}/v3/voices/speech`).reply({ data: { audio_url: 'https://audio.com/out.mp3' } })

      await service.generateSpeech('<speak>Hi</speak>', 'vc_1', 'SSML')

      expect(mock.history[0].body.input_type).toBe('ssml')
    })
  })

  describe('searchAudioLibrary', () => {
    it('sends GET with resolved type', async () => {
      mock.onGet(`${BASE}/v3/audio/sounds`).reply({ data: [], has_more: false })

      await service.searchAudioLibrary('upbeat lofi', 'Sound Effects', 10, 0.5, 'tok_a')

      expect(mock.history[0].query).toMatchObject({
        query: 'upbeat lofi',
        type: 'sound_effects',
        limit: 10,
        min_score: 0.5,
        token: 'tok_a',
      })
    })
  })

  // ── Lipsync ──

  describe('createLipsync', () => {
    it('sends POST with video and audio inputs', async () => {
      mock.onPost(`${BASE}/v3/lipsyncs`).reply({ data: { lipsync_id: 'ls_1' } })

      await service.createLipsync(
        'https://video.com/src.mp4', undefined,
        'https://audio.com/dub.mp3', undefined,
        'Dubbed intro', 'Precision'
      )

      expect(mock.history[0].body).toMatchObject({
        video: { type: 'url', url: 'https://video.com/src.mp4' },
        audio: { type: 'url', url: 'https://audio.com/dub.mp3' },
        title: 'Dubbed intro',
        mode: 'precision',
      })
    })
  })

  describe('getLipsync', () => {
    it('sends GET with lipsync ID', async () => {
      mock.onGet(`${BASE}/v3/lipsyncs/ls_1`).reply({ data: { id: 'ls_1', status: 'completed' } })

      const result = await service.getLipsync('ls_1')

      expect(result).toEqual({ id: 'ls_1', status: 'completed' })
    })
  })

  describe('listLipsyncs', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/lipsyncs`).reply({ data: [], has_more: false })

      await service.listLipsyncs(10, 'tok_ls')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_ls' })
    })
  })

  describe('updateLipsync', () => {
    it('sends PATCH with new title', async () => {
      mock.onPatch(`${BASE}/v3/lipsyncs/ls_1`).reply({ data: { id: 'ls_1', title: 'New Title' } })

      await service.updateLipsync('ls_1', 'New Title')

      expect(mock.history[0].body).toEqual({ title: 'New Title' })
    })
  })

  describe('deleteLipsync', () => {
    it('sends DELETE with lipsync ID', async () => {
      mock.onDelete(`${BASE}/v3/lipsyncs/ls_1`).reply({ data: { id: 'ls_1' } })

      const result = await service.deleteLipsync('ls_1')

      expect(result).toEqual({ id: 'ls_1' })
    })
  })

  describe('createLipsyncBatch', () => {
    it('sends POST with lipsyncs array', async () => {
      mock.onPost(`${BASE}/v3/lipsyncs/batches`).reply({ data: { batch_id: 'btch_ls_1' } })

      const lipsyncs = [{ video: { type: 'url', url: 'https://v.com/1.mp4' }, audio: { type: 'url', url: 'https://a.com/1.mp3' } }]
      await service.createLipsyncBatch(lipsyncs, 'Batch', 'https://cb.test')

      expect(mock.history[0].body).toMatchObject({
        lipsyncs,
        title: 'Batch',
        callback_url: 'https://cb.test',
      })
    })
  })

  describe('getLipsyncBatch', () => {
    it('sends GET with batch ID', async () => {
      mock.onGet(`${BASE}/v3/lipsyncs/batches/btch_ls_1`).reply({ data: { batch_id: 'btch_ls_1' } })

      await service.getLipsyncBatch('btch_ls_1', 20, 'tok_lb')

      expect(mock.history[0].query).toMatchObject({ limit: 20, token: 'tok_lb' })
    })
  })

  describe('getBulkLipsyncStatuses', () => {
    it('joins IDs with commas', async () => {
      mock.onGet(`${BASE}/v3/lipsyncs/statuses`).reply({ data: [] })

      await service.getBulkLipsyncStatuses(['ls_1', 'ls_2'], ['btch_1'])

      expect(mock.history[0].query).toMatchObject({
        lipsync_ids: 'ls_1,ls_2',
        batch_ids: 'btch_1',
      })
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/templates`).reply({ data: [], has_more: false })

      await service.listTemplates(10, 'tok_tpl')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_tpl' })
    })
  })

  describe('getTemplate', () => {
    it('sends GET with template ID', async () => {
      mock.onGet(`${BASE}/v3/templates/tpl_1`).reply({ data: { id: 'tpl_1', name: 'Weekly' } })

      const result = await service.getTemplate('tpl_1')

      expect(result).toEqual({ id: 'tpl_1', name: 'Weekly' })
    })
  })

  describe('generateVideoFromTemplate', () => {
    it('sends POST with variables', async () => {
      mock.onPost(`${BASE}/v3/templates/tpl_1`).reply({ data: { id: 'vid_tpl1', status: 'pending' } })

      const variables = { headline: { name: 'headline', type: 'text', properties: { content: 'News!' } } }
      await service.generateVideoFromTemplate('tpl_1', variables, 'My Video')

      expect(mock.history[0].body).toMatchObject({
        variables,
        title: 'My Video',
      })
    })

    it('throws when only width is provided without height', async () => {
      await expect(
        service.generateVideoFromTemplate('tpl_1', {}, undefined, undefined, undefined, undefined, undefined, 1920)
      ).rejects.toThrow('Output Width and Output Height must be provided together')
    })

    it('includes dimension when both width and height are set', async () => {
      mock.onPost(`${BASE}/v3/templates/tpl_1`).reply({ data: { id: 'vid_tpl2' } })

      await service.generateVideoFromTemplate(
        'tpl_1', {}, undefined, undefined, undefined, undefined, undefined,
        1920, 1080
      )

      expect(mock.history[0].body.dimension).toEqual({ width: 1920, height: 1080 })
    })
  })

  // ── Video Translation ──

  describe('createVideoTranslation', () => {
    it('sends POST with output languages', async () => {
      mock.onPost(`${BASE}/v3/video-translations`).reply({ data: { video_translation_ids: ['vt_1'] } })

      await service.createVideoTranslation(
        'https://video.com/src.mp4', undefined,
        'Spanish (Spain)', ['French'],
        'Promo ES'
      )

      expect(mock.history[0].body).toMatchObject({
        video: { type: 'url', url: 'https://video.com/src.mp4' },
        output_languages: ['Spanish (Spain)', 'French'],
        title: 'Promo ES',
      })
    })

    it('throws when no output languages provided', async () => {
      await expect(
        service.createVideoTranslation('https://v.com/x.mp4', undefined, undefined, undefined, 'Test')
      ).rejects.toThrow('Provide an Output Language')
    })
  })

  describe('getVideoTranslation', () => {
    it('sends GET with translation ID', async () => {
      mock.onGet(`${BASE}/v3/video-translations/vt_1`).reply({ data: { id: 'vt_1', status: 'completed' } })

      const result = await service.getVideoTranslation('vt_1')

      expect(result).toEqual({ id: 'vt_1', status: 'completed' })
    })
  })

  describe('listVideoTranslations', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/video-translations`).reply({ data: [], has_more: false })

      await service.listVideoTranslations(10, 'tok_vt')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_vt' })
    })
  })

  describe('updateVideoTranslation', () => {
    it('sends PATCH with new title', async () => {
      mock.onPatch(`${BASE}/v3/video-translations/vt_1`).reply({ data: { id: 'vt_1', title: 'New' } })

      await service.updateVideoTranslation('vt_1', 'New')

      expect(mock.history[0].body).toEqual({ title: 'New' })
    })
  })

  describe('deleteVideoTranslation', () => {
    it('sends DELETE with translation ID', async () => {
      mock.onDelete(`${BASE}/v3/video-translations/vt_1`).reply({ data: { id: 'vt_1' } })

      const result = await service.deleteVideoTranslation('vt_1')

      expect(result).toEqual({ id: 'vt_1' })
    })
  })

  describe('listTranslationTargetLanguages', () => {
    it('sends GET and returns languages', async () => {
      mock.onGet(`${BASE}/v3/video-translations/languages`).reply({ data: { languages: ['English', 'French'] } })

      const result = await service.listTranslationTargetLanguages()

      expect(result).toEqual({ languages: ['English', 'French'] })
    })
  })

  describe('getBulkVideoTranslationStatuses', () => {
    it('joins IDs with commas', async () => {
      mock.onGet(`${BASE}/v3/video-translations/statuses`).reply({ data: [] })

      await service.getBulkVideoTranslationStatuses(['vt_1', 'vt_2'], ['btch_1'])

      expect(mock.history[0].query).toMatchObject({
        video_translation_ids: 'vt_1,vt_2',
        batch_ids: 'btch_1',
      })
    })
  })

  describe('createVideoTranslationBatch', () => {
    it('sends POST with translations array', async () => {
      mock.onPost(`${BASE}/v3/video-translations/batches`).reply({ data: { batch_id: 'btch_vt_1' } })

      const translations = [{ video: { type: 'url', url: 'https://v.com/1.mp4' }, output_languages: ['French'] }]
      await service.createVideoTranslationBatch(translations, 'Wave 1', 'https://cb.test')

      expect(mock.history[0].body).toMatchObject({
        video_translations: translations,
        title: 'Wave 1',
        callback_url: 'https://cb.test',
      })
    })
  })

  describe('getVideoTranslationBatch', () => {
    it('sends GET with batch ID', async () => {
      mock.onGet(`${BASE}/v3/video-translations/batches/btch_vt_1`).reply({ data: { batch_id: 'btch_vt_1' } })

      await service.getVideoTranslationBatch('btch_vt_1', 20, 'tok_vtb')

      expect(mock.history[0].query).toMatchObject({ limit: 20, token: 'tok_vtb' })
    })
  })

  // ── Proofread ──

  describe('createProofreadSession', () => {
    it('sends POST with video and output languages', async () => {
      mock.onPost(`${BASE}/v3/video-translations/proofreads`).reply({ data: { proofread_ids: ['pr_1'] } })

      await service.createProofreadSession(
        'https://video.com/src.mp4', undefined,
        'French', undefined, 'Review FR'
      )

      expect(mock.history[0].body).toMatchObject({
        video: { type: 'url', url: 'https://video.com/src.mp4' },
        output_languages: ['French'],
        title: 'Review FR',
      })
    })

    it('throws when no output languages provided', async () => {
      await expect(
        service.createProofreadSession('https://v.com/x.mp4', undefined, undefined, undefined, 'Test')
      ).rejects.toThrow('Provide an Output Language')
    })
  })

  describe('getProofreadSession', () => {
    it('sends GET with proofread ID', async () => {
      mock.onGet(`${BASE}/v3/video-translations/proofreads/pr_1`).reply({ data: { id: 'pr_1' } })

      const result = await service.getProofreadSession('pr_1')

      expect(result).toEqual({ id: 'pr_1' })
    })
  })

  describe('getProofreadSrtUrls', () => {
    it('sends GET with proofread ID', async () => {
      mock.onGet(`${BASE}/v3/video-translations/proofreads/pr_1/srt`).reply({ data: { srt_url: 'https://srt.com/edit.srt' } })

      const result = await service.getProofreadSrtUrls('pr_1')

      expect(result).toEqual({ srt_url: 'https://srt.com/edit.srt' })
    })
  })

  describe('uploadProofreadSrt', () => {
    it('sends PUT with SRT URL', async () => {
      mock.onPut(`${BASE}/v3/video-translations/proofreads/pr_1/srt`).reply({ data: { id: 'pr_1' } })

      await service.uploadProofreadSrt('pr_1', 'https://srt.com/edited.srt')

      expect(mock.history[0].body).toEqual({
        srt: { type: 'url', url: 'https://srt.com/edited.srt' },
      })
    })
  })

  describe('generateVideoFromProofread', () => {
    it('sends POST with proofread ID', async () => {
      mock.onPost(`${BASE}/v3/video-translations/proofreads/pr_1/generate`).reply({ data: { video_translation_id: 'vt_pr1' } })

      await service.generateVideoFromProofread('pr_1', true, false, 'https://cb.test', 'cb_1')

      expect(mock.history[0].body).toMatchObject({
        captions: true,
        callback_url: 'https://cb.test',
        callback_id: 'cb_1',
      })
    })
  })

  // ── AI Clipping ──

  describe('createAiClippingJob', () => {
    it('sends POST with resolved duration types and aspect ratio', async () => {
      mock.onPost(`${BASE}/v3/ai-clipping`).reply({ data: { id: 'clip_1', status: 'pending' } })

      await service.createAiClippingJob(
        'https://video.com/long.mp4', undefined,
        'Keynote', 'en',
        ['30 Seconds', '60 Seconds'], 'Portrait',
        true, 'bold', 'focus on pricing'
      )

      expect(mock.history[0].body).toMatchObject({
        video: { type: 'url', url: 'https://video.com/long.mp4' },
        title: 'Keynote',
        input_language: 'en',
        output_settings: {
          duration_types: ['30', '60'],
          aspect_ratio: 'portrait',
          captions: true,
          caption_style: 'bold',
          prompt: 'focus on pricing',
        },
      })
    })
  })

  describe('getAiClippingJob', () => {
    it('sends GET with job ID', async () => {
      mock.onGet(`${BASE}/v3/ai-clipping/clip_1`).reply({ data: { id: 'clip_1', status: 'completed' } })

      const result = await service.getAiClippingJob('clip_1')

      expect(result).toEqual({ id: 'clip_1', status: 'completed' })
    })
  })

  describe('listAiClippingJobs', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/ai-clipping`).reply({ data: [], has_more: false })

      await service.listAiClippingJobs(5, 'tok_cl')

      expect(mock.history[0].query).toMatchObject({ limit: 5, token: 'tok_cl' })
    })
  })

  describe('deleteAiClippingJob', () => {
    it('sends DELETE with job ID', async () => {
      mock.onDelete(`${BASE}/v3/ai-clipping/clip_1`).reply({ data: { id: 'clip_1' } })

      const result = await service.deleteAiClippingJob('clip_1')

      expect(result).toEqual({ id: 'clip_1' })
    })
  })

  // ── Background Removal ──

  describe('createBackgroundRemoval', () => {
    it('sends POST with video and resolved layers', async () => {
      mock.onPost(`${BASE}/v3/background-removals`).reply({ data: { id: 'bgr_1', status: 'processing' } })

      await service.createBackgroundRemoval(
        'https://video.com/clip.mp4', undefined,
        ['Foreground', 'Mask'], 'BG Removal', 'req_idempotent'
      )

      expect(mock.history[0].body).toMatchObject({
        video: { type: 'url', url: 'https://video.com/clip.mp4' },
        layers: ['foreground', 'mask'],
        title: 'BG Removal',
        request_id: 'req_idempotent',
      })
    })
  })

  describe('getBackgroundRemoval', () => {
    it('sends GET with job ID', async () => {
      mock.onGet(`${BASE}/v3/background-removals/bgr_1`).reply({ data: { id: 'bgr_1', status: 'completed' } })

      const result = await service.getBackgroundRemoval('bgr_1')

      expect(result).toEqual({ id: 'bgr_1', status: 'completed' })
    })
  })

  describe('listBackgroundRemovals', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/background-removals`).reply({ data: [], has_more: false })

      await service.listBackgroundRemovals(10, 'tok_bgr')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_bgr' })
    })
  })

  describe('deleteBackgroundRemoval', () => {
    it('sends DELETE with job ID', async () => {
      mock.onDelete(`${BASE}/v3/background-removals/bgr_1`).reply({ data: { id: 'bgr_1', deleted: true } })

      const result = await service.deleteBackgroundRemoval('bgr_1')

      expect(result).toEqual({ id: 'bgr_1', deleted: true })
    })
  })

  // ── HyperFrames ──

  describe('createHyperframesRender', () => {
    it('sends POST with project and settings', async () => {
      mock.onPost(`${BASE}/v3/hyperframes/renders`).reply({ data: { render_id: 'hfr_1' } })

      await service.createHyperframesRender(
        'https://project.com/bundle.zip', undefined,
        'compositions/intro.html', { headline: 'Q3' },
        30, 'High', 'WebM', '4K', '16:9', 'Intro', 'https://cb.test', 'cb_1'
      )

      expect(mock.history[0].body).toMatchObject({
        project: { type: 'url', url: 'https://project.com/bundle.zip' },
        composition: 'compositions/intro.html',
        variables: { headline: 'Q3' },
        fps: 30,
        quality: 'high',
        format: 'webm',
        resolution: '4k',
        aspect_ratio: '16:9',
        title: 'Intro',
        callback_url: 'https://cb.test',
        callback_id: 'cb_1',
      })
    })
  })

  describe('getHyperframesRender', () => {
    it('sends GET with render ID', async () => {
      mock.onGet(`${BASE}/v3/hyperframes/renders/hfr_1`).reply({ data: { render_id: 'hfr_1' } })

      const result = await service.getHyperframesRender('hfr_1')

      expect(result).toEqual({ render_id: 'hfr_1' })
    })
  })

  describe('listHyperframesRenders', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/hyperframes/renders`).reply({ data: [], has_more: false })

      await service.listHyperframesRenders(10, 'tok_hf')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_hf' })
    })
  })

  describe('deleteHyperframesRender', () => {
    it('sends DELETE with render ID', async () => {
      mock.onDelete(`${BASE}/v3/hyperframes/renders/hfr_1`).reply({ data: { render_id: 'hfr_1' } })

      const result = await service.deleteHyperframesRender('hfr_1')

      expect(result).toEqual({ render_id: 'hfr_1' })
    })
  })

  // ── Assets ──

  describe('getAsset', () => {
    it('sends GET with asset ID', async () => {
      mock.onGet(`${BASE}/v3/assets/ast_1`).reply({ data: { id: 'ast_1', name: 'logo.png' } })

      const result = await service.getAsset('ast_1')

      expect(result).toEqual({ id: 'ast_1', name: 'logo.png' })
    })
  })

  describe('deleteAsset', () => {
    it('sends DELETE with asset ID', async () => {
      mock.onDelete(`${BASE}/v3/assets/ast_1`).reply({ data: { id: 'ast_1' } })

      const result = await service.deleteAsset('ast_1')

      expect(result).toEqual({ id: 'ast_1' })
    })
  })

  describe('searchStockAssets', () => {
    it('sends GET with resolved type and scope', async () => {
      mock.onGet(`${BASE}/v3/assets/search`).reply({ data: [], has_more: false })

      await service.searchStockAssets('pizza', 'Icon', 'Personal', 20, 'tok_sa')

      expect(mock.history[0].query).toMatchObject({
        query: 'pizza',
        type: 'icon',
        scope: 'personal',
        limit: 20,
        token: 'tok_sa',
      })
    })
  })

  describe('getBulkAssetStatuses', () => {
    it('joins IDs with commas', async () => {
      mock.onGet(`${BASE}/v3/assets/statuses`).reply({ data: [] })

      await service.getBulkAssetStatuses(['ast_1', 'ast_2'], ['btch_1'])

      expect(mock.history[0].query).toMatchObject({
        asset_ids: 'ast_1,ast_2',
        batch_ids: 'btch_1',
      })
    })
  })

  describe('createDirectUpload', () => {
    it('sends POST with file metadata', async () => {
      mock.onPost(`${BASE}/v3/assets/direct-uploads`).reply({ data: { asset_id: 'ast_du1', upload_url: 'https://s3.com/upload' } })

      const result = await service.createDirectUpload('clip.mp4', 'video/mp4', 10485760, 'abc123sha')

      expect(result).toEqual({ asset_id: 'ast_du1', upload_url: 'https://s3.com/upload' })
      expect(mock.history[0].body).toMatchObject({
        filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 10485760,
        checksum_sha256: 'abc123sha',
      })
    })
  })

  describe('completeDirectUpload', () => {
    it('sends POST with asset ID', async () => {
      mock.onPost(`${BASE}/v3/assets/ast_du1/complete`).reply({ data: { asset_id: 'ast_du1', status: 'processing' } })

      await service.completeDirectUpload('ast_du1', 'sha_check')

      expect(mock.history[0].body).toMatchObject({ checksum_sha256: 'sha_check' })
    })
  })

  describe('createDirectUploadBatch', () => {
    it('sends POST with files array', async () => {
      mock.onPost(`${BASE}/v3/assets/direct-uploads/batches`).reply({ data: { batch_id: 'btch_ast_1' } })

      const files = [{ filename: 'a.mp4', content_type: 'video/mp4', size_bytes: 100 }]
      await service.createDirectUploadBatch(files, 'Asset batch')

      expect(mock.history[0].body).toMatchObject({ files, title: 'Asset batch' })
    })
  })

  describe('completeDirectUploadBatch', () => {
    it('sends POST with batch ID', async () => {
      mock.onPost(`${BASE}/v3/assets/complete/batches`).reply({ data: { batch_id: 'btch_ast_1' } })

      await service.completeDirectUploadBatch('btch_ast_1')

      expect(mock.history[0].body).toEqual({ batch_id: 'btch_ast_1' })
    })
  })

  describe('getAssetBatch', () => {
    it('sends GET with batch ID', async () => {
      mock.onGet(`${BASE}/v3/assets/batches/btch_ast_1`).reply({ data: { batch_id: 'btch_ast_1' } })

      await service.getAssetBatch('btch_ast_1', 20, 'tok_ab')

      expect(mock.history[0].query).toMatchObject({ limit: 20, token: 'tok_ab' })
    })
  })

  // ── Webhooks ──

  describe('listWebhookEndpoints', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/webhooks/endpoints`).reply({ data: [], has_more: false })

      await service.listWebhookEndpoints(10, 'tok_wh')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_wh' })
    })
  })

  describe('createWebhookEndpoint', () => {
    it('sends POST with URL and resolved events', async () => {
      mock.onPost(`${BASE}/v3/webhooks/endpoints`).reply({ data: { endpoint_id: 'wh_1' } })

      await service.createWebhookEndpoint(
        'https://hook.test/heygen',
        ['Avatar Video Success', 'Video Translate Failed'],
        'entity_123'
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://hook.test/heygen',
        events: ['avatar_video.success', 'video_translate.fail'],
        entity_id: 'entity_123',
      })
    })
  })

  describe('updateWebhookEndpoint', () => {
    it('sends PATCH with URL and events', async () => {
      mock.onPatch(`${BASE}/v3/webhooks/endpoints/wh_1`).reply({ data: { endpoint_id: 'wh_1' } })

      await service.updateWebhookEndpoint('wh_1', 'https://hook.test/v2', ['Batch Finished'])

      expect(mock.history[0].body).toMatchObject({
        url: 'https://hook.test/v2',
        events: ['batch.finished'],
      })
    })
  })

  describe('deleteWebhookEndpoint', () => {
    it('sends DELETE and returns deleted:true', async () => {
      mock.onDelete(`${BASE}/v3/webhooks/endpoints/wh_1`).reply({})

      const result = await service.deleteWebhookEndpoint('wh_1')

      expect(result).toMatchObject({ deleted: true })
    })
  })

  describe('rotateWebhookSecret', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/v3/webhooks/endpoints/wh_1/rotate-secret`).reply({ data: { endpoint_id: 'wh_1', secret: 'new_secret' } })

      const result = await service.rotateWebhookSecret('wh_1')

      expect(result).toEqual({ endpoint_id: 'wh_1', secret: 'new_secret' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('listWebhookEventTypes', () => {
    it('sends GET', async () => {
      mock.onGet(`${BASE}/v3/webhooks/event-types`).reply({ data: [] })

      await service.listWebhookEventTypes()

      expect(mock.history[0].url).toBe(`${BASE}/v3/webhooks/event-types`)
    })
  })

  describe('listWebhookEvents', () => {
    it('sends GET with resolved event type filter', async () => {
      mock.onGet(`${BASE}/v3/webhooks/events`).reply({ data: [] })

      await service.listWebhookEvents('Avatar Video Success', 'vid_1', 10, 'tok_we')

      expect(mock.history[0].query).toMatchObject({
        event_type: 'avatar_video.success',
        entity_id: 'vid_1',
        limit: 10,
        token: 'tok_we',
      })
    })
  })

  // ── Account & Brand ──

  describe('getCurrentUser', () => {
    it('sends GET to /v3/users/me', async () => {
      mock.onGet(`${BASE}/v3/users/me`).reply({ data: { username: 'mark', email: 'mark@test.com' } })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ username: 'mark', email: 'mark@test.com' })
    })
  })

  describe('listBrandKits', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/brand-kits`).reply({ data: [], has_more: false })

      await service.listBrandKits(10, 'tok_bk')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_bk' })
    })
  })

  describe('listBrandGlossaries', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/v3/brand-glossaries`).reply({ data: [], has_more: false })

      await service.listBrandGlossaries(10, 'tok_bg')

      expect(mock.history[0].query).toMatchObject({ limit: 10, token: 'tok_bg' })
    })
  })

  // ── Workflows ──

  describe('listWorkflows', () => {
    it('sends GET to /v1/workflows', async () => {
      mock.onGet(`${BASE}/v1/workflows`).reply({ data: [] })

      await service.listWorkflows()

      expect(mock.history[0].url).toBe(`${BASE}/v1/workflows`)
    })
  })

  describe('executeWorkflow', () => {
    it('sends POST with workflow type and input', async () => {
      mock.onPost(`${BASE}/v1/workflows/executions`).reply({ data: { execution_id: 'exe_1' } })

      await service.executeWorkflow('GenerateImageNode', { prompt: 'sunset' })

      expect(mock.history[0].body).toEqual({
        workflow_type: 'GenerateImageNode',
        input: { prompt: 'sunset' },
      })
    })
  })

  describe('executeWorkflowGraph', () => {
    it('sends POST with workflows array', async () => {
      mock.onPost(`${BASE}/v1/workflows/graph-executions`).reply({ data: { execution_id: 'exe_graph_1' } })

      const workflows = [{ workflow_type: 'GenImg', input: { prompt: 'x' } }]
      await service.executeWorkflowGraph(workflows)

      expect(mock.history[0].body).toEqual({ workflows })
    })
  })

  describe('getWorkflowExecution', () => {
    it('sends GET with execution ID', async () => {
      mock.onGet(`${BASE}/v1/workflows/executions/exe_1`).reply({ data: { execution_id: 'exe_1', status: 'completed' } })

      const result = await service.getWorkflowExecution('exe_1')

      expect(result).toEqual({ execution_id: 'exe_1', status: 'completed' })
    })
  })

  // ── Dictionaries ──

  describe('avatarLooksDictionary', () => {
    it('returns formatted items with cursor', async () => {
      mock.onGet(`${BASE}/v3/avatars/looks`).reply({
        data: [
          { id: 'lk_1', name: 'Abigail', avatar_type: 'studio_avatar', gender: 'female' },
          { id: 'lk_2', name: 'Bob', avatar_type: 'digital_twin', gender: 'male' },
        ],
        has_more: true,
        next_token: 'tok_next',
      })

      const result = await service.avatarLooksDictionary({})

      expect(result.items).toEqual([
        { label: 'Abigail', value: 'lk_1', note: 'studio_avatar - female' },
        { label: 'Bob', value: 'lk_2', note: 'digital_twin - male' },
      ])
      expect(result.cursor).toBe('tok_next')
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/v3/avatars/looks`).reply({
        data: [
          { id: 'lk_1', name: 'Abigail' },
          { id: 'lk_2', name: 'Bob' },
        ],
        has_more: false,
      })

      const result = await service.avatarLooksDictionary({ search: 'bob' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('lk_2')
    })
  })

  describe('avatarGroupsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${BASE}/v3/avatars`).reply({
        data: [{ id: 'ag_1', name: 'Alex', gender: 'male', looks_count: 3 }],
        has_more: false,
      })

      const result = await service.avatarGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Alex', value: 'ag_1', note: 'male - 3 looks' },
      ])
      expect(result.cursor).toBeNull()
    })
  })

  describe('voicesDictionary', () => {
    it('returns formatted items and searches by name and language', async () => {
      mock.onGet(`${BASE}/v3/voices`).reply({
        data: [
          { voice_id: 'v_1', name: 'Daisy', language: 'English', gender: 'female' },
          { voice_id: 'v_2', name: 'Carlos', language: 'Spanish', gender: 'male' },
        ],
        has_more: false,
      })

      const result = await service.voicesDictionary({ search: 'spanish' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Carlos', value: 'v_2', note: 'Spanish - male' })
    })
  })

  describe('templatesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${BASE}/v3/templates`).reply({
        data: [{ id: 'tpl_1', name: 'Weekly Update', aspect_ratio: '16:9' }],
        has_more: false,
      })

      const result = await service.templatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Weekly Update', value: 'tpl_1', note: '16:9' },
      ])
    })
  })

  describe('targetLanguagesDictionary', () => {
    it('returns all languages and filters by search', async () => {
      mock.onGet(`${BASE}/v3/video-translations/languages`).reply({
        data: { languages: ['English', 'Spanish (Spain)', 'French'] },
      })

      const result = await service.targetLanguagesDictionary({ search: 'span' })

      expect(result.items).toEqual([{ label: 'Spanish (Spain)', value: 'Spanish (Spain)' }])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Save Video to File Storage ──

  describe('saveVideoToFileStorage', () => {
    it('throws when video is not completed', async () => {
      mock.onGet(`${BASE}/v3/videos/vid_1`).reply({ data: { id: 'vid_1', status: 'processing' } })

      await expect(service.saveVideoToFileStorage('vid_1')).rejects.toThrow('not ready to download')
    })
  })
})
