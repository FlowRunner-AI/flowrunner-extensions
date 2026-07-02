'use strict'

const API_BASE_URL = 'https://api.openai.com'

const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'
const DEFAULT_TTS_MODEL = 'tts-1'
const DEFAULT_TTS_VOICE = 'alloy'
const DEFAULT_TTS_RESPONSE_FORMAT = 'mp3'
const DEFAULT_TTS_SPEED = 1.0
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
const DEFAULT_TRANSCRIPTION_TEMPERATURE = 0
const DEFAULT_RESPONSES_MODEL = 'gpt-4o'

const logger = {
  info: (...args) => console.log('[OpenAI] info:', ...args),
  debug: (...args) => console.log('[OpenAI] debug:', ...args),
  error: (...args) => console.log('[OpenAI] error:', ...args),
  warn: (...args) => console.log('[OpenAI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName OpenAI
 * @integrationIcon /icon.svg
 */
class OpenAIService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, form, query, binary, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (form) {
        request.form(form)
      } else if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      const response = await request

      return binary && response?.body !== undefined ? response.body : response
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || 'audio'
  }

  async #getModelsDictionary(payload, filterFn) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      logTag: 'getModelsDictionary',
    })

    let models = (response.data || []).filter(model => filterFn(model.id))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.id.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({ label: model.id, value: model.id, note: model.id })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTtsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Models Dictionary
   * @description Provides a searchable, live list of OpenAI text-to-speech models for dynamic parameter selection.
   * @route POST /get-tts-models-dictionary
   * @paramDef {"type":"getTtsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o-mini-tts","value":"gpt-4o-mini-tts","note":"gpt-4o-mini-tts"},{"label":"tts-1","value":"tts-1","note":"tts-1"},{"label":"tts-1-hd","value":"tts-1-hd","note":"tts-1-hd"}],"cursor":null}
   */
  async getTtsModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /^tts-|-tts$/.test(id))
  }

  /**
   * @typedef {Object} getTranscriptionModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transcription Models Dictionary
   * @description Provides a searchable, live list of OpenAI speech-to-text models for dynamic parameter selection.
   * @route POST /get-transcription-models-dictionary
   * @paramDef {"type":"getTranscriptionModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o-transcribe","value":"gpt-4o-transcribe","note":"gpt-4o-transcribe"},{"label":"whisper-1","value":"whisper-1","note":"whisper-1"}],"cursor":null}
   */
  async getTranscriptionModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /whisper|transcribe/.test(id))
  }

  /**
   * @typedef {Object} getWebSearchModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Web Search Models Dictionary
   * @description Provides a searchable, live list of OpenAI models that support the Responses API web search tool.
   * @route POST /get-web-search-models-dictionary
   * @paramDef {"type":"getWebSearchModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o","value":"gpt-4o","note":"gpt-4o"},{"label":"gpt-4.1","value":"gpt-4.1","note":"gpt-4.1"}],"cursor":null}
   */
  async getWebSearchModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id =>
      /^(gpt-|o[134])/.test(id) &&
      !/tts|transcribe|whisper|embedding|moderation|dall-e|image|audio|realtime|computer-use/.test(id))
  }

  /**
   * @operationName Moderate Content
   * @description Analyzes text and image inputs for harmful content across multiple safety categories (harassment, hate speech, violence, sexual content, self-harm, and more) using OpenAI's Moderation API. Returns per-category flags and confidence scores for each input.
   * @route POST /moderate-content
   *
   * @paramDef {"type":"Array<String>","label":"Text Inputs","name":"textInputs","description":"List of text strings to check for policy violations."}
   * @paramDef {"type":"Array<String>","label":"Image Inputs","name":"imageInputs","description":"List of publicly accessible image URLs to check for policy violations."}
   *
   * @returns {Object}
   * @sampleResult {"flagged":true,"categories":{"harassment":true,"hate":true,"violence":true,"sexual":false,"self-harm":false},"category_scores":{"harassment":0.92,"hate":0.88,"violence":0.79,"sexual":0.12,"self-harm":0.0},"category_applied_input_types":{"harassment":["text"],"hate":["text"],"violence":["text"],"sexual":["text"],"self-harm":["text"]}}
   */
  async moderateContent(textInputs, imageInputs) {
    const input = [
      ...(textInputs || []).map(text => ({ type: 'text', text })),
      ...(imageInputs || []).map(url => ({ type: 'image_url', image_url: { url } })),
    ]

    if (!input.length) {
      throw new Error('At least one text or image input is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/moderations`,
      body: { model: DEFAULT_MODERATION_MODEL, input },
      logTag: 'moderateContent',
    })

    return response.results[0]
  }

  /**
   * @operationName Text to Speech
   * @description Converts text into natural-sounding speech audio using OpenAI's text-to-speech models. Uploads the generated audio file and returns its URL. The maximum allowed input length is 4096 characters.
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. Maximum length is 4096 characters."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTtsModelsDictionary","defaultValue":"tts-1","description":"The text-to-speech model to use. Defaults to 'tts-1'."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","uiComponent":{"type":"DROPDOWN","options":{"values":["alloy","ash","coral","echo","fable","onyx","nova","sage","shimmer"]}},"defaultValue":"alloy","description":"The voice to use for the generated audio. Defaults to 'alloy'."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["mp3","opus","aac","flac","wav","pcm"]}},"defaultValue":"mp3","description":"The audio file format of the output. Defaults to 'mp3'."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"The speed of the generated audio, between 0.25 and 4.0. Defaults to 1.0."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/result.mp3"}
   */
  async textToSpeech(input, model, voice, responseFormat, speed) {
    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    if (input.length > 4096) {
      throw new Error('The maximum allowed text length is 4096 characters')
    }

    const resolvedFormat = responseFormat || DEFAULT_TTS_RESPONSE_FORMAT

    const audioBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/audio/speech`,
      binary: true,
      body: {
        model: model || DEFAULT_TTS_MODEL,
        input,
        voice: voice || DEFAULT_TTS_VOICE,
        response_format: resolvedFormat,
        speed: speed || DEFAULT_TTS_SPEED,
      },
      logTag: 'textToSpeech',
    })

    const buffer = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `tts_${ Date.now() }.${ resolvedFormat }`,
      generateUrl: true,
      overwrite: true,
      scope: 'FLOW',
    })

    return { fileURL: url }
  }

  /**
   * @operationName Speech to Text
   * @description Transcribes an audio file into text using OpenAI's speech recognition models. Downloads the audio from the provided URL and returns the transcribed text.
   * @route POST /speech-to-text
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the audio file to transcribe. Must start with 'http://' or 'https://'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTranscriptionModelsDictionary","defaultValue":"gpt-4o-transcribe","description":"The transcription model to use. Defaults to 'gpt-4o-transcribe'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO-639-1 language code of the audio (e.g. 'en'). Improves accuracy and latency if known in advance."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text to guide the model's style or provide context, such as expected vocabulary or names."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Sampling temperature between 0 and 1. Defaults to 0 for deterministic output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review. Today, we'll discuss our growth strategy and key performance indicators."}
   */
  async speechToText(fileUrl, model, language, prompt, temperature) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`speechToText - downloading file from: ${ fileUrl }`)

    const rawFileBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const fileBuffer = Buffer.isBuffer(rawFileBytes) ? rawFileBytes : Buffer.from(rawFileBytes)

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl) })
    form.append('model', model || DEFAULT_TRANSCRIPTION_MODEL)
    form.append('response_format', 'text')
    form.append('temperature', String(temperature ?? DEFAULT_TRANSCRIPTION_TEMPERATURE))

    if (language) {
      form.append('language', language)
    }

    if (prompt) {
      form.append('prompt', prompt)
    }

    const text = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/audio/transcriptions`,
      form,
      logTag: 'speechToText',
    })

    return { text: typeof text === 'string' ? text : String(text) }
  }

  /**
   * @operationName Web Search
   * @description Generates a grounded answer to a prompt by letting the model search the web for current information. Returns the answer text along with cited source URLs.
   * @route POST /web-search
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to answer using current web search results."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getWebSearchModelsDictionary","defaultValue":"gpt-4o","description":"The model to use for the search-grounded response. Defaults to 'gpt-4o'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The current Node.js LTS release line is 22.x.","sources":[{"title":"Node.js Releases","url":"https://nodejs.org/en/about/previous-releases"}]}
   */
  async webSearch(prompt, model) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses`,
      body: {
        model: model || DEFAULT_RESPONSES_MODEL,
        input: prompt,
        tools: [{ type: 'web_search' }],
      },
      logTag: 'webSearch',
    })

    const message = (response.output || []).find(item => item.type === 'message')
    const textContent = (message?.content || []).find(item => item.type === 'output_text')

    const sources = (textContent?.annotations || [])
      .filter(annotation => annotation.type === 'url_citation')
      .map(annotation => ({ title: annotation.title, url: annotation.url }))

    return {
      text: textContent?.text || '',
      sources,
    }
  }
}

Flowrunner.ServerCode.addService(OpenAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OpenAI API key from https://platform.openai.com/api-keys',
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}
