const logger = {
  info: (...args) => console.log('[HeyGen] info:', ...args),
  debug: (...args) => console.log('[HeyGen] debug:', ...args),
  error: (...args) => console.log('[HeyGen] error:', ...args),
  warn: (...args) => console.log('[HeyGen] warn:', ...args),
}

const API_BASE_URL = 'https://api.heygen.com'

const DEFAULT_POLL_INTERVAL_SECONDS = 15
const MAX_WAIT_MS = 570 * 1000

// Dropdown label -> API value mappings. Labels equal to their API value are omitted
// (resolveChoice passes unmapped values through unchanged).
const RESOLUTION_MAP = { '4K': '4k' }
const ASPECT_RATIO_MAP = { 'Auto': 'auto' }
const FIT_MAP = { 'Contain': 'contain', 'Cover': 'cover' }
const EXPRESSIVENESS_MAP = { 'High': 'high', 'Medium': 'medium', 'Low': 'low' }
const ENGINE_MAP = { 'Avatar III': 'avatar_iii', 'Avatar IV': 'avatar_iv', 'Avatar V': 'avatar_v' }
const OUTPUT_FORMAT_MAP = { 'MP4': 'mp4', 'WebM': 'webm', 'MOV': 'mov' }
const MODE_MAP = { 'Speed': 'speed', 'Precision': 'precision' }
const ORIENTATION_MAP = { 'Landscape': 'landscape', 'Portrait': 'portrait' }
const AGENT_MODE_MAP = { 'Generate': 'generate', 'Chat': 'chat' }
const OWNERSHIP_MAP = { 'Public': 'public', 'Private': 'private' }
const AVATAR_TYPE_MAP = { 'Studio Avatar': 'studio_avatar', 'Digital Twin': 'digital_twin', 'Photo Avatar': 'photo_avatar' }
const GENDER_MAP = { 'Male': 'male', 'Female': 'female' }
const AUDIO_SEARCH_TYPE_MAP = { 'Music': 'music', 'Sound Effects': 'sound_effects' }
const ASSET_SEARCH_TYPE_MAP = { 'Image': 'image', 'Icon': 'icon' }
const ASSET_SEARCH_SCOPE_MAP = { 'Public': 'public', 'Personal': 'personal' }
const SRT_ROLE_MAP = { 'Input': 'input', 'Output': 'output' }
const FPS_MODE_MAP = { 'Variable (VFR)': 'vfr', 'Constant (CFR)': 'cfr', 'Passthrough': 'passthrough' }
const CLIP_DURATION_MAP = { '30 Seconds': '30', '60 Seconds': '60', '3 Minutes': '180', 'Long (Auto)': 'long' }
const CLIP_ASPECT_MAP = { 'Landscape': 'landscape', 'Portrait': 'portrait', 'Square': 'square' }
const LAYER_MAP = { 'Foreground': 'foreground', 'Mask': 'mask', 'Background': 'background' }
const QUALITY_MAP = { 'Draft': 'draft', 'Standard': 'standard', 'High': 'high' }
const TTS_INPUT_TYPE_MAP = { 'Text': 'text', 'SSML': 'ssml' }

const WEBHOOK_EVENT_MAP = {
  'Avatar Video Success': 'avatar_video.success',
  'Avatar Video Failed': 'avatar_video.fail',
  'Avatar Video GIF Success': 'avatar_video_gif.success',
  'Avatar Video GIF Failed': 'avatar_video_gif.fail',
  'Video Translate Success': 'video_translate.success',
  'Video Translate Failed': 'video_translate.fail',
  'Personalized Video': 'personalized_video',
  'Instant Avatar Success': 'instant_avatar.success',
  'Instant Avatar Failed': 'instant_avatar.fail',
  'Photo Avatar Generation Success': 'photo_avatar_generation.success',
  'Photo Avatar Generation Failed': 'photo_avatar_generation.fail',
  'Photo Avatar Training Success': 'photo_avatar_train.success',
  'Photo Avatar Training Failed': 'photo_avatar_train.fail',
  'Photo Avatar Add Motion Success': 'photo_avatar_add_motion.success',
  'Photo Avatar Add Motion Failed': 'photo_avatar_add_motion.fail',
  'Proofread Creation Success': 'proofread_creation.success',
  'Proofread Creation Failed': 'proofread_creation.fail',
  'Live Avatar Success': 'live_avatar.success',
  'Live Avatar Failed': 'live_avatar.fail',
  'Avatar Video Caption Success': 'avatar_video_caption.success',
  'Avatar Video Caption Failed': 'avatar_video_caption.fail',
  'Video Agent Success': 'video_agent.success',
  'Video Agent Failed': 'video_agent.fail',
  'HyperFrames Video Success': 'hyperframes_video.success',
  'HyperFrames Video Failed': 'hyperframes_video.fail',
  'AI Clipping Success': 'ai_clipping.success',
  'AI Clipping Failed': 'ai_clipping.fail',
  'Batch Finished': 'batch.finished',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * HeyGen — AI avatar video generation platform.
 *
 * Built on the current HeyGen v3 API (v1/v2 endpoints are retired by HeyGen on
 * November 1, 2026). Streaming/realtime avatar WebSocket APIs are out of scope.
 *
 * @usesFileStorage
 * @integrationName HeyGen
 * @integrationIcon /icon.png
 */
class HeyGenService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`HeyGen API error: ${ message }`)
    }
  }

  async #downloadFile(url, logTag) {
    try {
      const bytes = await Flowrunner.Request.get(url).setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      logger.error(`${ logTag } - failed to download file from ${ url }: ${ error.message }`)

      throw new Error(`Failed to download file: ${ error.message }`)
    }
  }

  async #saveToFileStorage(buffer, filename, fileOptions) {
    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return url
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoices(values, mapping) {
    if (!Array.isArray(values) || values.length === 0) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping))
  }

  // Builds a HeyGen asset-input union ({type:'url'} / {type:'asset_id'}) from a URL/asset id pair.
  #assetInput(url, assetId, label, required = false) {
    if (url && assetId) {
      throw new Error(`Provide either ${ label } URL or ${ label } Asset ID, not both`)
    }

    if (url) {
      return { type: 'url', url }
    }

    if (assetId) {
      return { type: 'asset_id', asset_id: assetId }
    }

    if (required) {
      throw new Error(`${ label } is required: provide a ${ label } URL or a ${ label } Asset ID`)
    }

    return undefined
  }

  #fileInputs(urls, assetIds) {
    const inputs = [
      ...(urls || []).map(url => ({ type: 'url', url })),
      ...(assetIds || []).map(assetId => ({ type: 'asset_id', asset_id: assetId })),
    ]

    return inputs.length ? inputs : undefined
  }

  #buildBackground(color, imageUrl, imageAssetId) {
    const provided = [color, imageUrl, imageAssetId].filter(Boolean)

    if (provided.length === 0) {
      return undefined
    }

    if (provided.length > 1) {
      throw new Error('Provide only one of Background Color, Background Image URL or Background Image Asset ID')
    }

    if (color) {
      return { type: 'color', value: color }
    }

    return imageUrl
      ? { type: 'image', url: imageUrl }
      : { type: 'image', asset_id: imageAssetId }
  }

  #buildCaption(captions) {
    if (!captions || captions === 'None') {
      return undefined
    }

    if (captions === 'Burned Into Video') {
      return { file_format: 'srt', style: 'default' }
    }

    return { file_format: 'srt' }
  }

  #buildVoiceSettings(speed, pitch, locale) {
    const settings = clean({ speed, pitch, locale })

    return Object.keys(settings).length ? settings : undefined
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  #buildAvatarVideoBody(args) {
    return clean({
      type: 'avatar',
      avatar_id: args.avatarId,
      script: args.script,
      voice_id: args.voiceId,
      audio_url: args.audioUrl,
      audio_asset_id: args.audioAssetId,
      title: args.title,
      resolution: this.#resolveChoice(args.resolution, RESOLUTION_MAP),
      aspect_ratio: this.#resolveChoice(args.aspectRatio, ASPECT_RATIO_MAP),
      fit: this.#resolveChoice(args.fit, FIT_MAP),
      background: this.#buildBackground(args.backgroundColor, args.backgroundImageUrl, args.backgroundImageAssetId),
      remove_background: args.removeBackground,
      motion_prompt: args.motionPrompt,
      expressiveness: this.#resolveChoice(args.expressiveness, EXPRESSIVENESS_MAP),
      engine: args.engine ? { type: this.#resolveChoice(args.engine, ENGINE_MAP) } : undefined,
      voice_settings: this.#buildVoiceSettings(args.voiceSpeed, args.voicePitch, args.voiceLocale),
      caption: this.#buildCaption(args.captions),
      output_format: this.#resolveChoice(args.outputFormat, OUTPUT_FORMAT_MAP),
      callback_url: args.callbackUrl,
      callback_id: args.callbackId,
    })
  }

  async #pollVideoUntilDone(videoId, pollIntervalSeconds, logTag) {
    const started = Date.now()
    const intervalMs = Math.min(Math.max(pollIntervalSeconds || DEFAULT_POLL_INTERVAL_SECONDS, 5), 60) * 1000

    for (;;) {
      const response = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/v3/videos/${ videoId }`,
        method: 'get',
      })

      const video = response.data ?? response

      if (video.status === 'completed' || video.status === 'failed') {
        return video
      }

      if (Date.now() - started > MAX_WAIT_MS) {
        throw new Error(`HeyGen video ${ videoId } is still '${ video.status }' after ${ Math.round((Date.now() - started) / 1000) }s. ` +
          'Use the Get Video action to keep polling, or rely on a webhook/callback URL for completion.')
      }

      await this.#sleep(intervalMs)
    }
  }

  // ===========================================================================
  // Videos
  // ===========================================================================

  /**
   * @operationName Create Avatar Video
   * @category Videos
   * @description Creates an avatar video from a HeyGen avatar (video avatar or photo avatar look). The avatar speaks a text script via text-to-speech, or lip-syncs pre-recorded audio (audio URL or uploaded asset). Supports the Avatar III, IV (default) and V rendering engines, resolutions up to 4K, six aspect ratios, solid-color or image backgrounds, motion prompts and expressiveness for photo avatars, voice tuning (speed, pitch, locale), SRT captions, and MP4/WebM output. Generation is asynchronous: the action returns a video_id immediately - poll it with Get Video, or use Create Avatar Video and Wait to block until it finishes.
   * @route POST /create-avatar-video
   *
   * @paramDef {"type":"String","label":"Avatar ID","name":"avatarId","required":true,"dictionary":"avatarLooksDictionary","description":"HeyGen avatar ID - a video avatar or photo avatar look ID. Select from your avatars or pass an ID from List Avatar Looks."}
   * @paramDef {"type":"String","label":"Script","name":"script","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text script for the avatar to speak. Mutually exclusive with Audio URL / Audio Asset ID. When set without a Voice ID, the avatar's default voice is used."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"voicesDictionary","description":"Voice ID for text-to-speech. Optional when the avatar has a default voice."}
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","description":"Public URL of an audio file to lip-sync instead of a text script. Mutually exclusive with Script."}
   * @paramDef {"type":"String","label":"Audio Asset ID","name":"audioAssetId","description":"HeyGen asset ID of an uploaded audio file to lip-sync. Mutually exclusive with Script and Audio URL."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display title for the video in the HeyGen dashboard."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p","4K"]}},"description":"Output video resolution. Defaults to the account's standard resolution when omitted."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","4:5","5:4","1:1","Auto"]}},"description":"Output aspect ratio. 'Auto' preserves the avatar's preferred orientation. Defaults to 16:9."}
   * @paramDef {"type":"String","label":"Fit","name":"fit","uiComponent":{"type":"DROPDOWN","options":{"values":["Contain","Cover"]}},"description":"How the avatar is scaled to the output canvas. Cover fills the frame (may crop edges); Contain fits fully inside."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Solid background as a hex color code, e.g. #008000. Mutually exclusive with the background image parameters."}
   * @paramDef {"type":"String","label":"Background Image URL","name":"backgroundImageUrl","description":"Public URL of a background image. Mutually exclusive with Background Color and Background Image Asset ID."}
   * @paramDef {"type":"String","label":"Background Image Asset ID","name":"backgroundImageAssetId","description":"HeyGen asset ID of a background image. Mutually exclusive with the other background parameters."}
   * @paramDef {"type":"Boolean","label":"Remove Background","name":"removeBackground","uiComponent":{"type":"TOGGLE"},"description":"Remove the avatar's own background. Video avatars must be trained with matting enabled."}
   * @paramDef {"type":"String","label":"Motion Prompt","name":"motionPrompt","description":"Natural-language prompt controlling avatar body motion and hand gestures. Photo avatars only."}
   * @paramDef {"type":"String","label":"Expressiveness","name":"expressiveness","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"Avatar expressiveness level. Photo avatars on the Avatar IV engine only. Defaults to Low."}
   * @paramDef {"type":"String","label":"Engine","name":"engine","uiComponent":{"type":"DROPDOWN","options":{"values":["Avatar III","Avatar IV","Avatar V"]}},"description":"Rendering engine. Avatar IV is the default; Avatar V enables cross-reference-driven animation for higher realism. Check the look's supported_api_engines (Get Avatar Look) for eligibility."}
   * @paramDef {"type":"Number","label":"Voice Speed","name":"voiceSpeed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Text-to-speech playback speed multiplier, 0.5 to 1.5. Only applies with Script + Voice ID."}
   * @paramDef {"type":"Number","label":"Voice Pitch","name":"voicePitch","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Text-to-speech pitch adjustment in semitones, -50 to 50."}
   * @paramDef {"type":"String","label":"Voice Locale","name":"voiceLocale","description":"Locale/accent hint for multi-lingual voices, e.g. en-US or pt-BR."}
   * @paramDef {"type":"String","label":"Captions","name":"captions","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Sidecar File (SRT)","Burned Into Video"]}},"defaultValue":"None","description":"Caption generation. 'Sidecar File (SRT)' returns a subtitle_url next to the video; 'Burned Into Video' additionally renders captions into the frames."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["MP4","WebM"]}},"description":"Output container. Defaults to MP4. WebM supports transparent backgrounds."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL that receives a POST notification when the video is ready."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Caller-defined identifier echoed back in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"video_id":"7f2c1f0fde5a4b8a9c1e","status":"pending","output_format":"mp4"}
   */
  async createAvatarVideo(avatarId, script, voiceId, audioUrl, audioAssetId, title, resolution, aspectRatio, fit,
    backgroundColor, backgroundImageUrl, backgroundImageAssetId, removeBackground, motionPrompt, expressiveness,
    engine, voiceSpeed, voicePitch, voiceLocale, captions, outputFormat, callbackUrl, callbackId) {
    const logTag = '[createAvatarVideo]'

    const body = this.#buildAvatarVideoBody({
      avatarId, script, voiceId, audioUrl, audioAssetId, title, resolution, aspectRatio, fit,
      backgroundColor, backgroundImageUrl, backgroundImageAssetId, removeBackground, motionPrompt,
      expressiveness, engine, voiceSpeed, voicePitch, voiceLocale, captions, outputFormat, callbackUrl, callbackId,
    })

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos`, method: 'post', body })

    return response.data ?? response
  }

  /**
   * @operationName Create Avatar Video and Wait
   * @category Videos
   * @description Creates an avatar video and polls its status until generation completes (or fails), then returns the finished video details including the download URL. Optionally saves the completed MP4/WebM into FlowRunner file storage and returns a stable file URL - useful because HeyGen video URLs are presigned and expire after a short time. Polls every 15 seconds by default and waits up to about 9.5 minutes; for longer renders use Create Avatar Video with a Callback URL instead. Throws an error with HeyGen's failure message if generation fails.
   * @route POST /create-avatar-video-and-wait
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Avatar ID","name":"avatarId","required":true,"dictionary":"avatarLooksDictionary","description":"HeyGen avatar ID - a video avatar or photo avatar look ID."}
   * @paramDef {"type":"String","label":"Script","name":"script","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text script for the avatar to speak. Mutually exclusive with Audio URL."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"voicesDictionary","description":"Voice ID for text-to-speech. Optional when the avatar has a default voice."}
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","description":"Public URL of an audio file to lip-sync instead of a text script."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display title for the video in the HeyGen dashboard."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p","4K"]}},"description":"Output video resolution."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","4:5","5:4","1:1","Auto"]}},"description":"Output aspect ratio. Defaults to 16:9."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Solid background as a hex color code, e.g. #008000."}
   * @paramDef {"type":"String","label":"Background Image URL","name":"backgroundImageUrl","description":"Public URL of a background image. Mutually exclusive with Background Color."}
   * @paramDef {"type":"String","label":"Engine","name":"engine","uiComponent":{"type":"DROPDOWN","options":{"values":["Avatar III","Avatar IV","Avatar V"]}},"description":"Rendering engine. Avatar IV is the default."}
   * @paramDef {"type":"String","label":"Motion Prompt","name":"motionPrompt","description":"Natural-language prompt controlling avatar body motion. Photo avatars only."}
   * @paramDef {"type":"String","label":"Expressiveness","name":"expressiveness","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"Avatar expressiveness level. Photo avatars on Avatar IV only."}
   * @paramDef {"type":"Number","label":"Poll Interval (Seconds)","name":"pollIntervalSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds between status checks, 5-60. Defaults to 15."}
   * @paramDef {"type":"Boolean","label":"Save to File Storage","name":"saveToFileStorage","uiComponent":{"type":"TOGGLE"},"description":"When enabled, downloads the finished video and stores it in FlowRunner file storage, returning a stable saved_file_url (HeyGen's own video_url expires)."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"id":"7f2c1f0fde5a4b8a9c1e","title":"Product Update","status":"completed","created_at":1752700000,"completed_at":1752700421,"video_url":"https://resource2.heygen.ai/video/transcode/7f2c1f0f/1080x1920.mp4","thumbnail_url":"https://resource2.heygen.ai/image/7f2c1f0f.jpg","subtitle_url":null,"duration":34.2,"video_page_url":"https://app.heygen.com/videos/7f2c1f0fde5a4b8a9c1e","saved_file_url":"https://files.flowrunner.com/.../heygen_video_7f2c1f0f.mp4"}
   */
  async createAvatarVideoAndWait(avatarId, script, voiceId, audioUrl, title, resolution, aspectRatio,
    backgroundColor, backgroundImageUrl, engine, motionPrompt, expressiveness, pollIntervalSeconds,
    saveToFileStorage, fileOptions) {
    const logTag = '[createAvatarVideoAndWait]'

    const body = this.#buildAvatarVideoBody({
      avatarId, script, voiceId, audioUrl, title, resolution, aspectRatio,
      backgroundColor, backgroundImageUrl, engine, motionPrompt, expressiveness,
    })

    const createResponse = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos`, method: 'post', body })
    const videoId = (createResponse.data ?? createResponse).video_id

    logger.info(`${ logTag } - created video ${ videoId }, waiting for completion`)

    const video = await this.#pollVideoUntilDone(videoId, pollIntervalSeconds, logTag)

    if (video.status === 'failed') {
      throw new Error(`HeyGen video generation failed: ${ video.failure_message || video.failure_code || 'unknown error' }`)
    }

    if (saveToFileStorage && video.video_url) {
      const buffer = await this.#downloadFile(video.video_url, logTag)
      const extension = video.video_url.split('?')[0].endsWith('.webm') ? 'webm' : 'mp4'

      video.saved_file_url = await this.#saveToFileStorage(buffer, `heygen_video_${ videoId }.${ extension }`, fileOptions)
    }

    return video
  }

  /**
   * @operationName Create Video from Image
   * @category Videos
   * @description Creates a talking video by animating an arbitrary image (a person's photo) instead of a pre-built avatar. Provide the image via public URL or a HeyGen asset ID, plus either a text script (with optional voice) or pre-recorded audio to lip-sync. Supports motion prompts, expressiveness, resolutions up to 4K, backgrounds, captions and MP4/WebM output. Returns a video_id immediately; poll with Get Video.
   * @route POST /create-video-from-image
   *
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Public URL of the image to animate. Provide this or Image Asset ID."}
   * @paramDef {"type":"String","label":"Image Asset ID","name":"imageAssetId","description":"HeyGen asset ID of an uploaded image to animate. Provide this or Image URL."}
   * @paramDef {"type":"String","label":"Script","name":"script","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text script to speak. Mutually exclusive with Audio URL / Audio Asset ID."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"voicesDictionary","description":"Voice ID for text-to-speech. Required when Script is provided."}
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","description":"Public URL of an audio file to lip-sync. Mutually exclusive with Script."}
   * @paramDef {"type":"String","label":"Audio Asset ID","name":"audioAssetId","description":"HeyGen asset ID of an uploaded audio file to lip-sync."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display title for the video in the HeyGen dashboard."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p","4K"]}},"description":"Output video resolution."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","4:5","5:4","1:1","Auto"]}},"description":"Output aspect ratio. Defaults to 16:9."}
   * @paramDef {"type":"String","label":"Fit","name":"fit","uiComponent":{"type":"DROPDOWN","options":{"values":["Contain","Cover"]}},"description":"How the subject is scaled to the output canvas."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Solid background as a hex color code, e.g. #008000."}
   * @paramDef {"type":"String","label":"Background Image URL","name":"backgroundImageUrl","description":"Public URL of a background image. Mutually exclusive with Background Color."}
   * @paramDef {"type":"String","label":"Motion Prompt","name":"motionPrompt","description":"Natural-language prompt controlling body motion."}
   * @paramDef {"type":"String","label":"Expressiveness","name":"expressiveness","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"Expressiveness level. Defaults to Low."}
   * @paramDef {"type":"String","label":"Captions","name":"captions","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Sidecar File (SRT)","Burned Into Video"]}},"defaultValue":"None","description":"Caption generation. 'Sidecar File (SRT)' returns a subtitle_url; 'Burned Into Video' also renders captions into the frames."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["MP4","WebM"]}},"description":"Output container. Defaults to MP4."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL notified when the video is ready."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Caller-defined identifier echoed back in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"video_id":"91ab4f21c30d4e17a2b3","status":"pending","output_format":"mp4"}
   */
  async createVideoFromImage(imageUrl, imageAssetId, script, voiceId, audioUrl, audioAssetId, title, resolution,
    aspectRatio, fit, backgroundColor, backgroundImageUrl, motionPrompt, expressiveness, captions, outputFormat,
    callbackUrl, callbackId) {
    const logTag = '[createVideoFromImage]'

    const body = clean({
      type: 'image',
      image: this.#assetInput(imageUrl, imageAssetId, 'Image', true),
      script,
      voice_id: voiceId,
      audio_url: audioUrl,
      audio_asset_id: audioAssetId,
      title,
      resolution: this.#resolveChoice(resolution, RESOLUTION_MAP),
      aspect_ratio: this.#resolveChoice(aspectRatio, ASPECT_RATIO_MAP),
      fit: this.#resolveChoice(fit, FIT_MAP),
      background: this.#buildBackground(backgroundColor, backgroundImageUrl, undefined),
      motion_prompt: motionPrompt,
      expressiveness: this.#resolveChoice(expressiveness, EXPRESSIVENESS_MAP),
      caption: this.#buildCaption(captions),
      output_format: this.#resolveChoice(outputFormat, OUTPUT_FORMAT_MAP),
      callback_url: callbackUrl,
      callback_id: callbackId,
    })

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos`, method: 'post', body })

    return response.data ?? response
  }

  /**
   * @operationName Create Cinematic Avatar Video
   * @category Videos
   * @description Generates a cinematic video from a natural-language prompt plus 1-3 avatar look IDs used as visual references (HeyGen's Avatar V cinematic mode). Optionally add reference asset URLs (images, videos, audio) to guide the generation. Produces 4-15 second clips at 720p or 1080p. Returns a video_id immediately; poll with Get Video.
   * @route POST /create-cinematic-avatar-video
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language prompt describing the video to generate (up to 10,000 characters)."}
   * @paramDef {"type":"Array<String>","label":"Avatar IDs","name":"avatarIds","required":true,"description":"1 to 3 avatar look IDs used as visual references for the generation."}
   * @paramDef {"type":"Array<String>","label":"Reference URLs","name":"referenceUrls","description":"Public URLs of reference assets (images, videos or audio) guiding the generation."}
   * @paramDef {"type":"Array<String>","label":"Reference Asset IDs","name":"referenceAssetIds","description":"HeyGen asset IDs of uploaded reference assets guiding the generation."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","4:5","5:4","1:1","Auto"]}},"description":"Output aspect ratio."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p"]}},"description":"Output resolution. Defaults to 720p."}
   * @paramDef {"type":"Number","label":"Duration (Seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Video length in seconds, 4-15. Defaults to 10. Omit when Auto Duration is enabled."}
   * @paramDef {"type":"Boolean","label":"Auto Duration","name":"autoDuration","uiComponent":{"type":"TOGGLE"},"description":"Let the model choose the video length. When enabled, omit Duration."}
   * @paramDef {"type":"Boolean","label":"Enhance Prompt","name":"enhancePrompt","uiComponent":{"type":"TOGGLE"},"description":"Enable server-side prompt enhancement."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display title for the video in the HeyGen dashboard."}
   *
   * @returns {Object}
   * @sampleResult {"video_id":"c4e8b2a1f9d34c56b7a8","status":"pending","output_format":"mp4"}
   */
  async createCinematicAvatarVideo(prompt, avatarIds, referenceUrls, referenceAssetIds, aspectRatio, resolution,
    duration, autoDuration, enhancePrompt, title) {
    const logTag = '[createCinematicAvatarVideo]'

    const body = clean({
      type: 'cinematic_avatar',
      prompt,
      avatar_id: avatarIds,
      references: this.#fileInputs(referenceUrls, referenceAssetIds),
      aspect_ratio: this.#resolveChoice(aspectRatio, ASPECT_RATIO_MAP),
      resolution: this.#resolveChoice(resolution, RESOLUTION_MAP),
      duration,
      auto_duration: autoDuration,
      enhance_prompt: enhancePrompt,
      title,
    })

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos`, method: 'post', body })

    return response.data ?? response
  }

  /**
   * @operationName Get Video
   * @category Videos
   * @description Retrieves details for a video by ID, including generation status (pending, processing, completed or failed), the presigned video_url and thumbnail once completed, subtitle and captioned-video URLs when captions were requested, duration, and failure code/message if generation failed. Note that video_url is presigned and expires - re-fetch it or use Save Video to File Storage for a permanent copy.
   * @route GET /get-video
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"Unique video identifier returned by any video creation action."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7f2c1f0fde5a4b8a9c1e","title":"Product Update","status":"completed","created_at":1752700000,"completed_at":1752700421,"video_url":"https://resource2.heygen.ai/video/transcode/7f2c1f0f/1080x1920.mp4","thumbnail_url":"https://resource2.heygen.ai/image/7f2c1f0f.jpg","gif_url":null,"captioned_video_url":null,"subtitle_url":null,"duration":34.2,"folder_id":null,"failure_code":null,"failure_message":null,"video_page_url":"https://app.heygen.com/videos/7f2c1f0fde5a4b8a9c1e"}
   */
  async getVideo(videoId) {
    const logTag = '[getVideo]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos/${ videoId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName List Videos
   * @category Videos
   * @description Lists all videos in the HeyGen account with cursor-based pagination. Optionally filter by folder ID or a title substring. Each item includes the video's ID, title, status, timestamps and URLs. Use the returned next_token to fetch subsequent pages.
   * @route GET /list-videos
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of videos per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Filter videos by folder ID."}
   * @paramDef {"type":"String","label":"Title Filter","name":"title","description":"Filter videos by a title substring."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"7f2c1f0fde5a4b8a9c1e","title":"Product Update","status":"completed","created_at":1752700000,"duration":34.2}],"has_more":false,"next_token":null}
   */
  async listVideos(limit, token, folderId, title) {
    const logTag = '[listVideos]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/videos`,
      method: 'get',
      query: { limit, token, folder_id: folderId, title },
    })
  }

  /**
   * @operationName Delete Video
   * @category Videos
   * @description Permanently deletes a video and its associated files from the HeyGen account. This action cannot be undone.
   * @route DELETE /delete-video
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"Unique identifier of the video to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7f2c1f0fde5a4b8a9c1e","deleted":true}
   */
  async deleteVideo(videoId) {
    const logTag = '[deleteVideo]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos/${ videoId }`, method: 'delete' })

    return response.data ?? response
  }

  /**
   * @operationName Get Bulk Video Statuses
   * @category Videos
   * @description Returns statuses for up to 100 videos in a single request, addressed by video IDs and/or batch IDs (each batch expands to its member videos). Statuses are queued, processing, completed or failed, plus not_found for unknown or unowned IDs. Ideal for efficiently polling many in-flight generations at once.
   * @route GET /get-bulk-video-statuses
   *
   * @paramDef {"type":"Array<String>","label":"Video IDs","name":"videoIds","description":"Video IDs to look up (up to 100 total across both parameters)."}
   * @paramDef {"type":"Array<String>","label":"Batch IDs","name":"batchIds","description":"Video batch IDs; each expands to its member videos."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"video_id":"7f2c1f0fde5a4b8a9c1e","status":"completed"},{"video_id":"91ab4f21c30d4e17a2b3","status":"processing"}],"has_more":false,"next_token":null}
   */
  async getBulkVideoStatuses(videoIds, batchIds) {
    const logTag = '[getBulkVideoStatuses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/videos/statuses`,
      method: 'get',
      query: {
        video_ids: videoIds?.length ? videoIds.join(',') : undefined,
        batch_ids: batchIds?.length ? batchIds.join(',') : undefined,
      },
    })
  }

  /**
   * @operationName Create Video Batch
   * @category Videos
   * @description Submits up to 100 video creation payloads in one request and returns a batch_id immediately. Each payload uses the same JSON shape as the POST /v3/videos request body (type 'avatar', 'image' or 'cinematic_avatar' with their respective fields). Videos are created asynchronously and independently, so one bad payload does not fail the rest. Poll progress with Get Video Batch.
   * @route POST /create-video-batch
   *
   * @paramDef {"type":"Array<Object>","label":"Videos","name":"videos","required":true,"description":"Video creation payloads (max 100), each identical in shape to the HeyGen POST /v3/videos body, e.g. {\"type\":\"avatar\",\"avatar_id\":\"...\",\"script\":\"...\",\"voice_id\":\"...\"}."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display name for the batch, shown in the HeyGen app."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL invoked once when every item in the batch reaches a terminal state."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_9f2e7c1a","status":"processing","total_items":3}
   */
  async createVideoBatch(videos, title, callbackUrl) {
    const logTag = '[createVideoBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/videos/batches`,
      method: 'post',
      body: clean({ videos, title, callback_url: callbackUrl }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Video Batch
   * @category Videos
   * @description Returns aggregate status for a video batch plus one page of its items with their video IDs and statuses (queued, processing, completed or failed). Includes per-status counts so you can track overall progress at a glance.
   * @route GET /get-video-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"Unique video batch identifier returned by Create Video Batch."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_9f2e7c1a","title":"Campaign renders","status":"processing","total_items":3,"counts_by_status":{"completed":1,"processing":2},"created_at":1752700000,"items":[{"video_id":"7f2c1f0fde5a4b8a9c1e","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getVideoBatch(batchId, limit, token) {
    const logTag = '[getVideoBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/videos/batches/${ batchId }`,
      method: 'get',
      query: { limit, token },
    })

    return response.data ?? response
  }

  /**
   * @operationName Save Video to File Storage
   * @category Videos
   * @description Downloads a completed HeyGen video and stores it in FlowRunner file storage, returning a stable file URL alongside the video details. Use this after any generation completes, because HeyGen's video_url is presigned and expires after a short time. Fails with a clear error if the video is not yet completed or has no downloadable URL.
   * @route POST /save-video-to-file-storage
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"Unique identifier of a completed video."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Filename for the stored file. Defaults to heygen_video_{videoId}.mp4."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"saved_file_url":"https://files.flowrunner.com/.../heygen_video_7f2c1f0f.mp4","video":{"id":"7f2c1f0fde5a4b8a9c1e","title":"Product Update","status":"completed","duration":34.2}}
   */
  async saveVideoToFileStorage(videoId, filename, fileOptions) {
    const logTag = '[saveVideoToFileStorage]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/videos/${ videoId }`, method: 'get' })
    const video = response.data ?? response

    if (video.status !== 'completed' || !video.video_url) {
      throw new Error(`Video ${ videoId } is not ready to download (status: ${ video.status }). ` +
        'Wait until the status is completed, or use Create Avatar Video and Wait.')
    }

    const buffer = await this.#downloadFile(video.video_url, logTag)
    const extension = video.video_url.split('?')[0].endsWith('.webm') ? 'webm' : 'mp4'
    const savedFileUrl = await this.#saveToFileStorage(buffer, filename || `heygen_video_${ videoId }.${ extension }`, fileOptions)

    return { saved_file_url: savedFileUrl, video }
  }
  // ===========================================================================
  // Video Agent
  // ===========================================================================

  /**
   * @operationName Create Video Agent Session
   * @category Video Agent
   * @description Starts a HeyGen Video Agent session that produces a complete video from a single natural-language prompt - the agent handles scripting, avatar selection, scene composition and rendering. Use 'Generate' mode for one-shot fire-and-forget creation, or 'Chat' mode for a multi-turn session you can refine with Send Video Agent Message. Optionally pin a specific avatar, voice, visual style or brand kit, and attach up to 20 reference files. Returns a session_id (and later a video_id) to poll with Get Video Agent Session.
   * @route POST /create-video-agent-session
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Prompt describing the video to generate (1-10,000 characters)."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Generate","Chat"]}},"defaultValue":"Generate","description":"'Generate' creates the video in one shot; 'Chat' opens a multi-turn session that accepts follow-up messages and revision requests."}
   * @paramDef {"type":"String","label":"Avatar ID","name":"avatarId","dictionary":"avatarLooksDictionary","description":"Specific avatar to use. When omitted, the agent picks one."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"voicesDictionary","description":"Specific voice to use for narration. When omitted, the agent picks one."}
   * @paramDef {"type":"String","label":"Style ID","name":"styleId","description":"Curated visual style template ID from List Video Agent Styles."}
   * @paramDef {"type":"String","label":"Brand Kit ID","name":"brandKitId","description":"Brand kit ID (from List Brand Kits) to apply brand colors, fonts and logos."}
   * @paramDef {"type":"String","label":"Orientation","name":"orientation","uiComponent":{"type":"DROPDOWN","options":{"values":["Landscape","Portrait"]}},"description":"Video orientation. Auto-detected from content when omitted."}
   * @paramDef {"type":"Array<String>","label":"File URLs","name":"fileUrls","description":"Public URLs of reference files to attach (max 20 attachments total)."}
   * @paramDef {"type":"Array<String>","label":"File Asset IDs","name":"fileAssetIds","description":"HeyGen asset IDs of uploaded reference files to attach."}
   * @paramDef {"type":"Boolean","label":"Incognito Mode","name":"incognitoMode","uiComponent":{"type":"TOGGLE"},"description":"Disables memory injection and extraction for this session."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for completion/failure notifications."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Caller-defined identifier included in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"session_id":"vas_3d9c8b7a6f","status":"generating","video_id":null,"created_at":1752700000}
   */
  async createVideoAgentSession(prompt, mode, avatarId, voiceId, styleId, brandKitId, orientation, fileUrls,
    fileAssetIds, incognitoMode, callbackUrl, callbackId) {
    const logTag = '[createVideoAgentSession]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents`,
      method: 'post',
      body: clean({
        prompt,
        mode: this.#resolveChoice(mode, AGENT_MODE_MAP),
        avatar_id: avatarId,
        voice_id: voiceId,
        style_id: styleId,
        brand_kit_id: brandKitId,
        orientation: this.#resolveChoice(orientation, ORIENTATION_MAP),
        files: this.#fileInputs(fileUrls, fileAssetIds),
        incognito_mode: incognitoMode,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Video Agent Session
   * @category Video Agent
   * @description Returns the current status (thinking, waiting_for_input, reviewing, generating, completed or failed), progress percentage, title, produced video_id and recent chat messages for a Video Agent session.
   * @route GET /get-video-agent-session
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"Video Agent session identifier."}
   *
   * @returns {Object}
   * @sampleResult {"session_id":"vas_3d9c8b7a6f","status":"completed","progress":100,"title":"Q3 Launch Teaser","video_id":"7f2c1f0fde5a4b8a9c1e","created_at":1752700000,"messages":[{"role":"assistant","content":"Your video is ready."}]}
   */
  async getVideoAgentSession(sessionId) {
    const logTag = '[getVideoAgentSession]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/video-agents/${ sessionId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName List Video Agent Sessions
   * @category Video Agent
   * @description Returns a paginated list of Video Agent sessions for the authenticated account, sorted newest-first, with each session's status, title and produced video ID.
   * @route GET /list-video-agent-sessions
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"session_id":"vas_3d9c8b7a6f","status":"completed","title":"Q3 Launch Teaser","video_id":"7f2c1f0fde5a4b8a9c1e","created_at":1752700000}],"has_more":false,"next_token":null}
   */
  async listVideoAgentSessions(limit, token) {
    const logTag = '[listVideoAgentSessions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName List Video Agent Session Videos
   * @category Video Agent
   * @description Returns all videos produced within a Video Agent session, sorted newest-first. Useful in chat-mode sessions where multiple revisions generate multiple videos.
   * @route GET /list-video-agent-session-videos
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"Video Agent session identifier."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"7f2c1f0fde5a4b8a9c1e","title":"Q3 Launch Teaser","status":"completed","duration":41.5}],"has_more":false,"next_token":null}
   */
  async listVideoAgentSessionVideos(sessionId) {
    const logTag = '[listVideoAgentSessionVideos]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/video-agents/${ sessionId }/videos`, method: 'get' })
  }

  /**
   * @operationName List Video Agent Styles
   * @category Video Agent
   * @description Returns curated visual style templates available for Video Agent sessions. Each style controls scene composition, pacing and aesthetics; pass its ID as Style ID when creating a session. Supports filtering by tag such as cinematic, retro-tech, iconic-artist, pop-culture, handmade or print.
   * @route GET /list-video-agent-styles
   *
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter styles by tag, e.g. cinematic, retro-tech, iconic-artist, pop-culture, handmade or print."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"style_id":"sty_cinematic_01","name":"Cinematic Noir","tags":["cinematic"],"preview_url":"https://resource2.heygen.ai/styles/noir.mp4"}],"has_more":false,"next_token":null}
   */
  async listVideoAgentStyles(tag, limit, token) {
    const logTag = '[listVideoAgentStyles]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents/styles`,
      method: 'get',
      query: { tag, limit, token },
    })
  }

  /**
   * @operationName Get Video Agent Session Resource
   * @category Video Agent
   * @description Returns a single resource produced or referenced within a Video Agent session (image, video, draft, avatar, voice, etc.) by its resource ID, including its URL, thumbnail and metadata.
   * @route GET /get-video-agent-session-resource
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"Video Agent session identifier."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"description":"Resource identifier referenced by the session's messages."}
   *
   * @returns {Object}
   * @sampleResult {"resource_id":"res_8a1b2c3d","resource_type":"image","source_type":"generated","url":"https://resource2.heygen.ai/session/res_8a1b2c3d.png","thumbnail_url":null,"preview_url":null,"created_at":1752700100,"metadata":{}}
   */
  async getVideoAgentSessionResource(sessionId, resourceId) {
    const logTag = '[getVideoAgentSessionResource]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents/${ sessionId }/resources/${ resourceId }`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName Send Video Agent Message
   * @category Video Agent
   * @description Sends a follow-up message to an existing chat-mode Video Agent session - answer the agent's questions, add context, or request edits/revisions to a generated video. Optionally override the avatar, voice or brand kit for this message and attach reference files. Only valid for sessions created in Chat mode.
   * @route POST /send-video-agent-message
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"Chat-mode Video Agent session identifier."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text message to the agent, e.g. a revision request."}
   * @paramDef {"type":"String","label":"Avatar ID","name":"avatarId","dictionary":"avatarLooksDictionary","description":"Override avatar for this message."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","dictionary":"voicesDictionary","description":"Override voice for this message."}
   * @paramDef {"type":"String","label":"Brand Kit ID","name":"brandKitId","description":"Brand kit ID to apply for this message."}
   * @paramDef {"type":"Array<String>","label":"File URLs","name":"fileUrls","description":"Public URLs of reference files to attach (max 20 attachments total)."}
   * @paramDef {"type":"Array<String>","label":"File Asset IDs","name":"fileAssetIds","description":"HeyGen asset IDs of uploaded reference files to attach."}
   *
   * @returns {Object}
   * @sampleResult {"session_id":"vas_3d9c8b7a6f","run_id":"run_5e6f7a8b","title":"Q3 Launch Teaser"}
   */
  async sendVideoAgentMessage(sessionId, message, avatarId, voiceId, brandKitId, fileUrls, fileAssetIds) {
    const logTag = '[sendVideoAgentMessage]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents/${ sessionId }`,
      method: 'post',
      body: clean({
        message,
        avatar_id: avatarId,
        voice_id: voiceId,
        brand_kit_id: brandKitId,
        files: this.#fileInputs(fileUrls, fileAssetIds),
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Stop Video Agent Session
   * @category Video Agent
   * @description Halts an active Video Agent run at its next checkpoint. Partial results are preserved and remain accessible via Get Video Agent Session and List Video Agent Session Videos.
   * @route POST /stop-video-agent-session
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"Video Agent session identifier to stop."}
   *
   * @returns {Object}
   * @sampleResult {"session_id":"vas_3d9c8b7a6f"}
   */
  async stopVideoAgentSession(sessionId) {
    const logTag = '[stopVideoAgentSession]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-agents/${ sessionId }/stop`,
      method: 'post',
      body: {},
    })

    return response.data ?? response
  }

  // ===========================================================================
  // Avatars
  // ===========================================================================

  /**
   * @operationName Create Photo Avatar
   * @category Avatars
   * @description Creates a photo avatar from a single photo (public URL or uploaded asset). Training runs asynchronously - the response includes the new avatar item and its group; poll Get Avatar Group or Get Avatar Look until the status is completed, then use the look ID as an Avatar ID in video creation. Optionally attach the new look to an existing avatar group (identity) instead of creating a new one.
   * @route POST /create-photo-avatar
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new avatar."}
   * @paramDef {"type":"String","label":"Photo URL","name":"photoUrl","description":"Public URL of the source photo. Provide this or Photo Asset ID."}
   * @paramDef {"type":"String","label":"Photo Asset ID","name":"photoAssetId","description":"HeyGen asset ID of an uploaded photo. Provide this or Photo URL."}
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"avatarGroupId","dictionary":"avatarGroupsDictionary","description":"Existing avatar group (identity) to attach the photo avatar to. A new group is created when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"avatar_item":{"id":"lk_1a2b3c4d","name":"Alex Studio","avatar_type":"photo_avatar","status":"processing"},"avatar_group":{"id":"ag_9z8y7x","name":"Alex","looks_count":1}}
   */
  async createPhotoAvatar(name, photoUrl, photoAssetId, avatarGroupId) {
    const logTag = '[createPhotoAvatar]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars`,
      method: 'post',
      body: clean({
        type: 'photo',
        name,
        file: this.#assetInput(photoUrl, photoAssetId, 'Photo', true),
        avatar_group_id: avatarGroupId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Create Digital Twin Avatar
   * @category Avatars
   * @description Creates a digital twin (video avatar) from recorded footage of a person (public URL or uploaded asset). Training runs asynchronously; poll the returned look/group status until completed. Private avatars require the consent flow (Create Avatar Consent) before they can be used for video generation. Optionally attach the twin to an existing avatar group (identity).
   * @route POST /create-digital-twin-avatar
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new avatar."}
   * @paramDef {"type":"String","label":"Footage URL","name":"footageUrl","description":"Public URL of the training footage video. Provide this or Footage Asset ID."}
   * @paramDef {"type":"String","label":"Footage Asset ID","name":"footageAssetId","description":"HeyGen asset ID of uploaded training footage. Provide this or Footage URL."}
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"avatarGroupId","dictionary":"avatarGroupsDictionary","description":"Existing avatar group (identity) to attach the digital twin to. A new group is created when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"avatar_item":{"id":"lk_5e6f7a8b","name":"Alex Desk","avatar_type":"digital_twin","status":"processing"},"avatar_group":{"id":"ag_9z8y7x","name":"Alex","looks_count":2,"consent_status":"pending"}}
   */
  async createDigitalTwinAvatar(name, footageUrl, footageAssetId, avatarGroupId) {
    const logTag = '[createDigitalTwinAvatar]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars`,
      method: 'post',
      body: clean({
        type: 'digital_twin',
        name,
        file: this.#assetInput(footageUrl, footageAssetId, 'Footage', true),
        avatar_group_id: avatarGroupId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Create AI Avatar from Prompt
   * @category Avatars
   * @description Generates a fully synthetic avatar from a text prompt, optionally guided by reference images or an existing avatar as the visual reference. Generation runs asynchronously; poll the returned look/group status until completed. By default a new identity (avatar group) is created - pass an Avatar Group ID to add the generated look to an existing identity instead.
   * @route POST /create-ai-avatar-from-prompt
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new avatar."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Prompt describing the avatar to generate, e.g. appearance, outfit, setting."}
   * @paramDef {"type":"Array<String>","label":"Reference Image URLs","name":"referenceImageUrls","description":"Public URLs of reference images guiding the generation."}
   * @paramDef {"type":"Array<String>","label":"Reference Image Asset IDs","name":"referenceImageAssetIds","description":"HeyGen asset IDs of uploaded reference images."}
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"avatarGroupId","dictionary":"avatarGroupsDictionary","description":"Existing identity (group) to save the generated avatar to. A new identity is created when omitted."}
   * @paramDef {"type":"String","label":"Reference Avatar ID","name":"referenceAvatarId","description":"Existing avatar look to use as the visual reference for the generation."}
   *
   * @returns {Object}
   * @sampleResult {"avatar_item":{"id":"lk_7c8d9e0f","name":"Nova Presenter","avatar_type":"photo_avatar","status":"processing"},"avatar_group":{"id":"ag_2b3c4d5e","name":"Nova Presenter","looks_count":1}}
   */
  async createAiAvatarFromPrompt(name, prompt, referenceImageUrls, referenceImageAssetIds, avatarGroupId, referenceAvatarId) {
    const logTag = '[createAiAvatarFromPrompt]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars`,
      method: 'post',
      body: clean({
        type: 'prompt',
        name,
        prompt,
        reference_images: this.#fileInputs(referenceImageUrls, referenceImageAssetIds),
        avatar_group_id: avatarGroupId,
        avatar_id: referenceAvatarId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Create Avatar Consent
   * @category Avatars
   * @description Initiates the consent flow for a private avatar group - required before a custom avatar (e.g. digital twin) can be used for video generation. Returns a browser URL where the person completes approval, or accepts a pre-recorded consent video (URL or asset ID) to submit directly. Optionally customize the redirect URL and consent text (premium).
   * @route POST /create-avatar-consent
   *
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"groupId","required":true,"dictionary":"avatarGroupsDictionary","description":"Avatar group requiring consent."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"rerouteUrl","description":"URL the user is redirected to after completing consent. Defaults to HeyGen's consent completion page."}
   * @paramDef {"type":"String","label":"Consent Text","name":"consentText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Custom consent text rendered on the consent page in place of HeyGen's default (premium option)."}
   * @paramDef {"type":"String","label":"Consent Video URL","name":"consentVideoUrl","description":"Public URL of a pre-recorded consent video to submit directly instead of using the browser flow."}
   * @paramDef {"type":"String","label":"Consent Video Asset ID","name":"consentVideoAssetId","description":"HeyGen asset ID of a pre-recorded consent video."}
   *
   * @returns {Object}
   * @sampleResult {"avatar_group":{"id":"ag_9z8y7x","name":"Alex","consent_status":"pending"},"url":"https://app.heygen.com/consent/ag_9z8y7x?token=abc123"}
   */
  async createAvatarConsent(groupId, rerouteUrl, consentText, consentVideoUrl, consentVideoAssetId) {
    const logTag = '[createAvatarConsent]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars/${ groupId }/consent`,
      method: 'post',
      body: clean({
        reroute_url: rerouteUrl,
        consent_text: consentText,
        consent_video: this.#assetInput(consentVideoUrl, consentVideoAssetId, 'Consent Video'),
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName List Avatar Groups
   * @category Avatars
   * @description Returns a paginated list of avatar groups (characters/identities). Each group contains one or more looks and reports its name, gender, preview URLs, looks count, default voice and training/consent status. Filter by ownership: Public for HeyGen's preset avatars, Private for your own.
   * @route GET /list-avatar-groups
   *
   * @paramDef {"type":"String","label":"Ownership","name":"ownership","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private"]}},"description":"Filter by ownership: Public for preset avatars, Private for your own. Omit for all."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups per page (1-50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ag_9z8y7x","name":"Alex","gender":"male","preview_image_url":"https://resource2.heygen.ai/avatar/ag_9z8y7x.jpg","looks_count":3,"status":"completed"}],"has_more":true,"next_token":"eyJvZmZzZXQiOjUwfQ"}
   */
  async listAvatarGroups(ownership, limit, token) {
    const logTag = '[listAvatarGroups]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars`,
      method: 'get',
      query: { ownership: this.#resolveChoice(ownership, OWNERSHIP_MAP), limit, token },
    })
  }

  /**
   * @operationName Get Avatar Group
   * @category Avatars
   * @description Returns details for an avatar group including name, gender, preview image/video URLs, looks count, default voice ID, consent status and training status (processing, pending_consent, failed or completed).
   * @route GET /get-avatar-group
   *
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"groupId","required":true,"dictionary":"avatarGroupsDictionary","description":"Unique avatar group identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_9z8y7x","name":"Alex","preview_image_url":"https://resource2.heygen.ai/avatar/ag_9z8y7x.jpg","preview_video_url":null,"gender":"male","created_at":1750000000,"looks_count":3,"default_voice_id":"3b1633a466c44379bf8b5a2884727588","consent_status":"approved","status":"completed","error":null}
   */
  async getAvatarGroup(groupId) {
    const logTag = '[getAvatarGroup]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/avatars/${ groupId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName Delete Avatar Group
   * @category Avatars
   * @description Permanently deletes a private avatar group and all its associated looks. Public and community groups cannot be deleted. This action cannot be undone.
   * @route DELETE /delete-avatar-group
   *
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"groupId","required":true,"dictionary":"avatarGroupsDictionary","description":"Unique avatar group identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_9z8y7x"}
   */
  async deleteAvatarGroup(groupId) {
    const logTag = '[deleteAvatarGroup]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/avatars/${ groupId }`, method: 'delete' })

    return response.data ?? response
  }

  /**
   * @operationName List Avatar Looks
   * @category Avatars
   * @description Returns a paginated list of avatar looks (outfits, poses, styles). The look's id is the Avatar ID to pass when creating videos. Filter by avatar group, avatar type (Studio Avatar, Digital Twin or Photo Avatar) and ownership (Public presets vs Private).
   * @route GET /list-avatar-looks
   *
   * @paramDef {"type":"String","label":"Avatar Group ID","name":"groupId","dictionary":"avatarGroupsDictionary","description":"Only return looks belonging to this avatar group."}
   * @paramDef {"type":"String","label":"Avatar Type","name":"avatarType","uiComponent":{"type":"DROPDOWN","options":{"values":["Studio Avatar","Digital Twin","Photo Avatar"]}},"description":"Filter looks by avatar type."}
   * @paramDef {"type":"String","label":"Ownership","name":"ownership","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private"]}},"description":"Filter by ownership: Public for preset avatars, Private for your own. Omit for all."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of looks per page (1-50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Abigail_expressive_2024112501","name":"Abigail (Expressive)","avatar_type":"studio_avatar","group_id":"ag_1f2e3d","gender":"female","preview_image_url":"https://resource2.heygen.ai/avatar/abigail.jpg","supported_api_engines":["avatar_iii","avatar_iv"]}],"has_more":true,"next_token":"eyJvZmZzZXQiOjUwfQ"}
   */
  async listAvatarLooks(groupId, avatarType, ownership, limit, token) {
    const logTag = '[listAvatarLooks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars/looks`,
      method: 'get',
      query: {
        group_id: groupId,
        avatar_type: this.#resolveChoice(avatarType, AVATAR_TYPE_MAP),
        ownership: this.#resolveChoice(ownership, OWNERSHIP_MAP),
        limit,
        token,
      },
    })
  }

  /**
   * @operationName Get Avatar Look
   * @category Avatars
   * @description Returns details for a specific avatar look including its type, group, preview URLs, gender, tags, default voice, supported rendering engines (avatar_iii/avatar_iv/avatar_v), preferred orientation and training status. Use this to check engine eligibility before selecting an engine in video creation.
   * @route GET /get-avatar-look
   *
   * @paramDef {"type":"String","label":"Look ID","name":"lookId","required":true,"dictionary":"avatarLooksDictionary","description":"Unique avatar look identifier (the same value used as Avatar ID in video creation)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Abigail_expressive_2024112501","name":"Abigail (Expressive)","avatar_type":"studio_avatar","group_id":"ag_1f2e3d","preview_image_url":"https://resource2.heygen.ai/avatar/abigail.jpg","preview_video_url":null,"gender":"female","tags":["professional"],"default_voice_id":"3b1633a466c44379bf8b5a2884727588","supported_api_engines":["avatar_iii","avatar_iv"],"image_width":1080,"image_height":1920,"preferred_orientation":"portrait","status":"completed","error":null}
   */
  async getAvatarLook(lookId) {
    const logTag = '[getAvatarLook]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/avatars/looks/${ lookId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName Update Avatar Look
   * @category Avatars
   * @description Updates the display name of an avatar look. Only supported for photo avatar and digital twin look types (studio avatar looks cannot be renamed via the API).
   * @route PATCH /update-avatar-look
   *
   * @paramDef {"type":"String","label":"Look ID","name":"lookId","required":true,"dictionary":"avatarLooksDictionary","description":"Unique avatar look identifier."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New display name for the look."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lk_1a2b3c4d","name":"Alex Studio v2","avatar_type":"photo_avatar","group_id":"ag_9z8y7x","status":"completed"}
   */
  async updateAvatarLook(lookId, name) {
    const logTag = '[updateAvatarLook]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars/looks/${ lookId }`,
      method: 'patch',
      body: { name },
    })

    return response.data ?? response
  }

  /**
   * @operationName Delete Avatar Look
   * @category Avatars
   * @description Deletes an avatar look and its backing resource. Supported for photo avatar, digital twin and kit-based looks; studio avatar looks cannot be deleted via the API. Warning: deleting the last look in a group also deletes the parent group.
   * @route DELETE /delete-avatar-look
   *
   * @paramDef {"type":"String","label":"Look ID","name":"lookId","required":true,"dictionary":"avatarLooksDictionary","description":"Unique avatar look identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lk_1a2b3c4d"}
   */
  async deleteAvatarLook(lookId) {
    const logTag = '[deleteAvatarLook]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/avatars/looks/${ lookId }`, method: 'delete' })

    return response.data ?? response
  }
  // ===========================================================================
  // Voices & Audio
  // ===========================================================================

  /**
   * @operationName List Voices
   * @category Voices & Audio
   * @description Returns a paginated list of voices available for video generation and text-to-speech. Filter by type (Public shared library vs Private cloned voices), engine compatibility (e.g. starfish for the Generate Speech action), language and gender.
   * @route GET /list-voices
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private"]}},"description":"Voice type: Public for the shared library, Private for your cloned voices."}
   * @paramDef {"type":"String","label":"Engine","name":"engine","description":"Filter by voice engine, e.g. starfish (required for Generate Speech), elevenlabs or fish."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Filter by language name, e.g. English."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"DROPDOWN","options":{"values":["Male","Female"]}},"description":"Filter voices by gender."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"voice_id":"3b1633a466c44379bf8b5a2884727588","name":"Daisy","language":"English","gender":"female","preview_audio_url":"https://resource2.heygen.ai/voice/daisy.mp3","support_pause":true}],"has_more":true,"next_token":"eyJvZmZzZXQiOjEwMH0"}
   */
  async listVoices(type, engine, language, gender, limit, token) {
    const logTag = '[listVoices]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/voices`,
      method: 'get',
      query: {
        type: this.#resolveChoice(type, OWNERSHIP_MAP),
        engine,
        language,
        gender: this.#resolveChoice(gender, GENDER_MAP),
        limit,
        token,
      },
    })
  }

  /**
   * @operationName Get Voice
   * @category Voices & Audio
   * @description Returns details for a specific voice, including its language, gender, preview audio URL and - for voice clones - the training status (processing, complete or failed) with any failure message. Use this to poll a clone created with Clone Voice until it is ready.
   * @route GET /get-voice
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"voicesDictionary","description":"Unique voice identifier."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"vc_4d5e6f7a","name":"My Narrator","language":"English","gender":"male","preview_audio_url":"https://resource2.heygen.ai/voice/vc_4d5e6f7a.mp3","status":"complete","failure_message":null,"support_pause":true,"support_interactive_avatar":false,"created_at":1752690000}
   */
  async getVoice(voiceId) {
    const logTag = '[getVoice]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/voices/${ voiceId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName Design Voice
   * @category Voices & Audio
   * @description Finds up to 3 voices matching a natural-language description, e.g. 'warm, confident female narrator'. Filter by gender or BCP-47 locale, and vary the Seed to get different batches of matches (seed 0 returns the top matches, seed 1 the next batch, and so on).
   * @route POST /design-voice
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language description of the desired voice."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"DROPDOWN","options":{"values":["Male","Female"]}},"description":"Filter matches by gender."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"BCP-47 locale tag to filter by, e.g. en-US or pt-BR."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which batch of results to return: 0 for the top matches, 1 for the next batch, etc."}
   *
   * @returns {Object}
   * @sampleResult {"voices":[{"voice_id":"7194a75832d84cbb85dcadfd3e35a89c","name":"Amber","language":"English","gender":"female","preview_audio_url":"https://resource2.heygen.ai/voice/amber.mp3"}],"seed":0}
   */
  async designVoice(prompt, gender, locale, seed) {
    const logTag = '[designVoice]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/voices`,
      method: 'post',
      body: clean({
        prompt,
        gender: this.#resolveChoice(gender, GENDER_MAP),
        locale,
        seed,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Clone Voice
   * @category Voices & Audio
   * @description Creates a voice clone from an audio sample (public URL or uploaded asset). Cloning runs asynchronously - poll Get Voice with the returned voice_clone_id until the status is 'complete'. The resulting voice can then be used with Generate Speech and all video creation actions. Optionally remove background noise from the sample before cloning.
   * @route POST /clone-voice
   *
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","description":"Public URL of the audio sample. Provide this or Audio Asset ID."}
   * @paramDef {"type":"String","label":"Audio Asset ID","name":"audioAssetId","description":"HeyGen asset ID of an uploaded audio sample. Provide this or Audio URL."}
   * @paramDef {"type":"String","label":"Voice Name","name":"voiceName","required":true,"description":"Display name for the cloned voice."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language hint for the voice, e.g. en or es. Auto-detected when omitted."}
   * @paramDef {"type":"Boolean","label":"Remove Background Noise","name":"removeBackgroundNoise","uiComponent":{"type":"TOGGLE"},"description":"Remove background noise from the audio before cloning."}
   *
   * @returns {Object}
   * @sampleResult {"voice_clone_id":"vc_4d5e6f7a"}
   */
  async cloneVoice(audioUrl, audioAssetId, voiceName, language, removeBackgroundNoise) {
    const logTag = '[cloneVoice]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/voices/clone`,
      method: 'post',
      body: clean({
        audio: this.#assetInput(audioUrl, audioAssetId, 'Audio', true),
        voice_name: voiceName,
        language,
        remove_background_noise: removeBackgroundNoise,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Delete Voice
   * @category Voices & Audio
   * @description Deletes a voice clone owned by the account. The voice must not be in use by any template. Deleting an unknown or already-deleted voice returns a voice_not_found error. Deleted voices no longer count against your voice clone limit.
   * @route DELETE /delete-voice
   *
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"description":"Unique identifier of the cloned voice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"voice_id":"vc_4d5e6f7a"}
   */
  async deleteVoice(voiceId) {
    const logTag = '[deleteVoice]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/voices/${ voiceId }`, method: 'delete' })

    return response.data ?? response
  }

  /**
   * @operationName Generate Speech
   * @category Voices & Audio
   * @description Synthesizes speech audio from text (up to 5,000 characters) using HeyGen's Starfish text-to-speech engine. The chosen voice must support the starfish engine - use List Voices with engine=starfish to find compatible ones. Supports plain text or SSML, speed from 0.5x to 2.0x, and language/locale hints. Returns a presigned audio URL, duration and word timestamps; optionally saves the audio into FlowRunner file storage for a stable URL.
   * @route POST /generate-speech
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to synthesize (1-5,000 characters). May be SSML when Input Type is SSML."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","required":true,"dictionary":"voicesDictionary","description":"Voice to use. Must support the starfish engine."}
   * @paramDef {"type":"String","label":"Input Type","name":"inputType","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","SSML"]}},"defaultValue":"Text","description":"Whether the input is plain text or SSML markup."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Speed multiplier, 0.5 to 2.0."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Base language code, e.g. en, pt or zh. Auto-detected from the text when omitted."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"BCP-47 locale tag, e.g. en-US or pt-BR. When set, the language is inferred from the locale."}
   * @paramDef {"type":"Boolean","label":"Save to File Storage","name":"saveToFileStorage","uiComponent":{"type":"TOGGLE"},"description":"When enabled, downloads the generated audio and stores it in FlowRunner file storage, returning a stable saved_file_url."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"audio_url":"https://resource2.heygen.ai/tts/req_8a9b0c1d.mp3","duration":6.42,"request_id":"req_8a9b0c1d","word_timestamps":[{"word":"Hello","start":0.0,"end":0.38}],"saved_file_url":"https://files.flowrunner.com/.../heygen_speech_1752700000000.mp3"}
   */
  async generateSpeech(text, voiceId, inputType, speed, language, locale, saveToFileStorage, fileOptions) {
    const logTag = '[generateSpeech]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/voices/speech`,
      method: 'post',
      body: clean({
        text,
        voice_id: voiceId,
        input_type: this.#resolveChoice(inputType, TTS_INPUT_TYPE_MAP),
        speed,
        language,
        locale,
      }),
    })

    const result = response.data ?? response

    if (saveToFileStorage && result.audio_url) {
      const buffer = await this.#downloadFile(result.audio_url, logTag)

      result.saved_file_url = await this.#saveToFileStorage(buffer, `heygen_speech_${ Date.now() }.mp3`, fileOptions)
    }

    return result
  }

  /**
   * @operationName Search Audio Library
   * @category Voices & Audio
   * @description Semantically searches HeyGen's audio catalog by natural-language description - set the type to Music for background tracks (e.g. 'upbeat lofi hip-hop', 'tense cinematic riser') or Sound Effects for SFX (e.g. 'whoosh for a scene change'). Returns matching tracks ranked by similarity score with cursor-based pagination.
   * @route GET /search-audio-library
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Natural-language description of the audio you want."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Music","Sound Effects"]}},"defaultValue":"Music","description":"Audio content type to search."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results (1-50)."}
   * @paramDef {"type":"Number","label":"Minimum Score","name":"minScore","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum semantic similarity score (0-1); lower-scoring tracks are omitted."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"aud_2f3e4d5c","name":"Lofi Sunrise","type":"music","duration":92.0,"url":"https://resource2.heygen.ai/audio/aud_2f3e4d5c.mp3","score":0.91}],"has_more":false,"next_token":null}
   */
  async searchAudioLibrary(query, type, limit, minScore, token) {
    const logTag = '[searchAudioLibrary]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/audio/sounds`,
      method: 'get',
      query: {
        query,
        type: this.#resolveChoice(type, AUDIO_SEARCH_TYPE_MAP),
        limit,
        min_score: minScore,
        token,
      },
    })
  }

  // ===========================================================================
  // Lipsync
  // ===========================================================================

  /**
   * @operationName Create Lipsync
   * @category Lipsync
   * @description Replaces the audio track on an existing video and re-animates the speaker's lip movements to match the new audio. Provide the source video and replacement audio each as a public URL or a HeyGen asset ID. Choose Speed mode for fast output or Precision mode for the highest lip-sync quality. Supports partial processing via start/end time, captions, speech enhancement, music-track removal and format preservation. Runs asynchronously; poll with Get Lipsync.
   * @route POST /create-lipsync
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Public URL of the source video. Provide this or Video Asset ID."}
   * @paramDef {"type":"String","label":"Video Asset ID","name":"videoAssetId","description":"HeyGen asset ID of the source video. Provide this or Video URL."}
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","description":"Public URL of the replacement audio. Provide this or Audio Asset ID."}
   * @paramDef {"type":"String","label":"Audio Asset ID","name":"audioAssetId","description":"HeyGen asset ID of the replacement audio. Provide this or Audio URL."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the lipsync job."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Speed","Precision"]}},"defaultValue":"Speed","description":"Speed is faster; Precision produces higher-quality lip-sync."}
   * @paramDef {"type":"Boolean","label":"Enable Captions","name":"enableCaption","uiComponent":{"type":"TOGGLE"},"description":"Generate captions for the output video."}
   * @paramDef {"type":"Boolean","label":"Keep the Same Format","name":"keepTheSameFormat","uiComponent":{"type":"TOGGLE"},"description":"Preserve the source video's encoding specs (resolution, bitrate)."}
   * @paramDef {"type":"Boolean","label":"Enable Dynamic Duration","name":"enableDynamicDuration","uiComponent":{"type":"TOGGLE"},"description":"Allow dynamic duration adjustment."}
   * @paramDef {"type":"Boolean","label":"Disable Music Track","name":"disableMusicTrack","uiComponent":{"type":"TOGGLE"},"description":"Remove background music from the output."}
   * @paramDef {"type":"Boolean","label":"Enable Speech Enhancement","name":"enableSpeechEnhancement","uiComponent":{"type":"TOGGLE"},"description":"Enhance speech quality in the output."}
   * @paramDef {"type":"Boolean","label":"Enable Watermark","name":"enableWatermark","uiComponent":{"type":"TOGGLE"},"description":"Add a watermark to the output."}
   * @paramDef {"type":"Number","label":"Start Time (Seconds)","name":"startTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Start time in seconds for partial lipsync."}
   * @paramDef {"type":"Number","label":"End Time (Seconds)","name":"endTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"End time in seconds for partial lipsync."}
   * @paramDef {"type":"String","label":"FPS Mode","name":"fpsMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Variable (VFR)","Constant (CFR)","Passthrough"]}},"description":"Frame rate mode for the output video."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Project/folder ID to organize the lipsync into."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for completion notifications."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Identifier included in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"lipsync_id":"ls_6b7c8d9e"}
   */
  async createLipsync(videoUrl, videoAssetId, audioUrl, audioAssetId, title, mode, enableCaption, keepTheSameFormat,
    enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement, enableWatermark, startTime, endTime,
    fpsMode, folderId, callbackUrl, callbackId) {
    const logTag = '[createLipsync]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs`,
      method: 'post',
      body: clean({
        video: this.#assetInput(videoUrl, videoAssetId, 'Video', true),
        audio: this.#assetInput(audioUrl, audioAssetId, 'Audio', true),
        title,
        mode: this.#resolveChoice(mode, MODE_MAP),
        enable_caption: enableCaption,
        keep_the_same_format: keepTheSameFormat,
        enable_dynamic_duration: enableDynamicDuration,
        disable_music_track: disableMusicTrack,
        enable_speech_enhancement: enableSpeechEnhancement,
        enable_watermark: enableWatermark,
        start_time: startTime,
        end_time: endTime,
        fps_mode: this.#resolveChoice(fpsMode, FPS_MODE_MAP),
        folder_id: folderId,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Lipsync
   * @category Lipsync
   * @description Returns details for a lipsync job including its status (pending, running, completed or failed), duration, presigned video and caption URLs when complete, and the failure message if it failed.
   * @route GET /get-lipsync
   *
   * @paramDef {"type":"String","label":"Lipsync ID","name":"lipsyncId","required":true,"description":"Unique lipsync job identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ls_6b7c8d9e","title":"Dubbed intro","status":"completed","duration":58.3,"video_url":"https://resource2.heygen.ai/lipsync/ls_6b7c8d9e.mp4","caption_url":null,"callback_id":null,"created_at":1752700000,"failure_message":null}
   */
  async getLipsync(lipsyncId) {
    const logTag = '[getLipsync]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/lipsyncs/${ lipsyncId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName List Lipsyncs
   * @category Lipsync
   * @description Returns a paginated list of all lipsync jobs in the account with their statuses and output URLs.
   * @route GET /list-lipsyncs
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ls_6b7c8d9e","title":"Dubbed intro","status":"completed","duration":58.3}],"has_more":false,"next_token":null}
   */
  async listLipsyncs(limit, token) {
    const logTag = '[listLipsyncs]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Update Lipsync
   * @category Lipsync
   * @description Updates the display title of a lipsync job.
   * @route PATCH /update-lipsync
   *
   * @paramDef {"type":"String","label":"Lipsync ID","name":"lipsyncId","required":true,"description":"Unique lipsync job identifier."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"New title for the lipsync job."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ls_6b7c8d9e","title":"Dubbed intro v2","status":"completed","duration":58.3}
   */
  async updateLipsync(lipsyncId, title) {
    const logTag = '[updateLipsync]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs/${ lipsyncId }`,
      method: 'patch',
      body: { title },
    })

    return response.data ?? response
  }

  /**
   * @operationName Delete Lipsync
   * @category Lipsync
   * @description Permanently deletes a lipsync job and its associated files. This action cannot be undone.
   * @route DELETE /delete-lipsync
   *
   * @paramDef {"type":"String","label":"Lipsync ID","name":"lipsyncId","required":true,"description":"Unique lipsync job identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ls_6b7c8d9e"}
   */
  async deleteLipsync(lipsyncId) {
    const logTag = '[deleteLipsync]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/lipsyncs/${ lipsyncId }`, method: 'delete' })

    return response.data ?? response
  }

  /**
   * @operationName Create Lipsync Batch
   * @category Lipsync
   * @description Submits up to 100 lipsync payloads as a single batch. Each payload uses the same JSON shape as the POST /v3/lipsyncs request body and becomes one batch item, created and processed independently so one bad source does not fail the rest. Returns a batch_id; poll progress with Get Lipsync Batch.
   * @route POST /create-lipsync-batch
   *
   * @paramDef {"type":"Array<Object>","label":"Lipsyncs","name":"lipsyncs","required":true,"description":"Lipsync payloads (max 100), each identical in shape to the HeyGen POST /v3/lipsyncs body, e.g. {\"video\":{\"type\":\"url\",\"url\":\"...\"},\"audio\":{\"type\":\"url\",\"url\":\"...\"}}."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display name for the batch, shown in the HeyGen app."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL invoked once when every item in the batch reaches a terminal state."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_ls_1a2b3c","status":"processing","total_items":5}
   */
  async createLipsyncBatch(lipsyncs, title, callbackUrl) {
    const logTag = '[createLipsyncBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs/batches`,
      method: 'post',
      body: clean({ lipsyncs, title, callback_url: callbackUrl }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Lipsync Batch
   * @category Lipsync
   * @description Returns aggregate status for a lipsync batch plus one page of its items with their IDs and statuses (queued, processing, completed or failed).
   * @route GET /get-lipsync-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"Unique lipsync batch identifier returned by Create Lipsync Batch."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_ls_1a2b3c","title":"Dubbing wave 1","status":"processing","total_items":5,"counts_by_status":{"completed":2,"processing":3},"created_at":1752700000,"items":[{"video_id":"ls_6b7c8d9e","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getLipsyncBatch(batchId, limit, token) {
    const logTag = '[getLipsyncBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs/batches/${ batchId }`,
      method: 'get',
      query: { limit, token },
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Bulk Lipsync Statuses
   * @category Lipsync
   * @description Returns statuses for up to 100 lipsync jobs in one request, addressed by lipsync IDs and/or batch IDs (each batch expands to its member lipsyncs). Statuses are queued, processing, completed or failed, plus not_found for unknown IDs.
   * @route GET /get-bulk-lipsync-statuses
   *
   * @paramDef {"type":"Array<String>","label":"Lipsync IDs","name":"lipsyncIds","description":"Lipsync job IDs to look up (up to 100 total across both parameters)."}
   * @paramDef {"type":"Array<String>","label":"Batch IDs","name":"batchIds","description":"Lipsync batch IDs; each expands to its member jobs."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"video_id":"ls_6b7c8d9e","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getBulkLipsyncStatuses(lipsyncIds, batchIds) {
    const logTag = '[getBulkLipsyncStatuses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/lipsyncs/statuses`,
      method: 'get',
      query: {
        lipsync_ids: lipsyncIds?.length ? lipsyncIds.join(',') : undefined,
        batch_ids: batchIds?.length ? batchIds.join(',') : undefined,
      },
    })
  }

  // ===========================================================================
  // Templates
  // ===========================================================================

  /**
   * @operationName List Templates
   * @category Templates
   * @description Returns a paginated list of API-ready templates in the workspace. Templates are created and edited in the HeyGen web editor; only templates with variables defined are listed here. Use a template's ID with Get Template to inspect its variable schema, then Generate Video from Template to render.
   * @route GET /list-templates
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of templates per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"tpl_3c4d5e6f","name":"Weekly Update","thumbnail_url":"https://resource2.heygen.ai/template/tpl_3c4d5e6f.jpg","aspect_ratio":"16:9"}],"has_more":false,"next_token":null}
   */
  async listTemplates(limit, token) {
    const logTag = '[listTemplates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/templates`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Returns template details including its variable schema (with current default values) and scenes. Variable defaults are returned in the same shape the generate request accepts, so you can edit the response and pass it back as the Variables of Generate Video from Template. Only draft version 4 templates (the current editor format) are supported.
   * @route GET /get-template
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"templatesDictionary","description":"Unique template identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"tpl_3c4d5e6f","name":"Weekly Update","thumbnail_url":"https://resource2.heygen.ai/template/tpl_3c4d5e6f.jpg","aspect_ratio":"16:9","created_at":1750000000,"updated_at":1752000000,"variables":{"headline":{"name":"headline","type":"text","properties":{"content":"Hello!"}}},"scene_ids":["scn_1","scn_2"],"scenes":[{"id":"scn_1","name":"Intro"}]}
   */
  async getTemplate(templateId) {
    const logTag = '[getTemplate]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/templates/${ templateId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName Generate Video from Template
   * @category Templates
   * @description Generates a video from a template by replacing its variables (text, image, video, audio, character, voice), keyed by the variable names defined in the template - inspect them with Get Template. Use Scene IDs to select, reorder or repeat existing scenes. Supports burned-in captions, subtitle styling, an output resolution override (must match the template's aspect ratio), frame rate selection (25, 30 or 60), folder placement, brand voice pronunciation, GIF previews and public sharing. Returns the created video; poll with Get Video.
   * @route POST /generate-video-from-template
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"templatesDictionary","description":"Unique template identifier."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","required":true,"description":"Template variable replacements keyed by variable name, in the same shape returned by Get Template, e.g. {\"headline\":{\"name\":\"headline\",\"type\":\"text\",\"properties\":{\"content\":\"Big news!\"}}}."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the generated video."}
   * @paramDef {"type":"Boolean","label":"Burn Captions","name":"caption","uiComponent":{"type":"TOGGLE"},"description":"Whether to burn captions into the video."}
   * @paramDef {"type":"Object","label":"Subtitle Settings","name":"subtitles","description":"Subtitle style settings (implies captions), e.g. {\"preset_name\":\"classic\",\"alignment\":2}."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Folder to place the generated video in."}
   * @paramDef {"type":"String","label":"Brand Voice ID","name":"brandVoiceId","description":"Brand voice ID controlling pronunciation."}
   * @paramDef {"type":"Number","label":"Output Width","name":"dimensionWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output video width in pixels (even number, 128-4096). Set together with Output Height; must keep the template's aspect ratio."}
   * @paramDef {"type":"Number","label":"Output Height","name":"dimensionHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output video height in pixels (even number, 128-4096). Set together with Output Width."}
   * @paramDef {"type":"Number","label":"FPS","name":"fps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output frame rate: 25, 30 or 60."}
   * @paramDef {"type":"Array<String>","label":"Scene IDs","name":"sceneIds","description":"Scene IDs to render, in order (repeats allowed). Scenes must already exist in the template."}
   * @paramDef {"type":"Boolean","label":"Reorder Music","name":"reorderMusic","uiComponent":{"type":"TOGGLE"},"description":"When true (default), background audio tracks move with their scenes; when false, tracks stay pinned to layout positions."}
   * @paramDef {"type":"Boolean","label":"Keep Text Vertically Centered","name":"keepTextVerticallyCentered","uiComponent":{"type":"TOGGLE"},"description":"Vertically re-center replaced text elements based on their rendered height."}
   * @paramDef {"type":"Boolean","label":"Include GIF","name":"includeGif","uiComponent":{"type":"TOGGLE"},"description":"Include a GIF preview in the webhook payload."}
   * @paramDef {"type":"Boolean","label":"Enable Sharing","name":"enableSharing","uiComponent":{"type":"TOGGLE"},"description":"Make the generated video's share page publicly accessible."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"URL called with the video result in addition to registered webhook endpoints."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Opaque ID echoed back in webhook events for this video."}
   *
   * @returns {Object}
   * @sampleResult {"id":"91ab4f21c30d4e17a2b3","title":"Weekly Update - May 12","status":"pending","created_at":1752700000,"video_url":null,"thumbnail_url":null,"duration":null,"folder_id":null,"video_page_url":"https://app.heygen.com/videos/91ab4f21c30d4e17a2b3"}
   */
  async generateVideoFromTemplate(templateId, variables, title, caption, subtitles, folderId, brandVoiceId,
    dimensionWidth, dimensionHeight, fps, sceneIds, reorderMusic, keepTextVerticallyCentered, includeGif,
    enableSharing, callbackUrl, callbackId) {
    const logTag = '[generateVideoFromTemplate]'

    if ((dimensionWidth && !dimensionHeight) || (dimensionHeight && !dimensionWidth)) {
      throw new Error('Output Width and Output Height must be provided together')
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/templates/${ templateId }`,
      method: 'post',
      body: clean({
        variables,
        title,
        caption,
        subtitles,
        folder_id: folderId,
        brand_voice_id: brandVoiceId,
        dimension: dimensionWidth ? { width: dimensionWidth, height: dimensionHeight } : undefined,
        fps,
        scene_ids: sceneIds?.length ? sceneIds : undefined,
        reorder_music: reorderMusic,
        keep_text_vertically_centered: keepTextVerticallyCentered,
        include_gif: includeGif,
        enable_sharing: enableSharing,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }
  // ===========================================================================
  // Video Translation
  // ===========================================================================

  /**
   * @operationName Create Video Translation
   * @category Video Translation
   * @description Translates a video into one or more target languages with voice cloning and lip-sync. Provide the source video as a public URL or asset ID and one or more target language names (use List Translation Target Languages for valid values). Choose Speed mode (default) for fast turnaround or Precision for higher lip-sync quality. Supports custom dub audio, audio-only translation, speaker separation, captions, brand glossaries for custom term translations, partial translation via start/end times, custom SRT files, stock voices and more. Returns one video_translation_id per target language; poll each with Get Video Translation.
   * @route POST /create-video-translation
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Public URL of the source video. Provide this or Video Asset ID."}
   * @paramDef {"type":"String","label":"Video Asset ID","name":"videoAssetId","description":"HeyGen asset ID of the source video. Provide this or Video URL."}
   * @paramDef {"type":"String","label":"Output Language","name":"outputLanguage","dictionary":"targetLanguagesDictionary","description":"Target language name, e.g. 'Spanish (Spain)'. Provide this and/or Additional Output Languages."}
   * @paramDef {"type":"Array<String>","label":"Additional Output Languages","name":"additionalOutputLanguages","description":"Further target language names for multi-language translation; each produces its own translation job."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the translation job."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Speed","Precision"]}},"defaultValue":"Speed","description":"Speed is faster; Precision uses avatar inference for higher lip-sync quality."}
   * @paramDef {"type":"String","label":"Input Language","name":"inputLanguage","description":"Source language code. Auto-detected when omitted."}
   * @paramDef {"type":"String","label":"Dub Audio URL","name":"audioUrl","description":"Public URL of custom audio to use for dubbing. Provide this or Dub Audio Asset ID."}
   * @paramDef {"type":"String","label":"Dub Audio Asset ID","name":"audioAssetId","description":"HeyGen asset ID of custom dubbing audio."}
   * @paramDef {"type":"Boolean","label":"Translate Audio Only","name":"translateAudioOnly","uiComponent":{"type":"TOGGLE"},"description":"Only translate the audio and keep the original video frames."}
   * @paramDef {"type":"Number","label":"Speaker Count","name":"speakerNum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of speakers in the video; improves speaker separation."}
   * @paramDef {"type":"Boolean","label":"Enable Captions","name":"enableCaption","uiComponent":{"type":"TOGGLE"},"description":"Generate captions for the translated video."}
   * @paramDef {"type":"Boolean","label":"Keep the Same Format","name":"keepTheSameFormat","uiComponent":{"type":"TOGGLE"},"description":"Preserve the source video's encoding specs (resolution, bitrate)."}
   * @paramDef {"type":"Boolean","label":"Enable Dynamic Duration","name":"enableDynamicDuration","uiComponent":{"type":"TOGGLE"},"description":"Allow dynamic duration adjustment."}
   * @paramDef {"type":"Boolean","label":"Disable Music Track","name":"disableMusicTrack","uiComponent":{"type":"TOGGLE"},"description":"Remove background music from the output."}
   * @paramDef {"type":"Boolean","label":"Enable Speech Enhancement","name":"enableSpeechEnhancement","uiComponent":{"type":"TOGGLE"},"description":"Enhance speech quality in the output."}
   * @paramDef {"type":"Boolean","label":"Enable Watermark","name":"enableWatermark","uiComponent":{"type":"TOGGLE"},"description":"Add a watermark to the output."}
   * @paramDef {"type":"Number","label":"Start Time (Seconds)","name":"startTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Start time in seconds for partial translation."}
   * @paramDef {"type":"Number","label":"End Time (Seconds)","name":"endTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"End time in seconds for partial translation."}
   * @paramDef {"type":"String","label":"Brand Glossary ID","name":"brandGlossaryId","description":"Brand glossary ID (from List Brand Glossaries) enforcing custom term translations."}
   * @paramDef {"type":"Object","label":"Stock Voice Config","name":"stockVoiceConfig","description":"Use a preset stock voice instead of cloning the original speaker (enterprise feature), e.g. {\"use_stock_voice\":true}."}
   * @paramDef {"type":"String","label":"SRT URL","name":"srtUrl","description":"Public URL of a custom subtitle file to use."}
   * @paramDef {"type":"String","label":"SRT Role","name":"srtRole","uiComponent":{"type":"DROPDOWN","options":{"values":["Input","Output"]}},"description":"Which video the SRT applies to: Input (source) or Output (translated). Used with SRT URL."}
   * @paramDef {"type":"String","label":"FPS Mode","name":"fpsMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Variable (VFR)","Constant (CFR)","Passthrough"]}},"description":"Frame rate mode for the output video."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Project/folder ID to organize the translation into."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for completion notifications."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Identifier included in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"video_translation_ids":["vt_9d8c7b6a"]}
   */
  async createVideoTranslation(videoUrl, videoAssetId, outputLanguage, additionalOutputLanguages, title, mode,
    inputLanguage, audioUrl, audioAssetId, translateAudioOnly, speakerNum, enableCaption, keepTheSameFormat,
    enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement, enableWatermark, startTime, endTime,
    brandGlossaryId, stockVoiceConfig, srtUrl, srtRole, fpsMode, folderId, callbackUrl, callbackId) {
    const logTag = '[createVideoTranslation]'

    const outputLanguages = [
      ...(outputLanguage ? [outputLanguage] : []),
      ...(additionalOutputLanguages || []),
    ]

    if (!outputLanguages.length) {
      throw new Error('Provide an Output Language (or Additional Output Languages)')
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations`,
      method: 'post',
      body: clean({
        video: this.#assetInput(videoUrl, videoAssetId, 'Video', true),
        output_languages: outputLanguages,
        title,
        mode: this.#resolveChoice(mode, MODE_MAP),
        input_language: inputLanguage,
        audio: this.#assetInput(audioUrl, audioAssetId, 'Dub Audio'),
        translate_audio_only: translateAudioOnly,
        speaker_num: speakerNum,
        enable_caption: enableCaption,
        keep_the_same_format: keepTheSameFormat,
        enable_dynamic_duration: enableDynamicDuration,
        disable_music_track: disableMusicTrack,
        enable_speech_enhancement: enableSpeechEnhancement,
        enable_watermark: enableWatermark,
        start_time: startTime,
        end_time: endTime,
        brand_glossary_id: brandGlossaryId,
        stock_voice_config: stockVoiceConfig,
        srt: srtUrl ? { type: 'url', url: srtUrl } : undefined,
        srt_role: this.#resolveChoice(srtRole, SRT_ROLE_MAP),
        fps_mode: this.#resolveChoice(fpsMode, FPS_MODE_MAP),
        folder_id: folderId,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Video Translation
   * @category Video Translation
   * @description Returns details for a translation job: status (pending, running, completed or failed), input/output languages, duration, presigned video/audio URLs, SRT and VTT caption URLs when captions were enabled, and the failure message if it failed.
   * @route GET /get-video-translation
   *
   * @paramDef {"type":"String","label":"Video Translation ID","name":"videoTranslationId","required":true,"description":"Unique video translation identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vt_9d8c7b6a","title":"Promo - Spanish","status":"completed","output_language":"Spanish (Spain)","input_language":"English","duration":73.4,"translate_audio_only":false,"video_url":"https://resource2.heygen.ai/translate/vt_9d8c7b6a.mp4","audio_url":null,"srt_caption_url":null,"vtt_caption_url":null,"callback_id":null,"created_at":1752700000,"failure_message":null}
   */
  async getVideoTranslation(videoTranslationId) {
    const logTag = '[getVideoTranslation]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/${ videoTranslationId }`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName List Video Translations
   * @category Video Translation
   * @description Returns a paginated list of all video translation jobs in the account with their statuses, languages and output URLs.
   * @route GET /list-video-translations
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"vt_9d8c7b6a","title":"Promo - Spanish","status":"completed","output_language":"Spanish (Spain)","duration":73.4}],"has_more":false,"next_token":null}
   */
  async listVideoTranslations(limit, token) {
    const logTag = '[listVideoTranslations]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Update Video Translation
   * @category Video Translation
   * @description Updates the display title of a video translation job.
   * @route PATCH /update-video-translation
   *
   * @paramDef {"type":"String","label":"Video Translation ID","name":"videoTranslationId","required":true,"description":"Unique video translation identifier."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"New title for the translation job."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vt_9d8c7b6a","title":"Promo ES v2","status":"completed","output_language":"Spanish (Spain)","duration":73.4}
   */
  async updateVideoTranslation(videoTranslationId, title) {
    const logTag = '[updateVideoTranslation]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/${ videoTranslationId }`,
      method: 'patch',
      body: { title },
    })

    return response.data ?? response
  }

  /**
   * @operationName Delete Video Translation
   * @category Video Translation
   * @description Permanently deletes a video translation and its associated files. This action cannot be undone.
   * @route DELETE /delete-video-translation
   *
   * @paramDef {"type":"String","label":"Video Translation ID","name":"videoTranslationId","required":true,"description":"Unique video translation identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vt_9d8c7b6a"}
   */
  async deleteVideoTranslation(videoTranslationId) {
    const logTag = '[deleteVideoTranslation]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/${ videoTranslationId }`,
      method: 'delete',
    })

    return response.data ?? response
  }

  /**
   * @operationName List Translation Target Languages
   * @category Video Translation
   * @description Returns all supported target language names for video translation, e.g. 'English', 'Spanish (Spain)', 'Chinese (Cantonese, Traditional)'. Use these exact names as Output Language values in Create Video Translation and Create Proofread Session.
   * @route GET /list-translation-target-languages
   *
   * @returns {Object}
   * @sampleResult {"languages":["English","Spanish (Spain)","Spanish (Mexico)","French","German","Portuguese (Brazil)","Chinese (Cantonese, Traditional)"]}
   */
  async listTranslationTargetLanguages() {
    const logTag = '[listTranslationTargetLanguages]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/languages`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Bulk Video Translation Statuses
   * @category Video Translation
   * @description Returns statuses for up to 100 video translations in one request, addressed by translation IDs and/or batch IDs (each batch expands to its member translations). Statuses are queued, processing, completed or failed, plus not_found for unknown IDs.
   * @route GET /get-bulk-video-translation-statuses
   *
   * @paramDef {"type":"Array<String>","label":"Video Translation IDs","name":"videoTranslationIds","description":"Video translation IDs to look up (up to 100 total across both parameters)."}
   * @paramDef {"type":"Array<String>","label":"Batch IDs","name":"batchIds","description":"Translation batch IDs; each expands to its member translations."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"video_id":"vt_9d8c7b6a","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getBulkVideoTranslationStatuses(videoTranslationIds, batchIds) {
    const logTag = '[getBulkVideoTranslationStatuses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/statuses`,
      method: 'get',
      query: {
        video_translation_ids: videoTranslationIds?.length ? videoTranslationIds.join(',') : undefined,
        batch_ids: batchIds?.length ? batchIds.join(',') : undefined,
      },
    })
  }

  /**
   * @operationName Create Video Translation Batch
   * @category Video Translation
   * @description Submits up to 100 video-translation payloads (identical in shape to the POST /v3/video-translations body) as a single batch. A payload targeting multiple output_languages expands to one batch item per language, and each item is processed independently so one bad source does not fail the rest. Returns a batch_id; poll progress with Get Video Translation Batch.
   * @route POST /create-video-translation-batch
   *
   * @paramDef {"type":"Array<Object>","label":"Video Translations","name":"videoTranslations","required":true,"description":"Translation payloads (max 100), each identical in shape to the HeyGen POST /v3/video-translations body, e.g. {\"video\":{\"type\":\"url\",\"url\":\"...\"},\"output_languages\":[\"French\"]}."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display name for the batch, shown in the HeyGen app."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL invoked once when every item in the batch reaches a terminal state."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_vt_4e5f6a","status":"processing","total_items":8}
   */
  async createVideoTranslationBatch(videoTranslations, title, callbackUrl) {
    const logTag = '[createVideoTranslationBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/batches`,
      method: 'post',
      body: clean({ video_translations: videoTranslations, title, callback_url: callbackUrl }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Video Translation Batch
   * @category Video Translation
   * @description Returns aggregate status for a video translation batch plus one page of its items with their IDs and statuses (queued, processing, completed or failed).
   * @route GET /get-video-translation-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"Unique translation batch identifier returned by Create Video Translation Batch."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_vt_4e5f6a","title":"Localization wave","status":"processing","total_items":8,"counts_by_status":{"completed":3,"processing":5},"created_at":1752700000,"items":[{"video_id":"vt_9d8c7b6a","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getVideoTranslationBatch(batchId, limit, token) {
    const logTag = '[getVideoTranslationBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/batches/${ batchId }`,
      method: 'get',
      query: { limit, token },
    })

    return response.data ?? response
  }

  /**
   * @operationName Create Proofread Session
   * @category Video Translation
   * @description Creates a proofread session that extracts editable translated subtitles from a video BEFORE the final render, so a human can review and correct the translation. Workflow: create the session, poll Get Proofread Session until completed, download the SRT with Get Proofread SRT URLs, optionally upload an edited SRT with Upload Proofread SRT, then render with Generate Video from Proofread. Returns one proofread_id per target language.
   * @route POST /create-proofread-session
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Public URL of the source video. Provide this or Video Asset ID."}
   * @paramDef {"type":"String","label":"Video Asset ID","name":"videoAssetId","description":"HeyGen asset ID of the source video. Provide this or Video URL."}
   * @paramDef {"type":"String","label":"Output Language","name":"outputLanguage","dictionary":"targetLanguagesDictionary","description":"Target language name. Provide this and/or Additional Output Languages."}
   * @paramDef {"type":"Array<String>","label":"Additional Output Languages","name":"additionalOutputLanguages","description":"Further target language names; each produces its own proofread session."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title for the proofread job."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Speed","Precision"]}},"description":"Translation quality mode used for the eventual render."}
   * @paramDef {"type":"String","label":"Brand Glossary ID","name":"brandGlossaryId","description":"Brand glossary ID enforcing custom term translations."}
   * @paramDef {"type":"Number","label":"Speaker Count","name":"speakerNum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of speakers; improves speaker separation."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Project/folder ID to organize the proofread into."}
   * @paramDef {"type":"Boolean","label":"Enable Video Stretching","name":"enableVideoStretching","uiComponent":{"type":"TOGGLE"},"description":"Allow dynamic duration adjustment."}
   * @paramDef {"type":"Boolean","label":"Disable Music Track","name":"disableMusicTrack","uiComponent":{"type":"TOGGLE"},"description":"Remove background music."}
   * @paramDef {"type":"Boolean","label":"Enable Speech Enhancement","name":"enableSpeechEnhancement","uiComponent":{"type":"TOGGLE"},"description":"Enhance speech quality."}
   * @paramDef {"type":"String","label":"Initial SRT URL","name":"srtUrl","description":"Public URL of an initial SRT file to start from."}
   * @paramDef {"type":"Boolean","label":"Keep the Same Format","name":"keepTheSameFormat","uiComponent":{"type":"TOGGLE"},"description":"Preserve the source video's encoding specs."}
   *
   * @returns {Object}
   * @sampleResult {"proofread_ids":["pr_5f6a7b8c"],"status":"processing"}
   */
  async createProofreadSession(videoUrl, videoAssetId, outputLanguage, additionalOutputLanguages, title, mode,
    brandGlossaryId, speakerNum, folderId, enableVideoStretching, disableMusicTrack, enableSpeechEnhancement,
    srtUrl, keepTheSameFormat) {
    const logTag = '[createProofreadSession]'

    const outputLanguages = [
      ...(outputLanguage ? [outputLanguage] : []),
      ...(additionalOutputLanguages || []),
    ]

    if (!outputLanguages.length) {
      throw new Error('Provide an Output Language (or Additional Output Languages)')
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/proofreads`,
      method: 'post',
      body: clean({
        video: this.#assetInput(videoUrl, videoAssetId, 'Video', true),
        output_languages: outputLanguages,
        title,
        mode: this.#resolveChoice(mode, MODE_MAP),
        brand_glossary_id: brandGlossaryId,
        speaker_num: speakerNum,
        folder_id: folderId,
        enable_video_stretching: enableVideoStretching,
        disable_music_track: disableMusicTrack,
        enable_speech_enhancement: enableSpeechEnhancement,
        srt: srtUrl ? { type: 'url', url: srtUrl } : undefined,
        keep_the_same_format: keepTheSameFormat,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Proofread Session
   * @category Video Translation
   * @description Returns the status (processing, completed or failed) and details of a proofread session, including input/output languages and whether the edited subtitles have been submitted for review.
   * @route GET /get-proofread-session
   *
   * @paramDef {"type":"String","label":"Proofread ID","name":"proofreadId","required":true,"description":"Unique proofread session identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pr_5f6a7b8c","title":"Promo - French review","status":"completed","output_language":"French","input_language":"English","submitted_for_review":false,"created_at":1752700000,"failure_message":null}
   */
  async getProofreadSession(proofreadId) {
    const logTag = '[getProofreadSession]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/proofreads/${ proofreadId }`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Proofread SRT URLs
   * @category Video Translation
   * @description Returns presigned download URLs for the current (edited) and original SRT subtitle files of a completed proofread session. Download the SRT, edit it, then push it back with Upload Proofread SRT.
   * @route GET /get-proofread-srt-urls
   *
   * @paramDef {"type":"String","label":"Proofread ID","name":"proofreadId","required":true,"description":"Unique proofread session identifier."}
   *
   * @returns {Object}
   * @sampleResult {"srt_url":"https://resource2.heygen.ai/proofread/pr_5f6a7b8c_edited.srt","original_srt_url":"https://resource2.heygen.ai/proofread/pr_5f6a7b8c_original.srt"}
   */
  async getProofreadSrtUrls(proofreadId) {
    const logTag = '[getProofreadSrtUrls]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/proofreads/${ proofreadId }/srt`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName Upload Proofread SRT
   * @category Video Translation
   * @description Replaces a proofread session's subtitles with an edited SRT file (public URL or uploaded asset). Do this after reviewing the SRT from Get Proofread SRT URLs and before rendering with Generate Video from Proofread.
   * @route PUT /upload-proofread-srt
   *
   * @paramDef {"type":"String","label":"Proofread ID","name":"proofreadId","required":true,"description":"Unique proofread session identifier."}
   * @paramDef {"type":"String","label":"SRT URL","name":"srtUrl","description":"Public URL of the edited SRT file. Provide this or SRT Asset ID."}
   * @paramDef {"type":"String","label":"SRT Asset ID","name":"srtAssetId","description":"HeyGen asset ID of the edited SRT file. Provide this or SRT URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pr_5f6a7b8c","title":"Promo - French review","status":"completed","output_language":"French","submitted_for_review":true,"created_at":1752700000}
   */
  async uploadProofreadSrt(proofreadId, srtUrl, srtAssetId) {
    const logTag = '[uploadProofreadSrt]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/proofreads/${ proofreadId }/srt`,
      method: 'put',
      body: { srt: this.#assetInput(srtUrl, srtAssetId, 'SRT', true) },
    })

    return response.data ?? response
  }

  /**
   * @operationName Generate Video from Proofread
   * @category Video Translation
   * @description Starts final translated-video generation using the approved subtitles from a proofread session. Returns a video_translation_id to poll with Get Video Translation. Optionally generate captions, translate audio only, or set webhook callbacks.
   * @route POST /generate-video-from-proofread
   *
   * @paramDef {"type":"String","label":"Proofread ID","name":"proofreadId","required":true,"description":"Completed proofread session to render from."}
   * @paramDef {"type":"Boolean","label":"Generate Captions","name":"captions","uiComponent":{"type":"TOGGLE"},"description":"Generate captions for the translated video."}
   * @paramDef {"type":"Boolean","label":"Translate Audio Only","name":"translateAudioOnly","uiComponent":{"type":"TOGGLE"},"description":"Only translate the audio and keep the original video frames."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for completion notifications."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Identifier included in the webhook payload."}
   *
   * @returns {Object}
   * @sampleResult {"video_translation_id":"vt_2a3b4c5d","status":"processing"}
   */
  async generateVideoFromProofread(proofreadId, captions, translateAudioOnly, callbackUrl, callbackId) {
    const logTag = '[generateVideoFromProofread]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/proofreads/${ proofreadId }/generate`,
      method: 'post',
      body: clean({
        captions,
        translate_audio_only: translateAudioOnly,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  // ===========================================================================
  // AI Clipping
  // ===========================================================================

  /**
   * @operationName Create AI Clipping Job
   * @category AI Clipping
   * @description Submits a long-form source video and asynchronously produces one or more short highlight clips. Choose one to four target durations (30 Seconds, 60 Seconds, 3 Minutes, or Long for the model's choice over 3 minutes), an aspect ratio (Portrait is the social-ready default), burned-in captions with an optional style preset, and optional editorial guidance for the highlight model. Poll with Get AI Clipping Job or subscribe to ai_clipping webhooks.
   * @route POST /create-ai-clipping-job
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Public URL of the source video. Provide this or Video Asset ID."}
   * @paramDef {"type":"String","label":"Video Asset ID","name":"videoAssetId","description":"HeyGen asset ID of the source video. Provide this or Video URL."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the job. Defaults to the source video's title."}
   * @paramDef {"type":"String","label":"Input Language","name":"inputLanguage","description":"ISO-639-1 source language code, e.g. en or es. Auto-detected when omitted."}
   * @paramDef {"type":"Array<String>","label":"Clip Durations","name":"durationTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["30 Seconds","60 Seconds","3 Minutes","Long (Auto)"]}},"description":"Target clip durations to produce (1-4); each produces a separate clip. 'Long (Auto)' lets the model pick a length over 3 minutes."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["Landscape","Portrait","Square"]}},"description":"Aspect ratio for all produced clips. Defaults to Portrait (9:16, social-ready)."}
   * @paramDef {"type":"Boolean","label":"Burn Captions","name":"captions","uiComponent":{"type":"TOGGLE"},"description":"Burn captions into the clips. Defaults to true."}
   * @paramDef {"type":"String","label":"Caption Style","name":"captionStyle","description":"Named caption style preset, e.g. classic or bold. Omit for the default style."}
   * @paramDef {"type":"String","label":"Editorial Prompt","name":"editorialPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Editorial guidance for the highlight model (max 500 characters), e.g. 'focus on the pricing announcement'."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"HTTPS URL to receive per-job webhook callbacks."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Opaque identifier echoed verbatim in webhook payloads."}
   *
   * @returns {Object}
   * @sampleResult {"id":"clip_7a8b9c0d","status":"pending","title":"Keynote highlights","created_at":1752700000}
   */
  async createAiClippingJob(videoUrl, videoAssetId, title, inputLanguage, durationTypes, aspectRatio, captions,
    captionStyle, editorialPrompt, callbackUrl, callbackId) {
    const logTag = '[createAiClippingJob]'

    const outputSettings = clean({
      duration_types: this.#resolveChoices(durationTypes, CLIP_DURATION_MAP),
      aspect_ratio: this.#resolveChoice(aspectRatio, CLIP_ASPECT_MAP),
      captions,
      caption_style: captionStyle,
      prompt: editorialPrompt,
    })

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/ai-clipping`,
      method: 'post',
      body: clean({
        video: this.#assetInput(videoUrl, videoAssetId, 'Video', true),
        title,
        input_language: inputLanguage,
        output_settings: Object.keys(outputSettings).length ? outputSettings : undefined,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get AI Clipping Job
   * @category AI Clipping
   * @description Returns the full AI clipping job including status (pending, running, completed, failed or cancelled), progress, output settings, and the produced clips with their statuses and presigned download URLs.
   * @route GET /get-ai-clipping-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Unique AI clipping job identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"clip_7a8b9c0d","title":"Keynote highlights","status":"completed","input_language":"en","source_duration":1830.0,"output_settings":{"duration_types":["60"],"aspect_ratio":"portrait","captions":true},"clips":[{"clip_id":"c_1","title":"Pricing reveal","status":"completed","duration":58.0,"video_url":"https://resource2.heygen.ai/clips/c_1.mp4"}],"progress":100,"callback_id":null,"created_at":1752700000,"failure_message":null}
   */
  async getAiClippingJob(jobId) {
    const logTag = '[getAiClippingJob]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/ai-clipping/${ jobId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName List AI Clipping Jobs
   * @category AI Clipping
   * @description Returns a cursor-paginated list of AI clipping jobs in the workspace, newest first. Each item embeds its full clip list, so the default page size is smaller than other lists.
   * @route GET /list-ai-clipping-jobs
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of jobs per page. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"clip_7a8b9c0d","title":"Keynote highlights","status":"completed","progress":100}],"has_more":false,"next_token":null}
   */
  async listAiClippingJobs(limit, token) {
    const logTag = '[listAiClippingJobs]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/ai-clipping`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Delete AI Clipping Job
   * @category AI Clipping
   * @description Soft-deletes an AI clipping job and its produced clips. Subsequent reads of the job return not found.
   * @route DELETE /delete-ai-clipping-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Unique AI clipping job identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"clip_7a8b9c0d"}
   */
  async deleteAiClippingJob(jobId) {
    const logTag = '[deleteAiClippingJob]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/ai-clipping/${ jobId }`, method: 'delete' })

    return response.data ?? response
  }

  // ===========================================================================
  // Background Removal
  // ===========================================================================

  /**
   * @operationName Create Background Removal
   * @category Background Removal
   * @description Submits a video for background removal. Runs asynchronously; poll with Get Background Removal. Once completed, the job carries presigned download URLs for the requested layers: Foreground (subject on a transparent background), Mask (grayscale alpha matte) and Background (the scene with the subject removed). All three layers are produced when none are specified. Supports a client-provided request ID as an idempotency key.
   * @route POST /create-background-removal
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Public URL of the input video. Provide this or Video Asset ID."}
   * @paramDef {"type":"String","label":"Video Asset ID","name":"videoAssetId","description":"HeyGen asset ID of the input video. Provide this or Video URL."}
   * @paramDef {"type":"Array<String>","label":"Layers","name":"layers","uiComponent":{"type":"DROPDOWN","options":{"values":["Foreground","Mask","Background"]}},"description":"Output layers to return. Defaults to all three."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Human-readable title for the job."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","description":"Client-provided idempotency key; re-sending the same value returns the original job instead of creating a duplicate."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bgr_1b2c3d4e","status":"processing","layers":null,"duration":null,"created_at":1752700000,"completed_at":null,"error":null}
   */
  async createBackgroundRemoval(videoUrl, videoAssetId, layers, title, requestId) {
    const logTag = '[createBackgroundRemoval]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/background-removals`,
      method: 'post',
      body: clean({
        video: this.#assetInput(videoUrl, videoAssetId, 'Video', true),
        layers: this.#resolveChoices(layers, LAYER_MAP),
        title,
        request_id: requestId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Background Removal
   * @category Background Removal
   * @description Returns a background removal job including its status and, once completed, presigned download URLs for the produced foreground, mask and background layers.
   * @route GET /get-background-removal
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Background removal job identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bgr_1b2c3d4e","status":"completed","layers":{"foreground":"https://resource2.heygen.ai/bgr/fg.webm","mask":"https://resource2.heygen.ai/bgr/mask.mp4","background":"https://resource2.heygen.ai/bgr/bg.mp4"},"duration":21.7,"created_at":1752700000,"completed_at":1752700310,"error":null}
   */
  async getBackgroundRemoval(jobId) {
    const logTag = '[getBackgroundRemoval]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/background-removals/${ jobId }`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName List Background Removals
   * @category Background Removal
   * @description Returns a paginated list of background removal jobs for the account, newest first.
   * @route GET /list-background-removals
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of jobs per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"bgr_1b2c3d4e","status":"completed","duration":21.7,"created_at":1752700000}],"has_more":false,"next_token":null}
   */
  async listBackgroundRemovals(limit, token) {
    const logTag = '[listBackgroundRemovals]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/background-removals`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Delete Background Removal
   * @category Background Removal
   * @description Soft-deletes a background removal job. Subsequent reads of the job return not found.
   * @route DELETE /delete-background-removal
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Background removal job identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bgr_1b2c3d4e","deleted":true}
   */
  async deleteBackgroundRemoval(jobId) {
    const logTag = '[deleteBackgroundRemoval]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/background-removals/${ jobId }`,
      method: 'delete',
    })

    return response.data ?? response
  }

  // ===========================================================================
  // HyperFrames
  // ===========================================================================

  /**
   * @operationName Create HyperFrames Render
   * @category HyperFrames
   * @description Renders a HyperFrames composition - an HTML+JS+assets project bundled as a .zip - into a video. Submit the project zip via public URL or a pre-uploaded HeyGen asset ID, choose the entry HTML file, and optionally override the composition's variables to parameterize a single project into many videos. Supports quality presets, MP4/WebM/MOV output, 1080p or 4K, and 16:9, 9:16 or 1:1 aspect ratios. Returns a render_id to poll with Get HyperFrames Render.
   * @route POST /create-hyperframes-render
   *
   * @paramDef {"type":"String","label":"Project URL","name":"projectUrl","description":"Public URL of the HyperFrames project .zip. Provide this or Project Asset ID."}
   * @paramDef {"type":"String","label":"Project Asset ID","name":"projectAssetId","description":"HeyGen asset ID of a pre-uploaded project .zip. Provide this or Project URL."}
   * @paramDef {"type":"String","label":"Composition","name":"composition","description":"Entry HTML file relative to the project root, e.g. compositions/intro.html. Defaults to index.html."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","description":"Overrides for the composition's data-composition-variables, e.g. {\"headline\":\"Q3 results\"}."}
   * @paramDef {"type":"Number","label":"FPS","name":"fps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output frames per second. Defaults to 30."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Standard","High"]}},"description":"Render quality preset; higher quality is slower."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["MP4","WebM","MOV"]}},"description":"Output container/codec."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["1080p","4K"]}},"description":"Output resolution tier. 4K carries a 1.5x pricing multiplier."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","1:1"]}},"description":"Output aspect ratio."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Free-text label for the render; echoed back in detail responses."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"HTTPS webhook URL fired when the render terminates."}
   * @paramDef {"type":"String","label":"Callback ID","name":"callbackId","description":"Opaque client tracking ID echoed back in webhook payloads."}
   *
   * @returns {Object}
   * @sampleResult {"render_id":"hfr_8c9d0e1f","status":"queued","format":"mp4","created_at":1752700000}
   */
  async createHyperframesRender(projectUrl, projectAssetId, composition, variables, fps, quality, format,
    resolution, aspectRatio, title, callbackUrl, callbackId) {
    const logTag = '[createHyperframesRender]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/hyperframes/renders`,
      method: 'post',
      body: clean({
        project: this.#assetInput(projectUrl, projectAssetId, 'Project', true),
        composition,
        variables,
        fps,
        quality: this.#resolveChoice(quality, QUALITY_MAP),
        format: this.#resolveChoice(format, OUTPUT_FORMAT_MAP),
        resolution: this.#resolveChoice(resolution, RESOLUTION_MAP),
        aspect_ratio: aspectRatio,
        title,
        callback_url: callbackUrl,
        callback_id: callbackId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Get HyperFrames Render
   * @category HyperFrames
   * @description Returns full details for a HyperFrames render including its status (queued, rendering, completed or failed), render settings, and the signed video and thumbnail URLs once complete.
   * @route GET /get-hyperframes-render
   *
   * @paramDef {"type":"String","label":"Render ID","name":"renderId","required":true,"description":"Unique HyperFrames render identifier."}
   *
   * @returns {Object}
   * @sampleResult {"render_id":"hfr_8c9d0e1f","status":"completed","title":"Data viz intro","video_url":"https://resource2.heygen.ai/hyperframes/hfr_8c9d0e1f.mp4","thumbnail_url":"https://resource2.heygen.ai/hyperframes/hfr_8c9d0e1f.jpg","duration":12.0,"fps":30,"quality":"standard","format":"mp4","resolution":"1080p","aspect_ratio":"16:9","composition":"index.html","created_at":1752700000,"completed_at":1752700140,"failure_message":null}
   */
  async getHyperframesRender(renderId) {
    const logTag = '[getHyperframesRender]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/hyperframes/renders/${ renderId }`,
      method: 'get',
    })

    return response.data ?? response
  }

  /**
   * @operationName List HyperFrames Renders
   * @category HyperFrames
   * @description Returns a cursor-paginated list of HyperFrames renders in the account, newest first.
   * @route GET /list-hyperframes-renders
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum items per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"render_id":"hfr_8c9d0e1f","status":"completed","title":"Data viz intro","format":"mp4","created_at":1752700000}],"has_more":false,"next_token":null}
   */
  async listHyperframesRenders(limit, token) {
    const logTag = '[listHyperframesRenders]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/hyperframes/renders`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Delete HyperFrames Render
   * @category HyperFrames
   * @description Soft-deletes a HyperFrames render. Subsequent reads of the render return not found.
   * @route DELETE /delete-hyperframes-render
   *
   * @paramDef {"type":"String","label":"Render ID","name":"renderId","required":true,"description":"Unique HyperFrames render identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"render_id":"hfr_8c9d0e1f"}
   */
  async deleteHyperframesRender(renderId) {
    const logTag = '[deleteHyperframesRender]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/hyperframes/renders/${ renderId }`,
      method: 'delete',
    })

    return response.data ?? response
  }
  // ===========================================================================
  // Assets
  // ===========================================================================

  /**
   * @operationName Upload Asset
   * @category Assets
   * @description Uploads a file from FlowRunner file storage (or any accessible URL) to HeyGen and returns an asset_id for use in other actions - as avatar photos, dub audio, source videos, backgrounds, SRT subtitles or HyperFrames projects. Supported types: PNG, JPEG, MP4, WebM, MP3, WAV, PDF and SRT, up to 32 MB. For larger files use Create Direct Upload.
   * @route POST /upload-asset
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are downloaded and streamed to HeyGen."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Filename to report to HeyGen. Derived from the URL when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"ast_2c3d4e5f","url":"https://resource2.heygen.ai/asset/ast_2c3d4e5f.png","mime_type":"image/png","size_bytes":204800}
   */
  async uploadAsset(fileUrl, filename) {
    const logTag = '[uploadAsset]'

    try {
      const buffer = await this.#downloadFile(fileUrl, logTag)
      const resolvedName = filename || decodeURIComponent(fileUrl.split('?')[0].split('/').pop() || '') || `upload_${ Date.now() }`

      const formData = new Flowrunner.Request.FormData()

      formData.append('file', buffer, { filename: resolvedName })

      const response = await Flowrunner.Request.post(`${ API_BASE_URL }/v3/assets`)
        .set({ 'x-api-key': this.apiKey })
        .form(formData)

      return response.data ?? response
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message

      logger.error(`${ logTag } - upload failed: ${ message }`)

      throw new Error(`HeyGen API error: ${ message }`)
    }
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Returns metadata for an asset in the workspace - name, type, owner, folder, upload timestamp and a publicly accessible URL.
   * @route GET /get-asset
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"Unique asset identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ast_2c3d4e5f","name":"logo.png","type":"image","owner":"usr_1a2b3c","space_id":"spc_4d5e6f","folder_id":null,"uploaded_at":1752700000,"url":"https://resource2.heygen.ai/asset/ast_2c3d4e5f.png"}
   */
  async getAsset(assetId) {
    const logTag = '[getAsset]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/assets/${ assetId }`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName Delete Asset
   * @category Assets
   * @description Permanently deletes an asset from the workspace. The asset must belong to the caller's workspace and not already be deleted.
   * @route DELETE /delete-asset
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"Unique asset identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ast_2c3d4e5f"}
   */
  async deleteAsset(assetId) {
    const logTag = '[deleteAsset]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/assets/${ assetId }`, method: 'delete' })

    return response.data ?? response
  }

  /**
   * @operationName Search Stock Assets
   * @category Assets
   * @description Semantically searches re-hosted public images and icons by natural-language description, e.g. 'pepperoni pizza on a wooden table' or 'minimalist rocket icon'. Returns assets ranked by similarity, each with a stable public URL usable in video backgrounds and templates. Set scope to Personal to search your own workspace assets instead of the public catalog.
   * @route GET /search-stock-assets
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Natural-language description of the image or icon you want."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Icon"]}},"defaultValue":"Image","description":"Asset type to search."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Personal"]}},"description":"Which assets to search: Public (the shared catalog, default) or Personal (your own workspace's assets)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results (1-50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"stk_5e6f7a8b","name":"Pepperoni pizza","type":"image","url":"https://resource2.heygen.ai/stock/stk_5e6f7a8b.jpg","score":0.93}],"has_more":true,"next_token":"eyJvZmZzZXQiOjEwfQ"}
   */
  async searchStockAssets(query, type, scope, limit, token) {
    const logTag = '[searchStockAssets]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/search`,
      method: 'get',
      query: {
        query,
        type: this.#resolveChoice(type, ASSET_SEARCH_TYPE_MAP),
        scope: this.#resolveChoice(scope, ASSET_SEARCH_SCOPE_MAP),
        limit,
        token,
      },
    })
  }

  /**
   * @operationName Get Bulk Asset Statuses
   * @category Assets
   * @description Returns statuses for up to 100 assets in one request, addressed by asset IDs and/or batch IDs (each batch expands to its member assets). Statuses are queued, processing, completed or failed, plus not_found for unknown IDs.
   * @route GET /get-bulk-asset-statuses
   *
   * @paramDef {"type":"Array<String>","label":"Asset IDs","name":"assetIds","description":"Asset IDs to look up (up to 100 total across both parameters)."}
   * @paramDef {"type":"Array<String>","label":"Batch IDs","name":"batchIds","description":"Asset batch IDs; each expands to its member assets."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"video_id":"ast_2c3d4e5f","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getBulkAssetStatuses(assetIds, batchIds) {
    const logTag = '[getBulkAssetStatuses]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/statuses`,
      method: 'get',
      query: {
        asset_ids: assetIds?.length ? assetIds.join(',') : undefined,
        batch_ids: batchIds?.length ? batchIds.join(',') : undefined,
      },
    })
  }

  /**
   * @operationName Create Direct Upload
   * @category Assets
   * @description Begins a direct-to-S3 asset upload for large files that exceed the 32 MB proxied Upload Asset limit. Returns an asset_id and a presigned upload_url with required headers - PUT the file bytes to that URL (e.g. with an HTTP action), then call Complete Direct Upload to finalize the asset. The declared size is signed into the URL and cannot be exceeded.
   * @route POST /create-direct-upload
   *
   * @paramDef {"type":"String","label":"Filename","name":"filename","required":true,"description":"Original filename for reference/metadata. The stored object's extension is derived from the content type."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":true,"description":"Declared MIME type, e.g. video/mp4, image/png, audio/mpeg, application/pdf or application/zip."}
   * @paramDef {"type":"Number","label":"Size (Bytes)","name":"sizeBytes","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exact byte size of the file. Signed into the upload URL so it cannot be exceeded."}
   * @paramDef {"type":"String","label":"SHA-256 Checksum","name":"checksumSha256","description":"Optional SHA-256 of the file as hex. When provided, S3 enforces it on upload."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"ast_6f7a8b9c","upload_url":"https://heygen-uploads.s3.amazonaws.com/ast_6f7a8b9c?X-Amz-Signature=...","upload_headers":{"Content-Type":"video/mp4"},"expires_in_seconds":3600,"max_bytes":524288000,"status":"pending_upload"}
   */
  async createDirectUpload(filename, contentType, sizeBytes, checksumSha256) {
    const logTag = '[createDirectUpload]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/direct-uploads`,
      method: 'post',
      body: clean({
        filename,
        content_type: contentType,
        size_bytes: sizeBytes,
        checksum_sha256: checksumSha256,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Complete Direct Upload
   * @category Assets
   * @description Finalizes a direct-to-S3 upload into a reusable HeyGen asset. Call after the presigned PUT succeeds. Idempotent: repeated calls return the same finalized asset. Optionally cross-check the file with a SHA-256 checksum.
   * @route POST /complete-direct-upload
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"Asset ID returned by Create Direct Upload."}
   * @paramDef {"type":"String","label":"SHA-256 Checksum","name":"checksumSha256","description":"Optional SHA-256 (hex) cross-check of the uploaded bytes."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"ast_6f7a8b9c","url":"https://resource2.heygen.ai/asset/ast_6f7a8b9c.mp4","mime_type":"video/mp4","size_bytes":104857600,"status":"processing"}
   */
  async completeDirectUpload(assetId, checksumSha256) {
    const logTag = '[completeDirectUpload]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/${ assetId }/complete`,
      method: 'post',
      body: clean({ checksum_sha256: checksumSha256 }) || {},
    })

    return response.data ?? response
  }

  /**
   * @operationName Create Direct Upload Batch
   * @category Assets
   * @description Requests up to 100 presigned direct-to-S3 upload URLs in a single call. Returns a batch_id and one upload slot per file (asset_id, presigned upload_url and required headers). PUT each file's bytes to its upload_url, then call Complete Direct Upload Batch to finalize all of them.
   * @route POST /create-direct-upload-batch
   *
   * @paramDef {"type":"Array<Object>","label":"Files","name":"files","required":true,"description":"Files to presign (max 100), each in the same shape as Create Direct Upload, e.g. {\"filename\":\"clip.mp4\",\"content_type\":\"video/mp4\",\"size_bytes\":10485760}."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Display name for the batch, shown in the HeyGen app."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_ast_7a8b9c","items":[{"asset_id":"ast_6f7a8b9c","upload_url":"https://heygen-uploads.s3.amazonaws.com/...","upload_headers":{"Content-Type":"video/mp4"}}]}
   */
  async createDirectUploadBatch(files, title) {
    const logTag = '[createDirectUploadBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/direct-uploads/batches`,
      method: 'post',
      body: clean({ files, title }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Complete Direct Upload Batch
   * @category Assets
   * @description Finalizes every uploaded file in a direct-upload batch after all presigned PUTs succeed. Each file is validated and ingested asynchronously and independently, so one bad file does not fail the rest. Poll per-item progress with Get Asset Batch.
   * @route POST /complete-direct-upload-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"Identifier returned by Create Direct Upload Batch."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_ast_7a8b9c","status":"processing"}
   */
  async completeDirectUploadBatch(batchId) {
    const logTag = '[completeDirectUploadBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/complete/batches`,
      method: 'post',
      body: { batch_id: batchId },
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Asset Batch
   * @category Assets
   * @description Returns aggregate status for an asset upload batch plus one page of its items with their asset IDs and statuses (queued, processing, completed or failed).
   * @route GET /get-asset-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"Unique asset batch identifier returned by Create Direct Upload Batch."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"btch_ast_7a8b9c","title":"Campaign assets","status":"completed","total_items":4,"counts_by_status":{"completed":4},"created_at":1752700000,"items":[{"video_id":"ast_6f7a8b9c","status":"completed"}],"has_more":false,"next_token":null}
   */
  async getAssetBatch(batchId, limit, token) {
    const logTag = '[getAssetBatch]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/assets/batches/${ batchId }`,
      method: 'get',
      query: { limit, token },
    })

    return response.data ?? response
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  /**
   * @operationName List Webhook Endpoints
   * @category Webhooks
   * @description Returns a paginated list of webhook endpoints registered in the account, with each endpoint's URL, subscribed event types and status.
   * @route GET /list-webhook-endpoints
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of endpoints to return (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"endpoint_id":"wh_3e4f5a6b","url":"https://example.com/heygen-hook","events":["avatar_video.success","avatar_video.fail"],"status":"enabled","created_at":"2026-07-01T12:00:00Z"}],"has_more":false,"next_token":null}
   */
  async listWebhookEndpoints(limit, token) {
    const logTag = '[listWebhookEndpoints]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/endpoints`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName Create Webhook Endpoint
   * @category Webhooks
   * @description Registers an HTTPS URL to receive HeyGen webhook event notifications (video completions, translation results, avatar training, etc.). Choose specific event types or omit them to receive all events. Returns the endpoint details and a signing secret - store the secret securely, as it is only shown at creation and rotation. Optionally scope the endpoint to a specific entity ID.
   * @route POST /create-webhook-endpoint
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Publicly accessible HTTPS URL that will receive webhook POST requests."}
   * @paramDef {"type":"Array<String>","label":"Events","name":"events","uiComponent":{"type":"DROPDOWN","options":{"values":["Avatar Video Success","Avatar Video Failed","Avatar Video GIF Success","Avatar Video GIF Failed","Video Translate Success","Video Translate Failed","Personalized Video","Instant Avatar Success","Instant Avatar Failed","Photo Avatar Generation Success","Photo Avatar Generation Failed","Photo Avatar Training Success","Photo Avatar Training Failed","Photo Avatar Add Motion Success","Photo Avatar Add Motion Failed","Proofread Creation Success","Proofread Creation Failed","Live Avatar Success","Live Avatar Failed","Avatar Video Caption Success","Avatar Video Caption Failed","Video Agent Success","Video Agent Failed","HyperFrames Video Success","HyperFrames Video Failed","AI Clipping Success","AI Clipping Failed","Batch Finished"]}},"description":"Event types to subscribe to. Omit to receive all events."}
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","description":"Optional entity ID to scope this endpoint to a specific resource."}
   *
   * @returns {Object}
   * @sampleResult {"endpoint_id":"wh_3e4f5a6b","url":"https://example.com/heygen-hook","events":["avatar_video.success"],"status":"enabled","created_at":"2026-07-16T09:00:00Z","secret":"whsec_9f8e7d6c5b4a"}
   */
  async createWebhookEndpoint(url, events, entityId) {
    const logTag = '[createWebhookEndpoint]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/endpoints`,
      method: 'post',
      body: clean({
        url,
        events: this.#resolveChoices(events, WEBHOOK_EVENT_MAP),
        entity_id: entityId,
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Update Webhook Endpoint
   * @category Webhooks
   * @description Updates the URL and/or the subscribed event types of a webhook endpoint. The events list is fully replaced - include every event type you want to keep.
   * @route PATCH /update-webhook-endpoint
   *
   * @paramDef {"type":"String","label":"Endpoint ID","name":"endpointId","required":true,"description":"Webhook endpoint identifier."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"New publicly accessible HTTPS URL for the endpoint."}
   * @paramDef {"type":"Array<String>","label":"Events","name":"events","uiComponent":{"type":"DROPDOWN","options":{"values":["Avatar Video Success","Avatar Video Failed","Avatar Video GIF Success","Avatar Video GIF Failed","Video Translate Success","Video Translate Failed","Personalized Video","Instant Avatar Success","Instant Avatar Failed","Photo Avatar Generation Success","Photo Avatar Generation Failed","Photo Avatar Training Success","Photo Avatar Training Failed","Photo Avatar Add Motion Success","Photo Avatar Add Motion Failed","Proofread Creation Success","Proofread Creation Failed","Live Avatar Success","Live Avatar Failed","Avatar Video Caption Success","Avatar Video Caption Failed","Video Agent Success","Video Agent Failed","HyperFrames Video Success","HyperFrames Video Failed","AI Clipping Success","AI Clipping Failed","Batch Finished"]}},"description":"New list of event types to subscribe to. Replaces the existing list."}
   *
   * @returns {Object}
   * @sampleResult {"endpoint_id":"wh_3e4f5a6b","url":"https://example.com/heygen-hook-v2","events":["avatar_video.success","video_translate.success"],"status":"enabled","created_at":"2026-07-01T12:00:00Z"}
   */
  async updateWebhookEndpoint(endpointId, url, events) {
    const logTag = '[updateWebhookEndpoint]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/endpoints/${ endpointId }`,
      method: 'patch',
      body: clean({
        url,
        events: this.#resolveChoices(events, WEBHOOK_EVENT_MAP),
      }),
    })

    return response.data ?? response
  }

  /**
   * @operationName Delete Webhook Endpoint
   * @category Webhooks
   * @description Permanently removes a webhook endpoint. Events are no longer delivered to its URL. This action cannot be undone.
   * @route DELETE /delete-webhook-endpoint
   *
   * @paramDef {"type":"String","label":"Endpoint ID","name":"endpointId","required":true,"description":"Webhook endpoint identifier to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true}
   */
  async deleteWebhookEndpoint(endpointId) {
    const logTag = '[deleteWebhookEndpoint]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/endpoints/${ endpointId }`,
      method: 'delete',
    })

    return { deleted: true, ...(response.data || {}) }
  }

  /**
   * @operationName Rotate Webhook Secret
   * @category Webhooks
   * @description Generates a new signing secret for a webhook endpoint and immediately invalidates the old one. Store the new secret securely - it will not be shown again.
   * @route POST /rotate-webhook-secret
   *
   * @paramDef {"type":"String","label":"Endpoint ID","name":"endpointId","required":true,"description":"Webhook endpoint identifier."}
   *
   * @returns {Object}
   * @sampleResult {"endpoint_id":"wh_3e4f5a6b","secret":"whsec_0a1b2c3d4e5f"}
   */
  async rotateWebhookSecret(endpointId) {
    const logTag = '[rotateWebhookSecret]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/endpoints/${ endpointId }/rotate-secret`,
      method: 'post',
      body: {},
    })

    return response.data ?? response
  }

  /**
   * @operationName List Webhook Event Types
   * @category Webhooks
   * @description Returns all available webhook event types with human-readable descriptions - useful for discovering which events an endpoint can subscribe to.
   * @route GET /list-webhook-event-types
   *
   * @returns {Object}
   * @sampleResult {"data":[{"event_type":"avatar_video.success","description":"Fires when an avatar video finishes rendering successfully."}],"has_more":false,"next_token":null}
   */
  async listWebhookEventTypes() {
    const logTag = '[listWebhookEventTypes]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/webhooks/event-types`, method: 'get' })
  }

  /**
   * @operationName List Webhook Events
   * @category Webhooks
   * @description Returns a paginated history of webhook events delivered for the account, filterable by event type or entity ID. Useful for auditing deliveries and recovering missed notifications.
   * @route GET /list-webhook-events
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","uiComponent":{"type":"DROPDOWN","options":{"values":["Avatar Video Success","Avatar Video Failed","Avatar Video GIF Success","Avatar Video GIF Failed","Video Translate Success","Video Translate Failed","Personalized Video","Instant Avatar Success","Instant Avatar Failed","Photo Avatar Generation Success","Photo Avatar Generation Failed","Photo Avatar Training Success","Photo Avatar Training Failed","Photo Avatar Add Motion Success","Photo Avatar Add Motion Failed","Proofread Creation Success","Proofread Creation Failed","Live Avatar Success","Live Avatar Failed","Avatar Video Caption Success","Avatar Video Caption Failed","Video Agent Success","Video Agent Failed","HyperFrames Video Success","HyperFrames Video Failed","AI Clipping Success","AI Clipping Failed","Batch Finished"]}},"description":"Filter events by type."}
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","description":"Filter events by entity ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"event_id":"evt_8b9c0d1e","event_type":"avatar_video.success","entity_id":"7f2c1f0fde5a4b8a9c1e","delivered_at":"2026-07-16T09:12:00Z"}],"has_more":false,"next_token":null}
   */
  async listWebhookEvents(eventType, entityId, limit, token) {
    const logTag = '[listWebhookEvents]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/webhooks/events`,
      method: 'get',
      query: {
        event_type: this.#resolveChoice(eventType, WEBHOOK_EVENT_MAP),
        entity_id: entityId,
        limit,
        token,
      },
    })
  }

  // ===========================================================================
  // Account & Brand
  // ===========================================================================

  /**
   * @operationName Get Current User
   * @category Account & Brand
   * @description Returns the authenticated user's profile plus remaining credits/balance and billing details. The billing_type field indicates which billing object is populated: wallet (prepaid balance), subscription (credit pools) or usage_based (metered spending). Use this to check the remaining API quota before submitting large jobs.
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"username":"mark","email":"mark@example.com","first_name":"Mark","last_name":"P","billing_type":"subscription","wallet":null,"subscription":{"plan":"pro","remaining_credits":412.5},"usage_based":null}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    const response = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v3/users/me`, method: 'get' })

    return response.data ?? response
  }

  /**
   * @operationName List Brand Kits
   * @category Account & Brand
   * @description Returns the brand kits available in the workspace. Each kit contains colors, fonts and logos; pass its brand_kit_id to Create Video Agent Session to generate on-brand videos.
   * @route GET /list-brand-kits
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"brand_kit_id":"bk_1a2b3c","name":"Acme Corp","colors":["#0A84FF","#FFFFFF"],"logo_url":"https://resource2.heygen.ai/brand/bk_1a2b3c.png"}],"has_more":false,"next_token":null}
   */
  async listBrandKits(limit, token) {
    const logTag = '[listBrandKits]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/brand-kits`,
      method: 'get',
      query: { limit, token },
    })
  }

  /**
   * @operationName List Brand Glossaries
   * @category Account & Brand
   * @description Lists brand glossaries (custom term mappings, also known as brand voices) in the workspace. A brand glossary enforces custom term translations during video translation - for example, translating 'Reformer' as Pilates equipment rather than as a political activist. Pass a glossary's ID as Brand Glossary ID in the translation actions.
   * @route GET /list-brand-glossaries
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of glossaries to return (1-100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"token","description":"Opaque pagination cursor from a previous response's next_token."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"bg_4d5e6f","name":"Product terms","terms_count":18,"created_at":1750000000}],"has_more":false,"next_token":null}
   */
  async listBrandGlossaries(limit, token) {
    const logTag = '[listBrandGlossaries]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/brand-glossaries`,
      method: 'get',
      query: { limit, token },
    })
  }

  // ===========================================================================
  // Workflows
  // ===========================================================================

  /**
   * @operationName List Workflows
   * @category Workflows
   * @description Lists all available HeyGen workflow types (e.g. GenerateImageNode, GenerateVideoNode) with their input and output schemas. Use a workflow's type and input schema with Execute Workflow.
   * @route GET /list-workflows
   *
   * @returns {Object}
   * @sampleResult {"data":[{"workflow_type":"GenerateImageNode","description":"Generate an image from a prompt","input_schema":{"type":"object","properties":{"prompt":{"type":"string"}}}}],"has_more":false,"next_token":null}
   */
  async listWorkflows() {
    const logTag = '[listWorkflows]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/v1/workflows`, method: 'get' })
  }

  /**
   * @operationName Execute Workflow
   * @category Workflows
   * @description Submits a single HeyGen workflow (e.g. GenerateImageNode, GenerateVideoNode) for asynchronous execution with a workflow-specific input object matching the schema from List Workflows. Returns an execution_id to poll with Get Workflow Execution.
   * @route POST /execute-workflow
   *
   * @paramDef {"type":"String","label":"Workflow Type","name":"workflowType","required":true,"description":"The workflow type to execute, e.g. GenerateImageNode or GenerateVideoNode. Discover types with List Workflows."}
   * @paramDef {"type":"Object","label":"Input","name":"input","required":true,"description":"Workflow-specific input matching the workflow's input schema, e.g. {\"prompt\":\"a sunset over mountains\"}."}
   *
   * @returns {Object}
   * @sampleResult {"execution_id":"exe_9c0d1e2f","status":"pending"}
   */
  async executeWorkflow(workflowType, input) {
    const logTag = '[executeWorkflow]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows/executions`,
      method: 'post',
      body: { workflow_type: workflowType, input },
    })

    return response.data ?? response
  }

  /**
   * @operationName Execute Workflow Graph
   * @category Workflows
   * @description Submits multiple HeyGen workflows for asynchronous execution as a DAG (directed acyclic graph), allowing outputs of one workflow to feed into another. Returns a single execution_id; poll with Get Workflow Execution, which returns all outputs keyed by workflow ID.
   * @route POST /execute-workflow-graph
   *
   * @paramDef {"type":"Array<Object>","label":"Workflows","name":"workflows","required":true,"description":"Workflows to execute as a DAG, each with a workflow_type, input and optional dependencies, per the schemas from List Workflows."}
   *
   * @returns {Object}
   * @sampleResult {"execution_id":"exe_3f4a5b6c","status":"pending"}
   */
  async executeWorkflowGraph(workflows) {
    const logTag = '[executeWorkflowGraph]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows/graph-executions`,
      method: 'post',
      body: { workflows },
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Workflow Execution
   * @category Workflows
   * @description Polls the status and output of a workflow execution. Single-workflow executions return their result in the output field; graph executions return all results in the outputs field keyed by workflow ID. Includes error details on failure.
   * @route GET /get-workflow-execution
   *
   * @paramDef {"type":"String","label":"Execution ID","name":"executionId","required":true,"description":"Execution ID returned by Execute Workflow or Execute Workflow Graph."}
   *
   * @returns {Object}
   * @sampleResult {"execution_id":"exe_9c0d1e2f","status":"completed","output":{"image_url":"https://resource2.heygen.ai/workflows/exe_9c0d1e2f.png"},"outputs":null,"error":null}
   */
  async getWorkflowExecution(executionId) {
    const logTag = '[getWorkflowExecution]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows/executions/${ executionId }`,
      method: 'get',
    })

    return response.data ?? response
  }
  // ===========================================================================
  // Dictionaries
  // ===========================================================================

  /**
   * @typedef {Object} avatarLooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter matched against look names on the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Avatar Looks Dictionary
   * @description Lists avatar looks for selection in Avatar ID parameters. The option value is the look ID expected by the video creation actions; the note shows the look's type and gender.
   * @route POST /avatar-looks-dictionary
   * @paramDef {"type":"avatarLooksDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Abigail (Expressive)","value":"Abigail_expressive_2024112501","note":"studio_avatar - female"}],"cursor":"eyJvZmZzZXQiOjUwfQ"}
   */
  async avatarLooksDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[avatarLooksDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars/looks`,
      method: 'get',
      query: { limit: 50, token: cursor },
    })

    const looks = response.data || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? looks.filter(look => (look.name || '').toLowerCase().includes(searchLower))
      : looks

    return {
      items: filtered.map(look => ({
        label: look.name || look.id,
        value: look.id,
        note: [look.avatar_type, look.gender].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: response.has_more ? response.next_token : null,
    }
  }

  /**
   * @typedef {Object} avatarGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter matched against group names on the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Avatar Groups Dictionary
   * @description Lists avatar groups (identities) for selection in Avatar Group ID parameters. The option value is the group ID; the note shows the gender and looks count.
   * @route POST /avatar-groups-dictionary
   * @paramDef {"type":"avatarGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex","value":"ag_9z8y7x","note":"male - 3 looks"}],"cursor":null}
   */
  async avatarGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[avatarGroupsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/avatars`,
      method: 'get',
      query: { limit: 50, token: cursor },
    })

    const groups = response.data || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? groups.filter(group => (group.name || '').toLowerCase().includes(searchLower))
      : groups

    return {
      items: filtered.map(group => ({
        label: group.name || group.id,
        value: group.id,
        note: [group.gender, group.looks_count !== undefined ? `${ group.looks_count } looks` : null]
          .filter(Boolean).join(' - ') || undefined,
      })),
      cursor: response.has_more ? response.next_token : null,
    }
  }

  /**
   * @typedef {Object} voicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter matched against voice names and languages on the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Voices Dictionary
   * @description Lists voices for selection in Voice ID parameters. The option value is the voice ID; the note shows the language and gender.
   * @route POST /voices-dictionary
   * @paramDef {"type":"voicesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Daisy","value":"3b1633a466c44379bf8b5a2884727588","note":"English - female"}],"cursor":"eyJvZmZzZXQiOjEwMH0"}
   */
  async voicesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[voicesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/voices`,
      method: 'get',
      query: { limit: 100, token: cursor },
    })

    const voices = response.data || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? voices.filter(voice =>
        (voice.name || '').toLowerCase().includes(searchLower) ||
        (voice.language || '').toLowerCase().includes(searchLower))
      : voices

    return {
      items: filtered.map(voice => ({
        label: voice.name || voice.voice_id,
        value: voice.voice_id,
        note: [voice.language, voice.gender].filter(Boolean).join(' - ') || undefined,
      })),
      cursor: response.has_more ? response.next_token : null,
    }
  }

  /**
   * @typedef {Object} templatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter matched against template names on the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Templates Dictionary
   * @description Lists API-ready templates for selection in Template ID parameters. The option value is the template ID; the note shows the aspect ratio.
   * @route POST /templates-dictionary
   * @paramDef {"type":"templatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Weekly Update","value":"tpl_3c4d5e6f","note":"16:9"}],"cursor":null}
   */
  async templatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[templatesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/templates`,
      method: 'get',
      query: { limit: 50, token: cursor },
    })

    const templates = response.data || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? templates.filter(template => (template.name || '').toLowerCase().includes(searchLower))
      : templates

    return {
      items: filtered.map(template => ({
        label: template.name || template.id,
        value: template.id,
        note: template.aspect_ratio || undefined,
      })),
      cursor: response.has_more ? response.next_token : null,
    }
  }

  /**
   * @typedef {Object} targetLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter matched against language names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused - the languages endpoint returns all values in one call. Kept for dictionary API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Target Languages Dictionary
   * @description Lists supported video translation target languages for selection in Output Language parameters. The option value is the exact language name expected by the translation actions.
   * @route POST /target-languages-dictionary
   * @paramDef {"type":"targetLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Search input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Spanish (Spain)","value":"Spanish (Spain)"}],"cursor":null}
   */
  async targetLanguagesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[targetLanguagesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/video-translations/languages`,
      method: 'get',
    })

    const languages = (response.data ?? response).languages || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? languages.filter(language => language.toLowerCase().includes(searchLower))
      : languages

    return {
      items: filtered.map(language => ({ label: language, value: language })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(HeyGenService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your HeyGen API key (sent as the x-api-key header). Get it from https://app.heygen.com/settings/api',
  },
])
