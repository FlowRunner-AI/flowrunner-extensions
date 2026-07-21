'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT_NAME = 'teststorageacct'
const ACCOUNT_KEY = Buffer.from('fake-account-key-for-testing-1234').toString('base64')

// ---------------------------------------------------------------------------
// Mock Node's https module — this service uses native https.request, not
// Flowrunner.Request, so the sandbox request mock is only relevant for
// uploadBlob (sourceUrl) which uses Flowrunner.Request.get.
// ---------------------------------------------------------------------------

let mockHttpsHandler

jest.mock('https', () => {
  const { EventEmitter } = require('events')

  return {
  request: (options, callback) => {
    const req = new EventEmitter()

    req.write = jest.fn()
    req.end = jest.fn(() => {
      // Defer to allow test to set up handler
      process.nextTick(() => {
        if (mockHttpsHandler) {
          mockHttpsHandler(options, callback, req)
        }
      })
    })
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    return req
  },
}
})

/**
 * Helper: creates a mock HTTPS response with the given status, headers, and body.
 */
function mockHttpsResponse(statusCode, headers, bodyString) {
  const { EventEmitter } = require('events')

  return (options, callback) => {
    const res = new EventEmitter()

    res.statusCode = statusCode
    res.headers = headers || {}

    callback(res)

    process.nextTick(() => {
      if (bodyString) {
        res.emit('data', Buffer.from(bodyString, 'utf8'))
      }

      res.emit('end')
    })
  }
}

function mockHttpsResponseBuffer(statusCode, headers, bodyBuffer) {
  const { EventEmitter } = require('events')

  return (options, callback) => {
    const res = new EventEmitter()

    res.statusCode = statusCode
    res.headers = headers || {}

    callback(res)

    process.nextTick(() => {
      if (bodyBuffer) {
        res.emit('data', bodyBuffer)
      }

      res.emit('end')
    })
  }
}

describe('Azure Blob Storage Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ accountName: ACCOUNT_NAME, accountKey: ACCOUNT_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock the flowrunner.Files API used by getBlob
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/test/file.pdf' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
      },
    }
  })

  afterEach(() => {
    mock.reset()
    mockHttpsHandler = null
    uploadFileMock.mockClear()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'accountName',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accountKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Containers ──

  describe('listContainers', () => {
    it('sends correct request and parses XML response', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <EnumerationResults>
          <Containers>
            <Container>
              <Name>documents</Name>
              <Properties>
                <Last-Modified>Mon, 14 Jul 2025 10:00:00 GMT</Last-Modified>
                <Etag>"0x8D123"</Etag>
                <LeaseState>available</LeaseState>
                <LeaseStatus>unlocked</LeaseStatus>
              </Properties>
            </Container>
            <Container>
              <Name>images</Name>
              <Properties>
                <Last-Modified>Tue, 15 Jul 2025 12:00:00 GMT</Last-Modified>
                <Etag>"0x8D456"</Etag>
                <LeaseState>available</LeaseState>
                <LeaseStatus>unlocked</LeaseStatus>
              </Properties>
            </Container>
          </Containers>
          <NextMarker></NextMarker>
        </EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('GET')
        expect(options.hostname).toBe(`${ ACCOUNT_NAME }.blob.core.windows.net`)
        expect(options.path).toContain('comp=list')
        expect(options.headers['Authorization']).toMatch(/^SharedKey teststorageacct:/)
        expect(options.headers['x-ms-version']).toBe('2021-08-06')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.listContainers()

      expect(result.containers).toHaveLength(2)
      expect(result.containers[0]).toMatchObject({
        name: 'documents',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
        etag: '"0x8D123"',
        leaseState: 'available',
        leaseStatus: 'unlocked',
      })
      expect(result.containers[1]).toMatchObject({ name: 'images' })
      expect(result.nextMarker).toBe('')
    })

    it('passes prefix, maxResults, and marker as query params', async () => {
      const xml = `<EnumerationResults><Containers></Containers><NextMarker>abc</NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.path).toContain('prefix=test')
        expect(options.path).toContain('maxresults=10')
        expect(options.path).toContain('marker=page2')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.listContainers('test', 10, 'page2')

      expect(result.containers).toHaveLength(0)
      expect(result.nextMarker).toBe('abc')
    })

    it('throws on API error', async () => {
      const errorXml = `<Error><Code>AuthorizationFailure</Code><Message>Access denied</Message></Error>`

      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(403, {}, errorXml)(options, callback)
      }

      await expect(service.listContainers()).rejects.toThrow('Azure Blob Storage API error')
    })
  })

  describe('createContainer', () => {
    it('sends PUT with correct path and returns result', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('PUT')
        expect(options.path).toContain('/mycontainer')
        expect(options.path).toContain('restype=container')

        mockHttpsResponse(201, {
          etag: '"0x8DABC"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.createContainer('mycontainer')

      expect(result).toEqual({
        container: 'mycontainer',
        created: true,
        etag: '"0x8DABC"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
      })
    })

    it('sets public access header for Blob access level', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-blob-public-access']).toBe('blob')

        mockHttpsResponse(201, {
          etag: '"0x8DABC"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.createContainer('public-container', 'Blob')
    })

    it('sets public access header for Container access level', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-blob-public-access']).toBe('container')

        mockHttpsResponse(201, {
          etag: '"0x8DABC"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.createContainer('full-public', 'Container')
    })

    it('omits public access header for Private', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-blob-public-access']).toBeUndefined()

        mockHttpsResponse(201, {
          etag: '"0x8DABC"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.createContainer('private-container', 'Private')
    })

    it('sends metadata headers when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-meta-team']).toBe('engineering')
        expect(options.headers['x-ms-meta-env']).toBe('test')

        mockHttpsResponse(201, {
          etag: '"0x8DABC"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.createContainer('meta-container', 'Private', { team: 'engineering', env: 'test' })
    })
  })

  describe('getContainerProperties', () => {
    it('sends HEAD and returns parsed properties', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('HEAD')
        expect(options.path).toContain('/docs')
        expect(options.path).toContain('restype=container')

        mockHttpsResponse(200, {
          etag: '"0x8DXYZ"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
          'x-ms-lease-state': 'available',
          'x-ms-lease-status': 'unlocked',
          'x-ms-blob-public-access': 'blob',
          'x-ms-meta-team': 'ops',
        }, '')(options, callback)
      }

      const result = await service.getContainerProperties('docs')

      expect(result).toEqual({
        container: 'docs',
        etag: '"0x8DXYZ"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
        leaseState: 'available',
        leaseStatus: 'unlocked',
        publicAccess: 'blob',
        metadata: { team: 'ops' },
      })
    })

    it('returns null publicAccess when not set', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(200, {
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.getContainerProperties('private')

      expect(result.publicAccess).toBeNull()
    })
  })

  describe('deleteContainer', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('DELETE')
        expect(options.path).toContain('/old-container')
        expect(options.path).toContain('restype=container')

        mockHttpsResponse(202, {}, '')(options, callback)
      }

      const result = await service.deleteContainer('old-container')

      expect(result).toEqual({ container: 'old-container', deleted: true })
    })

    it('throws on 404', async () => {
      const errorXml = `<Error><Code>ContainerNotFound</Code><Message>The specified container does not exist.</Message></Error>`

      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(404, {}, errorXml)(options, callback)
      }

      await expect(service.deleteContainer('nonexistent')).rejects.toThrow('Azure Blob Storage API error')
    })
  })

  // ── List Blobs ──

  describe('listBlobs', () => {
    it('sends GET with container path and parses blob XML', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <EnumerationResults>
          <Blobs>
            <Blob>
              <Name>reports/q1.pdf</Name>
              <Properties>
                <BlobType>BlockBlob</BlobType>
                <Content-Type>application/pdf</Content-Type>
                <Content-Length>10240</Content-Length>
                <Last-Modified>Mon, 14 Jul 2025 10:00:00 GMT</Last-Modified>
                <Etag>"0x8DBLOB"</Etag>
                <Creation-Time>Sun, 13 Jul 2025 08:00:00 GMT</Creation-Time>
              </Properties>
            </Blob>
          </Blobs>
          <NextMarker></NextMarker>
        </EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('GET')
        expect(options.path).toContain('/mycontainer')
        expect(options.path).toContain('restype=container')
        expect(options.path).toContain('comp=list')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.listBlobs('mycontainer')

      expect(result.blobs).toHaveLength(1)
      expect(result.blobs[0]).toMatchObject({
        name: 'reports/q1.pdf',
        blobType: 'BlockBlob',
        contentType: 'application/pdf',
        contentLength: 10240,
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
        etag: '"0x8DBLOB"',
      })
      expect(result.nextMarker).toBe('')
    })

    it('passes prefix, maxResults, and marker query params', async () => {
      const xml = `<EnumerationResults><Blobs></Blobs><NextMarker>next123</NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.path).toContain('prefix=reports%2F')
        expect(options.path).toContain('maxresults=5')
        expect(options.path).toContain('marker=page2tok')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.listBlobs('container', 'reports/', 5, 'page2tok')

      expect(result.blobs).toHaveLength(0)
      expect(result.nextMarker).toBe('next123')
    })
  })

  // ── Blobs ──

  describe('uploadBlob', () => {
    it('uploads inline text content with correct headers', async () => {
      mockHttpsHandler = (options, callback, req) => {
        expect(options.method).toBe('PUT')
        expect(options.path).toContain('/docs/readme.txt')
        expect(options.headers['x-ms-blob-type']).toBe('BlockBlob')
        expect(options.headers['Content-Type']).toBe('text/plain; charset=UTF-8')
        expect(options.headers['Content-Length']).toBe(13)

        // Verify body was written
        expect(req.write).toHaveBeenCalled()
        const writtenBuffer = req.write.mock.calls[0][0]

        expect(writtenBuffer.toString('utf8')).toBe('Hello, World!')

        mockHttpsResponse(201, {
          etag: '"0x8DUPLOAD"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.uploadBlob('docs', 'readme.txt', 'Hello, World!')

      expect(result).toMatchObject({
        container: 'docs',
        blob: 'readme.txt',
        uploaded: true,
        contentLength: 13,
        etag: '"0x8DUPLOAD"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
      })
    })

    it('uses custom content type when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['Content-Type']).toBe('application/json')

        mockHttpsResponse(201, {
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.uploadBlob('data', 'config.json', '{"key":"val"}', undefined, 'application/json')
    })

    it('downloads from sourceUrl when provided via Flowrunner.Request', async () => {
      const fakeBytes = Buffer.from('downloaded-file-content')

      mock.onGet('https://example.com/file.bin').reply(fakeBytes)

      mockHttpsHandler = (options, callback, req) => {
        expect(options.headers['Content-Type']).toBe('application/octet-stream')
        expect(options.headers['Content-Length']).toBe(fakeBytes.length)

        mockHttpsResponse(201, {
          etag: '"0x8DURL"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.uploadBlob('data', 'file.bin', 'ignored', 'https://example.com/file.bin')

      expect(result).toMatchObject({
        container: 'data',
        blob: 'file.bin',
        uploaded: true,
      })
      // Flowrunner.Request.get should have been called
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('sends metadata headers when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-meta-author']).toBe('test-user')

        mockHttpsResponse(201, {
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.uploadBlob('docs', 'file.txt', 'content', undefined, undefined, { author: 'test-user' })
    })
  })

  describe('getBlob', () => {
    it('downloads blob and uploads to FlowRunner file storage', async () => {
      const blobContent = Buffer.from('PDF-content-here')

      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('GET')
        expect(options.path).toContain('/docs/reports/q1.pdf')

        mockHttpsResponseBuffer(200, {
          'content-type': 'application/pdf',
        }, blobContent)(options, callback)
      }

      const result = await service.getBlob('docs', 'reports/q1.pdf')

      expect(uploadFileMock).toHaveBeenCalledTimes(1)
      const [buffer, opts] = uploadFileMock.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.toString()).toBe('PDF-content-here')
      expect(opts).toMatchObject({
        filename: 'q1.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toMatchObject({
        container: 'docs',
        blob: 'reports/q1.pdf',
        url: 'https://files.flowrunner.io/test/file.pdf',
        contentType: 'application/pdf',
        contentLength: blobContent.length,
      })
    })

    it('passes fileOptions when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponseBuffer(200, {
          'content-type': 'text/plain',
        }, Buffer.from('text'))(options, callback)
      }

      await service.getBlob('docs', 'file.txt', { scope: 'GLOBAL', filename: 'custom.txt' })

      const [, opts] = uploadFileMock.mock.calls[0]

      expect(opts.scope).toBe('GLOBAL')
      expect(opts.filename).toBe('custom.txt')
    })
  })

  describe('getBlobProperties', () => {
    it('sends HEAD and returns parsed properties', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('HEAD')
        expect(options.path).toContain('/docs/file.pdf')

        mockHttpsResponse(200, {
          'content-type': 'application/pdf',
          'content-length': '2048',
          etag: '"0x8DPROP"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-lease-state': 'available',
          'x-ms-meta-team': 'ops',
        }, '')(options, callback)
      }

      const result = await service.getBlobProperties('docs', 'file.pdf')

      expect(result).toEqual({
        container: 'docs',
        blob: 'file.pdf',
        contentType: 'application/pdf',
        contentLength: 2048,
        etag: '"0x8DPROP"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
        blobType: 'BlockBlob',
        leaseState: 'available',
        metadata: { team: 'ops' },
      })
    })

    it('returns null contentLength when header is missing', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(200, {
          'content-type': 'text/plain',
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.getBlobProperties('docs', 'file.txt')

      expect(result.contentLength).toBeNull()
    })
  })

  describe('deleteBlob', () => {
    it('sends DELETE with snapshot include header', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('DELETE')
        expect(options.path).toContain('/docs/old-file.txt')
        expect(options.headers['x-ms-delete-snapshots']).toBe('include')

        mockHttpsResponse(202, {}, '')(options, callback)
      }

      const result = await service.deleteBlob('docs', 'old-file.txt')

      expect(result).toEqual({ container: 'docs', blob: 'old-file.txt', deleted: true })
    })
  })

  describe('copyBlob', () => {
    it('sends PUT with copy-source header', async () => {
      const sourceUrl = 'https://other.blob.core.windows.net/src/original.pdf'

      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('PUT')
        expect(options.path).toContain('/dest/copy.pdf')
        expect(options.headers['x-ms-copy-source']).toBe(sourceUrl)

        mockHttpsResponse(202, {
          'x-ms-copy-status': 'success',
          'x-ms-copy-id': 'copy-id-123',
          etag: '"0x8DCOPY"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.copyBlob('dest', 'copy.pdf', sourceUrl)

      expect(result).toEqual({
        container: 'dest',
        blob: 'copy.pdf',
        copyStatus: 'success',
        copyId: 'copy-id-123',
        etag: '"0x8DCOPY"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
      })
    })

    it('sends metadata headers when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-meta-source']).toBe('external')

        mockHttpsResponse(202, {
          'x-ms-copy-status': 'success',
          'x-ms-copy-id': 'id',
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.copyBlob('dest', 'file.pdf', 'https://src.blob.core.windows.net/a/b', { source: 'external' })
    })
  })

  describe('setBlobMetadata', () => {
    it('sends PUT with metadata query and headers', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('PUT')
        expect(options.path).toContain('/docs/file.pdf')
        expect(options.path).toContain('comp=metadata')
        expect(options.headers['x-ms-meta-reviewed']).toBe('true')
        expect(options.headers['x-ms-meta-team']).toBe('qa')

        mockHttpsResponse(200, {
          etag: '"0x8DMETA"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.setBlobMetadata('docs', 'file.pdf', { reviewed: 'true', team: 'qa' })

      expect(result).toEqual({
        container: 'docs',
        blob: 'file.pdf',
        updated: true,
        etag: '"0x8DMETA"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
      })
    })
  })

  describe('getBlobMetadata', () => {
    it('sends HEAD with metadata comp and extracts metadata', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('HEAD')
        expect(options.path).toContain('/docs/file.pdf')
        expect(options.path).toContain('comp=metadata')

        mockHttpsResponse(200, {
          'x-ms-meta-team': 'ops',
          'x-ms-meta-env': 'production',
        }, '')(options, callback)
      }

      const result = await service.getBlobMetadata('docs', 'file.pdf')

      expect(result).toEqual({
        container: 'docs',
        blob: 'file.pdf',
        metadata: { team: 'ops', env: 'production' },
      })
    })

    it('returns empty metadata when none set', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(200, {}, '')(options, callback)
      }

      const result = await service.getBlobMetadata('docs', 'file.txt')

      expect(result.metadata).toEqual({})
    })
  })

  describe('snapshotBlob', () => {
    it('sends PUT with snapshot comp and returns snapshot timestamp', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.method).toBe('PUT')
        expect(options.path).toContain('/docs/file.pdf')
        expect(options.path).toContain('comp=snapshot')

        mockHttpsResponse(201, {
          'x-ms-snapshot': '2025-07-14T10:00:00.0000000Z',
          etag: '"0x8DSNAP"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      const result = await service.snapshotBlob('docs', 'file.pdf')

      expect(result).toEqual({
        container: 'docs',
        blob: 'file.pdf',
        snapshot: '2025-07-14T10:00:00.0000000Z',
        etag: '"0x8DSNAP"',
        lastModified: 'Mon, 14 Jul 2025 10:00:00 GMT',
      })
    })

    it('sends metadata headers when provided', async () => {
      mockHttpsHandler = (options, callback) => {
        expect(options.headers['x-ms-meta-version']).toBe('v2')

        mockHttpsResponse(201, {
          'x-ms-snapshot': '2025-07-14T10:00:00.0000000Z',
          etag: '"0x8D"',
          'last-modified': 'Mon, 14 Jul 2025 10:00:00 GMT',
        }, '')(options, callback)
      }

      await service.snapshotBlob('docs', 'file.pdf', { version: 'v2' })
    })
  })

  // ── Dictionary ──

  describe('getContainersDictionary', () => {
    it('returns items with label/value/note shape', async () => {
      const xml = `<EnumerationResults>
        <Containers>
          <Container><Name>alpha</Name></Container>
          <Container><Name>beta</Name></Container>
        </Containers>
        <NextMarker></NextMarker>
      </EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.path).toContain('comp=list')
        expect(options.path).toContain('maxresults=100')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.getContainersDictionary({})

      expect(result.items).toEqual([
        { label: 'alpha', value: 'alpha', note: 'Container' },
        { label: 'beta', value: 'beta', note: 'Container' },
      ])
      expect(result.cursor).toBe('')
    })

    it('passes search as prefix query param', async () => {
      const xml = `<EnumerationResults><Containers></Containers><NextMarker></NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.path).toContain('prefix=test')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      await service.getContainersDictionary({ search: 'test' })
    })

    it('passes cursor as marker query param', async () => {
      const xml = `<EnumerationResults><Containers></Containers><NextMarker></NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        expect(options.path).toContain('marker=next-page')

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      await service.getContainersDictionary({ cursor: 'next-page' })
    })

    it('handles null/undefined payload', async () => {
      const xml = `<EnumerationResults><Containers></Containers><NextMarker></NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      const result = await service.getContainersDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Auth / Signing ──

  describe('request signing', () => {
    it('includes Authorization header with SharedKey scheme', async () => {
      const xml = `<EnumerationResults><Containers></Containers><NextMarker></NextMarker></EnumerationResults>`

      mockHttpsHandler = (options, callback) => {
        const auth = options.headers['Authorization']

        expect(auth).toMatch(/^SharedKey teststorageacct:.+/)

        // Verify signature is a valid base64 string
        const sig = auth.split(':')[1]

        expect(() => Buffer.from(sig, 'base64')).not.toThrow()

        mockHttpsResponse(200, {}, xml)(options, callback)
      }

      await service.listContainers()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('parses Azure XML error with Code and Message', async () => {
      const errorXml = `<Error><Code>ContainerAlreadyExists</Code><Message>The specified container already exists.\nRequestId:abc</Message></Error>`

      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(409, {}, errorXml)(options, callback)
      }

      await expect(service.createContainer('existing')).rejects.toThrow(
        /ContainerAlreadyExists.*The specified container already exists/
      )
    })

    it('uses x-ms-error-code header when body is empty (HEAD requests)', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(404, {
          'x-ms-error-code': 'BlobNotFound',
        }, '')(options, callback)
      }

      await expect(service.getBlobProperties('docs', 'missing.txt')).rejects.toThrow(/BlobNotFound/)
    })

    it('attaches statusCode to thrown error', async () => {
      mockHttpsHandler = (options, callback) => {
        mockHttpsResponse(404, {}, '<Error><Code>NotFound</Code><Message>Not found</Message></Error>')(options, callback)
      }

      try {
        await service.deleteBlob('docs', 'missing.txt')
        throw new Error('should have thrown')
      } catch (err) {
        expect(err.statusCode).toBe(404)
        expect(err.code).toBe('NotFound')
      }
    })
  })
})
