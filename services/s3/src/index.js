'use strict'

const crypto = require('crypto')

const { s3Request, stsAssumeRole, parseXmlTag, parseXmlBlocks } = require('./s3-client')

const { generatePresignedUrl } = require('./sigv4')

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const logger = {
  info: (...args) => console.log('[S3 Storage Service] info:', ...args),
  debug: (...args) => console.log('[S3 Storage Service] debug:', ...args),
  error: (...args) => console.log('[S3 Storage Service] error:', ...args),
  warn: (...args) => console.log('[S3 Storage Service] warn:', ...args),
}

const EXPIRATION_PRESETS = {
  '15 minutes': 900,
  '1 hour': 3600,
  '24 hours': 86400,
  '7 days': 604800,
  '30 days': 2592000,
}

const PROVIDER_ENDPOINTS = {
  'Amazon S3': region => ({ endpoint: `https://s3.${ region }.amazonaws.com`, forcePathStyle: false }),
  'Cloudflare R2': (region, accountId) => ({ endpoint: `https://${ accountId }.r2.cloudflarestorage.com`, forcePathStyle: false }),
  'DigitalOcean Spaces': region => ({ endpoint: `https://${ region }.digitaloceanspaces.com`, forcePathStyle: false }),
  'Backblaze B2': region => ({ endpoint: `https://s3.${ region }.backblazeb2.com`, forcePathStyle: false }),
  'MinIO': (region, accountId, customEndpoint) => ({ endpoint: customEndpoint, forcePathStyle: true }),
  'Wasabi': region => ({ endpoint: `https://s3.${ region }.wasabisys.com`, forcePathStyle: false }),
  'Storj': () => ({ endpoint: 'https://gateway.storjshare.io', forcePathStyle: false }),
  'IDrive e2': (region, accountId) => ({ endpoint: `https://${ accountId }.idrivee2-2.com`, forcePathStyle: false }),
  'Linode': region => ({ endpoint: `https://${ region }.linodeobjects.com`, forcePathStyle: false }),
  'Vultr': region => ({ endpoint: `https://${ region }.vultrobjects.com`, forcePathStyle: false }),
  'Hetzner': region => ({ endpoint: `https://${ region }.your-objectstorage.com`, forcePathStyle: true }),
  'Scaleway': region => ({ endpoint: `https://s3.${ region }.scw.cloud`, forcePathStyle: false }),
  'DreamObjects': () => ({ endpoint: 'https://objects-us-east-1.dream.io', forcePathStyle: false }),
  'Custom': (region, accountId, customEndpoint) => ({ endpoint: customEndpoint, forcePathStyle: false }),
}

/**
 * @integrationName S3 Storage
 * @integrationIcon /icon.png
 */
class S3CompatibleStorage {
  constructor(config, context) {
    this.authenticationMethod = config.authenticationMethod || 'API Key'
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region || 'us-east-1'
    this.roleArn = config.roleArn
    this.externalId = config.externalId

    const provider = config.provider || 'Amazon S3'
    const providerConfig = PROVIDER_ENDPOINTS[provider]

    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${ provider }. Please select a valid provider in the service settings.`)
    }

    const { endpoint, forcePathStyle } = providerConfig(this.region, config.accountId, config.customEndpoint)

    this.endpoint = endpoint
    this.forcePathStyle = forcePathStyle

    this.stsCredentials = null
    this.stsCredentialsExpiry = null
    this.endpointHost = new URL(this.endpoint).host
  }

  #buildUrl(bucket, key) {
    if (!bucket) {
      return `${ this.endpoint }/`
    }

    if (this.forcePathStyle) {
      const path = key ? `/${ bucket }/${ key }` : `/${ bucket }/`

      return `${ this.endpoint }${ path }`
    }

    const path = key ? `/${ key }` : '/'

    return `https://${ bucket }.${ this.endpointHost }${ path }`
  }

  async #assumeRole() {
    if (this.stsCredentials && this.stsCredentialsExpiry && Date.now() < this.stsCredentialsExpiry - 300000) {
      return this.stsCredentials
    }

    if (!this.roleArn) {
      throw new Error('IAM Role ARN is required for IAM Role authentication. Please configure it in the service settings.')
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required for IAM Role authentication to call STS AssumeRole.')
    }

    logger.debug('[assumeRole] Assuming role:', this.roleArn)

    const result = await stsAssumeRole(
      { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
      this.region,
      this.roleArn,
      `flowrunner-s3-${ Date.now() }`,
      this.externalId
    )

    this.stsCredentials = {
      accessKeyId: result.accessKeyId,
      secretAccessKey: result.secretAccessKey,
      sessionToken: result.sessionToken,
    }

    this.stsCredentialsExpiry = result.expiration.getTime()

    logger.debug('[assumeRole] Role assumed successfully, credentials expire at:', new Date(this.stsCredentialsExpiry).toISOString())

    return this.stsCredentials
  }

  async #getCredentials() {
    if (this.authenticationMethod === 'IAM Role') {
      await this.#assumeRole()

      return this.stsCredentials
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required for API Key authentication. Please configure them in the service settings or switch to IAM Role authentication.')
    }

    return { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
  }

  #handleS3Error(methodName, error) {
    logger.error(`[${ methodName }] Error:`, error)

    if (error.name === 'AccessDeniedException') {
      throw new Error(`STS AssumeRole failed: ${ error.message }. Verify that the Access Key has permission to assume the specified IAM Role.`)
    }

    if (error.name === 'MalformedPolicyDocumentException') {
      throw new Error(`IAM policy error: ${ error.message }. Check the trust policy on the IAM Role.`)
    }

    if (error.name === 'InvalidAccessKeyId' || error.message?.includes('credentials')) {
      if (this.authenticationMethod === 'IAM Role') {
        throw new Error(`Invalid credentials: ${ error.message }. Verify Access Key, Secret Key, and IAM Role ARN in service settings.`)
      } else {
        throw new Error(`Invalid credentials: ${ error.message }. Please verify Access Key and Secret Key in service settings.`)
      }
    }

    if (error.name === 'NoSuchBucket') {
      throw new Error(`Bucket not found: ${ error.message }. Verify bucket name and region.`)
    }

    if (error.name === 'NoSuchKey') {
      throw new Error(`Object not found: ${ error.message }. The specified object does not exist in the bucket.`)
    }

    if (error.name === 'AccessDenied') {
      throw new Error(`Access denied: ${ error.message }. Verify bucket policies and IAM permissions.`)
    }

    if (error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou') {
      throw new Error(`Bucket already exists: ${ error.message }. Choose a different globally unique bucket name.`)
    }

    if (error.name === 'BucketNotEmpty') {
      throw new Error(`Bucket is not empty: ${ error.message }. Remove all objects from the bucket before deleting it.`)
    }

    if (
      error.message?.includes('network') ||
      error.message?.includes('endpoint') ||
      error.message?.includes('timed out') ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ETIMEDOUT'
    ) {
      throw new Error(`Connection failed: ${ error.message }. Verify endpoint URL and network connectivity.`)
    }

    throw new Error(`Operation failed: ${ error.message }`)
  }

  // ─── DICTIONARY ──────────────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Buckets Dictionary
   * @description Provides a searchable list of S3 buckets for dynamic parameter selection in dropdown fields.
   * @route POST /get-buckets-dictionary
   * @paramDef {"type":"getBucketsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering buckets."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-bucket","value":"my-bucket","note":"Created: 2024-01-15"}],"cursor":null}
   */
  async getBucketsDictionary(payload) {
    try {
      const { search } = payload || {}
      const credentials = await this.#getCredentials()
      const url = this.#buildUrl()

      const response = await s3Request('GET', url, {}, '', credentials, this.region)
      const bucketBlocks = parseXmlBlocks(response.body, 'Bucket')

      let buckets = bucketBlocks.map(block => ({
        Name: parseXmlTag(block, 'Name'),
        CreationDate: parseXmlTag(block, 'CreationDate'),
      }))

      if (search) {
        const searchLower = search.toLowerCase()

        buckets = buckets.filter(bucket => bucket.Name.toLowerCase().includes(searchLower))
      }

      const items = buckets.map(bucket => ({
        label: bucket.Name,
        value: bucket.Name,
        note: bucket.CreationDate ? `Created: ${ new Date(bucket.CreationDate).toISOString().split('T')[0] }` : '',
      }))

      return { items, cursor: null }
    } catch (error) {
      this.#handleS3Error('getBucketsDictionary', error)
    }
  }

  // ─── BUCKET MANAGEMENT ───────────────────────────────────────────────

  /**
   * @operationName List Buckets
   * @category Bucket Management
   * @description Lists all S3 buckets available in the configured account. Returns bucket names and creation dates. Useful for discovering available storage locations and verifying bucket existence.
   * @route POST /list-buckets
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @returns {Object}
   * @sampleResult {"buckets":[{"name":"my-bucket","creationDate":"2024-01-15T10:30:00.000Z"},{"name":"logs-bucket","creationDate":"2024-02-20T14:00:00.000Z"}]}
   */
  async listBuckets() {
    try {
      logger.debug('[listBuckets] Listing all buckets')

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl()

      const response = await s3Request('GET', url, {}, '', credentials, this.region)
      const bucketBlocks = parseXmlBlocks(response.body, 'Bucket')

      const buckets = bucketBlocks.map(block => ({
        name: parseXmlTag(block, 'Name'),
        creationDate: parseXmlTag(block, 'CreationDate') || null,
      }))

      logger.debug(`[listBuckets] Found ${ buckets.length } buckets`)

      return { buckets }
    } catch (error) {
      this.#handleS3Error('listBuckets', error)
    }
  }

  /**
   * @operationName Create Bucket
   * @category Bucket Management
   * @description Creates a new S3 bucket with the specified name. Bucket names must be globally unique across all AWS accounts, contain only lowercase letters, numbers, hyphens, and periods, and be between 3 and 63 characters long.
   * @route POST /create-bucket
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket Name","name":"bucketName","required":true,"description":"The name for the new bucket. Must be globally unique, lowercase, and between 3-63 characters."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucketName":"my-new-bucket"}
   */
  async createBucket(bucketName) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    try {
      logger.debug(`[createBucket] Creating bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName)

      let body = ''

      if (this.region !== 'us-east-1') {
        body = `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${ this.region }</LocationConstraint></CreateBucketConfiguration>`
      }

      await s3Request('PUT', url, {}, body, credentials, this.region)

      logger.info(`[createBucket] Bucket created successfully: ${ bucketName }`)

      return { success: true, bucketName }
    } catch (error) {
      this.#handleS3Error('createBucket', error)
    }
  }

  /**
   * @operationName Delete Bucket
   * @category Bucket Management
   * @description Deletes an existing S3 bucket. The bucket must be empty before it can be deleted. All objects and versions within the bucket must be removed first.
   * @route POST /delete-bucket
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to delete. The bucket must be empty."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucketName":"my-old-bucket"}
   */
  async deleteBucket(bucketName) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    try {
      logger.debug(`[deleteBucket] Deleting bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName)

      await s3Request('DELETE', url, {}, '', credentials, this.region)

      logger.info(`[deleteBucket] Bucket deleted successfully: ${ bucketName }`)

      return { success: true, bucketName }
    } catch (error) {
      this.#handleS3Error('deleteBucket', error)
    }
  }

  // ─── OBJECT MANAGEMENT ───────────────────────────────────────────────

  /**
   * @operationName List Objects
   * @category Object Management
   * @description Lists objects in an S3 bucket with optional prefix filtering and pagination. Returns object keys, sizes, last modified dates, and storage classes. Supports listing up to 1000 objects per request with continuation token for pagination.
   * @route POST /list-objects
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to list objects from."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","description":"Limits results to objects whose keys begin with the specified prefix. Use to navigate folder-like structures (e.g., 'images/' or 'documents/2024/')."}
   * @paramDef {"type":"String","label":"Delimiter","name":"delimiter","description":"Character used to group keys hierarchically. Use '/' to list only the current folder level without descending into subfolders."}
   * @paramDef {"type":"Number","label":"Max Keys","name":"maxKeys","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of objects to return per request, up to 1000. Defaults to 1000 if not specified."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","description":"Token from a previous response to retrieve the next page of results. Use for paginating through large buckets."}
   *
   * @returns {Object}
   * @sampleResult {"objects":[{"key":"documents/report.pdf","size":1048576,"lastModified":"2024-03-15T10:30:00.000Z","storageClass":"STANDARD"}],"commonPrefixes":["documents/images/"],"isTruncated":false,"nextContinuationToken":null}
   */
  async listObjects(bucketName, prefix, delimiter, maxKeys, continuationToken) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    try {
      logger.debug(`[listObjects] Listing objects in bucket: ${ bucketName }, prefix: ${ prefix || '(none)' }`)

      const credentials = await this.#getCredentials()
      const baseUrl = this.#buildUrl(bucketName)
      const params = new URLSearchParams()

      params.set('list-type', '2')

      if (prefix) {
        params.set('prefix', prefix)
      }

      if (delimiter) {
        params.set('delimiter', delimiter)
      }

      if (maxKeys) {
        params.set('max-keys', String(maxKeys))
      }

      if (continuationToken) {
        params.set('continuation-token', continuationToken)
      }

      const url = `${ baseUrl }?${ params.toString() }`
      const response = await s3Request('GET', url, {}, '', credentials, this.region)

      const contentBlocks = parseXmlBlocks(response.body, 'Contents')
      const objects = contentBlocks.map(block => ({
        key: parseXmlTag(block, 'Key'),
        size: parseInt(parseXmlTag(block, 'Size') || '0', 10),
        lastModified: parseXmlTag(block, 'LastModified') || null,
        storageClass: parseXmlTag(block, 'StorageClass') || 'STANDARD',
      }))

      const commonPrefixBlocks = parseXmlBlocks(response.body, 'CommonPrefixes')
      const commonPrefixes = commonPrefixBlocks.map(block => parseXmlTag(block, 'Prefix'))

      const isTruncated = parseXmlTag(response.body, 'IsTruncated') === 'true'
      const nextContinuationToken = parseXmlTag(response.body, 'NextContinuationToken') || null

      logger.debug(`[listObjects] Found ${ objects.length } objects, ${ commonPrefixes.length } common prefixes`)

      return {
        objects,
        commonPrefixes,
        isTruncated,
        nextContinuationToken,
      }
    } catch (error) {
      this.#handleS3Error('listObjects', error)
    }
  }

  /**
   * @operationName Upload Object
   * @category Object Management
   * @description Uploads text or JSON content directly to an S3 bucket as an object. Supports setting a custom content type and storage class. For uploading binary files from a URL, use the "Upload Object from URL" action instead.
   * @route POST /upload-object
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to upload the object to."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The full path and filename for the object in the bucket (e.g., 'documents/report.txt' or 'images/photo.jpg')."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text or JSON content to upload as the object body."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"The MIME type of the content (e.g., 'text/plain', 'application/json', 'text/csv'). Defaults to 'application/octet-stream' if not specified."}
   * @paramDef {"type":"String","label":"Storage Class","name":"storageClass","dictionary":"getStorageClassesDictionary","description":"The storage class for the object. Defaults to STANDARD. Use lower-cost classes for infrequently accessed data."}
   * @paramDef {"type":"Boolean","label":"Base64 Encoded","name":"isBase64","uiComponent":{"type":"TOGGLE"},"description":"Set to true if the content is a Base64-encoded string. The content will be decoded to binary before uploading. Use this for binary files such as PDFs, images, or archives."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucketName":"my-bucket","objectKey":"documents/report.txt","contentType":"text/plain"}
   */
  async uploadObject(bucketName, objectKey, content, contentType, storageClass, isBase64) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    if (objectKey.length > 1024) {
      throw new Error('Object key cannot exceed 1024 characters.')
    }

    try {
      logger.debug(`[uploadObject] Uploading object: ${ objectKey } to bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)
      const headers = {}

      if (contentType) {
        headers['content-type'] = contentType
      }

      if (storageClass) {
        headers['x-amz-storage-class'] = storageClass
      }

      const body = isBase64 ? Buffer.from(content, 'base64') : content

      await s3Request('PUT', url, headers, body, credentials, this.region)

      logger.info(`[uploadObject] Object uploaded successfully: ${ objectKey }`)

      return {
        success: true,
        bucketName,
        objectKey,
        contentType: contentType || 'application/octet-stream',
      }
    } catch (error) {
      this.#handleS3Error('uploadObject', error)
    }
  }

  /**
   * @operationName Upload Object from URL
   * @category Object Management
   * @description Downloads a file from a given URL and uploads it to an S3 bucket. Useful for transferring files from external sources directly into S3 without manual download steps.
   * @route POST /upload-object-from-url
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to upload the object to."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The full path and filename for the object in the bucket (e.g., 'backups/data.zip')."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"The URL to download the file from. Must be publicly accessible or accessible from the server."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"The MIME type of the file (e.g., 'image/png', 'application/pdf'). If not specified, defaults to 'application/octet-stream'."}
   * @paramDef {"type":"String","label":"Storage Class","name":"storageClass","dictionary":"getStorageClassesDictionary","description":"The storage class for the object. Defaults to STANDARD."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucketName":"my-bucket","objectKey":"backups/data.zip","contentType":"application/octet-stream"}
   */
  async uploadObjectFromUrl(bucketName, objectKey, sourceUrl, contentType, storageClass) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    if (objectKey.length > 1024) {
      throw new Error('Object key cannot exceed 1024 characters.')
    }

    if (!sourceUrl || !sourceUrl.trim()) {
      throw new Error('Source URL is required.')
    }

    try {
      logger.debug(`[uploadObjectFromUrl] Downloading from: ${ sourceUrl }`)

      const fileBuffer = await Flowrunner.Request.get(sourceUrl).setEncoding(null)

      logger.debug(`[uploadObjectFromUrl] Downloaded file, uploading to: ${ objectKey }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)
      const headers = {}

      if (contentType) {
        headers['content-type'] = contentType
      }

      if (storageClass) {
        headers['x-amz-storage-class'] = storageClass
      }

      await s3Request('PUT', url, headers, Buffer.from(fileBuffer), credentials, this.region)

      logger.info(`[uploadObjectFromUrl] Object uploaded successfully: ${ objectKey }`)

      return {
        success: true,
        bucketName,
        objectKey,
        contentType: contentType || 'application/octet-stream',
      }
    } catch (error) {
      this.#handleS3Error('uploadObjectFromUrl', error)
    }
  }

  /**
   * @operationName Get Presigned URL
   * @category Object Management
   * @description Generates a temporary presigned URL that provides time-limited access to a private S3 object. The URL can be shared with users or services that need temporary access without requiring AWS credentials. Supports both download (GET) and upload (PUT) operations.
   * @route POST /get-presigned-url
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The key (path) of the object to generate a presigned URL for."}
   * @paramDef {"type":"String","label":"Expires In","name":"expiresIn","uiComponent":{"type":"DROPDOWN","options":{"values":["15 minutes","1 hour","24 hours","7 days","30 days"]}},"description":"How long the presigned URL remains valid. Defaults to 1 hour if not specified."}
   * @paramDef {"type":"String","label":"Operation","name":"operation","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","PUT"]}},"description":"The operation the presigned URL allows. GET for downloading objects, PUT for uploading. Defaults to GET."}
   *
   * @returns {Object}
   * @sampleResult {"presignedUrl":"https://my-bucket.s3.amazonaws.com/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...","expiresIn":3600,"expiresInLabel":"1 hour","operation":"GET","objectKey":"documents/report.pdf"}
   */
  async getPresignedUrl(bucketName, objectKey, expiresIn, operation) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    try {
      logger.debug(`[getPresignedUrl] Generating presigned URL for: ${ objectKey } in bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)

      const expiresInLabel = expiresIn || '1 hour'
      const expiration = EXPIRATION_PRESETS[expiresInLabel] || 3600
      const op = (operation || 'GET').toUpperCase() === 'PUT' ? 'PUT' : 'GET'

      const presignedUrl = generatePresignedUrl(op, url, credentials, this.region, 's3', expiration)

      logger.debug(`[getPresignedUrl] Presigned URL generated for: ${ objectKey }`)

      return {
        presignedUrl,
        expiresIn: expiration,
        expiresInLabel,
        operation: op,
        objectKey,
      }
    } catch (error) {
      this.#handleS3Error('getPresignedUrl', error)
    }
  }

  /**
   * @operationName Delete Object
   * @category Object Management
   * @description Permanently deletes an object from an S3 bucket. This action cannot be undone unless versioning is enabled on the bucket. Use with caution as deleted objects cannot be recovered from non-versioned buckets.
   * @route POST /delete-object
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket containing the object to delete."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The key (path) of the object to delete from the bucket."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"bucketName":"my-bucket","objectKey":"documents/old-report.pdf"}
   */
  async deleteObject(bucketName, objectKey) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    try {
      logger.debug(`[deleteObject] Deleting object: ${ objectKey } from bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)

      await s3Request('DELETE', url, {}, '', credentials, this.region)

      logger.info(`[deleteObject] Object deleted successfully: ${ objectKey }`)

      return { success: true, bucketName, objectKey }
    } catch (error) {
      this.#handleS3Error('deleteObject', error)
    }
  }

  /**
   * @operationName Copy Object
   * @category Object Management
   * @description Copies an object from one location to another within the same bucket or across different buckets. The source object remains unchanged. Useful for creating backups, moving files between folders, or duplicating objects across buckets.
   * @route POST /copy-object
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Source Bucket","name":"sourceBucket","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket containing the source object."}
   * @paramDef {"type":"String","label":"Source Key","name":"sourceKey","required":true,"description":"The key (path) of the source object to copy."}
   * @paramDef {"type":"String","label":"Destination Bucket","name":"destinationBucket","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to copy the object to. Can be the same as the source bucket."}
   * @paramDef {"type":"String","label":"Destination Key","name":"destinationKey","required":true,"description":"The key (path) for the copied object in the destination bucket."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"sourceBucket":"source-bucket","sourceKey":"documents/report.pdf","destinationBucket":"backup-bucket","destinationKey":"backups/report-copy.pdf"}
   */
  async copyObject(sourceBucket, sourceKey, destinationBucket, destinationKey) {
    if (!sourceBucket || !sourceBucket.trim()) {
      throw new Error('Source bucket name is required.')
    }

    if (!sourceKey || !sourceKey.trim()) {
      throw new Error('Source object key is required.')
    }

    if (!destinationBucket || !destinationBucket.trim()) {
      throw new Error('Destination bucket name is required.')
    }

    if (!destinationKey || !destinationKey.trim()) {
      throw new Error('Destination object key is required.')
    }

    try {
      logger.debug(`[copyObject] Copying ${ sourceBucket }/${ sourceKey } to ${ destinationBucket }/${ destinationKey }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(destinationBucket, destinationKey)
      const encodedSourceKey = sourceKey.split('/').map(segment => encodeURIComponent(segment)).join('/')
      const headers = { 'x-amz-copy-source': `/${ sourceBucket }/${ encodedSourceKey }` }

      await s3Request('PUT', url, headers, '', credentials, this.region)

      logger.info(`[copyObject] Object copied successfully to ${ destinationBucket }/${ destinationKey }`)

      return {
        success: true,
        sourceBucket,
        sourceKey,
        destinationBucket,
        destinationKey,
      }
    } catch (error) {
      this.#handleS3Error('copyObject', error)
    }
  }

  /**
   * @operationName Get Object Metadata
   * @category Object Management
   * @description Retrieves metadata for an S3 object without downloading the object content. Returns information such as content type, content length, last modified date, ETag, and any custom metadata. Useful for checking if an object exists or inspecting its properties.
   * @route POST /get-object-metadata
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket containing the object."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The key (path) of the object to retrieve metadata for."}
   *
   * @returns {Object}
   * @sampleResult {"bucketName":"my-bucket","objectKey":"documents/report.pdf","contentType":"application/pdf","contentLength":1048576,"lastModified":"2024-03-15T10:30:00.000Z","eTag":"\"d41d8cd98f00b204e9800998ecf8427e\"","storageClass":"STANDARD","metadata":{}}
   */
  async getObjectMetadata(bucketName, objectKey) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    try {
      logger.debug(`[getObjectMetadata] Getting metadata for: ${ objectKey } in bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)

      const response = await s3Request('HEAD', url, {}, '', credentials, this.region)
      const h = response.headers
      const metadata = {}

      for (const key of Object.keys(h)) {
        if (key.startsWith('x-amz-meta-')) {
          metadata[key.slice(11)] = h[key]
        }
      }

      logger.debug(`[getObjectMetadata] Metadata retrieved for: ${ objectKey }`)

      return {
        bucketName,
        objectKey,
        contentType: h['content-type'] || null,
        contentLength: parseInt(h['content-length'] || '0', 10),
        lastModified: h['last-modified'] ? new Date(h['last-modified']).toISOString() : null,
        eTag: h['etag'] || null,
        storageClass: h['x-amz-storage-class'] || 'STANDARD',
        metadata,
      }
    } catch (error) {
      this.#handleS3Error('getObjectMetadata', error)
    }
  }

  /**
   * @operationName Delete Multiple Objects
   * @category Object Management
   * @description Deletes up to 1000 objects from an S3 bucket in a single API call. Provide object keys separated by commas or newlines. Returns detailed results showing which objects were successfully deleted and which failed. Much more efficient than deleting objects one at a time.
   * @route POST /delete-multiple-objects
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket containing the objects to delete."}
   * @paramDef {"type":"String","label":"Object Keys","name":"objectKeys","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The keys of the objects to delete, separated by commas or newlines. Up to 1000 keys per request (e.g., 'file1.txt, images/photo.jpg, docs/report.pdf')."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":[{"key":"file1.txt"},{"key":"images/photo.jpg"}],"failed":[],"totalDeleted":2,"totalFailed":0}
   */
  async deleteMultipleObjects(bucketName, objectKeys) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKeys || !objectKeys.trim()) {
      throw new Error('At least one object key is required.')
    }

    const keys = objectKeys
      .split(/[,\n]+/)
      .map(key => key.trim())
      .filter(key => key.length > 0)

    if (keys.length === 0) {
      throw new Error('At least one valid object key is required after parsing the input.')
    }

    if (keys.length > 1000) {
      throw new Error('Cannot delete more than 1000 objects in a single request.')
    }

    try {
      logger.debug(`[deleteMultipleObjects] Deleting ${ keys.length } objects from bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const xmlBody = '<Delete><Quiet>false</Quiet>' + keys.map(key => `<Object><Key>${ escapeXml(key) }</Key></Object>`).join('') + '</Delete>'
      const md5 = crypto.createHash('md5').update(xmlBody).digest('base64')
      const headers = { 'content-md5': md5, 'content-type': 'application/xml' }
      const url = `${ this.#buildUrl(bucketName) }?delete=`

      const response = await s3Request('POST', url, headers, xmlBody, credentials, this.region)

      const deletedBlocks = parseXmlBlocks(response.body, 'Deleted')
      const deleted = deletedBlocks.map(block => ({ key: parseXmlTag(block, 'Key') }))

      const errorBlocks = parseXmlBlocks(response.body, 'Error')
      const failed = errorBlocks.map(block => ({
        key: parseXmlTag(block, 'Key'),
        error: parseXmlTag(block, 'Message') || parseXmlTag(block, 'Code'),
      }))

      logger.info(`[deleteMultipleObjects] Deleted ${ deleted.length } objects, ${ failed.length } failed`)

      return {
        deleted,
        failed,
        totalDeleted: deleted.length,
        totalFailed: failed.length,
      }
    } catch (error) {
      this.#handleS3Error('deleteMultipleObjects', error)
    }
  }

  /**
   * @operationName Check Object Exists
   * @category Object Management
   * @description Checks whether an object exists in an S3 bucket without downloading its content. Returns existence status and the last modified timestamp if the object is found. More lightweight than retrieving full object metadata when you only need to verify existence.
   * @route POST /check-object-exists
   *
   * @appearanceColor #FF9900 #FFB84D
   *
   * @paramDef {"type":"String","label":"Bucket","name":"bucketName","required":true,"dictionary":"getBucketsDictionary","description":"The name of the bucket to check for the object."}
   * @paramDef {"type":"String","label":"Object Key","name":"objectKey","required":true,"description":"The key (path) of the object to check for existence."}
   *
   * @returns {Object}
   * @sampleResult {"exists":true,"lastModified":"2024-02-15T10:30:00.000Z"}
   */
  async checkObjectExists(bucketName, objectKey) {
    if (!bucketName || !bucketName.trim()) {
      throw new Error('Bucket name is required.')
    }

    if (!objectKey || !objectKey.trim()) {
      throw new Error('Object key is required.')
    }

    try {
      logger.debug(`[checkObjectExists] Checking existence of: ${ objectKey } in bucket: ${ bucketName }`)

      const credentials = await this.#getCredentials()
      const url = this.#buildUrl(bucketName, objectKey)

      const response = await s3Request('HEAD', url, {}, '', credentials, this.region)

      logger.debug(`[checkObjectExists] Object exists: ${ objectKey }`)

      return {
        exists: true,
        lastModified: response.headers['last-modified'] ? new Date(response.headers['last-modified']).toISOString() : null,
      }
    } catch (error) {
      if (error.statusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey') {
        logger.debug(`[checkObjectExists] Object does not exist: ${ objectKey }`)

        return { exists: false }
      }

      this.#handleS3Error('checkObjectExists', error)
    }
  }

  // ─── STORAGE CLASS DICTIONARY ───────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Storage Classes Dictionary
   * @description Provides a searchable list of S3 storage classes with descriptions to help select the appropriate storage tier for objects based on access frequency and cost requirements.
   * @route POST /get-storage-classes-dictionary
   * @paramDef {"type":"getStorageClassesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering storage classes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard","value":"STANDARD","note":"Default storage for frequently accessed data"}],"cursor":null}
   */
  async getStorageClassesDictionary(payload) {
    const { search } = payload || {}

    const storageClasses = [
      { label: 'Standard', value: 'STANDARD', note: 'Default storage for frequently accessed data' },
      { label: 'Intelligent-Tiering', value: 'INTELLIGENT_TIERING', note: 'Automatic cost optimization for changing access patterns' },
      { label: 'Standard-IA (Infrequent Access)', value: 'STANDARD_IA', note: 'Infrequent access, lower cost, retrieval fee applies' },
      { label: 'One Zone-IA', value: 'ONEZONE_IA', note: 'Infrequent access, single AZ, lowest cost IA option' },
      { label: 'Glacier Instant Retrieval', value: 'GLACIER_INSTANT_RETRIEVAL', note: 'Archive with millisecond access for rarely accessed data' },
      { label: 'Glacier Flexible Retrieval', value: 'GLACIER_FLEXIBLE_RETRIEVAL', note: 'Archive, retrieval in minutes to hours' },
      { label: 'Glacier Deep Archive', value: 'GLACIER_DEEP_ARCHIVE', note: 'Lowest cost archive, 12-48 hour retrieval' },
      { label: 'Reduced Redundancy (Deprecated)', value: 'REDUCED_REDUNDANCY', note: 'Reduced durability, not recommended for new data' },
    ]

    let items = storageClasses

    if (search) {
      const searchLower = search.toLowerCase()

      items = storageClasses.filter(item =>
        item.label.toLowerCase().includes(searchLower) ||
        item.value.toLowerCase().includes(searchLower) ||
        item.note.toLowerCase().includes(searchLower)
      )
    }

    return { items, cursor: null }
  }
}

// ─── TYPEDEFS ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} getBucketsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter buckets by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Not used for bucket listing as all buckets are returned at once."}
 */

/**
 * @typedef {Object} getStorageClassesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter storage classes by name, value, or description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used for storage class listing as all classes are returned at once."}
 */

Flowrunner.ServerCode.addService(S3CompatibleStorage, [
  {
    order: 0,
    name: 'authenticationMethod',
    displayName: 'Authentication Method',
    type: 'CHOICE',
    required: true,
    defaultValue: 'API Key',
    hint: "Choose how to authenticate with S3. 'API Key' uses credentials directly. 'IAM Role' uses STS AssumeRole with a Role ARN for cross-account access.",
    options: [
      'API Key',
      'IAM Role',
    ],
  },
  {
    order: 1,
    name: 'provider',
    displayName: 'Provider',
    type: 'CHOICE',
    required: true,
    hint: 'Select your S3-compatible storage provider',
    options: [
      'Amazon S3',
      'Cloudflare R2',
      'DigitalOcean Spaces',
      'Backblaze B2',
      'MinIO',
      'Wasabi',
      'Storj',
      'IDrive e2',
      'Linode',
      'Vultr',
      'Hetzner',
      'Scaleway',
      'DreamObjects',
      'Custom',
    ],
  },
  {
    order: 2,
    name: 'region',
    displayName: 'Region',
    type: 'STRING',
    required: true,
    defaultValue: 'us-east-1',
    hint: 'Region code. Examples: Amazon S3 (us-east-1, eu-west-1), DigitalOcean (nyc3, sfo3), Cloudflare R2 (auto), or any value for region-less providers.',
  },
  {
    order: 3,
    name: 'accountId',
    displayName: 'Account ID',
    type: 'STRING',
    required: false,
    hint: 'Required for Cloudflare R2 and IDrive e2. Your account identifier (e.g., abc12345 for R2).',
  },
  {
    order: 4,
    name: 'accessKeyId',
    displayName: 'Access Key',
    type: 'STRING',
    required: false,
    hint: 'Your S3-compatible access key ID. Required for both API Key and IAM Role authentication methods.',
  },
  {
    order: 5,
    name: 'secretAccessKey',
    displayName: 'Secret Key',
    type: 'STRING',
    required: false,
    hint: 'Your S3-compatible secret access key. Required for both API Key and IAM Role authentication methods.',
  },
  {
    order: 6,
    name: 'roleArn',
    displayName: 'IAM Role ARN',
    type: 'STRING',
    required: false,
    hint: 'The ARN of the IAM role to assume (e.g., arn:aws:iam::123456789012:role/MyRole). Required for IAM Role authentication.',
  },
  {
    order: 7,
    name: 'externalId',
    displayName: 'External ID',
    type: 'STRING',
    required: false,
    hint: 'Optional external ID for cross-account role assumption. Provides additional security for the trust relationship.',
  },
  {
    order: 8,
    name: 'customEndpoint',
    displayName: 'Custom Endpoint',
    type: 'STRING',
    required: false,
    hint: "Only used when Provider is set to 'Custom'. Enter full endpoint URL (e.g., https://s3.example.com)",
  },
])
