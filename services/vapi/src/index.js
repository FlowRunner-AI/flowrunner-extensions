const logger = {
  info: (...args) => console.log('[Vapi] info:', ...args),
  debug: (...args) => console.log('[Vapi] debug:', ...args),
  error: (...args) => console.log('[Vapi] error:', ...args),
  warn: (...args) => console.log('[Vapi] warn:', ...args),
}

const API_BASE_URL = 'https://api.vapi.ai'

const DICTIONARY_PAGE_SIZE = 100

const PHONE_PROVIDER_MAP = {
  'Vapi (Free US Number)': 'vapi',
  'Twilio': 'twilio',
  'Vonage': 'vonage',
  'Telnyx': 'telnyx',
  'BYO SIP Trunk': 'byo-phone-number',
}

const TOOL_TYPE_MAP = {
  'Function': 'function',
  'API Request': 'apiRequest',
  'Transfer Call': 'transferCall',
  'End Call': 'endCall',
  'DTMF': 'dtmf',
  'SMS': 'sms',
  'MCP': 'mcp',
  'Query': 'query',
  'Handoff': 'handoff',
}

const CAMPAIGN_STATUS_FILTER_MAP = {
  'Scheduled': 'scheduled',
  'In Progress': 'in-progress',
  'Ended': 'ended',
  'Cancelled': 'cancelled',
  'Archived': 'archived',
}

const CAMPAIGN_STATUS_UPDATE_MAP = {
  'Ended': 'ended',
  'Cancelled': 'cancelled',
}

const SESSION_STATUS_MAP = {
  'Active': 'active',
  'Completed': 'completed',
}

const SORT_ORDER_MAP = {
  'Ascending': 'ASC',
  'Descending': 'DESC',
}

const ANALYTICS_TABLE_MAP = {
  'Call': 'call',
  'Subscription': 'subscription',
}

const ANALYTICS_STEP_MAP = {
  'Second': 'second',
  'Minute': 'minute',
  'Hour': 'hour',
  'Day': 'day',
  'Week': 'week',
  'Month': 'month',
  'Quarter': 'quarter',
  'Year': 'year',
}

const ANALYTICS_GROUP_BY_MAP = {
  'Type': 'type',
  'Assistant ID': 'assistantId',
  'Ended Reason': 'endedReason',
  'Success Evaluation': 'analysis.successEvaluation',
  'Status': 'status',
}

// Maps the Recording Type dropdown label to the call-artifact URL that holds the media,
// preferring short-lived presigned URLs, then permanent storage URLs.
const RECORDING_SOURCES = {
  'Stereo': artifact =>
    artifact.presignedStereoUrl || artifact.stereoRecordingUrl || artifact.recording?.stereoUrl,
  'Mono (Combined)': artifact =>
    artifact.presignedMonoUrl || artifact.recording?.mono?.combinedUrl || artifact.recordingUrl,
  'Customer Channel': artifact =>
    artifact.presignedCustomerUrl || artifact.recording?.mono?.customerUrl,
  'Assistant Channel': artifact =>
    artifact.presignedAssistantUrl || artifact.recording?.mono?.assistantUrl,
  'Video': artifact =>
    artifact.presignedVideoUrl || artifact.videoRecordingUrl || artifact.recording?.videoUrl,
  'Packet Capture (PCAP)': artifact =>
    artifact.presignedPcapUrl || artifact.pcapUrl,
}

const RECORDING_EXTENSIONS = {
  'Video': 'mp4',
  'Packet Capture (PCAP)': 'pcap',
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
 * @integrationName Vapi
 * @integrationIcon /icon.svg
 */
class VapiService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const details = error.body?.message
      const message = Array.isArray(details) ? details.join('; ') : (details || error.message)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Vapi API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #downloadBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl.split('?')[0] }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  #buildAssistantBody({
    name, firstMessage, systemPrompt, modelProvider, modelName, model,
    voiceProvider, voiceId, voice, transcriber, serverUrl,
    endCallMessage, voicemailMessage, maxDurationSeconds, metadata, advancedConfig,
  }) {
    const resolvedModel = model || ((modelProvider || modelName || systemPrompt)
      ? clean({
        provider: modelProvider,
        model: modelName,
        messages: systemPrompt ? [{ role: 'system', content: systemPrompt }] : undefined,
      })
      : undefined)

    const resolvedVoice = voice || ((voiceProvider || voiceId)
      ? clean({ provider: voiceProvider, voiceId })
      : undefined)

    return {
      ...clean({
        name,
        firstMessage,
        model: resolvedModel,
        voice: resolvedVoice,
        transcriber,
        server: serverUrl ? { url: serverUrl } : undefined,
        endCallMessage,
        voicemailMessage,
        maxDurationSeconds,
        metadata,
      }),
      ...(advancedConfig || {}),
    }
  }

  async #listDictionary({ path, query, search, cursor, mapItem, logTag }) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }${ path }`,
      method: 'get',
      query: clean({ limit: DICTIONARY_PAGE_SIZE, createdAtLt: cursor, ...(query || {}) }),
    })

    const records = Array.isArray(response) ? response : (response.results || [])
    const term = (search || '').toLowerCase().trim()

    const items = records
      .map(mapItem)
      .filter(item => !term || String(item.label).toLowerCase().includes(term))

    const nextCursor = records.length === DICTIONARY_PAGE_SIZE
      ? records[records.length - 1].createdAt
      : null

    return { items, cursor: nextCursor }
  }

  // ==================================================================================
  // Calls
  // ==================================================================================

  /**
   * @operationName Create Call
   * @category Calls
   * @description Starts an outbound phone call (or schedules one for later) from a Vapi phone number to a customer. Provide a saved assistant via Assistant ID, a transient assistant configuration, or a Squad ID for multi-assistant calls. Pass a single customer via Customer Number, or an array of customers to fan out one call per customer. Set Earliest At / Latest At to schedule the call instead of dialing immediately. Returns the call object with its id and initial status ('queued' or 'scheduled') — fetch it later with Get Call to read the transcript, recording, and analysis.
   * @route POST /create-call
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"The saved assistant that handles the call. Provide this, a transient Assistant Config, or a Squad."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","dictionary":"getPhoneNumbersDictionary","description":"The Vapi phone number to place the call from. Required for outbound phone calls."}
   * @paramDef {"type":"String","label":"Customer Number","name":"customerNumber","description":"The customer's phone number to dial, in E.164 format (e.g. '+14155551234'). Use this for a single-customer call."}
   * @paramDef {"type":"String","label":"Customer Name","name":"customerName","description":"Optional display name of the customer, used in logs and available to the assistant."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"A squad to handle the call with multiple assistants and hand-offs. Alternative to Assistant."}
   * @paramDef {"type":"String","label":"Call Name","name":"name","description":"Optional label for the call (max 40 characters), for reference in the dashboard and API."}
   * @paramDef {"type":"String","label":"Earliest At","name":"earliestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp of the earliest moment the call may start. Set this to schedule the call instead of dialing immediately."}
   * @paramDef {"type":"String","label":"Latest At","name":"latestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp of the latest moment the call may start. Used together with Earliest At for scheduled calls."}
   * @paramDef {"type":"Object","label":"Assistant Config (Transient)","name":"assistant","description":"Full transient assistant configuration used only for this call, instead of a saved assistant. Same shape as the Create Assistant body, e.g. {\"model\":{\"provider\":\"openai\",\"model\":\"gpt-4o\"},\"voice\":{\"provider\":\"11labs\",\"voiceId\":\"burt\"},\"firstMessage\":\"Hello!\"}."}
   * @paramDef {"type":"Object","label":"Assistant Overrides","name":"assistantOverrides","description":"Partial overrides applied on top of the saved assistant for this call only, e.g. {\"variableValues\":{\"customerName\":\"Jane\"},\"firstMessage\":\"Hi Jane!\"}."}
   * @paramDef {"type":"Array<Object>","label":"Customers","name":"customers","description":"Array of customer objects to call in one request (one call per customer), e.g. [{\"number\":\"+14155551234\",\"name\":\"Jane\"},{\"number\":\"+14155556789\"}]. Alternative to Customer Number."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional CreateCallDTO fields merged into the request body, e.g. {\"workflowId\":\"...\"}, {\"customerId\":\"...\"} or {\"transport\":{...}}. See https://docs.vapi.ai/api-reference/calls/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","type":"outboundPhoneCall","status":"queued","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","phoneNumberId":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","customer":{"number":"+14155551234","name":"Jane Doe"},"monitor":{"listenUrl":"wss://phone-call-websocket.aws-us-west-2-backend-production2.vapi.ai/listen","controlUrl":"https://phone-call-websocket.aws-us-west-2-backend-production2.vapi.ai/control"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createCall(assistantId, phoneNumberId, customerNumber, customerName, squadId, name, earliestAt, latestAt, assistant, assistantOverrides, customers, advancedConfig) {
    const logTag = '[createCall]'

    const customer = (customerNumber || customerName)
      ? clean({ number: customerNumber, name: customerName })
      : undefined

    const body = {
      ...clean({
        assistantId,
        assistant,
        assistantOverrides,
        squadId,
        phoneNumberId,
        name,
        customer,
        customers,
        schedulePlan: (earliestAt || latestAt) ? clean({ earliestAt, latestAt }) : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/call`, method: 'post', body })
  }

  /**
   * @operationName List Calls
   * @category Calls
   * @description Lists calls in your Vapi organization, newest first, with optional filtering by assistant, phone number, and creation time window. Each call includes its status, cost, endedReason, and (for completed calls) the artifact with transcript and recording URLs. Returns up to Limit calls (default 100, max 1000); page older results by setting Created Before to the createdAt of the last returned call.
   * @route GET /list-calls
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"Only return calls handled by this assistant."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","dictionary":"getPhoneNumbersDictionary","description":"Only return calls placed or received on this phone number."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of calls to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return calls created strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return calls created strictly before this ISO 8601 timestamp. Use the last call's createdAt as this value to page older results."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return calls updated strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Updated Before","name":"updatedAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return calls updated strictly before this ISO 8601 timestamp."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","type":"outboundPhoneCall","status":"ended","endedReason":"customer-ended-call","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","customer":{"number":"+14155551234"},"cost":0.12,"startedAt":"2026-07-17T10:00:05.000Z","endedAt":"2026-07-17T10:03:41.000Z","createdAt":"2026-07-17T10:00:00.000Z","artifact":{"transcript":"AI: Hello! How can I help you today?\nUser: I'd like to reschedule my appointment.","recordingUrl":"https://storage.vapi.ai/9f2f2b1c-recording.wav"},"analysis":{"summary":"Customer called to reschedule; new slot booked for Friday.","successEvaluation":"true"}}]
   */
  async listCalls(assistantId, phoneNumberId, limit, createdAtGt, createdAtLt, updatedAtGt, updatedAtLt) {
    const logTag = '[listCalls]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/call`,
      method: 'get',
      query: { assistantId, phoneNumberId, limit, createdAtGt, createdAtLt, updatedAtGt, updatedAtLt },
    })
  }

  /**
   * @operationName Get Call
   * @category Calls
   * @description Retrieves a single call with its full details: status, timestamps, cost breakdown, ended reason, and — once the call has ended — the artifact (transcript, messages, recording URLs) and analysis (summary, structured data, success evaluation). Use this after Create Call to collect the outcome of a conversation.
   * @route GET /get-call
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The ID of the call to retrieve (returned by Create Call or List Calls)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","type":"outboundPhoneCall","status":"ended","endedReason":"customer-ended-call","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","phoneNumberId":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","customer":{"number":"+14155551234","name":"Jane Doe"},"cost":0.12,"costBreakdown":{"transport":0.02,"stt":0.01,"llm":0.03,"tts":0.04,"vapi":0.02,"total":0.12},"startedAt":"2026-07-17T10:00:05.000Z","endedAt":"2026-07-17T10:03:41.000Z","artifact":{"transcript":"AI: Hello! How can I help you today?\nUser: I'd like to reschedule my appointment.","recordingUrl":"https://storage.vapi.ai/9f2f2b1c-recording.wav","stereoRecordingUrl":"https://storage.vapi.ai/9f2f2b1c-stereo.wav","messages":[{"role":"bot","message":"Hello! How can I help you today?","time":1752746405000}]},"analysis":{"summary":"Customer called to reschedule; new slot booked for Friday.","successEvaluation":"true"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:04:00.000Z"}
   */
  async getCall(callId) {
    const logTag = '[getCall]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/call/${ callId }`, method: 'get' })
  }

  /**
   * @operationName Update Call
   * @category Calls
   * @description Updates the mutable metadata of a call. Currently the Vapi API only allows changing the call's name label. Returns the updated call object.
   * @route PATCH /update-call
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The ID of the call to update."}
   * @paramDef {"type":"String","label":"Call Name","name":"name","required":true,"description":"New label for the call (max 40 characters)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","name":"Follow-up with Jane","status":"ended","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:05:00.000Z"}
   */
  async updateCall(callId, name) {
    const logTag = '[updateCall]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/call/${ callId }`,
      method: 'patch',
      body: { name },
    })
  }

  /**
   * @operationName Delete Call
   * @category Calls
   * @description Deletes a call record and its data from your Vapi organization. This cannot be undone. Returns the deleted call object.
   * @route DELETE /delete-call
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The ID of the call to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","status":"ended","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:05:00.000Z"}
   */
  async deleteCall(callId) {
    const logTag = '[deleteCall]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/call/${ callId }`, method: 'delete' })
  }

  /**
   * @operationName Get Call Recording
   * @category Calls
   * @description Downloads a call's recording (stereo, mono, per-channel audio, video, or packet capture) and saves it to FlowRunner file storage, returning the stored file URL. Recordings are only available after the call has ended and if recording was enabled on the assistant (it is by default). Stereo puts the customer and assistant on separate channels of one file; Customer/Assistant Channel return each side individually.
   * @route GET /get-call-recording
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The ID of the ended call whose recording to download."}
   * @paramDef {"type":"String","label":"Recording Type","name":"recordingType","defaultValue":"Stereo","uiComponent":{"type":"DROPDOWN","options":{"values":["Stereo","Mono (Combined)","Customer Channel","Assistant Channel","Video","Packet Capture (PCAP)"]}},"description":"Which artifact to download. Defaults to Stereo (customer and assistant on separate channels of one WAV file)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded recording in FlowRunner file storage. Defaults to FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flow/call_9f2f2b1c_stereo_1752746700000.wav","filename":"call_9f2f2b1c_stereo_1752746700000.wav","callId":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","recordingType":"Stereo","bytes":1245184}
   */
  async getCallRecording(callId, recordingType, fileOptions) {
    const logTag = '[getCallRecording]'
    const type = recordingType || 'Stereo'
    const resolveUrl = RECORDING_SOURCES[type]

    if (!resolveUrl) {
      throw new Error(`Unknown recording type '${ type }'. Expected one of: ${ Object.keys(RECORDING_SOURCES).join(', ') }`)
    }

    const call = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/call/${ callId }`, method: 'get' })
    const recordingUrl = resolveUrl(call.artifact || {})

    if (!recordingUrl) {
      throw new Error(`No '${ type }' recording is available for call '${ callId }'. The call may still be in progress, or recording may be disabled on the assistant.`)
    }

    const buffer = await this.#downloadBuffer(recordingUrl, logTag)
    const extension = RECORDING_EXTENSIONS[type] || 'wav'
    const typeSlug = type.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const filename = `call_${ String(callId).split('-')[0] }_${ typeSlug }_${ Date.now() }.${ extension }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename, // hardcoded
      generateUrl: true, // hardcoded — required or url is null
      overwrite: true, // hardcoded
      ...(fileOptions || { scope: 'FLOW' }), // only scope from user
    })

    return { url, filename, callId, recordingType: type, bytes: buffer.length }
  }

  /**
   * @operationName Get Call Logs
   * @category Calls
   * @description Downloads the raw log file of a call and returns its text content. Call logs contain the detailed line-by-line runtime trace of the call (model requests, tool invocations, transport events) and are useful for debugging assistant behavior. Only available after the call has ended.
   * @route GET /get-call-logs
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The ID of the ended call whose logs to download."}
   *
   * @returns {Object}
   * @sampleResult {"callId":"9f2f2b1c-5a1e-4d3b-8e6a-2f1c0d9b8a7e","content":"10:00:05.123 [INFO] Call started\n10:00:05.456 [INFO] Assistant speaking: Hello! How can I help you today?\n10:03:41.789 [INFO] Call ended: customer-ended-call"}
   */
  async getCallLogs(callId) {
    const logTag = '[getCallLogs]'

    const call = await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/call/${ callId }`, method: 'get' })
    const artifact = call.artifact || {}
    const logUrl = artifact.presignedLogUrl || artifact.logUrl

    if (!logUrl) {
      throw new Error(`No log artifact is available for call '${ callId }'. The call may still be in progress.`)
    }

    const buffer = await this.#downloadBuffer(logUrl, logTag)

    return { callId, content: buffer.toString('utf8') }
  }

  // ==================================================================================
  // Assistants
  // ==================================================================================

  /**
   * @operationName Create Assistant
   * @category Assistants
   * @description Creates a saved voice assistant. Use the convenience fields (System Prompt, Model Provider, Model, Voice Provider, Voice ID, First Message) for the common setup, or pass full Model Config / Voice Config / Transcriber objects for complete control over any provider option. Set Server URL to receive Vapi webhooks (end-of-call reports, tool calls, status updates) for this assistant. Returns the created assistant with its id, ready to use in Create Call, phone number routing, or squads.
   * @route POST /create-assistant
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Assistant name shown in the dashboard and dictionaries (max 40 characters)."}
   * @paramDef {"type":"String","label":"First Message","name":"firstMessage","description":"The message the assistant speaks first when the call connects, e.g. 'Hello! How can I help you today?'. Leave empty to let the customer speak first."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System instruction defining the assistant's role, personality, and constraints. Sent as the model's system message."}
   * @paramDef {"type":"String","label":"Model Provider","name":"modelProvider","description":"LLM provider, e.g. 'openai', 'anthropic', 'google', 'groq', 'deepseek', 'xai', 'together-ai', 'custom-llm'. Used with Model."}
   * @paramDef {"type":"String","label":"Model","name":"modelName","description":"Model identifier at the provider, e.g. 'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.0-flash'."}
   * @paramDef {"type":"String","label":"Voice Provider","name":"voiceProvider","description":"Voice (TTS) provider, e.g. '11labs', 'openai', 'azure', 'cartesia', 'deepgram', 'playht', 'rime-ai', 'lmnt', 'vapi'."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","description":"Voice identifier at the voice provider, e.g. 'burt' (11labs) or 'alloy' (openai)."}
   * @paramDef {"type":"Object","label":"Model Config","name":"model","description":"Full model configuration object; overrides System Prompt / Model Provider / Model when set. E.g. {\"provider\":\"openai\",\"model\":\"gpt-4o\",\"temperature\":0.7,\"messages\":[{\"role\":\"system\",\"content\":\"You are a helpful scheduling agent.\"}],\"toolIds\":[\"...\"]}."}
   * @paramDef {"type":"Object","label":"Voice Config","name":"voice","description":"Full voice configuration object; overrides Voice Provider / Voice ID when set. E.g. {\"provider\":\"11labs\",\"voiceId\":\"burt\",\"stability\":0.5}."}
   * @paramDef {"type":"Object","label":"Transcriber","name":"transcriber","description":"Speech-to-text configuration, e.g. {\"provider\":\"deepgram\",\"model\":\"nova-3\",\"language\":\"en\"}. Defaults to Vapi's recommended transcriber."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"Webhook URL that receives this assistant's server events: end-of-call reports, status updates, and tool call requests."}
   * @paramDef {"type":"String","label":"End Call Message","name":"endCallMessage","description":"The message the assistant speaks right before hanging up."}
   * @paramDef {"type":"String","label":"Voicemail Message","name":"voicemailMessage","description":"The message the assistant leaves if the call hits the customer's voicemail."}
   * @paramDef {"type":"Number","label":"Max Duration (Seconds)","name":"maxDurationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum call length in seconds; the call is force-ended when reached. Defaults to 600 (10 minutes)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Arbitrary key-value metadata stored on the assistant, e.g. {\"team\":\"support\"}."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional CreateAssistantDTO fields merged into the request body, e.g. {\"endCallPhrases\":[\"goodbye\"],\"analysisPlan\":{...},\"voicemailDetection\":{...}}. See https://docs.vapi.ai/api-reference/assistants/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","name":"Support Agent","firstMessage":"Hello! How can I help you today?","model":{"provider":"openai","model":"gpt-4o","messages":[{"role":"system","content":"You are a helpful support agent."}]},"voice":{"provider":"11labs","voiceId":"burt"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createAssistant(name, firstMessage, systemPrompt, modelProvider, modelName, voiceProvider, voiceId, model, voice, transcriber, serverUrl, endCallMessage, voicemailMessage, maxDurationSeconds, metadata, advancedConfig) {
    const logTag = '[createAssistant]'

    const body = this.#buildAssistantBody({
      name, firstMessage, systemPrompt, modelProvider, modelName, model,
      voiceProvider, voiceId, voice, transcriber, serverUrl,
      endCallMessage, voicemailMessage, maxDurationSeconds, metadata, advancedConfig,
    })

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/assistant`, method: 'post', body })
  }

  /**
   * @operationName List Assistants
   * @category Assistants
   * @description Lists the saved assistants in your Vapi organization, newest first, with their model, voice, transcriber, and webhook configuration. Returns up to Limit assistants (max 1000); page older results by setting Created Before to the createdAt of the last returned assistant.
   * @route GET /list-assistants
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of assistants to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return assistants created strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return assistants created strictly before this ISO 8601 timestamp. Use for paging older results."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","name":"Support Agent","firstMessage":"Hello! How can I help you today?","model":{"provider":"openai","model":"gpt-4o"},"voice":{"provider":"11labs","voiceId":"burt"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}]
   */
  async listAssistants(limit, createdAtGt, createdAtLt) {
    const logTag = '[listAssistants]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/assistant`,
      method: 'get',
      query: { limit, createdAtGt, createdAtLt },
    })
  }

  /**
   * @operationName Get Assistant
   * @category Assistants
   * @description Retrieves a single saved assistant with its complete configuration: model (provider, model, system messages, tools), voice, transcriber, first message, webhook server, and all plans.
   * @route GET /get-assistant
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","required":true,"dictionary":"getAssistantsDictionary","description":"The assistant to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","name":"Support Agent","firstMessage":"Hello! How can I help you today?","model":{"provider":"openai","model":"gpt-4o","messages":[{"role":"system","content":"You are a helpful support agent."}],"toolIds":[]},"voice":{"provider":"11labs","voiceId":"burt"},"transcriber":{"provider":"deepgram","model":"nova-3"},"server":{"url":"https://example.com/vapi-webhook"},"maxDurationSeconds":600,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async getAssistant(assistantId) {
    const logTag = '[getAssistant]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/assistant/${ assistantId }`, method: 'get' })
  }

  /**
   * @operationName Update Assistant
   * @category Assistants
   * @description Updates a saved assistant. Only the fields you provide are changed. Note: Model Config / System Prompt / Model Provider / Model replace the assistant's entire model object, so include the provider and model when updating the system prompt. Returns the updated assistant.
   * @route PATCH /update-assistant
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","required":true,"dictionary":"getAssistantsDictionary","description":"The assistant to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New assistant name (max 40 characters)."}
   * @paramDef {"type":"String","label":"First Message","name":"firstMessage","description":"New first message the assistant speaks when the call connects."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New system instruction. Replaces the entire model object, so also set Model Provider and Model (or use Model Config)."}
   * @paramDef {"type":"String","label":"Model Provider","name":"modelProvider","description":"LLM provider, e.g. 'openai', 'anthropic', 'google'. Replaces the model object together with Model and System Prompt."}
   * @paramDef {"type":"String","label":"Model","name":"modelName","description":"Model identifier at the provider, e.g. 'gpt-4o'."}
   * @paramDef {"type":"String","label":"Voice Provider","name":"voiceProvider","description":"Voice provider, e.g. '11labs', 'openai', 'azure'. Replaces the voice object together with Voice ID."}
   * @paramDef {"type":"String","label":"Voice ID","name":"voiceId","description":"Voice identifier at the voice provider."}
   * @paramDef {"type":"Object","label":"Model Config","name":"model","description":"Full replacement model configuration object; takes precedence over the model convenience fields."}
   * @paramDef {"type":"Object","label":"Voice Config","name":"voice","description":"Full replacement voice configuration object; takes precedence over the voice convenience fields."}
   * @paramDef {"type":"Object","label":"Transcriber","name":"transcriber","description":"Replacement speech-to-text configuration, e.g. {\"provider\":\"deepgram\",\"model\":\"nova-3\"}."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"New webhook URL for this assistant's server events."}
   * @paramDef {"type":"String","label":"End Call Message","name":"endCallMessage","description":"New message spoken right before hanging up."}
   * @paramDef {"type":"String","label":"Voicemail Message","name":"voicemailMessage","description":"New message left on the customer's voicemail."}
   * @paramDef {"type":"Number","label":"Max Duration (Seconds)","name":"maxDurationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New maximum call length in seconds."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Replacement metadata object stored on the assistant."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional UpdateAssistantDTO fields merged into the request body. See https://docs.vapi.ai/api-reference/assistants/update."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","name":"Support Agent v2","firstMessage":"Hi! Thanks for calling.","model":{"provider":"openai","model":"gpt-4o"},"voice":{"provider":"11labs","voiceId":"burt"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T11:30:00.000Z"}
   */
  async updateAssistant(assistantId, name, firstMessage, systemPrompt, modelProvider, modelName, voiceProvider, voiceId, model, voice, transcriber, serverUrl, endCallMessage, voicemailMessage, maxDurationSeconds, metadata, advancedConfig) {
    const logTag = '[updateAssistant]'

    const body = this.#buildAssistantBody({
      name, firstMessage, systemPrompt, modelProvider, modelName, model,
      voiceProvider, voiceId, voice, transcriber, serverUrl,
      endCallMessage, voicemailMessage, maxDurationSeconds, metadata, advancedConfig,
    })

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/assistant/${ assistantId }`, method: 'patch', body })
  }

  /**
   * @operationName Delete Assistant
   * @category Assistants
   * @description Permanently deletes a saved assistant. Phone numbers and squads referencing it must be re-pointed. This cannot be undone. Returns the deleted assistant object.
   * @route DELETE /delete-assistant
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","required":true,"dictionary":"getAssistantsDictionary","description":"The assistant to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","name":"Support Agent","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async deleteAssistant(assistantId) {
    const logTag = '[deleteAssistant]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/assistant/${ assistantId }`, method: 'delete' })
  }

  // ==================================================================================
  // Phone Numbers
  // ==================================================================================

  /**
   * @operationName Create Phone Number
   * @category Phone Numbers
   * @description Adds a phone number to your Vapi organization for inbound and outbound calls. Choose 'Vapi (Free US Number)' to provision a free US number by desired area code, or import your own number from Twilio (account SID + auth token), Vonage/Telnyx (credential ID), or a BYO SIP trunk (credential ID). Optionally route inbound calls to an assistant, squad, or workflow, and set a Server URL for number-level webhooks. Returns the created phone number with its id.
   * @route POST /create-phone-number
   *
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"defaultValue":"Vapi (Free US Number)","uiComponent":{"type":"DROPDOWN","options":{"values":["Vapi (Free US Number)","Twilio","Vonage","Telnyx","BYO SIP Trunk"]}},"description":"Where the number comes from. Vapi provisions a free US number; the others import a number you already own."}
   * @paramDef {"type":"String","label":"Phone Number","name":"number","description":"The number to import, in E.164 format (e.g. '+14155551234'). Required for Twilio, Vonage, and Telnyx; optional for BYO SIP Trunk. Not used for Vapi free numbers."}
   * @paramDef {"type":"String","label":"Desired Area Code","name":"numberDesiredAreaCode","description":"Preferred 3-digit US area code for a Vapi free number, e.g. '415'. Vapi provider only."}
   * @paramDef {"type":"String","label":"SIP URI","name":"sipUri","description":"SIP URI to allocate instead of a phone number (e.g. 'sip:my-agent@sip.vapi.ai'). Vapi provider only."}
   * @paramDef {"type":"String","label":"Credential ID","name":"credentialId","description":"ID of the provider credential stored in Vapi. Required for Vonage, Telnyx, and BYO SIP Trunk."}
   * @paramDef {"type":"String","label":"Twilio Account SID","name":"twilioAccountSid","description":"Your Twilio account SID. Required when Provider is Twilio."}
   * @paramDef {"type":"String","label":"Twilio Auth Token","name":"twilioAuthToken","description":"Your Twilio auth token. Used with Twilio Account SID to import the number."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Label for the number shown in the dashboard and dictionaries (max 40 characters)."}
   * @paramDef {"type":"String","label":"Inbound Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"Assistant that answers inbound calls to this number."}
   * @paramDef {"type":"String","label":"Inbound Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"Squad that answers inbound calls to this number. Alternative to Inbound Assistant."}
   * @paramDef {"type":"String","label":"Inbound Workflow ID","name":"workflowId","description":"Workflow that answers inbound calls to this number. Alternative to Inbound Assistant."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"Webhook URL for events on this number (e.g. inbound call routing requests)."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional provider-specific fields merged into the request body, e.g. {\"smsEnabled\":false,\"fallbackDestination\":{...},\"twilioApiKey\":\"...\",\"twilioApiSecret\":\"...\"}. See https://docs.vapi.ai/api-reference/phone-numbers/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","provider":"vapi","number":"+14155559876","name":"Main Support Line","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createPhoneNumber(provider, number, numberDesiredAreaCode, sipUri, credentialId, twilioAccountSid, twilioAuthToken, name, assistantId, squadId, workflowId, serverUrl, advancedConfig) {
    const logTag = '[createPhoneNumber]'

    const body = {
      ...clean({
        provider: this.#resolveChoice(provider, PHONE_PROVIDER_MAP),
        number,
        numberDesiredAreaCode,
        sipUri,
        credentialId,
        twilioAccountSid,
        twilioAuthToken,
        name,
        assistantId,
        squadId,
        workflowId,
        server: serverUrl ? { url: serverUrl } : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/phone-number`, method: 'post', body })
  }

  /**
   * @operationName List Phone Numbers
   * @category Phone Numbers
   * @description Lists the phone numbers in your Vapi organization, newest first, with their provider, E.164 number, inbound routing (assistant/squad/workflow), and status. Returns up to Limit numbers (max 1000).
   * @route GET /list-phone-numbers
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of phone numbers to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return numbers created strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return numbers created strictly before this ISO 8601 timestamp. Use for paging older results."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","provider":"vapi","number":"+14155559876","name":"Main Support Line","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","createdAt":"2026-07-17T10:00:00.000Z"},{"id":"2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e","provider":"twilio","number":"+13105550000","name":"Sales Line","status":"active","createdAt":"2026-07-16T09:00:00.000Z"}]
   */
  async listPhoneNumbers(limit, createdAtGt, createdAtLt) {
    const logTag = '[listPhoneNumbers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/phone-number`,
      method: 'get',
      query: { limit, createdAtGt, createdAtLt },
    })
  }

  /**
   * @operationName Get Phone Number
   * @category Phone Numbers
   * @description Retrieves a single phone number with its full configuration: provider, E.164 number or SIP URI, inbound routing, fallback destination, and webhook server.
   * @route GET /get-phone-number
   *
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","required":true,"dictionary":"getPhoneNumbersDictionary","description":"The phone number to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","provider":"vapi","number":"+14155559876","name":"Main Support Line","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","server":{"url":"https://example.com/vapi-webhook"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async getPhoneNumber(phoneNumberId) {
    const logTag = '[getPhoneNumber]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/phone-number/${ phoneNumberId }`, method: 'get' })
  }

  /**
   * @operationName Update Phone Number
   * @category Phone Numbers
   * @description Updates a phone number's label, inbound routing (assistant, squad, or workflow), or webhook server. Only the fields you provide are changed. Returns the updated phone number.
   * @route PATCH /update-phone-number
   *
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","required":true,"dictionary":"getPhoneNumbersDictionary","description":"The phone number to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New label for the number (max 40 characters)."}
   * @paramDef {"type":"String","label":"Inbound Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"Assistant that answers inbound calls to this number."}
   * @paramDef {"type":"String","label":"Inbound Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"Squad that answers inbound calls to this number."}
   * @paramDef {"type":"String","label":"Inbound Workflow ID","name":"workflowId","description":"Workflow that answers inbound calls to this number."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"New webhook URL for events on this number."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional update fields merged into the request body, e.g. {\"fallbackDestination\":{...}}. See https://docs.vapi.ai/api-reference/phone-numbers/update."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","provider":"vapi","number":"+14155559876","name":"Support Line (After Hours)","assistantId":"8e0f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async updatePhoneNumber(phoneNumberId, name, assistantId, squadId, workflowId, serverUrl, advancedConfig) {
    const logTag = '[updatePhoneNumber]'

    const body = {
      ...clean({
        name,
        assistantId,
        squadId,
        workflowId,
        server: serverUrl ? { url: serverUrl } : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/phone-number/${ phoneNumberId }`, method: 'patch', body })
  }

  /**
   * @operationName Delete Phone Number
   * @category Phone Numbers
   * @description Removes a phone number from your Vapi organization. Vapi free numbers are released; imported numbers remain with their original carrier. This cannot be undone. Returns the deleted phone number object.
   * @route DELETE /delete-phone-number
   *
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","required":true,"dictionary":"getPhoneNumbersDictionary","description":"The phone number to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","provider":"vapi","number":"+14155559876","name":"Main Support Line","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async deletePhoneNumber(phoneNumberId) {
    const logTag = '[deletePhoneNumber]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/phone-number/${ phoneNumberId }`, method: 'delete' })
  }

  // ==================================================================================
  // Tools
  // ==================================================================================

  /**
   * @operationName Create Tool
   * @category Tools
   * @description Creates a reusable tool that assistants can call mid-conversation. 'Function' tools send the call to your Server URL (or the assistant's server) for custom logic; 'API Request' tools call an HTTP endpoint directly with the given URL, method, headers, and body schema. Other types (Transfer Call, End Call, DTMF, SMS, MCP, Query, Handoff) are configured via their type plus Advanced Config. Attach the returned tool id to an assistant via its model.toolIds. Returns the created tool.
   * @route POST /create-tool
   *
   * @paramDef {"type":"String","label":"Tool Type","name":"type","required":true,"defaultValue":"Function","uiComponent":{"type":"DROPDOWN","options":{"values":["Function","API Request","Transfer Call","End Call","DTMF","SMS","MCP","Query","Handoff"]}},"description":"The kind of tool to create. Function and API Request are the most common; other types are configured mainly through Advanced Config."}
   * @paramDef {"type":"String","label":"Tool Name","name":"toolName","description":"Name the model uses to invoke the tool, e.g. 'lookup_order'. Must be unique per assistant; letters, numbers, underscores, and dashes."}
   * @paramDef {"type":"String","label":"Tool Description","name":"toolDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description that tells the model when and how to use the tool, e.g. 'Looks up an order by its number and returns the status'."}
   * @paramDef {"type":"Object","label":"Parameters Schema","name":"parametersSchema","description":"JSON Schema of the tool's input parameters (Function tools), e.g. {\"type\":\"object\",\"properties\":{\"orderNumber\":{\"type\":\"string\"}},\"required\":[\"orderNumber\"]}."}
   * @paramDef {"type":"String","label":"API URL","name":"apiUrl","description":"Endpoint the tool calls (API Request tools). Supports {{variable}} templating from extracted conversation values."}
   * @paramDef {"type":"String","label":"API Method","name":"apiMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","POST","PUT","PATCH","DELETE"]}},"description":"HTTP method for API Request tools. Required when Tool Type is API Request."}
   * @paramDef {"type":"Object","label":"API Headers","name":"apiHeaders","description":"JSON Schema describing headers to send (API Request tools), e.g. {\"type\":\"object\",\"properties\":{\"Authorization\":{\"type\":\"string\",\"value\":\"Bearer abc\"}}}."}
   * @paramDef {"type":"Object","label":"API Body","name":"apiBodySchema","description":"JSON Schema describing the request body (API Request tools), e.g. {\"type\":\"object\",\"properties\":{\"orderNumber\":{\"type\":\"string\"}}}."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"Webhook URL that receives the tool-call request (Function tools). Defaults to the assistant's server URL when omitted."}
   * @paramDef {"type":"Boolean","label":"Async Tool","name":"asyncTool","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the assistant continues speaking without waiting for the tool result."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional tool fields merged into the request body, e.g. {\"messages\":[{\"type\":\"request-start\",\"content\":\"One moment...\"}]} or the destination config for Transfer Call tools. See https://docs.vapi.ai/api-reference/tools/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","type":"function","function":{"name":"lookup_order","description":"Looks up an order by its number and returns the status","parameters":{"type":"object","properties":{"orderNumber":{"type":"string"}},"required":["orderNumber"]}},"server":{"url":"https://example.com/tools/lookup-order"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createTool(type, toolName, toolDescription, parametersSchema, apiUrl, apiMethod, apiHeaders, apiBodySchema, serverUrl, asyncTool, advancedConfig) {
    const logTag = '[createTool]'
    const resolvedType = this.#resolveChoice(type, TOOL_TYPE_MAP)

    let body

    if (resolvedType === 'function') {
      body = clean({
        type: 'function',
        function: clean({ name: toolName, description: toolDescription, parameters: parametersSchema }),
      })
    } else {
      body = clean({ type: resolvedType, name: toolName, description: toolDescription })
    }

    if (resolvedType === 'apiRequest') {
      Object.assign(body, clean({ url: apiUrl, method: apiMethod, headers: apiHeaders, body: apiBodySchema }))
    }

    if (serverUrl) {
      body.server = { url: serverUrl }
    }

    if (asyncTool !== undefined && asyncTool !== null) {
      body.async = asyncTool
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tool`,
      method: 'post',
      body: { ...body, ...(advancedConfig || {}) },
    })
  }

  /**
   * @operationName List Tools
   * @category Tools
   * @description Lists the tools in your Vapi organization, newest first, with each tool's type and configuration. Returns up to Limit tools (max 1000).
   * @route GET /list-tools
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tools to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return tools created strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return tools created strictly before this ISO 8601 timestamp. Use for paging older results."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","type":"function","function":{"name":"lookup_order","description":"Looks up an order by its number"},"createdAt":"2026-07-17T10:00:00.000Z"},{"id":"4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a","type":"apiRequest","name":"get_weather","url":"https://api.example.com/weather","method":"GET","createdAt":"2026-07-16T09:00:00.000Z"}]
   */
  async listTools(limit, createdAtGt, createdAtLt) {
    const logTag = '[listTools]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tool`,
      method: 'get',
      query: { limit, createdAtGt, createdAtLt },
    })
  }

  /**
   * @operationName Get Tool
   * @category Tools
   * @description Retrieves a single tool with its full configuration: type, function schema or API request details, server webhook, and messages.
   * @route GET /get-tool
   *
   * @paramDef {"type":"String","label":"Tool","name":"toolId","required":true,"dictionary":"getToolsDictionary","description":"The tool to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","type":"function","function":{"name":"lookup_order","description":"Looks up an order by its number and returns the status","parameters":{"type":"object","properties":{"orderNumber":{"type":"string"}},"required":["orderNumber"]}},"server":{"url":"https://example.com/tools/lookup-order"},"async":false,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async getTool(toolId) {
    const logTag = '[getTool]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/tool/${ toolId }`, method: 'get' })
  }

  /**
   * @operationName Update Tool
   * @category Tools
   * @description Updates an existing tool. The tool's type cannot be changed. Use the convenience fields for common edits, or Advanced Config to patch any tool field (e.g. a Function tool's function object or an API Request tool's url/method/headers/body). Returns the updated tool.
   * @route PATCH /update-tool
   *
   * @paramDef {"type":"String","label":"Tool","name":"toolId","required":true,"dictionary":"getToolsDictionary","description":"The tool to update."}
   * @paramDef {"type":"String","label":"Tool Description","name":"toolDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New top-level description (API Request and other non-function tools). For Function tools, update the description inside Advanced Config's function object."}
   * @paramDef {"type":"String","label":"Server URL","name":"serverUrl","description":"New webhook URL that receives the tool-call request."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Update fields merged into the PATCH body, e.g. {\"function\":{\"name\":\"lookup_order\",\"description\":\"...\",\"parameters\":{...}}} or {\"url\":\"https://api.example.com/v2\",\"method\":\"POST\"}. See https://docs.vapi.ai/api-reference/tools/update."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","type":"function","function":{"name":"lookup_order","description":"Looks up an order and returns status plus tracking link","parameters":{"type":"object","properties":{"orderNumber":{"type":"string"}}}},"server":{"url":"https://example.com/tools/v2/lookup-order"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async updateTool(toolId, toolDescription, serverUrl, advancedConfig) {
    const logTag = '[updateTool]'

    const body = {
      ...clean({
        description: toolDescription,
        server: serverUrl ? { url: serverUrl } : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/tool/${ toolId }`, method: 'patch', body })
  }

  /**
   * @operationName Delete Tool
   * @category Tools
   * @description Permanently deletes a tool. Assistants referencing it via model.toolIds will no longer be able to call it. This cannot be undone. Returns the deleted tool object.
   * @route DELETE /delete-tool
   *
   * @paramDef {"type":"String","label":"Tool","name":"toolId","required":true,"dictionary":"getToolsDictionary","description":"The tool to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","type":"function","function":{"name":"lookup_order"},"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async deleteTool(toolId) {
    const logTag = '[deleteTool]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/tool/${ toolId }`, method: 'delete' })
  }

  // ==================================================================================
  // Squads
  // ==================================================================================

  /**
   * @operationName Create Squad
   * @category Squads
   * @description Creates a squad — an ordered group of assistants that can hand a live call off to each other (e.g. a triage assistant that transfers to billing or technical support). Each member references a saved assistant (assistantId) or embeds a transient assistant, and may define assistantDestinations describing where it can transfer. Use the squad's id in Create Call or as a phone number's inbound handler. Returns the created squad.
   * @route POST /create-squad
   *
   * @paramDef {"type":"Array<Object>","label":"Members","name":"members","required":true,"description":"Squad members in order; the first member starts the call. E.g. [{\"assistantId\":\"...\",\"assistantDestinations\":[{\"type\":\"assistant\",\"assistantName\":\"Billing\",\"message\":\"Transferring you to billing.\",\"description\":\"Billing questions\"}]},{\"assistantId\":\"...\"}]."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Squad name shown in the dashboard and dictionaries."}
   * @paramDef {"type":"Object","label":"Members Overrides","name":"membersOverrides","description":"Assistant overrides applied to every member when the squad runs, e.g. {\"voice\":{\"provider\":\"11labs\",\"voiceId\":\"burt\"}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","name":"Support Squad","members":[{"assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","assistantDestinations":[{"type":"assistant","assistantName":"Billing","message":"Transferring you to billing."}]},{"assistantId":"8e0f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c"}],"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createSquad(members, name, membersOverrides) {
    const logTag = '[createSquad]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/squad`,
      method: 'post',
      body: clean({ name, members, membersOverrides }),
    })
  }

  /**
   * @operationName List Squads
   * @category Squads
   * @description Lists the squads in your Vapi organization, newest first, with their member assistants and hand-off destinations. Returns up to Limit squads (max 1000).
   * @route GET /list-squads
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of squads to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return squads created strictly after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return squads created strictly before this ISO 8601 timestamp. Use for paging older results."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","name":"Support Squad","members":[{"assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b"},{"assistantId":"8e0f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c"}],"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}]
   */
  async listSquads(limit, createdAtGt, createdAtLt) {
    const logTag = '[listSquads]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/squad`,
      method: 'get',
      query: { limit, createdAtGt, createdAtLt },
    })
  }

  /**
   * @operationName Get Squad
   * @category Squads
   * @description Retrieves a single squad with its full member list, hand-off destinations, and member overrides.
   * @route GET /get-squad
   *
   * @paramDef {"type":"String","label":"Squad","name":"squadId","required":true,"dictionary":"getSquadsDictionary","description":"The squad to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","name":"Support Squad","members":[{"assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","assistantDestinations":[{"type":"assistant","assistantName":"Billing","message":"Transferring you to billing."}]},{"assistantId":"8e0f2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c"}],"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async getSquad(squadId) {
    const logTag = '[getSquad]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/squad/${ squadId }`, method: 'get' })
  }

  /**
   * @operationName Update Squad
   * @category Squads
   * @description Updates a squad's name, members, or member overrides. Members, when provided, replace the entire member list. Returns the updated squad.
   * @route PATCH /update-squad
   *
   * @paramDef {"type":"String","label":"Squad","name":"squadId","required":true,"dictionary":"getSquadsDictionary","description":"The squad to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New squad name."}
   * @paramDef {"type":"Array<Object>","label":"Members","name":"members","description":"Replacement member list in order, e.g. [{\"assistantId\":\"...\"},{\"assistantId\":\"...\"}]. Replaces all existing members."}
   * @paramDef {"type":"Object","label":"Members Overrides","name":"membersOverrides","description":"Replacement assistant overrides applied to every member."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","name":"Support Squad v2","members":[{"assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b"}],"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async updateSquad(squadId, name, members, membersOverrides) {
    const logTag = '[updateSquad]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/squad/${ squadId }`,
      method: 'patch',
      body: clean({ name, members, membersOverrides }),
    })
  }

  /**
   * @operationName Delete Squad
   * @category Squads
   * @description Permanently deletes a squad. Phone numbers routing inbound calls to it must be re-pointed. This cannot be undone. Returns the deleted squad object.
   * @route DELETE /delete-squad
   *
   * @paramDef {"type":"String","label":"Squad","name":"squadId","required":true,"dictionary":"getSquadsDictionary","description":"The squad to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","name":"Support Squad","members":[{"assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b"}],"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async deleteSquad(squadId) {
    const logTag = '[deleteSquad]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/squad/${ squadId }`, method: 'delete' })
  }

  // ==================================================================================
  // Chat
  // ==================================================================================

  /**
   * @operationName Create Chat
   * @category Chat
   * @description Sends a text message to an assistant and returns its reply — the same assistant configuration used for voice calls, over text. Continue a conversation by passing the previous chat's id as Previous Chat ID, or group related chats under a Session ID. The response's output array contains the assistant's reply messages. Streaming is disabled; the full response is returned in one shot.
   * @route POST /create-chat
   *
   * @paramDef {"type":"String","label":"Input","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the assistant."}
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"The saved assistant that answers. Provide this, a transient Assistant Config, or a Squad."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"A squad to answer the chat. Alternative to Assistant."}
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","description":"Session to attach this chat to, sharing conversation context across chats. Create one with Create Session."}
   * @paramDef {"type":"String","label":"Previous Chat ID","name":"previousChatId","description":"ID of the previous chat in the conversation; its history is used as context. Alternative to Session ID."}
   * @paramDef {"type":"String","label":"Chat Name","name":"name","description":"Optional label for the chat (max 40 characters)."}
   * @paramDef {"type":"Object","label":"Assistant Config (Transient)","name":"assistant","description":"Full transient assistant configuration used only for this chat, instead of a saved assistant."}
   * @paramDef {"type":"Object","label":"Assistant Overrides","name":"assistantOverrides","description":"Partial overrides applied on top of the saved assistant for this chat only, e.g. {\"variableValues\":{\"customerName\":\"Jane\"}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","input":"What are your business hours?","output":[{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"messages":[{"role":"user","content":"What are your business hours?"},{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"cost":0.004,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:02.000Z"}
   */
  async createChat(input, assistantId, squadId, sessionId, previousChatId, name, assistant, assistantOverrides) {
    const logTag = '[createChat]'

    const body = clean({
      input,
      assistantId,
      assistant,
      assistantOverrides,
      squadId,
      sessionId,
      previousChatId,
      name,
      stream: false,
    })

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/chat`, method: 'post', body })
  }

  /**
   * @operationName List Chats
   * @category Chat
   * @description Lists text chats in your Vapi organization with optional filtering by assistant, squad, or session. Returns a paginated response: results (the chat objects) plus metadata with currentPage, totalItems, and nextCursor.
   * @route GET /list-chats
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"Only return chats answered by this assistant."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"Only return chats answered by this squad."}
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","description":"Only return chats attached to this session."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of chats to return per page (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return chats created at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return chats created at or before this ISO 8601 timestamp."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","input":"What are your business hours?","output":[{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"cost":0.004,"createdAt":"2026-07-17T10:00:00.000Z"}],"metadata":{"itemsPerPage":100,"totalItems":1,"currentPage":1}}
   */
  async listChats(assistantId, squadId, sessionId, limit, sortOrder, createdAtGe, createdAtLe) {
    const logTag = '[listChats]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/chat`,
      method: 'get',
      query: {
        assistantId,
        squadId,
        sessionId,
        limit,
        sortOrder: this.#resolveChoice(sortOrder, SORT_ORDER_MAP),
        createdAtGe,
        createdAtLe,
      },
    })
  }

  /**
   * @operationName Get Chat
   * @category Chat
   * @description Retrieves a single text chat with its input, the assistant's output messages, full message history, cost, and session linkage.
   * @route GET /get-chat
   *
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"description":"The ID of the chat to retrieve (returned by Create Chat or List Chats)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","sessionId":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","input":"What are your business hours?","output":[{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"messages":[{"role":"user","content":"What are your business hours?"},{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"cost":0.004,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:02.000Z"}
   */
  async getChat(chatId) {
    const logTag = '[getChat]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/chat/${ chatId }`, method: 'get' })
  }

  /**
   * @operationName Delete Chat
   * @category Chat
   * @description Deletes a text chat and its message history. This cannot be undone. Returns the deleted chat object.
   * @route DELETE /delete-chat
   *
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"description":"The ID of the chat to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","input":"What are your business hours?","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:02.000Z"}
   */
  async deleteChat(chatId) {
    const logTag = '[deleteChat]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/chat/${ chatId }`, method: 'delete' })
  }

  // ==================================================================================
  // Sessions
  // ==================================================================================

  /**
   * @operationName Create Session
   * @category Sessions
   * @description Creates a session — a persistent conversation context that multiple chats (and calls) can share. Attach chats to it via Session ID in Create Chat so the assistant remembers the whole conversation. Sessions expire after Expiration Seconds of inactivity (default 24 hours). Returns the created session with its id.
   * @route POST /create-session
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional label for the session (max 40 characters)."}
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"The assistant this session's conversations use."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"The squad this session's conversations use. Alternative to Assistant."}
   * @paramDef {"type":"Number","label":"Expiration (Seconds)","name":"expirationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds of inactivity before the session expires (60 to 2592000). Defaults to 86400 (24 hours)."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional CreateSessionDTO fields merged into the request body, e.g. {\"customer\":{\"number\":\"+14155551234\"},\"phoneNumberId\":\"...\"}. See https://docs.vapi.ai/api-reference/sessions/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","name":"Jane's onboarding","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","expirationSeconds":86400,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createSession(name, assistantId, squadId, expirationSeconds, advancedConfig) {
    const logTag = '[createSession]'

    const body = {
      ...clean({ name, assistantId, squadId, expirationSeconds }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/session`, method: 'post', body })
  }

  /**
   * @operationName List Sessions
   * @category Sessions
   * @description Lists conversation sessions in your Vapi organization with optional filtering by assistant or squad. Returns a paginated response: results (the session objects) plus metadata with currentPage, totalItems, and nextCursor.
   * @route GET /list-sessions
   *
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"Only return sessions using this assistant."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"Only return sessions using this squad."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sessions to return per page (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return sessions created at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return sessions created at or before this ISO 8601 timestamp."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","name":"Jane's onboarding","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","expirationSeconds":86400,"createdAt":"2026-07-17T10:00:00.000Z"}],"metadata":{"itemsPerPage":100,"totalItems":1,"currentPage":1}}
   */
  async listSessions(assistantId, squadId, limit, sortOrder, createdAtGe, createdAtLe) {
    const logTag = '[listSessions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/session`,
      method: 'get',
      query: {
        assistantId,
        squadId,
        limit,
        sortOrder: this.#resolveChoice(sortOrder, SORT_ORDER_MAP),
        createdAtGe,
        createdAtLe,
      },
    })
  }

  /**
   * @operationName Get Session
   * @category Sessions
   * @description Retrieves a single session with its status, assistant or squad, accumulated messages, and expiration settings.
   * @route GET /get-session
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"The ID of the session to retrieve (returned by Create Session or List Sessions)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","name":"Jane's onboarding","status":"active","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","messages":[{"role":"user","content":"What are your business hours?"},{"role":"assistant","content":"We're open Monday through Friday, 9am to 6pm Eastern."}],"expirationSeconds":86400,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:05:00.000Z"}
   */
  async getSession(sessionId) {
    const logTag = '[getSession]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/session/${ sessionId }`, method: 'get' })
  }

  /**
   * @operationName Update Session
   * @category Sessions
   * @description Updates a session's name, status, or expiration. Set Status to Completed to close the session so no further chats can be attached. Returns the updated session.
   * @route PATCH /update-session
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"The ID of the session to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New label for the session."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Completed"]}},"description":"Set to Completed to close the session."}
   * @paramDef {"type":"Number","label":"Expiration (Seconds)","name":"expirationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New inactivity expiration in seconds (60 to 2592000)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","name":"Jane's onboarding","status":"completed","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async updateSession(sessionId, name, status, expirationSeconds) {
    const logTag = '[updateSession]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/session/${ sessionId }`,
      method: 'patch',
      body: clean({
        name,
        status: this.#resolveChoice(status, SESSION_STATUS_MAP),
        expirationSeconds,
      }),
    })
  }

  /**
   * @operationName Delete Session
   * @category Sessions
   * @description Deletes a session and its stored conversation context. Chats previously attached to it remain but lose the shared context. This cannot be undone. Returns the deleted session object.
   * @route DELETE /delete-session
   *
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"The ID of the session to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"7a8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d","name":"Jane's onboarding","status":"completed","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async deleteSession(sessionId) {
    const logTag = '[deleteSession]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/session/${ sessionId }`, method: 'delete' })
  }

  // ==================================================================================
  // Files
  // ==================================================================================

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file from FlowRunner file storage (or any accessible URL) to Vapi for use in knowledge bases and Query tools. Supported formats include PDF, TXT, Markdown, DOCX, and CSV; Vapi parses the text automatically after upload. Returns the created file object with its id — reference it from a knowledge base or Query tool.
   * @route POST /upload-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are downloaded and streamed to Vapi as multipart form data."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Filename to store with the uploaded file, e.g. 'faq.pdf'. Defaults to the original filename from the URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","object":"file","status":"done","name":"faq.pdf","originalName":"faq.pdf","bytes":52480,"mimetype":"application/pdf","url":"https://storage.vapi.ai/8b9c0d1e-faq.pdf","parsedTextUrl":"https://storage.vapi.ai/8b9c0d1e-faq.txt","parsedTextBytes":18230,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:05.000Z"}
   */
  async uploadFile(fileUrl, filename) {
    const logTag = '[uploadFile]'

    try {
      const buffer = await this.#downloadBuffer(fileUrl, logTag)
      const resolvedName = filename ||
        decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) ||
        `upload_${ Date.now() }`

      logger.debug(`${ logTag } - uploading '${ resolvedName }' (${ buffer.length } bytes) to Vapi`)

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      formData.append('file', buffer, { filename: resolvedName })

      return await Flowrunner.Request.post(`${ API_BASE_URL }/file`)
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })
        .form(formData)
    } catch (error) {
      const message = error.body?.message || error.message

      logger.error(`${ logTag } - upload failed: ${ message }`)

      throw new Error(`Vapi API error: ${ message }`)
    }
  }

  /**
   * @operationName List Files
   * @category Files
   * @description Lists the files uploaded to your Vapi organization with their parse status, size, MIME type, and storage URLs.
   * @route GET /list-files
   *
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","description":"Filter files by purpose, e.g. 'assistant'. Some Vapi API versions require this filter; leave empty to list all files."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e","object":"file","status":"done","name":"faq.pdf","originalName":"faq.pdf","bytes":52480,"mimetype":"application/pdf","url":"https://storage.vapi.ai/8b9c0d1e-faq.pdf","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:05.000Z"}]
   */
  async listFiles(purpose) {
    const logTag = '[listFiles]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/file`,
      method: 'get',
      query: { purpose },
    })
  }

  /**
   * @operationName Get File
   * @category Files
   * @description Retrieves a single uploaded file with its parse status, size, MIME type, storage URL, and parsed-text URL.
   * @route GET /get-file
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the file to retrieve (returned by Upload File or List Files)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e","object":"file","status":"done","name":"faq.pdf","originalName":"faq.pdf","bytes":52480,"mimetype":"application/pdf","url":"https://storage.vapi.ai/8b9c0d1e-faq.pdf","parsedTextUrl":"https://storage.vapi.ai/8b9c0d1e-faq.txt","parsedTextBytes":18230,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:05.000Z"}
   */
  async getFile(fileId) {
    const logTag = '[getFile]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/file/${ fileId }`, method: 'get' })
  }

  /**
   * @operationName Rename File
   * @category Files
   * @description Renames an uploaded file. The file's content and id are unchanged. Returns the updated file object.
   * @route PATCH /rename-file
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the file to rename."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"description":"New display name for the file (1-40 characters)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e","object":"file","status":"done","name":"faq-2026.pdf","originalName":"faq.pdf","bytes":52480,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async renameFile(fileId, name) {
    const logTag = '[renameFile]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/file/${ fileId }`,
      method: 'patch',
      body: { name },
    })
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Permanently deletes an uploaded file. Knowledge bases and Query tools referencing it will no longer find it. This cannot be undone. Returns the deleted file object.
   * @route DELETE /delete-file
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the file to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"8b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e","object":"file","status":"done","name":"faq.pdf","bytes":52480,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:05.000Z"}
   */
  async deleteFile(fileId) {
    const logTag = '[deleteFile]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/file/${ fileId }`, method: 'delete' })
  }

  // ==================================================================================
  // Campaigns
  // ==================================================================================

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Creates an outbound calling campaign that dials a list of customers at scale with an assistant, squad, or workflow. Provide the customer list, the phone number to dial from, and optionally a schedule window (Earliest At / Latest At) to control when dialing happens. Track progress with Get Campaign (per-status call counters) and stop it early via Update Campaign with Status = Ended. Returns the created campaign.
   * @route POST /create-campaign
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Campaign name shown in the dashboard, e.g. 'Q3 renewal outreach'."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","dictionary":"getPhoneNumbersDictionary","description":"The Vapi phone number the campaign dials from."}
   * @paramDef {"type":"Array<Object>","label":"Customers","name":"customers","description":"Customers to call, e.g. [{\"number\":\"+14155551234\",\"name\":\"Jane\"},{\"number\":\"+14155556789\"}]. Numbers must be E.164."}
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"The assistant that handles the campaign calls. Provide this, a Squad, or a Workflow ID."}
   * @paramDef {"type":"String","label":"Squad","name":"squadId","dictionary":"getSquadsDictionary","description":"The squad that handles the campaign calls. Alternative to Assistant."}
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","description":"The workflow that handles the campaign calls. Alternative to Assistant."}
   * @paramDef {"type":"String","label":"Earliest At","name":"earliestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp of the earliest moment campaign calls may start. Leave empty to start immediately."}
   * @paramDef {"type":"String","label":"Latest At","name":"latestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp of the latest moment campaign calls may start."}
   * @paramDef {"type":"Number","label":"Max Concurrency","name":"maxConcurrency","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaign calls running at the same time."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional CreateCampaignDTO fields merged into the request body, e.g. {\"assistantOverrides\":{...},\"dialPlan\":[...],\"duplicateFromCampaignId\":\"...\"}. See https://docs.vapi.ai/api-reference/campaigns/create."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","orgId":"5c5f1c6e-8a2b-4d3c-9e7f-1a2b3c4d5e6f","name":"Q3 renewal outreach","status":"scheduled","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","phoneNumberId":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","customers":[{"number":"+14155551234","name":"Jane"}],"callsCounterScheduled":1,"callsCounterQueued":0,"callsCounterInProgress":0,"callsCounterEnded":0,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T10:00:00.000Z"}
   */
  async createCampaign(name, phoneNumberId, customers, assistantId, squadId, workflowId, earliestAt, latestAt, maxConcurrency, advancedConfig) {
    const logTag = '[createCampaign]'

    const body = {
      ...clean({
        name,
        phoneNumberId,
        customers,
        assistantId,
        squadId,
        workflowId,
        maxConcurrency,
        schedulePlan: (earliestAt || latestAt) ? clean({ earliestAt, latestAt }) : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/campaign`, method: 'post', body })
  }

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists outbound campaigns in your Vapi organization with their status and per-status call counters (scheduled, queued, in progress, ended, voicemail). Returns a paginated response: results plus metadata with currentPage and totalItems.
   * @route GET /list-campaigns
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Scheduled","In Progress","Ended","Cancelled","Archived"]}},"description":"Only return campaigns in this status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaigns to return per page (max 1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAtGe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return campaigns created at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdAtLe","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return campaigns created at or before this ISO 8601 timestamp."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","name":"Q3 renewal outreach","status":"in-progress","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","callsCounterScheduled":40,"callsCounterInProgress":5,"callsCounterEnded":55,"createdAt":"2026-07-17T10:00:00.000Z"}],"metadata":{"itemsPerPage":100,"totalItems":1,"currentPage":1}}
   */
  async listCampaigns(status, limit, sortOrder, createdAtGe, createdAtLe) {
    const logTag = '[listCampaigns]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/campaign`,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, CAMPAIGN_STATUS_FILTER_MAP),
        limit,
        sortOrder: this.#resolveChoice(sortOrder, SORT_ORDER_MAP),
        createdAtGe,
        createdAtLe,
      },
    })
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single campaign with its status, ended reason, customer list, schedule, and live call counters (scheduled, queued, in progress, ended, voicemail). Use this to track campaign progress.
   * @route GET /get-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","name":"Q3 renewal outreach","status":"in-progress","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","phoneNumberId":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","customers":[{"number":"+14155551234","name":"Jane"}],"schedulePlan":{"earliestAt":"2026-07-17T14:00:00.000Z"},"callsCounterScheduled":40,"callsCounterQueued":2,"callsCounterInProgress":5,"callsCounterEndedVoicemail":8,"callsCounterEnded":55,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T11:00:00.000Z"}
   */
  async getCampaign(campaignId) {
    const logTag = '[getCampaign]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/campaign/${ campaignId }`, method: 'get' })
  }

  /**
   * @operationName Update Campaign
   * @category Campaigns
   * @description Updates a campaign. Set Status to Ended or Cancelled to stop dialing (this is how you end a running campaign early). Other fields — name, handler, phone number, schedule — can only be changed while the campaign has not started calling. Returns the updated campaign.
   * @route PATCH /update-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Ended","Cancelled"]}},"description":"Set to Ended or Cancelled to stop the campaign. Calls already in progress finish; no new calls are placed."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New campaign name (only before dialing starts)."}
   * @paramDef {"type":"String","label":"Assistant","name":"assistantId","dictionary":"getAssistantsDictionary","description":"New assistant to handle the calls (only before dialing starts)."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumberId","dictionary":"getPhoneNumbersDictionary","description":"New phone number to dial from (only before dialing starts)."}
   * @paramDef {"type":"String","label":"Earliest At","name":"earliestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New earliest start time, ISO 8601 (only before dialing starts)."}
   * @paramDef {"type":"String","label":"Latest At","name":"latestAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New latest start time, ISO 8601 (only before dialing starts)."}
   * @paramDef {"type":"Object","label":"Advanced Config","name":"advancedConfig","description":"Additional UpdateCampaignDTO fields merged into the request body, e.g. {\"squadId\":\"...\",\"workflowId\":\"...\",\"dialPlan\":[...]}. See https://docs.vapi.ai/api-reference/campaigns/update."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","name":"Q3 renewal outreach","status":"ended","endedReason":"campaign.ended.by-user","callsCounterEnded":60,"createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async updateCampaign(campaignId, status, name, assistantId, phoneNumberId, earliestAt, latestAt, advancedConfig) {
    const logTag = '[updateCampaign]'

    const body = {
      ...clean({
        status: this.#resolveChoice(status, CAMPAIGN_STATUS_UPDATE_MAP),
        name,
        assistantId,
        phoneNumberId,
        schedulePlan: (earliestAt || latestAt) ? clean({ earliestAt, latestAt }) : undefined,
      }),
      ...(advancedConfig || {}),
    }

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/campaign/${ campaignId }`, method: 'patch', body })
  }

  /**
   * @operationName Delete Campaign
   * @category Campaigns
   * @description Permanently deletes a campaign and its configuration. Calls already placed by the campaign remain in call history. This cannot be undone. Returns the deleted campaign object.
   * @route DELETE /delete-campaign
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The campaign to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","name":"Q3 renewal outreach","status":"ended","createdAt":"2026-07-17T10:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z"}
   */
  async deleteCampaign(campaignId) {
    const logTag = '[deleteCampaign]'

    return await this.#apiRequest({ logTag, url: `${ API_BASE_URL }/campaign/${ campaignId }`, method: 'delete' })
  }

  // ==================================================================================
  // Analytics
  // ==================================================================================

  /**
   * @operationName Run Analytics Query
   * @category Analytics
   * @description Runs an aggregation query over your Vapi call (or subscription) data and returns the computed results — e.g. total call count, summed cost, or average duration, optionally grouped by assistant, status, or ended reason and bucketed over a time range. Operations are objects like {"operation":"count","column":"id"} or {"operation":"sum","column":"cost"}; supported operations are sum, avg, count, min, max, and history, over columns such as id, cost, duration, and costBreakdown.* fields.
   * @route POST /run-analytics-query
   *
   * @paramDef {"type":"String","label":"Query Name","name":"queryName","required":true,"description":"Unique name identifying this query in the response, e.g. 'call_totals'."}
   * @paramDef {"type":"Array<Object>","label":"Operations","name":"operations","required":true,"description":"Aggregations to compute, e.g. [{\"operation\":\"count\",\"column\":\"id\"},{\"operation\":\"sum\",\"column\":\"cost\"},{\"operation\":\"avg\",\"column\":\"duration\"}]. Operations: sum, avg, count, min, max, history."}
   * @paramDef {"type":"String","label":"Table","name":"table","defaultValue":"Call","uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Subscription"]}},"description":"The dataset to query. Defaults to Call."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groupBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Type","Assistant ID","Ended Reason","Success Evaluation","Status"]}},"description":"Dimensions to group the results by."}
   * @paramDef {"type":"String","label":"Time Range Start","name":"timeRangeStart","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the queried time range, ISO 8601. Defaults to the API's standard window when omitted."}
   * @paramDef {"type":"String","label":"Time Range End","name":"timeRangeEnd","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the queried time range, ISO 8601."}
   * @paramDef {"type":"String","label":"Time Step","name":"timeRangeStep","uiComponent":{"type":"DROPDOWN","options":{"values":["Second","Minute","Hour","Day","Week","Month","Quarter","Year"]}},"description":"Bucket size for time-series results (used with the history operation)."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"IANA timezone for time bucketing, e.g. 'America/New_York'. Defaults to UTC."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"name":"call_totals","timeRange":{"start":"2026-07-01T00:00:00.000Z","end":"2026-07-17T00:00:00.000Z","step":"day","timezone":"UTC"},"result":[{"date":"2026-07-16","assistantId":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","countId":42,"sumCost":5.04}]}]
   */
  async runAnalyticsQuery(queryName, operations, table, groupBy, timeRangeStart, timeRangeEnd, timeRangeStep, timezone) {
    const logTag = '[runAnalyticsQuery]'

    const timeRange = clean({
      start: timeRangeStart,
      end: timeRangeEnd,
      step: this.#resolveChoice(timeRangeStep, ANALYTICS_STEP_MAP),
      timezone,
    })

    const query = clean({
      name: queryName,
      table: this.#resolveChoice(table, ANALYTICS_TABLE_MAP) || 'call',
      operations,
      groupBy: Array.isArray(groupBy) && groupBy.length
        ? groupBy.map(value => this.#resolveChoice(value, ANALYTICS_GROUP_BY_MAP))
        : undefined,
      timeRange: Object.keys(timeRange).length ? timeRange : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/analytics`,
      method: 'post',
      body: { queries: [query] },
    })
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getAssistantsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to assistant names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the createdAt of the last item of the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Assistants Dictionary
   * @description Lists the saved assistants in your Vapi organization for selection in assistant parameters. The option value is the assistant id.
   * @route POST /get-assistants-dictionary
   * @paramDef {"type":"getAssistantsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support Agent","value":"7d9e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b","note":"openai/gpt-4o"}],"cursor":null}
   */
  async getAssistantsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#listDictionary({
      logTag: '[getAssistantsDictionary]',
      path: '/assistant',
      search,
      cursor,
      mapItem: assistant => ({
        label: assistant.name || assistant.id,
        value: assistant.id,
        note: assistant.model ? `${ assistant.model.provider }/${ assistant.model.model }` : undefined,
      }),
    })
  }

  /**
   * @typedef {Object} getPhoneNumbersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to phone numbers and their labels."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the createdAt of the last item of the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Phone Numbers Dictionary
   * @description Lists the phone numbers in your Vapi organization for selection in phone number parameters. The option value is the phone number id.
   * @route POST /get-phone-numbers-dictionary
   * @paramDef {"type":"getPhoneNumbersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"+14155559876 (Main Support Line)","value":"1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d","note":"vapi"}],"cursor":null}
   */
  async getPhoneNumbersDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#listDictionary({
      logTag: '[getPhoneNumbersDictionary]',
      path: '/phone-number',
      search,
      cursor,
      mapItem: phoneNumber => {
        const number = phoneNumber.number || phoneNumber.sipUri || phoneNumber.id

        return {
          label: phoneNumber.name ? `${ number } (${ phoneNumber.name })` : number,
          value: phoneNumber.id,
          note: phoneNumber.provider,
        }
      },
    })
  }

  /**
   * @typedef {Object} getSquadsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to squad names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the createdAt of the last item of the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Squads Dictionary
   * @description Lists the squads in your Vapi organization for selection in squad parameters. The option value is the squad id.
   * @route POST /get-squads-dictionary
   * @paramDef {"type":"getSquadsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support Squad","value":"5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b","note":"2 members"}],"cursor":null}
   */
  async getSquadsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#listDictionary({
      logTag: '[getSquadsDictionary]',
      path: '/squad',
      search,
      cursor,
      mapItem: squad => ({
        label: squad.name || squad.id,
        value: squad.id,
        note: Array.isArray(squad.members) ? `${ squad.members.length } members` : undefined,
      }),
    })
  }

  /**
   * @typedef {Object} getToolsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to tool names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the createdAt of the last item of the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Tools Dictionary
   * @description Lists the tools in your Vapi organization for selection in tool parameters. The option value is the tool id.
   * @route POST /get-tools-dictionary
   * @paramDef {"type":"getToolsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"lookup_order","value":"3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f","note":"function"}],"cursor":null}
   */
  async getToolsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#listDictionary({
      logTag: '[getToolsDictionary]',
      path: '/tool',
      search,
      cursor,
      mapItem: tool => ({
        label: tool.function?.name || tool.name || tool.id,
        value: tool.id,
        note: tool.type,
      }),
    })
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to campaign names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the createdAt of the last item of the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Campaigns Dictionary
   * @description Lists the outbound campaigns in your Vapi organization for selection in campaign parameters. The option value is the campaign id.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Q3 renewal outreach","value":"9c0d1e2f-3a4b-5c6d-7e8f-9a0b1c2d3e4f","note":"in-progress"}],"cursor":null}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#listDictionary({
      logTag: '[getCampaignsDictionary]',
      path: '/campaign',
      search,
      cursor,
      mapItem: campaign => ({
        label: campaign.name || campaign.id,
        value: campaign.id,
        note: campaign.status,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(VapiService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Vapi private API key. Get it from the Vapi Dashboard (dashboard.vapi.ai) under Organization Settings -> API Keys.',
  },
])
