'use strict'

const API_BASE_URL = 'https://meet.googleapis.com/v2'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.settings',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const ACCESS_TYPE_MAPPING = {
  'Open': 'OPEN',
  'Trusted': 'TRUSTED',
  'Restricted': 'RESTRICTED',
}

const ENTRY_POINT_ACCESS_MAPPING = {
  'All Entry Points': 'ALL',
  'Creator App Only': 'CREATOR_APP_ONLY',
}

const RESTRICTION_TYPE_MAPPING = {
  'Hosts Only': 'HOSTS_ONLY',
  'No Restriction': 'NO_RESTRICTION',
}

const logger = {
  info: (...args) => console.log('[Google Meet Service] info:', ...args),
  debug: (...args) => console.log('[Google Meet Service] debug:', ...args),
  error: (...args) => console.log('[Google Meet Service] error:', ...args),
  warn: (...args) => console.log('[Google Meet Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Meet
 * @integrationIcon /icon.png
 **/
class GoogleMeetService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query)
        .send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Google Meet API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #toOnOff(value) {
    if (value === true) return 'ON'
    if (value === false) return 'OFF'

    return undefined
  }

  #normalizeSpaceName(space) {
    const value = String(space).trim().replace(/^https?:\/\/meet\.google\.com\//i, '')

    return value.startsWith('spaces/') ? value : `spaces/${ value }`
  }

  #normalizeConferenceRecordName(conferenceRecord) {
    const value = String(conferenceRecord).trim()

    return value.startsWith('conferenceRecords/') ? value : `conferenceRecords/${ value }`
  }

  #resolveResourceName(id, parentName, collection) {
    const value = String(id).trim()

    return value.includes('/') ? value : `${ parentName }/${ collection }/${ value }`
  }

  #buildSpaceConfig({
    accessType,
    entryPointAccess,
    moderation,
    chatRestriction,
    reactionRestriction,
    presentRestriction,
    defaultJoinAsViewer,
    generateAttendanceReport,
    autoRecording,
    autoTranscription,
    autoSmartNotes,
  }) {
    const config = {}
    const updateMask = []

    const resolvedAccessType = this.#resolveChoice(accessType, ACCESS_TYPE_MAPPING)

    if (resolvedAccessType) {
      config.accessType = resolvedAccessType
      updateMask.push('config.accessType')
    }

    const resolvedEntryPointAccess = this.#resolveChoice(entryPointAccess, ENTRY_POINT_ACCESS_MAPPING)

    if (resolvedEntryPointAccess) {
      config.entryPointAccess = resolvedEntryPointAccess
      updateMask.push('config.entryPointAccess')
    }

    const moderationValue = this.#toOnOff(moderation)

    if (moderationValue) {
      config.moderation = moderationValue
      updateMask.push('config.moderation')
    }

    const moderationRestrictions = {}

    const resolvedChatRestriction = this.#resolveChoice(chatRestriction, RESTRICTION_TYPE_MAPPING)

    if (resolvedChatRestriction) {
      moderationRestrictions.chatRestriction = resolvedChatRestriction
      updateMask.push('config.moderationRestrictions.chatRestriction')
    }

    const resolvedReactionRestriction = this.#resolveChoice(reactionRestriction, RESTRICTION_TYPE_MAPPING)

    if (resolvedReactionRestriction) {
      moderationRestrictions.reactionRestriction = resolvedReactionRestriction
      updateMask.push('config.moderationRestrictions.reactionRestriction')
    }

    const resolvedPresentRestriction = this.#resolveChoice(presentRestriction, RESTRICTION_TYPE_MAPPING)

    if (resolvedPresentRestriction) {
      moderationRestrictions.presentRestriction = resolvedPresentRestriction
      updateMask.push('config.moderationRestrictions.presentRestriction')
    }

    const defaultJoinAsViewerValue = this.#toOnOff(defaultJoinAsViewer)

    if (defaultJoinAsViewerValue) {
      moderationRestrictions.defaultJoinAsViewerType = defaultJoinAsViewerValue
      updateMask.push('config.moderationRestrictions.defaultJoinAsViewerType')
    }

    if (Object.keys(moderationRestrictions).length > 0) {
      config.moderationRestrictions = moderationRestrictions
    }

    if (generateAttendanceReport === true || generateAttendanceReport === false) {
      config.attendanceReportGenerationType = generateAttendanceReport ? 'GENERATE_REPORT' : 'DO_NOT_GENERATE'
      updateMask.push('config.attendanceReportGenerationType')
    }

    const artifactConfig = {}
    const autoRecordingValue = this.#toOnOff(autoRecording)

    if (autoRecordingValue) {
      artifactConfig.recordingConfig = { autoRecordingGeneration: autoRecordingValue }
      updateMask.push('config.artifactConfig.recordingConfig.autoRecordingGeneration')
    }

    const autoTranscriptionValue = this.#toOnOff(autoTranscription)

    if (autoTranscriptionValue) {
      artifactConfig.transcriptionConfig = { autoTranscriptionGeneration: autoTranscriptionValue }
      updateMask.push('config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration')
    }

    const autoSmartNotesValue = this.#toOnOff(autoSmartNotes)

    if (autoSmartNotesValue) {
      artifactConfig.smartNotesConfig = { autoSmartNotesGeneration: autoSmartNotesValue }
      updateMask.push('config.artifactConfig.smartNotesConfig.autoSmartNotesGeneration')
    }

    if (Object.keys(artifactConfig).length > 0) {
      config.artifactConfig = artifactConfig
    }

    return { config, updateMask }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    logger.debug('[executeCallback] code exchange completed')

    let userData = {}
    let connectionIdentityName = 'Google Meet Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getConferenceRecordsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter conference records by resource name or space. Filtering is performed locally on the retrieved page of results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Conference Records Dictionary
   * @category Conference Records
   * @description Lists recent conference records (past and ongoing meetings) for selection in dependent parameters, labeled by start time and status. Records are only available for meetings held in spaces accessible to the authenticated user and are automatically deleted by Google 30 days after the conference ends.
   *
   * @route POST /get-conference-records-dictionary
   *
   * @paramDef {"type":"getConferenceRecordsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering conference records."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"2026-07-15 10:00 UTC (Ended)","value":"conferenceRecords/abc-123-def","note":"Space: spaces/jQCFfuBOdN5z"}],"cursor":"nextPageToken123"}
   */
  async getConferenceRecordsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getConferenceRecordsDictionary',
      url: `${ API_BASE_URL }/conferenceRecords`,
      query: {
        pageSize: 50,
        pageToken: cursor,
      },
    })

    const records = response.conferenceRecords || []

    const filteredRecords = search
      ? searchFilter(records, ['name', 'space', 'startTime'], search)
      : records

    return {
      cursor: response.nextPageToken,
      items: filteredRecords.map(record => {
        const startLabel = record.startTime
          ? `${ new Date(record.startTime).toISOString().replace('T', ' ').substring(0, 16) } UTC`
          : 'Unknown start time'
        const status = record.endTime ? 'Ended' : 'Ongoing'

        return {
          label: `${ startLabel } (${ status })`,
          note: `Space: ${ record.space || 'unknown' }`,
          value: record.name,
        }
      }),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ========================================= MEETING SPACES ==========================================

  /**
   * @description Creates a new Google Meet meeting space and returns its meeting URI and meeting code, which can be shared immediately with attendees. A space is a reusable virtual meeting room — creating it does NOT schedule a meeting at a specific time and does NOT invite anyone. To schedule a meeting with invitees and a start time, create a Google Calendar event with Google Meet conferencing via the Google Calendar service instead. Optional settings control who can join without knocking, moderation, attendance reports, and automatic recording/transcription/smart notes (automatic artifact settings require compatible Google Workspace editions, and smart notes additionally require a Gemini license).
   *
   * @route POST /create-space
   * @operationName Create Meeting Space
   * @category Meeting Spaces
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.created
   *
   * @paramDef {"type":"String","label":"Access Type","name":"accessType","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Trusted","Restricted"]}},"description":"Who can join the meeting without knocking. 'Open': anyone with the join link. 'Trusted': users in the host's organization and invited guests. 'Restricted': only invited participants. If omitted, the default from the user's Google Workspace admin settings is used."}
   * @paramDef {"type":"String","label":"Entry Point Access","name":"entryPointAccess","uiComponent":{"type":"DROPDOWN","options":{"values":["All Entry Points","Creator App Only"]}},"description":"Which entry points may be used to join. 'All Entry Points': the regular Meet web/mobile/room clients. 'Creator App Only': ONLY apps owned by the Google Cloud project that created the space can join — regular Meet links will not work. Leave empty for the default (all entry points)."}
   * @paramDef {"type":"Boolean","label":"Enable Moderation","name":"moderation","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the meeting owner has moderation capabilities and the restriction settings below take effect. Leave empty to keep the default."}
   * @paramDef {"type":"String","label":"Chat Restriction","name":"chatRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can send chat messages when moderation is enabled. 'Hosts Only' limits chat to the meeting owner and co-hosts."}
   * @paramDef {"type":"String","label":"Reaction Restriction","name":"reactionRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can send reactions when moderation is enabled. 'Hosts Only' limits reactions to the meeting owner and co-hosts."}
   * @paramDef {"type":"String","label":"Present Restriction","name":"presentRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can share their screen when moderation is enabled. 'Hosts Only' limits presenting to the meeting owner and co-hosts."}
   * @paramDef {"type":"Boolean","label":"Join As Viewer By Default","name":"defaultJoinAsViewer","uiComponent":{"type":"TOGGLE"},"description":"When enabled (and moderation is on), participants join as viewers by default instead of contributors. Leave empty to keep the default."}
   * @paramDef {"type":"Boolean","label":"Generate Attendance Report","name":"generateAttendanceReport","uiComponent":{"type":"TOGGLE"},"description":"Whether an attendance report should be generated for conferences held in this space. Leave empty to keep the default."}
   * @paramDef {"type":"Boolean","label":"Auto Recording","name":"autoRecording","uiComponent":{"type":"TOGGLE"},"description":"Automatically record conferences held in this space. Requires a Google Workspace edition that supports Meet recording. Leave empty to keep the default."}
   * @paramDef {"type":"Boolean","label":"Auto Transcription","name":"autoTranscription","uiComponent":{"type":"TOGGLE"},"description":"Automatically transcribe conferences held in this space to a Google Docs file. Requires a Google Workspace edition that supports Meet transcripts. Leave empty to keep the default."}
   * @paramDef {"type":"Boolean","label":"Auto Smart Notes","name":"autoSmartNotes","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate AI meeting notes ('take notes for me') for conferences in this space. Requires a Gemini license. Leave empty to keep the default."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/jQCFfuBOdN5z","meetingUri":"https://meet.google.com/abc-mnop-xyz","meetingCode":"abc-mnop-xyz","config":{"accessType":"TRUSTED","entryPointAccess":"ALL"}}
   */
  async createSpace(
    accessType,
    entryPointAccess,
    moderation,
    chatRestriction,
    reactionRestriction,
    presentRestriction,
    defaultJoinAsViewer,
    generateAttendanceReport,
    autoRecording,
    autoTranscription,
    autoSmartNotes
  ) {
    const { config } = this.#buildSpaceConfig({
      accessType,
      entryPointAccess,
      moderation,
      chatRestriction,
      reactionRestriction,
      presentRestriction,
      defaultJoinAsViewer,
      generateAttendanceReport,
      autoRecording,
      autoTranscription,
      autoSmartNotes,
    })

    const body = Object.keys(config).length > 0 ? { config } : {}

    return this.#apiRequest({
      logTag: 'createSpace',
      method: 'post',
      url: `${ API_BASE_URL }/spaces`,
      body,
    })
  }

  /**
   * @description Retrieves details of a Google Meet meeting space, including its meeting URI, meeting code, configuration, and a reference to the currently active conference (if one is in progress). The space can be identified by its resource name (spaces/{space}), by its meeting code (e.g. 'abc-mnop-xyz'), or by a full https://meet.google.com/... link.
   *
   * @route GET /get-space
   * @operationName Get Meeting Space
   * @category Meeting Spaces
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Meeting Space","name":"space","required":true,"description":"The space to retrieve. Accepts a resource name ('spaces/jQCFfuBOdN5z'), a meeting code ('abc-mnop-xyz'), or a full meeting link ('https://meet.google.com/abc-mnop-xyz')."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/jQCFfuBOdN5z","meetingUri":"https://meet.google.com/abc-mnop-xyz","meetingCode":"abc-mnop-xyz","config":{"accessType":"TRUSTED","entryPointAccess":"ALL"},"activeConference":{"conferenceRecord":"conferenceRecords/abc-123-def"}}
   */
  async getSpace(space) {
    if (!space) {
      throw new Error('"Meeting Space" is required')
    }

    return this.#apiRequest({
      logTag: 'getSpace',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }`,
    })
  }

  /**
   * @description Updates the configuration of an existing Google Meet meeting space. Only the settings you provide are changed (an update mask is built automatically); all other settings remain untouched. Note that changing a space's configuration affects future conferences in that space — it does not modify a conference already in progress. Automatic recording/transcription/smart notes settings require compatible Google Workspace editions.
   *
   * @route PATCH /update-space
   * @operationName Update Meeting Space
   * @category Meeting Spaces
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.settings
   *
   * @paramDef {"type":"String","label":"Meeting Space","name":"space","required":true,"description":"The space to update. Accepts a resource name ('spaces/jQCFfuBOdN5z'), a meeting code ('abc-mnop-xyz'), or a full meeting link."}
   * @paramDef {"type":"String","label":"Access Type","name":"accessType","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Trusted","Restricted"]}},"description":"Who can join the meeting without knocking. 'Open': anyone with the join link. 'Trusted': users in the host's organization and invited guests. 'Restricted': only invited participants. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Entry Point Access","name":"entryPointAccess","uiComponent":{"type":"DROPDOWN","options":{"values":["All Entry Points","Creator App Only"]}},"description":"Which entry points may be used to join. 'Creator App Only' means ONLY apps owned by the Google Cloud project that created the space can join. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Enable Moderation","name":"moderation","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the meeting owner has moderation capabilities and the restriction settings below take effect. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Chat Restriction","name":"chatRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can send chat messages when moderation is enabled. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Reaction Restriction","name":"reactionRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can send reactions when moderation is enabled. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Present Restriction","name":"presentRestriction","uiComponent":{"type":"DROPDOWN","options":{"values":["Hosts Only","No Restriction"]}},"description":"Who can share their screen when moderation is enabled. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Join As Viewer By Default","name":"defaultJoinAsViewer","uiComponent":{"type":"TOGGLE"},"description":"When enabled (and moderation is on), participants join as viewers by default instead of contributors. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Generate Attendance Report","name":"generateAttendanceReport","uiComponent":{"type":"TOGGLE"},"description":"Whether an attendance report should be generated for conferences held in this space. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Auto Recording","name":"autoRecording","uiComponent":{"type":"TOGGLE"},"description":"Automatically record conferences held in this space. Requires a Google Workspace edition that supports Meet recording. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Auto Transcription","name":"autoTranscription","uiComponent":{"type":"TOGGLE"},"description":"Automatically transcribe conferences held in this space to a Google Docs file. Requires a Google Workspace edition that supports Meet transcripts. Leave empty to keep the current value."}
   * @paramDef {"type":"Boolean","label":"Auto Smart Notes","name":"autoSmartNotes","uiComponent":{"type":"TOGGLE"},"description":"Automatically generate AI meeting notes for conferences in this space. Requires a Gemini license. Leave empty to keep the current value."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/jQCFfuBOdN5z","meetingUri":"https://meet.google.com/abc-mnop-xyz","meetingCode":"abc-mnop-xyz","config":{"accessType":"RESTRICTED","entryPointAccess":"ALL","moderation":"ON","moderationRestrictions":{"chatRestriction":"HOSTS_ONLY"}}}
   */
  async updateSpace(
    space,
    accessType,
    entryPointAccess,
    moderation,
    chatRestriction,
    reactionRestriction,
    presentRestriction,
    defaultJoinAsViewer,
    generateAttendanceReport,
    autoRecording,
    autoTranscription,
    autoSmartNotes
  ) {
    if (!space) {
      throw new Error('"Meeting Space" is required')
    }

    const { config, updateMask } = this.#buildSpaceConfig({
      accessType,
      entryPointAccess,
      moderation,
      chatRestriction,
      reactionRestriction,
      presentRestriction,
      defaultJoinAsViewer,
      generateAttendanceReport,
      autoRecording,
      autoTranscription,
      autoSmartNotes,
    })

    if (updateMask.length === 0) {
      throw new Error('At least one configuration setting must be provided to update the space')
    }

    return this.#apiRequest({
      logTag: 'updateSpace',
      method: 'patch',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }`,
      body: { config },
      query: { updateMask: updateMask.join(',') },
    })
  }

  /**
   * @description Ends the currently active conference in a Google Meet meeting space, disconnecting all participants. Only the space owner can end an active conference this way. If no conference is currently active in the space, the API returns an error. The space itself remains usable for future meetings.
   *
   * @route POST /end-active-conference
   * @operationName End Active Conference
   * @category Meeting Spaces
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.created
   *
   * @paramDef {"type":"String","label":"Meeting Space","name":"space","required":true,"description":"The space whose active conference should be ended. Accepts a resource name ('spaces/jQCFfuBOdN5z'), a meeting code ('abc-mnop-xyz'), or a full meeting link."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Active conference ended successfully","space":"spaces/jQCFfuBOdN5z"}
   */
  async endActiveConference(space) {
    if (!space) {
      throw new Error('"Meeting Space" is required')
    }

    const spaceName = this.#normalizeSpaceName(space)

    await this.#apiRequest({
      logTag: 'endActiveConference',
      method: 'post',
      url: `${ API_BASE_URL }/${ spaceName }:endActiveConference`,
      body: {},
    })

    return {
      success: true,
      message: 'Active conference ended successfully',
      space: spaceName,
    }
  }

  // ======================================= CONFERENCE RECORDS ========================================

  /**
   * @description Lists conference records (past and ongoing meetings) accessible to the authenticated user, sorted by start time (most recent first). Supports filtering by meeting space, meeting code, start-time range, and ongoing-only status. IMPORTANT: Google automatically deletes conference records and their artifacts (participants, recordings, transcripts) 30 days after the conference ends — older meetings are not retrievable through this API.
   *
   * @route GET /list-conference-records
   * @operationName List Conference Records
   * @category Conference Records
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Meeting Space","name":"spaceName","description":"Filter records to a specific space by its resource name, e.g. 'spaces/jQCFfuBOdN5z' (as returned by Create/Get Meeting Space). To filter by a human-readable meeting code, use the 'Meeting Code' parameter instead."}
   * @paramDef {"type":"String","label":"Meeting Code","name":"meetingCode","description":"Filter records by meeting code, e.g. 'abc-mnop-xyz'. A full https://meet.google.com/... link is also accepted. Note: a meeting code typically expires 365 days after last use."}
   * @paramDef {"type":"String","label":"Start Time After","name":"startTimeAfter","description":"Only include conferences that started at or after this time. Accepts RFC3339 ('2026-07-01T00:00:00Z') or date-only ('2026-07-01') format."}
   * @paramDef {"type":"String","label":"Start Time Before","name":"startTimeBefore","description":"Only include conferences that started at or before this time. Accepts RFC3339 ('2026-07-15T23:59:59Z') or date-only ('2026-07-15') format."}
   * @paramDef {"type":"Boolean","label":"Ongoing Only","name":"ongoingOnly","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only conferences that are currently in progress (no end time yet) are returned."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return per page. Maximum 100. Defaults to 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"conferenceRecords":[{"name":"conferenceRecords/abc-123-def","startTime":"2026-07-15T10:00:12Z","endTime":"2026-07-15T10:45:03Z","expireTime":"2026-08-14T10:45:03Z","space":"spaces/jQCFfuBOdN5z"}],"nextPageToken":"nextPageToken123"}
   */
  async listConferenceRecords(spaceName, meetingCode, startTimeAfter, startTimeBefore, ongoingOnly, pageSize, pageToken) {
    const filters = []

    if (spaceName) {
      filters.push(`space.name = "${ sanitizeFilterValue(this.#normalizeSpaceName(spaceName)) }"`)
    }

    if (meetingCode) {
      const code = String(meetingCode).trim().replace(/^https?:\/\/meet\.google\.com\//i, '')

      filters.push(`space.meeting_code = "${ sanitizeFilterValue(code) }"`)
    }

    if (startTimeAfter) {
      filters.push(`start_time>="${ ensureRFC3339Format(startTimeAfter, false) }"`)
    }

    if (startTimeBefore) {
      filters.push(`start_time<="${ ensureRFC3339Format(startTimeBefore, true) }"`)
    }

    if (ongoingOnly === true) {
      filters.push('end_time IS NULL')
    }

    return this.#apiRequest({
      logTag: 'listConferenceRecords',
      url: `${ API_BASE_URL }/conferenceRecords`,
      query: {
        filter: filters.length > 0 ? filters.join(' AND ') : undefined,
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single conference record by ID, including its start time, end time (unset while the conference is ongoing), the space it was held in, and the time at which Google will automatically delete the record (30 days after the conference ends).
   *
   * @route GET /get-conference-record
   * @operationName Get Conference Record
   * @category Conference Records
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference record to retrieve. Select from recent conferences or provide a resource name ('conferenceRecords/{record}') or bare record ID."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def","startTime":"2026-07-15T10:00:12Z","endTime":"2026-07-15T10:45:03Z","expireTime":"2026-08-14T10:45:03Z","space":"spaces/jQCFfuBOdN5z"}
   */
  async getConferenceRecord(conferenceRecord) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    return this.#apiRequest({
      logTag: 'getConferenceRecord',
      url: `${ API_BASE_URL }/${ this.#normalizeConferenceRecordName(conferenceRecord) }`,
    })
  }

  // ========================================== PARTICIPANTS ===========================================

  /**
   * @description Lists the participants of a conference, sorted by join time (descending). Each participant is a signed-in user, an anonymous user, or a dial-in phone user, with their earliest join and latest leave timestamps. Use the 'Active Only' option to return only participants who are currently in the meeting. Participant data is deleted together with the conference record 30 days after the conference ends.
   *
   * @route GET /list-participants
   * @operationName List Participants
   * @category Participants
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference whose participants should be listed. Select from recent conferences or provide a resource name ('conferenceRecords/{record}') or bare record ID."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"activeOnly","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only participants currently in the conference (no leave time yet) are returned. Useful for live attendance checks on ongoing meetings."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of participants to return per page. Maximum 250. Defaults to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"participants":[{"name":"conferenceRecords/abc-123-def/participants/1001","earliestStartTime":"2026-07-15T10:00:15Z","latestEndTime":"2026-07-15T10:44:58Z","signedinUser":{"user":"users/112233445566","displayName":"Jane Doe"}},{"name":"conferenceRecords/abc-123-def/participants/1002","earliestStartTime":"2026-07-15T10:02:40Z","anonymousUser":{"displayName":"Guest"}}],"nextPageToken":"nextPageToken123"}
   */
  async listParticipants(conferenceRecord, activeOnly, pageSize, pageToken) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)

    return this.#apiRequest({
      logTag: 'listParticipants',
      url: `${ API_BASE_URL }/${ recordName }/participants`,
      query: {
        filter: activeOnly === true ? 'latest_end_time IS NULL' : undefined,
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single participant of a conference, including their display name, user type (signed-in, anonymous, or phone dial-in), earliest join time, and latest leave time (unset while they are still in the meeting).
   *
   * @route GET /get-participant
   * @operationName Get Participant
   * @category Participants
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the participant belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Participant ID","name":"participantId","required":true,"description":"The participant to retrieve: either the bare ID (last segment of the participant resource name, e.g. '1001') or the full resource name ('conferenceRecords/{record}/participants/{participant}') as returned by List Participants. If a full resource name is provided, it takes precedence over the selected conference record."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def/participants/1001","earliestStartTime":"2026-07-15T10:00:15Z","latestEndTime":"2026-07-15T10:44:58Z","signedinUser":{"user":"users/112233445566","displayName":"Jane Doe"}}
   */
  async getParticipant(conferenceRecord, participantId) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!participantId) {
      throw new Error('"Participant ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const participantName = this.#resolveResourceName(participantId, recordName, 'participants')

    return this.#apiRequest({
      logTag: 'getParticipant',
      url: `${ API_BASE_URL }/${ participantName }`,
    })
  }

  /**
   * @description Lists the individual sessions of a participant within a conference, sorted by start time (descending). A participant who leaves and rejoins the meeting (or joins from multiple devices) has multiple sessions, each with its own start and end time — useful for precise attendance and presence-duration calculations.
   *
   * @route GET /list-participant-sessions
   * @operationName List Participant Sessions
   * @category Participants
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the participant belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Participant ID","name":"participantId","required":true,"description":"The participant whose sessions should be listed: either the bare ID (e.g. '1001') or the full resource name ('conferenceRecords/{record}/participants/{participant}') as returned by List Participants."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sessions to return per page. Maximum 250. Defaults to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"participantSessions":[{"name":"conferenceRecords/abc-123-def/participants/1001/participantSessions/2001","startTime":"2026-07-15T10:00:15Z","endTime":"2026-07-15T10:20:03Z"},{"name":"conferenceRecords/abc-123-def/participants/1001/participantSessions/2002","startTime":"2026-07-15T10:25:11Z","endTime":"2026-07-15T10:44:58Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listParticipantSessions(conferenceRecord, participantId, pageSize, pageToken) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!participantId) {
      throw new Error('"Participant ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const participantName = this.#resolveResourceName(participantId, recordName, 'participants')

    return this.#apiRequest({
      logTag: 'listParticipantSessions',
      url: `${ API_BASE_URL }/${ participantName }/participantSessions`,
      query: {
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single session of a conference participant, with the exact start and end time of that presence interval (end time is unset while the session is still active).
   *
   * @route GET /get-participant-session
   * @operationName Get Participant Session
   * @category Participants
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the participant belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Participant ID","name":"participantId","required":true,"description":"The participant the session belongs to: either the bare ID (e.g. '1001') or the full participant resource name."}
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","required":true,"description":"The session to retrieve: either the bare ID (last segment, e.g. '2001') or the full resource name ('conferenceRecords/{record}/participants/{participant}/participantSessions/{session}') as returned by List Participant Sessions."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def/participants/1001/participantSessions/2001","startTime":"2026-07-15T10:00:15Z","endTime":"2026-07-15T10:20:03Z"}
   */
  async getParticipantSession(conferenceRecord, participantId, sessionId) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!participantId) {
      throw new Error('"Participant ID" is required')
    }

    if (!sessionId) {
      throw new Error('"Session ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const participantName = this.#resolveResourceName(participantId, recordName, 'participants')
    const sessionName = this.#resolveResourceName(sessionId, participantName, 'participantSessions')

    return this.#apiRequest({
      logTag: 'getParticipantSession',
      url: `${ API_BASE_URL }/${ sessionName }`,
    })
  }

  // =========================================== RECORDINGS ============================================

  /**
   * @description Lists the recordings of a conference, sorted by start time (ascending). Each recording includes its state (STARTED, ENDED, or FILE_GENERATED) and, once the file is generated, a Google Drive destination with the MP4 file ID and a browser playback link (exportUri). Recordings only exist if recording was started during the meeting (manually or via the space's auto-recording setting) and are deleted with the conference record 30 days after the conference ends (the Drive file itself follows normal Drive retention).
   *
   * @route GET /list-recordings
   * @operationName List Recordings
   * @category Recordings
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference whose recordings should be listed. Select from recent conferences or provide a resource name ('conferenceRecords/{record}') or bare record ID."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of recordings to return per page. Maximum 100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"recordings":[{"name":"conferenceRecords/abc-123-def/recordings/rec-001","state":"FILE_GENERATED","startTime":"2026-07-15T10:01:00Z","endTime":"2026-07-15T10:44:50Z","driveDestination":{"file":"1AbCdEfGhIjKlMnOp","exportUri":"https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view"}}],"nextPageToken":"nextPageToken123"}
   */
  async listRecordings(conferenceRecord, pageSize, pageToken) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)

    return this.#apiRequest({
      logTag: 'listRecordings',
      url: `${ API_BASE_URL }/${ recordName }/recordings`,
      query: {
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single recording of a conference, including its state (STARTED, ENDED, or FILE_GENERATED) and, once generated, the Google Drive file ID and playback link (exportUri). Use the Drive file ID with the Google Drive service to download or share the MP4 file.
   *
   * @route GET /get-recording
   * @operationName Get Recording
   * @category Recordings
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the recording belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Recording ID","name":"recordingId","required":true,"description":"The recording to retrieve: either the bare ID (last segment of the recording resource name) or the full resource name ('conferenceRecords/{record}/recordings/{recording}') as returned by List Recordings."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def/recordings/rec-001","state":"FILE_GENERATED","startTime":"2026-07-15T10:01:00Z","endTime":"2026-07-15T10:44:50Z","driveDestination":{"file":"1AbCdEfGhIjKlMnOp","exportUri":"https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view"}}
   */
  async getRecording(conferenceRecord, recordingId) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!recordingId) {
      throw new Error('"Recording ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const recordingName = this.#resolveResourceName(recordingId, recordName, 'recordings')

    return this.#apiRequest({
      logTag: 'getRecording',
      url: `${ API_BASE_URL }/${ recordingName }`,
    })
  }

  // =========================================== TRANSCRIPTS ===========================================

  /**
   * @description Lists the transcripts of a conference, sorted by start time (ascending). Each transcript includes its state (STARTED, ENDED, or FILE_GENERATED) and, once generated, a Google Docs destination with the document ID and a browser link (exportUri). Transcripts only exist if transcription was started during the meeting (manually or via the space's auto-transcription setting) and are deleted with the conference record 30 days after the conference ends (the Docs file itself follows normal Drive retention).
   *
   * @route GET /list-transcripts
   * @operationName List Transcripts
   * @category Transcripts
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference whose transcripts should be listed. Select from recent conferences or provide a resource name ('conferenceRecords/{record}') or bare record ID."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transcripts to return per page. Maximum 100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"transcripts":[{"name":"conferenceRecords/abc-123-def/transcripts/tr-001","state":"FILE_GENERATED","startTime":"2026-07-15T10:01:00Z","endTime":"2026-07-15T10:44:50Z","docsDestination":{"document":"1QwErTyUiOpAsDfG","exportUri":"https://docs.google.com/document/d/1QwErTyUiOpAsDfG"}}],"nextPageToken":"nextPageToken123"}
   */
  async listTranscripts(conferenceRecord, pageSize, pageToken) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)

    return this.#apiRequest({
      logTag: 'listTranscripts',
      url: `${ API_BASE_URL }/${ recordName }/transcripts`,
      query: {
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single transcript of a conference, including its state (STARTED, ENDED, or FILE_GENERATED) and, once generated, the Google Docs document ID and link (exportUri). To read the transcript content structurally (per speech segment), use List Transcript Entries or Get Full Transcript Text.
   *
   * @route GET /get-transcript
   * @operationName Get Transcript
   * @category Transcripts
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the transcript belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The transcript to retrieve: either the bare ID (last segment of the transcript resource name) or the full resource name ('conferenceRecords/{record}/transcripts/{transcript}') as returned by List Transcripts."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def/transcripts/tr-001","state":"FILE_GENERATED","startTime":"2026-07-15T10:01:00Z","endTime":"2026-07-15T10:44:50Z","docsDestination":{"document":"1QwErTyUiOpAsDfG","exportUri":"https://docs.google.com/document/d/1QwErTyUiOpAsDfG"}}
   */
  async getTranscript(conferenceRecord, transcriptId) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!transcriptId) {
      throw new Error('"Transcript ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const transcriptName = this.#resolveResourceName(transcriptId, recordName, 'transcripts')

    return this.#apiRequest({
      logTag: 'getTranscript',
      url: `${ API_BASE_URL }/${ transcriptName }`,
    })
  }

  /**
   * @description Lists the individual entries (speech segments) of a conference transcript, ordered by start time (ascending). Each entry contains the spoken text, the language code, the speaking participant's resource name, and the segment's start/end timestamps. Note: entries returned by the API may differ slightly from the generated Google Docs transcript file. Transcript entries are deleted with the conference record 30 days after the conference ends. For the complete transcript as a single ready-to-use text, use Get Full Transcript Text instead.
   *
   * @route GET /list-transcript-entries
   * @operationName List Transcript Entries
   * @category Transcripts
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the transcript belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The transcript whose entries should be listed: either the bare ID or the full transcript resource name as returned by List Transcripts."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of entries to return per page. Maximum 100. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response ('nextPageToken') to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"transcriptEntries":[{"name":"conferenceRecords/abc-123-def/transcripts/tr-001/entries/en-001","participant":"conferenceRecords/abc-123-def/participants/1001","text":"Good morning everyone, let's get started.","languageCode":"en-US","startTime":"2026-07-15T10:01:05Z","endTime":"2026-07-15T10:01:09Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listTranscriptEntries(conferenceRecord, transcriptId, pageSize, pageToken) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!transcriptId) {
      throw new Error('"Transcript ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const transcriptName = this.#resolveResourceName(transcriptId, recordName, 'transcripts')

    return this.#apiRequest({
      logTag: 'listTranscriptEntries',
      url: `${ API_BASE_URL }/${ transcriptName }/entries`,
      query: {
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single transcript entry (one speech segment), including the spoken text, language code, speaking participant's resource name, and start/end timestamps.
   *
   * @route GET /get-transcript-entry
   * @operationName Get Transcript Entry
   * @category Transcripts
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the transcript belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The transcript the entry belongs to: either the bare ID or the full transcript resource name."}
   * @paramDef {"type":"String","label":"Entry ID","name":"entryId","required":true,"description":"The entry to retrieve: either the bare ID (last segment) or the full resource name ('conferenceRecords/{record}/transcripts/{transcript}/entries/{entry}') as returned by List Transcript Entries."}
   *
   * @returns {Object}
   * @sampleResult {"name":"conferenceRecords/abc-123-def/transcripts/tr-001/entries/en-001","participant":"conferenceRecords/abc-123-def/participants/1001","text":"Good morning everyone, let's get started.","languageCode":"en-US","startTime":"2026-07-15T10:01:05Z","endTime":"2026-07-15T10:01:09Z"}
   */
  async getTranscriptEntry(conferenceRecord, transcriptId, entryId) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!transcriptId) {
      throw new Error('"Transcript ID" is required')
    }

    if (!entryId) {
      throw new Error('"Entry ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const transcriptName = this.#resolveResourceName(transcriptId, recordName, 'transcripts')
    const entryName = this.#resolveResourceName(entryId, transcriptName, 'entries')

    return this.#apiRequest({
      logTag: 'getTranscriptEntry',
      url: `${ API_BASE_URL }/${ entryName }`,
    })
  }

  /**
   * @description Fetches ALL entries of a conference transcript (automatically paginating through the API) and assembles them into a single plain-text transcript with resolved speaker display names, one line per speech segment ('Jane Doe: Good morning everyone.'). Ideal for feeding a complete meeting transcript to an AI agent for summarization, action-item extraction, or analysis without manual pagination. Speaker names are resolved via the conference participant list; unresolvable speakers fall back to their participant ID. Safety cap: up to 10,000 entries are collected — if more exist, the result is marked as truncated. Transcript data is deleted by Google 30 days after the conference ends.
   *
   * @route GET /get-full-transcript-text
   * @operationName Get Full Transcript Text
   * @category Transcripts
   * @appearanceColor #00832d #1e8e3e
   *
   * @executionTimeoutInSeconds 300
   *
   * @requiredOauth2Scopes meetings.space.readonly
   *
   * @paramDef {"type":"String","label":"Conference Record","name":"conferenceRecord","required":true,"dictionary":"getConferenceRecordsDictionary","description":"The conference the transcript belongs to. Select from recent conferences or provide a resource name or bare record ID."}
   * @paramDef {"type":"String","label":"Transcript ID","name":"transcriptId","required":true,"description":"The transcript to assemble: either the bare ID or the full transcript resource name as returned by List Transcripts."}
   * @paramDef {"type":"Boolean","label":"Include Timestamps","name":"includeTimestamps","uiComponent":{"type":"TOGGLE"},"description":"When enabled, each line is prefixed with the segment's start timestamp, e.g. '[2026-07-15T10:01:05Z] Jane Doe: ...'. Default: disabled."}
   *
   * @returns {Object}
   * @sampleResult {"transcript":"conferenceRecords/abc-123-def/transcripts/tr-001","entryCount":128,"truncated":false,"text":"Jane Doe: Good morning everyone, let's get started.\nJohn Smith: Morning! I have the Q3 numbers ready."}
   */
  async getFullTranscriptText(conferenceRecord, transcriptId, includeTimestamps) {
    if (!conferenceRecord) {
      throw new Error('"Conference Record" is required')
    }

    if (!transcriptId) {
      throw new Error('"Transcript ID" is required')
    }

    const recordName = this.#normalizeConferenceRecordName(conferenceRecord)
    const transcriptName = this.#resolveResourceName(transcriptId, recordName, 'transcripts')
    const transcriptRecordName = transcriptName.split('/transcripts/')[0]

    const participantNames = {}
    let participantsPageToken

    do {
      const response = await this.#apiRequest({
        logTag: 'getFullTranscriptText.participants',
        url: `${ API_BASE_URL }/${ transcriptRecordName }/participants`,
        query: {
          pageSize: 250,
          pageToken: participantsPageToken,
        },
      })

      for (const participant of response.participants || []) {
        const displayName = participant.signedinUser?.displayName ||
          participant.anonymousUser?.displayName ||
          participant.phoneUser?.displayName

        if (displayName) {
          participantNames[participant.name] = displayName
        }
      }

      participantsPageToken = response.nextPageToken
    } while (participantsPageToken)

    const MAX_PAGES = 100
    const lines = []
    let entryCount = 0
    let pageToken
    let pages = 0

    do {
      const response = await this.#apiRequest({
        logTag: 'getFullTranscriptText.entries',
        url: `${ API_BASE_URL }/${ transcriptName }/entries`,
        query: {
          pageSize: 100,
          pageToken,
        },
      })

      for (const entry of response.transcriptEntries || []) {
        entryCount++

        const speaker = participantNames[entry.participant] ||
          entry.participant?.split('/').pop() ||
          'Unknown speaker'
        const timestamp = includeTimestamps === true && entry.startTime ? `[${ entry.startTime }] ` : ''

        lines.push(`${ timestamp }${ speaker }: ${ entry.text }`)
      }

      pageToken = response.nextPageToken
      pages++
    } while (pageToken && pages < MAX_PAGES)

    return {
      transcript: transcriptName,
      entryCount,
      truncated: Boolean(pageToken),
      text: lines.join('\n'),
    }
  }
}

Flowrunner.ServerCode.addService(GoogleMeetService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console. The Google Meet REST API must be enabled for the project.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function sanitizeFilterValue(value) {
  return String(value).replace(/["\\]/g, '')
}

function ensureRFC3339Format(dateString, isEndDate = false) {
  // If it's already in RFC3339 format (has 'T' and timezone), return as-is
  if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+') || dateString.match(/-\d{2}:\d{2}$/))) {
    return dateString
  }

  // If it's a date only (YYYY-MM-DD), convert to start/end of day in UTC
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const time = isEndDate ? 'T23:59:59Z' : 'T00:00:00Z'

    return `${ dateString }${ time }`
  }

  // If it has T but no timezone, add Z for UTC
  if (dateString.includes('T')) {
    return `${ dateString }Z`
  }

  // Fallback: try to parse and convert to ISO string
  return new Date(dateString).toISOString()
}
