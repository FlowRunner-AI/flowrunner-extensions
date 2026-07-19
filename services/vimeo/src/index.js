'use strict'

const AUTHORIZE_URL = 'https://api.vimeo.com/oauth/authorize'
const TOKEN_URL = 'https://api.vimeo.com/oauth/access_token'
const API_BASE_URL = 'https://api.vimeo.com'

// Vimeo requires an explicit API version in the Accept header.
const ACCEPT_HEADER = 'application/vnd.vimeo.*+json;version=3.4'

const DEFAULT_SCOPE_LIST = [
  'public',
  'private',
  'create',
  'edit',
  'delete',
  'upload',
  'interact',
  'stats',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const MAX_PER_PAGE = 100

const MY_VIDEOS_SORT_OPTIONS = {
  'Date': 'date',
  'Alphabetical': 'alphabetical',
  'Plays': 'plays',
  'Likes': 'likes',
  'Modified Time': 'modified_time',
}

const SEARCH_SORT_OPTIONS = {
  'Relevant': 'relevant',
  'Date': 'date',
  'Plays': 'plays',
}

const DIRECTION_OPTIONS = {
  'Ascending': 'asc',
  'Descending': 'desc',
}

const PRIVACY_VIEW_OPTIONS = {
  'Anybody': 'anybody',
  'Nobody': 'nobody',
  'Password': 'password',
  'Unlisted': 'unlisted',
  'Hide from Vimeo': 'disable',
}

const EMBED_PRIVACY_OPTIONS = {
  'Public': 'public',
  'Whitelist': 'whitelist',
}

const SHOWCASE_PRIVACY_OPTIONS = {
  'Anybody': 'anybody',
  'Embed Only': 'embed_only',
  'Password': 'password',
}

const LICENSE_OPTIONS = {
  'CC BY (Attribution)': 'by',
  'CC BY-SA (Attribution-ShareAlike)': 'by-sa',
  'CC BY-ND (Attribution-NoDerivs)': 'by-nd',
  'CC BY-NC (Attribution-NonCommercial)': 'by-nc',
  'CC BY-NC-SA (Attribution-NonCommercial-ShareAlike)': 'by-nc-sa',
  'CC BY-NC-ND (Attribution-NonCommercial-NoDerivs)': 'by-nc-nd',
  'CC0 (Public Domain Dedication)': 'cc0',
}

const CONTENT_RATING_OPTIONS = {
  'Safe': 'safe',
  'Language': 'language',
  'Drugs': 'drugs',
  'Violence': 'violence',
  'Nudity': 'nudity',
  'Advertisement': 'advertisement',
  'Unrated': 'unrated',
}

const logger = {
  info: (...args) => console.log('[Vimeo] info:', ...args),
  debug: (...args) => console.log('[Vimeo] debug:', ...args),
  error: (...args) => console.log('[Vimeo] error:', ...args),
  warn: (...args) => console.log('[Vimeo] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Vimeo
 * @integrationIcon /icon.svg
 **/
class VimeoService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
          'Accept': ACCEPT_HEADER,
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Vimeo returns 204 No Content for many write endpoints (likes, folder/showcase membership,
      // deletes). Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Vimeo API error: ${ message }`)
    }
  }

  // Vimeo API errors are shaped as { error, developer_message, error_code, link };
  // the OAuth endpoints use { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      const parts = []

      if (body.error && typeof body.error === 'string') {
        parts.push(body.error)
      }

      if (body.developer_message) {
        parts.push(body.developer_message)
      } else if (body.error_description) {
        parts.push(body.error_description)
      }

      if (body.error_code) {
        parts.push(`(error code ${ body.error_code })`)
      }

      if (parts.length) {
        return parts.join(' ')
      }

      if (body.message) {
        return body.message
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

  // Extracts a numeric video id from a raw id, an API URI ("/videos/123456789"),
  // or any vimeo.com / player.vimeo.com URL.
  #videoId(value) {
    if (!value) {
      return value
    }

    const trimmed = String(value).trim()

    const uriMatch = trimmed.match(/\/videos\/(\d+)/)

    if (uriMatch) {
      return uriMatch[1]
    }

    const urlMatch = trimmed.match(/vimeo\.com\/(?:[a-z]+\/)?(\d+)/i)

    if (urlMatch) {
      return urlMatch[1]
    }

    return trimmed
  }

  // Extracts a resource id (folder, showcase, channel, user) from a raw id, an API URI
  // ("/users/123/projects/456"), or a URL — resolves to the last path segment.
  #resourceId(value) {
    if (!value) {
      return value
    }

    const trimmed = String(value).trim().replace(/\/+$/, '')
    const lastSegment = trimmed.split('/').pop()

    return lastSegment || trimmed
  }

  #perPage(perPage) {
    if (perPage === undefined || perPage === null || perPage === '') {
      return undefined
    }

    const parsed = parseInt(perPage, 10)

    if (!parsed || parsed < 1) {
      return undefined
    }

    return Math.min(parsed, MAX_PER_PAGE)
  }

  // Unwraps Vimeo's { data, total, page, per_page, paging } list envelope
  // into a flat { items, total, page, perPage, nextPage } object.
  #listResult(response, requestedPage) {
    const page = response.page || requestedPage || 1

    return {
      items: Array.isArray(response.data) ? response.data : [],
      total: response.total,
      page,
      perPage: response.per_page,
      nextPage: response.paging?.next ? page + 1 : null,
    }
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('state', `flowrunner_${ Date.now() }`)

    // redirect_uri is injected by the FlowRunner platform (repo OAuth pattern) — do not append it here.
    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/json',
      'Accept': ACCEPT_HEADER,
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
    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send({
        grant_type: 'authorization_code',
        code: callbackObject.code,
        redirect_uri: callbackObject.redirectURI,
      })

    // Vimeo's token response embeds the authenticated user object.
    let user = tokenResponse.user || {}

    if (!user.name) {
      try {
        user = await Flowrunner.Request
          .get(`${ API_BASE_URL }/me`)
          .set({
            'Authorization': `Bearer ${ tokenResponse.access_token }`,
            'Accept': ACCEPT_HEADER,
          })
      } catch (error) {
        logger.error(`[executeCallback] /me error: ${ error.message }`)
      }
    }

    const pictureSizes = user.pictures?.sizes
    const connectionIdentityImageURL = Array.isArray(pictureSizes) && pictureSizes.length
      ? pictureSizes[pictureSizes.length - 1]?.link || null
      : null

    return {
      token: tokenResponse.access_token,
      // Vimeo access tokens NEVER expire and Vimeo issues NO refresh tokens, so no
      // expirationInSeconds is returned. The access token is stored as the "refresh token"
      // too, so refreshToken() can hand the same credentials back unchanged if invoked.
      refreshToken: tokenResponse.access_token,
      connectionIdentityName: user.name || user.link || 'Vimeo Account',
      connectionIdentityImageURL,
      overwrite: true,
      userData: {
        uri: user.uri,
        name: user.name,
        link: user.link,
        account: user.account,
        scope: tokenResponse.scope,
      },
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
    // Vimeo access tokens do not expire and there is no refresh-token grant, so there is
    // nothing to exchange. executeCallback stores the access token as the refresh token;
    // simply return the stored token data unchanged.
    return {
      token: refreshToken,
      refreshToken,
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
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved folders by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of folders."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Lists the folders (projects) in the connected user's Vimeo library for selection in dependent parameters. Returns the folder name as the label and the numeric folder id as the value.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Marketing","value":"12345678","note":"14 videos"}],"cursor":"2"}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getFoldersDictionary',
      url: `${ API_BASE_URL }/me/projects`,
      query: { page, per_page: MAX_PER_PAGE },
    })

    const folders = Array.isArray(response.data) ? response.data : []

    const filtered = search
      ? folders.filter(folder => folder?.name && folder.name.toLowerCase().includes(search.toLowerCase()))
      : folders

    return {
      cursor: response.paging?.next ? String(page + 1) : undefined,
      items: filtered.map(folder => {
        const videosTotal = folder.metadata?.connections?.videos?.total

        return {
          label: folder.name,
          value: this.#resourceId(folder.uri),
          note: videosTotal !== undefined ? `${ videosTotal } videos` : '',
        }
      }),
    }
  }

  /**
   * @typedef {Object} getShowcasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter showcases by name. The filter is applied by the Vimeo API."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of showcases."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Showcases Dictionary
   * @description Lists the connected user's showcases (albums) for selection in dependent parameters. Returns the showcase name as the label and the numeric showcase id as the value.
   * @route POST /get-showcases-dictionary
   * @paramDef {"type":"getShowcasesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Customer Stories","value":"87654321","note":"8 videos"}],"cursor":"2"}
   */
  async getShowcasesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getShowcasesDictionary',
      url: `${ API_BASE_URL }/me/albums`,
      query: { page, per_page: MAX_PER_PAGE, query: search || undefined },
    })

    const showcases = Array.isArray(response.data) ? response.data : []

    return {
      cursor: response.paging?.next ? String(page + 1) : undefined,
      items: showcases.map(showcase => {
        const videosTotal = showcase.metadata?.connections?.videos?.total

        return {
          label: showcase.name,
          value: this.#resourceId(showcase.uri),
          note: videosTotal !== undefined ? `${ videosTotal } videos` : '',
        }
      }),
    }
  }

  /**
   * @typedef {Object} getMyVideosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to search videos by. The search is performed by the Vimeo API across the user's library."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of videos."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Videos Dictionary
   * @description Lists the connected user's most recent videos for selection in dependent parameters. Returns the video title as the label and the numeric video id as the value.
   * @route POST /get-my-videos-dictionary
   * @paramDef {"type":"getMyVideosDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Product Demo","value":"123456789","note":"2026-01-15"}],"cursor":"2"}
   */
  async getMyVideosDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getMyVideosDictionary',
      url: `${ API_BASE_URL }/me/videos`,
      query: {
        page,
        per_page: 50,
        sort: 'date',
        direction: 'desc',
        query: search || undefined,
      },
    })

    const videos = Array.isArray(response.data) ? response.data : []

    return {
      cursor: response.paging?.next ? String(page + 1) : undefined,
      items: videos.map(video => ({
        label: video.name,
        value: this.#videoId(video.uri),
        note: video.created_time ? String(video.created_time).slice(0, 10) : '',
      })),
    }
  }

  // ============================================= VIDEOS ==============================================

  /**
   * @description Retrieves the videos in the connected user's Vimeo library, paginated (up to 100 per page). Supports free-text search across titles and descriptions, sorting by date, name, plays, likes, or modified time in either direction, and an optional filter to only return playable (fully transcoded, non-restricted) videos. Returns a flat list object with the video items, the total count, and the next page number when more results exist.
   *
   * @route GET /list-my-videos
   * @operationName List My Videos
   * @category Videos
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional free-text search applied to the titles and descriptions of the user's videos."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","Alphabetical","Plays","Likes","Modified Time"]}},"description":"The field to sort results by. When omitted, Vimeo's default ordering (upload date) is used."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"The sort direction, applied together with 'Sort By'. Default: Descending."}
   * @paramDef {"type":"Boolean","label":"Playable Only","name":"playableOnly","uiComponent":{"type":"CHECKBOX"},"description":"When true, only returns videos that are playable (finished transcoding and not restricted)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of videos per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/123456789","name":"Product Demo","link":"https://vimeo.com/123456789","duration":128,"created_time":"2026-01-15T10:00:00+00:00","privacy":{"view":"anybody"},"stats":{"plays":42}}],"total":12,"page":1,"perPage":25,"nextPage":null}
   */
  async listMyVideos(query, sort, direction, playableOnly, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listMyVideos',
      url: `${ API_BASE_URL }/me/videos`,
      query: {
        query,
        sort: this.#resolveChoice(sort, MY_VIDEOS_SORT_OPTIONS),
        direction: this.#resolveChoice(direction, DIRECTION_OPTIONS),
        filter: playableOnly ? 'playable' : undefined,
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Retrieves a single video by its id, URI, or vimeo.com URL. Returns the full video object including name, description, link, duration, dimensions, privacy settings, pictures (thumbnails), stats, upload/transcode status, and metadata connections.
   *
   * @route GET /get-video
   * @operationName Get Video
   * @category Videos
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL. Select one of your videos or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789","name":"Product Demo","description":"A walkthrough of the product.","link":"https://vimeo.com/123456789","duration":128,"width":1920,"height":1080,"created_time":"2026-01-15T10:00:00+00:00","privacy":{"view":"anybody","embed":"public","download":false},"stats":{"plays":42}}
   */
  async getVideo(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'getVideo',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }`,
    })
  }

  /**
   * @description Updates the metadata and privacy settings of a video owned by the connected user. Only provided fields are changed. Supports renaming, editing the description, changing who can view the video (including password protection and unlisted links), controlling embedding, downloads and showcase additions, and setting a Creative Commons license, language locale, or content ratings. When 'Privacy View' is set to 'Password', a 'Password' value must also be provided. Requires the 'edit' scope. Returns the updated video object.
   *
   * @route PATCH /update-video
   * @operationName Update Video
   * @category Videos
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new title for the video."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description for the video."}
   * @paramDef {"type":"String","label":"Privacy View","name":"privacyView","uiComponent":{"type":"DROPDOWN","options":{"values":["Anybody","Nobody","Password","Unlisted","Hide from Vimeo"]}},"description":"Who can view the video: 'Anybody' (public), 'Nobody' (only the owner), 'Password' (requires the Password parameter), 'Unlisted' (only via private link), or 'Hide from Vimeo' (embeddable but hidden on vimeo.com). Some options require a paid Vimeo plan."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"The viewing password. Required when 'Privacy View' is set to 'Password'."}
   * @paramDef {"type":"String","label":"Embed Privacy","name":"embedPrivacy","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Whitelist"]}},"description":"Where the video can be embedded: 'Public' (anywhere) or 'Whitelist' (only on domains you have whitelisted in Vimeo)."}
   * @paramDef {"type":"Boolean","label":"Allow Download","name":"allowDownload","uiComponent":{"type":"CHECKBOX"},"description":"Whether viewers can download the video file. Requires a paid Vimeo plan."}
   * @paramDef {"type":"Boolean","label":"Allow Adding","name":"allowAdd","uiComponent":{"type":"CHECKBOX"},"description":"Whether other Vimeo users can add the video to their own showcases, channels, or groups."}
   * @paramDef {"type":"String","label":"License","name":"license","uiComponent":{"type":"DROPDOWN","options":{"values":["CC BY (Attribution)","CC BY-SA (Attribution-ShareAlike)","CC BY-ND (Attribution-NoDerivs)","CC BY-NC (Attribution-NonCommercial)","CC BY-NC-SA (Attribution-NonCommercial-ShareAlike)","CC BY-NC-ND (Attribution-NonCommercial-NoDerivs)","CC0 (Public Domain Dedication)"]}},"description":"Optional Creative Commons license to publish the video under."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional language locale of the video (e.g. 'en-US')."}
   * @paramDef {"type":"Array<String>","label":"Content Ratings","name":"contentRating","uiComponent":{"type":"DROPDOWN","options":{"values":["Safe","Language","Drugs","Violence","Nudity","Advertisement","Unrated"]}},"description":"Optional self-assigned content ratings for the video. Use 'Safe' alone for all-audience content."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789","name":"Product Demo (v2)","description":"Updated walkthrough.","link":"https://vimeo.com/123456789","privacy":{"view":"unlisted","embed":"public","download":true,"add":false},"duration":128}
   */
  async updateVideo(videoId, name, description, privacyView, password, embedPrivacy, allowDownload, allowAdd, license, locale, contentRating) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    const body = {}

    if (name !== undefined) {
      body.name = name
    }

    if (description !== undefined) {
      body.description = description
    }

    const privacy = {}

    if (privacyView) {
      privacy.view = this.#resolveChoice(privacyView, PRIVACY_VIEW_OPTIONS)
    }

    if (embedPrivacy) {
      privacy.embed = this.#resolveChoice(embedPrivacy, EMBED_PRIVACY_OPTIONS)
    }

    if (allowDownload !== undefined) {
      privacy.download = allowDownload
    }

    if (allowAdd !== undefined) {
      privacy.add = allowAdd
    }

    if (Object.keys(privacy).length) {
      body.privacy = privacy
    }

    if (password !== undefined && password !== '') {
      body.password = password
    }

    if (license) {
      body.license = this.#resolveChoice(license, LICENSE_OPTIONS)
    }

    if (locale) {
      body.locale = locale
    }

    if (contentRating && (Array.isArray(contentRating) ? contentRating.length : contentRating)) {
      body.content_rating = (Array.isArray(contentRating) ? contentRating : [contentRating])
        .filter(Boolean)
        .map(rating => this.#resolveChoice(rating, CONTENT_RATING_OPTIONS))
    }

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateVideo',
      method: 'patch',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }`,
      body,
    })
  }

  /**
   * @description Permanently deletes a video owned by the connected user. This cannot be undone. Requires the 'delete' scope. Returns a success status (Vimeo returns no content).
   *
   * @route DELETE /delete-video
   * @operationName Delete Video
   * @category Videos
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteVideo(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteVideo',
      method: 'delete',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }`,
    })
  }

  /**
   * @description Searches all public videos on Vimeo by keyword, paginated (up to 100 per page). Results can be ordered by relevance, upload date, or play count. This searches Vimeo's public catalog, not the connected user's library — use 'List My Videos' for that. Returns a flat list object with the matching video items, the total count, and the next page number when more results exist.
   *
   * @route GET /search-videos
   * @operationName Search Public Videos
   * @category Videos
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","required":true,"description":"The search keywords to match against public videos."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevant","Date","Plays"]}},"description":"How to order the results: by relevance to the query, by upload date, or by play count. Default: Relevant."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"The sort direction, applied together with 'Sort By' (ignored for 'Relevant')."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of videos per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/987654321","name":"Aerial Iceland","link":"https://vimeo.com/987654321","duration":215,"user":{"name":"Example Studio"},"stats":{"plays":120450}}],"total":5321,"page":1,"perPage":25,"nextPage":2}
   */
  async searchVideos(query, sort, direction, page, perPage) {
    if (!query) {
      throw new Error('"Search Query" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'searchVideos',
      url: `${ API_BASE_URL }/videos`,
      query: {
        query,
        sort: this.#resolveChoice(sort, SEARCH_SORT_OPTIONS),
        direction: this.#resolveChoice(direction, DIRECTION_OPTIONS),
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  // ============================================= UPLOAD ==============================================

  /**
   * @description Uploads a video to the connected user's Vimeo account from a publicly accessible file URL using Vimeo's "pull" approach: Vimeo downloads the file from the URL asynchronously, so this action returns immediately with the new video object (including its id and upload status) while the download and transcoding continue in the background. Use 'Get Upload Status' to poll for completion — the video is playable once transcode status is 'complete'. IMPORTANT: uploading requires the 'upload' capability, which Vimeo grants to apps on request (a routine review at developer.vimeo.com); until granted, this action fails with a 403 error. Uploads also count against the account's storage quota.
   *
   * @route POST /upload-video-from-url
   * @operationName Upload Video from URL
   * @category Upload
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"A publicly accessible URL of the video file to upload. Vimeo downloads the file from this URL directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional title for the new video. When omitted, Vimeo derives a title from the file."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the new video."}
   * @paramDef {"type":"String","label":"Privacy View","name":"privacyView","uiComponent":{"type":"DROPDOWN","options":{"values":["Anybody","Nobody","Password","Unlisted","Hide from Vimeo"]}},"description":"Who can view the uploaded video. When 'Password' is selected, also provide the Password parameter. Some options require a paid Vimeo plan. Default: the account's default privacy."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"The viewing password. Required when 'Privacy View' is set to 'Password'."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789","name":"Product Demo","link":"https://vimeo.com/123456789","upload":{"approach":"pull","status":"in_progress"},"transcode":{"status":"in_progress"},"privacy":{"view":"unlisted"}}
   */
  async uploadVideoFromUrl(fileUrl, name, description, privacyView, password) {
    if (!fileUrl) {
      throw new Error('"File URL" is required')
    }

    const body = {
      upload: {
        approach: 'pull',
        link: fileUrl,
      },
    }

    if (name !== undefined) {
      body.name = name
    }

    if (description !== undefined) {
      body.description = description
    }

    if (privacyView) {
      body.privacy = { view: this.#resolveChoice(privacyView, PRIVACY_VIEW_OPTIONS) }
    }

    if (password !== undefined && password !== '') {
      body.password = password
    }

    return this.#apiRequest({
      logTag: 'uploadVideoFromUrl',
      method: 'post',
      url: `${ API_BASE_URL }/me/videos`,
      body,
    })
  }

  /**
   * @description Retrieves the upload and transcode status of a video, useful for polling after 'Upload Video from URL'. The upload status becomes 'complete' once Vimeo has received the file, and the transcode status becomes 'complete' once the video is processed and playable ('in_progress' while processing, 'error' on failure).
   *
   * @route GET /get-upload-status
   * @operationName Get Upload Status
   * @category Upload
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to check."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789","upload":{"status":"complete"},"transcode":{"status":"in_progress"}}
   */
  async getUploadStatus(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'getUploadStatus',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }`,
      query: { fields: 'uri,upload.status,transcode.status' },
    })
  }

  // ============================================ THUMBNAILS ===========================================

  /**
   * @description Retrieves the thumbnail images (pictures) of a video, paginated. Each thumbnail includes its available sizes with direct image links and whether it is the active thumbnail shown on Vimeo. Returns a flat list object with the thumbnail items, the total count, and the next page number when more results exist.
   *
   * @route GET /list-video-thumbnails
   * @operationName List Video Thumbnails
   * @category Thumbnails
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of thumbnails per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/123456789/pictures/111222333","active":true,"type":"custom","sizes":[{"width":1920,"height":1080,"link":"https://i.vimeocdn.com/video/111222333_1920x1080.jpg"}]}],"total":2,"page":1,"perPage":25,"nextPage":null}
   */
  async listVideoThumbnails(videoId, page, perPage) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'listVideoThumbnails',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }/pictures`,
      query: {
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Creates a new thumbnail for a video from a frame at the specified time offset and (by default) makes it the active thumbnail. The video must be fully transcoded before frames can be captured, and the time offset must be within the video's duration. Note: uploading a custom image as a thumbnail is a separate multi-step upload flow that this action does not cover. Returns the created thumbnail object.
   *
   * @route POST /set-thumbnail-from-frame
   * @operationName Set Thumbnail from Frame
   * @category Thumbnails
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video."}
   * @paramDef {"type":"Number","label":"Time (Seconds)","name":"timeSeconds","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The playback offset in seconds at which to capture the frame (may be fractional, e.g. 12.5). Must be within the video's duration."}
   * @paramDef {"type":"Boolean","label":"Set as Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"Whether to make the captured frame the video's active thumbnail. Default: true."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789/pictures/111222333","active":true,"type":"custom","sizes":[{"width":1920,"height":1080,"link":"https://i.vimeocdn.com/video/111222333_1920x1080.jpg"}]}
   */
  async setThumbnailFromFrame(videoId, timeSeconds, active) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    if (timeSeconds === undefined || timeSeconds === null) {
      throw new Error('"Time (Seconds)" is required')
    }

    return this.#apiRequest({
      logTag: 'setThumbnailFromFrame',
      method: 'post',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }/pictures`,
      body: {
        time: timeSeconds,
        active: active === undefined ? true : active,
      },
    })
  }

  // ============================================= FOLDERS =============================================

  /**
   * @description Retrieves the folders (projects) in the connected user's Vimeo library, paginated. Folders organize videos in the library without affecting their privacy. Returns a flat list object with the folder items (including their URIs, from which the numeric folder id can be taken), the total count, and the next page number when more results exist.
   *
   * @route GET /list-folders
   * @operationName List Folders
   * @category Folders
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of folders per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/users/11111111/projects/12345678","name":"Marketing","created_time":"2026-01-10T09:00:00+00:00","metadata":{"connections":{"videos":{"total":14}}}}],"total":3,"page":1,"perPage":25,"nextPage":null}
   */
  async listFolders(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listFolders',
      url: `${ API_BASE_URL }/me/projects`,
      query: {
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Creates a new folder (project) in the connected user's Vimeo library for organizing videos. Requires the 'create' scope. Returns the created folder object including its URI, from which the numeric folder id can be taken.
   *
   * @route POST /create-folder
   * @operationName Create Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new folder."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/users/11111111/projects/12345678","name":"Marketing","created_time":"2026-01-10T09:00:00+00:00","modified_time":"2026-01-10T09:00:00+00:00"}
   */
  async createFolder(name) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'createFolder',
      method: 'post',
      url: `${ API_BASE_URL }/me/projects`,
      body: { name },
    })
  }

  /**
   * @description Adds a video from the connected user's library to one of their folders (projects). A video can belong to only one folder at a time — adding it to a new folder moves it there. Requires the 'interact' scope. Returns a success status (Vimeo returns no content).
   *
   * @route PUT /add-video-to-folder
   * @operationName Add Video to Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder (project) to add the video to. Select one of your folders or enter its numeric id or API URI directly."}
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to add."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async addVideoToFolder(folderId, videoId) {
    if (!folderId) {
      throw new Error('"Folder" is required')
    }

    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'addVideoToFolder',
      method: 'put',
      url: `${ API_BASE_URL }/me/projects/${ this.#resourceId(folderId) }/videos/${ this.#videoId(videoId) }`,
    })
  }

  // ============================================ SHOWCASES ============================================

  /**
   * @description Retrieves the connected user's showcases (albums), paginated, with an optional name search. Showcases are curated, shareable collections of videos. Returns a flat list object with the showcase items (including their URIs, from which the numeric showcase id can be taken), the total count, and the next page number when more results exist.
   *
   * @route GET /list-showcases
   * @operationName List Showcases
   * @category Showcases
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional text to filter showcases by name."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of showcases per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/users/11111111/albums/87654321","name":"Customer Stories","link":"https://vimeo.com/showcase/87654321","privacy":{"view":"anybody"},"metadata":{"connections":{"videos":{"total":8}}}}],"total":2,"page":1,"perPage":25,"nextPage":null}
   */
  async listShowcases(query, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listShowcases',
      url: `${ API_BASE_URL }/me/albums`,
      query: {
        query,
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Creates a new showcase (album) for the connected user. Showcases are curated, shareable collections of videos with their own privacy settings. When 'Privacy' is set to 'Password', a 'Password' value must also be provided. Requires the 'create' scope. Returns the created showcase object including its URI and shareable link.
   *
   * @route POST /create-showcase
   * @operationName Create Showcase
   * @category Showcases
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new showcase."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the showcase."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacy","uiComponent":{"type":"DROPDOWN","options":{"values":["Anybody","Embed Only","Password"]}},"description":"Who can view the showcase: 'Anybody' (public), 'Embed Only' (only where embedded), or 'Password' (requires the Password parameter). Default: Anybody."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"The viewing password. Required when 'Privacy' is set to 'Password'."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/users/11111111/albums/87654321","name":"Customer Stories","description":"Selected customer case studies.","link":"https://vimeo.com/showcase/87654321","privacy":{"view":"anybody"},"created_time":"2026-01-10T09:00:00+00:00"}
   */
  async createShowcase(name, description, privacy, password) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const body = { name }

    if (description !== undefined) {
      body.description = description
    }

    if (privacy) {
      body.privacy = this.#resolveChoice(privacy, SHOWCASE_PRIVACY_OPTIONS)
    }

    if (password !== undefined && password !== '') {
      body.password = password
    }

    return this.#apiRequest({
      logTag: 'createShowcase',
      method: 'post',
      url: `${ API_BASE_URL }/me/albums`,
      body,
    })
  }

  /**
   * @description Adds a video from the connected user's library to one of their showcases (albums). Unlike folders, a video can belong to any number of showcases. Requires the 'interact' scope. Returns a success status (Vimeo returns no content).
   *
   * @route PUT /add-video-to-showcase
   * @operationName Add Video to Showcase
   * @category Showcases
   *
   * @paramDef {"type":"String","label":"Showcase","name":"showcaseId","required":true,"dictionary":"getShowcasesDictionary","description":"The showcase (album) to add the video to. Select one of your showcases or enter its numeric id or API URI directly."}
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to add."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async addVideoToShowcase(showcaseId, videoId) {
    if (!showcaseId) {
      throw new Error('"Showcase" is required')
    }

    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'addVideoToShowcase',
      method: 'put',
      url: `${ API_BASE_URL }/me/albums/${ this.#resourceId(showcaseId) }/videos/${ this.#videoId(videoId) }`,
    })
  }

  /**
   * @description Retrieves a single showcase (album) belonging to the connected user, including its name, description, privacy settings, shareable link, and video count.
   *
   * @route GET /get-showcase
   * @operationName Get Showcase
   * @category Showcases
   *
   * @paramDef {"type":"String","label":"Showcase","name":"showcaseId","required":true,"dictionary":"getShowcasesDictionary","description":"The showcase (album) to retrieve. Select one of your showcases or enter its numeric id or API URI directly."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/users/11111111/albums/87654321","name":"Customer Stories","description":"Selected customer case studies.","link":"https://vimeo.com/showcase/87654321","privacy":{"view":"anybody"},"metadata":{"connections":{"videos":{"total":8}}}}
   */
  async getShowcase(showcaseId) {
    if (!showcaseId) {
      throw new Error('"Showcase" is required')
    }

    return this.#apiRequest({
      logTag: 'getShowcase',
      url: `${ API_BASE_URL }/me/albums/${ this.#resourceId(showcaseId) }`,
    })
  }

  // ============================================ CHANNELS =============================================

  /**
   * @description Retrieves the channels the connected user subscribes to or moderates, paginated. Channels are public, topic-based collections of videos curated by Vimeo members. Returns a flat list object with the channel items, the total count, and the next page number when more results exist.
   *
   * @route GET /list-my-channels
   * @operationName List My Channels
   * @category Channels
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of channels per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/channels/1234567","name":"Staff Picks","link":"https://vimeo.com/channels/staffpicks","description":"The best videos on Vimeo.","metadata":{"connections":{"videos":{"total":15000}}}}],"total":5,"page":1,"perPage":25,"nextPage":null}
   */
  async listMyChannels(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listMyChannels',
      url: `${ API_BASE_URL }/me/channels`,
      query: {
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Retrieves a single public channel by its numeric id, short name (e.g. 'staffpicks'), or vimeo.com channel URL. Returns channel details including name, description, link, header images, and video/follower counts.
   *
   * @route GET /get-channel
   * @operationName Get Channel
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"description":"The channel's numeric id, short name (e.g. 'staffpicks'), or vimeo.com channel URL."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/channels/1234567","name":"Staff Picks","link":"https://vimeo.com/channels/staffpicks","description":"The best videos on Vimeo.","created_time":"2011-01-01T00:00:00+00:00","metadata":{"connections":{"videos":{"total":15000},"users":{"total":900000}}}}
   */
  async getChannel(channelId) {
    if (!channelId) {
      throw new Error('"Channel" is required')
    }

    return this.#apiRequest({
      logTag: 'getChannel',
      url: `${ API_BASE_URL }/channels/${ encodeURIComponent(this.#resourceId(channelId)) }`,
    })
  }

  // ============================================ COMMENTS =============================================

  /**
   * @description Retrieves the comments on a video, paginated, newest first. Each comment includes its text, creation time, author details, and reply count. Returns a flat list object with the comment items, the total count, and the next page number when more results exist.
   *
   * @route GET /list-video-comments
   * @operationName List Video Comments
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of comments per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/123456789/comments/55555555","text":"Great video!","created_on":"2026-02-01T12:00:00+00:00","user":{"name":"Jane Viewer","link":"https://vimeo.com/janeviewer"}}],"total":4,"page":1,"perPage":25,"nextPage":null}
   */
  async listVideoComments(videoId, page, perPage) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'listVideoComments',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }/comments`,
      query: {
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  /**
   * @description Posts a comment on a video as the connected user. Comments must be enabled on the video, and the user must be allowed to comment on it. Requires the 'interact' scope. Returns the created comment object.
   *
   * @route POST /add-comment-to-video
   * @operationName Add Comment to Video
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to comment on."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the comment to post."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/videos/123456789/comments/55555555","text":"Great video!","created_on":"2026-02-01T12:00:00+00:00","user":{"name":"Connected User","link":"https://vimeo.com/connecteduser"}}
   */
  async addCommentToVideo(videoId, text) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'addCommentToVideo',
      method: 'post',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }/comments`,
      body: { text },
    })
  }

  // ============================================== LIKES ==============================================

  /**
   * @description Likes a video as the connected user. The video's owner must allow likes, and a video cannot be liked by its own owner. Requires the 'interact' scope. Returns a success status (Vimeo returns no content).
   *
   * @route PUT /like-video
   * @operationName Like Video
   * @category Likes
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to like."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async likeVideo(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'likeVideo',
      method: 'put',
      url: `${ API_BASE_URL }/me/likes/${ this.#videoId(videoId) }`,
    })
  }

  /**
   * @description Removes the connected user's like from a video. Requires the 'interact' scope. Returns a success status (Vimeo returns no content).
   *
   * @route DELETE /unlike-video
   * @operationName Unlike Video
   * @category Likes
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video to unlike."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async unlikeVideo(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    return this.#apiRequest({
      logTag: 'unlikeVideo',
      method: 'delete',
      url: `${ API_BASE_URL }/me/likes/${ this.#videoId(videoId) }`,
    })
  }

  /**
   * @description Retrieves the videos the connected user has liked, paginated. Returns a flat list object with the liked video items, the total count, and the next page number when more results exist.
   *
   * @route GET /list-liked-videos
   * @operationName List Liked Videos
   * @category Likes
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of videos per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/987654321","name":"Aerial Iceland","link":"https://vimeo.com/987654321","duration":215,"user":{"name":"Example Studio"}}],"total":37,"page":1,"perPage":25,"nextPage":2}
   */
  async listLikedVideos(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listLikedVideos',
      url: `${ API_BASE_URL }/me/likes`,
      query: {
        page,
        per_page: this.#perPage(perPage),
      },
    })

    return this.#listResult(response, page)
  }

  // ============================================ TEXT TRACKS ==========================================

  /**
   * @description Retrieves the text tracks (captions and subtitles) of a video. Each track includes its type, language, name, active state, and a direct download link to the track file. Returns a flat list object with the track items and the total count.
   *
   * @route GET /list-text-tracks
   * @operationName List Text Tracks
   * @category Text Tracks
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","required":true,"dictionary":"getMyVideosDictionary","description":"The Vimeo video id, API URI ('/videos/123456789'), or vimeo.com URL of the video."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"uri":"/videos/123456789/texttracks/44444444","type":"captions","language":"en-US","name":"English CC","active":true,"link":"https://captions.cloud.vimeo.com/captions/44444444.vtt"}],"total":1,"page":1,"perPage":25,"nextPage":null}
   */
  async listTextTracks(videoId) {
    if (!videoId) {
      throw new Error('"Video" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'listTextTracks',
      url: `${ API_BASE_URL }/videos/${ this.#videoId(videoId) }/texttracks`,
    })

    return this.#listResult(response, 1)
  }

  // ============================================== USERS ==============================================

  /**
   * @description Retrieves the profile of the connected Vimeo user, including name, profile link, bio, location, account tier (e.g. 'basic', 'plus', 'pro'), upload quota, and profile pictures. Useful as a connection check.
   *
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category Users
   *
   * @returns {Object}
   * @sampleResult {"uri":"/users/11111111","name":"Connected User","link":"https://vimeo.com/connecteduser","location":"Austin, TX","account":"pro","upload_quota":{"space":{"free":10737418240,"max":21474836480,"used":10737418240}}}
   */
  async getCurrentUser() {
    return this.#apiRequest({
      logTag: 'getCurrentUser',
      url: `${ API_BASE_URL }/me`,
    })
  }

  /**
   * @description Retrieves the public profile of any Vimeo user by their numeric id, API URI ('/users/123'), or vimeo.com profile URL. Returns the user's name, link, bio, location, account tier, and profile pictures.
   *
   * @route GET /get-user
   * @operationName Get User
   * @category Users
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"description":"The Vimeo user's numeric id, API URI ('/users/123'), or vimeo.com profile URL."}
   *
   * @returns {Object}
   * @sampleResult {"uri":"/users/22222222","name":"Example Studio","link":"https://vimeo.com/examplestudio","bio":"We make films.","location":"Reykjavik, Iceland","account":"pro"}
   */
  async getUser(userId) {
    if (!userId) {
      throw new Error('"User" is required')
    }

    return this.#apiRequest({
      logTag: 'getUser',
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(this.#resourceId(userId)) }`,
    })
  }
}

Flowrunner.ServerCode.addService(VimeoService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Identifier of your Vimeo app from https://developer.vimeo.com/apps.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Vimeo app from https://developer.vimeo.com/apps. Note: Upload actions additionally require upload access, which Vimeo grants to apps on request.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
