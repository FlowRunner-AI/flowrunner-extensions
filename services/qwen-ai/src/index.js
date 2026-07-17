'use strict'

const REGION_BASE_URLS = {
  'International': 'https://dashscope-intl.aliyuncs.com',
  'China (Beijing)': 'https://dashscope.aliyuncs.com',
}

const DEFAULT_CHAT_MODEL = 'qwen-plus'
const DEFAULT_VISION_MODEL = 'qwen-vl-max'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4'
const DEFAULT_IMAGE_MODEL = 'wan2.2-t2i-flash'
const DEFAULT_VIDEO_MODEL = 'wan2.2-t2v-plus'
const DEFAULT_TTS_MODEL = 'qwen3-tts-flash'
const DEFAULT_ASR_MODEL = 'qwen3-asr-flash'

const TASK_POLL_INTERVAL_MS = 5000
const TASK_POLL_MAX_ATTEMPTS = 54

const CHAT_MODELS_FALLBACK = [
  { id: 'qwen-max', note: 'Flagship — best for complex, multi-step tasks' },
  { id: 'qwen-plus', note: 'Balanced performance, speed and cost' },
  { id: 'qwen-flash', note: 'Fastest and most cost-effective' },
  { id: 'qwen-turbo', note: 'Fast and low-cost' },
  { id: 'qwen3-max', note: 'Latest Qwen3 flagship' },
  { id: 'qwen-long', note: 'Long-context document processing' },
]

const VISION_MODELS = [
  { id: 'qwen-vl-max', note: 'Most capable vision-language model' },
  { id: 'qwen-vl-plus', note: 'Balanced vision-language model' },
  { id: 'qwen3-vl-plus', note: 'Qwen3 vision-language, high capability' },
  { id: 'qwen3-vl-flash', note: 'Qwen3 vision-language, fast and low-cost' },
]

const EMBEDDING_MODELS = [
  { id: 'text-embedding-v4', note: 'Qwen3-Embedding — dimensions 64 to 2048, default 1024' },
  { id: 'text-embedding-v3', note: 'Dimensions 512, 768 or 1024, default 1024' },
]

const IMAGE_MODELS = [
  { id: 'wan2.2-t2i-flash', note: 'Fast text-to-image, good quality' },
  { id: 'wan2.2-t2i-plus', note: 'High-detail text-to-image' },
  { id: 'wanx2.1-t2i-turbo', note: 'Wan 2.1 fast text-to-image' },
  { id: 'wanx2.1-t2i-plus', note: 'Wan 2.1 high-detail text-to-image' },
]

const VIDEO_MODELS = [
  { id: 'wan2.5-t2v-preview', note: 'Latest preview — up to 1080P, supports audio' },
  { id: 'wan2.2-t2v-plus', note: 'Stable — 480P and 1080P output' },
  { id: 'wan2.1-t2v-turbo', note: 'Fast — 480P and 720P output' },
  { id: 'wan2.1-t2v-plus', note: 'High detail — 720P output' },
]

const QWEN3_TTS_VOICES = [
  { value: 'Cherry', note: 'Female — sunny, friendly and natural' },
  { value: 'Serena', note: 'Female — gentle young woman' },
  { value: 'Chelsie', note: 'Female — anime-style virtual voice' },
  { value: 'Ethan', note: 'Male — warm, energetic Mandarin speaker' },
  { value: 'Jennifer', note: 'Female — premium American English' },
  { value: 'Aiden', note: 'Male — casual American English' },
  { value: 'Ryan', note: 'Male — rhythmic, dramatic delivery' },
  { value: 'Katerina', note: 'Female — mature, rich rhythm' },
  { value: 'Elias', note: 'Male — academic storytelling tone' },
  { value: 'Nofish', note: 'Male — designer voice' },
  { value: 'Momo', note: 'Female — playful and mischievous' },
  { value: 'Vivian', note: 'Female — confident and cute' },
  { value: 'Maia', note: 'Female — intellectual and gentle' },
  { value: 'Bella', note: 'Female — bubbly and playful' },
  { value: 'Neil', note: 'Male — professional news anchor' },
  { value: 'Vincent', note: 'Male — raspy, smoky voice' },
  { value: 'Arthur', note: 'Male — earthy, weathered voice' },
  { value: 'Moon', note: 'Male — bold and handsome' },
  { value: 'Kai', note: 'Male — soothing, calm voice' },
  { value: 'Sonrisa', note: 'Female — cheerful Latin American Spanish' },
  { value: 'Bodega', note: 'Male — passionate Spanish' },
  { value: 'Sohee', note: 'Female — warm, expressive Korean' },
  { value: 'Alek', note: 'Male — Russian character voice' },
  { value: 'Dolce', note: 'Male — laid-back Italian' },
  { value: 'Emilien', note: 'Male — romantic French' },
  { value: 'Andre', note: 'Male — magnetic and steady' },
  { value: 'Dylan', note: 'Male — Beijing dialect' },
  { value: 'Jada', note: 'Female — Shanghai dialect' },
  { value: 'Sunny', note: 'Female — Sichuan dialect' },
  { value: 'Eric', note: 'Male — Sichuan dialect' },
  { value: 'Marcus', note: 'Male — Shaanxi dialect' },
  { value: 'Roy', note: 'Male — Southern Min (Taiwanese)' },
  { value: 'Peter', note: 'Male — Tianjin dialect' },
  { value: 'Rocky', note: 'Male — Cantonese' },
  { value: 'Kiki', note: 'Female — Cantonese' },
]

const QWEN_TTS_VOICES = [
  { value: 'Cherry', note: 'Female — sunny, friendly and natural' },
  { value: 'Serena', note: 'Female — gentle young woman' },
  { value: 'Ethan', note: 'Male — warm, energetic Mandarin speaker' },
  { value: 'Chelsie', note: 'Female — anime-style virtual voice' },
  { value: 'Dylan', note: 'Male — Beijing dialect' },
  { value: 'Jada', note: 'Female — Shanghai dialect' },
  { value: 'Sunny', note: 'Female — Sichuan dialect' },
]

const logger = {
  info: (...args) => console.log('[Qwen] info:', ...args),
  debug: (...args) => console.log('[Qwen] debug:', ...args),
  error: (...args) => console.log('[Qwen] error:', ...args),
  warn: (...args) => console.log('[Qwen] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Qwen
 * @integrationIcon /icon.png
 */
class QwenService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = REGION_BASE_URLS[config.region] || REGION_BASE_URLS['International']
  }

  async #apiRequest({ url, method = 'post', body, query, headers, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }`, ...(headers || {}) })

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  #applyChatOptions(body, { enableThinking, thinkingBudget, temperature, topP, maxTokens, stop, seed }) {
    if (enableThinking === 'Enabled') {
      body.enable_thinking = true
    } else if (enableThinking === 'Disabled') {
      body.enable_thinking = false
    }

    if (thinkingBudget) body.thinking_budget = thinkingBudget
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (maxTokens) body.max_tokens = maxTokens
    if (stop?.length) body.stop = stop
    if (seed !== undefined && seed !== null) body.seed = seed

    return body
  }

  async #waitForTask(taskId, logTag) {
    for (let attempt = 1; attempt <= TASK_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL_MS))

      const response = await this.#apiRequest({
        url: `${ this.baseUrl }/api/v1/tasks/${ taskId }`,
        method: 'get',
        logTag,
      })

      const status = response.output?.task_status

      logger.debug(`${ logTag } - task ${ taskId } status: ${ status } (attempt ${ attempt })`)

      if (status === 'SUCCEEDED') {
        return response
      }

      if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
        const details = response.output?.message || response.output?.code || 'no details provided'

        throw new Error(`Task ${ taskId } ended with status ${ status }: ${ details }`)
      }
    }

    throw new Error(`Task ${ taskId } did not complete within the polling window. Use the "Get Task Status" action to retrieve the result once it finishes.`)
  }

  async #downloadBinary(url, logTag) {
    try {
      const bytes = await Flowrunner.Request.get(url).setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      logger.error(`${ logTag } - failed to download generated media: ${ error.message }`)

      throw new Error(`Failed to download generated media from Qwen result URL: ${ error.message }`)
    }
  }

  async #saveToFiles(buffer, filename, fileOptions) {
    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return url
  }

  #fileExtensionFromUrl(url, fallback) {
    const path = String(url || '').split('?')[0]
    const match = path.match(/\.([a-zA-Z0-9]{2,5})$/)

    return match ? match[1].toLowerCase() : fallback
  }

  // =======================================  DICTIONARIES =======================================

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the model list is returned in full."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable list of text-generation models available through the Model Studio API. Fetches the live model list from the OpenAI-compatible models endpoint and falls back to a built-in catalog of current Qwen models (qwen-max, qwen-plus, qwen-flash, qwen-turbo, qwen3-max, qwen-long) if the live list is unavailable.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"qwen-max","value":"qwen-max","note":"system"},{"label":"qwen-plus","value":"qwen-plus","note":"system"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    const { search } = payload || {}

    let items

    try {
      const response = await this.#apiRequest({
        url: `${ this.baseUrl }/compatible-mode/v1/models`,
        method: 'get',
        logTag: 'getChatModelsDictionary',
      })

      items = (response.data || [])
        .map(model => ({ label: model.id, value: model.id, note: model.owned_by || null }))
        .sort((a, b) => a.label.localeCompare(b.label))
    } catch (error) {
      logger.warn(`getChatModelsDictionary - live model list unavailable (${ error.message }), using built-in catalog`)

      items = CHAT_MODELS_FALLBACK.map(model => ({ label: model.id, value: model.id, note: model.note }))
    }

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getVisionModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the model list is returned in full."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vision Models Dictionary
   * @description Provides the catalog of Qwen vision-language (Qwen-VL) models that accept image inputs, such as qwen-vl-max, qwen-vl-plus, qwen3-vl-plus and qwen3-vl-flash.
   * @route POST /get-vision-models-dictionary
   * @paramDef {"type":"getVisionModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"qwen-vl-max","value":"qwen-vl-max","note":"Most capable vision-language model"}],"cursor":null}
   */
  async getVisionModelsDictionary(payload) {
    return this.#staticModelDictionary(VISION_MODELS, payload)
  }

  /**
   * @typedef {Object} getEmbeddingModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the model list is returned in full."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embedding Models Dictionary
   * @description Provides the catalog of text embedding models (text-embedding-v4 and text-embedding-v3) with notes about supported output dimensions.
   * @route POST /get-embedding-models-dictionary
   * @paramDef {"type":"getEmbeddingModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"text-embedding-v4","value":"text-embedding-v4","note":"Qwen3-Embedding — dimensions 64 to 2048, default 1024"}],"cursor":null}
   */
  async getEmbeddingModelsDictionary(payload) {
    return this.#staticModelDictionary(EMBEDDING_MODELS, payload)
  }

  /**
   * @typedef {Object} getImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the model list is returned in full."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Image Models Dictionary
   * @description Provides the catalog of Wan text-to-image models (wan2.2-t2i-flash, wan2.2-t2i-plus, wanx2.1-t2i-turbo, wanx2.1-t2i-plus) usable with the image generation actions.
   * @route POST /get-image-models-dictionary
   * @paramDef {"type":"getImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"wan2.2-t2i-flash","value":"wan2.2-t2i-flash","note":"Fast text-to-image, good quality"}],"cursor":null}
   */
  async getImageModelsDictionary(payload) {
    return this.#staticModelDictionary(IMAGE_MODELS, payload)
  }

  /**
   * @typedef {Object} getVideoModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the model list is returned in full."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Models Dictionary
   * @description Provides the catalog of Wan text-to-video models (wan2.5-t2v-preview, wan2.2-t2v-plus, wan2.1-t2v-turbo, wan2.1-t2v-plus) usable with the Create Video Task action.
   * @route POST /get-video-models-dictionary
   * @paramDef {"type":"getVideoModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"wan2.2-t2v-plus","value":"wan2.2-t2v-plus","note":"Stable — 480P and 1080P output"}],"cursor":null}
   */
  async getVideoModelsDictionary(payload) {
    return this.#staticModelDictionary(VIDEO_MODELS, payload)
  }

  async #staticModelDictionary(catalog, payload) {
    const { search } = payload || {}

    let items = catalog.map(model => ({ label: model.id, value: model.id, note: model.note }))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getVoicesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The speech synthesis model for which to list supported voices."}
   */

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter voices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the voice list is returned in full."}
   * @paramDef {"type":"getVoicesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Identifies the selected speech synthesis model."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Voices Dictionary
   * @description Provides the list of built-in voices supported by the selected speech synthesis model. qwen3-tts-flash offers a large multilingual roster including regional Chinese dialects; the legacy qwen-tts model supports a smaller core set (Cherry, Serena, Ethan, Chelsie plus Beijing, Shanghai and Sichuan dialect voices).
   * @route POST /get-voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains the selected model and an optional search string."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Cherry","value":"Cherry","note":"Female — sunny, friendly and natural"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search, criteria } = payload || {}
    const model = criteria?.model || DEFAULT_TTS_MODEL

    const catalog = model.startsWith('qwen3-tts') ? QWEN3_TTS_VOICES : QWEN_TTS_VOICES

    let items = catalog.map(voice => ({ label: voice.value, value: voice.value, note: voice.note }))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }

  // =======================================  CHAT  =======================================

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt using a Qwen model (qwen-max, qwen-plus, qwen-flash, qwen-turbo, qwen3-max and others) via the OpenAI-compatible chat completions API. Supports an optional system prompt, thinking mode with a thinking token budget for hybrid reasoning models, JSON mode for structured output, sampling controls and stop sequences. Returns the generated text, the model's reasoning content when thinking mode is active, the finish reason and token usage. Note: some Qwen3 hybrid models accept thinking mode only with streaming output — if the API rejects the request, leave Thinking Mode on Default or Disabled.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"qwen-plus","description":"The Qwen model to use. Defaults to 'qwen-plus'; use 'qwen-max' for the most capable model or 'qwen-flash' for speed and cost."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"String","label":"Thinking Mode","name":"enableThinking","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Enabled","Disabled"]}},"defaultValue":"Default","description":"Controls extended reasoning on hybrid Qwen3 models. 'Default' uses the model's own default, 'Enabled' requests thinking and returns reasoning content, 'Disabled' turns it off for faster, cheaper responses. Some models only support thinking with streaming output and will reject 'Enabled' on this non-streaming action."}
   * @paramDef {"type":"Number","label":"Thinking Budget","name":"thinkingBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may spend on reasoning when thinking mode is enabled."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature in the range [0, 2). Higher values produce more random output."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of completion tokens the model may generate."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON via response_format json_object. Your prompt should explicitly ask for JSON output and describe the desired structure."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer seed for reproducible sampling. Identical requests with the same seed aim to return the same result."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Qwen is a family of large language models developed by Alibaba Cloud.","reasoningContent":null,"model":"qwen-plus","finishReason":"stop","usage":{"prompt_tokens":24,"completion_tokens":18,"total_tokens":42}}
   */
  async chatCompletion(prompt, model, systemPrompt, enableThinking, thinkingBudget, temperature, topP, maxTokens, stop, jsonMode, seed) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = this.#applyChatOptions(
      { model: model || DEFAULT_CHAT_MODEL, messages },
      { enableThinking, thinkingBudget, temperature, topP, maxTokens, stop, seed }
    )

    if (jsonMode) body.response_format = { type: 'json_object' }

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/chat/completions`,
      body,
      logTag: 'chatCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      reasoningContent: choice?.message?.reasoning_content ?? null,
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request to the Model Studio OpenAI-compatible API with a complete messages array (multi-turn conversations with system, user, assistant and tool roles, including multimodal content parts for Qwen-VL), tool/function calling passthrough, a structured response format object, thinking mode and thinking budget controls, and sampling parameters. Returns the raw API response including choices, reasoning_content, tool calls and token usage — ideal for agent loops and function-calling workflows.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in OpenAI-compatible format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Supports system, user, assistant and tool roles, and multimodal content-part arrays for vision models."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"qwen-plus","description":"The Qwen model to use. Defaults to 'qwen-plus'."}
   * @paramDef {"type":"String","label":"Thinking Mode","name":"enableThinking","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Enabled","Disabled"]}},"defaultValue":"Default","description":"Controls extended reasoning on hybrid Qwen3 models. Some models only support thinking with streaming output and will reject 'Enabled' on this non-streaming action."}
   * @paramDef {"type":"Number","label":"Thinking Budget","name":"thinkingBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may spend on reasoning when thinking mode is enabled."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature in the range [0, 2)."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of completion tokens the model may generate."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} to force valid JSON or {\"type\":\"text\"} (default)."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalty between -2.0 and 2.0 applied to tokens that already appeared, encouraging the model to cover new topics."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer seed for reproducible sampling."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-9f2a4c1b","object":"chat.completion","created":1752741600,"model":"qwen-plus","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28}}
   */
  async chatCompletionAdvanced(messages, model, enableThinking, thinkingBudget, temperature, topP, maxTokens, stop, responseFormat, tools, toolChoice, presencePenalty, seed) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = this.#applyChatOptions(
      { model: model || DEFAULT_CHAT_MODEL, messages },
      { enableThinking, thinkingBudget, temperature, topP, maxTokens, stop, seed }
    )

    if (responseFormat) body.response_format = responseFormat
    if (tools?.length) body.tools = tools
    if (presencePenalty !== undefined && presencePenalty !== null) body.presence_penalty = presencePenalty

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  // =======================================  VISION  =======================================

  /**
   * @operationName Analyze Image
   * @description Analyzes one or more images with a Qwen vision-language model (qwen-vl-max, qwen-vl-plus, qwen3-vl-plus, qwen3-vl-flash) and answers a text prompt about them — describe scenes, extract text (OCR), compare images, identify objects or reason over charts and documents. Images are passed as public URLs or base64 data URLs (data:image/png;base64,...). Returns the model's answer, finish reason and token usage.
   * @category Vision
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image(s), e.g. 'Describe this image' or 'Extract all text from this receipt'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more image locations: public HTTPS URLs or base64 data URLs (data:image/png;base64,...). Supported formats include JPEG, PNG, WEBP and BMP."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVisionModelsDictionary","defaultValue":"qwen-vl-max","description":"The Qwen vision-language model to use. Defaults to 'qwen-vl-max'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, e.g. output language or response style."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature in the range [0, 2)."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of completion tokens the model may generate."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a wooden dock extending over a calm mountain lake at sunrise.","model":"qwen-vl-max","finishReason":"stop","usage":{"prompt_tokens":1264,"completion_tokens":21,"total_tokens":1285}}
   */
  async analyzeImage(prompt, imageUrls, model, systemPrompt, temperature, maxTokens) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    const content = imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))

    content.push({ type: 'text', text: prompt })

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] })
    }

    messages.push({ role: 'user', content })

    const body = { model: model || DEFAULT_VISION_MODEL, messages }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/chat/completions`,
      body,
      logTag: 'analyzeImage',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  // =======================================  EMBEDDINGS  =======================================

  /**
   * @operationName Create Embeddings
   * @description Generates vector embeddings for up to 10 texts (max 8,192 tokens each) using the text-embedding-v4 (Qwen3-Embedding) or text-embedding-v3 model via the OpenAI-compatible embeddings API. Supports configurable output dimensions — text-embedding-v4 allows 64, 128, 256, 512, 768, 1024 (default), 1536 or 2048; text-embedding-v3 allows 512, 768 or 1024 (default). Returns the embedding vectors in OpenAI format together with token usage.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"The texts to embed — up to 10 per request, each limited to 8,192 tokens."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getEmbeddingModelsDictionary","defaultValue":"text-embedding-v4","description":"The embedding model to use. Defaults to 'text-embedding-v4'."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output vector dimensions. text-embedding-v4 supports 64, 128, 256, 512, 768, 1024, 1536 and 2048; text-embedding-v3 supports 512, 768 and 1024. Defaults to 1024."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.0023,-0.0118,0.0341]}],"model":"text-embedding-v4","usage":{"prompt_tokens":6,"total_tokens":6}}
   */
  async createEmbeddings(texts, model, dimensions) {
    if (!texts?.length) {
      throw new Error('At least one text is required')
    }

    if (texts.length > 10) {
      throw new Error('A maximum of 10 texts can be embedded per request')
    }

    const body = {
      model: model || DEFAULT_EMBEDDING_MODEL,
      input: texts,
      encoding_format: 'float',
    }

    if (dimensions) body.dimensions = dimensions

    return this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/embeddings`,
      body,
      logTag: 'createEmbeddings',
    })
  }

  // =======================================  IMAGE GENERATION  =======================================

  /**
   * @operationName Generate Image
   * @description Generates images from a text prompt using a Wan text-to-image model (wan2.2-t2i-flash, wan2.2-t2i-plus, wanx2.1-t2i-turbo, wanx2.1-t2i-plus) and waits for completion — it submits an asynchronous DashScope task and polls until the images are ready (typically well under a minute). Because DashScope result URLs expire after 24 hours, the generated images are automatically saved to FlowRunner file storage and permanent file URLs are returned alongside the original result URLs. Supports negative prompts, custom sizes from 512 to 1440 pixels per side, 1-4 images per request, prompt extension and seed control.
   * @category Image Generation
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the image to generate, up to 800 characters. Be specific about subject, style, colors and composition."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"wan2.2-t2i-flash","description":"The Wan text-to-image model to use. Defaults to 'wan2.2-t2i-flash'; use 'wan2.2-t2i-plus' for higher detail."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Elements to exclude from the image, up to 500 characters, e.g. 'low quality, blurry, text'."}
   * @paramDef {"type":"String","label":"Size","name":"size","defaultValue":"1024*1024","description":"Output resolution as 'width*height'. Width and height must each be between 512 and 1440 pixels, e.g. '1024*1024', '1280*720' or '768*1344'."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"numberOfImages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate per request (1-4). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer seed in [0, 2147483647] for reproducible generation."}
   * @paramDef {"type":"Boolean","label":"Extend Prompt","name":"promptExtend","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), an LLM rewrites and enriches the prompt for better results. Disable for exact prompt control."}
   * @paramDef {"type":"Boolean","label":"Watermark","name":"watermark","uiComponent":{"type":"TOGGLE"},"description":"When enabled, adds an 'AI generated' watermark to the images. Disabled by default."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURLs":["https://files.example.com/qwen_image_1752741600_0.png"],"originalUrls":["https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/1d/ab/20260716/abc123/result0.png"],"taskId":"a1b2c3d4-5678-90ab-cdef-1234567890ab","imageCount":1,"usage":{"image_count":1}}
   */
  async generateImage(prompt, model, negativePrompt, size, numberOfImages, seed, promptExtend, watermark, fileOptions) {
    const { taskId } = await this.createImageTask(prompt, model, negativePrompt, size, numberOfImages, seed, promptExtend, watermark)

    const result = await this.#waitForTask(taskId, 'generateImage')

    const results = (result.output?.results || []).filter(item => item.url)

    if (!results.length) {
      throw new Error(`Image task ${ taskId } succeeded but returned no image URLs`)
    }

    const fileURLs = []
    const originalUrls = []
    const timestamp = Date.now()

    for (let i = 0; i < results.length; i++) {
      const sourceUrl = results[i].url
      const buffer = await this.#downloadBinary(sourceUrl, 'generateImage')
      const extension = this.#fileExtensionFromUrl(sourceUrl, 'png')

      const fileUrl = await this.#saveToFiles(buffer, `qwen_image_${ timestamp }_${ i }.${ extension }`, fileOptions)

      fileURLs.push(fileUrl)
      originalUrls.push(sourceUrl)
    }

    return {
      fileURLs,
      originalUrls,
      taskId,
      imageCount: fileURLs.length,
      usage: result.usage ?? null,
    }
  }

  /**
   * @operationName Create Image Task
   * @description Submits an asynchronous text-to-image generation task to DashScope using a Wan model and returns immediately with a task ID — use the Get Task Status action to poll for the result. Prefer this over Generate Image when you want non-blocking flows or custom polling logic. Task IDs remain queryable for 24 hours; result image URLs also expire after 24 hours, so download them promptly.
   * @category Image Generation
   * @route POST /create-image-task
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the image to generate, up to 800 characters."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"wan2.2-t2i-flash","description":"The Wan text-to-image model to use. Defaults to 'wan2.2-t2i-flash'."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Elements to exclude from the image, up to 500 characters."}
   * @paramDef {"type":"String","label":"Size","name":"size","defaultValue":"1024*1024","description":"Output resolution as 'width*height'. Width and height must each be between 512 and 1440 pixels."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"numberOfImages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate per request (1-4). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer seed in [0, 2147483647] for reproducible generation."}
   * @paramDef {"type":"Boolean","label":"Extend Prompt","name":"promptExtend","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), an LLM rewrites and enriches the prompt for better results."}
   * @paramDef {"type":"Boolean","label":"Watermark","name":"watermark","uiComponent":{"type":"TOGGLE"},"description":"When enabled, adds an 'AI generated' watermark to the images. Disabled by default."}
   *
   * @returns {Object}
   * @sampleResult {"taskId":"a1b2c3d4-5678-90ab-cdef-1234567890ab","taskStatus":"PENDING","requestId":"7574ee8f-38a3-4b1e-9280-11c33ab46e51"}
   */
  async createImageTask(prompt, model, negativePrompt, size, numberOfImages, seed, promptExtend, watermark) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const parameters = {}

    if (size) parameters.size = size
    if (typeof numberOfImages === 'number' && numberOfImages > 0) parameters.n = numberOfImages
    if (seed !== undefined && seed !== null) parameters.seed = seed
    if (promptExtend !== undefined && promptExtend !== null) parameters.prompt_extend = promptExtend
    if (watermark !== undefined && watermark !== null) parameters.watermark = watermark

    const body = {
      model: model || DEFAULT_IMAGE_MODEL,
      input: { prompt },
      parameters,
    }

    if (negativePrompt) body.input.negative_prompt = negativePrompt

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/api/v1/services/aigc/text2image/image-synthesis`,
      body,
      headers: { 'X-DashScope-Async': 'enable' },
      logTag: 'createImageTask',
    })

    return {
      taskId: response.output?.task_id ?? null,
      taskStatus: response.output?.task_status ?? null,
      requestId: response.request_id ?? null,
    }
  }

  // =======================================  VIDEO GENERATION  =======================================

  /**
   * @operationName Create Video Task
   * @description Submits an asynchronous text-to-video generation task to DashScope using a Wan model (wan2.5-t2v-preview, wan2.2-t2v-plus, wan2.1-t2v-turbo, wan2.1-t2v-plus) and returns immediately with a task ID. Video generation typically takes 1-5 minutes — poll with the Get Task Status action until the status is SUCCEEDED, then read the video_url from the output. Supports negative prompts, resolution selection, clip duration, prompt extension and seed control. Result video URLs and task IDs expire after 24 hours, so download the video promptly.
   * @category Video Generation
   * @route POST /create-video-task
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the video to generate, up to 1,500 characters. Describe subject, motion, camera work and style."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVideoModelsDictionary","defaultValue":"wan2.2-t2v-plus","description":"The Wan text-to-video model to use. Defaults to 'wan2.2-t2v-plus'."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Elements to exclude from the video, up to 500 characters."}
   * @paramDef {"type":"String","label":"Size","name":"size","defaultValue":"1280*720","description":"Output resolution as 'width*height'. Supported values vary by model — e.g. '1920*1080', '1080*1920' or '832*480' for wan2.2-t2v-plus, '1280*720' for wan2.1 models."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Video length in seconds. Most models support 5 seconds (default); wan2.5-t2v-preview also supports 10."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer seed in [0, 2147483647] for reproducible generation."}
   * @paramDef {"type":"Boolean","label":"Extend Prompt","name":"promptExtend","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), an LLM rewrites and enriches the prompt for better results."}
   * @paramDef {"type":"Boolean","label":"Watermark","name":"watermark","uiComponent":{"type":"TOGGLE"},"description":"When enabled, adds an 'AI generated' watermark to the video. Disabled by default."}
   *
   * @returns {Object}
   * @sampleResult {"taskId":"b2c3d4e5-6789-01bc-def0-234567890abc","taskStatus":"PENDING","requestId":"8685ff90-49b4-5c2f-a391-22d44bc57f62"}
   */
  async createVideoTask(prompt, model, negativePrompt, size, duration, seed, promptExtend, watermark) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const parameters = {}

    if (size) parameters.size = size
    if (duration) parameters.duration = duration
    if (seed !== undefined && seed !== null) parameters.seed = seed
    if (promptExtend !== undefined && promptExtend !== null) parameters.prompt_extend = promptExtend
    if (watermark !== undefined && watermark !== null) parameters.watermark = watermark

    const body = {
      model: model || DEFAULT_VIDEO_MODEL,
      input: { prompt },
      parameters,
    }

    if (negativePrompt) body.input.negative_prompt = negativePrompt

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/api/v1/services/aigc/video-generation/video-synthesis`,
      body,
      headers: { 'X-DashScope-Async': 'enable' },
      logTag: 'createVideoTask',
    })

    return {
      taskId: response.output?.task_id ?? null,
      taskStatus: response.output?.task_status ?? null,
      requestId: response.request_id ?? null,
    }
  }

  // =======================================  ASYNC TASKS  =======================================

  /**
   * @operationName Get Task Status
   * @description Retrieves the current status and result of an asynchronous DashScope task created by Create Image Task or Create Video Task. The task_status field is one of PENDING, RUNNING, SUCCEEDED, FAILED, CANCELED or UNKNOWN. On success, image tasks return output.results with image URLs and video tasks return output.video_url. Task IDs and result URLs are valid for 24 hours.
   * @category Async Tasks
   * @route GET /get-task-status
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The task ID returned by Create Image Task or Create Video Task."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"7574ee8f-38a3-4b1e-9280-11c33ab46e51","output":{"task_id":"a1b2c3d4-5678-90ab-cdef-1234567890ab","task_status":"SUCCEEDED","submit_time":"2026-07-16 10:00:00.000","end_time":"2026-07-16 10:00:21.000","results":[{"orig_prompt":"A watercolor fox in a forest","url":"https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/1d/ab/20260716/abc123/result0.png"}]},"usage":{"image_count":1}}
   */
  async getTaskStatus(taskId) {
    if (!taskId || !taskId.trim()) {
      throw new Error('Task ID is required')
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/api/v1/tasks/${ encodeURIComponent(taskId.trim()) }`,
      method: 'get',
      logTag: 'getTaskStatus',
    })
  }

  // =======================================  AUDIO  =======================================

  /**
   * @operationName Synthesize Speech
   * @description Converts text to natural speech using Qwen text-to-speech models. qwen3-tts-flash (default) supports 10+ languages, a large multilingual voice roster and Chinese regional dialects with up to 600 characters of input; the legacy qwen-tts model supports up to 512 tokens with a core voice set. Because DashScope audio URLs expire after 24 hours, the generated audio is automatically saved to FlowRunner file storage and a permanent file URL is returned alongside the original URL.
   * @category Audio
   * @route POST /synthesize-speech
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to synthesize. Supports mixed multilingual input — up to 600 characters for qwen3-tts models, up to 512 tokens for qwen-tts."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["qwen3-tts-flash","qwen3-tts-instruct-flash","qwen-tts"]}},"defaultValue":"qwen3-tts-flash","description":"The speech synthesis model. 'qwen3-tts-flash' (default) offers the widest language and voice coverage; 'qwen3-tts-instruct-flash' follows spoken-style instructions embedded in the text; 'qwen-tts' is the legacy model."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","dictionary":"getVoicesDictionary","dependsOn":["model"],"defaultValue":"Cherry","description":"The built-in voice to speak with. Available voices depend on the selected model — pick from the dictionary. Defaults to 'Cherry'."}
   * @paramDef {"type":"String","label":"Language Type","name":"languageType","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Chinese","English","German","Italian","Portuguese","Spanish","Japanese","Korean","French","Russian"]}},"defaultValue":"Auto","description":"The language of the input text. 'Auto' (default) detects the language automatically; setting it explicitly improves pronunciation accuracy. Only applies to qwen3-tts models."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://files.example.com/qwen_tts_1752741600.wav","sourceUrl":"https://dashscope-result-sgp.oss-ap-southeast-1.aliyuncs.com/tts/result.wav","expiresAt":1752828000,"model":"qwen3-tts-flash","usage":{"characters":42}}
   */
  async synthesizeSpeech(text, model, voice, languageType, fileOptions) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const resolvedModel = model || DEFAULT_TTS_MODEL

    const input = { text, voice: voice || 'Cherry' }

    if (languageType && resolvedModel.startsWith('qwen3-tts')) {
      input.language_type = languageType
    }

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/api/v1/services/aigc/multimodal-generation/generation`,
      body: { model: resolvedModel, input },
      logTag: 'synthesizeSpeech',
    })

    const audio = response.output?.audio

    if (!audio?.url) {
      throw new Error('Speech synthesis succeeded but no audio URL was returned')
    }

    const buffer = await this.#downloadBinary(audio.url, 'synthesizeSpeech')
    const extension = this.#fileExtensionFromUrl(audio.url, 'wav')
    const fileUrl = await this.#saveToFiles(buffer, `qwen_tts_${ Date.now() }.${ extension }`, fileOptions)

    return {
      fileUrl,
      sourceUrl: audio.url,
      expiresAt: audio.expires_at ?? null,
      model: resolvedModel,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Transcribe Audio
   * @description Transcribes speech to text using the qwen3-asr-flash multimodal recognition model via the OpenAI-compatible API. Accepts a public audio URL or a base64 data URL (data:audio/mpeg;base64,...) for common formats such as MP3, WAV, M4A and OPUS, and automatically detects the spoken language while also reporting detected emotion. Supports optional biasing context (domain terms, names), an explicit language hint for higher accuracy, and inverse text normalization for Chinese and English (formatting numbers, dates and amounts).
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Audio","name":"audio","required":true,"description":"The audio to transcribe: a public HTTPS URL or a base64 data URL (data:audio/mpeg;base64,...). Common formats such as MP3, WAV, M4A and OPUS are supported."}
   * @paramDef {"type":"String","label":"Model","name":"model","defaultValue":"qwen3-asr-flash","description":"The speech recognition model. Defaults to 'qwen3-asr-flash'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional language code of the audio (e.g. 'zh', 'en', 'ja') to improve recognition accuracy. Leave empty for automatic language detection."}
   * @paramDef {"type":"String","label":"Context","name":"context","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional biasing text — domain vocabulary, product names or speaker names — that steers recognition toward expected terms."}
   * @paramDef {"type":"Boolean","label":"Inverse Text Normalization","name":"enableItn","uiComponent":{"type":"TOGGLE"},"description":"When enabled, formats numbers, dates and amounts in the transcript (Chinese and English only). Disabled by default."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome to Alibaba Cloud Model Studio.","language":"en","emotion":"neutral","model":"qwen3-asr-flash","usage":{"seconds":4,"input_tokens":110,"output_tokens":12,"total_tokens":122}}
   */
  async transcribeAudio(audio, model, language, context, enableItn) {
    if (!audio || !audio.trim()) {
      throw new Error('Audio is required — provide a public URL or a base64 data URL')
    }

    const messages = []

    if (context) {
      messages.push({ role: 'system', content: [{ type: 'text', text: context }] })
    }

    messages.push({ role: 'user', content: [{ type: 'input_audio', input_audio: { data: audio } }] })

    const body = { model: model || DEFAULT_ASR_MODEL, messages }

    const asrOptions = {}

    if (language) asrOptions.language = language
    if (enableItn !== undefined && enableItn !== null) asrOptions.enable_itn = enableItn

    if (Object.keys(asrOptions).length) {
      body.asr_options = asrOptions
    }

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/chat/completions`,
      body,
      logTag: 'transcribeAudio',
    })

    const choice = response.choices?.[0]
    const annotations = choice?.message?.annotations || []
    const audioInfo = annotations.find(item => item.language || item.emotion) || {}

    return {
      text: choice?.message?.content ?? '',
      language: audioInfo.language ?? null,
      emotion: audioInfo.emotion ?? null,
      model: response.model,
      usage: response.usage ?? null,
    }
  }

  // =======================================  MODELS  =======================================

  /**
   * @operationName List Models
   * @description Lists all models available to your Model Studio API key through the OpenAI-compatible models endpoint, including chat, vision, embedding and audio models with their IDs and owning organization. Useful for discovering exact model IDs to use in other actions.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"qwen-max","object":"model","created":1752741600,"owned_by":"system"},{"id":"qwen-plus","object":"model","created":1752741600,"owned_by":"system"}]}
   */
  async listModels() {
    return this.#apiRequest({
      url: `${ this.baseUrl }/compatible-mode/v1/models`,
      method: 'get',
      logTag: 'listModels',
    })
  }
}

Flowrunner.ServerCode.addService(QwenService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Alibaba Cloud Model Studio API key. Keys are region-specific — create it in the console that matches the selected Region (International: modelstudio.console.alibabacloud.com, China: bailian.console.aliyun.com).',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    defaultValue: 'International',
    required: true,
    shared: false,
    options: ['International', 'China (Beijing)'],
    hint: 'The Model Studio deployment your API key belongs to. International uses dashscope-intl.aliyuncs.com (Singapore); China (Beijing) uses dashscope.aliyuncs.com.',
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    if (error.message.error?.message) {
      error.message = error.message.error.message
    } else if (error.message.message) {
      error.message = error.message.message
    } else {
      error.message = JSON.stringify(error.message)
    }
  }

  return error
}
