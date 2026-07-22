'use strict'

const { createSandbox } = require('../../../service-sandbox')

// The S3 service talks to the network through src/s3-client.js (Node http/https + SigV4),
// not through Flowrunner.Request, so the client module is mocked here. The XML helpers stay
// real so response parsing is exercised for what it is. SigV4 itself is covered separately
// below against a frozen clock, which makes the signatures deterministic.
const mockS3Request = jest.fn()
const mockStsAssumeRole = jest.fn()

jest.mock('../src/s3-client', () => {
  const actual = jest.requireActual('../src/s3-client')

  return {
    ...actual,
    s3Request: (...args) => mockS3Request(...args),
    stsAssumeRole: (...args) => mockStsAssumeRole(...args),
  }
})

const ACCESS_KEY = 'AKIAEXAMPLE'
const SECRET_KEY = 'secret-key'
const REGION = 'us-east-1'
const BASE_CONFIG = {
  authenticationMethod: 'API Key',
  provider: 'Amazon S3',
  region: REGION,
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET_KEY,
}

const API_CREDENTIALS = { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }

function reply(body, headers) {
  return Promise.resolve({ statusCode: 200, headers: headers || {}, body: body === undefined ? '' : body })
}

function s3Error(name, message, statusCode) {
  const err = new Error(message)

  err.name = name
  err.statusCode = statusCode

  return err
}

const LIST_BUCKETS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Buckets>
    <Bucket><Name>my-bucket</Name><CreationDate>2024-01-15T10:30:00.000Z</CreationDate></Bucket>
    <Bucket><Name>logs-bucket</Name></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`

describe('S3 Storage Service', () => {
  let sandbox
  let service
  let mock
  let ServiceClass

  beforeAll(() => {
    sandbox = createSandbox({ ...BASE_CONFIG })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    ServiceClass = service.constructor
  })

  afterEach(() => {
    mock.reset()
    mockS3Request.mockReset()
    mockStsAssumeRole.mockReset()
    service.stsCredentials = null
    service.stsCredentialsExpiry = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'authenticationMethod',
        'provider',
        'region',
        'accountId',
        'accessKeyId',
        'secretAccessKey',
        'roleArn',
        'externalId',
        'customEndpoint',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, defaultValue: 'API Key' }),
          expect.objectContaining({ name: 'provider', type: 'CHOICE', required: true }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, defaultValue: 'us-east-1' }),
          expect.objectContaining({ name: 'accessKeyId', required: false }),
        ])
      )
    })

    it('resolves the Amazon S3 endpoint and defaults', () => {
      const svc = new ServiceClass({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY })

      expect(svc.authenticationMethod).toBe('API Key')
      expect(svc.region).toBe('us-east-1')
      expect(svc.endpoint).toBe('https://s3.us-east-1.amazonaws.com')
      expect(svc.forcePathStyle).toBe(false)
      expect(svc.endpointHost).toBe('s3.us-east-1.amazonaws.com')
    })

    it('throws for an unsupported provider', () => {
      expect(() => new ServiceClass({ ...BASE_CONFIG, provider: 'Nope' })).toThrow(/Unsupported provider: Nope/)
    })

    it.each([
      ['Cloudflare R2', { accountId: 'abc12345' }, 'https://abc12345.r2.cloudflarestorage.com', false],
      ['DigitalOcean Spaces', { region: 'nyc3' }, 'https://nyc3.digitaloceanspaces.com', false],
      ['Backblaze B2', { region: 'us-west-004' }, 'https://s3.us-west-004.backblazeb2.com', false],
      ['MinIO', { customEndpoint: 'https://minio.example.com' }, 'https://minio.example.com', true],
      ['Wasabi', { region: 'us-east-2' }, 'https://s3.us-east-2.wasabisys.com', false],
      ['Storj', {}, 'https://gateway.storjshare.io', false],
      ['IDrive e2', { accountId: 'z1' }, 'https://z1.idrivee2-2.com', false],
      ['Linode', { region: 'eu-central-1' }, 'https://eu-central-1.linodeobjects.com', false],
      ['Vultr', { region: 'ewr1' }, 'https://ewr1.vultrobjects.com', false],
      ['Hetzner', { region: 'fsn1' }, 'https://fsn1.your-objectstorage.com', true],
      ['Scaleway', { region: 'fr-par' }, 'https://s3.fr-par.scw.cloud', false],
      ['DreamObjects', {}, 'https://objects-us-east-1.dream.io', false],
      ['Custom', { customEndpoint: 'https://s3.example.com' }, 'https://s3.example.com', false],
    ])('resolves the %s endpoint', (provider, extra, endpoint, forcePathStyle) => {
      const svc = new ServiceClass({ ...BASE_CONFIG, provider, ...extra })

      expect(svc.endpoint).toBe(endpoint)
      expect(svc.forcePathStyle).toBe(forcePathStyle)
    })

    it('builds virtual-host-style URLs by default and path-style when forced', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      await service.deleteObject('my-bucket', 'docs/report.pdf')

      expect(mockS3Request.mock.calls[0][1]).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf')

      const pathStyle = new ServiceClass({ ...BASE_CONFIG, provider: 'MinIO', customEndpoint: 'https://minio.example.com' })

      await pathStyle.deleteObject('my-bucket', 'docs/report.pdf')

      expect(mockS3Request.mock.calls[1][1]).toBe('https://minio.example.com/my-bucket/docs/report.pdf')

      await pathStyle.deleteBucket('my-bucket')

      expect(mockS3Request.mock.calls[2][1]).toBe('https://minio.example.com/my-bucket/')
    })
  })

  // ── Credentials ──

  describe('credentials', () => {
    it('throws when API key credentials are missing', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, accessKeyId: undefined, secretAccessKey: undefined })

      await expect(svc.listBuckets()).rejects.toThrow(/Access Key and Secret Key are required for API Key authentication/)
      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it('assumes an IAM role and passes the temporary credentials to S3', async () => {
      const svc = new ServiceClass({
        ...BASE_CONFIG,
        authenticationMethod: 'IAM Role',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        externalId: 'ext-1',
      })

      mockStsAssumeRole.mockResolvedValue({
        accessKeyId: 'ASIATEMP',
        secretAccessKey: 'temp-secret',
        sessionToken: 'temp-token',
        expiration: new Date(Date.now() + 3600000),
      })

      mockS3Request.mockImplementation(() => reply(LIST_BUCKETS_XML))

      await svc.listBuckets()

      expect(mockStsAssumeRole).toHaveBeenCalledTimes(1)

      const [creds, region, roleArn, sessionName, externalId] = mockStsAssumeRole.mock.calls[0]

      expect(creds).toEqual(API_CREDENTIALS)
      expect(region).toBe(REGION)
      expect(roleArn).toBe('arn:aws:iam::123456789012:role/MyRole')
      expect(sessionName).toMatch(/^flowrunner-s3-\d+$/)
      expect(externalId).toBe('ext-1')

      expect(mockS3Request.mock.calls[0][4]).toEqual({
        accessKeyId: 'ASIATEMP',
        secretAccessKey: 'temp-secret',
        sessionToken: 'temp-token',
      })

      // Cached until close to expiry — a second call must not hit STS again.
      await svc.listBuckets()

      expect(mockStsAssumeRole).toHaveBeenCalledTimes(1)
    })

    it('re-assumes the role once the cached credentials are about to expire', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, authenticationMethod: 'IAM Role', roleArn: 'arn:role' })

      mockStsAssumeRole
        .mockResolvedValueOnce({
          accessKeyId: 'A1',
          secretAccessKey: 's1',
          sessionToken: 't1',
          expiration: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce({
          accessKeyId: 'A2',
          secretAccessKey: 's2',
          sessionToken: 't2',
          expiration: new Date(Date.now() + 3600000),
        })

      mockS3Request.mockImplementation(() => reply(LIST_BUCKETS_XML))

      await svc.listBuckets()
      await svc.listBuckets()

      expect(mockStsAssumeRole).toHaveBeenCalledTimes(2)
      expect(mockS3Request.mock.calls[1][4].accessKeyId).toBe('A2')
    })

    it('throws when the IAM role ARN is missing', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, authenticationMethod: 'IAM Role' })

      await expect(svc.listBuckets()).rejects.toThrow(/IAM Role ARN is required/)
    })

    it('throws when IAM role authentication has no access keys to call STS with', async () => {
      const svc = new ServiceClass({
        ...BASE_CONFIG,
        authenticationMethod: 'IAM Role',
        roleArn: 'arn:role',
        accessKeyId: undefined,
        secretAccessKey: undefined,
      })

      await expect(svc.listBuckets()).rejects.toThrow(/Access Key and Secret Key are required for IAM Role authentication/)
    })
  })

  // ── Buckets ──

  describe('listBuckets', () => {
    it('signs a GET against the service root and parses the bucket list', async () => {
      mockS3Request.mockImplementation(() => reply(LIST_BUCKETS_XML))

      const result = await service.listBuckets()

      expect(result).toEqual({
        buckets: [
          { name: 'my-bucket', creationDate: '2024-01-15T10:30:00.000Z' },
          { name: 'logs-bucket', creationDate: null },
        ],
      })

      expect(mockS3Request).toHaveBeenCalledWith('GET', 'https://s3.us-east-1.amazonaws.com/', {}, '', API_CREDENTIALS, REGION)
    })

    it('returns an empty list when there are no buckets', async () => {
      mockS3Request.mockImplementation(() => reply('<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>'))

      await expect(service.listBuckets()).resolves.toEqual({ buckets: [] })
    })
  })

  describe('createBucket', () => {
    it('requires a bucket name', async () => {
      await expect(service.createBucket('')).rejects.toThrow('Bucket name is required.')
      await expect(service.createBucket('   ')).rejects.toThrow('Bucket name is required.')
      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it('sends an empty body for us-east-1', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      await expect(service.createBucket('my-new-bucket')).resolves.toEqual({ success: true, bucketName: 'my-new-bucket' })

      expect(mockS3Request).toHaveBeenCalledWith(
        'PUT',
        'https://my-new-bucket.s3.us-east-1.amazonaws.com/',
        {},
        '',
        API_CREDENTIALS,
        REGION
      )
    })

    it('sends a LocationConstraint body outside us-east-1', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, region: 'eu-west-1' })

      mockS3Request.mockImplementation(() => reply(''))

      await svc.createBucket('my-eu-bucket')

      expect(mockS3Request.mock.calls[0][3]).toBe(
        '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>eu-west-1</LocationConstraint></CreateBucketConfiguration>'
      )
    })
  })

  describe('deleteBucket', () => {
    it('requires a bucket name', async () => {
      await expect(service.deleteBucket()).rejects.toThrow('Bucket name is required.')
    })

    it('sends a DELETE for the bucket root', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      await expect(service.deleteBucket('my-old-bucket')).resolves.toEqual({ success: true, bucketName: 'my-old-bucket' })

      expect(mockS3Request).toHaveBeenCalledWith(
        'DELETE',
        'https://my-old-bucket.s3.us-east-1.amazonaws.com/',
        {},
        '',
        API_CREDENTIALS,
        REGION
      )
    })
  })

  // ── Objects ──

  describe('listObjects', () => {
    const LIST_XML = `<ListBucketResult>
      <Contents><Key>documents/report.pdf</Key><Size>1048576</Size><LastModified>2024-03-15T10:30:00.000Z</LastModified><StorageClass>STANDARD_IA</StorageClass></Contents>
      <Contents><Key>documents/notes.txt</Key></Contents>
      <CommonPrefixes><Prefix>documents/images/</Prefix></CommonPrefixes>
      <IsTruncated>true</IsTruncated>
      <NextContinuationToken>tok-2</NextContinuationToken>
    </ListBucketResult>`

    it('requires a bucket name', async () => {
      await expect(service.listObjects('')).rejects.toThrow('Bucket name is required.')
    })

    it('sends list-type=2 only when no options are provided', async () => {
      mockS3Request.mockImplementation(() => reply('<ListBucketResult></ListBucketResult>'))

      const result = await service.listObjects('my-bucket')

      expect(result).toEqual({ objects: [], commonPrefixes: [], isTruncated: false, nextContinuationToken: null })
      expect(mockS3Request.mock.calls[0][1]).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/?list-type=2')
    })

    it('passes prefix, delimiter, max-keys and continuation-token', async () => {
      mockS3Request.mockImplementation(() => reply(LIST_XML))

      const result = await service.listObjects('my-bucket', 'documents/', '/', 100, 'tok-1')

      expect(mockS3Request.mock.calls[0][1]).toBe(
        'https://my-bucket.s3.us-east-1.amazonaws.com/?list-type=2&prefix=documents%2F&delimiter=%2F&max-keys=100&continuation-token=tok-1'
      )

      expect(result).toEqual({
        objects: [
          { key: 'documents/report.pdf', size: 1048576, lastModified: '2024-03-15T10:30:00.000Z', storageClass: 'STANDARD_IA' },
          { key: 'documents/notes.txt', size: 0, lastModified: null, storageClass: 'STANDARD' },
        ],
        commonPrefixes: ['documents/images/'],
        isTruncated: true,
        nextContinuationToken: 'tok-2',
      })
    })
  })

  describe('uploadObject', () => {
    it('validates the bucket, key and key length', async () => {
      await expect(service.uploadObject('', 'k', 'c')).rejects.toThrow('Bucket name is required.')
      await expect(service.uploadObject('b', '  ', 'c')).rejects.toThrow('Object key is required.')
      await expect(service.uploadObject('b', 'x'.repeat(1025), 'c')).rejects.toThrow('Object key cannot exceed 1024 characters.')
      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it('uploads text content with content type and storage class headers', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      const result = await service.uploadObject('my-bucket', 'documents/report.txt', 'hello', 'text/plain', 'STANDARD_IA')

      expect(result).toEqual({
        success: true,
        bucketName: 'my-bucket',
        objectKey: 'documents/report.txt',
        contentType: 'text/plain',
      })

      expect(mockS3Request).toHaveBeenCalledWith(
        'PUT',
        'https://my-bucket.s3.us-east-1.amazonaws.com/documents/report.txt',
        { 'content-type': 'text/plain', 'x-amz-storage-class': 'STANDARD_IA' },
        'hello',
        API_CREDENTIALS,
        REGION
      )
    })

    it('defaults the reported content type and omits optional headers', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      const result = await service.uploadObject('my-bucket', 'a.txt', 'hello')

      expect(result.contentType).toBe('application/octet-stream')
      expect(mockS3Request.mock.calls[0][2]).toEqual({})
    })

    it('decodes base64 content into a buffer', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      await service.uploadObject('my-bucket', 'a.bin', Buffer.from('hello').toString('base64'), undefined, undefined, true)

      const body = mockS3Request.mock.calls[0][3]

      expect(Buffer.isBuffer(body)).toBe(true)
      expect(body.toString()).toBe('hello')
    })
  })

  describe('uploadObjectFromUrl', () => {
    it('validates its inputs', async () => {
      await expect(service.uploadObjectFromUrl('', 'k', 'https://x')).rejects.toThrow('Bucket name is required.')
      await expect(service.uploadObjectFromUrl('b', '', 'https://x')).rejects.toThrow('Object key is required.')
      await expect(service.uploadObjectFromUrl('b', 'x'.repeat(1025), 'https://x')).rejects.toThrow('Object key cannot exceed 1024 characters.')
      await expect(service.uploadObjectFromUrl('b', 'k', '  ')).rejects.toThrow('Source URL is required.')
    })

    it('downloads the source as binary and uploads the buffer', async () => {
      mock.onGet('https://files.example.com/data.zip').reply(Buffer.from('zip-bytes'))
      mockS3Request.mockImplementation(() => reply(''))

      const result = await service.uploadObjectFromUrl(
        'my-bucket',
        'backups/data.zip',
        'https://files.example.com/data.zip',
        'application/zip',
        'GLACIER_INSTANT_RETRIEVAL'
      )

      expect(result).toEqual({
        success: true,
        bucketName: 'my-bucket',
        objectKey: 'backups/data.zip',
        contentType: 'application/zip',
      })

      expect(mock.history[0].encoding).toBeNull()

      expect(mockS3Request.mock.calls[0][2]).toEqual({
        'content-type': 'application/zip',
        'x-amz-storage-class': 'GLACIER_INSTANT_RETRIEVAL',
      })

      expect(mockS3Request.mock.calls[0][3].toString()).toBe('zip-bytes')
    })

    it('surfaces a download failure through the error handler', async () => {
      mock.onGet('https://files.example.com/missing.zip').replyWithError({ message: 'Not Found' })

      await expect(
        service.uploadObjectFromUrl('my-bucket', 'a.zip', 'https://files.example.com/missing.zip')
      ).rejects.toThrow('Operation failed: Not Found')

      expect(mockS3Request).not.toHaveBeenCalled()
    })
  })

  describe('deleteObject', () => {
    it('validates its inputs', async () => {
      await expect(service.deleteObject('', 'k')).rejects.toThrow('Bucket name is required.')
      await expect(service.deleteObject('b', '')).rejects.toThrow('Object key is required.')
    })

    it('deletes the object', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      await expect(service.deleteObject('my-bucket', 'docs/old.pdf')).resolves.toEqual({
        success: true,
        bucketName: 'my-bucket',
        objectKey: 'docs/old.pdf',
      })

      expect(mockS3Request.mock.calls[0][0]).toBe('DELETE')
    })
  })

  describe('copyObject', () => {
    it('validates every argument', async () => {
      await expect(service.copyObject('', 'k', 'b2', 'k2')).rejects.toThrow('Source bucket name is required.')
      await expect(service.copyObject('b', '', 'b2', 'k2')).rejects.toThrow('Source object key is required.')
      await expect(service.copyObject('b', 'k', '', 'k2')).rejects.toThrow('Destination bucket name is required.')
      await expect(service.copyObject('b', 'k', 'b2', '')).rejects.toThrow('Destination object key is required.')
    })

    it('sends a PUT with an encoded copy-source header', async () => {
      mockS3Request.mockImplementation(() => reply(''))

      const result = await service.copyObject('source-bucket', 'documents/my report.pdf', 'backup-bucket', 'backups/report-copy.pdf')

      expect(result).toEqual({
        success: true,
        sourceBucket: 'source-bucket',
        sourceKey: 'documents/my report.pdf',
        destinationBucket: 'backup-bucket',
        destinationKey: 'backups/report-copy.pdf',
      })

      expect(mockS3Request).toHaveBeenCalledWith(
        'PUT',
        'https://backup-bucket.s3.us-east-1.amazonaws.com/backups/report-copy.pdf',
        { 'x-amz-copy-source': '/source-bucket/documents/my%20report.pdf' },
        '',
        API_CREDENTIALS,
        REGION
      )
    })
  })

  describe('getObjectMetadata', () => {
    it('validates its inputs', async () => {
      await expect(service.getObjectMetadata('', 'k')).rejects.toThrow('Bucket name is required.')
      await expect(service.getObjectMetadata('b', '')).rejects.toThrow('Object key is required.')
    })

    it('maps HEAD response headers, including custom metadata', async () => {
      mockS3Request.mockImplementation(() =>
        reply('', {
          'content-type': 'application/pdf',
          'content-length': '1048576',
          'last-modified': 'Fri, 15 Mar 2024 10:30:00 GMT',
          etag: '"d41d8cd98f00b204e9800998ecf8427e"',
          'x-amz-storage-class': 'GLACIER',
          'x-amz-meta-owner': 'jane',
        })
      )

      const result = await service.getObjectMetadata('my-bucket', 'documents/report.pdf')

      expect(result).toEqual({
        bucketName: 'my-bucket',
        objectKey: 'documents/report.pdf',
        contentType: 'application/pdf',
        contentLength: 1048576,
        lastModified: '2024-03-15T10:30:00.000Z',
        eTag: '"d41d8cd98f00b204e9800998ecf8427e"',
        storageClass: 'GLACIER',
        metadata: { owner: 'jane' },
      })

      expect(mockS3Request.mock.calls[0][0]).toBe('HEAD')
    })

    it('falls back to defaults when the headers are absent', async () => {
      mockS3Request.mockImplementation(() => reply('', {}))

      const result = await service.getObjectMetadata('my-bucket', 'a.txt')

      expect(result).toMatchObject({
        contentType: null,
        contentLength: 0,
        lastModified: null,
        eTag: null,
        storageClass: 'STANDARD',
        metadata: {},
      })
    })
  })

  describe('deleteMultipleObjects', () => {
    it('validates the bucket and key list', async () => {
      await expect(service.deleteMultipleObjects('', 'a.txt')).rejects.toThrow('Bucket name is required.')
      await expect(service.deleteMultipleObjects('b', '   ')).rejects.toThrow('At least one object key is required.')
      await expect(service.deleteMultipleObjects('b', ',,\n,')).rejects.toThrow('At least one valid object key is required after parsing the input.')

      const tooMany = Array.from({ length: 1001 }, (_, i) => `k${ i }.txt`).join(',')

      await expect(service.deleteMultipleObjects('b', tooMany)).rejects.toThrow('Cannot delete more than 1000 objects in a single request.')
      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it('builds an escaped XML delete payload with a content-md5 header', async () => {
      mockS3Request.mockImplementation(() =>
        reply(`<DeleteResult>
          <Deleted><Key>file1.txt</Key></Deleted>
          <Deleted><Key>images/photo.jpg</Key></Deleted>
          <Error><Key>locked.txt</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>
        </DeleteResult>`)
      )

      const result = await service.deleteMultipleObjects('my-bucket', 'file1.txt, images/photo.jpg\na&b.txt')

      expect(result).toEqual({
        deleted: [{ key: 'file1.txt' }, { key: 'images/photo.jpg' }],
        failed: [{ key: 'locked.txt', error: 'Access Denied' }],
        totalDeleted: 2,
        totalFailed: 1,
      })

      const [method, url, headers, body] = mockS3Request.mock.calls[0]

      expect(method).toBe('POST')
      expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/?delete=')
      expect(headers['content-type']).toBe('application/xml')
      expect(headers['content-md5']).toEqual(expect.any(String))

      expect(body).toBe(
        '<Delete><Quiet>false</Quiet>' +
          '<Object><Key>file1.txt</Key></Object>' +
          '<Object><Key>images/photo.jpg</Key></Object>' +
          '<Object><Key>a&amp;b.txt</Key></Object>' +
          '</Delete>'
      )
    })

    it('falls back to the error code when a failure has no message', async () => {
      mockS3Request.mockImplementation(() =>
        reply('<DeleteResult><Error><Key>k</Key><Code>InternalError</Code></Error></DeleteResult>')
      )

      const result = await service.deleteMultipleObjects('my-bucket', 'k')

      expect(result.failed).toEqual([{ key: 'k', error: 'InternalError' }])
      expect(result.totalDeleted).toBe(0)
    })
  })

  describe('checkObjectExists', () => {
    it('validates its inputs', async () => {
      await expect(service.checkObjectExists('', 'k')).rejects.toThrow('Bucket name is required.')
      await expect(service.checkObjectExists('b', '')).rejects.toThrow('Object key is required.')
    })

    it('returns the last modified timestamp when the object exists', async () => {
      mockS3Request.mockImplementation(() => reply('', { 'last-modified': 'Thu, 15 Feb 2024 10:30:00 GMT' }))

      await expect(service.checkObjectExists('my-bucket', 'a.txt')).resolves.toEqual({
        exists: true,
        lastModified: '2024-02-15T10:30:00.000Z',
      })
    })

    it('returns exists:true with a null timestamp when the header is missing', async () => {
      mockS3Request.mockImplementation(() => reply('', {}))

      await expect(service.checkObjectExists('my-bucket', 'a.txt')).resolves.toEqual({ exists: true, lastModified: null })
    })

    it.each([
      ['a 404 status', s3Error('S3Error', 'Not Found', 404)],
      ['a NotFound code', s3Error('NotFound', 'Not Found')],
      ['a NoSuchKey code', s3Error('NoSuchKey', 'The specified key does not exist.')],
    ])('returns exists:false for %s', async (_label, error) => {
      mockS3Request.mockRejectedValue(error)

      await expect(service.checkObjectExists('my-bucket', 'missing.txt')).resolves.toEqual({ exists: false })
    })

    it('rethrows other errors', async () => {
      mockS3Request.mockRejectedValue(s3Error('AccessDenied', 'Forbidden', 403))

      await expect(service.checkObjectExists('my-bucket', 'a.txt')).rejects.toThrow(/Access denied: Forbidden/)
    })
  })

  // ── Error mapping ──

  describe('error handling', () => {
    it.each([
      ['AccessDeniedException', 'STS AssumeRole failed: boom'],
      ['MalformedPolicyDocumentException', 'IAM policy error: boom'],
      ['InvalidAccessKeyId', 'Invalid credentials: boom'],
      ['NoSuchBucket', 'Bucket not found: boom'],
      ['NoSuchKey', 'Object not found: boom'],
      ['AccessDenied', 'Access denied: boom'],
      ['BucketAlreadyExists', 'Bucket already exists: boom'],
      ['BucketAlreadyOwnedByYou', 'Bucket already exists: boom'],
      ['BucketNotEmpty', 'Bucket is not empty: boom'],
      ['SomethingElse', 'Operation failed: boom'],
    ])('maps the %s error name', async (name, expected) => {
      mockS3Request.mockRejectedValue(s3Error(name, 'boom'))

      await expect(service.listBuckets()).rejects.toThrow(expected)
    })

    it('mentions the role settings for credential errors under IAM Role auth', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, authenticationMethod: 'IAM Role', roleArn: 'arn:role' })

      mockStsAssumeRole.mockResolvedValue({
        accessKeyId: 'A',
        secretAccessKey: 'S',
        sessionToken: 'T',
        expiration: new Date(Date.now() + 3600000),
      })

      mockS3Request.mockRejectedValue(new Error('invalid credentials supplied'))

      await expect(svc.listBuckets()).rejects.toThrow(/Verify Access Key, Secret Key, and IAM Role ARN/)
    })

    it('maps credential errors detected by message under API key auth', async () => {
      mockS3Request.mockRejectedValue(new Error('missing credentials'))

      await expect(service.listBuckets()).rejects.toThrow(/Invalid credentials: missing credentials\. Please verify Access Key and Secret Key/)
    })

    it.each([
      ['message', Object.assign(new Error('endpoint unreachable'), {})],
      ['ECONNREFUSED', Object.assign(new Error('down'), { code: 'ECONNREFUSED' })],
      ['ENOTFOUND', Object.assign(new Error('down'), { code: 'ENOTFOUND' })],
      ['ETIMEDOUT', Object.assign(new Error('down'), { code: 'ETIMEDOUT' })],
    ])('maps connection failures detected via %s', async (_label, error) => {
      mockS3Request.mockRejectedValue(error)

      await expect(service.listBuckets()).rejects.toThrow(/Connection failed:/)
    })
  })

  // ── Dictionaries ──

  describe('getBucketsDictionary', () => {
    it('maps buckets to dictionary items with a creation note', async () => {
      mockS3Request.mockImplementation(() => reply(LIST_BUCKETS_XML))

      await expect(service.getBucketsDictionary({})).resolves.toEqual({
        items: [
          { label: 'my-bucket', value: 'my-bucket', note: 'Created: 2024-01-15' },
          { label: 'logs-bucket', value: 'logs-bucket', note: '' },
        ],
        cursor: null,
      })
    })

    it('filters buckets case-insensitively and accepts a null payload', async () => {
      mockS3Request.mockImplementation(() => reply(LIST_BUCKETS_XML))

      const filtered = await service.getBucketsDictionary({ search: 'LOGS' })

      expect(filtered.items).toEqual([{ label: 'logs-bucket', value: 'logs-bucket', note: '' }])

      const all = await service.getBucketsDictionary(null)

      expect(all.items).toHaveLength(2)
    })

    it('surfaces API failures', async () => {
      mockS3Request.mockRejectedValue(s3Error('AccessDenied', 'nope'))

      await expect(service.getBucketsDictionary({})).rejects.toThrow(/Access denied: nope/)
    })
  })

  describe('getStorageClassesDictionary', () => {
    it('returns every storage class', async () => {
      const result = await service.getStorageClassesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(8)

      expect(result.items[0]).toEqual({
        label: 'Standard',
        value: 'STANDARD',
        note: 'Default storage for frequently accessed data',
      })

      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it('filters by label, value or note and handles a missing payload', async () => {
      await expect(service.getStorageClassesDictionary({ search: 'deep archive' })).resolves.toMatchObject({
        items: [expect.objectContaining({ value: 'GLACIER_DEEP_ARCHIVE' })],
      })

      await expect(service.getStorageClassesDictionary({ search: 'ONEZONE' })).resolves.toMatchObject({
        items: [expect.objectContaining({ value: 'ONEZONE_IA' })],
      })

      const byNote = await service.getStorageClassesDictionary({ search: 'millisecond' })

      expect(byNote.items).toEqual([expect.objectContaining({ value: 'GLACIER_INSTANT_RETRIEVAL' })])

      await expect(service.getStorageClassesDictionary()).resolves.toMatchObject({ items: expect.any(Array) })
    })
  })

  // ── Presigned URLs (deterministic clock) ──

  describe('getPresignedUrl', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-03-15T12:34:56.000Z') })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('validates its inputs', async () => {
      await expect(service.getPresignedUrl('', 'k')).rejects.toThrow('Bucket name is required.')
      await expect(service.getPresignedUrl('b', '')).rejects.toThrow('Object key is required.')
    })

    it('produces a stable SigV4 query-string URL', async () => {
      const result = await service.getPresignedUrl('my-bucket', 'docs/report.pdf')

      expect(result).toEqual({
        presignedUrl:
          'https://my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf' +
          '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
          '&X-Amz-Credential=AKIAEXAMPLE%2F20260315%2Fus-east-1%2Fs3%2Faws4_request' +
          '&X-Amz-Date=20260315T123456Z' +
          '&X-Amz-Expires=3600' +
          '&X-Amz-SignedHeaders=host' +
          '&X-Amz-Signature=62134298cfa9a8e290dd6fbcebed29a18eeeed98b9b37c021d8391ce1bf4d337',
        expiresIn: 3600,
        expiresInLabel: '1 hour',
        operation: 'GET',
        objectKey: 'docs/report.pdf',
      })

      expect(mockS3Request).not.toHaveBeenCalled()
    })

    it.each([
      ['15 minutes', 900],
      ['1 hour', 3600],
      ['24 hours', 86400],
      ['7 days', 604800],
      ['30 days', 2592000],
      ['nonsense', 3600],
    ])('resolves the %s expiration preset', async (label, seconds) => {
      const result = await service.getPresignedUrl('my-bucket', 'a.txt', label)

      expect(result.expiresIn).toBe(seconds)
      expect(result.expiresInLabel).toBe(label)
      expect(result.presignedUrl).toContain(`X-Amz-Expires=${ seconds }`)
    })

    it.each([
      ['put', 'PUT'],
      ['PUT', 'PUT'],
      ['get', 'GET'],
      [undefined, 'GET'],
      ['delete', 'GET'],
    ])('normalizes the %s operation', async (input, expected) => {
      const result = await service.getPresignedUrl('my-bucket', 'a.txt', '1 hour', input)

      expect(result.operation).toBe(expected)
    })

    it('signs a session token into the URL when using IAM Role credentials', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, authenticationMethod: 'IAM Role', roleArn: 'arn:role' })

      mockStsAssumeRole.mockResolvedValue({
        accessKeyId: 'ASIATEMP',
        secretAccessKey: 'temp-secret',
        sessionToken: 'temp-token',
        expiration: new Date(Date.now() + 3600000),
      })

      const result = await svc.getPresignedUrl('my-bucket', 'a.txt')

      expect(result.presignedUrl).toContain('X-Amz-Security-Token=temp-token')
      expect(result.presignedUrl).toContain('X-Amz-Credential=ASIATEMP')
    })

    it('reports presigning failures through the error handler', async () => {
      const svc = new ServiceClass({ ...BASE_CONFIG, authenticationMethod: 'IAM Role', roleArn: 'arn:role' })

      mockStsAssumeRole.mockRejectedValue(s3Error('AccessDeniedException', 'not allowed'))

      await expect(svc.getPresignedUrl('my-bucket', 'a.txt')).rejects.toThrow(/STS AssumeRole failed: not allowed/)
    })
  })
})

// ── SigV4 primitives (frozen clock keeps signatures deterministic) ──

describe('S3 SigV4 signing', () => {
  const { signRequest, generatePresignedUrl } = jest.requireActual('../src/sigv4')
  const credentials = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-key' }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-03-15T12:34:56.000Z') })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('signs a GET request with the canonical headers', () => {
    const headers = {}

    signRequest('GET', 'https://my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf', headers, '', credentials, 'us-east-1', 's3')

    expect(headers).toEqual({
      'x-amz-date': '20260315T123456Z',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      host: 'my-bucket.s3.us-east-1.amazonaws.com',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260315/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=e24187dd609fbc6acade7874fc74705d7f77520bcc250d3ddadedc6bf9c9e641',
    })
  })

  it('includes the payload hash, session token and extra headers in the signature', () => {
    const headers = { 'content-type': 'text/plain' }

    signRequest(
      'PUT',
      'https://my-bucket.s3.us-east-1.amazonaws.com/a b.txt',
      headers,
      'hello',
      { ...credentials, sessionToken: 'tok' },
      'us-east-1',
      's3'
    )

    expect(headers['x-amz-security-token']).toBe('tok')
    expect(headers['x-amz-content-sha256']).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260315/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, ' +
        'Signature=b50394589c4c16271dcf38d0ff0f75a157324a9157a01d420aa4ec826d425941'
    )
  })

  it('keeps a caller-supplied host header and appends a non-standard port otherwise', () => {
    const supplied = { host: 'custom.example.com' }

    signRequest('GET', 'https://s3.example.com/b/k', supplied, '', credentials, 'us-east-1', 's3')

    expect(supplied.host).toBe('custom.example.com')

    const ported = {}

    signRequest('GET', 'http://minio.example.com:9000/b/k', ported, '', credentials, 'us-east-1', 's3')

    expect(ported.host).toBe('minio.example.com:9000')
  })

  it('sorts and encodes the canonical query string deterministically', () => {
    const a = {}
    const b = {}

    signRequest('GET', 'https://s3.example.com/b/?b=2&a=1', a, '', credentials, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.example.com/b/?a=1&b=2', b, '', credentials, 'us-east-1', 's3')

    expect(a.authorization).toBe(b.authorization)
  })

  it('generates a stable presigned URL', () => {
    const url = generatePresignedUrl(
      'GET',
      'https://my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf',
      credentials,
      'us-east-1',
      's3',
      3600
    )

    expect(url).toBe(
      'https://my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAEXAMPLE%2F20260315%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20260315T123456Z' +
        '&X-Amz-Expires=3600' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=62134298cfa9a8e290dd6fbcebed29a18eeeed98b9b37c021d8391ce1bf4d337'
    )
  })

  it('signs a session token and non-standard port into a presigned URL', () => {
    const url = generatePresignedUrl(
      'PUT',
      'http://minio.example.com:9000/my-bucket/a.txt',
      { ...credentials, sessionToken: 'tok' },
      'us-east-1',
      's3',
      900
    )

    expect(url).toContain('X-Amz-Security-Token=tok')
    expect(url).toContain('X-Amz-Expires=900')
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/)
  })
})
