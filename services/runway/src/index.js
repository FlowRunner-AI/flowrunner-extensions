const logger = {
  info: (...args) => console.log('[Runway] info:', ...args),
  debug: (...args) => console.log('[Runway] debug:', ...args),
  error: (...args) => console.log('[Runway] error:', ...args),
  warn: (...args) => console.log('[Runway] warn:', ...args),
}

const API_BASE_URL = 'https://api.dev.runwayml.com'
const RUNWAY_VERSION = '2024-11-06'

const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 570000
const DEFAULT_LIST_LIMIT = 50

const TERMINAL_TASK_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED']

// ---------------------------------------------------------------------------
// Model label -> API value maps (dropdowns display the friendly label; code
// resolves it to the API model id).
// ---------------------------------------------------------------------------

const IMAGE_MODELS = {
  'Gen-4 Image': 'gen4_image',
  'Gen-4 Image Turbo': 'gen4_image_turbo',
  'GPT Image 2': 'gpt_image_2',
  'Gemini Image 3 Pro': 'gemini_image3_pro',
  'Gemini Image 3.1 Flash': 'gemini_image3.1_flash',
  'Gemini 2.5 Flash Image': 'gemini_2.5_flash',
  'Seedream 5 Pro': 'seedream5_pro',
  'Seedream 5 Lite': 'seedream5_lite',
}

const IMAGE_TO_VIDEO_MODELS = {
  'Gen-4.5': 'gen4.5',
  'Gen-4 Turbo': 'gen4_turbo',
  'Veo 3.1': 'veo3.1',
  'Veo 3.1 Fast': 'veo3.1_fast',
  'Veo 3': 'veo3',
  'Seedance 2': 'seedance2',
  'Seedance 2 Fast': 'seedance2_fast',
  'Seedance 2 Mini': 'seedance2_mini',
  'Gemini Omni Flash': 'gemini_omni_flash',
  'HappyHorse 1.0': 'happyhorse_1_0',
}

const TEXT_TO_VIDEO_MODELS = {
  'Gen-4.5': 'gen4.5',
  'Veo 3.1': 'veo3.1',
  'Veo 3.1 Fast': 'veo3.1_fast',
  'Veo 3': 'veo3',
  'Seedance 2': 'seedance2',
  'Seedance 2 Fast': 'seedance2_fast',
  'Seedance 2 Mini': 'seedance2_mini',
  'Gemini Omni Flash': 'gemini_omni_flash',
  'HappyHorse 1.0': 'happyhorse_1_0',
}

const VIDEO_TO_VIDEO_MODELS = {
  'Aleph 2': 'aleph2',
  'Seedance 2': 'seedance2',
  'Seedance 2 Fast': 'seedance2_fast',
  'Seedance 2 Mini': 'seedance2_mini',
  'Gemini Omni Flash': 'gemini_omni_flash',
}

const SOUND_EFFECT_MODELS = {
  'Seed Audio': 'seed_audio',
  'Eleven Text to Sound v2': 'eleven_text_to_sound_v2',
}

const TEXT_TO_SPEECH_MODELS = {
  'Eleven Multilingual v2': 'eleven_multilingual_v2',
  'Seed Audio': 'seed_audio',
}

const VOICE_CREATION_MODELS = {
  'Eleven Text-to-Voice v3': 'eleven_ttv_v3',
  'Eleven Multilingual Text-to-Voice v2': 'eleven_multilingual_ttv_v2',
}

const SAMPLE_RATES = {
  '8 kHz': 8000,
  '16 kHz': 16000,
  '24 kHz': 24000,
  '32 kHz': 32000,
  '44.1 kHz': 44100,
  '48 kHz': 48000,
}

const AUDIO_OUTPUT_FORMATS = {
  'WAV': 'wav',
  'MP3': 'mp3',
  'OGG Opus': 'ogg_opus',
}

const DUBBING_LANGUAGES = {
  'English': 'en',
  'Hindi': 'hi',
  'Portuguese': 'pt',
  'Chinese': 'zh',
  'Spanish': 'es',
  'French': 'fr',
  'German': 'de',
  'Japanese': 'ja',
  'Arabic': 'ar',
  'Russian': 'ru',
  'Korean': 'ko',
  'Indonesian': 'id',
  'Italian': 'it',
  'Dutch': 'nl',
  'Turkish': 'tr',
  'Polish': 'pl',
  'Swedish': 'sv',
  'Filipino': 'fil',
  'Malay': 'ms',
  'Romanian': 'ro',
  'Ukrainian': 'uk',
  'Greek': 'el',
  'Czech': 'cs',
  'Danish': 'da',
  'Finnish': 'fi',
  'Bulgarian': 'bg',
  'Croatian': 'hr',
  'Slovak': 'sk',
  'Tamil': 'ta',
}

const AD_LOCALIZATION_LANGUAGES = {
  'Arabic': 'ar',
  'Chinese (Simplified)': 'zh',
  'Chinese (Traditional)': 'zh-Hant',
  'Dutch': 'nl',
  'English': 'en',
  'French': 'fr',
  'German': 'de',
  'Hindi': 'hi',
  'Indonesian': 'id',
  'Italian': 'it',
  'Japanese': 'ja',
  'Korean': 'ko',
  'Polish': 'pl',
  'Portuguese': 'pt',
  'Russian': 'ru',
  'Spanish': 'es',
  'Swedish': 'sv',
  'Thai': 'th',
  'Turkish': 'tr',
  'Ukrainian': 'uk',
  'Vietnamese': 'vi',
  'Greek': 'el',
}

// Voice presets used by Text to Speech and Speech to Speech (label equals API value).
const TTS_PRESET_VOICES = [
  'Maya', 'Arjun', 'Serene', 'Bernard', 'Billy', 'Mark', 'Clint', 'Mabel', 'Chad', 'Leslie',
  'Eleanor', 'Elias', 'Elliot', 'Grungle', 'Brodie', 'Sandra', 'Kirk', 'Kylie', 'Lara', 'Lisa',
  'Malachi', 'Marlene', 'Martin', 'Miriam', 'Monster', 'Paula', 'Pip', 'Rusty', 'Ragnar', 'Xylar',
  'Maggie', 'Jack', 'Katie', 'Noah', 'James', 'Rina', 'Ella', 'Mariah', 'Frank', 'Claudia',
  'Niki', 'Vincent', 'Kendrick', 'Myrna', 'Tom', 'Wanda', 'Benjamin', 'Kiana', 'Rachel',
]

// Live voice presets for avatars and avatar videos (friendly label -> API value).
const LIVE_PRESET_VOICES = {
  'Victoria': 'victoria', 'Vincent': 'vincent', 'Clara': 'clara', 'Drew': 'drew', 'Skye': 'skye',
  'Max': 'max', 'Morgan': 'morgan', 'Felix': 'felix', 'Mia': 'mia', 'Marcus': 'marcus',
  'Summer': 'summer', 'Ruby': 'ruby', 'Aurora': 'aurora', 'Jasper': 'jasper', 'Leo': 'leo',
  'Adrian': 'adrian', 'Nina': 'nina', 'Emma': 'emma', 'Blake': 'blake', 'David': 'david',
  'Maya': 'maya', 'Nathan': 'nathan', 'Sam': 'sam', 'Georgia': 'georgia', 'Petra': 'petra',
  'Adam': 'adam', 'Zach': 'zach', 'Violet': 'violet', 'Roman': 'roman', 'Luna': 'luna',
}

const AVATAR_PRESETS = {
  'Game Character': 'game-character',
  'Game Character (Man)': 'game-character-man',
  'Music Superstar': 'music-superstar',
  'Cat Character': 'cat-character',
  'Influencer': 'influencer',
  'Tennis Coach': 'tennis-coach',
  'Human Resources': 'human-resource',
  'Fashion Designer': 'fashion-designer',
  'Cooking Teacher': 'cooking-teacher',
}

// ---------------------------------------------------------------------------
// Supported ratios per operation and model (extracted from the Runway OpenAPI
// spec, version 2024-11-06). Used by the ratio dictionaries.
// ---------------------------------------------------------------------------

const RATIOS = {
  textToImage: {
    'gen4_image': ['1024:1024', '1080:1080', '1168:880', '1360:768', '1440:1080', '1080:1440', '1808:768', '1920:1080', '1080:1920', '2112:912', '1280:720', '720:1280', '720:720', '960:720', '720:960', '1680:720'],
    'gen4_image_turbo': ['1024:1024', '1080:1080', '1168:880', '1360:768', '1440:1080', '1080:1440', '1808:768', '1920:1080', '1080:1920', '2112:912', '1280:720', '720:1280', '720:720', '960:720', '720:960', '1680:720'],
    'gpt_image_2': ['2048:880', '1920:1088', '1920:1280', '1920:1440', '1920:1536', '1920:1920', '1536:1920', '1440:1920', '1280:1920', '1088:1920', '2912:1248', '2560:1440', '2560:1712', '2560:1920', '2560:2048', '2560:2560', '2048:2560', '1920:2560', '1712:2560', '1440:2560', '3840:1648', '3840:2160', '3504:2336', '3264:2448', '3200:2560', '2880:2880', '2560:3200', '2448:3264', '2336:3504', '2160:3840', 'auto'],
    'gemini_image3_pro': ['1344:768', '768:1344', '1024:1024', '1184:864', '864:1184', '1536:672', '832:1248', '1248:832', '896:1152', '1152:896', '2048:2048', '1696:2528', '2528:1696', '1792:2400', '2400:1792', '1856:2304', '2304:1856', '1536:2752', '2752:1536', '3168:1344', '4096:4096', '3392:5056', '5056:3392', '3584:4800', '4800:3584', '3712:4608', '4608:3712', '3072:5504', '5504:3072', '6336:2688'],
    'gemini_image3.1_flash': ['512:512', '416:624', '624:416', '432:592', '592:432', '448:576', '576:448', '384:672', '672:384', '768:336', '256:1024', '1024:256', '176:1408', '1408:176', '1024:1024', '832:1248', '1248:832', '864:1184', '1184:864', '896:1152', '1152:896', '768:1344', '1344:768', '1536:672', '512:2048', '2048:512', '352:2816', '2816:352', '2048:2048', '1696:2528', '2528:1696', '1792:2400', '2400:1792', '1856:2304', '2304:1856', '1536:2752', '2752:1536', '3168:1344', '1024:4096', '4096:1024', '704:5632', '5632:704', '4096:4096', '3392:5056', '5056:3392', '3584:4800', '4800:3584', '3712:4608', '4608:3712', '3072:5504', '5504:3072', '6336:2688', '2048:8192', '8192:2048', '1408:11264', '11264:1408'],
    'seedream5_pro': ['1024:1024', '1184:896', '896:1184', '1376:768', '768:1376', '1296:864', '864:1296', '2048:2048', '2304:1728', '1728:2304', '2720:1530', '1530:2720', '2496:1664', '1664:2496', 'auto_1k', 'auto_2k'],
    'seedream5_lite': ['2048:2048', '2304:1728', '1728:2304', '2848:1600', '1600:2848', '2496:1664', '1664:2496', '3136:1344', '3072:3072', '3456:2592', '2592:3456', '4096:2304', '2304:4096', '3744:2496', '2496:3744', '4704:2016'],
    'gemini_2.5_flash': ['1344:768', '768:1344', '1024:1024', '1184:864', '864:1184', '1536:672', '832:1248', '1248:832', '896:1152', '1152:896'],
  },
  imageToVideo: {
    'gen4.5': ['1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672'],
    'gen4_turbo': ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    'veo3.1': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'veo3.1_fast': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'veo3': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'seedance2': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280', '2206:946', '1920:1080', '1664:1248', '1440:1440', '1248:1664', '1080:1920', '3840:1646', '3840:2160', '3840:2880', '3840:3840', '2880:3840', '2160:3840'],
    'seedance2_fast': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
    'seedance2_mini': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
    'gemini_omni_flash': ['1280:720', '720:1280'],
  },
  textToVideo: {
    'gen4.5': ['1280:720', '720:1280'],
    'veo3.1': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'veo3.1_fast': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'veo3': ['1280:720', '720:1280', '1080:1920', '1920:1080'],
    'happyhorse_1_0': ['1280:720', '720:1280', '960:960', '1108:832', '832:1108', '1920:1080', '1080:1920', '1440:1440', '1662:1248', '1248:1662'],
    'seedance2': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280', '2206:946', '1920:1080', '1664:1248', '1440:1440', '1248:1664', '1080:1920', '3840:1646', '3840:2160', '3840:2880', '3840:3840', '2880:3840', '2160:3840'],
    'seedance2_fast': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
    'seedance2_mini': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
    'gemini_omni_flash': ['1280:720', '720:1280'],
  },
  videoToVideo: {
    'seedance2': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280', '2206:946', '1920:1080', '1664:1248', '1440:1440', '1248:1664', '1080:1920', '3840:1646', '3840:2160', '3840:2880', '3840:3840', '2880:3840', '2160:3840'],
    'seedance2_fast': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
    'seedance2_mini': ['992:432', '864:496', '752:560', '640:640', '560:752', '496:864', '1470:630', '1280:720', '1112:834', '960:960', '834:1112', '720:1280'],
  },
}

// ---------------------------------------------------------------------------
// Per-model request field whitelists. Runway generation endpoints are strict
// oneOf unions, so only fields valid for the selected model are sent.
// ---------------------------------------------------------------------------

const IMAGE_MODEL_FIELDS = {
  'gen4_image': ['model', 'promptText', 'ratio', 'seed', 'referenceImages', 'contentModeration'],
  'gen4_image_turbo': ['model', 'promptText', 'ratio', 'seed', 'referenceImages', 'contentModeration'],
  'gpt_image_2': ['model', 'promptText', 'ratio', 'quality', 'background', 'referenceImages', 'outputCount'],
  'gemini_image3_pro': ['model', 'promptText', 'ratio', 'referenceImages', 'outputCount'],
  'gemini_image3.1_flash': ['model', 'promptText', 'ratio', 'referenceImages', 'outputCount'],
  'gemini_2.5_flash': ['model', 'promptText', 'ratio', 'referenceImages'],
  'seedream5_pro': ['model', 'promptText', 'ratio', 'outputFormat', 'referenceImages', 'outputCount'],
  'seedream5_lite': ['model', 'promptText', 'ratio', 'outputFormat', 'referenceImages', 'outputCount'],
}

const IMAGE_TO_VIDEO_MODEL_FIELDS = {
  'gen4.5': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'seed', 'contentModeration'],
  'gen4_turbo': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'seed', 'contentModeration'],
  'veo3.1': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'audio', 'negativePrompt'],
  'veo3.1_fast': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'audio', 'negativePrompt'],
  'veo3': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'negativePrompt'],
  'seedance2': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'audio', 'referenceAudio'],
  'seedance2_fast': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'audio', 'referenceAudio'],
  'seedance2_mini': ['model', 'promptImage', 'promptText', 'ratio', 'duration', 'audio', 'referenceAudio'],
  'gemini_omni_flash': ['model', 'promptImage', 'promptText', 'ratio', 'duration'],
  'happyhorse_1_0': ['model', 'promptImage', 'promptText', 'resolution', 'duration'],
}

const TEXT_TO_VIDEO_MODEL_FIELDS = {
  'gen4.5': ['model', 'promptText', 'ratio', 'duration', 'seed', 'contentModeration'],
  'veo3.1': ['model', 'promptText', 'ratio', 'duration', 'audio', 'negativePrompt'],
  'veo3.1_fast': ['model', 'promptText', 'ratio', 'duration', 'audio', 'negativePrompt'],
  'veo3': ['model', 'promptText', 'ratio', 'duration', 'negativePrompt'],
  'seedance2': ['model', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'seedance2_fast': ['model', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'seedance2_mini': ['model', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'gemini_omni_flash': ['model', 'promptText', 'ratio', 'duration'],
  'happyhorse_1_0': ['model', 'promptText', 'ratio', 'duration'],
}

const VIDEO_TO_VIDEO_MODEL_FIELDS = {
  'aleph2': ['model', 'videoUri', 'promptText', 'keyframes', 'targetAspectRatio', 'seed', 'contentModeration'],
  'seedance2': ['model', 'promptVideo', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'seedance2_fast': ['model', 'promptVideo', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'seedance2_mini': ['model', 'promptVideo', 'promptText', 'ratio', 'duration', 'audio', 'references', 'referenceVideos', 'referenceAudio'],
  'gemini_omni_flash': ['model', 'videoUri', 'promptText', 'references'],
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @usesFileStorage
 * @integrationName Runway
 * @integrationIcon /icon.png
 */
class RunwayService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'X-Runway-Version': RUNWAY_VERSION,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Runway API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds a request body containing only the fields the selected model accepts.
  #buildModelBody(candidate, allowedFields) {
    const body = {}

    for (const field of allowedFields) {
      const value = candidate[field]

      if (value !== undefined && value !== null && value !== '') {
        body[field] = value
      }
    }

    return body
  }

  #contentModeration(publicFigureThreshold) {
    const threshold = this.#resolveChoice(publicFigureThreshold, { 'Auto': 'auto', 'Low': 'low' })

    return threshold ? { publicFigureThreshold: threshold } : undefined
  }

  #toUriObjects(uris, type) {
    if (!Array.isArray(uris) || uris.length === 0) {
      return undefined
    }

    return uris.map(uri => clean({ uri, type }))
  }

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  }

  async #pollTask(taskId, logTag) {
    const startedAt = Date.now()

    while (true) {
      const task = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/v1/tasks/${ taskId }`,
        method: 'get',
      })

      if (TERMINAL_TASK_STATUSES.includes(task.status)) {
        return task
      }

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(
          `Runway task ${ taskId } did not finish within the polling window (status: ${ task.status }). ` +
          'Use Get Task or Wait for Task to keep checking it.'
        )
      }

      logger.debug(`${ logTag } - task ${ taskId } status ${ task.status }, waiting...`)

      await sleep(POLL_INTERVAL_MS)
    }
  }

  async #saveTaskOutputs(task, fileOptions, logTag) {
    const outputs = Array.isArray(task.output) ? task.output : []
    const savedFiles = []

    for (let i = 0; i < outputs.length; i++) {
      const outputUrl = outputs[i]
      const bytes = await Flowrunner.Request.get(outputUrl).setEncoding(null)
      const buffer = this.#toBuffer(bytes)
      const pathname = String(outputUrl).split('?')[0]
      const extension = pathname.includes('.') ? pathname.split('.').pop().slice(0, 8) : 'bin'

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `runway_${ task.id }_${ i }.${ extension }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      logger.debug(`${ logTag } - saved output ${ i } (${ buffer.length } bytes) to file storage`)

      savedFiles.push(url)
    }

    return savedFiles
  }

  // Starts a generation task and, unless waitForCompletion is disabled, polls it
  // to completion and optionally persists its ephemeral outputs to file storage.
  async #startGeneration({ url, body, logTag, waitForCompletion, saveOutputToFiles, fileOptions }) {
    const started = await this.#apiRequest({ url, method: 'post', body, logTag })

    if (waitForCompletion === false) {
      return { id: started.id, status: 'PENDING' }
    }

    const task = await this.#pollTask(started.id, logTag)

    if (task.status === 'FAILED') {
      throw new Error(`Runway task ${ task.id } failed: ${ task.failure || 'unknown error' }` +
        (task.failureCode ? ` (code: ${ task.failureCode })` : ''))
    }

    if (task.status === 'CANCELLED') {
      throw new Error(`Runway task ${ task.id } was cancelled before it completed.`)
    }

    if (saveOutputToFiles) {
      task.savedFiles = await this.#saveTaskOutputs(task, fileOptions, logTag)
    }

    return task
  }

  // =========================================================================
  // Image Generation
  // =========================================================================

  /**
   * @operationName Generate Image
   * @category Image Generation
   * @description Generates one or more images from a text prompt using Runway's text_to_image API. Supports Gen-4 Image, Gen-4 Image Turbo, GPT Image 2, Gemini Image 3 Pro, Gemini Image 3.1 Flash, Gemini 2.5 Flash Image, Seedream 5 Pro, and Seedream 5 Lite. Reference images can guide subject and style; Gen-4 Image Turbo requires at least one reference image. By default the action waits for the task to finish and returns the completed task with output image URLs. Output URLs are ephemeral and expire within 24-48 hours; enable Save Output to File Storage for durable URLs.
   * @route POST /generate-image
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Gen-4 Image","uiComponent":{"type":"DROPDOWN","options":{"values":["Gen-4 Image","Gen-4 Image Turbo","GPT Image 2","Gemini Image 3 Pro","Gemini Image 3.1 Flash","Gemini 2.5 Flash Image","Seedream 5 Pro","Seedream 5 Lite"]}},"description":"The image model to use. Gen-4 Image Turbo requires at least one reference image."}
   * @paramDef {"type":"String","label":"Prompt","name":"promptText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the image to generate, up to 1000 characters. Reference tagged images with @tag syntax when reference images have tags (Gen-4 models)."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","required":true,"dictionary":"getImageRatiosDictionary","dependsOn":["model"],"description":"Output resolution as width:height pixels (e.g. 1920:1080). Supported values depend on the selected model; pick one from the dropdown."}
   * @paramDef {"type":"Array<ReferenceImage>","label":"Reference Images","name":"referenceImages","description":"Up to 3 images to guide generation. Each has a uri (HTTPS URL, data URI, or runway:// URI) and an optional tag (3-16 letters/numbers, starting with a letter) referenced in the prompt as @tag. Required for Gen-4 Image Turbo."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed seed (0-4294967295) for reproducible results. Gen-4 models only. Random when omitted."}
   * @paramDef {"type":"Number","label":"Output Count","name":"outputCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate in one task. GPT Image 2: 1-10; Seedream 5: 1-4; Gemini Image 3 models: 1 or 4. Not supported by Gen-4 or Gemini 2.5 Flash (always 1)."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Auto"]}},"description":"Rendering quality. GPT Image 2 only."}
   * @paramDef {"type":"String","label":"Background","name":"background","uiComponent":{"type":"DROPDOWN","options":{"values":["Opaque","Auto"]}},"description":"Background handling. GPT Image 2 only."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","JPEG"]}},"description":"Image file format. Seedream 5 models only."}
   * @paramDef {"type":"String","label":"Public Figure Threshold","name":"publicFigureThreshold","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low"]}},"description":"Content moderation sensitivity for recognizable public figures. Low is less strict. Gen-4 models only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately and poll later with Get Task or Wait for Task."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy generated outputs into FlowRunner file storage and return durable URLs in savedFiles. Runway output URLs expire within 24-48 hours. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"17f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/image.png?_jwt=abc"],"savedFiles":["https://files.example.com/flow/runway_17f20503_0.png"]}
   */
  async generateImage(
    model, promptText, ratio, referenceImages, seed, outputCount, quality, background,
    outputFormat, publicFigureThreshold, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[generateImage]'
    const resolvedModel = this.#resolveChoice(model, IMAGE_MODELS)

    if (!IMAGE_MODEL_FIELDS[resolvedModel]) {
      throw new Error(`Unknown image model: ${ model }`)
    }

    const candidate = {
      model: resolvedModel,
      promptText,
      ratio,
      seed,
      outputCount,
      referenceImages: Array.isArray(referenceImages) && referenceImages.length
        ? referenceImages.map(image => clean({ uri: image.uri, tag: image.tag }))
        : undefined,
      quality: this.#resolveChoice(quality, { 'Low': 'low', 'Medium': 'medium', 'High': 'high', 'Auto': 'auto' }),
      background: this.#resolveChoice(background, { 'Opaque': 'opaque', 'Auto': 'auto' }),
      outputFormat: this.#resolveChoice(outputFormat, { 'PNG': 'png', 'JPEG': 'jpeg' }),
      contentModeration: this.#contentModeration(publicFigureThreshold),
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/text_to_image`,
      body: this.#buildModelBody(candidate, IMAGE_MODEL_FIELDS[resolvedModel]),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Upscale Image
   * @category Image Generation
   * @description Upscales an image up to 16x its original size using the Magnific Precision Upscaler v2 model, with optional sharpening, grain, and detail enhancement controls. Accepts an HTTPS URL, data URI, or runway:// URI as input. By default the action waits for the task to finish; output URLs are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /upscale-image
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Image URI","name":"imageUri","required":true,"description":"The image to upscale: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Scale Factor","name":"scaleFactor","uiComponent":{"type":"DROPDOWN","options":{"values":["2x","4x","8x","16x"]}},"description":"How many times to multiply the image's dimensions. Defaults to the API default when omitted."}
   * @paramDef {"type":"Number","label":"Sharpen","name":"sharpen","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sharpening strength, 0-100."}
   * @paramDef {"type":"Number","label":"Smart Grain","name":"smartGrain","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Film-grain strength, 0-100, to add natural texture."}
   * @paramDef {"type":"Number","label":"Ultra Detail","name":"ultraDetail","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Detail enhancement strength, 0-100."}
   * @paramDef {"type":"String","label":"Flavor","name":"flavor","uiComponent":{"type":"DROPDOWN","options":{"values":["Sublime","Photo","Photo Denoiser"]}},"description":"Upscaling style: Sublime for general content, Photo for photographs, Photo Denoiser to also remove noise."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the upscaled image into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/upscaled.png?_jwt=abc"]}
   */
  async upscaleImage(
    imageUri, scaleFactor, sharpen, smartGrain, ultraDetail, flavor,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[upscaleImage]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/image_upscale`,
      body: clean({
        model: 'magnific_precision_upscaler_v2',
        imageUri,
        scaleFactor: this.#resolveChoice(scaleFactor, { '2x': 2, '4x': 4, '8x': 8, '16x': 16 }),
        sharpen,
        smartGrain,
        ultraDetail,
        flavor: this.#resolveChoice(flavor, { 'Sublime': 'sublime', 'Photo': 'photo', 'Photo Denoiser': 'photo_denoiser' }),
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  // =========================================================================
  // Video Generation
  // =========================================================================

  /**
   * @operationName Image to Video
   * @category Video Generation
   * @description Animates a still image into a video using Runway's image_to_video API. Supports Gen-4.5, Gen-4 Turbo, Veo 3.1, Veo 3.1 Fast, Veo 3, Seedance 2 (plus Fast and Mini), Gemini Omni Flash, and HappyHorse 1.0. Duration limits vary by model: Gen-4.5 and Gen-4 Turbo 2-10s, Veo 3.1 4/6/8s, Veo 3 fixed 8s, Seedance 2 4-15s, Gemini Omni Flash 3-10s, HappyHorse 3-15s. By default the action waits for the task and returns output video URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /image-to-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Gen-4.5","uiComponent":{"type":"DROPDOWN","options":{"values":["Gen-4.5","Gen-4 Turbo","Veo 3.1","Veo 3.1 Fast","Veo 3","Seedance 2","Seedance 2 Fast","Seedance 2 Mini","Gemini Omni Flash","HappyHorse 1.0"]}},"description":"The video model to use."}
   * @paramDef {"type":"String","label":"Prompt Image","name":"promptImage","required":true,"description":"The image to animate as the first frame: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Prompt Text","name":"promptText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the desired motion and scene, up to 1000 characters. Required for Gen-4.5, optional for other models."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","dictionary":"getImageToVideoRatiosDictionary","dependsOn":["model"],"description":"Output resolution as width:height pixels. Supported values depend on the model; pick from the dropdown. Defaults to the model's first supported ratio. Not used by HappyHorse 1.0 (set Resolution instead)."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Video length in seconds. Gen-4.5/Gen-4 Turbo: 2-10 (default 5); Veo 3.1: 4, 6, or 8; Veo 3: always 8; Seedance 2: 4-15; Gemini Omni Flash: 3-10; HappyHorse: 3-15."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed seed (0-4294967295) for reproducible results. Gen-4.5 and Gen-4 Turbo only."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true). Veo and Seedance 2 models only."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","description":"What to avoid in the generated video. Veo models only."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p"]}},"description":"Output resolution. HappyHorse 1.0 only."}
   * @paramDef {"type":"Array<String>","label":"Reference Audio","name":"referenceAudio","description":"Audio URIs (HTTPS URL, data URI, or runway:// URI) to guide the soundtrack. Seedance 2 models only."}
   * @paramDef {"type":"String","label":"Public Figure Threshold","name":"publicFigureThreshold","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low"]}},"description":"Content moderation sensitivity for recognizable public figures. Low is less strict. Gen-4.5 and Gen-4 Turbo only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately and poll later with Get Task or Wait for Task."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"17f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/video.mp4?_jwt=abc"],"savedFiles":["https://files.example.com/flow/runway_17f20503_0.mp4"]}
   */
  async imageToVideo(
    model, promptImage, promptText, ratio, duration, seed, audio, negativePrompt, resolution,
    referenceAudio, publicFigureThreshold, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[imageToVideo]'
    const resolvedModel = this.#resolveChoice(model, IMAGE_TO_VIDEO_MODELS)

    if (!IMAGE_TO_VIDEO_MODEL_FIELDS[resolvedModel]) {
      throw new Error(`Unknown image-to-video model: ${ model }`)
    }

    const candidate = {
      model: resolvedModel,
      promptImage,
      promptText,
      ratio: ratio || (RATIOS.imageToVideo[resolvedModel] || [])[0],
      duration: this.#defaultVideoDuration(resolvedModel, duration),
      seed,
      audio,
      negativePrompt,
      resolution: this.#resolveChoice(resolution, { '720p': '720P', '1080p': '1080P' }),
      referenceAudio: this.#toUriObjects(referenceAudio, 'audio'),
      contentModeration: this.#contentModeration(publicFigureThreshold),
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/image_to_video`,
      body: this.#buildModelBody(candidate, IMAGE_TO_VIDEO_MODEL_FIELDS[resolvedModel]),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Text to Video
   * @category Video Generation
   * @description Generates a video from a text prompt alone using Runway's text_to_video API. Supports Gen-4.5, Veo 3.1, Veo 3.1 Fast, Veo 3, Seedance 2 (plus Fast and Mini), Gemini Omni Flash, and HappyHorse 1.0. Seedance 2 models additionally accept reference images, videos, and audio to guide generation. Duration limits vary by model: Gen-4.5 2-10s, Veo 3.1 4/6/8s, Veo 3 fixed 8s, Seedance 2 4-15s, Gemini Omni Flash 3-10s, HappyHorse 3-15s. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /text-to-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Gen-4.5","uiComponent":{"type":"DROPDOWN","options":{"values":["Gen-4.5","Veo 3.1","Veo 3.1 Fast","Veo 3","Seedance 2","Seedance 2 Fast","Seedance 2 Mini","Gemini Omni Flash","HappyHorse 1.0"]}},"description":"The video model to use."}
   * @paramDef {"type":"String","label":"Prompt Text","name":"promptText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the video to generate, up to 1000 characters."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","dictionary":"getTextToVideoRatiosDictionary","dependsOn":["model"],"description":"Output resolution as width:height pixels. Supported values depend on the model; pick from the dropdown. Defaults to the model's first supported ratio."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Video length in seconds. Gen-4.5: 2-10 (default 5); Veo 3.1: 4, 6, or 8; Veo 3: always 8; Seedance 2: 4-15; Gemini Omni Flash: 3-10; HappyHorse: 3-15."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed seed (0-4294967295) for reproducible results. Gen-4.5 only."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true). Veo and Seedance 2 models only."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","description":"What to avoid in the generated video. Veo models only."}
   * @paramDef {"type":"Array<String>","label":"Reference Images","name":"references","description":"Image URIs (HTTPS URL, data URI, or runway:// URI) whose subjects and style guide the video. Seedance 2 models only."}
   * @paramDef {"type":"Array<String>","label":"Reference Videos","name":"referenceVideos","description":"Video URIs to guide motion and style. Seedance 2 models only."}
   * @paramDef {"type":"Array<String>","label":"Reference Audio","name":"referenceAudio","description":"Audio URIs to guide the soundtrack. Seedance 2 models only."}
   * @paramDef {"type":"String","label":"Public Figure Threshold","name":"publicFigureThreshold","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low"]}},"description":"Content moderation sensitivity for recognizable public figures. Low is less strict. Gen-4.5 only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately and poll later with Get Task or Wait for Task."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"27f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/video.mp4?_jwt=abc"]}
   */
  async textToVideo(
    model, promptText, ratio, duration, seed, audio, negativePrompt, references, referenceVideos,
    referenceAudio, publicFigureThreshold, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[textToVideo]'
    const resolvedModel = this.#resolveChoice(model, TEXT_TO_VIDEO_MODELS)

    if (!TEXT_TO_VIDEO_MODEL_FIELDS[resolvedModel]) {
      throw new Error(`Unknown text-to-video model: ${ model }`)
    }

    const candidate = {
      model: resolvedModel,
      promptText,
      ratio: ratio || (RATIOS.textToVideo[resolvedModel] || [])[0],
      duration: this.#defaultVideoDuration(resolvedModel, duration),
      seed,
      audio,
      negativePrompt,
      references: this.#toUriObjects(references),
      referenceVideos: this.#toUriObjects(referenceVideos, 'video'),
      referenceAudio: this.#toUriObjects(referenceAudio, 'audio'),
      contentModeration: this.#contentModeration(publicFigureThreshold),
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/text_to_video`,
      body: this.#buildModelBody(candidate, TEXT_TO_VIDEO_MODEL_FIELDS[resolvedModel]),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Video to Video
   * @category Video Generation
   * @description Transforms an existing video with a text prompt using Runway's video_to_video API. Aleph 2 performs instruction-based video editing (restyle, add or remove elements, change environments) with optional image keyframes and aspect ratio conversion; Seedance 2 models restyle or regenerate a source video with optional reference media; Gemini Omni Flash edits a video guided by reference images. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /video-to-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Aleph 2","uiComponent":{"type":"DROPDOWN","options":{"values":["Aleph 2","Seedance 2","Seedance 2 Fast","Seedance 2 Mini","Gemini Omni Flash"]}},"description":"The video editing model to use."}
   * @paramDef {"type":"String","label":"Video URI","name":"videoUri","required":true,"description":"The source video to transform: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Prompt Text","name":"promptText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Instructions describing how to transform the video, up to 1000 characters. Required for Gemini Omni Flash; strongly recommended for other models."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","dictionary":"getVideoToVideoRatiosDictionary","dependsOn":["model"],"description":"Output resolution as width:height pixels. Seedance 2 models only; pick from the dropdown. For Aleph 2 use Target Aspect Ratio instead."}
   * @paramDef {"type":"String","label":"Target Aspect Ratio","name":"targetAspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","4:3","3:2","1:1","2:3","3:4","9:16","21:9"]}},"description":"Convert the output to this aspect ratio. Aleph 2 only."}
   * @paramDef {"type":"Array<VideoKeyframe>","label":"Keyframes","name":"keyframes","description":"Image keyframes to guide the edit at specific moments. Each has a uri (image) and seconds (timestamp in the source video). Aleph 2 only."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output video length in seconds, 4-15. Seedance 2 models only."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true). Seedance 2 models only."}
   * @paramDef {"type":"Array<String>","label":"Reference Images","name":"references","description":"Image URIs whose subjects and style guide the transformation. Seedance 2 and Gemini Omni Flash only."}
   * @paramDef {"type":"Array<String>","label":"Reference Videos","name":"referenceVideos","description":"Video URIs to guide motion and style. Seedance 2 models only."}
   * @paramDef {"type":"Array<String>","label":"Reference Audio","name":"referenceAudio","description":"Audio URIs to guide the soundtrack. Seedance 2 models only."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed seed (0-4294967295) for reproducible results. Aleph 2 only."}
   * @paramDef {"type":"String","label":"Public Figure Threshold","name":"publicFigureThreshold","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low"]}},"description":"Content moderation sensitivity for recognizable public figures. Low is less strict. Aleph 2 only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately and poll later with Get Task or Wait for Task."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the transformed video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"37f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/edited.mp4?_jwt=abc"]}
   */
  async videoToVideo(
    model, videoUri, promptText, ratio, targetAspectRatio, keyframes, duration, audio, references,
    referenceVideos, referenceAudio, seed, publicFigureThreshold,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[videoToVideo]'
    const resolvedModel = this.#resolveChoice(model, VIDEO_TO_VIDEO_MODELS)

    if (!VIDEO_TO_VIDEO_MODEL_FIELDS[resolvedModel]) {
      throw new Error(`Unknown video-to-video model: ${ model }`)
    }

    const candidate = {
      model: resolvedModel,
      videoUri,
      promptVideo: videoUri,
      promptText,
      ratio,
      targetAspectRatio,
      keyframes: Array.isArray(keyframes) && keyframes.length
        ? keyframes.map(frame => clean({ uri: frame.uri, seconds: frame.seconds }))
        : undefined,
      duration,
      audio,
      references: this.#toUriObjects(references),
      referenceVideos: this.#toUriObjects(referenceVideos, 'video'),
      referenceAudio: this.#toUriObjects(referenceAudio, 'audio'),
      seed,
      contentModeration: this.#contentModeration(publicFigureThreshold),
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/video_to_video`,
      body: this.#buildModelBody(candidate, VIDEO_TO_VIDEO_MODEL_FIELDS[resolvedModel]),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Upscale Video
   * @category Video Generation
   * @description Upscales a video up to 4K resolution using the Magnific Video Upscaler Creative model, with optional creativity, sharpening, and grain controls plus FPS boosting. Accepts an HTTPS URL, data URI, or runway:// URI as input. By default the action waits for the task to finish; output URLs are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /upscale-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Video URI","name":"videoUri","required":true,"description":"The video to upscale: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1K","2K","4K"]}},"description":"Target output resolution."}
   * @paramDef {"type":"Number","label":"Creativity","name":"creativity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much creative detail the upscaler may invent, 0-100."}
   * @paramDef {"type":"Number","label":"Sharpen","name":"sharpen","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sharpening strength, 0-100."}
   * @paramDef {"type":"Number","label":"Smart Grain","name":"smartGrain","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Film-grain strength, 0-100, to add natural texture."}
   * @paramDef {"type":"String","label":"Flavor","name":"flavor","uiComponent":{"type":"DROPDOWN","options":{"values":["Vivid","Natural"]}},"description":"Upscaling style: Vivid for punchier results, Natural for realistic ones."}
   * @paramDef {"type":"Boolean","label":"FPS Boost","name":"fpsBoost","uiComponent":{"type":"CHECKBOX"},"description":"Increase the output frame rate via interpolation."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the upscaled video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"47f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/upscaled.mp4?_jwt=abc"]}
   */
  async upscaleVideo(
    videoUri, resolution, creativity, sharpen, smartGrain, flavor, fpsBoost,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[upscaleVideo]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/video_upscale`,
      body: clean({
        model: 'magnific_video_upscaler_creative',
        videoUri,
        resolution: this.#resolveChoice(resolution, { '720p': '720p', '1K': '1k', '2K': '2k', '4K': '4k' }),
        creativity,
        sharpen,
        smartGrain,
        flavor: this.#resolveChoice(flavor, { 'Vivid': 'vivid', 'Natural': 'natural' }),
        fpsBoost,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Character Performance
   * @category Video Generation
   * @description Animates a character with the movements, expressions, and speech of a real performance video using Runway's Act-Two (character_performance) API. The character can be an image or a video; the reference is a video of a person acting out the performance. Supports body control and adjustable expression intensity. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /character-performance
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Character Type","name":"characterType","required":true,"defaultValue":"Image","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video"]}},"description":"Whether the character input is a still image or a video."}
   * @paramDef {"type":"String","label":"Character URI","name":"characterUri","required":true,"description":"The character to animate: an HTTPS URL, data URI, or runway:// URI of an image or video with a clearly visible face."}
   * @paramDef {"type":"String","label":"Reference Video URI","name":"referenceVideoUri","required":true,"description":"A video of a person performing; their face, expressions, and speech drive the character."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","uiComponent":{"type":"DROPDOWN","options":{"values":["1280:720","720:1280","960:960","1104:832","832:1104","1584:672"]}},"description":"Output resolution as width:height pixels."}
   * @paramDef {"type":"Boolean","label":"Body Control","name":"bodyControl","uiComponent":{"type":"CHECKBOX"},"description":"Also transfer body movements from the reference performance, not just the face."}
   * @paramDef {"type":"Number","label":"Expression Intensity","name":"expressionIntensity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How strongly facial expressions are applied, 1-5. Defaults to 3."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed seed (0-4294967295) for reproducible results. Random when omitted."}
   * @paramDef {"type":"String","label":"Public Figure Threshold","name":"publicFigureThreshold","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low"]}},"description":"Content moderation sensitivity for recognizable public figures. Low is less strict."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"57f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/performance.mp4?_jwt=abc"]}
   */
  async characterPerformance(
    characterType, characterUri, referenceVideoUri, ratio, bodyControl, expressionIntensity,
    seed, publicFigureThreshold, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[characterPerformance]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/character_performance`,
      body: clean({
        model: 'act_two',
        character: {
          type: this.#resolveChoice(characterType, { 'Image': 'image', 'Video': 'video' }) || 'image',
          uri: characterUri,
        },
        reference: {
          type: 'video',
          uri: referenceVideoUri,
        },
        ratio,
        bodyControl,
        expressionIntensity,
        seed,
        contentModeration: this.#contentModeration(publicFigureThreshold),
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  // Applies model-specific duration requirements: Veo 3 is fixed at 8 seconds and
  // Gen-4.5 requires a duration, so a sensible default is supplied when omitted.
  #defaultVideoDuration(model, duration) {
    if (model === 'veo3') {
      return 8
    }

    if (duration === undefined || duration === null || duration === '') {
      return model === 'gen4.5' ? 5 : undefined
    }

    return duration
  }

  // =========================================================================
  // Audio Generation
  // =========================================================================

  /**
   * @operationName Generate Sound Effect
   * @category Audio Generation
   * @description Generates a sound effect from a text description using Runway's sound_effect API. Seed Audio supports reference audio and pitch, speed, loudness, sample rate, and output format controls; Eleven Text to Sound v2 supports a target duration (0.5-30 seconds) and seamless looping. By default the action waits for the task and returns output audio URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /generate-sound-effect
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Eleven Text to Sound v2","uiComponent":{"type":"DROPDOWN","options":{"values":["Eleven Text to Sound v2","Seed Audio"]}},"description":"The sound effect model to use."}
   * @paramDef {"type":"String","label":"Prompt","name":"promptText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the sound to generate, e.g. 'heavy rain on a tin roof'. Up to 3000 characters for Eleven, 2048 for Seed Audio."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Target length in seconds, 0.5-30. Eleven Text to Sound v2 only."}
   * @paramDef {"type":"Boolean","label":"Loop","name":"loop","uiComponent":{"type":"CHECKBOX"},"description":"Generate a seamlessly loopable sound. Eleven Text to Sound v2 only."}
   * @paramDef {"type":"Array<String>","label":"Reference Audios","name":"referenceAudios","description":"Audio URIs (HTTPS URL, data URI, or runway:// URI) to guide the sound's character. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Speech Rate","name":"speechRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Playback speed adjustment, -50 to 100. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Loudness Rate","name":"loudnessRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Loudness adjustment, -50 to 100. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Pitch Rate","name":"pitchRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pitch adjustment in semitones, -12 to 12. Seed Audio only."}
   * @paramDef {"type":"String","label":"Sample Rate","name":"sampleRate","uiComponent":{"type":"DROPDOWN","options":{"values":["8 kHz","16 kHz","24 kHz","32 kHz","44.1 kHz","48 kHz"]}},"description":"Output sample rate. Seed Audio only."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["WAV","MP3","OGG Opus"]}},"description":"Audio file format. Seed Audio only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated audio into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"67f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/sound.mp3?_jwt=abc"]}
   */
  async generateSoundEffect(
    model, promptText, duration, loop, referenceAudios, speechRate, loudnessRate, pitchRate,
    sampleRate, outputFormat, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[generateSoundEffect]'
    const resolvedModel = this.#resolveChoice(model, SOUND_EFFECT_MODELS) || 'eleven_text_to_sound_v2'

    const body = resolvedModel === 'seed_audio'
      ? clean({
        model: resolvedModel,
        promptText,
        referenceAudios: Array.isArray(referenceAudios) && referenceAudios.length ? referenceAudios : undefined,
        speechRate,
        loudnessRate,
        pitchRate,
        sampleRate: this.#resolveChoice(sampleRate, SAMPLE_RATES),
        outputFormat: this.#resolveChoice(outputFormat, AUDIO_OUTPUT_FORMATS),
      })
      : clean({ model: resolvedModel, promptText, duration, loop })

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/sound_effect`,
      body,
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Text to Speech
   * @category Audio Generation
   * @description Converts text into natural-sounding speech using Runway's text_to_speech API. Eleven Multilingual v2 uses one of 49 preset voices; Seed Audio can clone a voice from a reference audio URI and offers pitch, speed, loudness, sample rate, and format controls. By default the action waits for the task and returns output audio URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /text-to-speech
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"Eleven Multilingual v2","uiComponent":{"type":"DROPDOWN","options":{"values":["Eleven Multilingual v2","Seed Audio"]}},"description":"The speech model to use."}
   * @paramDef {"type":"String","label":"Text","name":"promptText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to speak. Up to 1000 characters for Eleven Multilingual v2, 2048 for Seed Audio."}
   * @paramDef {"type":"String","label":"Preset Voice","name":"presetVoice","uiComponent":{"type":"DROPDOWN","options":{"values":["Maya","Arjun","Serene","Bernard","Billy","Mark","Clint","Mabel","Chad","Leslie","Eleanor","Elias","Elliot","Grungle","Brodie","Sandra","Kirk","Kylie","Lara","Lisa","Malachi","Marlene","Martin","Miriam","Monster","Paula","Pip","Rusty","Ragnar","Xylar","Maggie","Jack","Katie","Noah","James","Rina","Ella","Mariah","Frank","Claudia","Niki","Vincent","Kendrick","Myrna","Tom","Wanda","Benjamin","Kiana","Rachel"]}},"description":"The preset voice to speak with. Required for Eleven Multilingual v2; ignored by Seed Audio."}
   * @paramDef {"type":"String","label":"Voice Audio URI","name":"voiceAudioUri","description":"Audio URI (HTTPS URL, data URI, or runway:// URI) of a voice to clone. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Speech Rate","name":"speechRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Speaking speed adjustment, -50 to 100. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Loudness Rate","name":"loudnessRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Loudness adjustment, -50 to 100. Seed Audio only."}
   * @paramDef {"type":"Number","label":"Pitch Rate","name":"pitchRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pitch adjustment in semitones, -12 to 12. Seed Audio only."}
   * @paramDef {"type":"String","label":"Sample Rate","name":"sampleRate","uiComponent":{"type":"DROPDOWN","options":{"values":["8 kHz","16 kHz","24 kHz","32 kHz","44.1 kHz","48 kHz"]}},"description":"Output sample rate. Seed Audio only."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["WAV","MP3","OGG Opus"]}},"description":"Audio file format. Seed Audio only."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated speech into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"77f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/speech.mp3?_jwt=abc"]}
   */
  async textToSpeech(
    model, promptText, presetVoice, voiceAudioUri, speechRate, loudnessRate, pitchRate,
    sampleRate, outputFormat, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[textToSpeech]'
    const resolvedModel = this.#resolveChoice(model, TEXT_TO_SPEECH_MODELS) || 'eleven_multilingual_v2'

    let body

    if (resolvedModel === 'seed_audio') {
      body = clean({
        model: resolvedModel,
        promptText,
        voice: voiceAudioUri ? { type: 'reference-audio', audioUri: voiceAudioUri } : undefined,
        speechRate,
        loudnessRate,
        pitchRate,
        sampleRate: this.#resolveChoice(sampleRate, SAMPLE_RATES),
        outputFormat: this.#resolveChoice(outputFormat, AUDIO_OUTPUT_FORMATS),
      })
    } else {
      if (!presetVoice) {
        throw new Error('Preset Voice is required when using the Eleven Multilingual v2 model.')
      }

      if (!TTS_PRESET_VOICES.includes(presetVoice)) {
        logger.warn(`${ logTag } - preset voice "${ presetVoice }" is not in the known preset list; passing it through as-is`)
      }

      body = { model: resolvedModel, promptText, voice: { type: 'runway-preset', presetId: presetVoice } }
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/text_to_speech`,
      body,
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Speech to Speech
   * @category Audio Generation
   * @description Replaces the voice in an audio or video recording with a preset voice while preserving the original delivery, timing, and intonation, using the Eleven Multilingual STS v2 model. Optionally removes background noise first. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /speech-to-speech
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Media Type","name":"mediaType","required":true,"defaultValue":"Audio","uiComponent":{"type":"DROPDOWN","options":{"values":["Audio","Video"]}},"description":"Whether the source media is an audio file or a video file."}
   * @paramDef {"type":"String","label":"Media URI","name":"mediaUri","required":true,"description":"The source recording whose voice to replace: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Preset Voice","name":"presetVoice","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Maya","Arjun","Serene","Bernard","Billy","Mark","Clint","Mabel","Chad","Leslie","Eleanor","Elias","Elliot","Grungle","Brodie","Sandra","Kirk","Kylie","Lara","Lisa","Malachi","Marlene","Martin","Miriam","Monster","Paula","Pip","Rusty","Ragnar","Xylar","Maggie","Jack","Katie","Noah","James","Rina","Ella","Mariah","Frank","Claudia","Niki","Vincent","Kendrick","Myrna","Tom","Wanda","Benjamin","Kiana","Rachel"]}},"description":"The preset voice that replaces the original speaker."}
   * @paramDef {"type":"Boolean","label":"Remove Background Noise","name":"removeBackgroundNoise","uiComponent":{"type":"CHECKBOX"},"description":"Clean up background noise from the source before converting the voice."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the converted media into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"87f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/converted.mp3?_jwt=abc"]}
   */
  async speechToSpeech(
    mediaType, mediaUri, presetVoice, removeBackgroundNoise,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[speechToSpeech]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/speech_to_speech`,
      body: clean({
        model: 'eleven_multilingual_sts_v2',
        media: {
          type: this.#resolveChoice(mediaType, { 'Audio': 'audio', 'Video': 'video' }) || 'audio',
          uri: mediaUri,
        },
        voice: { type: 'runway-preset', presetId: presetVoice },
        removeBackgroundNoise,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Dub Audio
   * @category Audio Generation
   * @description Dubs an audio recording into another language using the Eleven Voice Dubbing model, cloning the original speakers' voices by default. Supports 29 target languages, optional background-audio removal, and a speaker-count hint for better diarization. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /dub-audio
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Audio URI","name":"audioUri","required":true,"description":"The audio to dub: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLanguage","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","Hindi","Portuguese","Chinese","Spanish","French","German","Japanese","Arabic","Russian","Korean","Indonesian","Italian","Dutch","Turkish","Polish","Swedish","Filipino","Malay","Romanian","Ukrainian","Greek","Czech","Danish","Finnish","Bulgarian","Croatian","Slovak","Tamil"]}},"description":"The language to dub the audio into."}
   * @paramDef {"type":"Boolean","label":"Disable Voice Cloning","name":"disableVoiceCloning","uiComponent":{"type":"CHECKBOX"},"description":"Use stock voices instead of cloning the original speakers' voices."}
   * @paramDef {"type":"Boolean","label":"Drop Background Audio","name":"dropBackgroundAudio","uiComponent":{"type":"CHECKBOX"},"description":"Remove background music and noise, keeping only the dubbed speech."}
   * @paramDef {"type":"Number","label":"Number of Speakers","name":"numSpeakers","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Hint for how many distinct speakers are in the recording (up to 9). Auto-detected when omitted."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the dubbed audio into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"97f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/dubbed.mp3?_jwt=abc"]}
   */
  async dubAudio(
    audioUri, targetLanguage, disableVoiceCloning, dropBackgroundAudio, numSpeakers,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[dubAudio]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/voice_dubbing`,
      body: clean({
        model: 'eleven_voice_dubbing',
        audioUri,
        targetLang: this.#resolveChoice(targetLanguage, DUBBING_LANGUAGES),
        disableVoiceCloning,
        dropBackgroundAudio,
        numSpeakers,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Isolate Voice
   * @category Audio Generation
   * @description Extracts clean speech from an audio recording, removing background noise, music, and ambience, using the Eleven Voice Isolation model. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /isolate-voice
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Audio URI","name":"audioUri","required":true,"description":"The audio to clean up: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the isolated audio into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a7f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/isolated.mp3?_jwt=abc"]}
   */
  async isolateVoice(audioUri, waitForCompletion, saveOutputToFiles, fileOptions) {
    const logTag = '[isolateVoice]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/voice_isolation`,
      body: { model: 'eleven_voice_isolation', audioUri },
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  // =========================================================================
  // Avatars
  // =========================================================================

  /**
   * @operationName Generate Avatar Video
   * @category Avatars
   * @description Generates a talking avatar video using Runway's avatar_videos API (GWM-1 Avatars model). The avatar is either one of nine Runway presets or a custom avatar created with Create Avatar; the speech comes either from an audio file or from text spoken by a preset or custom voice. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /generate-avatar-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Preset Avatar","name":"avatarPreset","uiComponent":{"type":"DROPDOWN","options":{"values":["Game Character","Game Character (Man)","Music Superstar","Cat Character","Influencer","Tennis Coach","Human Resources","Fashion Designer","Cooking Teacher"]}},"description":"A Runway preset avatar to use. Either this or Custom Avatar is required."}
   * @paramDef {"type":"String","label":"Custom Avatar","name":"customAvatarId","dictionary":"getAvatarsDictionary","description":"The id of a custom avatar created with Create Avatar. Takes precedence over Preset Avatar."}
   * @paramDef {"type":"String","label":"Speech Text","name":"speechText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text for the avatar to speak. Either this or Speech Audio URI is required."}
   * @paramDef {"type":"String","label":"Speech Audio URI","name":"speechAudioUri","description":"Audio URI (HTTPS URL, data URI, or runway:// URI) for the avatar to lip-sync. Takes precedence over Speech Text."}
   * @paramDef {"type":"String","label":"Preset Voice","name":"voicePresetId","uiComponent":{"type":"DROPDOWN","options":{"values":["Victoria","Vincent","Clara","Drew","Skye","Max","Morgan","Felix","Mia","Marcus","Summer","Ruby","Aurora","Jasper","Leo","Adrian","Nina","Emma","Blake","David","Maya","Nathan","Sam","Georgia","Petra","Adam","Zach","Violet","Roman","Luna"]}},"description":"The preset voice used to speak Speech Text. Ignored when Speech Audio URI is provided."}
   * @paramDef {"type":"String","label":"Custom Voice","name":"customVoiceId","dictionary":"getVoicesDictionary","description":"The id of a custom voice created with Create Voice, used to speak Speech Text. Takes precedence over Preset Voice."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the avatar video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b7f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/avatar.mp4?_jwt=abc"]}
   */
  async generateAvatarVideo(
    avatarPreset, customAvatarId, speechText, speechAudioUri, voicePresetId, customVoiceId,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[generateAvatarVideo]'

    const avatar = customAvatarId
      ? { type: 'custom', avatarId: customAvatarId }
      : { type: 'runway-preset', presetId: this.#resolveChoice(avatarPreset, AVATAR_PRESETS) }

    if (!avatar.avatarId && !avatar.presetId) {
      throw new Error('Provide either a Preset Avatar or a Custom Avatar id.')
    }

    let speech

    if (speechAudioUri) {
      speech = { type: 'audio', audio: speechAudioUri }
    } else if (speechText) {
      const voice = customVoiceId
        ? { type: 'custom', id: customVoiceId }
        : voicePresetId
          ? { type: 'preset', presetId: this.#resolveChoice(voicePresetId, LIVE_PRESET_VOICES) }
          : undefined

      speech = clean({ type: 'text', text: speechText, voice })
    } else {
      throw new Error('Provide either Speech Text or a Speech Audio URI.')
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/avatar_videos`,
      body: { model: 'gwm1_avatars', avatar, speech },
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName List Avatars
   * @category Avatars
   * @description Lists the custom avatars in your Runway organization, including each avatar's processing status, voice, personality, and reference images. Results are paginated with a cursor.
   * @route GET /avatars
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum avatars to return per page, 1-100. Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","personality":"Friendly and concise","status":"READY","voice":{"type":"runway-live-preset","presetId":"victoria"},"referenceImageUri":"https://example.com/agent.png","documentIds":[],"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:05:00.000Z"}],"hasMore":false,"nextCursor":null}
   */
  async listAvatars(limit, cursor) {
    const logTag = '[listAvatars]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIST_LIMIT, cursor },
    })
  }

  /**
   * @operationName Create Avatar
   * @category Avatars
   * @description Creates a custom avatar from a reference image, with a personality, a voice (Runway live preset or custom voice), and optional knowledge documents. Avatar creation is asynchronous: the response has status PROCESSING until Runway finishes preparing it; check progress with Get Avatar.
   * @route POST /create-avatar
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A display name for the avatar."}
   * @paramDef {"type":"String","label":"Reference Image","name":"referenceImage","required":true,"description":"The avatar's appearance: an HTTPS URL, data URI, or runway:// URI of an image with a clearly visible face."}
   * @paramDef {"type":"String","label":"Personality","name":"personality","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Instructions describing how the avatar behaves and speaks, similar to a system prompt."}
   * @paramDef {"type":"String","label":"Start Script","name":"startScript","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An opening line the avatar says when a conversation starts."}
   * @paramDef {"type":"String","label":"Preset Voice","name":"voicePresetId","uiComponent":{"type":"DROPDOWN","options":{"values":["Victoria","Vincent","Clara","Drew","Skye","Max","Morgan","Felix","Mia","Marcus","Summer","Ruby","Aurora","Jasper","Leo","Adrian","Nina","Emma","Blake","David","Maya","Nathan","Sam","Georgia","Petra","Adam","Zach","Violet","Roman","Luna"]}},"description":"A Runway live preset voice for the avatar. Either this or Custom Voice is required."}
   * @paramDef {"type":"String","label":"Custom Voice","name":"customVoiceId","dictionary":"getVoicesDictionary","description":"The id of a custom voice created with Create Voice. Takes precedence over Preset Voice."}
   * @paramDef {"type":"Array<String>","label":"Document IDs","name":"documentIds","description":"Ids of knowledge documents (created with Create Document) the avatar can draw on when answering."}
   * @paramDef {"type":"String","label":"Image Processing","name":"imageProcessing","uiComponent":{"type":"DROPDOWN","options":{"values":["Optimize","None"]}},"description":"Whether Runway should optimize the reference image for avatar rendering."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","personality":"Friendly and concise","startScript":"Hi, how can I help?","voice":{"type":"runway-live-preset","presetId":"victoria"},"referenceImageUri":"https://example.com/agent.png","processedImageUri":null,"documentIds":[],"createdAt":"2026-07-01T10:15:00.000Z","updatedAt":"2026-07-01T10:15:00.000Z","status":"PROCESSING"}
   */
  async createAvatar(
    name, referenceImage, personality, startScript, voicePresetId, customVoiceId,
    documentIds, imageProcessing
  ) {
    const logTag = '[createAvatar]'
    const voice = this.#buildAvatarVoice(voicePresetId, customVoiceId)

    if (!voice) {
      throw new Error('Provide either a Preset Voice or a Custom Voice id.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars`,
      method: 'post',
      body: clean({
        name,
        referenceImage,
        personality,
        startScript,
        voice,
        documentIds: Array.isArray(documentIds) && documentIds.length ? documentIds : undefined,
        imageProcessing: this.#resolveChoice(imageProcessing, { 'Optimize': 'optimize', 'None': 'none' }),
      }),
    })
  }

  /**
   * @operationName Get Avatar
   * @category Avatars
   * @description Retrieves a custom avatar by id, including its processing status (PROCESSING, READY, or FAILED), voice, personality, and image URIs.
   * @route GET /avatar
   *
   * @paramDef {"type":"String","label":"Avatar","name":"avatarId","required":true,"dictionary":"getAvatarsDictionary","description":"The avatar to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","personality":"Friendly and concise","startScript":"Hi, how can I help?","voice":{"type":"runway-live-preset","presetId":"victoria"},"referenceImageUri":"https://example.com/agent.png","processedImageUri":"https://example.com/agent_processed.png","documentIds":[],"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:05:00.000Z","status":"READY"}
   */
  async getAvatar(avatarId) {
    const logTag = '[getAvatar]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars/${ encodeURIComponent(avatarId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Avatar
   * @category Avatars
   * @description Updates a custom avatar's name, reference image, personality, start script, voice, knowledge documents, or image processing mode. Only the provided fields are changed.
   * @route PATCH /update-avatar
   *
   * @paramDef {"type":"String","label":"Avatar","name":"avatarId","required":true,"dictionary":"getAvatarsDictionary","description":"The avatar to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new display name."}
   * @paramDef {"type":"String","label":"Reference Image","name":"referenceImage","description":"A new appearance image: an HTTPS URL, data URI, or runway:// URI."}
   * @paramDef {"type":"String","label":"Personality","name":"personality","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New behavior instructions for the avatar."}
   * @paramDef {"type":"String","label":"Start Script","name":"startScript","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new opening line for conversations."}
   * @paramDef {"type":"String","label":"Preset Voice","name":"voicePresetId","uiComponent":{"type":"DROPDOWN","options":{"values":["Victoria","Vincent","Clara","Drew","Skye","Max","Morgan","Felix","Mia","Marcus","Summer","Ruby","Aurora","Jasper","Leo","Adrian","Nina","Emma","Blake","David","Maya","Nathan","Sam","Georgia","Petra","Adam","Zach","Violet","Roman","Luna"]}},"description":"Change the avatar's voice to this Runway live preset."}
   * @paramDef {"type":"String","label":"Custom Voice","name":"customVoiceId","dictionary":"getVoicesDictionary","description":"Change the avatar's voice to this custom voice. Takes precedence over Preset Voice."}
   * @paramDef {"type":"Array<String>","label":"Document IDs","name":"documentIds","description":"Replace the avatar's knowledge document ids."}
   * @paramDef {"type":"String","label":"Image Processing","name":"imageProcessing","uiComponent":{"type":"DROPDOWN","options":{"values":["Optimize","None"]}},"description":"Whether Runway should optimize the reference image for avatar rendering."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent v2","personality":"Friendly and concise","startScript":"Hi, how can I help?","voice":{"type":"runway-live-preset","presetId":"clara"},"referenceImageUri":"https://example.com/agent.png","processedImageUri":"https://example.com/agent_processed.png","documentIds":[],"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-07-01T10:15:00.000Z","status":"READY"}
   */
  async updateAvatar(
    avatarId, name, referenceImage, personality, startScript, voicePresetId, customVoiceId,
    documentIds, imageProcessing
  ) {
    const logTag = '[updateAvatar]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars/${ encodeURIComponent(avatarId) }`,
      method: 'patch',
      body: clean({
        name,
        referenceImage,
        personality,
        startScript,
        voice: this.#buildAvatarVoice(voicePresetId, customVoiceId),
        documentIds: Array.isArray(documentIds) && documentIds.length ? documentIds : undefined,
        imageProcessing: this.#resolveChoice(imageProcessing, { 'Optimize': 'optimize', 'None': 'none' }),
      }),
    })
  }

  /**
   * @operationName Delete Avatar
   * @category Avatars
   * @description Permanently deletes a custom avatar from your Runway organization.
   * @route DELETE /delete-avatar
   *
   * @paramDef {"type":"String","label":"Avatar","name":"avatarId","required":true,"dictionary":"getAvatarsDictionary","description":"The avatar to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"c1d2e3f4-1111-4222-8333-944455556666"}
   */
  async deleteAvatar(avatarId) {
    const logTag = '[deleteAvatar]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars/${ encodeURIComponent(avatarId) }`,
      method: 'delete',
    })

    return { success: true, id: avatarId }
  }

  /**
   * @operationName List Avatar Conversations
   * @category Avatars
   * @description Lists recorded conversations from realtime avatar sessions, optionally filtered by avatar and date range. Each entry includes the conversation status and metadata; fetch the full transcript with Get Avatar Conversation.
   * @route GET /avatar-conversations
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum conversations to return per page, 1-100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor."}
   * @paramDef {"type":"String","label":"Avatar","name":"avatarId","dictionary":"getAvatarsDictionary","description":"Only return conversations with this avatar."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Only return conversations on or after this date, in YYYY-MM-DD format (UTC)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"Only return conversations before this date, in YYYY-MM-DD format (UTC)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"d1e2f3a4-1111-4222-8333-944455556666","name":"Conversation with Support Agent","avatar":{"type":"custom","id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","imageUrl":"https://example.com/agent.png"},"createdAt":"2026-07-01T10:15:00.000Z","status":"completed"}],"hasMore":false,"nextCursor":null}
   */
  async listAvatarConversations(limit, cursor, avatarId, startDate, endDate) {
    const logTag = '[listAvatarConversations]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatar_conversations`,
      method: 'get',
      query: { limit: limit || 20, cursor, avatar: avatarId, startDate, endDate },
    })
  }

  /**
   * @operationName Get Avatar Conversation
   * @category Avatars
   * @description Retrieves a single avatar conversation by id, including the full transcript (user and assistant turns with timestamps and tool calls), the recording URL, and the tools that were available during the session.
   * @route GET /avatar-conversation
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to fetch, from List Avatar Conversations."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d1e2f3a4-1111-4222-8333-944455556666","name":"Conversation with Support Agent","avatar":{"type":"custom","id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","imageUrl":"https://example.com/agent.png"},"createdAt":"2026-07-01T10:15:00.000Z","maxDuration":600,"transcript":[{"role":"user","content":"Hello!","timestamp":"2026-07-01T10:15:05.000Z"},{"role":"assistant","content":"Hi, how can I help?","timestamp":"2026-07-01T10:15:07.000Z"}],"recordingUrl":"https://example.com/recording.mp4","tools":[],"status":"completed"}
   */
  async getAvatarConversation(conversationId) {
    const logTag = '[getAvatarConversation]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatar_conversations/${ encodeURIComponent(conversationId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Avatar Conversation
   * @category Avatars
   * @description Permanently deletes a recorded avatar conversation, including its transcript and recording.
   * @route DELETE /delete-avatar-conversation
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to delete, from List Avatar Conversations."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"d1e2f3a4-1111-4222-8333-944455556666"}
   */
  async deleteAvatarConversation(conversationId) {
    const logTag = '[deleteAvatarConversation]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatar_conversations/${ encodeURIComponent(conversationId) }`,
      method: 'delete',
    })

    return { success: true, id: conversationId }
  }

  /**
   * @operationName Get Avatar Usage
   * @category Avatars
   * @description Returns realtime avatar session usage for a date range: total session count, total seconds, average duration, and a per-day breakdown.
   * @route GET /avatar-usage
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"Start of the reporting range, in YYYY-MM-DD format (UTC)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"End of the reporting range, in YYYY-MM-DD format (UTC)."}
   *
   * @returns {Object}
   * @sampleResult {"totalSeconds":5400,"totalSessions":12,"avgDurationSeconds":450,"byDay":[{"date":"2026-07-01","sessions":4,"seconds":1800}]}
   */
  async getAvatarUsage(startDate, endDate) {
    const logTag = '[getAvatarUsage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatar_usage`,
      method: 'get',
      query: { startDate, endDate },
    })
  }

  #buildAvatarVoice(voicePresetId, customVoiceId) {
    if (customVoiceId) {
      return { type: 'custom', id: customVoiceId }
    }

    if (voicePresetId) {
      return { type: 'runway-live-preset', presetId: this.#resolveChoice(voicePresetId, LIVE_PRESET_VOICES) }
    }

    return undefined
  }

  // =========================================================================
  // Voices
  // =========================================================================

  /**
   * @operationName List Voices
   * @category Voices
   * @description Lists the custom voices in your Runway organization, including each voice's processing status (PROCESSING, READY, or FAILED) and preview URL when available. Results are paginated with a cursor.
   * @route GET /voices
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum voices to return per page, 1-100. Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"e1f2a3b4-1111-4222-8333-944455556666","name":"Narrator","description":"Warm documentary narrator","createdAt":"2026-06-01T09:00:00.000Z","status":"READY","previewUrl":"https://example.com/preview.mp3"}],"hasMore":false,"nextCursor":null}
   */
  async listVoices(limit, cursor) {
    const logTag = '[listVoices]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices`,
      method: 'get',
      query: { limit: limit || DEFAULT_LIST_LIMIT, cursor },
    })
  }

  /**
   * @operationName Create Voice
   * @category Voices
   * @description Creates a custom voice either by cloning it from an audio sample or by designing it from a text description. Voice creation is asynchronous: check the status with Get Voice until it becomes READY, then use the voice for avatars and avatar videos.
   * @route POST /create-voice
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A display name for the voice."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An optional description of the voice."}
   * @paramDef {"type":"String","label":"Audio URI","name":"audioUri","description":"Audio sample (HTTPS URL, data URI, or runway:// URI) to clone the voice from. Either this or Voice Prompt is required."}
   * @paramDef {"type":"String","label":"Voice Prompt","name":"voicePrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A text description of the desired voice (e.g. 'a calm, deep male narrator with a British accent'), used when no Audio URI is provided."}
   * @paramDef {"type":"String","label":"Voice Design Model","name":"voiceDesignModel","uiComponent":{"type":"DROPDOWN","options":{"values":["Eleven Text-to-Voice v3","Eleven Multilingual Text-to-Voice v2"]}},"description":"The model that designs the voice from the Voice Prompt. Defaults to Eleven Text-to-Voice v3. Ignored when cloning from audio."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e1f2a3b4-1111-4222-8333-944455556666"}
   */
  async createVoice(name, description, audioUri, voicePrompt, voiceDesignModel) {
    const logTag = '[createVoice]'

    let from

    if (audioUri) {
      from = { type: 'audio', audio: audioUri }
    } else if (voicePrompt) {
      from = {
        type: 'text',
        prompt: voicePrompt,
        model: this.#resolveChoice(voiceDesignModel, VOICE_CREATION_MODELS) || 'eleven_ttv_v3',
      }
    } else {
      throw new Error('Provide either an Audio URI to clone from or a Voice Prompt to design the voice.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices`,
      method: 'post',
      body: clean({ name, description, from }),
    })
  }

  /**
   * @operationName Get Voice
   * @category Voices
   * @description Retrieves a custom voice by id, including its processing status (PROCESSING, READY, or FAILED), preview URL when ready, and failure reason when failed.
   * @route GET /voice
   *
   * @paramDef {"type":"String","label":"Voice","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The voice to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e1f2a3b4-1111-4222-8333-944455556666","name":"Narrator","description":"Warm documentary narrator","createdAt":"2026-06-01T09:00:00.000Z","status":"READY","previewUrl":"https://example.com/preview.mp3"}
   */
  async getVoice(voiceId) {
    const logTag = '[getVoice]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices/${ encodeURIComponent(voiceId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Voice
   * @category Voices
   * @description Updates a custom voice's name or description. Only the provided fields are changed.
   * @route PATCH /update-voice
   *
   * @paramDef {"type":"String","label":"Voice","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The voice to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new display name."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"A new description."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e1f2a3b4-1111-4222-8333-944455556666","name":"Narrator v2","description":"Warm documentary narrator","createdAt":"2026-06-01T09:00:00.000Z","status":"READY","previewUrl":"https://example.com/preview.mp3"}
   */
  async updateVoice(voiceId, name, description) {
    const logTag = '[updateVoice]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices/${ encodeURIComponent(voiceId) }`,
      method: 'patch',
      body: clean({ name, description }),
    })
  }

  /**
   * @operationName Delete Voice
   * @category Voices
   * @description Permanently deletes a custom voice from your Runway organization.
   * @route DELETE /delete-voice
   *
   * @paramDef {"type":"String","label":"Voice","name":"voiceId","required":true,"dictionary":"getVoicesDictionary","description":"The voice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"e1f2a3b4-1111-4222-8333-944455556666"}
   */
  async deleteVoice(voiceId) {
    const logTag = '[deleteVoice]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices/${ encodeURIComponent(voiceId) }`,
      method: 'delete',
    })

    return { success: true, id: voiceId }
  }

  /**
   * @operationName Preview Voice
   * @category Voices
   * @description Generates a short audio preview of a voice designed from a text description, without creating a persistent voice. Returns the preview audio URL and its duration. Useful for iterating on a Voice Prompt before calling Create Voice.
   * @route POST /preview-voice
   *
   * @paramDef {"type":"String","label":"Voice Prompt","name":"voicePrompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A text description of the desired voice, e.g. 'an energetic young female sports commentator'."}
   * @paramDef {"type":"String","label":"Voice Design Model","name":"voiceDesignModel","uiComponent":{"type":"DROPDOWN","options":{"values":["Eleven Text-to-Voice v3","Eleven Multilingual Text-to-Voice v2"]}},"description":"The model that designs the voice. Defaults to Eleven Text-to-Voice v3."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://example.com/voice-preview.mp3","durationSecs":4.2}
   */
  async previewVoice(voicePrompt, voiceDesignModel) {
    const logTag = '[previewVoice]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices/preview`,
      method: 'post',
      body: {
        prompt: voicePrompt,
        model: this.#resolveChoice(voiceDesignModel, VOICE_CREATION_MODELS) || 'eleven_ttv_v3',
      },
    })
  }

  // =========================================================================
  // Knowledge Documents
  // =========================================================================

  /**
   * @operationName List Documents
   * @category Knowledge Documents
   * @description Lists the knowledge documents in your Runway organization that avatars can use to answer questions, including which avatars use each document. Results are paginated with a cursor.
   * @route GET /documents
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum documents to return per page, 1-100. Defaults to 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Updated At"]}},"description":"The field to sort by. Defaults to Created At."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort direction. Defaults to Descending (newest first)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"f1a2b3c4-1111-4222-8333-944455556666","name":"Product FAQ","type":"text","usedBy":[{"id":"c1d2e3f4-1111-4222-8333-944455556666","name":"Support Agent","imageUrl":null}],"createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:00:00.000Z"}],"hasMore":false,"nextCursor":null}
   */
  async listDocuments(limit, cursor, sortBy, sortOrder) {
    const logTag = '[listDocuments]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/documents`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_LIST_LIMIT,
        cursor,
        sort: this.#resolveChoice(sortBy, { 'Created At': 'createdAt', 'Updated At': 'updatedAt' }) || 'createdAt',
        order: this.#resolveChoice(sortOrder, { 'Descending': 'desc', 'Ascending': 'asc' }) || 'desc',
      },
    })
  }

  /**
   * @operationName Create Document
   * @category Knowledge Documents
   * @description Creates a text knowledge document that custom avatars can draw on when answering questions. Attach it to an avatar via the Document IDs parameter of Create Avatar or Update Avatar.
   * @route POST /create-document
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A display name for the document, e.g. 'Product FAQ'."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The document's text content."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f1a2b3c4-1111-4222-8333-944455556666","name":"Product FAQ","type":"text","usedBy":[],"content":"Q: How do I reset my password?...","createdAt":"2026-07-01T10:15:00.000Z","updatedAt":"2026-07-01T10:15:00.000Z"}
   */
  async createDocument(name, content) {
    const logTag = '[createDocument]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/documents`,
      method: 'post',
      body: { name, content },
    })
  }

  /**
   * @operationName Get Document
   * @category Knowledge Documents
   * @description Retrieves a knowledge document by id, including its content and the avatars that use it.
   * @route GET /document
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document to fetch, from List Documents."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f1a2b3c4-1111-4222-8333-944455556666","name":"Product FAQ","type":"text","usedBy":[],"content":"Q: How do I reset my password?...","createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-06-01T09:00:00.000Z"}
   */
  async getDocument(documentId) {
    const logTag = '[getDocument]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/documents/${ encodeURIComponent(documentId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Document
   * @category Knowledge Documents
   * @description Updates a knowledge document's name or content. Only the provided fields are changed. Avatars using the document pick up the new content automatically.
   * @route PATCH /update-document
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document to update, from List Documents."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"A new display name."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New text content for the document."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f1a2b3c4-1111-4222-8333-944455556666","name":"Product FAQ v2","type":"text","usedBy":[],"content":"Q: How do I reset my password?...","createdAt":"2026-06-01T09:00:00.000Z","updatedAt":"2026-07-01T10:15:00.000Z"}
   */
  async updateDocument(documentId, name, content) {
    const logTag = '[updateDocument]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/documents/${ encodeURIComponent(documentId) }`,
      method: 'patch',
      body: clean({ name, content }),
    })
  }

  /**
   * @operationName Delete Document
   * @category Knowledge Documents
   * @description Permanently deletes a knowledge document. Avatars that referenced it stop using it.
   * @route DELETE /delete-document
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document to delete, from List Documents."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"f1a2b3c4-1111-4222-8333-944455556666"}
   */
  async deleteDocument(documentId) {
    const logTag = '[deleteDocument]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/documents/${ encodeURIComponent(documentId) }`,
      method: 'delete',
    })

    return { success: true, id: documentId }
  }

  // =========================================================================
  // Recipes
  // =========================================================================

  /**
   * @operationName Localize Ad Image
   * @category Recipes
   * @description Translates and re-renders the text in an ad image into another language while preserving the layout and design, using Runway's ad_localization recipe. Supports 22 target languages. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /localize-ad-image
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Reference Image URI","name":"referenceImageUri","required":true,"description":"The ad image to localize: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLanguage","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Arabic","Chinese (Simplified)","Chinese (Traditional)","Dutch","English","French","German","Hindi","Indonesian","Italian","Japanese","Korean","Polish","Portuguese","Russian","Spanish","Swedish","Thai","Turkish","Ukrainian","Vietnamese","Greek"]}},"description":"The language to translate the ad's text into."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable). Unsafe Latest uses the newest recipe, which may change without notice."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the localized image into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/localized.png?_jwt=abc"]}
   */
  async localizeAdImage(
    referenceImageUri, targetLanguage, version, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[localizeAdImage]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/ad_localization`,
      body: {
        version: this.#resolveRecipeVersion(version),
        referenceImage: { uri: referenceImageUri },
        targetLanguage: this.#resolveChoice(targetLanguage, AD_LOCALIZATION_LANGUAGES),
      },
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Create Marketing Stock Image
   * @category Recipes
   * @description Generates polished marketing-ready stock images from a prompt, optionally guided by a reference image, using Runway's marketing_stock_image recipe. Produces up to 4 variations per run. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /create-marketing-stock-image
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the marketing image to generate."}
   * @paramDef {"type":"String","label":"Reference Image URI","name":"referenceImageUri","description":"An optional image (HTTPS URL, data URI, or runway:// URI) to guide style and content."}
   * @paramDef {"type":"Number","label":"Output Count","name":"outputCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of image variations to generate. Defaults to 4."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Rendering quality of the generated images."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the generated images into FlowRunner file storage and return durable URLs in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"21f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/stock1.png?_jwt=abc","https://dnznrvs05pmza.cloudfront.net/stock2.png?_jwt=abc"]}
   */
  async createMarketingStockImage(
    prompt, referenceImageUri, outputCount, quality, version,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[createMarketingStockImage]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/marketing_stock_image`,
      body: clean({
        version: this.#resolveRecipeVersion(version),
        prompt,
        referenceImage: referenceImageUri ? { uri: referenceImageUri } : undefined,
        outputCount,
        quality: this.#resolveChoice(quality, { 'Low': 'low', 'Medium': 'medium', 'High': 'high' }),
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Create Product Ad Video
   * @category Recipes
   * @description Generates a product advertisement video from product photos using Runway's product_ad recipe, optionally guided by style images, product information, and a creative concept. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /create-product-ad-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"Array<String>","label":"Product Images","name":"productImages","required":true,"description":"URIs (HTTPS URL, data URI, or runway:// URI) of the product photos to feature."}
   * @paramDef {"type":"Array<String>","label":"Style Images","name":"styleImages","description":"Optional image URIs whose look and feel guide the ad's style."}
   * @paramDef {"type":"String","label":"Product Info","name":"productInfo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the product: what it is, key features, and selling points."}
   * @paramDef {"type":"String","label":"Creative Concept","name":"userConcept","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Your creative direction for the ad, e.g. tone, setting, or storyline."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","uiComponent":{"type":"DROPDOWN","options":{"values":["1280:720","720:1280","960:960","834:1112","1920:1080","1080:1920","1440:1440","1248:1664"]}},"description":"Output resolution as width:height pixels."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the ad in seconds."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true)."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","2026-07","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the ad video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"31f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/product_ad.mp4?_jwt=abc"]}
   */
  async createProductAdVideo(
    productImages, styleImages, productInfo, userConcept, ratio, duration, audio, version,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[createProductAdVideo]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/product_ad`,
      body: clean({
        version: this.#resolveRecipeVersion(version),
        productImages: (productImages || []).map(uri => ({ uri })),
        styleImages: Array.isArray(styleImages) && styleImages.length
          ? styleImages.map(uri => ({ uri }))
          : undefined,
        productInfo,
        userConcept,
        ratio,
        duration,
        audio,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Create Product Campaign Images
   * @category Recipes
   * @description Generates campaign-style marketing images featuring a product, based on a product photo and a creative prompt, using Runway's product_campaign_image recipe. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /create-product-campaign-images
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Product Image URI","name":"imageUri","required":true,"description":"The product photo to feature: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the campaign imagery to generate around the product."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the campaign images into FlowRunner file storage and return durable URLs in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"41f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/campaign.png?_jwt=abc"]}
   */
  async createProductCampaignImages(
    imageUri, prompt, version, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[createProductCampaignImages]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/product_campaign_image`,
      body: {
        version: this.#resolveRecipeVersion(version),
        image: { uri: imageUri },
        prompt,
      },
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Swap Product in Video
   * @category Recipes
   * @description Replaces a product shown in a reference video with a different product using Runway's product_swap recipe. Provide the original product image plus one or more images of the new product (front, side, or back views help accuracy). By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /swap-product-in-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Reference Video URI","name":"referenceVideoUri","required":true,"description":"The video containing the product to replace: an HTTPS URL, data URI, or runway:// upload URI."}
   * @paramDef {"type":"String","label":"Original Product Image URI","name":"originalProductImageUri","required":true,"description":"An image of the product as it appears in the reference video."}
   * @paramDef {"type":"Array<ProductImage>","label":"New Product Images","name":"newProductImages","required":true,"description":"Images of the replacement product. Each has a uri and an optional view (Front, Side, or Back)."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output video length in seconds."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p"]}},"description":"Output resolution."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Keep audio in the output video (default true)."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the output video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"51f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/swapped.mp4?_jwt=abc"]}
   */
  async swapProductInVideo(
    referenceVideoUri, originalProductImageUri, newProductImages, duration, resolution, audio,
    version, waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[swapProductInVideo]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/product_swap`,
      body: clean({
        version: this.#resolveRecipeVersion(version),
        referenceVideo: { uri: referenceVideoUri },
        originalProductImage: { uri: originalProductImageUri },
        newProductImages: (newProductImages || []).map(image => clean({
          uri: image.uri,
          view: this.#resolveChoice(image.view, { 'Front': 'front', 'Side': 'side', 'Back': 'back' }),
        })),
        duration,
        resolution: this.#resolveChoice(resolution, { '720p': '720p', '1080p': '1080p' }),
        audio,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Create Multi-Shot Video
   * @category Recipes
   * @description Generates a multi-shot video using Runway's multi_shot_video recipe. In Auto mode a single prompt is split into shots automatically; in Custom mode you define each shot's prompt and duration. Supports an optional first-frame image, aspect ratio, total duration (5, 10, or 15 seconds), and audio. By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /create-multi-shot-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Mode","name":"mode","required":true,"defaultValue":"Auto","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Custom"]}},"description":"Auto splits your prompt into shots automatically; Custom uses the Shots list you provide."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the full video. Required in Auto mode; ignored in Custom mode."}
   * @paramDef {"type":"Array<VideoShot>","label":"Shots","name":"shots","description":"The shot list for Custom mode. Each shot has a prompt and a duration in seconds. Required in Custom mode."}
   * @paramDef {"type":"String","label":"First Frame URI","name":"firstFrameUri","description":"An optional image (HTTPS URL, data URI, or runway:// URI) used as the video's first frame."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","uiComponent":{"type":"DROPDOWN","options":{"values":["1280:720","720:1280","960:960","1920:1080","1080:1920","1440:1440"]}},"description":"Output resolution as width:height pixels."}
   * @paramDef {"type":"String","label":"Duration","name":"duration","uiComponent":{"type":"DROPDOWN","options":{"values":["5 seconds","10 seconds","15 seconds"]}},"description":"Total video length."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true)."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the output video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"61f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/multishot.mp4?_jwt=abc"]}
   */
  async createMultiShotVideo(
    mode, prompt, shots, firstFrameUri, ratio, duration, audio, version,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[createMultiShotVideo]'
    const resolvedMode = this.#resolveChoice(mode, { 'Auto': 'auto', 'Custom': 'custom' }) || 'auto'

    if (resolvedMode === 'custom' && (!Array.isArray(shots) || !shots.length)) {
      throw new Error('Custom mode requires at least one shot in the Shots parameter.')
    }

    if (resolvedMode === 'auto' && !prompt) {
      throw new Error('Auto mode requires a Prompt.')
    }

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/multi_shot_video`,
      body: clean({
        version: this.#resolveRecipeVersion(version),
        mode: resolvedMode,
        prompt: resolvedMode === 'auto' ? prompt : undefined,
        shots: resolvedMode === 'custom'
          ? shots.map(shot => ({ prompt: shot.prompt, duration: shot.duration }))
          : undefined,
        firstFrame: firstFrameUri ? { uri: firstFrameUri } : undefined,
        ratio,
        duration: this.#resolveChoice(duration, { '5 seconds': 5, '10 seconds': 10, '15 seconds': 15 }),
        audio,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  /**
   * @operationName Create Product UGC Video
   * @category Recipes
   * @description Generates a user-generated-content style video where a character presents a product, using Runway's product_ugc recipe. Provide a character image and a product image, plus optional product information and creative direction. Output is vertical (720:1280 or 1080:1920). By default the action waits for the task and returns output URLs, which are ephemeral (24-48 hours) unless saved to file storage.
   * @route POST /create-product-ugc-video
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Character Image URI","name":"characterImageUri","required":true,"description":"An image of the person or character presenting the product: an HTTPS URL, data URI, or runway:// URI."}
   * @paramDef {"type":"String","label":"Product Image URI","name":"productImageUri","required":true,"description":"An image of the product being presented."}
   * @paramDef {"type":"String","label":"Product Info","name":"productInfo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the product: what it is, key features, and selling points."}
   * @paramDef {"type":"String","label":"Creative Concept","name":"userConcept","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Your creative direction for the video, e.g. tone, setting, or talking points."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Video length in seconds."}
   * @paramDef {"type":"String","label":"Ratio","name":"ratio","uiComponent":{"type":"DROPDOWN","options":{"values":["720:1280","1080:1920"]}},"description":"Output resolution as width:height pixels (vertical formats only)."}
   * @paramDef {"type":"Boolean","label":"Audio","name":"audio","uiComponent":{"type":"CHECKBOX"},"description":"Generate audio with the video (default true)."}
   * @paramDef {"type":"String","label":"Recipe Version","name":"version","uiComponent":{"type":"DROPDOWN","options":{"values":["2026-06","Unsafe Latest"]}},"description":"The recipe version to run. Defaults to 2026-06 (stable)."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the task until it finishes and return the completed task with output URLs (default). Disable to get the task id back immediately."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the output video into FlowRunner file storage and return a durable URL in savedFiles. Requires Wait for Completion."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"71f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/ugc.mp4?_jwt=abc"]}
   */
  async createProductUgcVideo(
    characterImageUri, productImageUri, productInfo, userConcept, duration, ratio, audio, version,
    waitForCompletion, saveOutputToFiles, fileOptions
  ) {
    const logTag = '[createProductUgcVideo]'

    return await this.#startGeneration({
      logTag,
      url: `${ API_BASE_URL }/v1/recipes/product_ugc`,
      body: clean({
        version: this.#resolveRecipeVersion(version),
        characterImage: { uri: characterImageUri },
        productImage: { uri: productImageUri },
        productInfo,
        userConcept,
        duration,
        ratio,
        audio,
      }),
      waitForCompletion,
      saveOutputToFiles,
      fileOptions,
    })
  }

  #resolveRecipeVersion(version) {
    return this.#resolveChoice(version, { 'Unsafe Latest': 'unsafe-latest' }) || '2026-06'
  }

  // =========================================================================
  // Tasks
  // =========================================================================

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves the current state of a generation task: PENDING, THROTTLED, RUNNING (with progress), SUCCEEDED (with output URLs), FAILED (with failure details), or CANCELLED. Output URLs are ephemeral and expire within 24-48 hours.
   * @route GET /task
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The id of the task, returned by any generation action."}
   *
   * @returns {Object}
   * @sampleResult {"id":"17f20503-6c24-4c16-946b-35dbbce2af2f","status":"RUNNING","createdAt":"2026-07-01T10:15:00.000Z","progress":0.62}
   */
  async getTask(taskId) {
    const logTag = '[getTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/tasks/${ encodeURIComponent(taskId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Wait for Task
   * @category Tasks
   * @description Polls a generation task until it reaches a terminal state (SUCCEEDED, FAILED, or CANCELLED) and returns the final task. Optionally copies the outputs of a succeeded task into FlowRunner file storage for durable URLs. Fails with the task's error details if the task fails.
   * @route GET /wait-for-task
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The id of the task to wait for, returned by any generation action."}
   * @paramDef {"type":"Boolean","label":"Save Output to File Storage","name":"saveOutputToFiles","uiComponent":{"type":"CHECKBOX"},"description":"Copy the succeeded task's outputs into FlowRunner file storage and return durable URLs in savedFiles."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"id":"17f20503-6c24-4c16-946b-35dbbce2af2f","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":["https://dnznrvs05pmza.cloudfront.net/video.mp4?_jwt=abc"],"savedFiles":["https://files.example.com/flow/runway_17f20503_0.mp4"]}
   */
  async waitForTask(taskId, saveOutputToFiles, fileOptions) {
    const logTag = '[waitForTask]'
    const task = await this.#pollTask(taskId, logTag)

    if (task.status === 'FAILED') {
      throw new Error(`Runway task ${ task.id } failed: ${ task.failure || 'unknown error' }` +
        (task.failureCode ? ` (code: ${ task.failureCode })` : ''))
    }

    if (saveOutputToFiles && task.status === 'SUCCEEDED') {
      task.savedFiles = await this.#saveTaskOutputs(task, fileOptions, logTag)
    }

    return task
  }

  /**
   * @operationName Cancel Task
   * @category Tasks
   * @description Cancels a pending or running generation task, or deletes a finished one. Cancelled tasks cannot be resumed.
   * @route DELETE /cancel-task
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The id of the task to cancel or delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"17f20503-6c24-4c16-946b-35dbbce2af2f"}
   */
  async cancelTask(taskId) {
    const logTag = '[cancelTask]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/tasks/${ encodeURIComponent(taskId) }`,
      method: 'delete',
    })

    return { success: true, id: taskId }
  }

  /**
   * @operationName Save Task Output to Files
   * @category Tasks
   * @description Downloads the outputs of a succeeded generation task and stores them in FlowRunner file storage, returning durable URLs. Use this to persist results before Runway's ephemeral output URLs expire (24-48 hours after completion). Fails if the task has not succeeded yet.
   * @route POST /save-task-output
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The id of a SUCCEEDED task whose outputs to save."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for saved output files. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"taskId":"17f20503-6c24-4c16-946b-35dbbce2af2f","savedFiles":["https://files.example.com/flow/runway_17f20503_0.mp4"]}
   */
  async saveTaskOutputToFiles(taskId, fileOptions) {
    const logTag = '[saveTaskOutputToFiles]'

    const task = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/tasks/${ encodeURIComponent(taskId) }`,
      method: 'get',
    })

    if (task.status !== 'SUCCEEDED') {
      throw new Error(
        `Task ${ taskId } has status ${ task.status }; outputs can only be saved once it has SUCCEEDED. ` +
        'Use Wait for Task to wait for completion.'
      )
    }

    const savedFiles = await this.#saveTaskOutputs(task, fileOptions, logTag)

    return { taskId, savedFiles }
  }

  // =========================================================================
  // Files
  // =========================================================================

  /**
   * @operationName Upload File to Runway
   * @category Files
   * @description Uploads a file to Runway's ephemeral upload storage and returns a runway:// URI that can be used anywhere a media URI is accepted (prompt images, videos, audio, references). Uploaded files must be 512 bytes to 200 MB, the filename extension must match the actual file type, and the returned URI is valid for 24 hours.
   * @route POST /upload-file
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The file to upload: a FlowRunner file or any downloadable URL."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Filename to register with Runway (3-255 characters); its extension must match the file type, e.g. photo.png. Defaults to the source file's name."}
   *
   * @returns {Object}
   * @sampleResult {"runwayUri":"runway://tokens.abc123","filename":"photo.png","sizeBytes":204800,"expiresIn":"24 hours"}
   */
  async uploadFileToRunway(fileUrl, filename) {
    const logTag = '[uploadFileToRunway]'
    const resolvedName = filename || decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || `upload_${ Date.now() }`

    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = this.#toBuffer(bytes)

    const upload = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/uploads`,
      method: 'post',
      body: { filename: resolvedName, type: 'ephemeral' },
    })

    try {
      // Presigned upload: post the storage provider's fields plus the file bytes
      // as multipart form data. No Runway auth headers on this request.
      const formData = new Flowrunner.Request.FormData()

      for (const [key, value] of Object.entries(upload.fields || {})) {
        formData.append(key, value)
      }

      formData.append('file', buffer, { filename: resolvedName })

      await Flowrunner.Request.post(upload.uploadUrl).form(formData)
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - presigned upload failed: ${ message }`)

      throw new Error(`Runway API error: file upload failed: ${ message }`)
    }

    return {
      runwayUri: upload.runwayUri,
      filename: resolvedName,
      sizeBytes: buffer.length,
      expiresIn: '24 hours',
    }
  }

  // =========================================================================
  // Workflows
  // =========================================================================

  /**
   * @operationName List Workflows
   * @category Workflows
   * @description Lists the published workflows in your Runway organization, grouped by workflow with their published versions (newest first). Use a version id with Run Workflow.
   * @route GET /workflows
   *
   * @returns {Object}
   * @sampleResult {"data":[{"name":"Product Shots Pipeline","versions":[{"id":"wf_123","version":3,"createdAt":"2026-06-15T12:00:00.000Z"}]}]}
   */
  async listWorkflows() {
    const logTag = '[listWorkflows]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Workflow
   * @category Workflows
   * @description Retrieves a published workflow version by id, including its name, description, version number, and node graph.
   * @route GET /workflow
   *
   * @paramDef {"type":"String","label":"Workflow","name":"workflowId","required":true,"dictionary":"getWorkflowsDictionary","description":"The published workflow version to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"wf_123","name":"Product Shots Pipeline","description":"Generates product shots from a source image","version":3,"createdAt":"2026-06-15T12:00:00.000Z","updatedAt":"2026-06-15T12:00:00.000Z","graph":{"nodes":[],"edges":[],"version":1}}
   */
  async getWorkflow(workflowId) {
    const logTag = '[getWorkflow]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows/${ encodeURIComponent(workflowId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Run Workflow
   * @category Workflows
   * @description Runs a published Runway workflow version, optionally overriding node outputs (for example to inject input images or text into specific nodes). By default the action waits for the invocation to finish and returns its final state with outputs; disable Wait for Completion to get the invocation id immediately and poll with Get Workflow Invocation.
   * @route POST /run-workflow
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Workflow","name":"workflowId","required":true,"dictionary":"getWorkflowsDictionary","description":"The published workflow version to run."}
   * @paramDef {"type":"Object","label":"Node Outputs","name":"nodeOutputs","description":"Optional overrides mapping node ids to their output values, used to feed inputs into the workflow."}
   * @paramDef {"type":"Boolean","label":"Wait for Completion","name":"waitForCompletion","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Poll the invocation until it finishes and return its final state (default). Disable to get the invocation id back immediately."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_456","status":"SUCCEEDED","createdAt":"2026-07-01T10:15:00.000Z","output":{"finalNode":["https://dnznrvs05pmza.cloudfront.net/result.png?_jwt=abc"]}}
   */
  async runWorkflow(workflowId, nodeOutputs, waitForCompletion) {
    const logTag = '[runWorkflow]'

    const started = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows/${ encodeURIComponent(workflowId) }`,
      method: 'post',
      body: clean({ nodeOutputs }),
    })

    if (waitForCompletion === false) {
      return { id: started.id, status: 'PENDING' }
    }

    const startedAt = Date.now()

    while (true) {
      const invocation = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/v1/workflow_invocations/${ encodeURIComponent(started.id) }`,
        method: 'get',
      })

      if (invocation.status === 'FAILED') {
        throw new Error(`Runway workflow invocation ${ started.id } failed: ${ invocation.failure || 'unknown error' }` +
          (invocation.failureCode ? ` (code: ${ invocation.failureCode })` : ''))
      }

      if (TERMINAL_TASK_STATUSES.includes(invocation.status)) {
        return invocation
      }

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(
          `Runway workflow invocation ${ started.id } did not finish within the polling window ` +
          `(status: ${ invocation.status }). Use Get Workflow Invocation to keep checking it.`
        )
      }

      await sleep(POLL_INTERVAL_MS)
    }
  }

  /**
   * @operationName Get Workflow Invocation
   * @category Workflows
   * @description Retrieves the current state of a workflow invocation: PENDING, THROTTLED, RUNNING (with progress and partial outputs), SUCCEEDED (with outputs), FAILED (with failure details and node errors), or CANCELLED.
   * @route GET /workflow-invocation
   *
   * @paramDef {"type":"String","label":"Invocation ID","name":"invocationId","required":true,"description":"The invocation id returned by Run Workflow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_456","status":"RUNNING","createdAt":"2026-07-01T10:15:00.000Z","progress":0.4,"output":{}}
   */
  async getWorkflowInvocation(invocationId) {
    const logTag = '[getWorkflowInvocation]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflow_invocations/${ encodeURIComponent(invocationId) }`,
      method: 'get',
    })
  }

  // =========================================================================
  // Account
  // =========================================================================

  /**
   * @operationName Get Organization Info
   * @category Account
   * @description Returns your Runway organization's current credit balance, tier limits (including maximum monthly credit spend and per-model limits), and current usage. Useful for checking remaining credits before starting expensive generations.
   * @route GET /organization
   *
   * @returns {Object}
   * @sampleResult {"creditBalance":12500,"tier":{"maxMonthlyCreditSpend":100000,"models":{"gen4.5":{"maxConcurrentGenerations":5,"maxDailyGenerations":500}}},"usage":{"models":{"gen4.5":{"dailyGenerations":12}}}}
   */
  async getOrganizationInfo() {
    const logTag = '[getOrganizationInfo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/organization`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Credit Usage
   * @category Account
   * @description Returns day-by-day credit usage for your Runway organization, broken down by model, over a date range of up to 90 days. Defaults to the last 30 days when no dates are provided.
   * @route GET /credit-usage
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Start of the reporting range, in YYYY-MM-DD format (UTC). Defaults to 30 days ago."}
   * @paramDef {"type":"String","label":"Before Date","name":"beforeDate","description":"Exclusive end of the reporting range, in YYYY-MM-DD format (UTC). Must be at most 90 days after the start date."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"date":"2026-07-01","usedCredits":[{"model":"gen4.5","amount":250}]}],"models":["gen4.5"]}
   */
  async getCreditUsage(startDate, beforeDate) {
    const logTag = '[getCreditUsage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/organization/usage`,
      method: 'post',
      body: clean({ startDate, beforeDate }),
    })
  }

  // =========================================================================
  // Dictionaries
  // =========================================================================

  /**
   * @typedef {Object} getImageRatiosDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The selected image model (label or API id) whose supported ratios to list."}
   */

  /**
   * @typedef {Object} getImageRatiosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over the ratio values."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. All ratios fit in one page, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getImageRatiosDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The selected model whose ratios to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Image Ratios Dictionary
   * @description Lists the output ratios supported by the selected image model for the Generate Image action.
   * @route POST /image-ratios-dictionary
   * @paramDef {"type":"getImageRatiosDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected model."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"1920:1080","value":"1920:1080","note":"1920 x 1080 px"}],"cursor":null}
   */
  async getImageRatiosDictionary(payload) {
    return this.#ratioDictionaryItems(payload, 'textToImage', IMAGE_MODELS)
  }

  /**
   * @typedef {Object} getImageToVideoRatiosDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The selected video model (label or API id) whose supported ratios to list."}
   */

  /**
   * @typedef {Object} getImageToVideoRatiosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over the ratio values."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. All ratios fit in one page, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getImageToVideoRatiosDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The selected model whose ratios to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Image to Video Ratios Dictionary
   * @description Lists the output ratios supported by the selected model for the Image to Video action.
   * @route POST /image-to-video-ratios-dictionary
   * @paramDef {"type":"getImageToVideoRatiosDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected model."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"1280:720","value":"1280:720","note":"1280 x 720 px"}],"cursor":null}
   */
  async getImageToVideoRatiosDictionary(payload) {
    return this.#ratioDictionaryItems(payload, 'imageToVideo', IMAGE_TO_VIDEO_MODELS)
  }

  /**
   * @typedef {Object} getTextToVideoRatiosDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The selected video model (label or API id) whose supported ratios to list."}
   */

  /**
   * @typedef {Object} getTextToVideoRatiosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over the ratio values."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. All ratios fit in one page, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getTextToVideoRatiosDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The selected model whose ratios to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Text to Video Ratios Dictionary
   * @description Lists the output ratios supported by the selected model for the Text to Video action.
   * @route POST /text-to-video-ratios-dictionary
   * @paramDef {"type":"getTextToVideoRatiosDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected model."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"1280:720","value":"1280:720","note":"1280 x 720 px"}],"cursor":null}
   */
  async getTextToVideoRatiosDictionary(payload) {
    return this.#ratioDictionaryItems(payload, 'textToVideo', TEXT_TO_VIDEO_MODELS)
  }

  /**
   * @typedef {Object} getVideoToVideoRatiosDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The selected video model (label or API id) whose supported ratios to list."}
   */

  /**
   * @typedef {Object} getVideoToVideoRatiosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over the ratio values."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. All ratios fit in one page, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getVideoToVideoRatiosDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The selected model whose ratios to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Video to Video Ratios Dictionary
   * @description Lists the output ratios supported by the selected model for the Video to Video action. Aleph 2 has no fixed ratio list (use Target Aspect Ratio instead), so it returns no options.
   * @route POST /video-to-video-ratios-dictionary
   * @paramDef {"type":"getVideoToVideoRatiosDictionary__payload","label":"Payload","name":"payload","description":"Search text and the selected model."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"1280:720","value":"1280:720","note":"1280 x 720 px"}],"cursor":null}
   */
  async getVideoToVideoRatiosDictionary(payload) {
    return this.#ratioDictionaryItems(payload, 'videoToVideo', VIDEO_TO_VIDEO_MODELS)
  }

  /**
   * @typedef {Object} getAvatarsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over avatar names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Avatars Dictionary
   * @description Lists your organization's custom avatars for selection in avatar-related actions. The option value is the avatar id.
   * @route POST /avatars-dictionary
   * @paramDef {"type":"getAvatarsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support Agent","value":"c1d2e3f4-1111-4222-8333-944455556666","note":"READY"}],"cursor":null}
   */
  async getAvatarsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getAvatarsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/avatars`,
      method: 'get',
      query: { limit: DEFAULT_LIST_LIMIT, cursor },
    })

    let avatars = response.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      avatars = avatars.filter(avatar => (avatar.name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: avatars.map(avatar => ({
        label: avatar.name || avatar.id,
        value: avatar.id,
        note: avatar.status || undefined,
      })),
      cursor: response.nextCursor || null,
    }
  }

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over voice names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Custom Voices Dictionary
   * @description Lists your organization's custom voices for selection in voice and avatar actions. The option value is the voice id.
   * @route POST /voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Narrator","value":"e1f2a3b4-1111-4222-8333-944455556666","note":"READY"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getVoicesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/voices`,
      method: 'get',
      query: { limit: DEFAULT_LIST_LIMIT, cursor },
    })

    let voices = response.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      voices = voices.filter(voice => (voice.name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: voices.map(voice => ({
        label: voice.name || voice.id,
        value: voice.id,
        note: voice.status || undefined,
      })),
      cursor: response.nextCursor || null,
    }
  }

  /**
   * @typedef {Object} getWorkflowsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter over workflow names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Workflows are returned in one page, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Workflows Dictionary
   * @description Lists your organization's published workflow versions for selection in workflow actions. The option value is the workflow version id.
   * @route POST /workflows-dictionary
   * @paramDef {"type":"getWorkflowsDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter workflows by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Shots Pipeline (v3)","value":"wf_123","note":"Latest version"}],"cursor":null}
   */
  async getWorkflowsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getWorkflowsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v1/workflows`,
      method: 'get',
    })

    const items = []

    for (const workflow of response.data || []) {
      if (search && !(workflow.name || '').toLowerCase().includes(search.toLowerCase())) {
        continue
      }

      const versions = workflow.versions || []

      versions.forEach((version, index) => {
        items.push({
          label: `${ workflow.name } (v${ version.version ?? version.id })`,
          value: version.id,
          note: index === 0 ? 'Latest version' : undefined,
        })
      })
    }

    return { items, cursor: null }
  }

  #ratioDictionaryItems(payload, operation, modelMap) {
    const { search, criteria } = payload || {}
    const model = this.#resolveChoice(criteria?.model, modelMap)
    let ratios = (RATIOS[operation] || {})[model] || []

    if (search) {
      ratios = ratios.filter(ratio => ratio.includes(search))
    }

    return {
      items: ratios.map(ratio => ({
        label: ratio,
        value: ratio,
        note: ratio.includes(':') && !ratio.startsWith('auto') ? `${ ratio.replace(':', ' x ') } px` : undefined,
      })),
      cursor: null,
    }
  }
}

/**
 * @typedef {Object} ReferenceImage
 * @paramDef {"type":"String","label":"URI","name":"uri","required":true,"description":"The reference image: an HTTPS URL, data URI, or runway:// upload URI."}
 * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Optional tag name (3-16 letters or numbers, starting with a letter) to reference this image in the prompt as @tag."}
 */

/**
 * @typedef {Object} VideoKeyframe
 * @paramDef {"type":"String","label":"Image URI","name":"uri","required":true,"description":"The keyframe image: an HTTPS URL, data URI, or runway:// upload URI."}
 * @paramDef {"type":"Number","label":"Seconds","name":"seconds","required":true,"description":"The timestamp in the source video (in seconds) where this keyframe applies."}
 */

/**
 * @typedef {Object} ProductImage
 * @paramDef {"type":"String","label":"URI","name":"uri","required":true,"description":"The product image: an HTTPS URL, data URI, or runway:// upload URI."}
 * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["Front","Side","Back"]}},"description":"Which side of the product this image shows."}
 */

/**
 * @typedef {Object} VideoShot
 * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"description":"A description of this shot."}
 * @paramDef {"type":"Number","label":"Duration","name":"duration","required":true,"description":"The shot's length in seconds."}
 */

Flowrunner.ServerCode.addService(RunwayService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Runway API key (sent as a Bearer token). Create one in the Runway developer portal at https://dev.runwayml.com',
  },
])
