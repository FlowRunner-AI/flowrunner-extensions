const crypto = require('crypto')
const axios = require('axios')
const path = require('path')
const FormData = require('form-data')

// for file re-streaming to X
const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB

const AUTH_URL = 'https://x.com/i/oauth2/authorize'
const ACCESS_TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const API_BASE_URL = 'https://api.twitter.com/2'

const USER_SCOPE_LIST = [
  'tweet.write',
  'tweet.read',
  'follows.read',
  'follows.write',
  'media.write',
  'users.read',
  'offline.access',
]

const USER_SCOPE_STRING = USER_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[X / Twitter Service] info:', ...args),
  debug: (...args) => console.log('[X / Twitter Service] debug:', ...args),
  error: (...args) => console.log('[X / Twitter Service] error:', ...args),
  warn: (...args) => console.log('[X / Twitter Service] warn:', ...args),
}

/**
 *  @requireOAuth
 *  @integrationName X / Twitter
 *  @integrationIcon /icon.png
 **/

class XTwitter {
  constructor(config, context) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.userScope = USER_SCOPE_STRING
  }

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   */
  async getOAuth2ConnectionURL() {
    const codeVerifier = this.#generateCodeVerifier()

    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('scope', this.userScope)
    params.append('code_challenge', codeVerifier)
    params.append('code_challenge_method', 'plain')
    params.append('state', codeVerifier)

    return `${ AUTH_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('client_id', this.clientId)

    try {
      const response = await Flowrunner.Request.post(ACCESS_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .set(this.#generateBasicAuthHeader())
        .send(params.toString())

      logger.debug(`[refreshToken] response: ${ JSON.stringify(response) }`)

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      error = normalizeError(error)

      logger.error(`refreshToken: ${ error.message }`)

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
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    let codeExchangeResponse = {}

    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code_verifier', callbackObject['state'])

    try {
      codeExchangeResponse = await Flowrunner.Request.post(ACCESS_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .set(this.#generateBasicAuthHeader())
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse, null, 2) }`)
    } catch (error) {
      error = normalizeError(error)

      logger.error(`[executeCallback] codeExchangeResponse error: ${ JSON.stringify(error, null, 2) }`)
    }

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request.get(`${ API_BASE_URL }/users/me`)
        .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))
        .query({
          'user.fields': 'profile_image_url',
        })

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      error = normalizeError(error)

      logger.error(`[executeCallback] userInfo error: ${ JSON.stringify(error, null, 2) }`)

      return {}
    }

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: `${ userInfo.data.name } (@${ userInfo.data.username })`,
      connectionIdentityImageURL: userInfo.data.profile_image_url,
      overwrite: true, // Overwrites the connection if connectionIdentityName already exists.
      userData: {}, // Stores any relevant information about the authenticated account.
    }
  }

  /**
   * @operationName Create Post
   * @category Tweet Management
   * @description Posts tweets to X/Twitter for AI agents to share automated updates, broadcast notifications, or distribute content. Perfect for automated social media management, posting generated insights, or sharing processed results with followers.
   * @route POST /createPost
   *
   * @appearanceColor #1DA1F2 #0d8ddb
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Post Text","name":"text","required":true,"description":"Tweet content (max 280 characters). Examples: 'New article published: [link]', 'Weekly metrics: 15% growth', 'AI-generated summary: [key insights]'. Include hashtags and mentions as needed.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @sampleResult {"id":"1234567890123456789","text":"Hello, world!", "edit_history_tweet_ids":["1234567890123456789"]}
   */
  async createPost(text) {
    const logTag = '[createPost]'

    text = text && text.trim()

    if (!text || typeof text !== 'string') {
      throw new Error('The "text" parameter is required and must be a non-empty string.')
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tweets`,
      method: 'post',
      body: {
        text: text.trim(),
      },
    })

    logger.debug(`${ logTag } - Tweet posted successfully: ${ JSON.stringify(response) }`)

    return response.data
  }

  /**
   * @operationName Create Post with Image
   * @category Tweet Management
   * @description Posts tweets with images to X/Twitter for AI agents to share visual content, charts, or generated graphics. Perfect for automated posting of data visualizations, reports, or AI-generated images with accompanying text.
   * @route POST /createPostWithImage
   *
   * @appearanceColor #1DA1F2 #0d8ddb
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Post Text","name":"text","required":true,"description":"Tweet content with image (max 280 characters). Examples: 'Check out this chart!', 'Monthly report attached', 'AI analysis results 📊'. Text accompanies the uploaded image.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly accessible image URL to attach. Examples: 'https://api.service.com/chart.png', 'https://storage.com/report.jpg'. Supports PNG, JPG, GIF, WebP formats.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   *
   * @sampleResult {"id":"1234567890123456789","text":"Here’s a tweet with an image!"}
   */
  async createPostWithImage(text, imageUrl) {
    const logTag = '[createPostWithImage]'

    text = text && text.trim()
    imageUrl = imageUrl && imageUrl.trim()

    if (!text || typeof text !== 'string') {
      throw new Error('The "text" parameter is required and must be a non-empty string.')
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('The "imageUrl" parameter is required and must be a non-empty string.')
    }

    const downloadResponse = await axios.get(imageUrl, {
      responseType: 'stream',
    })

    // Determine media type
    let mediaType = downloadResponse.headers['content-type']

    if (!mediaType || mediaType === 'application/octet-stream') {
      const extension = path.extname(new URL(imageUrl).pathname).toLowerCase()
      const extensionToMimeType = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webp': 'image/webp',
      }
      mediaType = extensionToMimeType[extension]

      if (!mediaType) {
        throw new Error(`Unable to determine media type from file extension: ${ extension }`)
      }

      logger.debug(`${ logTag } Fallback media type inferred from extension: ${ mediaType }`)
    } else {
      logger.debug(`${ logTag } Media type detected from response headers: ${ mediaType }`)
    }

    const totalBytes = parseInt(downloadResponse.headers['content-length'], 10)

    if (!totalBytes || isNaN(totalBytes)) {
      throw new Error('Unable to determine file size for the uploaded file.')
    }

    logger.debug(`${ logTag } Downloaded mediaType=${ mediaType }, totalBytes=${ totalBytes }`)

    // Step 1: INIT
    const initResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/media/upload`,
      method: 'post',
      query: {
        command: 'INIT',
        media_type: mediaType,
        total_bytes: totalBytes,
        media_category: 'tweet_image',
      },
      logTag,
    })

    const mediaId = initResponse.data.id
    logger.debug(`${ logTag } INIT successful. media_id=${ mediaId }`)

    // Step 2: APPEND chunks
    let buffer = Buffer.alloc(0)
    let segmentIndex = 0

    await new Promise((resolve, reject) => {
      downloadResponse.data.on('data', async chunk => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= CHUNK_SIZE) {
          const chunkToUpload = buffer.slice(0, CHUNK_SIZE)
          buffer = buffer.slice(CHUNK_SIZE)

          try {
            await this.#uploadChunk(mediaId, segmentIndex, chunkToUpload, logTag)
            segmentIndex++
          } catch (error) {
            logger.error(`${ logTag } Error uploading chunk at segmentIndex=${ segmentIndex }: ${ error.message }`)
            reject(error)
          }
        }
      })

      downloadResponse.data.on('end', async () => {
        if (buffer.length > 0) {
          try {
            await this.#uploadChunk(mediaId, segmentIndex, buffer, logTag)
            logger.debug(`${ logTag } Last chunk uploaded at segmentIndex=${ segmentIndex }`)
          } catch (error) {
            logger.error(`${ logTag } Error uploading last chunk: ${ error.message }`)
            reject(error)
          }
        }

        resolve()
      })

      downloadResponse.data.on('error', error => {
        logger.error(`${ logTag } Stream error while downloading image: ${ error.message }`)
        reject(error)
      })
    })

    // Step 3: FINALIZE
    await this.#apiRequest({
      url: `${ API_BASE_URL }/media/upload`,
      method: 'post',
      query: {
        command: 'FINALIZE',
        media_id: mediaId,
      },
      logTag,
    })

    logger.debug(`${ logTag } FINALIZE successful. Media upload completed.`)

    // Step 4: Create the Tweet
    const tweetResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/tweets`,
      method: 'post',
      body: {
        text: text.trim(),
        media: {
          media_ids: [mediaId],
        },
      },
      logTag,
    })

    logger.debug(`${ logTag } Tweet posted successfully: ${ JSON.stringify(tweetResponse) }`)

    return tweetResponse.data
  }

  async #uploadChunk(mediaId, segmentIndex, chunkBuffer, logTag) {
    const formData = new FormData()
    formData.append('media', chunkBuffer, { filename: `chunk-${ segmentIndex }.bin` })

    await this.#apiRequest({
      url: `${ API_BASE_URL }/media/upload`,
      method: 'post',
      query: {
        command: 'APPEND',
        media_id: mediaId,
        segment_index: segmentIndex,
      },
      body: formData,
      headers: formData.getHeaders(),
      logTag,
    })

    logger.debug(`${ logTag } Uploaded chunk segmentIndex=${ segmentIndex }`)
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    this.#resolveAccessToken()

    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)
      logger.debug(`${ logTag } - api request body: [${ JSON.stringify(body) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader(this.userAccessToken))
        .set(headers)
        .query(query)
        .send(body)
    } catch (error) {
      error = normalizeError(error)

      logger.error(`${ logTag } - api request error: ${ error.message }`)

      throw error
    }
  }

  #resolveAccessToken() {
    if (this.accessTokenResolved) {
      return
    }

    this.userAccessToken = this.request.headers['oauth-access-token']
    this.accessTokenResolved = true
  }

  /**
   * Generates a random string suitable for OAuth PKCE 'code_verifier' or 'state'.
   *
   * @param {number} length - Length of the random string (default: 64).
   *
   * @returns {string} A URL-safe base64-encoded random string.
   **/
  #generateCodeVerifier(length = 64) {
    const randomBytes = crypto.randomBytes(length)

    return randomBytes
      .toString('base64') // Encode to base64
      .replace(/\+/g, '-') // Replace '+' with '-'
      .replace(/\//g, '_') // Replace '/' with '_'
      .replace(/=+$/, '') // Remove trailing '='
  }

  #getAccessTokenHeader(accessToken) {
    logger.debug(`[#getAccessTokenHeader] accessToken=${ accessToken }`)

    return {
      Authorization: `Bearer ${ accessToken }`,
    }
  }

  #generateBasicAuthHeader() {
    const credentials = `${ this.clientId }:${ this.clientSecret }`
    const base64Credentials = Buffer.from(credentials).toString('base64')

    return {
      Authorization: `Basic ${ base64Credentials }`,
    }
  }
}

Flowrunner.ServerCode.addService(XTwitter, [
  {
    order: 0,
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the X Developer Portal (Used to authenticate API requests).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the X Developer Portal (Required for secure authentication).',
  },
])

function normalizeError(error) {
  if (error.message && typeof error.message === 'object') {
    logger.debug(`[normalizeError] error.message=${ JSON.stringify(error.message) }`)

    if (error.message.error && error.message.error_description) {
      error.message = `[${ error.message.error }] ${ error.message.error_description }`
    } else if (error.message.detail) {
      error.message = `[${ error.message.title } ${ error.message.status }] ${ error.message.detail }`
    } else {
      error.message = JSON.stringify(error.message)
    }
  }

  return error
}
