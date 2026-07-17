const logger = {
  info: (...args) => console.log('[Deepgram] info:', ...args),
  debug: (...args) => console.log('[Deepgram] debug:', ...args),
  error: (...args) => console.log('[Deepgram] error:', ...args),
  warn: (...args) => console.log('[Deepgram] warn:', ...args),
}

const API_BASE_URL = 'https://api.deepgram.com/v1'

const DEFAULT_STT_MODEL = 'nova-3'
const DEFAULT_TTS_MODEL = 'aura-2-thalia-en'

const TTS_FILE_EXTENSIONS = {
  mp3: 'mp3',
  linear16: 'wav',
  flac: 'flac',
  opus: 'ogg',
  aac: 'aac',
  mulaw: 'wav',
  alaw: 'wav',
}

const USAGE_ENDPOINT_MAPPING = {
  'Speech to Text': 'listen',
  'Text to Speech': 'speak',
  'Text Intelligence': 'read',
  'Voice Agent': 'agent',
}

const USAGE_METHOD_MAPPING = {
  'Sync': 'sync',
  'Async': 'async',
  'Streaming': 'streaming',
}

const USAGE_DEPLOYMENT_MAPPING = {
  'Hosted': 'hosted',
  'Self-Hosted': 'self-hosted',
  'Beta': 'beta',
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
 * @usesFileStorage
 * @integrationName Deepgram
 * @integrationIcon /icon.png
 */
class DeepgramService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, headers, binary = false, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Token ${ this.apiKey }`, ...(headers || {}) })

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (query) {
        request = request.query(clean(query))
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.err_msg || error.body?.reason || error.body?.message ||
        (typeof error.body === 'string' && error.body ? error.body : error.message)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Deepgram API error: ${ message }`)
    }
  }

  async #downloadFile(url, logTag) {
    try {
      const bytes = await Flowrunner.Request.get(url).setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      logger.error(`${ logTag } - failed to download file from ${ url }: ${ error.message }`)

      throw new Error(`Failed to download source file: ${ error.message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #flag(value) {
    return value === true ? true : undefined
  }

  #toQueryString(params) {
    const qs = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') {
        continue
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== '') {
            qs.append(key, String(item))
          }
        }
      } else {
        qs.append(key, String(value))
      }
    }

    return qs.toString()
  }

  #buildTranscriptionQuery(options) {
    const modeMapping = { Extended: 'extended', Strict: 'strict' }
    const redactMapping = { 'PCI': 'pci', 'PII': 'pii', 'Numbers': 'numbers' }
    const callbackMethodMapping = { POST: 'post', PUT: 'put' }

    return {
      model: options.model || DEFAULT_STT_MODEL,
      language: options.language,
      detect_language: this.#flag(options.detectLanguage),
      smart_format: this.#flag(options.smartFormat),
      punctuate: this.#flag(options.punctuate),
      diarize: this.#flag(options.diarize),
      utterances: this.#flag(options.utterances),
      paragraphs: this.#flag(options.paragraphs),
      summarize: options.summarize === true ? 'v2' : undefined,
      topics: this.#flag(options.topics),
      custom_topic: options.customTopics,
      custom_topic_mode: options.customTopics?.length
        ? this.#resolveChoice(options.customTopicMode, modeMapping)
        : undefined,
      intents: this.#flag(options.intents),
      custom_intent: options.customIntents,
      custom_intent_mode: options.customIntents?.length
        ? this.#resolveChoice(options.customIntentMode, modeMapping)
        : undefined,
      sentiment: this.#flag(options.sentiment),
      detect_entities: this.#flag(options.detectEntities),
      redact: options.redact?.map(value => this.#resolveChoice(value, redactMapping)),
      keyterm: options.keyterms,
      keywords: options.keywords,
      profanity_filter: this.#flag(options.profanityFilter),
      filler_words: this.#flag(options.fillerWords),
      numerals: this.#flag(options.numerals),
      measurements: this.#flag(options.measurements),
      dictation: this.#flag(options.dictation),
      search: options.searchTerms,
      replace: options.replaceTerms,
      multichannel: this.#flag(options.multichannel),
      utt_split: options.uttSplit,
      tag: options.tag,
      callback: options.callbackUrl,
      callback_method: options.callbackUrl
        ? this.#resolveChoice(options.callbackMethod, callbackMethodMapping)
        : undefined,
    }
  }

  // ==================== Speech to Text ====================

  /**
   * @operationName Transcribe Audio from URL
   * @category Speech to Text
   * @description Transcribes pre-recorded audio hosted at a publicly accessible URL using Deepgram speech-to-text models (Nova-3, Nova-2, Enhanced, Base, Whisper Cloud). Supports smart formatting, punctuation, speaker diarization, utterances, paragraphs, summarization, topic/intent/sentiment/entity detection, redaction, keyterm prompting, word search and replacement. Returns the full transcription result with word-level timestamps and confidence scores. If a Callback URL is provided, Deepgram processes the audio asynchronously and only a request_id is returned; the full result is delivered to the callback URL.
   * @route POST /transcribe-audio-from-url
   * @appearanceColor #101820 #13EF95
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Audio URL","name":"audioUrl","required":true,"description":"Publicly accessible URL of the audio (or video) file to transcribe. Most common audio and video formats are supported (WAV, MP3, M4A, FLAC, OGG, MP4, and more)."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getSttModelsDictionary","description":"Deepgram model to use. Defaults to nova-3. Select from the dictionary or enter a model name such as nova-3, nova-2-medical, or whisper-large."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"BCP-47 language tag of the audio, e.g. en, en-US, es, fr, de. Use 'multi' with Nova-3 for multilingual code-switching audio. Defaults to en."}
   * @paramDef {"type":"Boolean","label":"Detect Language","name":"detectLanguage","uiComponent":{"type":"TOGGLE"},"description":"Identifies the dominant language of the audio and transcribes in that language. Overrides the Language parameter when enabled."}
   * @paramDef {"type":"Boolean","label":"Smart Format","name":"smartFormat","uiComponent":{"type":"TOGGLE"},"description":"Applies formatting to dates, times, numbers, currency, phone numbers, and more for improved readability. Also enables punctuation."}
   * @paramDef {"type":"Boolean","label":"Punctuate","name":"punctuate","uiComponent":{"type":"TOGGLE"},"description":"Adds punctuation and capitalization to the transcript."}
   * @paramDef {"type":"Boolean","label":"Diarize","name":"diarize","uiComponent":{"type":"TOGGLE"},"description":"Recognizes speaker changes and assigns a speaker number to each word in the transcript."}
   * @paramDef {"type":"Boolean","label":"Utterances","name":"utterances","uiComponent":{"type":"TOGGLE"},"description":"Segments speech into meaningful semantic units (utterances), each with its own timestamps, confidence, and speaker."}
   * @paramDef {"type":"Boolean","label":"Paragraphs","name":"paragraphs","uiComponent":{"type":"TOGGLE"},"description":"Splits the transcript into paragraphs at natural boundaries. Requires punctuation."}
   * @paramDef {"type":"Boolean","label":"Summarize","name":"summarize","uiComponent":{"type":"TOGGLE"},"description":"Generates a summary of the audio content (Deepgram summarization v2). The summary appears in results.summary."}
   * @paramDef {"type":"Boolean","label":"Detect Topics","name":"topics","uiComponent":{"type":"TOGGLE"},"description":"Detects topics discussed throughout the audio. Topic segments appear in results.topics."}
   * @paramDef {"type":"Array<String>","label":"Custom Topics","name":"customTopics","description":"Custom topics you want detected (up to 100). Used together with Detect Topics."}
   * @paramDef {"type":"String","label":"Custom Topic Mode","name":"customTopicMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom topics are interpreted. Extended returns detected topics in addition to your custom topics; Strict returns only topics from your custom list."}
   * @paramDef {"type":"Boolean","label":"Detect Intents","name":"intents","uiComponent":{"type":"TOGGLE"},"description":"Recognizes speaker intents throughout the audio. Intent segments appear in results.intents."}
   * @paramDef {"type":"Array<String>","label":"Custom Intents","name":"customIntents","description":"Custom intents you want detected. Used together with Detect Intents."}
   * @paramDef {"type":"String","label":"Custom Intent Mode","name":"customIntentMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom intents are interpreted. Extended returns detected intents in addition to your custom intents; Strict returns only intents from your custom list."}
   * @paramDef {"type":"Boolean","label":"Sentiment","name":"sentiment","uiComponent":{"type":"TOGGLE"},"description":"Analyzes sentiment throughout the audio. Sentiment segments and averages appear in results.sentiments."}
   * @paramDef {"type":"Boolean","label":"Detect Entities","name":"detectEntities","uiComponent":{"type":"TOGGLE"},"description":"Identifies entities such as names, locations, organizations, and account numbers in the transcript."}
   * @paramDef {"type":"Array<String>","label":"Redact","name":"redact","uiComponent":{"type":"DROPDOWN","options":{"values":["PCI","PII","Numbers"]}},"description":"Redacts sensitive information from the transcript: PCI (payment card data), PII (personally identifiable information), or Numbers (numeric sequences)."}
   * @paramDef {"type":"Array<String>","label":"Keyterms","name":"keyterms","description":"Key terms or phrases to boost recognition accuracy for (keyterm prompting). Nova-3 models only."}
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","description":"Uncommon keywords to boost, each optionally with an intensifier in the form word:boost (e.g. deepgram:2). For models older than Nova-3; use Keyterms with Nova-3."}
   * @paramDef {"type":"Boolean","label":"Profanity Filter","name":"profanityFilter","uiComponent":{"type":"TOGGLE"},"description":"Removes profanity from the transcript, replacing it with asterisks."}
   * @paramDef {"type":"Boolean","label":"Filler Words","name":"fillerWords","uiComponent":{"type":"TOGGLE"},"description":"Includes filler words such as 'uh' and 'um' in the transcript."}
   * @paramDef {"type":"Boolean","label":"Numerals","name":"numerals","uiComponent":{"type":"TOGGLE"},"description":"Converts numbers written out as words into digits (e.g. 'nine' becomes '9')."}
   * @paramDef {"type":"Boolean","label":"Measurements","name":"measurements","uiComponent":{"type":"TOGGLE"},"description":"Converts spoken measurement units into abbreviations (e.g. 'milligrams' becomes 'mg')."}
   * @paramDef {"type":"Boolean","label":"Dictation","name":"dictation","uiComponent":{"type":"TOGGLE"},"description":"Converts spoken dictation commands into punctuation (e.g. 'comma' becomes ','). Requires punctuation."}
   * @paramDef {"type":"Array<String>","label":"Search Terms","name":"searchTerms","description":"Terms or phrases to search for in the audio. Matches with timestamps and confidence appear in results.channels[].search."}
   * @paramDef {"type":"Array<String>","label":"Replace Terms","name":"replaceTerms","description":"Terms to find and replace in the transcript, each in the form find:replace (e.g. artificial intelligence:AI). Omit the replacement to delete the term."}
   * @paramDef {"type":"Boolean","label":"Multichannel","name":"multichannel","uiComponent":{"type":"TOGGLE"},"description":"Transcribes each audio channel independently. Useful for stereo call recordings with one speaker per channel."}
   * @paramDef {"type":"Number","label":"Utterance Split","name":"uttSplit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds of silence between words after which a new utterance starts. Used with Utterances. Default 0.8."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Label attached to the request for identification in usage reports."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for asynchronous processing. When set, the action returns a request_id immediately and Deepgram delivers the full transcription result to this URL when finished."}
   * @paramDef {"type":"String","label":"Callback Method","name":"callbackMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["POST","PUT"]}},"defaultValue":"POST","description":"HTTP method Deepgram uses to deliver the result to the Callback URL."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{"request_id":"5a7e1c3d-9b21-4c7e-8f7d-2f1a6b4e9c11","created":"2026-07-17T12:00:00.000Z","duration":25.93,"channels":1,"models":["c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11"]},"results":{"channels":[{"alternatives":[{"transcript":"Hello and welcome to the Deepgram demo.","confidence":0.9982,"words":[{"word":"hello","start":0.08,"end":0.48,"confidence":0.9987,"punctuated_word":"Hello"}]}]}]}}
   */
  async transcribeAudioFromUrl(
    audioUrl, model, language, detectLanguage, smartFormat, punctuate, diarize, utterances,
    paragraphs, summarize, topics, customTopics, customTopicMode, intents, customIntents,
    customIntentMode, sentiment, detectEntities, redact, keyterms, keywords, profanityFilter,
    fillerWords, numerals, measurements, dictation, searchTerms, replaceTerms, multichannel,
    uttSplit, tag, callbackUrl, callbackMethod
  ) {
    const logTag = '[transcribeAudioFromUrl]'

    const query = this.#buildTranscriptionQuery({
      model, language, detectLanguage, smartFormat, punctuate, diarize, utterances,
      paragraphs, summarize, topics, customTopics, customTopicMode, intents, customIntents,
      customIntentMode, sentiment, detectEntities, redact, keyterms, keywords, profanityFilter,
      fillerWords, numerals, measurements, dictation, searchTerms, replaceTerms, multichannel,
      uttSplit, tag, callbackUrl, callbackMethod,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/listen?${ this.#toQueryString(clean(query)) }`,
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: { url: audioUrl },
    })
  }

  /**
   * @operationName Transcribe Audio File
   * @category Speech to Text
   * @description Transcribes a pre-recorded audio file from FlowRunner file storage using Deepgram speech-to-text models. The file's bytes are downloaded and streamed to Deepgram as the request body, so the file does not need to be publicly accessible. Supports the same feature set as Transcribe Audio from URL: smart formatting, diarization, summarization, topic/intent/sentiment/entity detection, redaction, keyterm prompting, and more. If a Callback URL is provided, only a request_id is returned and the full result is delivered to the callback URL.
   * @route POST /transcribe-audio-file
   * @appearanceColor #101820 #13EF95
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Audio File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner audio (or video) file to transcribe (its URL). The file's bytes are downloaded and sent to Deepgram."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"MIME type of the audio file, e.g. audio/wav, audio/mpeg, audio/mp4. Optional - Deepgram detects most formats automatically when omitted."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getSttModelsDictionary","description":"Deepgram model to use. Defaults to nova-3. Select from the dictionary or enter a model name such as nova-3, nova-2-medical, or whisper-large."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"BCP-47 language tag of the audio, e.g. en, en-US, es, fr, de. Use 'multi' with Nova-3 for multilingual code-switching audio. Defaults to en."}
   * @paramDef {"type":"Boolean","label":"Detect Language","name":"detectLanguage","uiComponent":{"type":"TOGGLE"},"description":"Identifies the dominant language of the audio and transcribes in that language. Overrides the Language parameter when enabled."}
   * @paramDef {"type":"Boolean","label":"Smart Format","name":"smartFormat","uiComponent":{"type":"TOGGLE"},"description":"Applies formatting to dates, times, numbers, currency, phone numbers, and more for improved readability. Also enables punctuation."}
   * @paramDef {"type":"Boolean","label":"Punctuate","name":"punctuate","uiComponent":{"type":"TOGGLE"},"description":"Adds punctuation and capitalization to the transcript."}
   * @paramDef {"type":"Boolean","label":"Diarize","name":"diarize","uiComponent":{"type":"TOGGLE"},"description":"Recognizes speaker changes and assigns a speaker number to each word in the transcript."}
   * @paramDef {"type":"Boolean","label":"Utterances","name":"utterances","uiComponent":{"type":"TOGGLE"},"description":"Segments speech into meaningful semantic units (utterances), each with its own timestamps, confidence, and speaker."}
   * @paramDef {"type":"Boolean","label":"Paragraphs","name":"paragraphs","uiComponent":{"type":"TOGGLE"},"description":"Splits the transcript into paragraphs at natural boundaries. Requires punctuation."}
   * @paramDef {"type":"Boolean","label":"Summarize","name":"summarize","uiComponent":{"type":"TOGGLE"},"description":"Generates a summary of the audio content (Deepgram summarization v2). The summary appears in results.summary."}
   * @paramDef {"type":"Boolean","label":"Detect Topics","name":"topics","uiComponent":{"type":"TOGGLE"},"description":"Detects topics discussed throughout the audio. Topic segments appear in results.topics."}
   * @paramDef {"type":"Array<String>","label":"Custom Topics","name":"customTopics","description":"Custom topics you want detected (up to 100). Used together with Detect Topics."}
   * @paramDef {"type":"String","label":"Custom Topic Mode","name":"customTopicMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom topics are interpreted. Extended returns detected topics in addition to your custom topics; Strict returns only topics from your custom list."}
   * @paramDef {"type":"Boolean","label":"Detect Intents","name":"intents","uiComponent":{"type":"TOGGLE"},"description":"Recognizes speaker intents throughout the audio. Intent segments appear in results.intents."}
   * @paramDef {"type":"Array<String>","label":"Custom Intents","name":"customIntents","description":"Custom intents you want detected. Used together with Detect Intents."}
   * @paramDef {"type":"String","label":"Custom Intent Mode","name":"customIntentMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom intents are interpreted. Extended returns detected intents in addition to your custom intents; Strict returns only intents from your custom list."}
   * @paramDef {"type":"Boolean","label":"Sentiment","name":"sentiment","uiComponent":{"type":"TOGGLE"},"description":"Analyzes sentiment throughout the audio. Sentiment segments and averages appear in results.sentiments."}
   * @paramDef {"type":"Boolean","label":"Detect Entities","name":"detectEntities","uiComponent":{"type":"TOGGLE"},"description":"Identifies entities such as names, locations, organizations, and account numbers in the transcript."}
   * @paramDef {"type":"Array<String>","label":"Redact","name":"redact","uiComponent":{"type":"DROPDOWN","options":{"values":["PCI","PII","Numbers"]}},"description":"Redacts sensitive information from the transcript: PCI (payment card data), PII (personally identifiable information), or Numbers (numeric sequences)."}
   * @paramDef {"type":"Array<String>","label":"Keyterms","name":"keyterms","description":"Key terms or phrases to boost recognition accuracy for (keyterm prompting). Nova-3 models only."}
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","description":"Uncommon keywords to boost, each optionally with an intensifier in the form word:boost (e.g. deepgram:2). For models older than Nova-3; use Keyterms with Nova-3."}
   * @paramDef {"type":"Boolean","label":"Profanity Filter","name":"profanityFilter","uiComponent":{"type":"TOGGLE"},"description":"Removes profanity from the transcript, replacing it with asterisks."}
   * @paramDef {"type":"Boolean","label":"Filler Words","name":"fillerWords","uiComponent":{"type":"TOGGLE"},"description":"Includes filler words such as 'uh' and 'um' in the transcript."}
   * @paramDef {"type":"Boolean","label":"Numerals","name":"numerals","uiComponent":{"type":"TOGGLE"},"description":"Converts numbers written out as words into digits (e.g. 'nine' becomes '9')."}
   * @paramDef {"type":"Boolean","label":"Measurements","name":"measurements","uiComponent":{"type":"TOGGLE"},"description":"Converts spoken measurement units into abbreviations (e.g. 'milligrams' becomes 'mg')."}
   * @paramDef {"type":"Boolean","label":"Dictation","name":"dictation","uiComponent":{"type":"TOGGLE"},"description":"Converts spoken dictation commands into punctuation (e.g. 'comma' becomes ','). Requires punctuation."}
   * @paramDef {"type":"Array<String>","label":"Search Terms","name":"searchTerms","description":"Terms or phrases to search for in the audio. Matches with timestamps and confidence appear in results.channels[].search."}
   * @paramDef {"type":"Array<String>","label":"Replace Terms","name":"replaceTerms","description":"Terms to find and replace in the transcript, each in the form find:replace (e.g. artificial intelligence:AI). Omit the replacement to delete the term."}
   * @paramDef {"type":"Boolean","label":"Multichannel","name":"multichannel","uiComponent":{"type":"TOGGLE"},"description":"Transcribes each audio channel independently. Useful for stereo call recordings with one speaker per channel."}
   * @paramDef {"type":"Number","label":"Utterance Split","name":"uttSplit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds of silence between words after which a new utterance starts. Used with Utterances. Default 0.8."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Label attached to the request for identification in usage reports."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for asynchronous processing. When set, the action returns a request_id immediately and Deepgram delivers the full transcription result to this URL when finished."}
   * @paramDef {"type":"String","label":"Callback Method","name":"callbackMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["POST","PUT"]}},"defaultValue":"POST","description":"HTTP method Deepgram uses to deliver the result to the Callback URL."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{"request_id":"5a7e1c3d-9b21-4c7e-8f7d-2f1a6b4e9c11","created":"2026-07-17T12:00:00.000Z","duration":25.93,"channels":1,"models":["c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11"]},"results":{"channels":[{"alternatives":[{"transcript":"Hello and welcome to the Deepgram demo.","confidence":0.9982,"words":[{"word":"hello","start":0.08,"end":0.48,"confidence":0.9987,"punctuated_word":"Hello"}]}]}]}}
   */
  async transcribeAudioFile(
    fileUrl, contentType, model, language, detectLanguage, smartFormat, punctuate, diarize,
    utterances, paragraphs, summarize, topics, customTopics, customTopicMode, intents,
    customIntents, customIntentMode, sentiment, detectEntities, redact, keyterms, keywords,
    profanityFilter, fillerWords, numerals, measurements, dictation, searchTerms, replaceTerms,
    multichannel, uttSplit, tag, callbackUrl, callbackMethod
  ) {
    const logTag = '[transcribeAudioFile]'

    const audioBuffer = await this.#downloadFile(fileUrl, logTag)

    const query = this.#buildTranscriptionQuery({
      model, language, detectLanguage, smartFormat, punctuate, diarize, utterances,
      paragraphs, summarize, topics, customTopics, customTopicMode, intents, customIntents,
      customIntentMode, sentiment, detectEntities, redact, keyterms, keywords, profanityFilter,
      fillerWords, numerals, measurements, dictation, searchTerms, replaceTerms, multichannel,
      uttSplit, tag, callbackUrl, callbackMethod,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/listen?${ this.#toQueryString(clean(query)) }`,
      method: 'post',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: audioBuffer,
    })
  }

  // ==================== Text to Speech ====================

  /**
   * @operationName Convert Text to Speech
   * @category Text to Speech
   * @description Converts text into natural-sounding speech using Deepgram Aura voices. The generated audio is saved to FlowRunner file storage and the file URL is returned along with the voice model used and the billed character count. Text is limited to 2000 characters per request. If a Callback URL is provided, Deepgram generates the audio asynchronously, returns a request_id, and delivers the audio to the callback URL instead of saving it to file storage.
   * @route POST /text-to-speech
   * @appearanceColor #101820 #13EF95
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. Maximum 2000 characters per request."}
   * @paramDef {"type":"String","label":"Voice","name":"model","dictionary":"getTtsVoicesDictionary","description":"Aura voice model to use, e.g. aura-2-thalia-en. Defaults to aura-2-thalia-en. Select from the dictionary of available voices."}
   * @paramDef {"type":"String","label":"Encoding","name":"encoding","uiComponent":{"type":"DROPDOWN","options":{"values":["MP3","WAV (Linear16)","FLAC","Opus","AAC","Mu-law","A-law"]}},"defaultValue":"MP3","description":"Audio format of the generated speech. Defaults to MP3."}
   * @paramDef {"type":"Number","label":"Sample Rate","name":"sampleRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sample rate in Hz. Supported values depend on the encoding (e.g. 8000-48000 for Linear16, 8000 or 16000 for Mu-law/A-law). Leave empty for the encoding's default."}
   * @paramDef {"type":"Number","label":"Bit Rate","name":"bitRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Bitrate in bits per second for compressed formats (MP3 supports 32000 or 48000). Leave empty for the default."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for asynchronous generation. When set, the action returns a request_id immediately and Deepgram delivers the audio to this URL when finished."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flow/deepgram_tts_1752753600000.mp3","model":"aura-2-thalia-en","modelUuid":"9c2e9b26-6b3f-4a2b-b1f6-4a1c9e2d7f55","characterCount":83,"requestId":"1e9c7b2a-40d1-4b6e-8f0e-6a2d9c3b1e77","contentType":"audio/mpeg"}
   */
  async textToSpeech(text, model, encoding, sampleRate, bitRate, callbackUrl, fileOptions) {
    const logTag = '[textToSpeech]'

    const encodingMapping = {
      'MP3': 'mp3',
      'WAV (Linear16)': 'linear16',
      'FLAC': 'flac',
      'Opus': 'opus',
      'AAC': 'aac',
      'Mu-law': 'mulaw',
      'A-law': 'alaw',
    }

    const resolvedEncoding = this.#resolveChoice(encoding, encodingMapping) || 'mp3'

    const query = clean({
      model: model || DEFAULT_TTS_MODEL,
      encoding: resolvedEncoding,
      sample_rate: sampleRate,
      bit_rate: bitRate,
      callback: callbackUrl,
    })

    const url = `${ API_BASE_URL }/speak?${ this.#toQueryString(query) }`

    if (callbackUrl) {
      return await this.#apiRequest({
        logTag,
        url,
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: { text },
      })
    }

    const response = await this.#apiRequest({
      logTag,
      url,
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: { text },
      binary: true,
    })

    const audioBuffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)
    const responseHeaders = response.headers || {}
    const fileExtension = TTS_FILE_EXTENSIONS[resolvedEncoding] || 'mp3'

    const result = await this.flowrunner.Files.uploadFile(audioBuffer, {
      filename: `deepgram_tts_${ Date.now() }.${ fileExtension }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url: result.url,
      model: responseHeaders['dg-model-name'] || model || DEFAULT_TTS_MODEL,
      modelUuid: responseHeaders['dg-model-uuid'],
      characterCount: responseHeaders['dg-char-count'] ? Number(responseHeaders['dg-char-count']) : text.length,
      requestId: responseHeaders['dg-request-id'],
      contentType: responseHeaders['content-type'],
    }
  }

  // ==================== Text Intelligence ====================

  /**
   * @operationName Analyze Text
   * @category Text Intelligence
   * @description Analyzes written text with Deepgram Text Intelligence. Enable one or more analyses: summarization, topic detection (with optional custom topics), intent recognition (with optional custom intents), and sentiment analysis. Provide the text directly or as a URL to a hosted text file. Currently supports English text only. At least one analysis feature must be enabled. If a Callback URL is provided, the analysis runs asynchronously and only a request_id is returned.
   * @route POST /analyze-text
   * @appearanceColor #101820 #13EF95
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to analyze. Provide this or Source URL, not both."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","description":"Publicly accessible URL of a hosted text file to analyze. Provide this or Text, not both."}
   * @paramDef {"type":"Boolean","label":"Summarize","name":"summarize","uiComponent":{"type":"TOGGLE"},"description":"Generates a summary of the text. The summary appears in results.summary."}
   * @paramDef {"type":"Boolean","label":"Detect Topics","name":"topics","uiComponent":{"type":"TOGGLE"},"description":"Detects topics in the text with confidence scores. Topic segments appear in results.topics."}
   * @paramDef {"type":"Array<String>","label":"Custom Topics","name":"customTopics","description":"Custom topics you want detected (up to 100). Used together with Detect Topics."}
   * @paramDef {"type":"String","label":"Custom Topic Mode","name":"customTopicMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom topics are interpreted. Extended returns detected topics in addition to your custom topics; Strict returns only topics from your custom list."}
   * @paramDef {"type":"Boolean","label":"Detect Intents","name":"intents","uiComponent":{"type":"TOGGLE"},"description":"Recognizes intents in the text. Intent segments appear in results.intents."}
   * @paramDef {"type":"Array<String>","label":"Custom Intents","name":"customIntents","description":"Custom intents you want detected. Used together with Detect Intents."}
   * @paramDef {"type":"String","label":"Custom Intent Mode","name":"customIntentMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Extended","Strict"]}},"defaultValue":"Extended","description":"How custom intents are interpreted. Extended returns detected intents in addition to your custom intents; Strict returns only intents from your custom list."}
   * @paramDef {"type":"Boolean","label":"Sentiment","name":"sentiment","uiComponent":{"type":"TOGGLE"},"description":"Analyzes sentiment per text segment plus an overall average. Scores range from -1 (most negative) to 1 (most positive)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language of the text as a BCP-47 tag. Deepgram Text Intelligence currently supports English (en) only. Defaults to en."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Webhook URL for asynchronous processing. When set, the action returns a request_id immediately and Deepgram delivers the analysis result to this URL when finished."}
   * @paramDef {"type":"String","label":"Callback Method","name":"callbackMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["POST","PUT"]}},"defaultValue":"POST","description":"HTTP method Deepgram uses to deliver the result to the Callback URL."}
   *
   * @returns {Object}
   * @sampleResult {"metadata":{"request_id":"8d4f2a1b-6c3e-4f7a-9b0d-1e2f3a4b5c6d","created":"2026-07-17T12:00:00.000Z","language":"en","summary_info":{"model_uuid":"67875a7f-c9c4-48a0-aa55-5bdb8a91c34a","input_tokens":133,"output_tokens":57}},"results":{"summary":{"text":"The speaker reviews quarterly results and outlines the roadmap for the next release."},"sentiments":{"average":{"sentiment":"positive","sentiment_score":0.42}}}}
   */
  async analyzeText(
    text, sourceUrl, summarize, topics, customTopics, customTopicMode, intents, customIntents,
    customIntentMode, sentiment, language, callbackUrl, callbackMethod
  ) {
    const logTag = '[analyzeText]'

    if (!text && !sourceUrl) {
      throw new Error('Either Text or Source URL must be provided.')
    }

    if (text && sourceUrl) {
      throw new Error('Provide either Text or Source URL, not both.')
    }

    if (summarize !== true && topics !== true && intents !== true && sentiment !== true) {
      throw new Error('Enable at least one analysis feature: Summarize, Detect Topics, Detect Intents, or Sentiment.')
    }

    const modeMapping = { Extended: 'extended', Strict: 'strict' }
    const callbackMethodMapping = { POST: 'post', PUT: 'put' }

    const query = clean({
      summarize: this.#flag(summarize),
      topics: this.#flag(topics),
      custom_topic: customTopics,
      custom_topic_mode: customTopics?.length ? this.#resolveChoice(customTopicMode, modeMapping) : undefined,
      intents: this.#flag(intents),
      custom_intent: customIntents,
      custom_intent_mode: customIntents?.length ? this.#resolveChoice(customIntentMode, modeMapping) : undefined,
      sentiment: this.#flag(sentiment),
      language,
      callback: callbackUrl,
      callback_method: callbackUrl ? this.#resolveChoice(callbackMethod, callbackMethodMapping) : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/read?${ this.#toQueryString(query) }`,
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: text ? { text } : { url: sourceUrl },
    })
  }

  // ==================== Projects ====================

  /**
   * @operationName List Projects
   * @category Projects
   * @description Retrieves all Deepgram projects that the configured API key has access to. Returns each project's ID and name. Project IDs are required by all key management, usage, and billing actions.
   * @route GET /list-projects
   * @appearanceColor #101820 #13EF95
   *
   * @returns {Object}
   * @sampleResult {"projects":[{"project_id":"1c2b3a4d-5e6f-7081-92a3-b4c5d6e7f809","name":"My Voice App"}]}
   */
  async listProjects() {
    const logTag = '[listProjects]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects`,
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves details of a specific Deepgram project, including its ID, name, and organization information.
   * @route GET /get-project
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project to retrieve. Select from the dictionary or enter a project ID."}
   *
   * @returns {Object}
   * @sampleResult {"project_id":"1c2b3a4d-5e6f-7081-92a3-b4c5d6e7f809","name":"My Voice App","company":"Acme Inc"}
   */
  async getProject(projectId) {
    const logTag = '[getProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }`,
    })
  }

  // ==================== API Keys ====================

  /**
   * @operationName List API Keys
   * @category API Keys
   * @description Lists all API keys for a Deepgram project, including each key's ID, comment, scopes, tags, creation date, and the member it belongs to. The secret key values are not returned - they are only visible once, at creation time.
   * @route GET /list-api-keys
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose API keys to list. Select from the dictionary or enter a project ID."}
   *
   * @returns {Object}
   * @sampleResult {"api_keys":[{"member":{"member_id":"9f8e7d6c-5b4a-3210-fedc-ba9876543210","email":"user@example.com"},"api_key":{"api_key_id":"f1e2d3c4-b5a6-9788-0123-456789abcdef","comment":"Production key","scopes":["member"],"tags":["prod"],"created":"2026-01-15T10:00:00.000Z"}}]}
   */
  async listApiKeys(projectId) {
    const logTag = '[listApiKeys]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/keys`,
    })
  }

  /**
   * @operationName Create API Key
   * @category API Keys
   * @description Creates a new API key in a Deepgram project with the specified comment and scopes. The secret key value is returned only in this response and cannot be retrieved later - store it securely. Requires the configured API key to have the keys:write scope. Optionally set an expiration date or a time-to-live, but not both.
   * @route POST /create-api-key
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project to create the API key in. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"description":"A descriptive comment identifying the key's purpose, e.g. 'CI transcription key'."}
   * @paramDef {"type":"Array<String>","label":"Scopes","name":"scopes","required":true,"description":"Permission scopes for the key. Use a role such as member or admin, or granular scopes such as usage:read, usage:write, keys:read, keys:write, project:read, billing:read."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Labels for organizing the key, e.g. environment names like prod or staging."}
   * @paramDef {"type":"String","label":"Expiration Date","name":"expirationDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Date and time when the key expires (ISO 8601). Cannot be combined with Time To Live."}
   * @paramDef {"type":"Number","label":"Time To Live","name":"timeToLiveInSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of seconds until the key expires. Cannot be combined with Expiration Date."}
   *
   * @returns {Object}
   * @sampleResult {"api_key_id":"f1e2d3c4-b5a6-9788-0123-456789abcdef","key":"b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9","comment":"CI transcription key","scopes":["usage:write"],"tags":["ci"],"created":"2026-07-17T12:00:00.000Z"}
   */
  async createApiKey(projectId, comment, scopes, tags, expirationDate, timeToLiveInSeconds) {
    const logTag = '[createApiKey]'

    if (expirationDate && timeToLiveInSeconds !== undefined && timeToLiveInSeconds !== null) {
      throw new Error('Provide either Expiration Date or Time To Live, not both.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/keys`,
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: clean({
        comment,
        scopes,
        tags,
        expiration_date: expirationDate,
        time_to_live_in_seconds: timeToLiveInSeconds,
      }),
    })
  }

  /**
   * @operationName Delete API Key
   * @category API Keys
   * @description Permanently deletes an API key from a Deepgram project. Requests made with the deleted key stop working immediately. Requires the configured API key to have the keys:write scope. This action cannot be undone.
   * @route DELETE /delete-api-key
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project containing the API key. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"API Key","name":"keyId","required":true,"dictionary":"getProjectKeysDictionary","dependsOn":["projectId"],"description":"The API key to delete. Choose a project above to pick from its keys, or paste an API key ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteApiKey(projectId, keyId) {
    const logTag = '[deleteApiKey]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/keys/${ encodeURIComponent(keyId) }`,
      method: 'delete',
    })

    return response && typeof response === 'object' ? response : { success: true }
  }

  // ==================== Usage ====================

  /**
   * @operationName Get Usage Summary
   * @category Usage
   * @description Retrieves aggregated usage for a Deepgram project over a date range, resolved per day. Results include audio hours processed, request counts, and token/character counts where applicable. Optionally filter by API endpoint, processing method, deployment type, accessor (API key), tag, or model.
   * @route GET /get-usage-summary
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose usage to retrieve. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the reporting period in YYYY-MM-DD format. Defaults to the project's creation date."}
   * @paramDef {"type":"String","label":"End Date","name":"end","uiComponent":{"type":"DATE_PICKER"},"description":"End of the reporting period in YYYY-MM-DD format. Defaults to today."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","uiComponent":{"type":"DROPDOWN","options":{"values":["Speech to Text","Text to Speech","Text Intelligence","Voice Agent"]}},"description":"Filter usage to a single Deepgram API endpoint."}
   * @paramDef {"type":"String","label":"Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["Sync","Async","Streaming"]}},"description":"Filter usage by processing method."}
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosted","Self-Hosted","Beta"]}},"description":"Filter usage by deployment type."}
   * @paramDef {"type":"String","label":"Accessor","name":"accessor","description":"Filter usage to requests made with a specific API key ID."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter usage to requests labeled with a specific tag."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Filter usage to requests that used a specific model UUID."}
   *
   * @returns {Object}
   * @sampleResult {"start":"2026-06-01","end":"2026-07-17","resolution":{"units":"day","amount":1},"results":[{"start":"2026-07-16","end":"2026-07-17","hours":1.24,"total_hours":1.5,"requests":42}]}
   */
  async getUsageSummary(projectId, start, end, endpoint, method, deployment, accessor, tag, model) {
    const logTag = '[getUsageSummary]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/usage`,
      query: {
        start,
        end,
        endpoint: this.#resolveChoice(endpoint, USAGE_ENDPOINT_MAPPING),
        method: this.#resolveChoice(method, USAGE_METHOD_MAPPING),
        deployment: this.#resolveChoice(deployment, USAGE_DEPLOYMENT_MAPPING),
        accessor,
        tag,
        model,
      },
    })
  }

  /**
   * @operationName Get Usage Breakdown
   * @category Usage
   * @description Retrieves a usage breakdown for a Deepgram project over a date range, aggregated by a chosen grouping such as endpoint, model, method, tag, accessor, feature set, or deployment. Each result includes hours processed, request counts, and token/character totals. Optionally filter by endpoint, method, deployment, accessor, tag, or model.
   * @route GET /get-usage-breakdown
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose usage breakdown to retrieve. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the reporting period in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"end","uiComponent":{"type":"DATE_PICKER"},"description":"End of the reporting period in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Grouping","name":"grouping","uiComponent":{"type":"DROPDOWN","options":{"values":["Accessor","Endpoint","Feature Set","Models","Method","Tags","Deployment"]}},"description":"How to aggregate the breakdown results."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","uiComponent":{"type":"DROPDOWN","options":{"values":["Speech to Text","Text to Speech","Text Intelligence","Voice Agent"]}},"description":"Filter the breakdown to a single Deepgram API endpoint."}
   * @paramDef {"type":"String","label":"Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["Sync","Async","Streaming"]}},"description":"Filter the breakdown by processing method."}
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosted","Self-Hosted","Beta"]}},"description":"Filter the breakdown by deployment type."}
   * @paramDef {"type":"String","label":"Accessor","name":"accessor","description":"Filter the breakdown to requests made with a specific API key ID."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter the breakdown to requests labeled with a specific tag."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Filter the breakdown to requests that used a specific model UUID."}
   *
   * @returns {Object}
   * @sampleResult {"start":"2026-06-01","end":"2026-07-17","resolution":{"units":"day","amount":1},"results":[{"hours":1.24,"total_hours":1.5,"tts_characters":1200,"requests":42,"grouping":{"endpoint":"listen","models":["nova-3-general"]}}]}
   */
  async getUsageBreakdown(projectId, start, end, grouping, endpoint, method, deployment, accessor, tag, model) {
    const logTag = '[getUsageBreakdown]'

    const groupingMapping = {
      'Accessor': 'accessor',
      'Endpoint': 'endpoint',
      'Feature Set': 'feature_set',
      'Models': 'models',
      'Method': 'method',
      'Tags': 'tags',
      'Deployment': 'deployment',
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/usage/breakdown`,
      query: {
        start,
        end,
        grouping: this.#resolveChoice(grouping, groupingMapping),
        endpoint: this.#resolveChoice(endpoint, USAGE_ENDPOINT_MAPPING),
        method: this.#resolveChoice(method, USAGE_METHOD_MAPPING),
        deployment: this.#resolveChoice(deployment, USAGE_DEPLOYMENT_MAPPING),
        accessor,
        tag,
        model,
      },
    })
  }

  /**
   * @operationName List Usage Fields
   * @category Usage
   * @description Lists the features, models, tags, and processing methods used by requests in a Deepgram project during the specified time period. Useful for discovering which filter values are available for the usage summary and breakdown actions.
   * @route GET /list-usage-fields
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose usage fields to list. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the reporting period in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"end","uiComponent":{"type":"DATE_PICKER"},"description":"End of the reporting period in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["prod"],"models":[{"name":"nova-3-general","language":"en","version":"2025-01-09.0","model_id":"c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11"}],"processing_methods":["sync"],"features":["smart_format","diarize"]}
   */
  async listUsageFields(projectId, start, end) {
    const logTag = '[listUsageFields]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/usage/fields`,
      query: { start, end },
    })
  }

  /**
   * @operationName List Usage Requests
   * @category Usage
   * @description Lists individual API requests made in a Deepgram project, newest first, with pagination. Each entry includes the request ID, timestamp, request path, response code, and API key used. Optionally filter by date range, status, endpoint, processing method, deployment, or accessor.
   * @route GET /list-usage-requests
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose requests to list. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the period, as YYYY-MM-DD or an ISO 8601 date-time."}
   * @paramDef {"type":"String","label":"End Date","name":"end","uiComponent":{"type":"DATE_PICKER"},"description":"End of the period, as YYYY-MM-DD or an ISO 8601 date-time."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of requests to return per page (1-1000). Default 10."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number for paginating through results."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Succeeded","Failed"]}},"description":"Filter requests by outcome."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","uiComponent":{"type":"DROPDOWN","options":{"values":["Speech to Text","Text to Speech","Text Intelligence","Voice Agent"]}},"description":"Filter requests to a single Deepgram API endpoint."}
   * @paramDef {"type":"String","label":"Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["Sync","Async","Streaming"]}},"description":"Filter requests by processing method."}
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosted","Self-Hosted","Beta"]}},"description":"Filter requests by deployment type."}
   * @paramDef {"type":"String","label":"Accessor","name":"accessor","description":"Filter requests to those made with a specific API key ID."}
   *
   * @returns {Object}
   * @sampleResult {"page":0,"limit":10,"requests":[{"request_id":"5a7e1c3d-9b21-4c7e-8f7d-2f1a6b4e9c11","created":"2026-07-17T12:00:00.000Z","path":"/v1/listen?model=nova-3","api_key_id":"f1e2d3c4-b5a6-9788-0123-456789abcdef","response":{"code":200,"completed":"2026-07-17T12:00:04.000Z"},"deployment":"hosted"}]}
   */
  async listUsageRequests(projectId, start, end, limit, page, status, endpoint, method, deployment, accessor) {
    const logTag = '[listUsageRequests]'

    const statusMapping = { Succeeded: 'succeeded', Failed: 'failed' }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/requests`,
      query: {
        start,
        end,
        limit,
        page,
        status: this.#resolveChoice(status, statusMapping),
        endpoint: this.#resolveChoice(endpoint, USAGE_ENDPOINT_MAPPING),
        method: this.#resolveChoice(method, USAGE_METHOD_MAPPING),
        deployment: this.#resolveChoice(deployment, USAGE_DEPLOYMENT_MAPPING),
        accessor,
      },
    })
  }

  /**
   * @operationName Get Usage Request
   * @category Usage
   * @description Retrieves the details of a single API request made in a Deepgram project, including its path, response code, timing, API key used, and callback information if any. Use the request_id returned by transcription, speech, or analysis actions.
   * @route GET /get-usage-request
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project the request belongs to. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The unique identifier of the request to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"5a7e1c3d-9b21-4c7e-8f7d-2f1a6b4e9c11","created":"2026-07-17T12:00:00.000Z","path":"/v1/listen?model=nova-3","api_key_id":"f1e2d3c4-b5a6-9788-0123-456789abcdef","response":{"code":200,"completed":"2026-07-17T12:00:04.000Z","details":{"duration":25.93,"channels":1}},"deployment":"hosted"}
   */
  async getUsageRequest(projectId, requestId) {
    const logTag = '[getUsageRequest]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/requests/${ encodeURIComponent(requestId) }`,
    })
  }

  // ==================== Billing ====================

  /**
   * @operationName List Balances
   * @category Billing
   * @description Lists the outstanding prepaid credit balances for a Deepgram project, including each balance's ID, remaining amount, currency units, and associated purchase order. Requires a key with billing access.
   * @route GET /list-balances
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose balances to list. Select from the dictionary or enter a project ID."}
   *
   * @returns {Object}
   * @sampleResult {"balances":[{"balance_id":"a1b2c3d4-e5f6-7081-92a3-b4c5d6e7f809","amount":149.5,"units":"usd","purchase_order_id":"7f8e9d0c-1b2a-3948-5766-8f9e0d1c2b3a"}]}
   */
  async listBalances(projectId) {
    const logTag = '[listBalances]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/balances`,
    })
  }

  /**
   * @operationName Get Balance
   * @category Billing
   * @description Retrieves a specific prepaid credit balance for a Deepgram project by balance ID, including the remaining amount, currency units, and associated purchase order.
   * @route GET /get-balance
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project the balance belongs to. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"String","label":"Balance ID","name":"balanceId","required":true,"description":"The unique identifier of the balance to retrieve. Use List Balances to find balance IDs."}
   *
   * @returns {Object}
   * @sampleResult {"balance_id":"a1b2c3d4-e5f6-7081-92a3-b4c5d6e7f809","amount":149.5,"units":"usd","purchase_order_id":"7f8e9d0c-1b2a-3948-5766-8f9e0d1c2b3a"}
   */
  async getBalance(projectId, balanceId) {
    const logTag = '[getBalance]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/balances/${ encodeURIComponent(balanceId) }`,
    })
  }

  // ==================== Models ====================

  /**
   * @operationName List Models
   * @category Models
   * @description Lists all speech-to-text models and text-to-speech voices available on Deepgram, including each model's canonical name, architecture, supported languages, version, and UUID. TTS voices include metadata such as accent and voice characteristics. Optionally filter to STT or TTS models only, and optionally include outdated model versions.
   * @route GET /list-models
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Model Type","name":"modelType","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Speech to Text","Text to Speech"]}},"defaultValue":"All","description":"Return all models or only speech-to-text / text-to-speech models."}
   * @paramDef {"type":"Boolean","label":"Include Outdated","name":"includeOutdated","uiComponent":{"type":"TOGGLE"},"description":"Includes outdated model versions in the results."}
   *
   * @returns {Object}
   * @sampleResult {"stt":[{"name":"general","canonical_name":"nova-3-general","architecture":"nova-3","languages":["en","en-US"],"version":"2025-01-09.0","uuid":"c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11","batch":true,"streaming":true}],"tts":[{"name":"thalia","canonical_name":"aura-2-thalia-en","architecture":"aura-2","languages":["en","en-US"],"version":"2025-04-15.0","uuid":"9c2e9b26-6b3f-4a2b-b1f6-4a1c9e2d7f55"}]}
   */
  async listModels(modelType, includeOutdated) {
    const logTag = '[listModels]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/models`,
      query: { include_outdated: this.#flag(includeOutdated) },
    })

    if (modelType === 'Speech to Text') {
      return { stt: response.stt || [] }
    }

    if (modelType === 'Text to Speech') {
      return { tts: response.tts || [] }
    }

    return response
  }

  /**
   * @operationName Get Model
   * @category Models
   * @description Retrieves the details of a specific Deepgram model by its UUID, including its name, canonical name, architecture, supported languages, and version. Model UUIDs are returned by List Models and appear in transcription metadata.
   * @route GET /get-model
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Model UUID","name":"modelId","required":true,"description":"The unique identifier (UUID) of the model to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"name":"general","canonical_name":"nova-3-general","architecture":"nova-3","languages":["en","en-US"],"version":"2025-01-09.0","uuid":"c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11","batch":true,"streaming":true}
   */
  async getModel(modelId) {
    const logTag = '[getModel]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/models/${ encodeURIComponent(modelId) }`,
    })
  }

  /**
   * @operationName List Project Models
   * @category Models
   * @description Lists the speech-to-text models and text-to-speech voices available to a specific Deepgram project, which may include private or custom models in addition to the public catalog.
   * @route GET /list-project-models
   * @appearanceColor #101820 #13EF95
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The Deepgram project whose available models to list. Select from the dictionary or enter a project ID."}
   * @paramDef {"type":"Boolean","label":"Include Outdated","name":"includeOutdated","uiComponent":{"type":"TOGGLE"},"description":"Includes outdated model versions in the results."}
   *
   * @returns {Object}
   * @sampleResult {"stt":[{"name":"general","canonical_name":"nova-3-general","architecture":"nova-3","languages":["en","en-US"],"version":"2025-01-09.0","uuid":"c0b4bb90-9c73-4e3f-a26a-9d8c9a3b8f11","batch":true,"streaming":true}],"tts":[{"name":"thalia","canonical_name":"aura-2-thalia-en","architecture":"aura-2","languages":["en","en-US"],"version":"2025-04-15.0","uuid":"9c2e9b26-6b3f-4a2b-b1f6-4a1c9e2d7f55"}]}
   */
  async listProjectModels(projectId, includeOutdated) {
    const logTag = '[listProjectModels]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/models`,
      query: { include_outdated: this.#flag(includeOutdated) },
    })
  }

  // ==================== Dictionaries ====================

  /**
   * @typedef {Object} getSttModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter models by name or architecture."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full model list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get STT Models Dictionary
   * @description Provides the list of Deepgram speech-to-text models for selection in the transcription actions. Includes common aliases (nova-3, nova-2, enhanced, base) plus every batch-capable canonical model from the live Deepgram model catalog.
   * @route POST /get-stt-models-dictionary
   * @paramDef {"type":"getSttModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"nova-3","value":"nova-3","note":"Alias for the latest Nova-3 general model"},{"label":"nova-3-medical","value":"nova-3-medical","note":"nova-3 architecture"}],"cursor":null}
   */
  async getSttModelsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getSttModelsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/models`,
    })

    const aliases = [
      { label: 'nova-3', value: 'nova-3', note: 'Alias for the latest Nova-3 general model' },
      { label: 'nova-2', value: 'nova-2', note: 'Alias for the latest Nova-2 general model' },
      { label: 'enhanced', value: 'enhanced', note: 'Alias for the latest Enhanced general model' },
      { label: 'base', value: 'base', note: 'Alias for the latest Base general model' },
    ]

    const seen = new Set()
    const models = []

    for (const model of response.stt || []) {
      if (model.batch === false || seen.has(model.canonical_name)) {
        continue
      }

      seen.add(model.canonical_name)

      const noteParts = [`${ model.architecture } architecture`]

      if (model.multilingual) {
        noteParts.push('multilingual')
      }

      models.push({
        label: model.canonical_name,
        value: model.canonical_name,
        note: noteParts.join(', '),
      })
    }

    models.sort((a, b) => a.label.localeCompare(b.label))

    let items = [...aliases, ...models]

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(item =>
        item.label.toLowerCase().includes(term) || (item.note || '').toLowerCase().includes(term)
      )
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getTtsVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter voices by name, model, accent, or characteristics."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full voice list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Voices Dictionary
   * @description Provides the list of Deepgram Aura text-to-speech voices for selection in Convert Text to Speech. Loaded from the live Deepgram model catalog; each option's value is the voice model name (e.g. aura-2-thalia-en) with the voice's accent and characteristics as a note.
   * @route POST /get-tts-voices-dictionary
   * @paramDef {"type":"getTtsVoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter voices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Thalia (aura-2-thalia-en)","value":"aura-2-thalia-en","note":"American - feminine, clear, confident"}],"cursor":null}
   */
  async getTtsVoicesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getTtsVoicesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/models`,
    })

    const seen = new Set()
    let items = []

    for (const model of response.tts || []) {
      if (seen.has(model.canonical_name)) {
        continue
      }

      seen.add(model.canonical_name)

      const metadata = model.metadata || {}
      const tags = (metadata.tags || []).slice(0, 3).join(', ')

      items.push({
        label: metadata.display_name
          ? `${ metadata.display_name } (${ model.canonical_name })`
          : model.canonical_name,
        value: model.canonical_name,
        note: [metadata.accent, tags].filter(Boolean).join(' - ') || undefined,
      })
    }

    items.sort((a, b) => a.value.localeCompare(b.value))

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(item =>
        item.label.toLowerCase().includes(term) || (item.note || '').toLowerCase().includes(term)
      )
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full project list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Provides the list of Deepgram projects accessible to the configured API key for selecting a project in management, usage, and billing actions. The option value is the project ID.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter projects by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Voice App","value":"1c2b3a4d-5e6f-7081-92a3-b4c5d6e7f809"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getProjectsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects`,
    })

    let items = (response.projects || []).map(project => ({
      label: project.name || project.project_id,
      value: project.project_id,
    }))

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getProjectKeysDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","description":"The Deepgram project whose API keys to list."}
   */

  /**
   * @typedef {Object} getProjectKeysDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter keys by comment."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full key list is returned in one call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getProjectKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The project whose API keys to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Project Keys Dictionary
   * @description Provides the list of API keys in the selected Deepgram project for choosing a key in Delete API Key. The option value is the API key ID; the note shows the key's scopes.
   * @route POST /get-project-keys-dictionary
   * @paramDef {"type":"getProjectKeysDictionary__payload","label":"Payload","name":"payload","description":"Search text and the project criteria whose API keys to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Production key","value":"f1e2d3c4-b5a6-9788-0123-456789abcdef","note":"member"}],"cursor":null}
   */
  async getProjectKeysDictionary(payload) {
    const { search, criteria } = payload || {}
    const projectId = criteria?.projectId
    const logTag = '[getProjectKeysDictionary]'

    if (!projectId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ encodeURIComponent(projectId) }/keys`,
    })

    let items = (response.api_keys || []).map(entry => {
      const key = entry.api_key || {}

      return {
        label: key.comment || key.api_key_id,
        value: key.api_key_id,
        note: (key.scopes || []).join(', ') || undefined,
      }
    })

    if (search) {
      const term = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(DeepgramService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Deepgram API key (sent as the Authorization: Token header). Create one in the Deepgram Console at https://console.deepgram.com under API Keys.',
  },
])
