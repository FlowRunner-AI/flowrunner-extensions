const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Cloudinary] info:', ...args),
  debug: (...args) => console.log('[Cloudinary] debug:', ...args),
  error: (...args) => console.log('[Cloudinary] error:', ...args),
  warn: (...args) => console.log('[Cloudinary] warn:', ...args),
}

const API_HOST = 'https://api.cloudinary.com/v1_1'
const DELIVERY_HOST = 'https://res.cloudinary.com'

const SIGNATURE_EXCLUDED_PARAMS = ['file', 'cloud_name', 'resource_type', 'api_key']

const RESOURCE_TYPES = { 'Auto': 'auto', 'Image': 'image', 'Video': 'video', 'Raw': 'raw' }
const CONCRETE_RESOURCE_TYPES = { 'Image': 'image', 'Video': 'video', 'Raw': 'raw' }
const TAG_COMMANDS = { 'Add': 'add', 'Remove': 'remove', 'Replace': 'replace', 'Remove All': 'remove_all' }
const LIST_DIRECTIONS = { 'Newest First': 'desc', 'Oldest First': 'asc' }
const SORT_DIRECTIONS = { 'Descending': 'desc', 'Ascending': 'asc' }
const SEARCH_FIELDS = { 'Tags': 'tags', 'Context': 'context' }

const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  avif: 'image/avif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  aac: 'audio/aac', flac: 'audio/flac', pdf: 'application/pdf', zip: 'application/zip',
  txt: 'text/plain', json: 'application/json', csv: 'text/csv',
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

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/')
}

/**
 * @usesFileStorage
 * @integrationName Cloudinary
 * @integrationIcon /icon.png
 */
class CloudinaryService {
  constructor(config) {
    this.cloudName = config.cloudName
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Signs Upload API parameters: SHA-1 hex of the alphabetically sorted `key=value` pairs
  // (arrays serialized comma-separated; file/cloud_name/resource_type/api_key excluded)
  // with the API secret appended. Returns the full signed parameter set.
  #signParams(params) {
    const timestamp = Math.floor(Date.now() / 1000)
    const cleaned = clean({ ...params, timestamp })

    const stringToSign = Object.keys(cleaned)
      .filter(key => !SIGNATURE_EXCLUDED_PARAMS.includes(key))
      .sort()
      .map(key => `${ key }=${ Array.isArray(cleaned[key]) ? cleaned[key].join(',') : cleaned[key] }`)
      .join('&')

    const signature = crypto.createHash('sha1')
      .update(stringToSign + this.apiSecret)
      .digest('hex')

    return { ...cleaned, api_key: this.apiKey, signature }
  }

  #handleError(error, logTag) {
    const message = error.body?.error?.message || error.body?.message || error.message

    logger.error(`${ logTag } - request failed: ${ message }`)

    throw new Error(`Cloudinary API error: ${ message }`)
  }

  // Upload API call: signed multipart POST to /v1_1/{cloudName}/{resourceType}/{action}.
  async #uploadApiRequest({ action, resourceType, params, logTag }) {
    const url = `${ API_HOST }/${ this.cloudName }/${ resourceType }/${ action }`

    try {
      logger.debug(`${ logTag } - upload API request: [POST::${ url }]`)

      const signedParams = this.#signParams(params)
      const formData = new Flowrunner.Request.FormData()

      for (const [key, value] of Object.entries(signedParams)) {
        if (Array.isArray(value)) {
          value.forEach(item => formData.append(`${ key }[]`, String(item)))
        } else {
          formData.append(key, String(value))
        }
      }

      return await Flowrunner.Request.post(url).form(formData)
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Admin API call: Basic-auth request to /v1_1/{cloudName}{path}.
  async #adminApiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ API_HOST }/${ this.cloudName }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - admin API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Basic ${ Buffer.from(`${ this.apiKey }:${ this.apiSecret }`).toString('base64') }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #buildDeliveryUrl(publicId, { transformation, format, resourceType, version, signUrl }) {
    const publicIdPart = format ? `${ publicId }.${ format }` : publicId
    const versionPart = version ? `v${ String(version).replace(/^v/, '') }` : null

    let signaturePart = null

    if (signUrl) {
      const stringToSign = [transformation, publicIdPart].filter(Boolean).join('/')
      const digest = crypto.createHash('sha1')
        .update(stringToSign + this.apiSecret)
        .digest('base64')

      signaturePart = `s--${ digest.replace(/\+/g, '-').replace(/\//g, '_').substring(0, 8) }--`
    }

    const pathParts = [signaturePart, transformation, versionPart, publicIdPart].filter(Boolean)

    return `${ DELIVERY_HOST }/${ this.cloudName }/${ resourceType }/upload/${ pathParts.join('/') }`
  }

  async #downloadBytes(url, logTag) {
    try {
      logger.debug(`${ logTag } - downloading bytes from [${ url }]`)

      const bytes = await Flowrunner.Request.get(url).setEncoding(null)

      return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  /**
   * @operationName Upload Asset
   * @category Upload
   * @description Uploads an image, video, or raw file to your Cloudinary media library. The source is either a publicly accessible remote URL or a FlowRunner file (its bytes are downloaded and sent to Cloudinary as a base64 data URI) - provide exactly one of the two. Supports setting the public ID, target folder, tags, an incoming transformation applied before storing, eager transformations that pre-generate derived versions, and contextual metadata. Returns the stored asset including its public_id, secure_url, format, and dimensions.
   * @route POST /upload-asset
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to upload (its URL). The file's bytes are downloaded and sent to Cloudinary as a base64 data URI. Use this OR Source URL."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","description":"Publicly accessible HTTP(S) URL of the file to upload. Cloudinary fetches it server-side. Use this OR File."}
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","description":"Identifier to assign to the uploaded asset (may include folder path segments, e.g. products/shoe_01). Auto-generated when omitted."}
   * @paramDef {"type":"String","label":"Folder","name":"folder","dictionary":"getFoldersDictionary","description":"Folder path to store the asset in, e.g. products/summer. Created automatically if it does not exist."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to assign to the asset, e.g. sale,featured."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite an existing asset with the same public ID. When off, Cloudinary returns the existing asset instead."}
   * @paramDef {"type":"String","label":"Transformation","name":"transformation","description":"Incoming transformation applied to the asset before it is stored, e.g. w_1000,c_limit,q_auto."}
   * @paramDef {"type":"String","label":"Eager Transformations","name":"eager","description":"Transformations to generate eagerly as derived versions right after upload. Separate multiple with |, e.g. w_400,h_300,c_fill|w_100,h_100,c_thumb."}
   * @paramDef {"type":"String","label":"Context","name":"context","description":"Contextual metadata as pipe-separated key=value pairs, e.g. alt=Red shoe|caption=Summer catalog."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Image","Video","Raw"]}},"defaultValue":"Auto","description":"Type of asset being uploaded. Auto lets Cloudinary detect it from the content."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","version":1712345678,"resource_type":"image","format":"jpg","width":1200,"height":800,"bytes":245678,"type":"upload","created_at":"2026-07-18T10:00:00Z","tags":["sale"],"url":"http://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg","secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg"}
   */
  async uploadAsset(fileUrl, sourceUrl, publicId, folder, tags, overwrite, transformation, eager, context, resourceType) {
    const logTag = '[uploadAsset]'

    if (!fileUrl && !sourceUrl) {
      throw new Error('Either File or Source URL must be provided.')
    }

    if (fileUrl && sourceUrl) {
      throw new Error('Provide either File or Source URL, not both.')
    }

    let file = sourceUrl

    if (fileUrl) {
      const buffer = await this.#downloadBytes(fileUrl, logTag)
      const extension = fileUrl.split('?')[0].split('.').pop().toLowerCase()
      const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

      file = `data:${ mimeType };base64,${ buffer.toString('base64') }`
    }

    return await this.#uploadApiRequest({
      logTag,
      action: 'upload',
      resourceType: this.#resolveChoice(resourceType, RESOURCE_TYPES) || 'auto',
      params: {
        file,
        public_id: publicId,
        folder,
        tags,
        overwrite,
        transformation,
        eager,
        context,
      },
    })
  }

  /**
   * @operationName Upload from URL
   * @category Upload
   * @description Uploads a file to Cloudinary directly from a publicly accessible remote URL - Cloudinary fetches the file server-side, so nothing is transferred through FlowRunner. A convenience variant of Upload Asset for URL-only sources. Supports public ID, folder, tags, an incoming transformation, and overwrite control. Returns the stored asset including its public_id, secure_url, format, and dimensions.
   * @route POST /upload-from-url
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Publicly accessible HTTP(S) URL of the file to upload, e.g. https://example.com/images/photo.jpg."}
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","description":"Identifier to assign to the uploaded asset (may include folder path segments). Auto-generated when omitted."}
   * @paramDef {"type":"String","label":"Folder","name":"folder","dictionary":"getFoldersDictionary","description":"Folder path to store the asset in, e.g. products/summer. Created automatically if it does not exist."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to assign to the asset, e.g. sale,featured."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite an existing asset with the same public ID. When off, Cloudinary returns the existing asset instead."}
   * @paramDef {"type":"String","label":"Transformation","name":"transformation","description":"Incoming transformation applied to the asset before it is stored, e.g. w_1000,c_limit,q_auto."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Image","Video","Raw"]}},"defaultValue":"Auto","description":"Type of asset being uploaded. Auto lets Cloudinary detect it from the content."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"remote_photo","version":1712345678,"resource_type":"image","format":"jpg","width":1600,"height":900,"bytes":389123,"type":"upload","created_at":"2026-07-18T10:00:00Z","secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/remote_photo.jpg"}
   */
  async uploadFromUrl(url, publicId, folder, tags, overwrite, transformation, resourceType) {
    const logTag = '[uploadFromUrl]'

    return await this.#uploadApiRequest({
      logTag,
      action: 'upload',
      resourceType: this.#resolveChoice(resourceType, RESOURCE_TYPES) || 'auto',
      params: {
        file: url,
        public_id: publicId,
        folder,
        tags,
        overwrite,
        transformation,
      },
    })
  }

  /**
   * @operationName Rename Asset
   * @category Asset Management
   * @description Renames an asset by changing its public ID, which also moves it when the new public ID contains a different folder path (e.g. drafts/img to products/img). Optionally overwrites an existing asset that already uses the target public ID. Returns the updated asset details.
   * @route POST /rename-asset
   *
   * @paramDef {"type":"String","label":"From Public ID","name":"fromPublicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Current public ID of the asset to rename."}
   * @paramDef {"type":"String","label":"To Public ID","name":"toPublicId","required":true,"description":"New public ID to assign. Include folder path segments to move the asset, e.g. products/shoe_01."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite an existing asset that already has the target public ID. When off, the rename fails if the target exists."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset being renamed."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","version":1712345999,"resource_type":"image","format":"jpg","width":1200,"height":800,"bytes":245678,"type":"upload","created_at":"2026-07-18T10:00:00Z","secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345999/products/shoe_01.jpg"}
   */
  async renameAsset(fromPublicId, toPublicId, overwrite, resourceType) {
    const logTag = '[renameAsset]'

    return await this.#uploadApiRequest({
      logTag,
      action: 'rename',
      resourceType: this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image',
      params: {
        from_public_id: fromPublicId,
        to_public_id: toPublicId,
        overwrite,
      },
    })
  }

  /**
   * @operationName Destroy Asset
   * @category Asset Management
   * @description Permanently deletes a single asset from your Cloudinary media library by its public ID. Optionally invalidates cached copies on the CDN so the deleted asset stops being served immediately (invalidation can take up to an hour to propagate). Returns a result of "ok" on success or "not found" when no asset matches.
   * @route DELETE /destroy-asset
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the asset to delete."}
   * @paramDef {"type":"Boolean","label":"Invalidate CDN Cache","name":"invalidate","uiComponent":{"type":"TOGGLE"},"description":"Whether to also invalidate cached copies of the asset on the CDN."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset being deleted."}
   *
   * @returns {Object}
   * @sampleResult {"result":"ok"}
   */
  async destroyAsset(publicId, invalidate, resourceType) {
    const logTag = '[destroyAsset]'

    return await this.#uploadApiRequest({
      logTag,
      action: 'destroy',
      resourceType: this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image',
      params: {
        public_id: publicId,
        invalidate,
      },
    })
  }

  /**
   * @operationName Manage Tags
   * @category Tags
   * @description Adds, removes, or replaces tags on one or more assets in a single call, or removes all tags from the given assets. Add appends the tag(s), Remove deletes the given tag(s), Replace clears existing tags and assigns the given tag(s), and Remove All clears every tag. Returns the list of public IDs that were updated.
   * @route POST /manage-tags
   *
   * @paramDef {"type":"String","label":"Command","name":"command","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Add","Remove","Replace","Remove All"]}},"defaultValue":"Add","description":"Tag operation to perform on the selected assets."}
   * @paramDef {"type":"Array<String>","label":"Public IDs","name":"publicIds","required":true,"description":"Public IDs of the assets to update (up to 1000 per call)."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","dictionary":"getTagsDictionary","description":"Tag to add, remove, or replace with. Separate multiple tags with commas. You can type a new tag or pick an existing one. Required for every command except Remove All."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the assets being updated."}
   *
   * @returns {Object}
   * @sampleResult {"public_ids":["products/shoe_01","products/shoe_02"]}
   */
  async manageTags(command, publicIds, tag, resourceType) {
    const logTag = '[manageTags]'
    const resolvedCommand = this.#resolveChoice(command, TAG_COMMANDS) || 'add'

    if (resolvedCommand !== 'remove_all' && !tag) {
      throw new Error('Tag is required for the Add, Remove, and Replace commands.')
    }

    return await this.#uploadApiRequest({
      logTag,
      action: 'tags',
      resourceType: this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image',
      params: {
        command: resolvedCommand,
        public_ids: publicIds,
        tag: resolvedCommand === 'remove_all' ? undefined : tag,
      },
    })
  }

  /**
   * @operationName Apply Transformation
   * @category Asset Management
   * @description Eagerly generates derived (transformed) versions of an already-uploaded asset using Cloudinary's explicit method. Use this to pre-generate resized, cropped, or optimized variants so they are served instantly from the CDN instead of being created on the first request. Returns the asset details together with the generated eager versions and their URLs.
   * @route POST /apply-transformation
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the uploaded asset to generate derived versions for."}
   * @paramDef {"type":"String","label":"Eager Transformations","name":"eager","required":true,"description":"Transformation(s) to generate, e.g. w_400,h_300,c_fill,q_auto. Separate multiple with |, e.g. w_400,h_300,c_fill|w_100,h_100,c_thumb."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","version":1712345678,"resource_type":"image","format":"jpg","width":1200,"height":800,"bytes":245678,"type":"upload","eager":[{"transformation":"w_400,h_300,c_fill","width":400,"height":300,"bytes":24567,"url":"http://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1712345678/products/shoe_01.jpg","secure_url":"https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1712345678/products/shoe_01.jpg"}]}
   */
  async applyTransformation(publicId, eager, resourceType) {
    const logTag = '[applyTransformation]'

    return await this.#uploadApiRequest({
      logTag,
      action: 'explicit',
      resourceType: this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image',
      params: {
        public_id: publicId,
        type: 'upload',
        eager,
      },
    })
  }

  /**
   * @operationName List Resources
   * @category Asset Management
   * @description Lists uploaded assets of a given resource type from your media library, newest or oldest first, optionally filtered by public ID prefix (which also matches folder paths, e.g. products/). Supports cursor-based pagination and can include each asset's tags and contextual metadata in the response.
   * @route GET /list-resources
   *
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the assets to list."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Only return assets whose public ID starts with this prefix, e.g. products/ to list a folder."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of assets to return (1-500). Defaults to 10."}
   * @paramDef {"type":"String","label":"Next Cursor","name":"nextCursor","description":"Pagination cursor from a previous call's next_cursor to fetch the next page."}
   * @paramDef {"type":"Boolean","label":"Include Tags","name":"includeTags","uiComponent":{"type":"TOGGLE"},"description":"Whether to include each asset's tags in the response."}
   * @paramDef {"type":"Boolean","label":"Include Context","name":"includeContext","uiComponent":{"type":"TOGGLE"},"description":"Whether to include each asset's contextual metadata in the response."}
   * @paramDef {"type":"String","label":"Sort Order","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First"]}},"defaultValue":"Newest First","description":"Order of results by creation date."}
   *
   * @returns {Object}
   * @sampleResult {"resources":[{"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","format":"jpg","version":1712345678,"resource_type":"image","type":"upload","created_at":"2026-07-18T10:00:00Z","bytes":245678,"width":1200,"height":800,"secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg"}],"next_cursor":"8c452e112d4c88ac7c9ffb3a2a41c41e"}
   */
  async listResources(resourceType, prefix, maxResults, nextCursor, includeTags, includeContext, direction) {
    const logTag = '[listResources]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    return await this.#adminApiRequest({
      logTag,
      path: `/resources/${ type }`,
      method: 'get',
      query: {
        type: 'upload',
        prefix,
        max_results: maxResults,
        next_cursor: nextCursor,
        tags: includeTags,
        context: includeContext,
        direction: this.#resolveChoice(direction, LIST_DIRECTIONS),
      },
    })
  }

  /**
   * @operationName Search Assets
   * @category Asset Management
   * @description Searches your entire media library with Cloudinary's expressive (Lucene-like) query language across all resource types. Expressions combine fields with AND/OR/NOT, e.g. "folder:products AND tags:sale", "resource_type:image AND bytes>1000000", "public_id:banner*", or "created_at>1w" for assets uploaded in the last week. Supports sorting, cursor-based pagination, and optionally including tags and context in results.
   * @route GET /search-assets
   *
   * @paramDef {"type":"String","label":"Expression","name":"expression","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Search expression, e.g. folder:products AND tags:sale, or public_id:banner*. Leave empty to return all assets."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field to sort results by, e.g. created_at, uploaded_at, public_id, or bytes. Defaults to created_at."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"defaultValue":"Descending","description":"Sort direction for the Sort By field."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of assets to return (1-500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Cursor","name":"nextCursor","description":"Pagination cursor from a previous call's next_cursor to fetch the next page."}
   * @paramDef {"type":"Array<String>","label":"Include Fields","name":"withFields","uiComponent":{"type":"DROPDOWN","options":{"values":["Tags","Context"]}},"description":"Extra asset fields to include in each result."}
   *
   * @returns {Object}
   * @sampleResult {"total_count":2,"time":24,"resources":[{"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","folder":"products","filename":"shoe_01","format":"jpg","resource_type":"image","type":"upload","created_at":"2026-07-18T10:00:00Z","bytes":245678,"width":1200,"height":800,"tags":["sale"],"secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg"}],"next_cursor":"8c452e112d4c88ac7c9ffb3a2a41c41e"}
   */
  async searchAssets(expression, sortBy, sortDirection, maxResults, nextCursor, withFields) {
    const logTag = '[searchAssets]'
    const direction = this.#resolveChoice(sortDirection, SORT_DIRECTIONS) || 'desc'

    return await this.#adminApiRequest({
      logTag,
      path: '/resources/search',
      method: 'post',
      body: clean({
        expression,
        sort_by: [{ [sortBy || 'created_at']: direction }],
        max_results: maxResults,
        next_cursor: nextCursor,
        with_field: Array.isArray(withFields) && withFields.length
          ? withFields.map(field => this.#resolveChoice(field, SEARCH_FIELDS))
          : undefined,
      }),
    })
  }

  /**
   * @operationName Get Asset Details
   * @category Asset Management
   * @description Retrieves full details of a single uploaded asset by its public ID, including size, format, dimensions, tags, context, and derived versions. Optionally includes predominant color analysis, detected face coordinates, and embedded image metadata (EXIF/IPTC) for image assets.
   * @route GET /get-asset-details
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the asset to retrieve."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset."}
   * @paramDef {"type":"Boolean","label":"Include Colors","name":"colors","uiComponent":{"type":"TOGGLE"},"description":"Whether to include predominant color information (image assets only)."}
   * @paramDef {"type":"Boolean","label":"Include Faces","name":"faces","uiComponent":{"type":"TOGGLE"},"description":"Whether to include coordinates of automatically detected faces (image assets only)."}
   * @paramDef {"type":"Boolean","label":"Include Image Metadata","name":"imageMetadata","uiComponent":{"type":"TOGGLE"},"description":"Whether to include embedded metadata such as EXIF and IPTC fields."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","format":"jpg","version":1712345678,"resource_type":"image","type":"upload","created_at":"2026-07-18T10:00:00Z","bytes":245678,"width":1200,"height":800,"asset_folder":"products","tags":["sale"],"context":{"custom":{"alt":"Red shoe"}},"secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg","derived":[{"transformation":"w_400,h_300,c_fill","format":"jpg","bytes":24567,"secure_url":"https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/v1712345678/products/shoe_01.jpg"}]}
   */
  async getAssetDetails(publicId, resourceType, colors, faces, imageMetadata) {
    const logTag = '[getAssetDetails]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    return await this.#adminApiRequest({
      logTag,
      path: `/resources/${ type }/upload/${ encodePath(publicId) }`,
      method: 'get',
      query: {
        colors,
        faces,
        image_metadata: imageMetadata,
      },
    })
  }

  /**
   * @operationName Update Asset
   * @category Asset Management
   * @description Updates stored properties of an uploaded asset via the Admin API: replaces its tags, sets contextual metadata, and/or moves it to a different asset folder (product environments with dynamic folders). Only the provided fields are changed. Returns the updated asset details.
   * @route PUT /update-asset
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the asset to update."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags that replaces the asset's current tags, e.g. sale,featured."}
   * @paramDef {"type":"String","label":"Context","name":"context","description":"Contextual metadata as pipe-separated key=value pairs, e.g. alt=Red shoe|caption=Summer catalog."}
   * @paramDef {"type":"String","label":"Asset Folder","name":"assetFolder","dictionary":"getFoldersDictionary","description":"Folder path to move the asset to (dynamic-folders product environments only)."}
   *
   * @returns {Object}
   * @sampleResult {"asset_id":"b5e6d2b39ba3e0869d67141ba7dba6cf","public_id":"products/shoe_01","format":"jpg","version":1712345678,"resource_type":"image","type":"upload","created_at":"2026-07-18T10:00:00Z","bytes":245678,"width":1200,"height":800,"tags":["sale","featured"],"context":{"custom":{"alt":"Red shoe"}},"asset_folder":"products","secure_url":"https://res.cloudinary.com/demo/image/upload/v1712345678/products/shoe_01.jpg"}
   */
  async updateAsset(publicId, resourceType, tags, context, assetFolder) {
    const logTag = '[updateAsset]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    return await this.#adminApiRequest({
      logTag,
      path: `/resources/${ type }/upload/${ encodePath(publicId) }`,
      method: 'post',
      query: {
        tags,
        context,
        asset_folder: assetFolder,
      },
    })
  }

  /**
   * @operationName Delete Assets
   * @category Asset Management
   * @description Deletes multiple uploaded assets in one Admin API call, either by an explicit list of public IDs (up to 100 per call) or by a public ID prefix (deletes up to 1000 matching assets, e.g. all assets in a folder). Provide exactly one of Public IDs or Prefix. Returns a per-asset deletion status map and a partial flag when more matching assets remain.
   * @route DELETE /delete-assets
   *
   * @paramDef {"type":"Array<String>","label":"Public IDs","name":"publicIds","description":"Public IDs of the assets to delete (up to 100 per call). Use this OR Prefix."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Delete all assets whose public ID starts with this prefix, e.g. products/. Use this OR Public IDs."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the assets to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":{"products/shoe_01":"deleted","products/shoe_02":"deleted"},"deleted_counts":{"products/shoe_01":{"original":1,"derived":2}},"partial":false}
   */
  async deleteAssets(publicIds, prefix, resourceType) {
    const logTag = '[deleteAssets]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'
    const hasPublicIds = Array.isArray(publicIds) && publicIds.length > 0

    if (!hasPublicIds && !prefix) {
      throw new Error('Either Public IDs or Prefix must be provided.')
    }

    if (hasPublicIds && prefix) {
      throw new Error('Provide either Public IDs or Prefix, not both.')
    }

    const queryString = hasPublicIds
      ? publicIds.map(id => `public_ids[]=${ encodeURIComponent(id) }`).join('&')
      : `prefix=${ encodeURIComponent(prefix) }`

    return await this.#adminApiRequest({
      logTag,
      path: `/resources/${ type }/upload?${ queryString }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists the tags currently assigned to assets of a given resource type in your media library, optionally filtered by prefix. Supports cursor-based pagination for environments with many tags.
   * @route GET /list-tags
   *
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type whose tags to list."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Only return tags that start with this prefix."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tags to return (1-500). Defaults to 10."}
   * @paramDef {"type":"String","label":"Next Cursor","name":"nextCursor","description":"Pagination cursor from a previous call's next_cursor to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["featured","sale","summer"],"next_cursor":"8c452e112d4c88ac7c9ffb3a2a41c41e"}
   */
  async listTags(resourceType, prefix, maxResults, nextCursor) {
    const logTag = '[listTags]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    return await this.#adminApiRequest({
      logTag,
      path: `/tags/${ type }`,
      method: 'get',
      query: {
        prefix,
        max_results: maxResults,
        next_cursor: nextCursor,
      },
    })
  }

  /**
   * @operationName Get Usage
   * @category Account
   * @description Retrieves the current usage report for your Cloudinary product environment: plan name, credits, storage, bandwidth, transformations, object counts, and requests, together with plan limits and usage percentages. Useful for monitoring quota consumption from a flow.
   * @route GET /get-usage
   *
   * @returns {Object}
   * @sampleResult {"plan":"Free","last_updated":"2026-07-18","transformations":{"usage":1200,"credits_usage":0.12},"objects":{"usage":345},"bandwidth":{"usage":104857600,"credits_usage":0.1},"storage":{"usage":524288000,"credits_usage":0.49},"credits":{"usage":0.71,"limit":25,"used_percent":2.84},"requests":15230,"resources":345,"derived_resources":812,"media_limits":{"image_max_size_bytes":10485760,"video_max_size_bytes":104857600,"raw_max_size_bytes":10485760}}
   */
  async getUsage() {
    const logTag = '[getUsage]'

    return await this.#adminApiRequest({
      logTag,
      path: '/usage',
      method: 'get',
    })
  }

  /**
   * @operationName Ping
   * @category Account
   * @description Verifies connectivity and credentials against the Cloudinary Admin API. Returns status "ok" when the cloud name, API key, and API secret are valid. Useful as a connection test step in flows.
   * @route GET /ping
   *
   * @returns {Object}
   * @sampleResult {"status":"ok"}
   */
  async ping() {
    const logTag = '[ping]'

    return await this.#adminApiRequest({
      logTag,
      path: '/ping',
      method: 'get',
    })
  }

  /**
   * @operationName List Root Folders
   * @category Folders
   * @description Lists the top-level folders in your Cloudinary media library with their names and full paths. Supports cursor-based pagination for environments with many root folders.
   * @route GET /list-root-folders
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of folders to return (1-500). Defaults to the API's standard page size."}
   * @paramDef {"type":"String","label":"Next Cursor","name":"nextCursor","description":"Pagination cursor from a previous call's next_cursor to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"folders":[{"name":"products","path":"products"},{"name":"marketing","path":"marketing"}],"next_cursor":null,"total_count":2}
   */
  async listRootFolders(maxResults, nextCursor) {
    const logTag = '[listRootFolders]'

    return await this.#adminApiRequest({
      logTag,
      path: '/folders',
      method: 'get',
      query: {
        max_results: maxResults,
        next_cursor: nextCursor,
      },
    })
  }

  /**
   * @operationName List Subfolders
   * @category Folders
   * @description Lists the direct subfolders of a given folder path in your Cloudinary media library with their names and full paths. Supports cursor-based pagination.
   * @route GET /list-subfolders
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","required":true,"dictionary":"getFoldersDictionary","description":"Path of the parent folder to list subfolders of, e.g. products or products/summer."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of folders to return (1-500). Defaults to the API's standard page size."}
   * @paramDef {"type":"String","label":"Next Cursor","name":"nextCursor","description":"Pagination cursor from a previous call's next_cursor to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"folders":[{"name":"summer","path":"products/summer"},{"name":"winter","path":"products/winter"}],"next_cursor":null,"total_count":2}
   */
  async listSubfolders(folderPath, maxResults, nextCursor) {
    const logTag = '[listSubfolders]'

    return await this.#adminApiRequest({
      logTag,
      path: `/folders/${ encodePath(folderPath) }`,
      method: 'get',
      query: {
        max_results: maxResults,
        next_cursor: nextCursor,
      },
    })
  }

  /**
   * @operationName Create Folder
   * @category Folders
   * @description Creates a new folder at the given path in your Cloudinary media library, including any missing intermediate folders (e.g. products/summer/shoes creates all three levels as needed). Returns the created folder's name and path.
   * @route POST /create-folder
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","required":true,"description":"Full path of the folder to create, e.g. products/summer."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"path":"products/summer","name":"summer"}
   */
  async createFolder(folderPath) {
    const logTag = '[createFolder]'

    return await this.#adminApiRequest({
      logTag,
      path: `/folders/${ encodePath(folderPath) }`,
      method: 'post',
    })
  }

  /**
   * @operationName Delete Folder
   * @category Folders
   * @description Deletes an empty folder at the given path from your Cloudinary media library. The folder must contain no assets (in fixed-folder environments it must also have no subfolders); otherwise the API returns an error. Returns the list of deleted folder paths.
   * @route DELETE /delete-folder
   *
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","required":true,"dictionary":"getFoldersDictionary","description":"Full path of the empty folder to delete, e.g. products/summer."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":["products/summer"]}
   */
  async deleteFolder(folderPath) {
    const logTag = '[deleteFolder]'

    return await this.#adminApiRequest({
      logTag,
      path: `/folders/${ encodePath(folderPath) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Generate Delivery URL
   * @category Delivery
   * @description Builds a Cloudinary CDN delivery URL for an asset without making any API call, in the form https://res.cloudinary.com/{cloud}/{resourceType}/upload/{transformation}/{version}/{publicId}.{format}. Apply on-the-fly transformations (e.g. w_400,h_300,c_fill,q_auto,f_auto) and format conversion simply by naming them in the URL - ideal for feeding resized, cropped, or optimized media into other services. Optionally adds a URL signature (s--...--) computed with your API secret for environments that restrict unsigned transformation URLs.
   * @route GET /generate-delivery-url
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the asset to build the URL for (without file extension), e.g. products/shoe_01."}
   * @paramDef {"type":"String","label":"Transformation","name":"transformation","description":"Transformation string applied on delivery, e.g. w_400,h_300,c_fill,q_auto,f_auto. Chain multiple steps with /, e.g. w_400,c_fill/e_grayscale."}
   * @paramDef {"type":"String","label":"Format","name":"format","description":"Delivery format appended as the file extension, e.g. jpg, png, webp, or mp4. Omit to deliver in the original format."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset."}
   * @paramDef {"type":"String","label":"Version","name":"version","description":"Optional asset version to pin the URL to (with or without the v prefix), e.g. 1712345678. Bypasses stale CDN caches after re-uploads."}
   * @paramDef {"type":"Boolean","label":"Sign URL","name":"signUrl","uiComponent":{"type":"TOGGLE"},"description":"Whether to include a URL signature (s--...--) computed with your API secret. Required by environments that restrict unsigned transformation URLs."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill,q_auto,f_auto/v1712345678/products/shoe_01.jpg","publicId":"products/shoe_01","resourceType":"image","transformation":"w_400,h_300,c_fill,q_auto,f_auto","format":"jpg","signed":false}
   */
  async generateDeliveryUrl(publicId, transformation, format, resourceType, version, signUrl) {
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    const url = this.#buildDeliveryUrl(publicId, {
      transformation,
      format,
      resourceType: type,
      version,
      signUrl: Boolean(signUrl),
    })

    return {
      url,
      publicId,
      resourceType: type,
      transformation: transformation || null,
      format: format || null,
      signed: Boolean(signUrl),
    }
  }

  /**
   * @operationName Download Asset
   * @category Delivery
   * @description Downloads an asset from the Cloudinary CDN - optionally transformed on the fly (e.g. resized with w_400,h_300,c_fill or converted with a target format) - and saves it to FlowRunner file storage. Returns the stored file's URL along with its name and size, ready to pass to other services in the flow.
   * @route POST /download-asset
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Public ID","name":"publicId","required":true,"dictionary":"getRecentAssetsDictionary","description":"Public ID of the asset to download (without file extension), e.g. products/shoe_01."}
   * @paramDef {"type":"String","label":"Transformation","name":"transformation","description":"Transformation string applied before download, e.g. w_400,h_300,c_fill,q_auto."}
   * @paramDef {"type":"String","label":"Format","name":"format","description":"Format to download the asset in, e.g. jpg, png, webp, or mp4. Omit to download the original format."}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Raw"]}},"defaultValue":"Image","description":"Resource type of the asset."}
   * @paramDef {"type":"Boolean","label":"Sign URL","name":"signUrl","uiComponent":{"type":"TOGGLE"},"description":"Whether to sign the delivery URL with your API secret. Enable for environments that restrict unsigned transformation URLs."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved file. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://storage.flowrunner.com/files/flow/shoe_01_1712345678901.jpg","filename":"shoe_01_1712345678901.jpg","sizeBytes":24567,"sourceUrl":"https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/products/shoe_01.jpg"}
   */
  async downloadAsset(publicId, transformation, format, resourceType, signUrl, fileOptions) {
    const logTag = '[downloadAsset]'
    const type = this.#resolveChoice(resourceType, CONCRETE_RESOURCE_TYPES) || 'image'

    const deliveryUrl = this.#buildDeliveryUrl(publicId, {
      transformation,
      format,
      resourceType: type,
      signUrl: Boolean(signUrl),
    })

    const buffer = await this.#downloadBytes(deliveryUrl, logTag)

    const baseName = publicId.split('/').pop()
    const filename = `${ baseName }_${ Date.now() }${ format ? `.${ format }` : '' }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    logger.info(`${ logTag } - saved ${ buffer.length } bytes as ${ filename }`)

    return {
      fileUrl: url,
      filename,
      sizeBytes: buffer.length,
      sourceUrl: deliveryUrl,
    }
  }

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filters folders by name. Include a / to browse subfolders of a path, e.g. products/ lists the subfolders of products."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by the previous dictionary page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a browsable list of media library folders for selecting a folder path in upload, update, and folder operations. Lists root folders by default; typing a path containing / browses that path's subfolders. The option value is the full folder path.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for the folder listing."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"products","value":"products","note":"folder"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getFoldersDictionary]'

    let parentPath = ''
    let nameFilter = (search || '').trim()

    if (nameFilter.includes('/')) {
      const separatorIndex = nameFilter.lastIndexOf('/')

      parentPath = nameFilter.substring(0, separatorIndex)
      nameFilter = nameFilter.substring(separatorIndex + 1)
    }

    const response = await this.#adminApiRequest({
      logTag,
      path: parentPath ? `/folders/${ encodePath(parentPath) }` : '/folders',
      method: 'get',
      query: {
        max_results: 100,
        next_cursor: cursor,
      },
    })

    const folders = (response.folders || [])
      .filter(folder => !nameFilter || folder.name.toLowerCase().includes(nameFilter.toLowerCase()))

    return {
      items: folders.map(folder => ({
        label: folder.path,
        value: folder.path,
        note: 'folder',
      })),
      cursor: response.next_cursor || null,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Prefix to filter tags by."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by the previous dictionary page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides the list of tags currently assigned to image assets in the media library, for selecting an existing tag in tag operations. The search string filters tags by prefix; new tags can still be typed manually.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for the tag listing."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"sale","value":"sale"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTagsDictionary]'

    const response = await this.#adminApiRequest({
      logTag,
      path: '/tags/image',
      method: 'get',
      query: {
        prefix: search,
        max_results: 50,
        next_cursor: cursor,
      },
    })

    return {
      items: (response.tags || []).map(tag => ({ label: tag, value: tag })),
      cursor: response.next_cursor || null,
    }
  }

  /**
   * @typedef {Object} getRecentAssetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filters assets whose public ID starts with this text."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by the previous dictionary page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Recent Assets Dictionary
   * @description Provides recently uploaded assets across all resource types (newest first) for selecting a public ID in asset operations. The search string matches public IDs by prefix. The option value is the asset's public ID.
   * @route POST /get-recent-assets-dictionary
   * @paramDef {"type":"getRecentAssetsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for the asset listing."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"products/shoe_01","value":"products/shoe_01","note":"image/jpg"}],"cursor":"8c452e112d4c88ac7c9ffb3a2a41c41e"}
   */
  async getRecentAssetsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getRecentAssetsDictionary]'

    const response = await this.#adminApiRequest({
      logTag,
      path: '/resources/search',
      method: 'post',
      body: clean({
        expression: search ? `public_id:${ search }*` : '',
        sort_by: [{ created_at: 'desc' }],
        max_results: 50,
        next_cursor: cursor,
      }),
    })

    return {
      items: (response.resources || []).map(resource => ({
        label: resource.public_id,
        value: resource.public_id,
        note: [resource.resource_type, resource.format].filter(Boolean).join('/'),
      })),
      cursor: response.next_cursor || null,
    }
  }
}

Flowrunner.ServerCode.addService(CloudinaryService, [
  {
    name: 'cloudName',
    displayName: 'Cloud Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cloudinary product environment cloud name. Find it in the Cloudinary Console under Settings > API Keys, or on the Dashboard.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cloudinary API key. Find it in the Cloudinary Console under Settings > API Keys.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cloudinary API secret. Find it in the Cloudinary Console under Settings > API Keys. Keep this value private.',
  },
])
