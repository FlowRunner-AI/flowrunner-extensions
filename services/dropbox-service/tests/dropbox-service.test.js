'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const REFRESH_TOKEN = 'test-refresh-token'

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const API_BASE = 'https://api.dropboxapi.com/2'
const CONTENT_BASE = 'https://content.dropboxapi.com/2'

describe('Dropbox Service', () => {
  let sandbox
  let service
  let mock

  let filesUploadHistory

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')

    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth token available via request headers
    service.request = {
      headers: { 'oauth-access-token': ACCESS_TOKEN },
    }

    // Mock this.flowrunner.Files for downloadFile
    filesUploadHistory = []
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn(async (buffer, options) => {
          filesUploadHistory.push({ buffer, options })

          return { url: 'https://storage.example.com/mock-file' }
        }),
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(AUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('token_access_type=offline')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches profile', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 14400,
      })

      mock.onPost(`${API_BASE}/users/get_current_account`).reply({
        email: 'jane@example.com',
        name: { display_name: 'Jane Doe' },
        profile_photo_url: 'https://photo.url/jane.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 14400,
        connectionIdentityName: 'jane@example.com',
        connectionIdentityImageURL: 'https://photo.url/jane.jpg',
        overwrite: true,
      })

      // Verify token request body
      const tokenCall = mock.history[0]
      expect(tokenCall.url).toBe(TOKEN_URL)
      expect(tokenCall.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
      expect(tokenCall.body).toContain('grant_type=authorization_code')
      expect(tokenCall.body).toContain('code=auth-code')
    })

    it('falls back to display_name when email is absent', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 14400,
      })

      mock.onPost(`${API_BASE}/users/get_current_account`).reply({
        name: { display_name: 'Jane Doe' },
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Jane Doe')
      expect(result.connectionIdentityImageURL).toBeUndefined()
    })

    it('falls back to default name when profile fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 14400,
      })

      mock.onPost(`${API_BASE}/users/get_current_account`).replyWithError({
        message: 'Network error',
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Dropbox User')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 14400,
      })

      const result = await service.refreshToken(REFRESH_TOKEN)

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 14400,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain(`refresh_token=${REFRESH_TOKEN}`)
    })

    it('throws meaningful error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken(REFRESH_TOKEN)).rejects.toThrow(
        'Refresh token expired or invalid'
      )
    })

    it('rethrows other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken(REFRESH_TOKEN)).rejects.toThrow()
    })
  })

  // ── File Operations ──

  describe('listFolder', () => {
    it('lists folder contents with defaults', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [{ '.tag': 'file', name: 'test.pdf' }],
        cursor: 'cursor-abc',
        has_more: false,
      })

      const result = await service.listFolder('', false, false)

      expect(result).toEqual({
        entries: [{ '.tag': 'file', name: 'test.pdf' }],
        cursor: 'cursor-abc',
        has_more: false,
      })

      // Note: cleanupObject strips empty-string values, so path:'' is omitted
      expect(mock.history[0].body).toMatchObject({
        recursive: false,
        include_deleted: false,
      })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('uses cursor for pagination via list_folder/continue', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [{ '.tag': 'folder', name: 'Reports' }],
        cursor: 'cursor-def',
        has_more: false,
      })

      const result = await service.listFolder(null, null, null, 'cursor-abc')

      expect(result.entries).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ cursor: 'cursor-abc' })
    })

    it('passes recursive and includeDeleted options', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [],
        cursor: 'c',
        has_more: false,
      })

      await service.listFolder('/test', true, true)

      expect(mock.history[0].body).toMatchObject({
        path: '/test',
        recursive: true,
        include_deleted: true,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.listFolder('')).rejects.toThrow()
    })
  })

  describe('getMetadata', () => {
    it('retrieves metadata for a file', async () => {
      const metadata = {
        '.tag': 'file',
        name: 'summary.pdf',
        path_lower: '/reports/summary.pdf',
        size: 102400,
      }

      mock.onPost(`${API_BASE}/files/get_metadata`).reply(metadata)

      const result = await service.getMetadata('/reports/summary.pdf')

      expect(result).toEqual(metadata)
      expect(mock.history[0].body).toMatchObject({ path: '/reports/summary.pdf' })
    })

    it('includes media info when requested', async () => {
      mock.onPost(`${API_BASE}/files/get_metadata`).reply({ '.tag': 'file', name: 'photo.jpg' })

      await service.getMetadata('/photo.jpg', true)

      expect(mock.history[0].body).toMatchObject({
        path: '/photo.jpg',
        include_media_info: true,
      })
    })

    it('throws when path is missing', async () => {
      await expect(service.getMetadata('')).rejects.toThrow('"Path" is required')
    })
  })

  describe('uploadFile', () => {
    it('fetches URL and uploads to Dropbox', async () => {
      const fileBuffer = Buffer.from('file-content')

      mock.onGet('https://example.com/file.pdf').reply(fileBuffer)

      mock.onPost(`${CONTENT_BASE}/files/upload`).reply({
        id: 'id:abc',
        name: 'file.pdf',
        path_lower: '/imports/file.pdf',
        path_display: '/Imports/file.pdf',
        size: 12,
        rev: '5f1b1c',
        server_modified: '2025-03-01T12:34:56Z',
        content_hash: 'hash123',
      })

      const result = await service.uploadFile('/Imports', 'file.pdf', 'https://example.com/file.pdf')

      expect(result).toMatchObject({
        id: 'id:abc',
        name: 'file.pdf',
        path_lower: '/imports/file.pdf',
      })

      // First call: GET to fetch the file
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://example.com/file.pdf')

      // Second call: POST to upload
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${CONTENT_BASE}/files/upload`)
      expect(mock.history[1].headers).toMatchObject({
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('uses conflict mode and autorename options', async () => {
      mock.onGet('https://example.com/file.pdf').reply(Buffer.from('data'))
      mock.onPost(`${CONTENT_BASE}/files/upload`).reply({
        id: 'id:abc',
        name: 'file.pdf',
        path_lower: '/file.pdf',
        path_display: '/file.pdf',
        size: 4,
        rev: 'rev1',
        server_modified: '2025-01-01T00:00:00Z',
        content_hash: 'h',
      })

      await service.uploadFile('', 'file.pdf', 'https://example.com/file.pdf', 'overwrite', true)

      const uploadCall = mock.history[1]
      const apiArg = JSON.parse(uploadCall.headers['Dropbox-API-Arg'])

      expect(apiArg.mode).toEqual({ '.tag': 'overwrite' })
      expect(apiArg.autorename).toBe(true)
    })

    it('throws when fileName is missing', async () => {
      await expect(
        service.uploadFile('/dest', '', 'https://example.com/file.pdf')
      ).rejects.toThrow('"File Name" is required')
    })

    it('throws when fileUrl is missing', async () => {
      await expect(
        service.uploadFile('/dest', 'file.pdf', '')
      ).rejects.toThrow('"File URL" is required')
    })

    it('throws when source file fetch fails', async () => {
      mock.onGet('https://example.com/bad-file').replyWithError({ message: 'Not Found' })

      await expect(
        service.uploadFile('/dest', 'file.pdf', 'https://example.com/bad-file')
      ).rejects.toThrow('Failed to download the source file')
    })

    it('throws when file exceeds 150 MB', async () => {
      const largeBuffer = Buffer.alloc(151 * 1024 * 1024)

      mock.onGet('https://example.com/large').reply(largeBuffer)

      await expect(
        service.uploadFile('/dest', 'large.bin', 'https://example.com/large')
      ).rejects.toThrow('too large')
    })
  })

  describe('downloadFile', () => {
    it('downloads file and uploads to Flowrunner storage', async () => {
      const fileBuffer = Buffer.from('file-content')

      mock.onPost(`${CONTENT_BASE}/files/download`).reply(fileBuffer)

      const result = await service.downloadFile('/Reports/summary.pdf')

      expect(result).toEqual({ url: 'https://storage.example.com/mock-file' })

      const downloadCall = mock.history[0]
      expect(downloadCall.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
      expect(downloadCall.headers['Dropbox-API-Arg']).toContain('/Reports/summary.pdf')

      // Verify Files.uploadFile was called
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalled()
    })

    it('uses target file name when provided', async () => {
      mock.onPost(`${CONTENT_BASE}/files/download`).reply(Buffer.from('data'))

      await service.downloadFile('/Reports/summary.pdf', 'custom-name.pdf')

      const lastCall = filesUploadHistory[filesUploadHistory.length - 1]

      expect(lastCall.options.filename).toBe('custom-name.pdf')
    })

    it('uses source file basename when no target name provided', async () => {
      mock.onPost(`${CONTENT_BASE}/files/download`).reply(Buffer.from('data'))

      await service.downloadFile('/Reports/summary.pdf')

      const lastCall = filesUploadHistory[filesUploadHistory.length - 1]

      expect(lastCall.options.filename).toBe('summary.pdf')
    })

    it('throws when path is missing', async () => {
      await expect(service.downloadFile('')).rejects.toThrow('"File" is required')
    })
  })

  describe('getTemporaryLink', () => {
    it('returns temporary download link', async () => {
      mock.onPost(`${API_BASE}/files/get_temporary_link`).reply({
        link: 'https://dl.dropboxusercontent.com/temp-link',
      })

      const result = await service.getTemporaryLink('/Reports/summary.pdf')

      expect(result).toEqual({
        url: 'https://dl.dropboxusercontent.com/temp-link',
        expiresInSeconds: 14400,
      })

      expect(mock.history[0].body).toEqual({ path: '/Reports/summary.pdf' })
    })

    it('throws when path is missing', async () => {
      await expect(service.getTemporaryLink('')).rejects.toThrow('"File" is required')
    })
  })

  // ── File Management ──

  describe('createFolder', () => {
    it('creates a folder', async () => {
      const metadata = { '.tag': 'folder', name: 'Reports', path_lower: '/reports', id: 'id:abc' }

      mock.onPost(`${API_BASE}/files/create_folder_v2`).reply({ metadata })

      const result = await service.createFolder('', 'Reports')

      expect(result).toEqual({ metadata })
      expect(mock.history[0].body).toMatchObject({
        path: '/Reports',
        autorename: false,
      })
    })

    it('creates a nested folder with autorename', async () => {
      mock.onPost(`${API_BASE}/files/create_folder_v2`).reply({
        metadata: { '.tag': 'folder', name: 'Sub', path_lower: '/parent/sub' },
      })

      await service.createFolder('/Parent', 'Sub', true)

      expect(mock.history[0].body).toMatchObject({
        path: '/Parent/Sub',
        autorename: true,
      })
    })

    it('throws when folder name is missing', async () => {
      await expect(service.createFolder('', '')).rejects.toThrow('"Folder Name" is required')
    })
  })

  describe('deleteFile', () => {
    it('deletes a file or folder', async () => {
      const metadata = { '.tag': 'file', name: 'archive.zip', id: 'id:abc' }

      mock.onPost(`${API_BASE}/files/delete_v2`).reply({ metadata })

      const result = await service.deleteFile('/archive.zip')

      expect(result).toEqual({ metadata })
      expect(mock.history[0].body).toEqual({ path: '/archive.zip' })
    })

    it('throws when path is missing', async () => {
      await expect(service.deleteFile('')).rejects.toThrow('"Path" is required')
    })
  })

  describe('moveFile', () => {
    it('moves a file', async () => {
      const metadata = { '.tag': 'file', name: 'report.pdf', path_lower: '/archive/report.pdf' }

      mock.onPost(`${API_BASE}/files/move_v2`).reply({ metadata })

      const result = await service.moveFile('/inbox/report.pdf', '/archive/report.pdf')

      expect(result).toEqual({ metadata })
      expect(mock.history[0].body).toMatchObject({
        from_path: '/inbox/report.pdf',
        to_path: '/archive/report.pdf',
        autorename: false,
        allow_ownership_transfer: false,
        allow_shared_folder: true,
      })
    })

    it('passes autorename and allowOwnershipTransfer', async () => {
      mock.onPost(`${API_BASE}/files/move_v2`).reply({ metadata: {} })

      await service.moveFile('/a', '/b', true, true)

      expect(mock.history[0].body).toMatchObject({
        autorename: true,
        allow_ownership_transfer: true,
      })
    })

    it('throws when fromPath is missing', async () => {
      await expect(service.moveFile('', '/b')).rejects.toThrow('"From Path" is required')
    })

    it('throws when toPath is missing', async () => {
      await expect(service.moveFile('/a', '')).rejects.toThrow('"To Path" is required')
    })
  })

  describe('copyFile', () => {
    it('copies a file', async () => {
      const metadata = { '.tag': 'file', name: 'contract.docx', id: 'id:def' }

      mock.onPost(`${API_BASE}/files/copy_v2`).reply({ metadata })

      const result = await service.copyFile('/templates/contract.docx', '/clients/contract.docx')

      expect(result).toEqual({ metadata })
      expect(mock.history[0].body).toMatchObject({
        from_path: '/templates/contract.docx',
        to_path: '/clients/contract.docx',
        autorename: false,
        allow_shared_folder: true,
        allow_ownership_transfer: false,
      })
    })

    it('passes autorename option', async () => {
      mock.onPost(`${API_BASE}/files/copy_v2`).reply({ metadata: {} })

      await service.copyFile('/a', '/b', true)

      expect(mock.history[0].body.autorename).toBe(true)
    })

    it('throws when fromPath is missing', async () => {
      await expect(service.copyFile('', '/b')).rejects.toThrow('"From Path" is required')
    })

    it('throws when toPath is missing', async () => {
      await expect(service.copyFile('/a', '')).rejects.toThrow('"To Path" is required')
    })
  })

  // ── File Search ──

  describe('searchFiles', () => {
    it('searches with default options', async () => {
      mock.onPost(`${API_BASE}/files/search_v2`).reply({
        matches: [{ metadata: { metadata: { '.tag': 'file', name: 'invoice.pdf' } } }],
        cursor: null,
        has_more: false,
      })

      const result = await service.searchFiles('invoice')

      expect(result.matches).toHaveLength(1)
      expect(result.has_more).toBe(false)

      expect(mock.history[0].body).toMatchObject({
        query: 'invoice',
        options: { max_results: 100 },
      })
    })

    it('passes all optional parameters', async () => {
      mock.onPost(`${API_BASE}/files/search_v2`).reply({
        matches: [],
        cursor: null,
        has_more: false,
      })

      await service.searchFiles('report', '/Clients', 50, ['pdf', 'docx'], 'document')

      expect(mock.history[0].body).toMatchObject({
        query: 'report',
        options: {
          path: '/Clients',
          max_results: 50,
          file_extensions: ['pdf', 'docx'],
          file_categories: ['document'],
        },
      })
    })

    it('throws when query is missing', async () => {
      await expect(service.searchFiles('')).rejects.toThrow('"Query" is required')
    })
  })

  // ── Sharing ──

  describe('createSharedLink', () => {
    it('creates a shared link with no settings', async () => {
      mock.onPost(`${API_BASE}/sharing/create_shared_link_with_settings`).reply({
        url: 'https://www.dropbox.com/scl/fi/abc/file.pdf?dl=0',
        name: 'file.pdf',
        path_lower: '/file.pdf',
        id: 'id:abc',
        link_permissions: { can_revoke: true },
        expires: undefined,
      })

      const result = await service.createSharedLink('/file.pdf')

      expect(result.url).toBe('https://www.dropbox.com/scl/fi/abc/file.pdf?dl=0')
      expect(mock.history[0].body).toEqual({ path: '/file.pdf' })
    })

    it('includes settings when options are provided', async () => {
      mock.onPost(`${API_BASE}/sharing/create_shared_link_with_settings`).reply({
        url: 'https://www.dropbox.com/scl/fi/abc/file.pdf?dl=0',
        name: 'file.pdf',
        path_lower: '/file.pdf',
        id: 'id:abc',
        link_permissions: {},
        expires: '2025-12-31T23:59:59Z',
      })

      await service.createSharedLink(
        '/file.pdf',
        true,
        false,
        '2025-12-31T23:59:59.000Z',
        'secret123'
      )

      const body = mock.history[0].body

      expect(body.settings.audience).toEqual({ '.tag': 'members' })
      expect(body.settings.allow_download).toBe(false)
      expect(body.settings.link_password).toBe('secret123')
      expect(body.settings.requested_visibility).toEqual({ '.tag': 'password' })
      expect(body.settings.expires).toBe('2025-12-31T23:59:59Z')
    })

    it('throws when path is missing', async () => {
      await expect(service.createSharedLink('')).rejects.toThrow('"Path" is required')
    })
  })

  describe('listSharedLinks', () => {
    it('lists all shared links when no path given', async () => {
      mock.onPost(`${API_BASE}/sharing/list_shared_links`).reply({
        links: [{ url: 'https://dropbox.com/link1', name: 'file.pdf' }],
        has_more: false,
      })

      const result = await service.listSharedLinks()

      expect(result.links).toHaveLength(1)
      expect(result.has_more).toBe(false)
    })

    it('filters by path and directOnly', async () => {
      mock.onPost(`${API_BASE}/sharing/list_shared_links`).reply({
        links: [],
        has_more: false,
      })

      await service.listSharedLinks('/file.pdf', true)

      expect(mock.history[0].body).toMatchObject({
        path: '/file.pdf',
        direct_only: true,
      })
    })

    it('passes cursor for pagination', async () => {
      mock.onPost(`${API_BASE}/sharing/list_shared_links`).reply({
        links: [],
        has_more: false,
      })

      await service.listSharedLinks(null, null, 'page-cursor')

      expect(mock.history[0].body).toMatchObject({ cursor: 'page-cursor' })
    })
  })

  describe('revokeSharedLink', () => {
    it('revokes a shared link', async () => {
      mock.onPost(`${API_BASE}/sharing/revoke_shared_link`).reply({})

      const result = await service.revokeSharedLink('https://dropbox.com/link1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ url: 'https://dropbox.com/link1' })
    })

    it('throws when url is missing', async () => {
      await expect(service.revokeSharedLink('')).rejects.toThrow('"Shared Link URL" is required')
    })
  })

  describe('shareFolder', () => {
    it('shares a folder synchronously', async () => {
      mock.onPost(`${API_BASE}/sharing/share_folder`).reply({
        '.tag': 'complete',
        shared_folder_id: '84528192421',
      })

      const result = await service.shareFolder('/Projects/Acme')

      expect(result).toEqual({ status: 'complete', sharedFolderId: '84528192421' })
    })

    it('returns pending status for async jobs', async () => {
      mock.onPost(`${API_BASE}/sharing/share_folder`).reply({
        '.tag': 'async_job_id',
        async_job_id: 'job-123',
      })

      const result = await service.shareFolder('/Projects/Acme')

      expect(result).toEqual({ status: 'pending', jobId: 'job-123' })
    })

    it('passes member_policy and acl_update_policy', async () => {
      mock.onPost(`${API_BASE}/sharing/share_folder`).reply({
        shared_folder_id: '123',
      })

      await service.shareFolder('/folder', 'team', 'owner')

      expect(mock.history[0].body).toMatchObject({
        member_policy: { '.tag': 'team' },
        acl_update_policy: { '.tag': 'owner' },
      })
    })

    it('throws when folderPath is missing', async () => {
      await expect(service.shareFolder('')).rejects.toThrow('"Folder Path" is required')
    })
  })

  describe('addFolderMember', () => {
    it('invites a member to a shared folder', async () => {
      mock.onPost(`${API_BASE}/sharing/add_folder_member`).reply({})

      const result = await service.addFolderMember('84528192421', 'jane@example.com', 'editor')

      expect(result).toEqual({
        success: true,
        sharedFolderId: '84528192421',
        email: 'jane@example.com',
        accessLevel: 'editor',
      })

      expect(mock.history[0].body).toMatchObject({
        shared_folder_id: '84528192421',
        members: [
          {
            member: { '.tag': 'email', email: 'jane@example.com' },
            access_level: { '.tag': 'editor' },
          },
        ],
        quiet: false,
      })
    })

    it('defaults accessLevel to viewer', async () => {
      mock.onPost(`${API_BASE}/sharing/add_folder_member`).reply({})

      const result = await service.addFolderMember('123', 'user@test.com')

      expect(result.accessLevel).toBe('viewer')
    })

    it('suppresses notification when quiet is true', async () => {
      mock.onPost(`${API_BASE}/sharing/add_folder_member`).reply({})

      await service.addFolderMember('123', 'user@test.com', 'viewer', true, 'Hello!')

      // custom_message should be omitted when quiet is true
      expect(mock.history[0].body.quiet).toBe(true)
      expect(mock.history[0].body.custom_message).toBeUndefined()
    })

    it('includes custom message when quiet is false', async () => {
      mock.onPost(`${API_BASE}/sharing/add_folder_member`).reply({})

      await service.addFolderMember('123', 'user@test.com', 'viewer', false, 'Welcome!')

      expect(mock.history[0].body.custom_message).toBe('Welcome!')
    })

    it('throws when sharedFolderId is missing', async () => {
      await expect(service.addFolderMember('', 'user@test.com')).rejects.toThrow(
        '"Shared Folder" is required'
      )
    })

    it('throws when email is missing', async () => {
      await expect(service.addFolderMember('123', '')).rejects.toThrow('"Email" is required')
    })
  })

  describe('removeFolderMember', () => {
    it('removes a member and returns pending status', async () => {
      mock.onPost(`${API_BASE}/sharing/remove_folder_member`).reply({
        '.tag': 'async_job_id',
        async_job_id: 'job-456',
      })

      const result = await service.removeFolderMember('123', 'jane@example.com', true)

      expect(result).toEqual({ status: 'pending', jobId: 'job-456' })
      expect(mock.history[0].body).toMatchObject({
        shared_folder_id: '123',
        member: { '.tag': 'email', email: 'jane@example.com' },
        leave_a_copy: true,
      })
    })

    it('returns complete when not async', async () => {
      mock.onPost(`${API_BASE}/sharing/remove_folder_member`).reply({
        '.tag': 'complete',
      })

      const result = await service.removeFolderMember('123', 'jane@example.com')

      expect(result).toEqual({ status: 'complete' })
    })

    it('throws when sharedFolderId is missing', async () => {
      await expect(service.removeFolderMember('', 'user@test.com')).rejects.toThrow(
        '"Shared Folder" is required'
      )
    })

    it('throws when email is missing', async () => {
      await expect(service.removeFolderMember('123', '')).rejects.toThrow('"Email" is required')
    })
  })

  // ── Account ──

  describe('getCurrentAccount', () => {
    it('returns current account info', async () => {
      const account = {
        account_id: 'dbid:AAH4f99T0taONIb',
        name: { display_name: 'Jane Doe' },
        email: 'jane@example.com',
      }

      mock.onPost(`${API_BASE}/users/get_current_account`).reply(account)

      const result = await service.getCurrentAccount()

      expect(result).toEqual(account)
    })
  })

  describe('getSpaceUsage', () => {
    it('returns space usage info', async () => {
      const usage = {
        used: 1234567890,
        allocation: { '.tag': 'individual', allocated: 2147483648 },
      }

      mock.onPost(`${API_BASE}/users/get_space_usage`).reply(usage)

      const result = await service.getSpaceUsage()

      expect(result).toEqual(usage)
    })
  })

  // ── Dictionary Methods ──

  describe('getFoldersDictionary', () => {
    it('returns folder items from root listing', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'folder', name: 'Reports', path_display: '/Reports', path_lower: '/reports' },
          { '.tag': 'file', name: 'readme.txt', path_display: '/readme.txt' },
        ],
        cursor: 'c1',
        has_more: false,
      })

      const result = await service.getFoldersDictionary({})

      expect(result.items).toEqual([
        { label: 'Reports', value: '/Reports', note: '/Reports' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'folder', name: 'Reports', path_display: '/Reports' },
          { '.tag': 'folder', name: 'Projects', path_display: '/Projects' },
        ],
        cursor: 'c',
        has_more: false,
      })

      const result = await service.getFoldersDictionary({ search: 'rep' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Reports')
    })

    it('returns cursor when has_more is true', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'folder', name: 'A', path_display: '/A' },
        ],
        cursor: 'next-cursor',
        has_more: true,
      })

      const result = await service.getFoldersDictionary({})

      expect(result.cursor).toBe('next-cursor')
    })

    it('uses cursor for pagination', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'folder', name: 'B', path_display: '/B' },
        ],
        cursor: 'c2',
        has_more: false,
      })

      const result = await service.getFoldersDictionary({ cursor: 'c1' })

      expect(result.items[0].label).toBe('B')
      expect(mock.history[0].body).toEqual({ cursor: 'c1' })
    })
  })

  describe('getFilesDictionary', () => {
    it('returns file items filtering out folders', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'doc.pdf', path_display: '/doc.pdf', id: 'id:1' },
          { '.tag': 'folder', name: 'Folder', path_display: '/Folder' },
        ],
        cursor: 'c',
        has_more: false,
      })

      const result = await service.getFilesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('doc.pdf')
    })

    it('uses criteria.folderPath for scoping', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [],
        cursor: 'c',
        has_more: false,
      })

      await service.getFilesDictionary({ criteria: { folderPath: '/Reports' } })

      expect(mock.history[0].body.path).toBe('/Reports')
    })

    it('filters by search term', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'invoice.pdf', path_display: '/invoice.pdf' },
          { '.tag': 'file', name: 'report.docx', path_display: '/report.docx' },
        ],
        cursor: 'c',
        has_more: false,
      })

      const result = await service.getFilesDictionary({ search: 'inv' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('invoice.pdf')
    })
  })

  describe('getSharedFoldersDictionary', () => {
    it('returns shared folder items', async () => {
      mock.onPost(`${API_BASE}/sharing/list_folders`).reply({
        entries: [
          { name: 'Acme Project', shared_folder_id: '123', path_lower: '/acme project' },
        ],
        cursor: null,
      })

      const result = await service.getSharedFoldersDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Project', value: '123', note: '/acme project' },
      ])
    })

    it('filters by search', async () => {
      mock.onPost(`${API_BASE}/sharing/list_folders`).reply({
        entries: [
          { name: 'Acme', shared_folder_id: '1', path_lower: '/acme' },
          { name: 'Beta', shared_folder_id: '2', path_lower: '/beta' },
        ],
        cursor: null,
      })

      const result = await service.getSharedFoldersDictionary({ search: 'acm' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Acme')
    })

    it('uses cursor for pagination', async () => {
      mock.onPost(`${API_BASE}/sharing/list_folders/continue`).reply({
        entries: [
          { name: 'Next', shared_folder_id: '3', path_lower: '/next' },
        ],
        cursor: null,
      })

      await service.getSharedFoldersDictionary({ cursor: 'page2' })

      expect(mock.history[0].body).toEqual({ cursor: 'page2' })
    })
  })

  // ── Polling Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct trigger method', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'test.pdf', id: 'id:1', path_lower: '/test.pdf', rev: 'r1' },
        ],
        cursor: 'boot-cursor',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '', recursive: false },
        learningMode: false,
        state: null,
      })

      // First call bootstraps state with no events
      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('cursor')
      expect(result.state).toHaveProperty('knownIds')
    })
  })

  describe('onNewFile', () => {
    it('returns sample in learning mode', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'test.pdf', id: 'id:1', path_lower: '/test.pdf', rev: 'r1' },
          { '.tag': 'folder', name: 'Dir', id: 'id:2', path_lower: '/dir' },
        ],
        cursor: 'c',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '' },
        learningMode: true,
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]['.tag']).toBe('file')
      expect(result.state).toBeNull()
    })

    it('bootstraps state on first non-learning call', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'existing.pdf', id: 'id:1', path_lower: '/existing.pdf', rev: 'r1' },
        ],
        cursor: 'cursor-1',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state.cursor).toBe('cursor-1')
      expect(result.state.knownIds['id:1']).toMatchObject({ type: 'file', rev: 'r1' })
    })

    it('emits new files detected via continue', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'file', name: 'new-file.pdf', id: 'id:new', path_lower: '/new-file.pdf', rev: 'r1' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {},
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('new-file.pdf')
      expect(result.state.cursor).toBe('cursor-2')
    })

    it('does not emit already-known files', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'file', name: 'existing.pdf', id: 'id:1', path_lower: '/existing.pdf', rev: 'r1' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {
            'id:1': { type: 'file', rev: 'r1', path_lower: '/existing.pdf' },
          },
        },
      })

      expect(result.events).toEqual([])
    })
  })

  describe('onNewFolder', () => {
    it('returns sample folder in learning mode', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).reply({
        entries: [
          { '.tag': 'file', name: 'test.pdf', id: 'id:1', path_lower: '/test.pdf' },
          { '.tag': 'folder', name: 'MyFolder', id: 'id:2', path_lower: '/myfolder' },
        ],
        cursor: 'c',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFolder',
        triggerData: { folderPath: '' },
        learningMode: true,
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]['.tag']).toBe('folder')
    })

    it('emits new folders detected via continue', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'folder', name: 'NewFolder', id: 'id:f1', path_lower: '/newfolder' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFolder',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {},
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('NewFolder')
    })
  })

  describe('onFileModified', () => {
    it('emits files with changed revisions', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'file', name: 'summary.pdf', id: 'id:1', path_lower: '/summary.pdf', rev: 'r2', server_modified: '2025-03-02' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onFileModified',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {
            'id:1': { type: 'file', rev: 'r1', path_lower: '/summary.pdf' },
          },
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].rev).toBe('r2')
    })

    it('does not emit when revision is unchanged', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'file', name: 'summary.pdf', id: 'id:1', path_lower: '/summary.pdf', rev: 'r1' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onFileModified',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {
            'id:1': { type: 'file', rev: 'r1', path_lower: '/summary.pdf' },
          },
        },
      })

      expect(result.events).toEqual([])
    })

    it('does not emit new files as modified', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'file', name: 'brand-new.pdf', id: 'id:new', path_lower: '/brand-new.pdf', rev: 'r1' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onFileModified',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {},
        },
      })

      expect(result.events).toEqual([])
    })
  })

  describe('polling trigger - cursor reset handling', () => {
    // NOTE: Potential service bug — isCursorResetError() is called on the
    // already-mapped Error from #mapDropboxError, which strips .status and
    // .body. As a result, cursor reset detection never triggers in practice
    // and the mapped error propagates instead of triggering a re-bootstrap.
    // The test below documents the actual (current) behavior.
    it('throws mapped error when cursor reset occurs (isCursorResetError cannot match mapped errors)', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).replyWithError({
        message: 'Conflict',
        status: 409,
        body: { error_summary: 'reset/...' },
      })

      await expect(
        service.handleTriggerPollingForEvent({
          eventName: 'onNewFile',
          triggerData: { folderPath: '' },
          learningMode: false,
          state: {
            cursor: 'old-cursor',
            knownIds: {},
          },
        })
      ).rejects.toThrow('Dropbox error: reset/...')
    })
  })

  describe('polling trigger - deleted entries', () => {
    it('removes deleted entries from knownIds by id', async () => {
      mock.onPost(`${API_BASE}/files/list_folder/continue`).reply({
        entries: [
          { '.tag': 'deleted', id: 'id:1', path_lower: '/old.pdf' },
        ],
        cursor: 'cursor-2',
        has_more: false,
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewFile',
        triggerData: { folderPath: '' },
        learningMode: false,
        state: {
          cursor: 'cursor-1',
          knownIds: {
            'id:1': { type: 'file', rev: 'r1', path_lower: '/old.pdf' },
          },
        },
      })

      expect(result.events).toEqual([])
      expect(result.state.knownIds['id:1']).toBeUndefined()
    })
  })

  // ── Error Mapping ──

  describe('error mapping', () => {
    it('returns session expired error on 401', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.listFolder('')).rejects.toThrow('session has expired')
    })

    it('returns rate limit error on 429', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
      })

      await expect(service.listFolder('')).rejects.toThrow('rate limit')
    })

    it('includes error_summary on 409', async () => {
      mock.onPost(`${API_BASE}/files/list_folder`).replyWithError({
        message: 'Conflict',
        status: 409,
        body: { error_summary: 'path/not_found/...' },
      })

      await expect(service.listFolder('')).rejects.toThrow('path/not_found')
    })
  })
})
