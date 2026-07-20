'use strict'

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const API_BASE_URL = 'https://open.tiktokapis.com/v2'

// Scopes requested during authorization. Comma-separated on the authorize URL (TikTok convention).
const DEFAULT_SCOPE_LIST = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'video.list',
  'video.publish',
  'video.upload',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(',')

// Fields available on GET /v2/user/info/. Used as the default (all) selection.
const USER_INFO_FIELDS = [
  'open_id',
  'union_id',
  'avatar_url',
  'display_name',
  'bio_description',
  'profile_deep_link',
  'is_verified',
  'username',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
]

// Fields returned for each video by the Display API list/query endpoints.
const VIDEO_FIELDS = [
  'id',
  'title',
  'video_description',
  'duration',
  'cover_image_url',
  'share_url',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
  'create_time',
]

// Friendly UI labels mapped to TikTok privacy_level API values.
const PRIVACY_LEVEL_OPTIONS = {
  'Public': 'PUBLIC_TO_EVERYONE',
  'Followers': 'FOLLOWER_OF_CREATOR',
  'Friends': 'MUTUAL_FOLLOW_FRIENDS',
  'Private': 'SELF_ONLY',
}

// TikTok caps a single-chunk (non-resumable) file upload at 64 MB.
const SINGLE_CHUNK_MAX_BYTES = 64 * 1024 * 1024

// Terminal states returned by the publish status endpoint.
const STATUS_COMPLETE = 'PUBLISH_COMPLETE'
const STATUS_FAILED = 'FAILED'

const logger = {
  info: (...args) => console.log('[TikTok] info:', ...args),
  debug: (...args) => console.log('[TikTok] debug:', ...args),
  error: (...args) => console.log('[TikTok] error:', ...args),
  warn: (...args) => console.log('[TikTok] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName TikTok
 * @integrationIcon /icon.svg
 **/
class TikTokService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  // Single private request helper. All Display and Content Posting API calls go through here.
  // The `fields` selector is passed as a QUERY param even on POST endpoints (TikTok convention);
  // the request body carries filters/paging.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json; charset=UTF-8',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      return this.#unwrap(response, logTag)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`TikTok API error: ${ message }`)
    }
  }

  // TikTok responses are shaped as { data: {...}, error: { code, message, log_id } }.
  // error.code === 'ok' means success; anything else is a failure to surface.
  #unwrap(response, logTag) {
    if (response && typeof response === 'object' && response.error) {
      const { code, message, log_id: logId } = response.error

      if (code && code !== 'ok') {
        logger.error(`${ logTag } - api error [${ code }]: ${ message } (log_id ${ logId })`)

        throw new Error(`${ message || code }${ logId ? ` (log_id ${ logId })` : '' }`)
      }
    }

    return response && typeof response === 'object' && 'data' in response ? response.data : response
  }

  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.error && typeof body.error === 'object') {
        const { message, code, log_id: logId } = body.error

        return `${ message || code || 'Request failed' }${ logId ? ` (log_id ${ logId })` : '' }`
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
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

  #resolveFields(fields, allowed, fallback) {
    const list = (Array.isArray(fields) ? fields : (fields ? [fields] : []))
      .filter(Boolean)
      .filter(field => allowed.includes(field))

    return (list.length ? list : fallback).join(',')
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    // NOTE: TikTok uses `client_key` (NOT `client_id`) for the authorize request.
    params.append('client_key', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('state', `flowrunner_${ Date.now() }`)

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

    params.append('client_key', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    if (tokenResponse.error && tokenResponse.error !== 'ok') {
      throw new Error(tokenResponse.error_description || tokenResponse.error)
    }

    let connectionIdentityName = 'TikTok Account'
    let connectionIdentityImageURL = null
    let userData = {}

    try {
      const info = await Flowrunner.Request
        .get(`${ API_BASE_URL }/user/info/`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })
        .query({ fields: 'open_id,display_name,avatar_url' })

      userData = info?.data?.user || {}
      connectionIdentityName = userData.display_name || connectionIdentityName
      connectionIdentityImageURL = userData.avatar_url || null
    } catch (error) {
      logger.error(`[executeCallback] user/info error: ${ error.message }`)
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

      params.append('client_key', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      if (response.error && response.error !== 'ok') {
        throw new Error(response.error_description || response.error)
      }

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        // TikTok issues a NEW refresh token on each refresh; return it so it is persisted.
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ============================================== USER ================================================

  /**
   * @description Retrieves the connected TikTok user's profile and statistics. Select which fields to return; by default all available fields are requested, including profile details (display name, username, avatar, bio, verification, profile link) and public stats (follower, following, likes and video counts). Requires the user.info.basic scope for identity fields and user.info.profile / user.info.stats for the extended profile and counts. Useful as a connection check.
   *
   * @route GET /get-user-info
   * @operationName Get User Info
   * @category User
   *
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","uiComponent":{"type":"DROPDOWN","options":{"values":["open_id","union_id","avatar_url","display_name","bio_description","profile_deep_link","is_verified","username","follower_count","following_count","likes_count","video_count"]}},"description":"Profile and stat fields to return. When omitted, all available fields are requested."}
   *
   * @returns {Object}
   * @sampleResult {"user":{"open_id":"723f24d7-e717-40f8-a2b6-cb8464cd23b4","union_id":"c9c60f44-a68e-4f5d-84dd-0eb...","display_name":"Jane Doe","username":"janedoe","avatar_url":"https://p16.tiktokcdn.com/avatar.jpeg","is_verified":false,"follower_count":12000,"following_count":180,"likes_count":450000,"video_count":312,"bio_description":"Creator","profile_deep_link":"https://www.tiktok.com/@janedoe"}}
   */
  async getUserInfo(fields) {
    return this.#apiRequest({
      logTag: 'getUserInfo',
      url: `${ API_BASE_URL }/user/info/`,
      query: { fields: this.#resolveFields(fields, USER_INFO_FIELDS, USER_INFO_FIELDS) },
    })
  }

  // ============================================== VIDEOS ==============================================

  /**
   * @description Lists the connected user's public videos in reverse-chronological order using the Display API. Returns each video's id, caption/title, description, duration, cover image, share URL and engagement counts (views, likes, comments, shares) plus create time. Supports paging via a max count (up to 20 per page) and an opaque cursor returned as has_more/cursor. Requires the video.list scope.
   *
   * @route POST /list-videos
   * @operationName List Videos
   * @category Videos
   *
   * @paramDef {"type":"Number","label":"Max Count","name":"maxCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of videos to return per page. Range: 1-20. Default: 20."}
   * @paramDef {"type":"Number","label":"Cursor","name":"cursor","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination cursor from a previous response's `cursor` field, used to retrieve the next page. Omit for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"videos":[{"id":"7112345678901234567","title":"My first post","video_description":"Hello TikTok","duration":15,"cover_image_url":"https://p16.tiktokcdn.com/cover.jpeg","share_url":"https://www.tiktok.com/@janedoe/video/7112345678901234567","view_count":15000,"like_count":1200,"comment_count":45,"share_count":30,"create_time":1718000000}],"cursor":1718000000,"has_more":true}
   */
  async listVideos(maxCount, cursor) {
    const body = { max_count: this.#clampMaxCount(maxCount) }

    if (cursor !== undefined && cursor !== null && cursor !== '') {
      body.cursor = Number(cursor)
    }

    return this.#apiRequest({
      logTag: 'listVideos',
      method: 'post',
      url: `${ API_BASE_URL }/video/list/`,
      query: { fields: VIDEO_FIELDS.join(',') },
      body,
    })
  }

  /**
   * @description Retrieves details for specific videos of the connected user by their ids using the Display API. Provide up to 20 video ids; returns each video's id, caption/title, description, duration, cover image, share URL and engagement counts (views, likes, comments, shares) plus create time. Only videos owned by the connected user can be queried. Requires the video.list scope.
   *
   * @route POST /query-videos
   * @operationName Query Videos
   * @category Videos
   *
   * @paramDef {"type":"Array<String>","label":"Video IDs","name":"videoIds","required":true,"description":"The video ids to fetch (owned by the connected user). Maximum 20 per request."}
   *
   * @returns {Object}
   * @sampleResult {"videos":[{"id":"7112345678901234567","title":"My first post","video_description":"Hello TikTok","duration":15,"cover_image_url":"https://p16.tiktokcdn.com/cover.jpeg","share_url":"https://www.tiktok.com/@janedoe/video/7112345678901234567","view_count":15000,"like_count":1200,"comment_count":45,"share_count":30,"create_time":1718000000}]}
   */
  async queryVideos(videoIds) {
    const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean)

    if (!ids.length) {
      throw new Error('At least one video id is required')
    }

    if (ids.length > 20) {
      throw new Error('A maximum of 20 video ids can be queried per request')
    }

    return this.#apiRequest({
      logTag: 'queryVideos',
      method: 'post',
      url: `${ API_BASE_URL }/video/query/`,
      query: { fields: VIDEO_FIELDS.join(',') },
      body: { filters: { video_ids: ids } },
    })
  }

  #clampMaxCount(maxCount) {
    const parsed = Number(maxCount)

    if (!parsed || Number.isNaN(parsed)) {
      return 20
    }

    return Math.min(Math.max(Math.trunc(parsed), 1), 20)
  }

  // ========================================= CONTENT POSTING ==========================================

  /**
   * @description Queries the connected creator's posting eligibility and defaults. TikTok guidelines REQUIRE calling this before every post: it returns the creator's avatar, username and nickname, the privacy levels their account is allowed to use (privacy_level_options), whether comment/duet/stitch are disabled for their account, and the maximum video duration they may post (max_video_post_duration_sec). Use the returned privacy_level_options to constrain the privacy level you pass to the post actions. Requires the video.publish scope.
   *
   * @route POST /query-creator-info
   * @operationName Query Creator Info
   * @category Content Posting
   *
   * @returns {Object}
   * @sampleResult {"creator_avatar_url":"https://p16.tiktokcdn.com/avatar.jpeg","creator_username":"janedoe","creator_nickname":"Jane Doe","privacy_level_options":["PUBLIC_TO_EVERYONE","MUTUAL_FOLLOW_FRIENDS","SELF_ONLY"],"comment_disabled":false,"duet_disabled":false,"stitch_disabled":false,"max_video_post_duration_sec":600}
   */
  async queryCreatorInfo() {
    return this.#apiRequest({
      logTag: 'queryCreatorInfo',
      method: 'post',
      url: `${ API_BASE_URL }/post/publish/creator_info/query/`,
      body: {},
    })
  }

  /**
   * @description Publishes a video to the connected user's TikTok account by pulling it from a public URL (PULL_FROM_URL). Returns a publish_id you can pass to "Get Post Status" to track processing. IMPORTANT: unaudited apps may only post with the "Private" privacy level; public visibility requires TikTok's app audit. Direct Post via PULL_FROM_URL also requires the source domain to be verified in the TikTok developer portal, or TikTok will reject the URL. Call "Query Creator Info" first to confirm the allowed privacy levels. Requires the video.publish scope.
   *
   * @route POST /post-video-from-url
   * @operationName Post Video from URL
   * @category Content Posting
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","required":true,"description":"Publicly accessible URL of the source video. The URL's domain must be verified in your TikTok developer portal or the request is rejected."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The video caption. Supports #hashtags and @mentions. Maximum 2200 characters."}
   * @paramDef {"type":"String","label":"Privacy Level","name":"privacyLevel","required":true,"defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Followers","Friends","Private"]}},"description":"Post visibility. 'Public' (PUBLIC_TO_EVERYONE), 'Followers' (FOLLOWER_OF_CREATOR), 'Friends' (MUTUAL_FOLLOW_FRIENDS), 'Private' (SELF_ONLY). Unaudited apps must use 'Private'."}
   * @paramDef {"type":"Boolean","label":"Disable Comment","name":"disableComment","uiComponent":{"type":"CHECKBOX"},"description":"Whether to disable comments on the post. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Duet","name":"disableDuet","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from creating duets with this video. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Stitch","name":"disableStitch","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from stitching this video. Default: false."}
   * @paramDef {"type":"Number","label":"Cover Timestamp (ms)","name":"coverTimestampMs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Frame position, in milliseconds, to use as the video cover image. Default: 0 (first frame)."}
   *
   * @returns {Object}
   * @sampleResult {"publish_id":"v_pub_url~v2.123456789012345678"}
   */
  async postVideoFromUrl(videoUrl, title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs) {
    if (!videoUrl) {
      throw new Error('"Video URL" is required')
    }

    const body = {
      post_info: this.#buildVideoPostInfo(title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs),
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    }

    return this.#apiRequest({
      logTag: 'postVideoFromUrl',
      method: 'post',
      url: `${ API_BASE_URL }/post/publish/video/init/`,
      body,
    })
  }

  /**
   * @description Publishes a video to the connected user's TikTok account by uploading a FlowRunner file (FILE_UPLOAD). The file is uploaded in a single chunk, so it must be 64 MB or smaller; for larger videos, host the file publicly and use "Post Video from URL" instead. Returns a publish_id you can pass to "Get Post Status" to track processing. IMPORTANT: unaudited apps may only post with the "Private" privacy level; public visibility requires TikTok's app audit. Call "Query Creator Info" first to confirm the allowed privacy levels. Requires the video.publish scope.
   *
   * @route POST /post-video-from-file
   * @operationName Post Video from File
   * @category Content Posting
   *
   * @paramDef {"type":"String","label":"Video File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to post. Must be an MP4 video of 64 MB or less."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The video caption. Supports #hashtags and @mentions. Maximum 2200 characters."}
   * @paramDef {"type":"String","label":"Privacy Level","name":"privacyLevel","required":true,"defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Followers","Friends","Private"]}},"description":"Post visibility. 'Public' (PUBLIC_TO_EVERYONE), 'Followers' (FOLLOWER_OF_CREATOR), 'Friends' (MUTUAL_FOLLOW_FRIENDS), 'Private' (SELF_ONLY). Unaudited apps must use 'Private'."}
   * @paramDef {"type":"Boolean","label":"Disable Comment","name":"disableComment","uiComponent":{"type":"CHECKBOX"},"description":"Whether to disable comments on the post. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Duet","name":"disableDuet","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from creating duets with this video. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Stitch","name":"disableStitch","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from stitching this video. Default: false."}
   * @paramDef {"type":"Number","label":"Cover Timestamp (ms)","name":"coverTimestampMs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Frame position, in milliseconds, to use as the video cover image. Default: 0 (first frame)."}
   *
   * @returns {Object}
   * @sampleResult {"publish_id":"v_inbox_file~v2.123456789012345678"}
   */
  async postVideoFromFile(fileUrl, title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs) {
    if (!fileUrl) {
      throw new Error('"Video File" is required')
    }

    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const videoSize = buffer.length

    if (videoSize > SINGLE_CHUNK_MAX_BYTES) {
      throw new Error(
        `Video is ${ videoSize } bytes; single-chunk upload allows at most ${ SINGLE_CHUNK_MAX_BYTES } bytes (64 MB). ` +
        'Host the video at a public URL and use "Post Video from URL" instead.'
      )
    }

    const initResponse = await this.#apiRequest({
      logTag: 'postVideoFromFile:init',
      method: 'post',
      url: `${ API_BASE_URL }/post/publish/video/init/`,
      body: {
        post_info: this.#buildVideoPostInfo(title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs),
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      },
    })

    const uploadUrl = initResponse?.upload_url

    if (!uploadUrl) {
      throw new Error('TikTok did not return an upload URL for the file upload')
    }

    try {
      await Flowrunner.Request.put(uploadUrl)
        .set({
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes 0-${ videoSize - 1 }/${ videoSize }`,
        })
        .send(buffer)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`postVideoFromFile:upload - failed: ${ message }`)

      throw new Error(`TikTok upload failed: ${ message }`)
    }

    return { publish_id: initResponse.publish_id }
  }

  /**
   * @description Publishes a photo carousel post to the connected user's TikTok account by pulling one or more images from public URLs (PULL_FROM_URL). Returns a publish_id you can pass to "Get Post Status" to track processing. IMPORTANT: unaudited apps may only post with the "Private" privacy level; public visibility requires TikTok's app audit, and the source image domains must be verified in your TikTok developer portal. Call "Query Creator Info" first to confirm the allowed privacy levels. Requires the video.publish scope.
   *
   * @route POST /post-photos
   * @operationName Post Photos
   * @category Content Posting
   *
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"Publicly accessible URLs of the photos to post, in display order. Domains must be verified in your TikTok developer portal."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The post title. Maximum 90 characters."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional post description/caption. Supports #hashtags and @mentions. Maximum 4000 characters."}
   * @paramDef {"type":"String","label":"Privacy Level","name":"privacyLevel","required":true,"defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Followers","Friends","Private"]}},"description":"Post visibility. 'Public' (PUBLIC_TO_EVERYONE), 'Followers' (FOLLOWER_OF_CREATOR), 'Friends' (MUTUAL_FOLLOW_FRIENDS), 'Private' (SELF_ONLY). Unaudited apps must use 'Private'."}
   * @paramDef {"type":"Number","label":"Cover Image Index","name":"coverIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the image to use as the carousel cover. Default: 0 (first image)."}
   * @paramDef {"type":"Boolean","label":"Disable Comment","name":"disableComment","uiComponent":{"type":"CHECKBOX"},"description":"Whether to disable comments on the post. Default: false."}
   * @paramDef {"type":"Boolean","label":"Auto Add Music","name":"autoAddMusic","uiComponent":{"type":"CHECKBOX"},"description":"Whether TikTok may automatically add background music to the photo post. Default: false."}
   *
   * @returns {Object}
   * @sampleResult {"publish_id":"p_pub_url~v2.123456789012345678"}
   */
  async postPhotos(imageUrls, title, description, privacyLevel, coverIndex, disableComment, autoAddMusic) {
    const urls = (Array.isArray(imageUrls) ? imageUrls : [imageUrls]).filter(Boolean)

    if (!urls.length) {
      throw new Error('At least one image URL is required')
    }

    if (!title) {
      throw new Error('"Title" is required')
    }

    const postInfo = {
      title,
      privacy_level: this.#resolveChoice(privacyLevel || 'Private', PRIVACY_LEVEL_OPTIONS),
      disable_comment: Boolean(disableComment),
    }

    if (description !== undefined && description !== null && description !== '') {
      postInfo.description = description
    }

    if (autoAddMusic !== undefined) {
      postInfo.auto_add_music = Boolean(autoAddMusic)
    }

    const body = {
      post_info: postInfo,
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: urls,
        photo_cover_index: coverIndex !== undefined && coverIndex !== null ? Number(coverIndex) : 0,
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }

    return this.#apiRequest({
      logTag: 'postPhotos',
      method: 'post',
      url: `${ API_BASE_URL }/post/publish/content/init/`,
      body,
    })
  }

  /**
   * @description Fetches the current processing status of a post previously created with "Post Video from URL", "Post Video from File" or "Post Photos", using its publish_id. Returns the status (PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE or FAILED), a fail_reason when applicable, and the public post id once the post is live. Requires the video.publish scope.
   *
   * @route POST /get-post-status
   * @operationName Get Post Status
   * @category Content Posting
   *
   * @paramDef {"type":"String","label":"Publish ID","name":"publishId","required":true,"description":"The publish_id returned by a post action."}
   *
   * @returns {Object}
   * @sampleResult {"status":"PUBLISH_COMPLETE","publicaly_available_post_id":["7112345678901234567"]}
   */
  async getPostStatus(publishId) {
    if (!publishId) {
      throw new Error('"Publish ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getPostStatus',
      method: 'post',
      url: `${ API_BASE_URL }/post/publish/status/fetch/`,
      body: { publish_id: publishId },
    })
  }

  /**
   * @description Publishes a video from a public URL and then polls its status until it completes or fails, returning the final status in one call. Initiates the post (PULL_FROM_URL) and checks status every 5 seconds for up to ~10 minutes. Returns the publish_id together with the terminal status and, when live, the public post id; throws if TikTok reports FAILED. IMPORTANT: unaudited apps may only post with the "Private" privacy level and the source domain must be verified in your TikTok developer portal. Call "Query Creator Info" first to confirm the allowed privacy levels. Requires the video.publish scope.
   *
   * @route POST /post-video-and-wait
   * @operationName Post Video and Wait
   * @category Content Posting
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","required":true,"description":"Publicly accessible URL of the source video. The URL's domain must be verified in your TikTok developer portal."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The video caption. Supports #hashtags and @mentions. Maximum 2200 characters."}
   * @paramDef {"type":"String","label":"Privacy Level","name":"privacyLevel","required":true,"defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Followers","Friends","Private"]}},"description":"Post visibility. 'Public' (PUBLIC_TO_EVERYONE), 'Followers' (FOLLOWER_OF_CREATOR), 'Friends' (MUTUAL_FOLLOW_FRIENDS), 'Private' (SELF_ONLY). Unaudited apps must use 'Private'."}
   * @paramDef {"type":"Boolean","label":"Disable Comment","name":"disableComment","uiComponent":{"type":"CHECKBOX"},"description":"Whether to disable comments on the post. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Duet","name":"disableDuet","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from creating duets with this video. Default: false."}
   * @paramDef {"type":"Boolean","label":"Disable Stitch","name":"disableStitch","uiComponent":{"type":"CHECKBOX"},"description":"Whether to prevent other users from stitching this video. Default: false."}
   * @paramDef {"type":"Number","label":"Cover Timestamp (ms)","name":"coverTimestampMs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Frame position, in milliseconds, to use as the video cover image. Default: 0 (first frame)."}
   *
   * @returns {Object}
   * @sampleResult {"publish_id":"v_pub_url~v2.123456789012345678","status":"PUBLISH_COMPLETE","publicaly_available_post_id":["7112345678901234567"]}
   */
  async postVideoAndWait(videoUrl, title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs) {
    const { publish_id: publishId } = await this.postVideoFromUrl(
      videoUrl, title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs
    )

    if (!publishId) {
      throw new Error('TikTok did not return a publish id')
    }

    // Poll every 5 seconds; cap iterations so the action stays within the 600s timeout budget.
    const maxAttempts = 115

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.#sleep(5000)

      const statusResult = await this.getPostStatus(publishId)

      logger.debug(`postVideoAndWait - attempt ${ attempt + 1 }: status=${ statusResult.status }`)

      if (statusResult.status === STATUS_COMPLETE) {
        return { publish_id: publishId, ...statusResult }
      }

      if (statusResult.status === STATUS_FAILED) {
        throw new Error(`TikTok post failed: ${ statusResult.fail_reason || 'unknown reason' }`)
      }
    }

    throw new Error('Timed out waiting for the TikTok post to finish processing')
  }

  // Builds the shared post_info object for the video Direct Post endpoints.
  #buildVideoPostInfo(title, privacyLevel, disableComment, disableDuet, disableStitch, coverTimestampMs) {
    const postInfo = {
      privacy_level: this.#resolveChoice(privacyLevel || 'Private', PRIVACY_LEVEL_OPTIONS),
      disable_comment: Boolean(disableComment),
      disable_duet: Boolean(disableDuet),
      disable_stitch: Boolean(disableStitch),
    }

    if (title !== undefined && title !== null && title !== '') {
      postInfo.title = title
    }

    if (coverTimestampMs !== undefined && coverTimestampMs !== null && coverTimestampMs !== '') {
      postInfo.video_cover_timestamp_ms = Number(coverTimestampMs)
    }

    return postInfo
  }
}

Flowrunner.ServerCode.addService(TikTokService, [
  {
    displayName: 'Client Key',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Key of your TikTok app from https://developers.tiktok.com/apps (labeled "Client key" in the portal).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your TikTok app from https://developers.tiktok.com/apps.',
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
