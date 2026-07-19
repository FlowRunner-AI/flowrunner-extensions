'use strict'

const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const API_BASE_URL = 'https://api.twitch.tv/helix'

const SCOPE_LIST = [
  'user:read:email',
  'user:edit',
  'user:read:follows',
  'user:write:chat',
  'channel:manage:broadcast',
  'channel:read:subscriptions',
  'channel:read:stream_key',
  'channel:manage:polls',
  'channel:manage:videos',
  'moderator:read:followers',
  'moderator:read:chatters',
  'clips:edit',
  'bits:read',
]

const STREAM_TYPE_OPTIONS = {
  'All': 'all',
  'Live': 'live',
}

const VIDEO_TYPE_OPTIONS = {
  'All': 'all',
  'Archive': 'archive',
  'Highlight': 'highlight',
  'Upload': 'upload',
}

const VIDEO_SORT_OPTIONS = {
  'Time': 'time',
  'Trending': 'trending',
  'Views': 'views',
}

const VIDEO_PERIOD_OPTIONS = {
  'All': 'all',
  'Day': 'day',
  'Week': 'week',
  'Month': 'month',
}

const POLL_STATUS_OPTIONS = {
  'Terminated': 'TERMINATED',
  'Archived': 'ARCHIVED',
}

const BITS_PERIOD_OPTIONS = {
  'Day': 'day',
  'Week': 'week',
  'Month': 'month',
  'Year': 'year',
  'All Time': 'all',
}

const CONTENT_CLASSIFICATION_OPTIONS = {
  'Politics and Sensitive Social Issues': 'DebatedSocialIssuesAndPolitics',
  'Drugs, Intoxication, or Excessive Tobacco Use': 'DrugsIntoxication',
  'Gambling': 'Gambling',
  'Significant Profanity or Vulgarity': 'ProfanityVulgarity',
  'Sexual Themes': 'SexualThemes',
  'Violent and Graphic Depictions': 'ViolentGraphic',
}

const logger = {
  info: (...args) => console.log('[Twitch] info:', ...args),
  debug: (...args) => console.log('[Twitch] debug:', ...args),
  error: (...args) => console.log('[Twitch] error:', ...args),
  warn: (...args) => console.log('[Twitch] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Twitch
 * @integrationIcon /icon.svg
 **/
class TwitchService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = SCOPE_LIST.join(' ')
  }

  // Every Helix call requires BOTH the Bearer token AND the Client-Id header.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    // Twitch uses repeated query parameters (e.g. login=a&login=b), so the query
    // string is built manually instead of relying on object serialization.
    const queryString = buildQueryString(query)
    const fullUrl = queryString ? `${ url }?${ queryString }` : url

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ fullUrl }]`)

      const request = Flowrunner.Request[method.toLowerCase()](fullUrl)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Client-Id': this.clientId,
          'Content-Type': 'application/json',
        })

      const response = body !== undefined ? await request.send(body) : await request

      // Several Helix write endpoints (e.g. Modify Channel Information) return 204 No Content.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      const wrapped = new Error(`Twitch API error: ${ message }`)

      wrapped.status = error.status || error.statusCode

      throw wrapped
    }
  }

  // Twitch errors are shaped as { error: "Bad Request", status: 400, message: "..." } for Helix,
  // or { status, message } for the id.twitch.tv auth server.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.message) {
        const label = typeof body.error === 'string' ? `${ body.error }: ` : ''
        const status = body.status ? ` (status ${ body.status })` : ''

        return `${ label }${ body.message }${ status }`
      }

      if (typeof body.error === 'string') {
        return body.error
      }
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Resolves the connected user's Twitch id. Cached for the duration of the invocation because
  // most Helix endpoints require an explicit broadcaster_id/user_id.
  async #getUserId() {
    if (!this._cachedUserId) {
      const response = await this.#apiRequest({
        logTag: 'getUserId',
        url: `${ API_BASE_URL }/users`,
      })

      const user = Array.isArray(response.data) ? response.data[0] : undefined

      if (!user?.id) {
        throw new Error('Unable to resolve the connected Twitch user')
      }

      this._cachedUserId = user.id
    }

    return this._cachedUserId
  }

  // Normalizes the standard Helix envelope { data: [...], pagination: { cursor }, total?, points? }
  // to a consistent { items, cursor?, total?, points? } object.
  #unwrap(response) {
    const result = { items: Array.isArray(response?.data) ? response.data : [] }

    if (response?.pagination?.cursor) {
      result.cursor = response.pagination.cursor
    }

    if (response?.total !== undefined) {
      result.total = response.total
    }

    if (response?.points !== undefined) {
      result.points = response.points
    }

    return result
  }

  // ============================================= OAUTH ================================================

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
    params.append('state', `flowrunner_${ Date.now() }`)

    // redirect_uri is injected by the FlowRunner platform — do not append it here.
    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
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
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Twitch Account'
    let connectionIdentityImageURL = null

    try {
      const usersResponse = await Flowrunner.Request
        .get(`${ API_BASE_URL }/users`)
        .set({
          'Authorization': `Bearer ${ tokenResponse.access_token }`,
          'Client-Id': this.clientId,
        })

      userData = usersResponse.data?.[0] || {}
      connectionIdentityName = userData.display_name || userData.login || connectionIdentityName
      connectionIdentityImageURL = userData.profile_image_url || null
    } catch (error) {
      logger.error(`[executeCallback] /users error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
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
      const params = new URLSearchParams()

      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // Twitch rotates refresh tokens on every refresh — always store the new one.
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.status === 400 || error.status === 401 || error.body?.message === 'Invalid refresh token') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
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
   * @typedef {Object} getCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to search Twitch categories/games by name. When empty, the current top games on Twitch are listed."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of categories."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Lists Twitch categories (games) for selection in dependent parameters. When a search term is provided, categories are looked up via Twitch category search; otherwise the current top games are listed. Returns the category name as the label and the category id as the value.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Fortnite","value":"33214","note":"Category"}],"cursor":"eyJiIjpudWxsLCJhIjp7IkN1cnNvciI6IjIwIn19"}
   */
  async getCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { first: 50, after: cursor || undefined }

    const response = search
      ? await this.#apiRequest({
        logTag: 'getCategoriesDictionary',
        url: `${ API_BASE_URL }/search/categories`,
        query: { ...query, query: search },
      })
      : await this.#apiRequest({
        logTag: 'getCategoriesDictionary',
        url: `${ API_BASE_URL }/games/top`,
        query,
      })

    const items = Array.isArray(response.data) ? response.data : []

    return {
      cursor: response.pagination?.cursor,
      items: items.map(category => ({
        label: category.name,
        value: category.id,
        note: 'Category',
      })),
    }
  }

  /**
   * @typedef {Object} getVideosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the connected user's videos by title. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of videos."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Videos Dictionary
   * @description Lists the connected user's videos (past broadcasts, highlights, and uploads) for selection in dependent parameters. Returns the video title as the label and the video id as the value.
   * @route POST /get-videos-dictionary
   * @paramDef {"type":"getVideosDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Twitch Developers 101","value":"335921245","note":"upload · 3m21s"}],"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6NX19"}
   */
  async getVideosDictionary(payload) {
    const { search, cursor } = payload || {}
    const userId = await this.#getUserId()

    const response = await this.#apiRequest({
      logTag: 'getVideosDictionary',
      url: `${ API_BASE_URL }/videos`,
      query: { user_id: userId, first: 50, after: cursor || undefined },
    })

    const items = Array.isArray(response.data) ? response.data : []

    const filtered = search
      ? items.filter(video => video?.title && video.title.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.pagination?.cursor,
      items: filtered.map(video => ({
        label: video.title,
        value: video.id,
        note: [video.type, video.duration].filter(Boolean).join(' · '),
      })),
    }
  }

  /**
   * @typedef {Object} getClipsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the connected user's clips by title. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of clips."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clips Dictionary
   * @description Lists clips captured from the connected user's channel for selection in dependent parameters. Returns the clip title as the label and the clip id as the value.
   * @route POST /get-clips-dictionary
   * @paramDef {"type":"getClipsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"babymetal","value":"AwkwardHelplessSalamanderSwiftRage","note":"10 views"}],"cursor":"eyJiIjpudWxsLCJhIjoiIn0"}
   */
  async getClipsDictionary(payload) {
    const { search, cursor } = payload || {}
    const userId = await this.#getUserId()

    const response = await this.#apiRequest({
      logTag: 'getClipsDictionary',
      url: `${ API_BASE_URL }/clips`,
      query: { broadcaster_id: userId, first: 50, after: cursor || undefined },
    })

    const items = Array.isArray(response.data) ? response.data : []

    const filtered = search
      ? items.filter(clip => clip?.title && clip.title.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.pagination?.cursor,
      items: filtered.map(clip => ({
        label: clip.title,
        value: clip.id,
        note: clip.view_count !== undefined ? `${ clip.view_count } views` : '',
      })),
    }
  }

  // ============================================== USERS ==============================================

  /**
   * @description Retrieves the profile of the connected Twitch user, including id, login, display name, description, broadcaster type (affiliate/partner), profile image, email (granted via the 'user:read:email' scope), and account creation date. Useful as a connection check and for resolving the connected user's id.
   *
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category Users
   *
   * @returns {Object}
   * @sampleResult {"id":"141981764","login":"twitchdev","display_name":"TwitchDev","type":"","broadcaster_type":"partner","description":"Supporting third-party developers building Twitch integrations.","profile_image_url":"https://static-cdn.jtvnw.net/jtv_user_pictures/8a6381c7-d0c0-4576-b179-38bd5ce1d6af-profile_image-300x300.png","offline_image_url":"","view_count":5980557,"email":"not-real@email.com","created_at":"2016-12-14T20:32:28Z"}
   */
  async getCurrentUser() {
    const response = await this.#apiRequest({
      logTag: 'getCurrentUser',
      url: `${ API_BASE_URL }/users`,
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves Twitch user profiles by login name and/or user id. Up to 100 users can be requested per call (logins and ids combined). When no logins or ids are provided, the connected user's profile is returned. The email field is only included for the connected user.
   *
   * @route GET /get-users
   * @operationName Get Users
   * @category Users
   *
   * @paramDef {"type":"Array<String>","label":"Logins","name":"logins","description":"Twitch login names to look up (e.g. 'twitchdev'). Combined with User IDs, at most 100 users per request."}
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","description":"Twitch user ids to look up (e.g. '141981764'). Combined with Logins, at most 100 users per request."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"141981764","login":"twitchdev","display_name":"TwitchDev","type":"","broadcaster_type":"partner","description":"Supporting third-party developers.","profile_image_url":"https://static-cdn.jtvnw.net/jtv_user_pictures/example-profile_image-300x300.png","view_count":5980557,"created_at":"2016-12-14T20:32:28Z"}]}
   */
  async getUsers(logins, userIds) {
    const response = await this.#apiRequest({
      logTag: 'getUsers',
      url: `${ API_BASE_URL }/users`,
      query: {
        login: toArray(logins),
        id: toArray(userIds),
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Updates the description (bio) shown on the connected user's Twitch channel page. Requires the 'user:edit' scope. Returns the updated user profile.
   *
   * @route PUT /update-user-description
   * @operationName Update User Description
   * @category Users
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new channel description, up to 300 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":"141981764","login":"twitchdev","display_name":"TwitchDev","description":"Supporting third-party developers building Twitch integrations.","broadcaster_type":"partner","profile_image_url":"https://static-cdn.jtvnw.net/jtv_user_pictures/example-profile_image-300x300.png","created_at":"2016-12-14T20:32:28Z"}
   */
  async updateUserDescription(description) {
    if (description === undefined || description === null) {
      throw new Error('"Description" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'updateUserDescription',
      method: 'put',
      url: `${ API_BASE_URL }/users`,
      query: { description },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  // ============================================= CHANNELS ============================================

  /**
   * @description Retrieves channel information for a broadcaster, including the stream title, category (game), broadcast language, tags, content classification labels, and branded content flag. Defaults to the connected user's channel when no broadcaster id is provided.
   *
   * @route GET /get-channel-information
   * @operationName Get Channel Information
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster. Defaults to the connected user's channel when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"broadcaster_id":"141981764","broadcaster_login":"twitchdev","broadcaster_name":"TwitchDev","broadcaster_language":"en","game_id":"509670","game_name":"Science & Technology","title":"TwitchDev Monthly Update","delay":0,"tags":["DevsInTheKnow"],"content_classification_labels":[],"is_branded_content":false}
   */
  async getChannelInformation(broadcasterId) {
    const response = await this.#apiRequest({
      logTag: 'getChannelInformation',
      url: `${ API_BASE_URL }/channels`,
      query: { broadcaster_id: broadcasterId || await this.#getUserId() },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Updates the connected user's channel settings: stream title, category (game), broadcast language, tags, content classification labels, and branded content flag. Only provided fields are changed; at least one is required. Tags are limited to 10, each up to 25 characters, no spaces. When Content Classification Labels are provided, the listed labels are enabled and all other settable labels are disabled (full replacement). Requires the 'channel:manage:broadcast' scope.
   *
   * @route PATCH /modify-channel-information
   * @operationName Modify Channel Information
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional new stream title. May not be an empty string."}
   * @paramDef {"type":"String","label":"Category","name":"gameId","dictionary":"getCategoriesDictionary","description":"Optional Twitch category (game) id to set. Select a category or enter an id directly. Use '0' to clear the category."}
   * @paramDef {"type":"String","label":"Broadcast Language","name":"broadcasterLanguage","description":"Optional ISO 639-1 language code for the broadcast (e.g. 'en'), or 'other'."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional channel tags. Maximum 10 tags, each up to 25 characters with no spaces or special characters. Providing an empty list removes all tags."}
   * @paramDef {"type":"Array<String>","label":"Content Classification Labels","name":"contentClassificationLabels","uiComponent":{"type":"DROPDOWN","options":{"values":["Politics and Sensitive Social Issues","Drugs, Intoxication, or Excessive Tobacco Use","Gambling","Significant Profanity or Vulgarity","Sexual Themes","Violent and Graphic Depictions"]}},"description":"Optional content classification labels to enable on the channel. Labels not listed are disabled (full replacement). Leave unset to keep current labels unchanged."}
   * @paramDef {"type":"Boolean","label":"Branded Content","name":"isBrandedContent","uiComponent":{"type":"CHECKBOX"},"description":"Optional flag indicating the stream features branded content."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async modifyChannelInformation(title, gameId, broadcasterLanguage, tags, contentClassificationLabels, isBrandedContent) {
    const body = {}

    if (title !== undefined && title !== null && title !== '') {
      body.title = title
    }

    if (gameId !== undefined && gameId !== null && gameId !== '') {
      body.game_id = gameId
    }

    if (broadcasterLanguage !== undefined && broadcasterLanguage !== null && broadcasterLanguage !== '') {
      body.broadcaster_language = broadcasterLanguage
    }

    if (tags !== undefined && tags !== null) {
      body.tags = toArray(tags)
    }

    if (contentClassificationLabels !== undefined && contentClassificationLabels !== null) {
      const enabledIds = toArray(contentClassificationLabels)
        .map(label => this.#resolveChoice(label, CONTENT_CLASSIFICATION_OPTIONS))

      body.content_classification_labels = Object.values(CONTENT_CLASSIFICATION_OPTIONS)
        .map(id => ({ id, is_enabled: enabledIds.includes(id) }))
    }

    if (isBrandedContent !== undefined && isBrandedContent !== null) {
      body.is_branded_content = isBrandedContent
    }

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'modifyChannelInformation',
      method: 'patch',
      url: `${ API_BASE_URL }/channels`,
      query: { broadcaster_id: await this.#getUserId() },
      body,
    })
  }

  /**
   * @description Searches Twitch channels whose name or description matches a query. Optionally restrict results to channels that are currently live. Returns channel summaries including live status, category, title, and tags, with cursor-based pagination.
   *
   * @route GET /search-channels
   * @operationName Search Channels
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search text to match against channel names and descriptions."}
   * @paramDef {"type":"Boolean","label":"Live Only","name":"liveOnly","uiComponent":{"type":"CHECKBOX"},"description":"Whether to return only channels that are currently streaming. Default: false."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of channels to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"41245072","broadcaster_login":"loserfruit","display_name":"Loserfruit","broadcaster_language":"en","game_id":"498000","game_name":"House Flipper","is_live":false,"title":"loserfruit","tags":["English"],"thumbnail_url":"https://static-cdn.jtvnw.net/jtv_user_pictures/example-profile_image-300x300.png","started_at":""}],"cursor":"eyJiIjpudWxsLCJhIjp7IkN1cnNvciI6IjIwIn19"}
   */
  async searchChannels(query, liveOnly, pageSize, after) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'searchChannels',
      url: `${ API_BASE_URL }/search/channels`,
      query: {
        query,
        live_only: liveOnly === undefined || liveOnly === null ? undefined : liveOnly,
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Retrieves the followers of a broadcaster's channel along with the total follower count. Defaults to the connected user's channel. Requires the 'moderator:read:followers' scope: the follower list is only returned for the connected user's own channel or channels where they are a moderator; for other channels only the total is returned. Optionally check whether a specific user follows the channel.
   *
   * @route GET /get-channel-followers
   * @operationName Get Channel Followers
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster whose followers to list. Defaults to the connected user's channel when omitted."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Optional Twitch user id to check. When provided, the response contains this user only if they follow the channel."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of followers to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"user_id":"11111","user_name":"UserDisplayName","user_login":"userloginname","followed_at":"2022-05-24T22:22:08Z"}],"total":8,"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6NX19"}
   */
  async getChannelFollowers(broadcasterId, userId, pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getChannelFollowers',
      url: `${ API_BASE_URL }/channels/followers`,
      query: {
        broadcaster_id: broadcasterId || await this.#getUserId(),
        user_id: userId,
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Retrieves the channels that the connected user follows, along with the total count, ordered by most recently followed. Requires the 'user:read:follows' scope. Optionally check whether the connected user follows a specific broadcaster.
   *
   * @route GET /get-followed-channels
   * @operationName Get Followed Channels
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"Optional Twitch user id of a broadcaster to check. When provided, the response contains this channel only if the connected user follows it."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of channels to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"broadcaster_id":"654321","broadcaster_login":"basketweaver101","broadcaster_name":"BasketWeaver101","followed_at":"2022-05-24T22:22:08Z"}],"total":8,"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6NX19"}
   */
  async getFollowedChannels(broadcasterId, pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getFollowedChannels',
      url: `${ API_BASE_URL }/channels/followed`,
      query: {
        user_id: await this.#getUserId(),
        broadcaster_id: broadcasterId,
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  // ============================================= STREAMS =============================================

  /**
   * @description Retrieves currently active streams, ordered by viewer count (highest first). Filter by broadcaster login names, category (game), stream type, and/or broadcast language. Without filters, the most-watched streams across Twitch are returned. Returns stream details including viewer count, title, category, start time, and thumbnail template.
   *
   * @route GET /get-streams
   * @operationName Get Streams
   * @category Streams
   *
   * @paramDef {"type":"Array<String>","label":"User Logins","name":"userLogins","description":"Optional Twitch login names of broadcasters whose streams to retrieve (e.g. 'twitchdev'). Maximum 100."}
   * @paramDef {"type":"String","label":"Category","name":"gameId","dictionary":"getCategoriesDictionary","description":"Optional Twitch category (game) id to filter streams by. Select a category or enter an id directly."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Live"]}},"description":"The type of streams to return. Default: 'All'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO 639-1 broadcast language code to filter by (e.g. 'en'), or 'other'."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of streams to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"40952121085","user_id":"141981764","user_login":"twitchdev","user_name":"TwitchDev","game_id":"509670","game_name":"Science & Technology","type":"live","title":"TwitchDev Monthly Update","viewer_count":542,"started_at":"2021-03-10T15:04:21Z","language":"en","thumbnail_url":"https://static-cdn.jtvnw.net/previews-ttv/live_user_twitchdev-{width}x{height}.jpg","tags":["English"],"is_mature":false}],"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6MjB9fQ"}
   */
  async getStreams(userLogins, gameId, type, language, pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getStreams',
      url: `${ API_BASE_URL }/streams`,
      query: {
        user_login: toArray(userLogins),
        game_id: gameId,
        type: this.#resolveChoice(type, STREAM_TYPE_OPTIONS),
        language,
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Retrieves the live streams of channels that the connected user follows, ordered by viewer count (highest first). Requires the 'user:read:follows' scope. Returns the same stream details as Get Streams.
   *
   * @route GET /get-followed-streams
   * @operationName Get Followed Streams
   * @category Streams
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of streams to return per page. Range: 1-100. Default: 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"42170724654","user_id":"132954738","user_login":"aws","user_name":"AWS","game_id":"417752","game_name":"Talk Shows & Podcasts","type":"live","title":"AWS Howdy Partner!","viewer_count":20,"started_at":"2021-03-31T20:57:26Z","language":"en","thumbnail_url":"https://static-cdn.jtvnw.net/previews-ttv/live_user_aws-{width}x{height}.jpg","tags":["English"]}],"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6MjB9fQ"}
   */
  async getFollowedStreams(pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getFollowedStreams',
      url: `${ API_BASE_URL }/streams/followed`,
      query: {
        user_id: await this.#getUserId(),
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Creates a marker at the current position in the connected user's live stream, so the moment can easily be located later in the recorded video (highlight editing). The stream must be live and have VODs (past broadcasts) enabled — markers cannot be added while offline or during a premiere/rerun. Requires the 'channel:manage:broadcast' scope. Returns the marker id and its position in seconds.
   *
   * @route POST /create-stream-marker
   * @operationName Create Stream Marker
   * @category Streams
   *
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional short description of why the marker was created, up to 140 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":"123","created_at":"2018-08-20T20:10:03Z","description":"hello, this is a marker!","position_seconds":244}
   */
  async createStreamMarker(description) {
    const body = { user_id: await this.#getUserId() }

    if (description !== undefined && description !== null && description !== '') {
      body.description = description
    }

    const response = await this.#apiRequest({
      logTag: 'createStreamMarker',
      method: 'post',
      url: `${ API_BASE_URL }/streams/markers`,
      body,
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves the connected user's stream key, used to configure broadcasting software (e.g. OBS). Requires the 'channel:read:stream_key' scope. Treat the returned key as a secret — anyone with it can stream to the channel.
   *
   * @route GET /get-stream-key
   * @operationName Get Stream Key
   * @category Streams
   *
   * @returns {Object}
   * @sampleResult {"stream_key":"live_44322889_a34ub37c8ajv98a0"}
   */
  async getStreamKey() {
    const response = await this.#apiRequest({
      logTag: 'getStreamKey',
      url: `${ API_BASE_URL }/streams/key`,
      query: { broadcaster_id: await this.#getUserId() },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  // ============================================ CATEGORIES ===========================================

  /**
   * @description Searches Twitch categories (games) whose name partially or fully matches a query. Returns the category id, name, and box art URL for each match, with cursor-based pagination.
   *
   * @route GET /search-categories
   * @operationName Search Categories
   * @category Categories
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search text to match against category names (e.g. 'fort' matches 'Fortnite')."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of categories to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"33214","name":"Fortnite","box_art_url":"https://static-cdn.jtvnw.net/ttv-boxart/33214-52x72.jpg"}],"cursor":"eyJiIjpudWxsLCJhIjp7IkN1cnNvciI6IjIwIn19"}
   */
  async searchCategories(query, pageSize, after) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'searchCategories',
      url: `${ API_BASE_URL }/search/categories`,
      query: { query, first: pageSize, after },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Retrieves the games and categories currently most watched on Twitch, ordered by viewership (highest first). Returns the category id, name, box art URL template, and IGDB id, with cursor-based pagination.
   *
   * @route GET /get-top-games
   * @operationName Get Top Games
   * @category Categories
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of games to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"493057","name":"PUBG: BATTLEGROUNDS","box_art_url":"https://static-cdn.jtvnw.net/ttv-boxart/493057-{width}x{height}.jpg","igdb_id":"27789"}],"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6MjB9fQ"}
   */
  async getTopGames(pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getTopGames',
      url: `${ API_BASE_URL }/games/top`,
      query: { first: pageSize, after },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Retrieves Twitch categories (games) by exact name and/or category id. Up to 100 categories can be requested per call (names and ids combined). Names must match exactly ('fortnite' does not match 'Fortnite: Battle Royale') — use Search Categories for partial matching. At least one name or id is required.
   *
   * @route GET /get-games
   * @operationName Get Games
   * @category Categories
   *
   * @paramDef {"type":"Array<String>","label":"Names","name":"names","description":"Exact category names to look up (e.g. 'Fortnite'). Combined with Category IDs, at most 100 per request."}
   * @paramDef {"type":"Array<String>","label":"Category IDs","name":"gameIds","description":"Twitch category (game) ids to look up (e.g. '33214'). Combined with Names, at most 100 per request."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"33214","name":"Fortnite","box_art_url":"https://static-cdn.jtvnw.net/ttv-boxart/33214-{width}x{height}.jpg","igdb_id":"1905"}]}
   */
  async getGames(names, gameIds) {
    const nameList = toArray(names)
    const idList = toArray(gameIds)

    if (!nameList.length && !idList.length) {
      throw new Error('At least one "Name" or "Category ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getGames',
      url: `${ API_BASE_URL }/games`,
      query: { name: nameList, id: idList },
    })

    return this.#unwrap(response)
  }

  // ============================================== CLIPS ==============================================

  /**
   * @description Captures a clip from a broadcaster's live stream (defaults to the connected user's channel). The broadcaster must be LIVE — clips cannot be created from offline channels. Clip creation is asynchronous: the returned clip id may take up to ~15 seconds to become retrievable via Get Clips, and the edit URL is valid for 24 hours. Requires the 'clips:edit' scope.
   *
   * @route POST /create-clip
   * @operationName Create Clip
   * @category Clips
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the live broadcaster to clip. Defaults to the connected user's channel when omitted."}
   * @paramDef {"type":"Boolean","label":"Capture Delay","name":"hasDelay","uiComponent":{"type":"CHECKBOX"},"description":"Whether to add a delay before capturing, so the clip covers the moment the viewer actually saw (accounts for stream latency). Default: false (clip the moment as the broadcaster streamed it)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"FiveWordsForClipSlug","edit_url":"https://clips.twitch.tv/FiveWordsForClipSlug/edit"}
   */
  async createClip(broadcasterId, hasDelay) {
    const response = await this.#apiRequest({
      logTag: 'createClip',
      method: 'post',
      url: `${ API_BASE_URL }/clips`,
      query: {
        broadcaster_id: broadcasterId || await this.#getUserId(),
        has_delay: hasDelay === undefined || hasDelay === null ? undefined : hasDelay,
      },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves clips by broadcaster, category (game), or specific clip ids — provide exactly one of the three. Defaults to the connected user's channel when none is provided. Optionally restrict to a date window (clips are returned by view count within it) or to featured clips only. Returns clip details including URL, creator, view count, duration, and VOD offset.
   *
   * @route GET /get-clips
   * @operationName Get Clips
   * @category Clips
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster whose clips to retrieve. Defaults to the connected user's channel when no broadcaster, category, or clip ids are provided."}
   * @paramDef {"type":"String","label":"Category","name":"gameId","dictionary":"getCategoriesDictionary","description":"Optional Twitch category (game) id whose clips to retrieve. Mutually exclusive with Broadcaster ID and Clip IDs."}
   * @paramDef {"type":"Array<String>","label":"Clip IDs","name":"clipIds","dictionary":"getClipsDictionary","description":"Optional specific clip ids to retrieve (maximum 100). Mutually exclusive with Broadcaster ID and Category."}
   * @paramDef {"type":"String","label":"Started At","name":"startedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional start of the date window (RFC3339). When set without Ended At, the window is one week from this date."}
   * @paramDef {"type":"String","label":"Ended At","name":"endedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end of the date window (RFC3339). Ignored by Twitch unless Started At is also provided."}
   * @paramDef {"type":"Boolean","label":"Featured Only","name":"isFeatured","uiComponent":{"type":"CHECKBOX"},"description":"When checked, returns only featured clips; when unchecked, only non-featured clips. Leave unset to return both."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of clips to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"AwkwardHelplessSalamanderSwiftRage","url":"https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage","embed_url":"https://clips.twitch.tv/embed?clip=AwkwardHelplessSalamanderSwiftRage","broadcaster_id":"67955580","broadcaster_name":"ChewieMelodies","creator_id":"53834192","creator_name":"BlackNova03","video_id":"205586603","game_id":"488191","language":"en","title":"babymetal","view_count":10,"created_at":"2017-11-30T22:34:18Z","thumbnail_url":"https://clips-media-assets.twitch.tv/157589949-preview-480x272.jpg","duration":60,"vod_offset":480,"is_featured":false}],"cursor":"eyJiIjpudWxsLCJhIjoiIn0"}
   */
  async getClips(broadcasterId, gameId, clipIds, startedAt, endedAt, isFeatured, pageSize, after) {
    const ids = toArray(clipIds)
    const providedFilters = [broadcasterId, gameId, ids.length ? ids : undefined].filter(v => v !== undefined && v !== null && v !== '')

    if (providedFilters.length > 1) {
      throw new Error('Provide only one of "Broadcaster ID", "Category", or "Clip IDs"')
    }

    const query = {
      started_at: toRfc3339(startedAt),
      ended_at: toRfc3339(endedAt),
      is_featured: isFeatured === undefined || isFeatured === null ? undefined : isFeatured,
      first: pageSize,
      after,
    }

    if (ids.length) {
      query.id = ids
    } else if (gameId) {
      query.game_id = gameId
    } else {
      query.broadcaster_id = broadcasterId || await this.#getUserId()
    }

    const response = await this.#apiRequest({
      logTag: 'getClips',
      url: `${ API_BASE_URL }/clips`,
      query,
    })

    return this.#unwrap(response)
  }

  // ============================================== VIDEOS =============================================

  /**
   * @description Retrieves videos (past broadcasts, highlights, and uploads) by user, category (game), or specific video ids — provide exactly one of the three. Defaults to the connected user's videos when none is provided. Filter by video type and, for category lookups, by period and language; sort by time, trending, or views. Returns video details including URL, view count, duration, and type.
   *
   * @route GET /get-videos
   * @operationName Get Videos
   * @category Videos
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"The Twitch user id whose videos to retrieve. Defaults to the connected user when no user, category, or video ids are provided."}
   * @paramDef {"type":"String","label":"Category","name":"gameId","dictionary":"getCategoriesDictionary","description":"Optional Twitch category (game) id whose videos to retrieve (up to 500 videos). Mutually exclusive with User ID and Video IDs."}
   * @paramDef {"type":"Array<String>","label":"Video IDs","name":"videoIds","dictionary":"getVideosDictionary","description":"Optional specific video ids to retrieve (maximum 100). Mutually exclusive with User ID and Category."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Archive","Highlight","Upload"]}},"description":"The type of videos to return: past broadcasts (Archive), Highlights, Uploads, or All. Default: 'All'."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"Time","uiComponent":{"type":"DROPDOWN","options":{"values":["Time","Trending","Views"]}},"description":"The order of the returned videos: most recent first (Time), Trending, or most viewed first (Views). Default: 'Time'."}
   * @paramDef {"type":"String","label":"Period","name":"period","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Day","Week","Month"]}},"description":"The publication window to filter by, relative to now. Default: 'All'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO 639-1 language code to filter by (e.g. 'en'), or 'other'. Applies only to category lookups."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of videos to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"335921245","stream_id":null,"user_id":"141981764","user_login":"twitchdev","user_name":"TwitchDev","title":"Twitch Developers 101","description":"Welcome to Twitch development!","created_at":"2018-11-14T21:30:18Z","published_at":"2018-11-14T22:04:30Z","url":"https://www.twitch.tv/videos/335921245","thumbnail_url":"https://static-cdn.jtvnw.net/cf_vods/example/thumb-%{width}x%{height}.jpg","viewable":"public","view_count":1863062,"language":"en","type":"upload","duration":"3m21s","muted_segments":[]}],"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6NX19"}
   */
  async getVideos(userId, gameId, videoIds, type, sort, period, language, pageSize, after) {
    const ids = toArray(videoIds)
    const providedFilters = [userId, gameId, ids.length ? ids : undefined].filter(v => v !== undefined && v !== null && v !== '')

    if (providedFilters.length > 1) {
      throw new Error('Provide only one of "User ID", "Category", or "Video IDs"')
    }

    const query = {
      type: this.#resolveChoice(type, VIDEO_TYPE_OPTIONS),
      sort: this.#resolveChoice(sort, VIDEO_SORT_OPTIONS),
      period: this.#resolveChoice(period, VIDEO_PERIOD_OPTIONS),
      language,
      first: pageSize,
      after,
    }

    if (ids.length) {
      query.id = ids
    } else if (gameId) {
      query.game_id = gameId
    } else {
      query.user_id = userId || await this.#getUserId()
    }

    const response = await this.#apiRequest({
      logTag: 'getVideos',
      url: `${ API_BASE_URL }/videos`,
      query,
    })

    return this.#unwrap(response)
  }

  /**
   * @description Permanently deletes one or more of the connected user's videos (maximum 5 per request). This cannot be undone. Requires the 'channel:manage:videos' scope. Returns the ids of the videos that were deleted.
   *
   * @route DELETE /delete-videos
   * @operationName Delete Videos
   * @category Videos
   *
   * @paramDef {"type":"Array<String>","label":"Video IDs","name":"videoIds","required":true,"dictionary":"getVideosDictionary","description":"The ids of the videos to delete. Maximum 5 per request."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":["1234","9876"]}
   */
  async deleteVideos(videoIds) {
    const ids = toArray(videoIds)

    if (!ids.length) {
      throw new Error('At least one "Video ID" is required')
    }

    if (ids.length > 5) {
      throw new Error('At most 5 videos can be deleted per request')
    }

    const response = await this.#apiRequest({
      logTag: 'deleteVideos',
      method: 'delete',
      url: `${ API_BASE_URL }/videos`,
      query: { id: ids },
    })

    return { deleted: Array.isArray(response.data) ? response.data : ids }
  }

  // =============================================== CHAT ==============================================

  /**
   * @description Sends a chat message to a broadcaster's chat room as the connected user. Defaults to the connected user's own channel. Messages are limited to 500 characters and may use Twitch emote names verbatim. Optionally send as a threaded reply to another message. Requires the 'user:write:chat' scope. The response indicates whether the message passed the channel's moderation and was actually sent (check 'is_sent' and 'drop_reason').
   *
   * @route POST /send-chat-message
   * @operationName Send Chat Message
   * @category Chat
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message to send, up to 500 characters. Twitch emote names are rendered as emotes."}
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the channel whose chat to post in. Defaults to the connected user's own channel when omitted."}
   * @paramDef {"type":"String","label":"Reply To Message ID","name":"replyParentMessageId","description":"Optional id of a chat message to reply to, creating a threaded reply."}
   *
   * @returns {Object}
   * @sampleResult {"message_id":"abc-123-def","is_sent":true,"drop_reason":null}
   */
  async sendChatMessage(message, broadcasterId, replyParentMessageId) {
    if (!message) {
      throw new Error('"Message" is required')
    }

    const senderId = await this.#getUserId()

    const body = {
      broadcaster_id: broadcasterId || senderId,
      sender_id: senderId,
      message,
    }

    if (replyParentMessageId) {
      body.reply_parent_message_id = replyParentMessageId
    }

    const response = await this.#apiRequest({
      logTag: 'sendChatMessage',
      method: 'post',
      url: `${ API_BASE_URL }/chat/messages`,
      body,
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves the chat settings of a broadcaster's chat room, including emote-only mode, follower-only mode (and its duration), slow mode (and its wait time), subscriber-only mode, and unique-chat mode. Defaults to the connected user's channel.
   *
   * @route GET /get-chat-settings
   * @operationName Get Chat Settings
   * @category Chat
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster whose chat settings to retrieve. Defaults to the connected user's channel when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"broadcaster_id":"713936733","emote_mode":false,"follower_mode":true,"follower_mode_duration":0,"slow_mode":false,"slow_mode_wait_time":null,"subscriber_mode":false,"unique_chat_mode":false}
   */
  async getChatSettings(broadcasterId) {
    const response = await this.#apiRequest({
      logTag: 'getChatSettings',
      url: `${ API_BASE_URL }/chat/settings`,
      query: { broadcaster_id: broadcasterId || await this.#getUserId() },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves the list of users currently connected to a broadcaster's chat room, along with the total count. Defaults to the connected user's channel. Requires the 'moderator:read:chatters' scope, and the connected user must be the broadcaster or a moderator of the channel.
   *
   * @route GET /get-chatters
   * @operationName Get Chatters
   * @category Chat
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster whose chatters to list. Defaults to the connected user's channel. The connected user must be the broadcaster or a moderator of this channel."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of chatters to return per page. Range: 1-1000. Default: 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"user_id":"128393656","user_login":"smittysmithers","user_name":"smittysmithers"}],"total":8,"cursor":"eyJiIjpudWxsLCJhIjp7Ik9mZnNldCI6NX19"}
   */
  async getChatters(broadcasterId, pageSize, after) {
    const moderatorId = await this.#getUserId()

    const response = await this.#apiRequest({
      logTag: 'getChatters',
      url: `${ API_BASE_URL }/chat/chatters`,
      query: {
        broadcaster_id: broadcasterId || moderatorId,
        moderator_id: moderatorId,
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  // ============================================= SCHEDULE ============================================

  /**
   * @description Retrieves a broadcaster's stream schedule — the planned broadcast segments with start/end times, titles, categories, and recurrence, plus any vacation period. Defaults to the connected user's channel. When the broadcaster has not created a schedule, an empty segments list is returned instead of an error.
   *
   * @route GET /get-channel-stream-schedule
   * @operationName Get Channel Stream Schedule
   * @category Schedule
   *
   * @paramDef {"type":"String","label":"Broadcaster ID","name":"broadcasterId","description":"The Twitch user id of the broadcaster whose schedule to retrieve. Defaults to the connected user's channel when omitted."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of schedule segments to return per page. Range: 1-25. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"segments":[{"id":"eyJzZWdtZW50SUQiOiJlNGFjYzcyNC0zNzFmLTQwMmMtODFjYS0yM2FkYTc5NzU5ZDQi","start_time":"2021-07-01T18:00:00Z","end_time":"2021-07-01T19:00:00Z","title":"TwitchDev Monthly Update","canceled_until":null,"category":{"id":"509670","name":"Science & Technology"},"is_recurring":false}],"broadcaster_id":"141981764","broadcaster_name":"TwitchDev","broadcaster_login":"twitchdev","vacation":null,"cursor":null}
   */
  async getChannelStreamSchedule(broadcasterId, pageSize, after) {
    try {
      const response = await this.#apiRequest({
        logTag: 'getChannelStreamSchedule',
        url: `${ API_BASE_URL }/schedule`,
        query: {
          broadcaster_id: broadcasterId || await this.#getUserId(),
          first: pageSize,
          after,
        },
      })

      const schedule = response.data || {}

      return {
        ...schedule,
        segments: Array.isArray(schedule.segments) ? schedule.segments : [],
        cursor: response.pagination?.cursor || null,
      }
    } catch (error) {
      // Twitch returns 404 when the broadcaster has no schedule — normalize to an empty schedule.
      if (error.status === 404) {
        return { segments: [], vacation: null, cursor: null }
      }

      throw error
    }
  }

  // ============================================== POLLS ==============================================

  /**
   * @description Starts a poll in the connected user's channel that viewers vote on in chat. Provide a title (up to 60 characters), 2-5 choice titles (up to 25 characters each), and a duration between 15 and 1800 seconds. Optionally allow viewers to cast additional votes with Channel Points. Requires the 'channel:manage:polls' scope. Returns the created poll including its id and choice ids.
   *
   * @route POST /create-poll
   * @operationName Create Poll
   * @category Polls
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The question viewers vote on, up to 60 characters (e.g. 'Heads or Tails?')."}
   * @paramDef {"type":"Array<String>","label":"Choices","name":"choices","required":true,"description":"The answer options viewers pick from. Between 2 and 5 choices, each up to 25 characters."}
   * @paramDef {"type":"Number","label":"Duration (Seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long the poll runs, in seconds. Range: 15-1800. Default: 300."}
   * @paramDef {"type":"Boolean","label":"Channel Points Voting","name":"channelPointsVotingEnabled","uiComponent":{"type":"CHECKBOX"},"description":"Whether viewers may cast additional votes using Channel Points. Default: false."}
   * @paramDef {"type":"Number","label":"Channel Points Per Vote","name":"channelPointsPerVote","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of Channel Points a viewer must spend per additional vote. Range: 1-1000000. Only used when Channel Points Voting is enabled."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ed961efd-8a3f-4cf5-a9d0-e616c590cd2a","broadcaster_id":"141981764","broadcaster_name":"TwitchDev","broadcaster_login":"twitchdev","title":"Heads or Tails?","choices":[{"id":"4c123012-1351-4f33-84b7-43856e7a0f47","title":"Heads","votes":0,"channel_points_votes":0},{"id":"279087e3-54a7-467e-bcd0-c1393fcea4f0","title":"Tails","votes":0,"channel_points_votes":0}],"channel_points_voting_enabled":false,"channel_points_per_vote":0,"status":"ACTIVE","duration":300,"started_at":"2021-03-19T06:08:33Z"}
   */
  async createPoll(title, choices, duration, channelPointsVotingEnabled, channelPointsPerVote) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const choiceList = toArray(choices)

    if (choiceList.length < 2 || choiceList.length > 5) {
      throw new Error('Between 2 and 5 choices are required')
    }

    const body = {
      broadcaster_id: await this.#getUserId(),
      title,
      choices: choiceList.map(choiceTitle => ({ title: choiceTitle })),
      duration: duration || 300,
    }

    if (channelPointsVotingEnabled !== undefined && channelPointsVotingEnabled !== null) {
      body.channel_points_voting_enabled = channelPointsVotingEnabled
    }

    if (channelPointsPerVote !== undefined && channelPointsPerVote !== null) {
      body.channel_points_per_vote = channelPointsPerVote
    }

    const response = await this.#apiRequest({
      logTag: 'createPoll',
      method: 'post',
      url: `${ API_BASE_URL }/polls`,
      body,
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  /**
   * @description Retrieves the polls of the connected user's channel, most recent first (polls are available for 90 days). Optionally look up specific polls by id. Returns each poll's title, choices with vote counts, status, and timing. Requires the 'channel:manage:polls' scope.
   *
   * @route GET /get-polls
   * @operationName Get Polls
   * @category Polls
   *
   * @paramDef {"type":"Array<String>","label":"Poll IDs","name":"pollIds","description":"Optional specific poll ids to retrieve. Maximum 20 per request. When omitted, the channel's polls are listed."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of polls to return per page. Range: 1-20. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ed961efd-8a3f-4cf5-a9d0-e616c590cd2a","broadcaster_id":"141981764","broadcaster_name":"TwitchDev","title":"Heads or Tails?","choices":[{"id":"4c123012-1351-4f33-84b7-43856e7a0f47","title":"Heads","votes":12,"channel_points_votes":0},{"id":"279087e3-54a7-467e-bcd0-c1393fcea4f0","title":"Tails","votes":9,"channel_points_votes":0}],"channel_points_voting_enabled":false,"status":"COMPLETED","duration":300,"started_at":"2021-03-19T06:08:33Z","ended_at":"2021-03-19T06:13:33Z"}],"cursor":"eyJiIjpudWxsLCJhIjoiIn0"}
   */
  async getPolls(pollIds, pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getPolls',
      url: `${ API_BASE_URL }/polls`,
      query: {
        broadcaster_id: await this.#getUserId(),
        id: toArray(pollIds),
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  /**
   * @description Ends an active poll in the connected user's channel. Choose 'Terminated' to end the poll and show the results to viewers, or 'Archived' to end it and hide the results. Requires the 'channel:manage:polls' scope. Returns the poll in its final state.
   *
   * @route PATCH /end-poll
   * @operationName End Poll
   * @category Polls
   *
   * @paramDef {"type":"String","label":"Poll ID","name":"pollId","required":true,"description":"The id of the active poll to end."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Terminated","uiComponent":{"type":"DROPDOWN","options":{"values":["Terminated","Archived"]}},"description":"How to end the poll: 'Terminated' ends it and keeps the results visible; 'Archived' ends it and hides the results. Default: 'Terminated'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ed961efd-8a3f-4cf5-a9d0-e616c590cd2a","broadcaster_id":"141981764","broadcaster_name":"TwitchDev","title":"Heads or Tails?","choices":[{"id":"4c123012-1351-4f33-84b7-43856e7a0f47","title":"Heads","votes":28,"channel_points_votes":0},{"id":"279087e3-54a7-467e-bcd0-c1393fcea4f0","title":"Tails","votes":17,"channel_points_votes":0}],"status":"TERMINATED","duration":300,"started_at":"2021-03-19T06:08:33Z","ended_at":"2021-03-19T06:11:26Z"}
   */
  async endPoll(pollId, status) {
    if (!pollId) {
      throw new Error('"Poll ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'endPoll',
      method: 'patch',
      url: `${ API_BASE_URL }/polls`,
      body: {
        broadcaster_id: await this.#getUserId(),
        id: pollId,
        status: this.#resolveChoice(status || 'Terminated', POLL_STATUS_OPTIONS),
      },
    })

    return Array.isArray(response.data) ? response.data[0] : response
  }

  // =========================================== SUBSCRIPTIONS =========================================

  /**
   * @description Retrieves the users subscribed to the connected user's channel, along with the total subscriber count and total subscriber points (tier 1 = 1 point, tier 2 = 2, tier 3 = 6). Includes subscription tier and gift information for each subscriber. Requires the 'channel:read:subscriptions' scope and a Twitch Affiliate or Partner account. Optionally check specific users by id.
   *
   * @route GET /get-broadcaster-subscriptions
   * @operationName Get Broadcaster Subscriptions
   * @category Subscriptions
   *
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","description":"Optional Twitch user ids to check. When provided, the response contains only those of these users who are subscribed. Maximum 100."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of subscriptions to return per page. Range: 1-100. Default: 20."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's 'cursor' value, used to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"broadcaster_id":"141981764","broadcaster_login":"twitchdev","broadcaster_name":"TwitchDev","gifter_id":"12826","gifter_login":"twitch","gifter_name":"Twitch","is_gift":true,"tier":"1000","plan_name":"Channel Subscription (twitchdev)","user_id":"527115020","user_login":"twitchgaming","user_name":"twitchgaming"}],"total":13,"points":13,"cursor":"xxxx"}
   */
  async getBroadcasterSubscriptions(userIds, pageSize, after) {
    const response = await this.#apiRequest({
      logTag: 'getBroadcasterSubscriptions',
      url: `${ API_BASE_URL }/subscriptions`,
      query: {
        broadcaster_id: await this.#getUserId(),
        user_id: toArray(userIds),
        first: pageSize,
        after,
      },
    })

    return this.#unwrap(response)
  }

  // =============================================== BITS ==============================================

  /**
   * @description Retrieves the Bits leaderboard for the connected user's channel — the viewers who cheered the most Bits, ranked by amount. Restrict the leaderboard to a day, week, month, or year anchored at a start date, or use all-time totals. Optionally look up a specific user's rank. Requires the 'bits:read' scope.
   *
   * @route GET /get-bits-leaderboard
   * @operationName Get Bits Leaderboard
   * @category Bits
   *
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of leaderboard entries to return. Range: 1-100. Default: 10."}
   * @paramDef {"type":"String","label":"Period","name":"period","defaultValue":"All Time","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month","Year","All Time"]}},"description":"The time window to aggregate Bits over, anchored at Started At. Default: 'All Time'."}
   * @paramDef {"type":"String","label":"Started At","name":"startedAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The start date (RFC3339) the Period is anchored to. Ignored when Period is 'All Time'."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Optional Twitch user id whose leaderboard position to retrieve. Returns the users ranked around this user."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"user_id":"158010205","user_login":"tundracowboy","user_name":"TundraCowboy","rank":1,"score":12543},{"user_id":"7168163","user_login":"topramens","user_name":"Topramens","rank":2,"score":6900}],"date_range":{"started_at":"2018-02-05T08:00:00Z","ended_at":"2018-02-12T08:00:00Z"},"total":2}
   */
  async getBitsLeaderboard(count, period, startedAt, userId) {
    const response = await this.#apiRequest({
      logTag: 'getBitsLeaderboard',
      url: `${ API_BASE_URL }/bits/leaderboard`,
      query: {
        count,
        period: this.#resolveChoice(period, BITS_PERIOD_OPTIONS),
        started_at: toRfc3339(startedAt),
        user_id: userId,
      },
    })

    return {
      items: Array.isArray(response.data) ? response.data : [],
      date_range: response.date_range,
      total: response.total,
    }
  }
}

Flowrunner.ServerCode.addService(TwitchService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your Twitch application from https://dev.twitch.tv/console/apps.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Twitch application from https://dev.twitch.tv/console/apps.',
  },
])

// Builds a query string supporting Twitch's repeated-parameter convention (e.g. login=a&login=b).
function buildQueryString(query) {
  if (!query) {
    return ''
  }

  const params = new URLSearchParams()

  Object.keys(query).forEach(key => {
    const value = query[key]

    if (value === undefined || value === null || value === '') {
      return
    }

    if (Array.isArray(value)) {
      value
        .filter(item => item !== undefined && item !== null && item !== '')
        .forEach(item => params.append(key, item))
    } else {
      params.append(key, value)
    }
  })

  return params.toString()
}

function toArray(value) {
  if (value === undefined || value === null) {
    return []
  }

  return (Array.isArray(value) ? value : [value]).filter(item => item !== undefined && item !== null && item !== '')
}

// Normalizes date picker output (epoch millis or a date string) to the RFC3339 format Twitch expects.
function toRfc3339(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const date = typeof value === 'number' ? new Date(value) : new Date(String(value))

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${ value }`)
  }

  return date.toISOString()
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
