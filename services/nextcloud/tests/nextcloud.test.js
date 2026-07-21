'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://cloud.example.com'
const USERNAME = 'testuser'
const APP_PASSWORD = 'test-app-password'
const TOKEN = Buffer.from(`${USERNAME}:${APP_PASSWORD}`).toString('base64')
const AUTH_HEADER = `Basic ${TOKEN}`
const DAV_ROOT = `${SERVER_URL}/remote.php/dav/files/${encodeURIComponent(USERNAME)}`
const OCS_BASE = `${SERVER_URL}/ocs/v2.php`

describe('Nextcloud Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      serverUrl: SERVER_URL,
      username: USERNAME,
      appPassword: APP_PASSWORD,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock flowrunner.Files for downloadFile
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/abc/report.pdf' }),
      },
    }
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serverUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'appPassword', required: true, shared: false }),
        ])
      )
    })

    it('registers exactly 3 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(3)
    })
  })

  // ── Files (WebDAV) ──

  describe('uploadFile', () => {
    const sourceUrl = 'https://example.com/report.pdf'
    const remotePath = 'Documents/report.pdf'

    it('fetches source and uploads via PUT', async () => {
      const fakeBuffer = Buffer.from('fake-pdf-content')

      mock.onGet(sourceUrl).reply(fakeBuffer)
      mock.onPut(`${DAV_ROOT}/Documents/report.pdf`).reply(undefined)

      const result = await service.uploadFile(sourceUrl, remotePath)

      expect(result).toEqual({
        path: 'Documents/report.pdf',
        name: 'report.pdf',
        size: fakeBuffer.length,
        contentType: undefined,
        uploaded: true,
      })

      // First call: GET to fetch source
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(sourceUrl)
      expect(mock.history[0].encoding).toBeNull()

      // Second call: PUT to upload
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].url).toBe(`${DAV_ROOT}/Documents/report.pdf`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/octet-stream',
        'X-NC-WebDAV-AutoMkcol': 'true',
      })
    })

    it('uses provided content type', async () => {
      const fakeBuffer = Buffer.from('pdf-data')

      mock.onGet(sourceUrl).reply(fakeBuffer)
      mock.onPut(`${DAV_ROOT}/Documents/report.pdf`).reply(undefined)

      const result = await service.uploadFile(sourceUrl, remotePath, 'application/pdf')

      expect(result.contentType).toBe('application/pdf')
      expect(mock.history[1].headers['Content-Type']).toBe('application/pdf')
    })

    it('normalizes path with leading slashes', async () => {
      const fakeBuffer = Buffer.from('data')

      mock.onGet(sourceUrl).reply(fakeBuffer)
      mock.onPut(`${DAV_ROOT}/Documents/file.txt`).reply(undefined)

      await service.uploadFile(sourceUrl, '/Documents/file.txt')

      expect(mock.history[1].url).toBe(`${DAV_ROOT}/Documents/file.txt`)
    })

    it('throws on WebDAV error', async () => {
      const fakeBuffer = Buffer.from('data')

      mock.onGet(sourceUrl).reply(fakeBuffer)
      mock.onPut(`${DAV_ROOT}/Documents/report.pdf`).replyWithError({
        message: 'Conflict',
        status: 409,
      })

      await expect(service.uploadFile(sourceUrl, remotePath)).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  describe('downloadFile', () => {
    const remotePath = 'Documents/report.pdf'

    it('downloads file and uploads to FlowRunner storage', async () => {
      const fakeBuffer = Buffer.from('file-content')

      mock.onGet(`${DAV_ROOT}/Documents/report.pdf`).reply(fakeBuffer)

      const result = await service.downloadFile(remotePath)

      expect(result).toEqual({
        url: 'https://files.flowrunner.io/abc/report.pdf',
        filename: 'report.pdf',
        path: 'Documents/report.pdf',
        size: fakeBuffer.length,
      })

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
      expect(mock.history[0].encoding).toBeNull()

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'report.pdf',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('uses custom fileOptions when provided', async () => {
      const fakeBuffer = Buffer.from('file-content')

      mock.onGet(`${DAV_ROOT}/Documents/report.pdf`).reply(fakeBuffer)
      service.flowrunner.Files.uploadFile.mockClear()

      await service.downloadFile(remotePath, { scope: 'GLOBAL', filename: 'custom.pdf' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'custom.pdf',
          generateUrl: true,
          overwrite: true,
          scope: 'GLOBAL',
        })
      )
    })
  })

  describe('listFolder', () => {
    const propfindXml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/dav/files/${USERNAME}/Documents/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/></d:resourcetype>
              <d:getlastmodified>Mon, 14 Jul 2026 08:00:00 GMT</d:getlastmodified>
            </d:prop>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/files/${USERNAME}/Documents/report.pdf</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype/>
              <d:getcontentlength>20841</d:getcontentlength>
              <d:getcontenttype>application/pdf</d:getcontenttype>
              <d:getlastmodified>Mon, 14 Jul 2026 09:12:00 GMT</d:getlastmodified>
              <d:getetag>"6a1f"</d:getetag>
            </d:prop>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/dav/files/${USERNAME}/Documents/Archive/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/></d:resourcetype>
              <d:getlastmodified>Mon, 14 Jul 2026 08:00:00 GMT</d:getlastmodified>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`

    it('sends PROPFIND with Depth 1 and returns entries', async () => {
      mock.on('propfind', `${DAV_ROOT}/Documents/`).reply(propfindXml)

      const result = await service.listFolder('Documents')

      expect(result.path).toBe('Documents')
      expect(result.count).toBe(2)
      expect(result.entries).toHaveLength(2)

      // Check file entry
      const fileEntry = result.entries.find(e => e.name === 'report.pdf')

      expect(fileEntry).toBeDefined()
      expect(fileEntry.isFolder).toBe(false)
      expect(fileEntry.contentLength).toBe(20841)
      expect(fileEntry.contentType).toBe('application/pdf')

      // Check folder entry
      const folderEntry = result.entries.find(e => e.name === 'Archive')

      expect(folderEntry).toBeDefined()
      expect(folderEntry.isFolder).toBe(true)

      // Verify request
      expect(mock.history[0].method).toBe('propfind')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        Depth: '1',
        'Content-Type': 'application/xml',
      })
    })

    it('lists root folder when path is empty', async () => {
      mock.on('propfind', `${DAV_ROOT}/`).reply('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>')

      const result = await service.listFolder()

      expect(result.path).toBe('')
      expect(result.count).toBe(0)
      expect(result.entries).toEqual([])
      expect(mock.history[0].url).toBe(`${DAV_ROOT}/`)
    })

    it('throws on PROPFIND error', async () => {
      mock.on('propfind', `${DAV_ROOT}/NonExistent/`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.listFolder('NonExistent')).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  describe('createFolder', () => {
    it('sends MKCOL request and returns created path', async () => {
      mock.on('mkcol', `${DAV_ROOT}/Documents/Archive`).reply(undefined)

      const result = await service.createFolder('Documents/Archive')

      expect(result).toEqual({
        path: 'Documents/Archive',
        created: true,
      })
      expect(mock.history[0].method).toBe('mkcol')
      expect(mock.history[0].url).toBe(`${DAV_ROOT}/Documents/Archive`)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('throws on MKCOL error', async () => {
      mock.on('mkcol', `${DAV_ROOT}/Existing`).replyWithError({
        message: 'Method Not Allowed',
        status: 405,
      })

      await expect(service.createFolder('Existing')).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  describe('deleteItem', () => {
    it('sends DELETE request and returns result', async () => {
      mock.onDelete(`${DAV_ROOT}/Documents/old.pdf`).reply(undefined)

      const result = await service.deleteItem('Documents/old.pdf')

      expect(result).toEqual({
        path: 'Documents/old.pdf',
        deleted: true,
      })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('throws on DELETE error', async () => {
      mock.onDelete(`${DAV_ROOT}/missing.pdf`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.deleteItem('missing.pdf')).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  describe('moveItem', () => {
    it('sends MOVE request with correct headers', async () => {
      mock.on('move', `${DAV_ROOT}/Documents/report.pdf`).reply(undefined)

      const result = await service.moveItem('Documents/report.pdf', 'Archive/report-2026.pdf')

      expect(result).toEqual({
        source: 'Documents/report.pdf',
        destination: 'Archive/report-2026.pdf',
        moved: true,
      })
      expect(mock.history[0].method).toBe('move')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        Destination: `${DAV_ROOT}/Archive/report-2026.pdf`,
        Overwrite: 'T',
      })
    })

    it('sets Overwrite to F when overwrite is false', async () => {
      mock.on('move', `${DAV_ROOT}/a.txt`).reply(undefined)

      await service.moveItem('a.txt', 'b.txt', false)

      expect(mock.history[0].headers.Overwrite).toBe('F')
    })

    it('defaults Overwrite to T when not specified', async () => {
      mock.on('move', `${DAV_ROOT}/a.txt`).reply(undefined)

      await service.moveItem('a.txt', 'b.txt')

      expect(mock.history[0].headers.Overwrite).toBe('T')
    })

    it('throws on MOVE error', async () => {
      mock.on('move', `${DAV_ROOT}/missing.txt`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.moveItem('missing.txt', 'dest.txt')).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  describe('copyItem', () => {
    it('sends COPY request with correct headers', async () => {
      mock.on('copy', `${DAV_ROOT}/Documents/report.pdf`).reply(undefined)

      const result = await service.copyItem('Documents/report.pdf', 'Backups/report.pdf')

      expect(result).toEqual({
        source: 'Documents/report.pdf',
        destination: 'Backups/report.pdf',
        copied: true,
      })
      expect(mock.history[0].method).toBe('copy')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        Destination: `${DAV_ROOT}/Backups/report.pdf`,
        Overwrite: 'T',
      })
    })

    it('sets Overwrite to F when overwrite is false', async () => {
      mock.on('copy', `${DAV_ROOT}/a.txt`).reply(undefined)

      await service.copyItem('a.txt', 'b.txt', false)

      expect(mock.history[0].headers.Overwrite).toBe('F')
    })

    it('throws on COPY error', async () => {
      mock.on('copy', `${DAV_ROOT}/missing.txt`).replyWithError({
        message: 'Precondition Failed',
        status: 412,
      })

      await expect(service.copyItem('missing.txt', 'dest.txt')).rejects.toThrow('Nextcloud WebDAV error')
    })
  })

  // ── Shares (OCS) ──

  describe('createShare', () => {
    const sharesUrl = `${OCS_BASE}/apps/files_sharing/api/v1/shares`

    it('creates a public link share with correct body', async () => {
      mock.onPost(sharesUrl).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: '42', share_type: 3, path: '/Documents/report.pdf', url: 'https://cloud.example.com/s/abc123' },
        },
      })

      const result = await service.createShare('Documents/report.pdf', 'Public Link')

      expect(result).toMatchObject({ id: '42', share_type: 3 })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ format: 'json' })
      expect(mock.history[0].body).toMatchObject({
        path: '/Documents/report.pdf',
        shareType: 3,
      })
    })

    it('includes optional parameters when provided', async () => {
      mock.onPost(sharesUrl).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: '43' },
        },
      })

      await service.createShare('file.txt', 'User', 'bob', 'Edit', 'secret123', '2026-12-31', 'Check this')

      expect(mock.history[0].body).toMatchObject({
        path: '/file.txt',
        shareType: 0,
        shareWith: 'bob',
        permissions: 3,
        password: 'secret123',
        expireDate: '2026-12-31',
        note: 'Check this',
      })
    })

    it('omits optional parameters when not provided', async () => {
      mock.onPost(sharesUrl).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: '44' },
        },
      })

      await service.createShare('file.txt', 'Public Link')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('shareWith')
      expect(body).not.toHaveProperty('password')
      expect(body).not.toHaveProperty('expireDate')
      expect(body).not.toHaveProperty('note')
      expect(body).not.toHaveProperty('permissions')
    })

    it('resolves share type correctly', async () => {
      mock.onPost(sharesUrl).reply({ ocs: { meta: { statuscode: 200 }, data: {} } })

      await service.createShare('file.txt', 'Email', 'bob@example.com')

      expect(mock.history[0].body.shareType).toBe(4)
    })

    it('throws on OCS error statuscode', async () => {
      mock.onPost(sharesUrl).reply({
        ocs: {
          meta: { statuscode: 404, message: 'Wrong path' },
          data: {},
        },
      })

      await expect(service.createShare('bad/path', 'Public Link')).rejects.toThrow('Nextcloud OCS error (404): Wrong path')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(sharesUrl).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.createShare('file.txt', 'Public Link')).rejects.toThrow('Nextcloud OCS error')
    })
  })

  describe('listShares', () => {
    const sharesUrl = `${OCS_BASE}/apps/files_sharing/api/v1/shares`

    it('lists shares with no filters', async () => {
      mock.onGet(sharesUrl).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: [{ id: '1' }, { id: '2' }],
        },
      })

      const result = await service.listShares()

      expect(result).toEqual([{ id: '1' }, { id: '2' }])
      expect(mock.history[0].query).toMatchObject({ format: 'json' })
    })

    it('passes path, reshares, and subfiles query params', async () => {
      mock.onGet(sharesUrl).reply({
        ocs: { meta: { statuscode: 200 }, data: [] },
      })

      await service.listShares('Documents', true, true)

      expect(mock.history[0].query).toMatchObject({
        format: 'json',
        path: '/Documents',
        reshares: 'true',
        subfiles: 'true',
      })
    })

    it('omits optional query params when false', async () => {
      mock.onGet(sharesUrl).reply({
        ocs: { meta: { statuscode: 200 }, data: [] },
      })

      await service.listShares(undefined, false, false)

      expect(mock.history[0].query).not.toHaveProperty('reshares')
      expect(mock.history[0].query).not.toHaveProperty('subfiles')
      expect(mock.history[0].query).not.toHaveProperty('path')
    })
  })

  describe('getShare', () => {
    it('returns a single share from the array response', async () => {
      mock.onGet(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: [{ id: '42', share_type: 3, path: '/Documents/report.pdf' }],
        },
      })

      const result = await service.getShare('42')

      expect(result).toEqual({ id: '42', share_type: 3, path: '/Documents/report.pdf' })
    })

    it('returns data directly when not an array', async () => {
      mock.onGet(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: '42' },
        },
      })

      const result = await service.getShare('42')

      expect(result).toEqual({ id: '42' })
    })

    it('throws on OCS error', async () => {
      mock.onGet(`${OCS_BASE}/apps/files_sharing/api/v1/shares/999`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getShare('999')).rejects.toThrow('Nextcloud OCS error')
    })
  })

  describe('updateShare', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: '42', permissions: 3 },
        },
      })

      const result = await service.updateShare('42', 'Edit', 'newpass', '2026-12-31', 'Updated note')

      expect(result).toMatchObject({ id: '42', permissions: 3 })
      expect(mock.history[0].body).toMatchObject({
        permissions: 3,
        password: 'newpass',
        expireDate: '2026-12-31',
        note: 'Updated note',
      })
    })

    it('omits fields not provided', async () => {
      mock.onPut(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: { meta: { statuscode: 200 }, data: { id: '42' } },
      })

      await service.updateShare('42', 'Read')

      const body = mock.history[0].body

      expect(body).toMatchObject({ permissions: 1 })
      expect(body).not.toHaveProperty('password')
      expect(body).not.toHaveProperty('expireDate')
      expect(body).not.toHaveProperty('note')
    })

    it('resolves All Permissions correctly', async () => {
      mock.onPut(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: { meta: { statuscode: 200 }, data: {} },
      })

      await service.updateShare('42', 'All Permissions')

      expect(mock.history[0].body.permissions).toBe(31)
    })
  })

  describe('deleteShare', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${OCS_BASE}/apps/files_sharing/api/v1/shares/42`).reply({
        ocs: { meta: { statuscode: 200 }, data: [] },
      })

      const result = await service.deleteShare('42')

      expect(result).toEqual({ id: '42', deleted: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on OCS error', async () => {
      mock.onDelete(`${OCS_BASE}/apps/files_sharing/api/v1/shares/999`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.deleteShare('999')).rejects.toThrow('Nextcloud OCS error')
    })
  })

  // ── Users (OCS provisioning) ──

  describe('getCurrentUser', () => {
    it('returns current user profile', async () => {
      mock.onGet(`${OCS_BASE}/cloud/user`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: 'testuser', displayname: 'Test User', email: 'test@example.com' },
        },
      })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 'testuser', displayname: 'Test User', email: 'test@example.com' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'OCS-APIRequest': 'true',
      })
      expect(mock.history[0].query).toMatchObject({ format: 'json' })
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${OCS_BASE}/cloud/user`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Nextcloud OCS error')
    })
  })

  describe('getUser', () => {
    it('returns user profile by id', async () => {
      mock.onGet(`${OCS_BASE}/cloud/users/bob`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { id: 'bob', displayname: 'Bob', groups: ['users'] },
        },
      })

      const result = await service.getUser('bob')

      expect(result).toEqual({ id: 'bob', displayname: 'Bob', groups: ['users'] })
    })

    it('throws on not found', async () => {
      mock.onGet(`${OCS_BASE}/cloud/users/nobody`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getUser('nobody')).rejects.toThrow('Nextcloud OCS error')
    })
  })

  describe('listUsers', () => {
    it('returns user list with no filters', async () => {
      mock.onGet(`${OCS_BASE}/cloud/users`).reply({
        ocs: {
          meta: { statuscode: 200 },
          data: { users: ['alice', 'bob', 'carol'] },
        },
      })

      const result = await service.listUsers()

      expect(result).toEqual({ users: ['alice', 'bob', 'carol'] })
    })

    it('passes search, limit, and offset query params', async () => {
      mock.onGet(`${OCS_BASE}/cloud/users`).reply({
        ocs: { meta: { statuscode: 200 }, data: { users: ['alice'] } },
      })

      await service.listUsers('ali', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        format: 'json',
        search: 'ali',
        limit: 10,
        offset: 5,
      })
    })

    it('omits undefined query params', async () => {
      mock.onGet(`${OCS_BASE}/cloud/users`).reply({
        ocs: { meta: { statuscode: 200 }, data: { users: [] } },
      })

      await service.listUsers()

      const query = mock.history[0].query

      expect(query).not.toHaveProperty('search')
      expect(query).not.toHaveProperty('limit')
      expect(query).not.toHaveProperty('offset')
    })
  })

  // ── Error handling edge cases ──

  describe('error handling', () => {
    it('extracts message from XML error body in WebDAV', async () => {
      mock.onDelete(`${DAV_ROOT}/locked.pdf`).replyWithError({
        message: 'Locked',
        status: 423,
        body: '<?xml version="1.0"?><d:error xmlns:d="DAV:"><s:message>File is locked</s:message></d:error>',
      })

      await expect(service.deleteItem('locked.pdf')).rejects.toThrow('File is locked')
    })

    it('extracts OCS meta message from error body', async () => {
      mock.onGet(`${OCS_BASE}/cloud/user`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: {
          ocs: { meta: { message: 'Internal processing failure' } },
        },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Internal processing failure')
    })

    it('falls back to error.message when no body', async () => {
      mock.onGet(`${OCS_BASE}/cloud/user`).replyWithError({
        message: 'Connection refused',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Connection refused')
    })

    it('handles OCS v1 statuscode 100 as success', async () => {
      mock.onGet(`${OCS_BASE}/cloud/user`).reply({
        ocs: {
          meta: { statuscode: 100 },
          data: { id: 'testuser' },
        },
      })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 'testuser' })
    })
  })
})
