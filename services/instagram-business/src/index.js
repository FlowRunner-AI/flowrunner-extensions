const logger = {
  info: (...args) => console.log('[Instagram for Business] info:', ...args),
  debug: (...args) => console.log('[Instagram for Business] debug:', ...args),
  error: (...args) => console.log('[Instagram for Business] error:', ...args),
  warn: (...args) => console.log('[Instagram for Business] warn:', ...args),
}

const API_VERSION = 'v25.0'
const API_BASE_WWW_URL = `https://www.facebook.com/${ API_VERSION }`
const API_BASE_GRAPH_URL = `https://graph.facebook.com/${ API_VERSION }`
const OAUTH_BASE_URL = `${ API_BASE_WWW_URL }/dialog/oauth`

// Instagram Graph API scopes. instagram_content_publish requires Meta App Review
// Advanced Access for public use; Development mode works for connected test accounts.
const DEFAULT_SCOPE_LIST = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'pages_show_list',
  'business_management',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 25

// How long (ms) to wait between container-status polls, and the ceiling on total attempts.
const POLL_INTERVAL_MS = 5000
const POLL_MAX_ATTEMPTS = 110

// Media insight metrics that must be requested with metric_type=total_value (Instagram's
// newer interaction metrics). Time-series metrics (follower_count, profile_views, reach)
// are returned without it.
const TOTAL_VALUE_ACCOUNT_METRICS = new Set([
  'reach',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
])

// Remove undefined/null/'' entries so they are not sent to the Graph API.
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
 *  @requireOAuth
 *  @integrationName Instagram for Business
 *  @integrationIcon /icon.svg
 **/
class InstagramBusinessService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING

    // Per-invocation cache of the resolved default IG user id (keyed by "default").
    this._igUserIdCache = null
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  // Maps a friendly dropdown label to its Graph API value. Unmapped values pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Maps each item of a friendly multi-select to its Graph API value.
  #resolveChoiceList(values, mapping) {
    if (!Array.isArray(values) || values.length === 0) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping)).filter(Boolean)
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'GET'

    const cleanedQuery = query ? clean(query) : query

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(cleanedQuery) }]`)

      const headers = {
        Authorization: `Bearer ${ this.#getAccessToken() }`,
        'Content-Type': 'application/json',
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(JSON.stringify(clean(body))) : await request
    } catch (error) {
      const fbError = error.body?.error
      const message = fbError?.message || error.message

      logger.error(`${ logTag } - failed: ${ message } (trace: ${ fbError?.fbtrace_id || 'n/a' })`)

      const parts = [`Instagram API error: ${ message }`]

      if (fbError?.type) {
        parts.push(`type=${ fbError.type }`)
      }

      if (fbError?.code !== undefined) {
        parts.push(`code=${ fbError.code }`)
      }

      if (fbError?.error_subcode !== undefined) {
        parts.push(`subcode=${ fbError.error_subcode }`)
      }

      if (fbError?.fbtrace_id) {
        parts.push(`fbtrace_id=${ fbError.fbtrace_id }`)
      }

      throw new Error(parts.join(' | '))
    }
  }

  // Fetches the Facebook Pages the user manages that have a linked IG Business/Creator account.
  async #listConnectedIgAccounts() {
    const response = await this.#apiRequest({
      logTag: '[listConnectedIgAccounts]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      query: {
        fields: 'name,instagram_business_account{id,username,profile_picture_url}',
        limit: 100,
      },
    })

    return (response.data || []).filter(page => page.instagram_business_account?.id)
  }

  // Resolves the IG user id to operate on. When igUserId is provided it is used verbatim.
  // When empty, the first linked IG Business account across the user's Pages is resolved
  // once and cached for the remainder of the invocation.
  async #getIgUserId(igUserId) {
    if (igUserId) {
      return igUserId
    }

    if (this._igUserIdCache) {
      return this._igUserIdCache
    }

    const pages = await this.#listConnectedIgAccounts()
    const first = pages[0]?.instagram_business_account?.id

    if (!first) {
      throw new Error('Instagram API error: no Instagram Business/Creator account is linked to any of your Facebook Pages. Connect one in the Facebook Page settings and try again.')
    }

    this._igUserIdCache = first

    return first
  }

  // Two-step publish helper: publish an already-FINISHED container by creation id.
  async #publishContainer(igId, creationId) {
    return this.#apiRequest({
      logTag: '[publishContainer]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media_publish`,
      method: 'POST',
      body: { creation_id: creationId },
    })
  }

  // Polls a container's status_code until FINISHED (returns) or ERROR/EXPIRED (throws),
  // or until the attempt ceiling is reached (throws). Used for video/reel/story processing.
  async #pollContainerUntilReady(creationId) {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const status = await this.#apiRequest({
        logTag: '[pollContainer]',
        url: `${ API_BASE_GRAPH_URL }/${ creationId }`,
        query: { fields: 'status_code,status' },
      })

      const code = status.status_code

      if (code === 'FINISHED') {
        return status
      }

      if (code === 'ERROR' || code === 'EXPIRED') {
        throw new Error(`Instagram API error: media container ${ creationId } processing ${ code === 'ERROR' ? 'failed' : 'expired' } (${ status.status || code }).`)
      }

      await sleep(POLL_INTERVAL_MS)
    }

    throw new Error(`Instagram API error: media container ${ creationId } did not finish processing within the allotted time. Retry later or check the source media.`)
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const connectionURL = `${ OAUTH_BASE_URL }/?${ params.toString() }`
    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   * @property {String} connectionIdentityImageURL
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug(`Execute Callback: ${ JSON.stringify(callbackObject) }`)

    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      const { access_token, refresh_token, expires_in } = response

      const profile = await Flowrunner.Request
        .get(`${ API_BASE_GRAPH_URL }/me?fields=id,name`)
        .set({ Authorization: `Bearer ${ access_token }` })
        .send()

      return {
        token: access_token,
        refreshToken: refresh_token,
        overwrite: true,
        expirationInSeconds: expires_in,
        connectionIdentityName: profile.name || 'Instagram User',
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error.message || error }`)

      throw error
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    try {
      const { access_token, refresh_token, expires_in } = await Flowrunner.Request
        .post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return { token: access_token, refreshToken: refresh_token, expirationInSeconds: expires_in }
    } catch (error) {
      logger.error(`Error refreshing token: ${ error.message || error }`)

      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  /**
   * @operationName Publish Photo
   * @category Publishing
   * @description Publishes a single photo to the Instagram feed. Uses the Graph API two-step flow: an image container is created via POST /{ig-user-id}/media and, because image containers are ready immediately, published right away via POST /{ig-user-id}/media_publish. The Image URL must point to a publicly reachable JPEG on a server that allows Instagram to fetch it. Supports a caption (with hashtags/mentions), an optional location tag, and raw user tags. Requires the instagram_content_publish permission (Advanced Access for public accounts). Counts against the 50 API posts / 24h publishing limit.
   * @route POST /publish-photo
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly accessible JPEG URL for Instagram to fetch. Must not require authentication."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption. Supports hashtags (#tag) and @mentions. Up to 2,200 characters."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"Optional Facebook Page id of a location to tag on the post."}
   * @paramDef {"type":"Array<Object>","label":"User Tags","name":"userTags","description":"Optional raw user tags, each an object like {\"username\":\"someone\",\"x\":0.5,\"y\":0.5}. Passed through to the Graph API user_tags parameter."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id to publish from. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"id":"17895695668004550"}
   */
  async publishPhoto(imageUrl, caption, locationId, userTags, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    const container = await this.#apiRequest({
      logTag: '[publishPhoto]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      method: 'POST',
      body: {
        image_url: imageUrl,
        caption,
        location_id: locationId,
        user_tags: userTags,
      },
    })

    return this.#publishContainer(igId, container.id)
  }

  /**
   * @operationName Publish Reel
   * @category Publishing
   * @description Publishes a Reel (short-form video) to Instagram. Creates a REELS container via POST /{ig-user-id}/media with the Video URL, then polls GET /{creation-id}?fields=status_code every five seconds until the video finishes transcoding (status FINISHED) before publishing via POST /{ig-user-id}/media_publish. Surfaces ERROR/EXPIRED processing failures with the reported reason. The Video URL must be a publicly reachable MP4/MOV meeting Instagram's Reels specs. Optionally set a cover image or thumbnail offset and choose whether the Reel also appears in the main feed. Requires instagram_content_publish. Counts against the 50 API posts / 24h publishing limit.
   * @route POST /publish-reel
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @executionTimeoutInSeconds 600
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","required":true,"description":"Publicly accessible MP4/MOV URL meeting Instagram Reels specs (max ~1GB, up to 15 minutes)."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption. Supports hashtags and @mentions. Up to 2,200 characters."}
   * @paramDef {"type":"String","label":"Cover URL","name":"coverUrl","description":"Optional publicly accessible image URL to use as the Reel cover/thumbnail."}
   * @paramDef {"type":"Number","label":"Thumbnail Offset","name":"thumbOffset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional offset in milliseconds into the video to capture the thumbnail frame. Ignored when Cover URL is set."}
   * @paramDef {"type":"Boolean","label":"Share To Feed","name":"shareToFeed","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether the Reel also appears in the main feed grid (default true)."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id to publish from. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"id":"17895695668004551"}
   */
  async publishReel(videoUrl, caption, coverUrl, thumbOffset, shareToFeed, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    const container = await this.#apiRequest({
      logTag: '[publishReel]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      method: 'POST',
      body: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        cover_url: coverUrl,
        thumb_offset: thumbOffset,
        share_to_feed: shareToFeed,
      },
    })

    await this.#pollContainerUntilReady(container.id)

    return this.#publishContainer(igId, container.id)
  }

  /**
   * @operationName Publish Story
   * @category Publishing
   * @description Publishes a Story (24-hour ephemeral post) to Instagram from either an image or a video. Creates a STORIES container via POST /{ig-user-id}/media; image Stories publish immediately while video Stories are polled until processing finishes. Provide exactly one of Image URL or Video URL (both publicly reachable). Requires instagram_content_publish. Counts against the 50 API posts / 24h publishing limit.
   * @route POST /publish-story
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @executionTimeoutInSeconds 600
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Publicly accessible JPEG URL for an image Story. Provide this OR Video URL."}
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","description":"Publicly accessible MP4/MOV URL for a video Story. Provide this OR Image URL."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id to publish from. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"id":"17895695668004552"}
   */
  async publishStory(imageUrl, videoUrl, igUserId) {
    if (!imageUrl && !videoUrl) {
      throw new Error('Instagram API error: provide either an Image URL or a Video URL for the Story.')
    }

    const igId = await this.#getIgUserId(igUserId)

    const container = await this.#apiRequest({
      logTag: '[publishStory]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      method: 'POST',
      body: {
        media_type: 'STORIES',
        image_url: imageUrl,
        video_url: videoUrl,
      },
    })

    // Video stories require processing; image stories are ready immediately.
    if (videoUrl) {
      await this.#pollContainerUntilReady(container.id)
    }

    return this.#publishContainer(igId, container.id)
  }

  /**
   * @typedef {Object} CarouselItem
   * @property {String} image_url Publicly accessible image URL for a photo child. Provide this or video_url.
   * @property {String} video_url Publicly accessible video URL for a video child. Provide this or image_url.
   */

  /**
   * @operationName Publish Carousel
   * @category Publishing
   * @description Publishes a multi-item carousel (2-10 photos and/or videos) to the Instagram feed. Creates a child container for each item with is_carousel_item true, polls any video children until processing finishes, then creates the parent CAROUSEL container referencing the child ids and publishes it. Each item supplies exactly one of image_url or video_url (both publicly reachable). Requires instagram_content_publish. A carousel counts as a single post against the 50 API posts / 24h publishing limit.
   * @route POST /publish-carousel
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @executionTimeoutInSeconds 600
   * @paramDef {"type":"Array<CarouselItem>","label":"Items","name":"items","required":true,"description":"Between 2 and 10 carousel items, each an object with image_url OR video_url."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption for the carousel. Supports hashtags and @mentions."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id to publish from. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"id":"17895695668004553"}
   */
  async publishCarousel(items, caption, igUserId) {
    if (!Array.isArray(items) || items.length < 2 || items.length > 10) {
      throw new Error('Instagram API error: a carousel requires between 2 and 10 items.')
    }

    const igId = await this.#getIgUserId(igUserId)

    const childIds = []

    for (const item of items) {
      const isVideo = Boolean(item.video_url)

      const child = await this.#apiRequest({
        logTag: '[publishCarousel:child]',
        url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
        method: 'POST',
        body: {
          is_carousel_item: true,
          image_url: item.image_url,
          video_url: item.video_url,
          media_type: isVideo ? 'VIDEO' : undefined,
        },
      })

      if (isVideo) {
        await this.#pollContainerUntilReady(child.id)
      }

      childIds.push(child.id)
    }

    const parent = await this.#apiRequest({
      logTag: '[publishCarousel:parent]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      method: 'POST',
      body: {
        media_type: 'CAROUSEL',
        children: childIds,
        caption,
      },
    })

    // The parent container may itself need a brief moment to finalize.
    await this.#pollContainerUntilReady(parent.id)

    return this.#publishContainer(igId, parent.id)
  }

  /**
   * @operationName Get Container Status
   * @category Publishing
   * @description Retrieves the processing status of a media container created during publishing, via GET /{creation-id}?fields=status_code,status. Use this to inspect a container between the create and publish steps. status_code is one of IN_PROGRESS, FINISHED, ERROR, EXPIRED, or PUBLISHED; status provides a human-readable detail message.
   * @route GET /get-container-status
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @paramDef {"type":"String","label":"Container ID","name":"creationId","required":true,"description":"The media container id (creation_id) returned when the container was created."}
   * @returns {Object}
   * @sampleResult {"status_code":"FINISHED","status":"Finished: The container is ready to publish.","id":"17895695668004550"}
   */
  async getContainerStatus(creationId) {
    return this.#apiRequest({
      logTag: '[getContainerStatus]',
      url: `${ API_BASE_GRAPH_URL }/${ creationId }`,
      query: { fields: 'status_code,status' },
    })
  }

  /**
   * @operationName Get Publishing Limit
   * @category Publishing
   * @description Reports how many posts the account has published through the API within the rolling 24-hour window, via GET /{ig-user-id}/content_publishing_limit. Instagram permits up to 50 API-published posts per 24 hours (carousels count as one). Returns config (the configured quota) and quota_usage (posts used so far). Check this before bulk publishing to avoid rate-limit errors.
   * @route GET /get-publishing-limit
   * @requiredOauth2Scopes instagram_content_publish,instagram_basic
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"data":[{"config":{"quota_total":50,"quota_duration":86400},"quota_usage":7}]}
   */
  async getPublishingLimit(igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[getPublishingLimit]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/content_publishing_limit`,
      query: { fields: 'config,quota_usage' },
    })
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Media
   * @category Media
   * @description Lists media (posts, reels, carousels) published on the Instagram account, newest first, via GET /{ig-user-id}/media. Each item includes id, caption, media_type, media_url, thumbnail_url (for videos), permalink, timestamp, and engagement counts (like_count, comments_count). Supports paging via limit and an after cursor.
   * @route GET /list-media
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of media items to return per call (default 25, max 100)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17895695668004550","caption":"Sunset over the bay","media_type":"IMAGE","media_url":"https://scontent.cdninstagram.com/v/photo.jpg","permalink":"https://www.instagram.com/p/ABC123/","timestamp":"2026-07-01T12:00:00+0000","like_count":128,"comments_count":14}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listMedia(limit, after, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[listMedia]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      query: {
        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Media
   * @category Media
   * @description Retrieves a single media object by id via GET /{ig-media-id}. Returns id, caption, media_type, media_product_type, media_url, thumbnail_url, permalink, timestamp, username, like_count, comments_count, and — for carousels — the child media (children{media_url,media_type}). Pass a custom comma-separated Fields value to override the defaults.
   * @route GET /get-media
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"dictionary":"getRecentMediaDictionary","description":"The IG media id to retrieve. Pick a recent post or paste a media id."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated field list. Defaults to a common set including children{media_url,media_type}."}
   * @returns {Object}
   * @sampleResult {"id":"17895695668004550","caption":"Sunset over the bay","media_type":"IMAGE","media_product_type":"FEED","media_url":"https://scontent.cdninstagram.com/v/photo.jpg","permalink":"https://www.instagram.com/p/ABC123/","timestamp":"2026-07-01T12:00:00+0000","username":"acme","like_count":128,"comments_count":14}
   */
  async getMedia(mediaId, fields) {
    return this.#apiRequest({
      logTag: '[getMedia]',
      url: `${ API_BASE_GRAPH_URL }/${ mediaId }`,
      query: {
        fields: fields || 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count,children{media_url,media_type,thumbnail_url}',
      },
    })
  }

  /**
   * @operationName Get Media Children
   * @category Media
   * @description Lists the child media of a carousel album via GET /{ig-media-id}/children. Each child includes id, media_type, media_url, thumbnail_url, and permalink. Only carousel (album) media have children; calling this on a single photo/video returns an empty list.
   * @route GET /get-media-children
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"dictionary":"getRecentMediaDictionary","description":"The carousel media id whose child items to list."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17895695668004560","media_type":"IMAGE","media_url":"https://scontent.cdninstagram.com/v/child1.jpg","permalink":"https://www.instagram.com/p/ABC123/"}]}
   */
  async getMediaChildren(mediaId) {
    return this.#apiRequest({
      logTag: '[getMediaChildren]',
      url: `${ API_BASE_GRAPH_URL }/${ mediaId }/children`,
      query: { fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp' },
    })
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Comments
   * @category Comments
   * @description Lists top-level comments on a media object via GET /{ig-media-id}/comments, including each comment's id, text, username, timestamp, like_count, and nested replies{id,text,username}. Supports paging via limit and an after cursor. Requires instagram_manage_comments.
   * @route GET /list-comments
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"dictionary":"getRecentMediaDictionary","description":"The IG media id whose comments to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17900000000000001","text":"Love this!","username":"jane_doe","timestamp":"2026-07-01T12:05:00+0000","like_count":3,"replies":{"data":[{"id":"17900000000000002","text":"Thank you!","username":"acme"}]}}],"paging":{"cursors":{"before":"MA","after":"MQ"}}}
   */
  async listComments(mediaId, limit, after) {
    return this.#apiRequest({
      logTag: '[listComments]',
      url: `${ API_BASE_GRAPH_URL }/${ mediaId }/comments`,
      query: {
        fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Retrieves a single comment by id via GET /{ig-comment-id}. Returns id, text, username, timestamp, like_count, hidden, and nested replies{id,text,username}. Requires instagram_manage_comments.
   * @route GET /get-comment
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The IG comment id to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"17900000000000001","text":"Love this!","username":"jane_doe","timestamp":"2026-07-01T12:05:00+0000","like_count":3,"hidden":false}
   */
  async getComment(commentId) {
    return this.#apiRequest({
      logTag: '[getComment]',
      url: `${ API_BASE_GRAPH_URL }/${ commentId }`,
      query: { fields: 'id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}' },
    })
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Posts a top-level comment on a media object via POST /{ig-media-id}/comments. Returns the new comment id. Requires instagram_manage_comments. Comments can only be added to media on accounts you manage.
   * @route POST /create-comment
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"dictionary":"getRecentMediaDictionary","description":"The IG media id to comment on."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the comment."}
   * @returns {Object}
   * @sampleResult {"id":"17900000000000003"}
   */
  async createComment(mediaId, message) {
    return this.#apiRequest({
      logTag: '[createComment]',
      url: `${ API_BASE_GRAPH_URL }/${ mediaId }/comments`,
      method: 'POST',
      body: { message },
    })
  }

  /**
   * @operationName Reply to Comment
   * @category Comments
   * @description Posts a reply to an existing comment via POST /{ig-comment-id}/replies, creating a threaded response. Returns the new reply's comment id. Requires instagram_manage_comments.
   * @route POST /reply-to-comment
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The IG comment id to reply to."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the reply."}
   * @returns {Object}
   * @sampleResult {"id":"17900000000000004"}
   */
  async replyToComment(commentId, message) {
    return this.#apiRequest({
      logTag: '[replyToComment]',
      url: `${ API_BASE_GRAPH_URL }/${ commentId }/replies`,
      method: 'POST',
      body: { message },
    })
  }

  /**
   * @operationName Hide or Unhide Comment
   * @category Comments
   * @description Hides or unhides a comment via POST /{ig-comment-id} with the hide flag. Hidden comments remain but are not shown publicly under the media. Set Hide to true to hide, or false to unhide. Requires instagram_manage_comments.
   * @route POST /hide-comment
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The IG comment id to hide or unhide."}
   * @paramDef {"type":"Boolean","label":"Hide","name":"hide","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Set true to hide the comment, false to unhide it."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async hideComment(commentId, hide) {
    return this.#apiRequest({
      logTag: '[hideComment]',
      url: `${ API_BASE_GRAPH_URL }/${ commentId }`,
      method: 'POST',
      body: { hide: Boolean(hide) },
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a comment via DELETE /{ig-comment-id}. This cannot be undone. You can only delete comments on media of accounts you manage. Requires instagram_manage_comments.
   * @route DELETE /delete-comment
   * @requiredOauth2Scopes instagram_manage_comments,instagram_basic
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The IG comment id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteComment(commentId) {
    return this.#apiRequest({
      logTag: '[deleteComment]',
      url: `${ API_BASE_GRAPH_URL }/${ commentId }`,
      method: 'DELETE',
    })
  }

  // ---------------------------------------------------------------------------
  // Insights
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Account Insights
   * @category Insights
   * @description Retrieves account-level insights via GET /{ig-user-id}/insights. Choose one or more metrics; interaction metrics (Reach, Accounts Engaged, Total Interactions, Likes, Comments, Shares, Saves) are automatically requested with metric_type=total_value as Instagram requires, while time-series metrics (Follower Count, Profile Views) return per-period values. Pick a period (Day, Week, or 28 Days) and optionally bound the range with Since/Until (Unix epoch seconds or ISO 8601). Requires instagram_manage_insights. Some metrics require the account to have at least 100 followers.
   * @route GET /get-account-insights
   * @requiredOauth2Scopes instagram_manage_insights,instagram_basic
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Reach","Follower Count","Profile Views","Accounts Engaged","Total Interactions","Likes","Comments","Shares","Saves"]}},"description":"One or more account metrics to retrieve."}
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","28 Days"]}},"defaultValue":"Day","description":"Aggregation period for each metric datapoint."}
   * @paramDef {"type":"String","label":"Since","name":"since","description":"Optional start of range as Unix epoch seconds or ISO 8601 date."}
   * @paramDef {"type":"String","label":"Until","name":"until","description":"Optional end of range as Unix epoch seconds or ISO 8601 date."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"data":[{"name":"reach","period":"day","title":"Reach","description":"The number of unique accounts that saw your content","total_value":{"value":5230},"id":"17841400000000000/insights/reach/day"}]}
   */
  async getAccountInsights(metrics, period, since, until, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    const metricList = this.#resolveChoiceList(metrics, {
      'Reach': 'reach',
      'Follower Count': 'follower_count',
      'Profile Views': 'profile_views',
      'Accounts Engaged': 'accounts_engaged',
      'Total Interactions': 'total_interactions',
      'Likes': 'likes',
      'Comments': 'comments',
      'Shares': 'shares',
      'Saves': 'saves',
    }) || []

    // Instagram only accepts metric_type=total_value when every requested metric is a
    // total_value metric; mixing with time-series metrics is rejected, so only send it
    // when the whole selection is total_value-style.
    const allTotalValue = metricList.length > 0 && metricList.every(metric => TOTAL_VALUE_ACCOUNT_METRICS.has(metric))

    return this.#apiRequest({
      logTag: '[getAccountInsights]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/insights`,
      query: {
        metric: metricList.join(','),
        period: this.#resolveChoice(period, {
          'Day': 'day',
          'Week': 'week',
          '28 Days': 'days_28',
        }),
        metric_type: allTotalValue ? 'total_value' : undefined,
        since,
        until,
      },
    })
  }

  /**
   * @operationName Get Media Insights
   * @category Insights
   * @description Retrieves per-media insights via GET /{ig-media-id}/insights. Choose one or more metrics from Reach, Likes, Comments, Saved, Shares, Views, and Total Interactions. Metric availability varies by media type (feed image, video/reel, carousel, story), so requesting a metric unsupported for the given media returns an error — start with Reach and Total Interactions, which are widely supported. Requires instagram_manage_insights.
   * @route GET /get-media-insights
   * @requiredOauth2Scopes instagram_manage_insights,instagram_basic
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"dictionary":"getRecentMediaDictionary","description":"The IG media id to read insights for."}
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Reach","Likes","Comments","Saved","Shares","Views","Total Interactions"]}},"description":"One or more media metrics to retrieve. Availability depends on the media type."}
   * @returns {Object}
   * @sampleResult {"data":[{"name":"reach","period":"lifetime","title":"Reach","description":"Accounts reached","values":[{"value":4820}],"id":"17895695668004550/insights/reach/lifetime"}]}
   */
  async getMediaInsights(mediaId, metrics) {
    const metricList = this.#resolveChoiceList(metrics, {
      'Reach': 'reach',
      'Likes': 'likes',
      'Comments': 'comments',
      'Saved': 'saved',
      'Shares': 'shares',
      'Views': 'views',
      'Total Interactions': 'total_interactions',
    }) || []

    return this.#apiRequest({
      logTag: '[getMediaInsights]',
      url: `${ API_BASE_GRAPH_URL }/${ mediaId }/insights`,
      query: { metric: metricList.join(',') },
    })
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Account Info
   * @category Account
   * @description Retrieves profile details for an Instagram Business/Creator account via GET /{ig-user-id}. Returns id, username, name, biography, website, followers_count, follows_count, media_count, and profile_picture_url. Requires instagram_basic.
   * @route GET /get-account-info
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"id":"17841400000000000","username":"acme","name":"Acme Store","biography":"Quality goods since 1998","website":"https://acme.example.com","followers_count":10432,"follows_count":312,"media_count":845,"profile_picture_url":"https://scontent.cdninstagram.com/v/pfp.jpg"}
   */
  async getAccountInfo(igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[getAccountInfo]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }`,
      query: { fields: 'id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url' },
    })
  }

  /**
   * @operationName List Connected IG Accounts
   * @category Account
   * @description Lists the Instagram Business/Creator accounts reachable through your Facebook Pages, via GET /me/accounts?fields=name,instagram_business_account. Only Pages with a linked Instagram account are returned. Each entry pairs the Facebook Page name with the linked Instagram account id and username — use those ids as the Instagram Account ID on other actions. Requires pages_show_list and instagram_basic.
   * @route GET /list-connected-accounts
   * @requiredOauth2Scopes pages_show_list,instagram_basic
   * @returns {Object}
   * @sampleResult {"accounts":[{"page_id":"1122334455","page_name":"Acme Store","ig_user_id":"17841400000000000","username":"acme","profile_picture_url":"https://scontent.cdninstagram.com/v/pfp.jpg"}]}
   */
  async listConnectedAccounts() {
    const pages = await this.#listConnectedIgAccounts()

    return {
      accounts: pages.map(page => ({
        page_id: page.id,
        page_name: page.name,
        ig_user_id: page.instagram_business_account.id,
        username: page.instagram_business_account.username,
        profile_picture_url: page.instagram_business_account.profile_picture_url,
      })),
    }
  }

  /**
   * @operationName Get Tagged Media
   * @category Account
   * @description Lists media in which the Instagram account has been tagged, via GET /{ig-user-id}/tags. Each item includes id, caption, media_type, and permalink. Supports paging via limit and an after cursor. Requires instagram_basic.
   * @route GET /get-tagged-media
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tagged media to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id. Leave empty to use the first Instagram account linked to your Pages."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17895695668004599","caption":"Great products from @acme","media_type":"IMAGE","permalink":"https://www.instagram.com/p/XYZ789/"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async getTaggedMedia(limit, after, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[getTaggedMedia]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/tags`,
      query: {
        fields: 'id,caption,media_type,media_url,permalink,timestamp,username',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Hashtags
  // ---------------------------------------------------------------------------

  /**
   * @operationName Search Hashtag
   * @category Hashtags
   * @description Resolves a hashtag name to its hashtag id via GET /ig_hashtag_search?user_id={ig-user-id}&q={tag}. The returned id is required by Get Hashtag Top Media and Get Hashtag Recent Media. Do not include the leading '#'. Instagram limits hashtag queries to 30 unique hashtags per 7-day rolling window per account. Requires instagram_basic.
   * @route GET /search-hashtag
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Hashtag","name":"tag","required":true,"description":"The hashtag text to look up, without the leading '#' (e.g. 'travel')."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG Business/Creator account id making the query (counts against the 30-hashtag weekly limit). Leave empty to use the first linked account."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17843826142012701"}]}
   */
  async searchHashtag(tag, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[searchHashtag]',
      url: `${ API_BASE_GRAPH_URL }/ig_hashtag_search`,
      query: { user_id: igId, q: tag },
    })
  }

  /**
   * @operationName Get Hashtag Top Media
   * @category Hashtags
   * @description Lists the most popular public media for a hashtag via GET /{ig-hashtag-id}/top_media?user_id={ig-user-id}. Each item includes id, caption, media_type, permalink, and like_count. Obtain the hashtag id from Search Hashtag first. Counts against the 30-hashtag / 7-day query limit. Requires instagram_basic.
   * @route GET /get-hashtag-top-media
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Hashtag ID","name":"hashtagId","required":true,"description":"The hashtag id returned by Search Hashtag."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of media to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG account id making the query. Leave empty to use the first linked account."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17895695668004700","caption":"Best trip ever #travel","media_type":"IMAGE","permalink":"https://www.instagram.com/p/TOP123/","like_count":9821}],"paging":{"cursors":{"after":"MjQ"}}}
   */
  async getHashtagTopMedia(hashtagId, limit, after, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[getHashtagTopMedia]',
      url: `${ API_BASE_GRAPH_URL }/${ hashtagId }/top_media`,
      query: {
        user_id: igId,
        fields: 'id,caption,media_type,permalink,like_count,comments_count,timestamp',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Hashtag Recent Media
   * @category Hashtags
   * @description Lists the most recently published public media for a hashtag via GET /{ig-hashtag-id}/recent_media?user_id={ig-user-id}. Each item includes id, caption, media_type, permalink, and like_count. Obtain the hashtag id from Search Hashtag first. Counts against the 30-hashtag / 7-day query limit. Requires instagram_basic.
   * @route GET /get-hashtag-recent-media
   * @requiredOauth2Scopes instagram_basic
   * @paramDef {"type":"String","label":"Hashtag ID","name":"hashtagId","required":true,"description":"The hashtag id returned by Search Hashtag."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of media to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","dictionary":"getConnectedAccountsDictionary","description":"Optional IG account id making the query. Leave empty to use the first linked account."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"17895695668004701","caption":"Just landed #travel","media_type":"IMAGE","permalink":"https://www.instagram.com/p/RECENT1/","like_count":142}],"paging":{"cursors":{"after":"MjQ"}}}
   */
  async getHashtagRecentMedia(hashtagId, limit, after, igUserId) {
    const igId = await this.#getIgUserId(igUserId)

    return this.#apiRequest({
      logTag: '[getHashtagRecentMedia]',
      url: `${ API_BASE_GRAPH_URL }/${ hashtagId }/recent_media`,
      query: {
        user_id: igId,
        fields: 'id,caption,media_type,permalink,like_count,comments_count,timestamp',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getConnectedAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter connected accounts by Page name or IG username."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Connected accounts are returned in a single page, so this is generally unused."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Connected Accounts Dictionary
   * @description Lists Instagram Business/Creator accounts linked to your Facebook Pages for selecting an Instagram Account ID on other actions. The option value is the IG user id and the label is the Facebook Page name.
   * @route POST /get-connected-accounts-dictionary
   * @paramDef {"type":"getConnectedAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing connected Instagram accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Store","value":"17841400000000000","note":"@acme"}]}
   */
  async getConnectedAccountsDictionary(payload) {
    const { search } = payload || {}

    const pages = await this.#listConnectedIgAccounts()
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? pages.filter(page => {
        const name = (page.name || '').toLowerCase()
        const username = (page.instagram_business_account.username || '').toLowerCase()

        return name.includes(term) || username.includes(term)
      })
      : pages

    return {
      items: filtered.map(page => ({
        label: page.name || page.instagram_business_account.username || page.instagram_business_account.id,
        value: page.instagram_business_account.id,
        note: page.instagram_business_account.username ? `@${ page.instagram_business_account.username }` : undefined,
      })),
    }
  }

  /**
   * @typedef {Object} getRecentMediaDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Instagram Account ID","name":"igUserId","description":"Optional IG Business/Creator account id to list media from. Leave empty to use the first linked account."}
   */

  /**
   * @typedef {Object} getRecentMediaDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter recent media by caption."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of media."}
   * @paramDef {"type":"getRecentMediaDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent input; supply igUserId to scope media to a specific account."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Recent Media Dictionary
   * @description Lists recent media on an Instagram account for selecting a Media ID on other actions. The option value is the media id; the label is the caption (or media type and timestamp when there is no caption). Optionally scoped to a specific account via the igUserId criteria.
   * @route POST /get-recent-media-dictionary
   * @paramDef {"type":"getRecentMediaDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and optional igUserId criteria for listing recent media."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sunset over the bay","value":"17895695668004550","note":"IMAGE"}],"cursor":"MjQ"}
   */
  async getRecentMediaDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const igId = await this.#getIgUserId(criteria?.igUserId)

    const response = await this.#apiRequest({
      logTag: '[getRecentMediaDictionary]',
      url: `${ API_BASE_GRAPH_URL }/${ igId }/media`,
      query: {
        fields: 'id,caption,media_type,timestamp',
        limit: 50,
        after: cursor,
      },
    })

    const media = response.data || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term ? media.filter(item => (item.caption || '').toLowerCase().includes(term)) : media

    return {
      items: filtered.map(item => ({
        label: (item.caption || '').trim() || `${ item.media_type || 'MEDIA' } · ${ (item.timestamp || '').slice(0, 10) }`,
        value: item.id,
        note: item.media_type || undefined,
      })),
      cursor: response.paging?.cursors?.after,
    }
  }
}

Flowrunner.ServerCode.addService(InstagramBusinessService, [
  {
    name: 'clientId',
    displayName: 'App Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App ID from your Meta app (App Dashboard > Settings > Basic). The app must have the Instagram Graph API product added.',
  },
  {
    name: 'clientSecret',
    displayName: 'App Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App Secret from your Meta app (App Dashboard > Settings > Basic).',
  },
])
