'use strict'

const crypto = require('node:crypto')
const { createSandbox } = require('../../../service-sandbox')

// A real 2048-bit RSA keypair so the service's genuine JWT/signature signing paths
// (crypto.createSign('RSA-SHA256').sign(private_key) for both the JWT-bearer token
// exchange and the V4 signed-URL signature) execute for real. Only the HTTP boundary
// (Google token endpoint + GCS JSON/upload API) is mocked; signing is not.
const { privateKey: PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'key-file-project',
  client_email: 'svc@key-file-project.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
}

const SERVICE_ACCOUNT_KEY = JSON.stringify(SERVICE_ACCOUNT)
const PROJECT_ID = 'test-project'

const STORAGE_BASE = 'https://storage.googleapis.com/storage/v1'
const UPLOAD_BASE = 'https://storage.googleapis.com/upload/storage/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ACCESS_TOKEN = 'ya29.test-access-token'

function stubToken(mock) {
  mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 3600 })
}

// GCS encodes the whole object name (so 'reports/2026/summary.pdf' -> 'reports%2F2026%2Fsummary.pdf').
function objectUrl(bucket, objectName) {
  return `${ STORAGE_BASE }/b/${ encodeURIComponent(bucket) }/o/${ encodeURIComponent(objectName) }`
}

// A representative raw bucket resource as returned by the GCS JSON API.
const RAW_BUCKET = {
  name: 'my-app-assets',
  location: 'US',
  locationType: 'multi-region',
  storageClass: 'STANDARD',
  timeCreated: '2026-01-15T10:00:00.000Z',
  updated: '2026-01-15T10:00:00.000Z',
  versioning: { enabled: true },
  labels: { env: 'prod' },
  selfLink: 'https://www.googleapis.com/storage/v1/b/my-app-assets',
}

const TRIMMED_BUCKET = {
  name: 'my-app-assets',
  location: 'US',
  locationType: 'multi-region',
  storageClass: 'STANDARD',
  timeCreated: '2026-01-15T10:00:00.000Z',
  updated: '2026-01-15T10:00:00.000Z',
  versioningEnabled: true,
  labels: { env: 'prod' },
  selfLink: 'https://www.googleapis.com/storage/v1/b/my-app-assets',
}

// A representative raw object resource as returned by the GCS JSON API.
const RAW_OBJECT = {
  name: 'reports/2026/summary.pdf',
  bucket: 'my-app-assets',
  size: '204800',
  contentType: 'application/pdf',
  storageClass: 'STANDARD',
  timeCreated: '2026-02-01T09:30:00.000Z',
  updated: '2026-02-01T09:30:00.000Z',
  generation: '1738402200000000',
  md5Hash: 'XrY7u+Ae7tCTyyK7j1rNww==',
  crc32c: 'AAAAAA==',
  etag: 'CJDs0uOr5/8CEAE=',
  cacheControl: 'public, max-age=3600',
  contentEncoding: null,
  metadata: { source: 'invoicing' },
  mediaLink: 'https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media',
}

const TRIMMED_OBJECT = {
  name: 'reports/2026/summary.pdf',
  bucket: 'my-app-assets',
  size: 204800,
  contentType: 'application/pdf',
  storageClass: 'STANDARD',
  timeCreated: '2026-02-01T09:30:00.000Z',
  updated: '2026-02-01T09:30:00.000Z',
  generation: '1738402200000000',
  md5Hash: 'XrY7u+Ae7tCTyyK7j1rNww==',
  crc32c: 'AAAAAA==',
  etag: 'CJDs0uOr5/8CEAE=',
  cacheControl: 'public, max-age=3600',
  contentEncoding: null,
  metadata: { source: 'invoicing' },
  mediaLink: 'https://storage.googleapis.com/download/storage/v1/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf?generation=1738402200000000&alt=media',
}

describe('Google Cloud Storage Service', () => {
  let sandbox
  let service
  let mock
  let mainFlowrunner

  // Build a service instance backed by its own config + mock, isolated from the
  // shared instance. The service module caches on first require and only calls
  // addService() once, so jest.isolateModules() gives the enclosed require() a fresh
  // registry to force re-registration against the isolated sandbox's global.Flowrunner.
  // The returned cleanup() restores the shared instance's global before other tests run.
  function createIsolatedService(config) {
    const isoSandbox = createSandbox(config)

    jest.isolateModules(() => {
      require('../src/index.js')
    })

    return {
      service: isoSandbox.getService(),
      mock: isoSandbox.getRequestMock(),
      cleanup() {
        isoSandbox.cleanup()
        global.Flowrunner = mainFlowrunner
      },
    }
  }

  beforeAll(async () => {
    sandbox = createSandbox({
      serviceAccountKey: SERVICE_ACCOUNT_KEY,
      projectId: PROJECT_ID,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    mainFlowrunner = global.Flowrunner

    // The service reads FlowRunner file storage via this.flowrunner.Files.* which is
    // injected by the FlowRunner runtime, not by the sandbox. Stub it so downloadObject
    // can be tested at the HTTP boundary.
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn(async () => ({ url: 'https://files.flowrunner.com/files/flow/summary.pdf' })),
      },
    }

    // Warm up: perform one request so the access token is signed and cached on the
    // shared service instance. After this, mock.history[0] in every test is the actual
    // GCS request (the token endpoint is not hit again for ~1h).
    stubToken(mock)
    mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })
    await service.listBuckets()
    mock.reset()
  })

  afterEach(() => {
    mock.reset()
    if (service.flowrunner) {
      service.flowrunner.Files.uploadFile.mockClear()
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'serviceAccountKey',
          displayName: 'Service Account Key (JSON)',
          required: true,
          shared: false,
          type: 'TEXT',
        }),
        expect.objectContaining({
          name: 'projectId',
          displayName: 'Project ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the bearer token and JSON content-type on requests', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await service.listBuckets()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Authentication / token exchange ──

  describe('access token exchange', () => {
    it('exchanges a signed JWT for an access token on the first request', async () => {
      // Isolated instance so the token is not yet cached and the token endpoint is hit.
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await iso.service.listBuckets()

      // First call is the JWT-bearer token exchange to Google.
      expect(iso.mock.history[0].method).toBe('post')
      expect(iso.mock.history[0].url).toBe(TOKEN_URL)
      expect(iso.mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(typeof iso.mock.history[0].body).toBe('string')
      expect(iso.mock.history[0].body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
      expect(iso.mock.history[0].body).toContain('assertion=')

      // Second call is the GCS request carrying the returned token.
      expect(iso.mock.history[1].url).toBe(`${ STORAGE_BASE }/b`)
      expect(iso.mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
      })

      iso.cleanup()
    })

    it('caches the access token across requests', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await iso.service.listBuckets()
      await iso.service.listBuckets()

      // Only one token exchange for two GCS requests (token endpoint hit once).
      const tokenCalls = iso.mock.history.filter(h => h.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      iso.cleanup()
    })

    it('throws a helpful error when the service account key is not valid JSON', async () => {
      const iso = createIsolatedService({ serviceAccountKey: 'not-json', projectId: PROJECT_ID })

      await expect(iso.service.listBuckets()).rejects.toThrow(
        'Service account key is not valid JSON'
      )

      iso.cleanup()
    })

    it('throws when the key is missing client_email or private_key', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: JSON.stringify({ project_id: 'x' }),
        projectId: PROJECT_ID,
      })

      await expect(iso.service.listBuckets()).rejects.toThrow(
        'is missing "client_email" or "private_key"'
      )

      iso.cleanup()
    })

    it('throws when the service account key is not configured', async () => {
      const iso = createIsolatedService({ projectId: PROJECT_ID })

      await expect(iso.service.listBuckets()).rejects.toThrow(
        'Service account key is not configured'
      )

      iso.cleanup()
    })

    it('recovers escaped newlines in the private key', async () => {
      // A key pasted with literal "\n" instead of real newlines should still sign.
      const escapedKey = JSON.stringify({
        ...SERVICE_ACCOUNT,
        private_key: PRIVATE_KEY.replace(/\n/g, '\\n'),
      })
      const iso = createIsolatedService({ serviceAccountKey: escapedKey, projectId: PROJECT_ID })

      stubToken(iso.mock)
      iso.mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await expect(iso.service.listBuckets()).resolves.toBeDefined()

      iso.cleanup()
    })

    it('surfaces token endpoint failures', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature' },
      })

      await expect(iso.service.listBuckets()).rejects.toThrow(
        'Failed to obtain an access token from Google: Invalid JWT Signature'
      )

      iso.cleanup()
    })

    it('throws when the token endpoint returns no access_token', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).reply({ token_type: 'Bearer' })
      iso.mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await expect(iso.service.listBuckets()).rejects.toThrow(
        'Google token endpoint did not return an access token'
      )

      iso.cleanup()
    })

    it('derives the project id from the key file when projectId config is empty', async () => {
      const iso = createIsolatedService({ serviceAccountKey: SERVICE_ACCOUNT_KEY })

      stubToken(iso.mock)
      iso.mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await iso.service.listBuckets()

      const gcsCall = iso.mock.history.find(h => h.url === `${ STORAGE_BASE }/b`)

      expect(gcsCall.query).toMatchObject({ project: SERVICE_ACCOUNT.project_id })
      iso.cleanup()
    })
  })

  // ── Buckets ──

  describe('listBuckets', () => {
    it('lists buckets with only the project query by default and trims them', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({
        items: [RAW_BUCKET, { name: 'raw-bucket' }],
        nextPageToken: 'page-2',
      })

      const result = await service.listBuckets()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b`)
      expect(mock.history[0].query).toEqual({ project: PROJECT_ID })
      expect(result).toEqual({
        buckets: [
          TRIMMED_BUCKET,
          {
            name: 'raw-bucket',
            location: null,
            locationType: null,
            storageClass: null,
            timeCreated: null,
            updated: null,
            versioningEnabled: false,
            labels: {},
            selfLink: null,
          },
        ],
        pageToken: 'page-2',
      })
    })

    it('passes prefix, maxResults and pageToken', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await service.listBuckets('assets-', 25, 'cursor-1')

      expect(mock.history[0].query).toEqual({
        project: PROJECT_ID,
        prefix: 'assets-',
        maxResults: 25,
        pageToken: 'cursor-1',
      })
    })

    it('defaults buckets and pageToken to empty values', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({})

      const result = await service.listBuckets()

      expect(result).toEqual({ buckets: [], pageToken: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Access Denied', errors: [{ reason: 'forbidden' }] } },
      })

      await expect(service.listBuckets()).rejects.toThrow(
        'Google Cloud Storage API error: Access Denied (reason: forbidden)'
      )
    })
  })

  describe('getBucket', () => {
    it('fetches and trims a single bucket', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets`).reply(RAW_BUCKET)

      const result = await service.getBucket('my-app-assets')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets`)
      expect(result).toEqual(TRIMMED_BUCKET)
    })

    it('url-encodes the bucket name', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/${ encodeURIComponent('bucket name') }`).reply(RAW_BUCKET)

      await service.getBucket('bucket name')

      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/bucket%20name`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/missing`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Not Found' } },
      })

      await expect(service.getBucket('missing')).rejects.toThrow(
        'Google Cloud Storage API error: Not Found'
      )
    })
  })

  describe('createBucket', () => {
    it('creates a bucket with only the name and project query', async () => {
      mock.onPost(`${ STORAGE_BASE }/b`).reply(RAW_BUCKET)

      const result = await service.createBucket('my-app-assets')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b`)
      expect(mock.history[0].query).toEqual({ project: PROJECT_ID })
      expect(mock.history[0].body).toEqual({ name: 'my-app-assets' })
      expect(result).toEqual(TRIMMED_BUCKET)
    })

    it('maps a friendly storage class and includes the location', async () => {
      mock.onPost(`${ STORAGE_BASE }/b`).reply(RAW_BUCKET)

      await service.createBucket('my-app-assets', 'EU', 'Nearline')

      expect(mock.history[0].body).toEqual({
        name: 'my-app-assets',
        location: 'EU',
        storageClass: 'NEARLINE',
      })
    })

    it('passes through an unknown storage class verbatim', async () => {
      mock.onPost(`${ STORAGE_BASE }/b`).reply(RAW_BUCKET)

      await service.createBucket('my-app-assets', undefined, 'CUSTOM')

      expect(mock.history[0].body).toEqual({ name: 'my-app-assets', storageClass: 'CUSTOM' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ STORAGE_BASE }/b`).replyWithError({
        message: 'Conflict',
        body: { error: { message: 'Already Exists', errors: [{ reason: 'conflict' }] } },
      })

      await expect(service.createBucket('taken-name')).rejects.toThrow(
        'Google Cloud Storage API error: Already Exists (reason: conflict)'
      )
    })
  })

  describe('deleteBucket', () => {
    it('deletes a bucket and returns success', async () => {
      mock.onDelete(`${ STORAGE_BASE }/b/my-app-assets`).reply(undefined)

      const result = await service.deleteBucket('my-app-assets')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets`)
      expect(result).toEqual({ success: true, bucket: 'my-app-assets' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ STORAGE_BASE }/b/my-app-assets`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Bucket not empty', errors: [{ reason: 'bucketNotEmpty' }] } },
      })

      await expect(service.deleteBucket('my-app-assets')).rejects.toThrow(
        'Google Cloud Storage API error: Bucket not empty (reason: bucketNotEmpty)'
      )
    })
  })

  // ── Objects ──

  describe('listObjects', () => {
    it('lists objects with no query by default and trims them', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets/o`).reply({
        items: [RAW_OBJECT],
        prefixes: ['reports/2026/archive/'],
        nextPageToken: 'obj-next',
      })

      const result = await service.listObjects('my-app-assets')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets/o`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({
        objects: [TRIMMED_OBJECT],
        prefixes: ['reports/2026/archive/'],
        pageToken: 'obj-next',
      })
    })

    it('passes prefix, delimiter, maxResults and pageToken', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets/o`).reply({ items: [] })

      await service.listObjects('my-app-assets', 'reports/', '/', 100, 'page-2')

      expect(mock.history[0].query).toEqual({
        prefix: 'reports/',
        delimiter: '/',
        maxResults: 100,
        pageToken: 'page-2',
      })
    })

    it('defaults objects, prefixes and pageToken', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets/o`).reply({})

      const result = await service.listObjects('my-app-assets')

      expect(result).toEqual({ objects: [], prefixes: [], pageToken: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/missing/o`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Bucket not found' } },
      })

      await expect(service.listObjects('missing')).rejects.toThrow(
        'Google Cloud Storage API error: Bucket not found'
      )
    })
  })

  describe('getObjectMetadata', () => {
    it('fetches object metadata with the object name encoded in the path', async () => {
      mock.onGet(objectUrl('my-app-assets', 'reports/2026/summary.pdf')).reply(RAW_OBJECT)

      const result = await service.getObjectMetadata('my-app-assets', 'reports/2026/summary.pdf')

      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf`)
      expect(result).toEqual(TRIMMED_OBJECT)
    })

    it('trims and defaults missing fields', async () => {
      mock.onGet(objectUrl('my-app-assets', 'a.txt')).reply({ name: 'a.txt', bucket: 'my-app-assets' })

      const result = await service.getObjectMetadata('my-app-assets', 'a.txt')

      expect(result).toMatchObject({
        name: 'a.txt',
        bucket: 'my-app-assets',
        size: null,
        contentType: null,
        metadata: {},
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(objectUrl('my-app-assets', 'missing.txt')).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No such object' } },
      })

      await expect(service.getObjectMetadata('my-app-assets', 'missing.txt')).rejects.toThrow(
        'Google Cloud Storage API error: No such object'
      )
    })
  })

  describe('downloadObject', () => {
    it('fetches metadata, downloads bytes with alt=media, and stores the file', async () => {
      const fileBytes = Buffer.from('PDF-CONTENT')

      mock.onGet(objectUrl('my-app-assets', 'reports/2026/summary.pdf')).replyWith((rec) => {
        // The metadata request sends no query; the binary download sends alt=media.
        return rec.query && rec.query.alt === 'media' ? fileBytes : RAW_OBJECT
      })

      const result = await service.downloadObject('my-app-assets', 'reports/2026/summary.pdf')

      // Two GCS requests: metadata (get) then binary media download (get, alt=media, setEncoding null).
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[1].query).toEqual({ alt: 'media' })
      expect(mock.history[1].encoding).toBeNull()
      expect(mock.history[1].headers).toMatchObject({ 'Authorization': `Bearer ${ ACCESS_TOKEN }` })

      // The bytes are handed to FlowRunner file storage with a default filename.
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)
      const [buffer, options] = service.flowrunner.Files.uploadFile.mock.calls[0]
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('PDF-CONTENT')
      expect(options).toMatchObject({ filename: 'summary.pdf', generateUrl: true, overwrite: true, scope: 'FLOW' })

      expect(result).toEqual({
        url: 'https://files.flowrunner.com/files/flow/summary.pdf',
        fileName: 'summary.pdf',
        size: fileBytes.length,
        contentType: 'application/pdf',
        bucket: 'my-app-assets',
        objectName: 'reports/2026/summary.pdf',
      })
    })

    it('honors fileOptions for scope and filename', async () => {
      const fileBytes = Buffer.from('DATA')

      mock.onGet(objectUrl('my-app-assets', 'a.txt')).replyWith((rec) => {
        return rec.query && rec.query.alt === 'media' ? fileBytes : { ...RAW_OBJECT, name: 'a.txt', contentType: 'text/plain' }
      })

      const result = await service.downloadObject('my-app-assets', 'a.txt', { scope: 'APP', filename: 'renamed.txt' })

      const [, options] = service.flowrunner.Files.uploadFile.mock.calls[0]
      expect(options).toMatchObject({ scope: 'APP', filename: 'renamed.txt' })
      expect(result.fileName).toBe('renamed.txt')
      expect(result.contentType).toBe('text/plain')
    })

    it('throws a wrapped error when the metadata lookup fails', async () => {
      mock.onGet(objectUrl('my-app-assets', 'missing.txt')).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No such object' } },
      })

      await expect(service.downloadObject('my-app-assets', 'missing.txt')).rejects.toThrow(
        'Google Cloud Storage API error: No such object'
      )
      expect(service.flowrunner.Files.uploadFile).not.toHaveBeenCalled()
    })
  })

  describe('uploadObject', () => {
    const SOURCE_URL = 'https://files.flowrunner.com/files/flow/source.pdf'

    it('fetches the source file and uploads it with an inferred content type', async () => {
      mock.onGet(SOURCE_URL).reply(Buffer.from('SOURCE-BYTES'))
      mock.onPost(`${ UPLOAD_BASE }/b/my-app-assets/o`).reply(RAW_OBJECT)

      const result = await service.uploadObject('my-app-assets', 'reports/2026/summary.pdf', SOURCE_URL)

      // First request fetches the source bytes as binary.
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(SOURCE_URL)
      expect(mock.history[0].encoding).toBeNull()

      // Second request uploads to the media upload endpoint.
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${ UPLOAD_BASE }/b/my-app-assets/o`)
      expect(mock.history[1].query).toEqual({ uploadType: 'media', name: 'reports/2026/summary.pdf' })
      expect(mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/pdf',
      })
      expect(Buffer.isBuffer(mock.history[1].body)).toBe(true)
      expect(mock.history[1].body.toString()).toBe('SOURCE-BYTES')

      expect(result).toEqual(TRIMMED_OBJECT)
    })

    it('uses an explicit content type when provided', async () => {
      mock.onGet(SOURCE_URL).reply(Buffer.from('X'))
      mock.onPost(`${ UPLOAD_BASE }/b/my-app-assets/o`).reply(RAW_OBJECT)

      await service.uploadObject('my-app-assets', 'data.bin', SOURCE_URL, 'application/custom')

      expect(mock.history[1].headers).toMatchObject({ 'Content-Type': 'application/custom' })
    })

    it('falls back to octet-stream for an unknown extension', async () => {
      mock.onGet(SOURCE_URL).reply(Buffer.from('X'))
      mock.onPost(`${ UPLOAD_BASE }/b/my-app-assets/o`).reply(RAW_OBJECT)

      await service.uploadObject('my-app-assets', 'file.unknownext', SOURCE_URL)

      expect(mock.history[1].headers).toMatchObject({ 'Content-Type': 'application/octet-stream' })
    })

    it('throws a clear error when the source file cannot be fetched', async () => {
      mock.onGet(SOURCE_URL).replyWithError({ message: 'Connection refused' })

      await expect(service.uploadObject('my-app-assets', 'a.pdf', SOURCE_URL)).rejects.toThrow(
        'Failed to fetch the source file from the provided URL: Connection refused'
      )
    })

    it('throws a wrapped error when the upload fails', async () => {
      mock.onGet(SOURCE_URL).reply(Buffer.from('X'))
      mock.onPost(`${ UPLOAD_BASE }/b/my-app-assets/o`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Permission denied', errors: [{ reason: 'forbidden' }] } },
      })

      await expect(service.uploadObject('my-app-assets', 'a.pdf', SOURCE_URL)).rejects.toThrow(
        'Google Cloud Storage API error: Permission denied (reason: forbidden)'
      )
    })
  })

  describe('deleteObject', () => {
    it('deletes an object and returns success', async () => {
      mock.onDelete(objectUrl('my-app-assets', 'reports/2026/summary.pdf')).reply(undefined)

      const result = await service.deleteObject('my-app-assets', 'reports/2026/summary.pdf')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf`)
      expect(result).toEqual({ success: true, bucket: 'my-app-assets', objectName: 'reports/2026/summary.pdf' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(objectUrl('my-app-assets', 'missing.txt')).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No such object' } },
      })

      await expect(service.deleteObject('my-app-assets', 'missing.txt')).rejects.toThrow(
        'Google Cloud Storage API error: No such object'
      )
    })
  })

  describe('copyObject', () => {
    it('posts to the copyTo endpoint with an empty body and trims the result', async () => {
      const url = `${ STORAGE_BASE }/b/my-app-assets/o/${ encodeURIComponent('reports/2026/summary.pdf') }` +
        `/copyTo/b/my-backup-bucket/o/${ encodeURIComponent('archive/2026/summary.pdf') }`

      mock.onPost(url).reply({ ...RAW_OBJECT, bucket: 'my-backup-bucket', name: 'archive/2026/summary.pdf' })

      const result = await service.copyObject(
        'my-app-assets',
        'reports/2026/summary.pdf',
        'my-backup-bucket',
        'archive/2026/summary.pdf'
      )

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({})
      expect(result).toMatchObject({ bucket: 'my-backup-bucket', name: 'archive/2026/summary.pdf' })
    })

    it('throws a wrapped error on API failure', async () => {
      const url = `${ STORAGE_BASE }/b/src/o/a/copyTo/b/dst/o/b`

      mock.onPost(url).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Source not found' } },
      })

      await expect(service.copyObject('src', 'a', 'dst', 'b')).rejects.toThrow(
        'Google Cloud Storage API error: Source not found'
      )
    })
  })

  describe('updateObjectMetadata', () => {
    it('patches only the provided mutable fields', async () => {
      mock.onPatch(objectUrl('my-app-assets', 'reports/2026/summary.pdf')).reply(RAW_OBJECT)

      const result = await service.updateObjectMetadata(
        'my-app-assets',
        'reports/2026/summary.pdf',
        'application/pdf',
        'public, max-age=3600',
        { source: 'invoicing' }
      )

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets/o/reports%2F2026%2Fsummary.pdf`)
      expect(mock.history[0].body).toEqual({
        contentType: 'application/pdf',
        cacheControl: 'public, max-age=3600',
        metadata: { source: 'invoicing' },
      })
      expect(result).toEqual(TRIMMED_OBJECT)
    })

    it('sends only the fields that are provided', async () => {
      mock.onPatch(objectUrl('my-app-assets', 'a.txt')).reply(RAW_OBJECT)

      await service.updateObjectMetadata('my-app-assets', 'a.txt', undefined, 'no-cache')

      expect(mock.history[0].body).toEqual({ cacheControl: 'no-cache' })
    })

    it('throws when no updatable field is provided', async () => {
      await expect(service.updateObjectMetadata('my-app-assets', 'a.txt')).rejects.toThrow(
        'Provide at least one of Content Type, Cache Control, or Custom Metadata to update'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(objectUrl('my-app-assets', 'a.txt')).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'No such object' } },
      })

      await expect(service.updateObjectMetadata('my-app-assets', 'a.txt', 'text/plain')).rejects.toThrow(
        'Google Cloud Storage API error: No such object'
      )
    })
  })

  // ── Signed URLs ──

  describe('generateSignedUrl', () => {
    it('generates a V4 signed GET url without making an HTTP request', async () => {
      const result = await service.generateSignedUrl('my-app-assets', 'reports/2026/summary.pdf')

      // No network call — the URL is signed locally with the private key.
      expect(mock.history).toHaveLength(0)
      expect(result.method).toBe('GET')
      expect(result.bucket).toBe('my-app-assets')
      expect(result.objectName).toBe('reports/2026/summary.pdf')
      expect(result.signedUrl).toContain('https://storage.googleapis.com/my-app-assets/reports/2026/summary.pdf?')
      expect(result.signedUrl).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256')
      expect(result.signedUrl).toContain(`X-Goog-Credential=${ encodeURIComponent(SERVICE_ACCOUNT.client_email) }`)
      expect(result.signedUrl).toContain('X-Goog-Expires=3600')
      expect(result.signedUrl).toContain('X-Goog-SignedHeaders=host')
      expect(result.signedUrl).toMatch(/X-Goog-Signature=[0-9a-f]+$/)
      expect(result.expiresAt).toBeDefined()
    })

    it('supports PUT and a custom expiration', async () => {
      const result = await service.generateSignedUrl('my-app-assets', 'upload.bin', 'put', 600)

      expect(result.method).toBe('PUT')
      expect(result.signedUrl).toContain('X-Goog-Expires=600')
    })

    it('rejects an invalid method', async () => {
      await expect(service.generateSignedUrl('my-app-assets', 'a.txt', 'DELETE')).rejects.toThrow(
        'Method must be GET or PUT'
      )
    })

    it('rejects an expiration above the 7-day maximum', async () => {
      await expect(service.generateSignedUrl('my-app-assets', 'a.txt', 'GET', 604801)).rejects.toThrow(
        'Expires In must be between 1 and 604800 seconds'
      )
    })

    it('rejects a non-positive expiration', async () => {
      await expect(service.generateSignedUrl('my-app-assets', 'a.txt', 'GET', 0)).rejects.toThrow(
        'Expires In must be between 1 and 604800 seconds'
      )
    })
  })

  // ── Dictionaries ──

  describe('getBucketsDictionary', () => {
    const bucketsResponse = {
      items: [
        { name: 'assets', location: 'US', storageClass: 'STANDARD' },
        { name: 'backups', location: 'EU', storageClass: 'NEARLINE' },
      ],
      nextPageToken: 'next-cursor',
    }

    it('maps buckets to items with a location/class note and returns the cursor', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply(bucketsResponse)

      const result = await service.getBucketsDictionary({})

      expect(mock.history[0].query).toMatchObject({ project: PROJECT_ID, maxResults: 1000 })
      expect(result).toEqual({
        items: [
          { label: 'assets', value: 'assets', note: 'US / STANDARD' },
          { label: 'backups', value: 'backups', note: 'EU / NEARLINE' },
        ],
        cursor: 'next-cursor',
      })
    })

    it('passes the search term as a prefix and the cursor as pageToken', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      await service.getBucketsDictionary({ search: 'ass', cursor: 'page-3' })

      expect(mock.history[0].query).toMatchObject({ prefix: 'ass', pageToken: 'page-3' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ STORAGE_BASE }/b`).reply({ items: [] })

      const result = await service.getBucketsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getObjectsDictionary', () => {
    const objectsResponse = {
      items: [
        { name: 'a.pdf', contentType: 'application/pdf', size: '100' },
        { name: 'b.txt', contentType: 'text/plain', size: '20' },
      ],
      nextPageToken: null,
    }

    it('returns empty items without a bucket criterion', async () => {
      const result = await service.getObjectsDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('lists objects for the chosen bucket criterion', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets/o`).reply(objectsResponse)

      const result = await service.getObjectsDictionary({ criteria: { bucket: 'my-app-assets' } })

      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/my-app-assets/o`)
      expect(mock.history[0].query).toMatchObject({ maxResults: 1000 })
      expect(result).toEqual({
        items: [
          { label: 'a.pdf', value: 'a.pdf', note: 'application/pdf, 100 bytes' },
          { label: 'b.txt', value: 'b.txt', note: 'text/plain, 20 bytes' },
        ],
        cursor: null,
      })
    })

    it('falls back to the sourceBucket criterion (Copy Object action)', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/src-bucket/o`).reply({ items: [] })

      await service.getObjectsDictionary({ criteria: { sourceBucket: 'src-bucket' } })

      expect(mock.history[0].url).toBe(`${ STORAGE_BASE }/b/src-bucket/o`)
    })

    it('passes the search term as a prefix and the cursor as pageToken', async () => {
      mock.onGet(`${ STORAGE_BASE }/b/my-app-assets/o`).reply({ items: [] })

      await service.getObjectsDictionary({
        search: 'reports/',
        cursor: 'page-2',
        criteria: { bucket: 'my-app-assets' },
      })

      expect(mock.history[0].query).toMatchObject({ prefix: 'reports/', pageToken: 'page-2' })
    })

    it('handles a null payload', async () => {
      const result = await service.getObjectsDictionary(null)

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })
  })
})
