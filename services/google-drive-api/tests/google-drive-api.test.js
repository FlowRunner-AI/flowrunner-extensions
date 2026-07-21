'use strict'

// ── Mock Google API SDK ──

const mockDriveFiles = {
  list  : jest.fn(),
  get   : jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  copy  : jest.fn(),
  export: jest.fn(),
}

const mockDrivePermissions = {
  create: jest.fn(),
}

const mockDrives = {
  list: jest.fn(),
}

jest.mock('@googleapis/drive', () => ({
  drive: jest.fn(() => ({
    files      : mockDriveFiles,
    permissions: mockDrivePermissions,
    drives     : mockDrives,
  })),
}))

jest.mock('@googleapis/oauth2', () => ({
  auth: {
    OAuth2: jest.fn().mockImplementation(() => ({
      setCredentials: jest.fn(),
    })),
  },
}))

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Drive Service', () => {
  let sandbox
  let service
  let mock
  let filesUploadHistory

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }

    filesUploadHistory = []
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn(async (buffer, options) => {
          filesUploadHistory.push({ buffer, options })

          return { url: 'https://storage.example.com/mock-file.pdf' }
        }),
      },
    }
  })

  afterEach(() => {
    mock.reset()
    jest.clearAllMocks()
    filesUploadHistory = []
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true, type: 'STRING' }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true, type: 'STRING' }),
        ]),
      )
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL with all required params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in  : 3600,
      })

      const result = await service.refreshToken('test-refresh-token')

      expect(result).toEqual({
        token              : 'new-access-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].query).toMatchObject({
        client_id    : CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: 'test-refresh-token',
        grant_type   : 'refresh_token',
      })
    })

    it('throws specific error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body   : { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body   : { error: 'server_error' },
      })

      await expect(service.refreshToken('some-token'))
        .rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches profile', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token : 'new-access',
        expires_in   : 3600,
        refresh_token: 'new-refresh',
      })

      mock.onGet(PROFILE_URL).reply({
        name   : 'Test User',
        email  : 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code       : 'auth-code',
        redirectURI: 'https://app.example.com/callback',
      })

      expect(result).toEqual({
        token                     : 'new-access',
        refreshToken              : 'new-refresh',
        expirationInSeconds       : 3600,
        overwrite                 : true,
        connectionIdentityName    : 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
      })

      expect(mock.history).toHaveLength(2)

      // Token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toContain('client_id=test-client-id')
      expect(mock.history[0].body).toContain('code=auth-code')
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('client_secret=test-client-secret')

      // Profile request
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access',
      })
    })

    it('returns default identity name when profile fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token : 'new-access',
        expires_in   : 3600,
        refresh_token: 'new-refresh',
      })

      mock.onGet(PROFILE_URL).replyWithError({
        message: 'Unauthorized',
        body   : { error: 'profile_error' },
      })

      const result = await service.executeCallback({
        code       : 'auth-code',
        redirectURI: 'https://app.example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Google Drive User')
      expect(result.connectionIdentityImageURL).toBeUndefined()
    })
  })

  // ── Dictionary Methods ──

  describe('getDrivesDictionary', () => {
    it('returns drives list with My Drive prepended', async () => {
      mockDrives.list.mockResolvedValue({
        data: {
          nextPageToken: 'token-2',
          drives       : [
            { id: 'shared-1', name: 'Team Drive' },
          ],
        },
      })

      const result = await service.getDrivesDictionary({ search: undefined, cursor: undefined })

      expect(result).toEqual({
        cursor: 'token-2',
        items : [
          { label: 'My Google Drive', value: 'MY_GOOGLE_DRIVE', note: 'ID: MY_GOOGLE_DRIVE' },
          { label: 'Team Drive', value: 'shared-1', note: 'ID: shared-1' },
        ],
      })
    })

    it('passes search query to the API', async () => {
      mockDrives.list.mockResolvedValue({
        data: { nextPageToken: undefined, drives: [] },
      })

      await service.getDrivesDictionary({ search: 'Marketing', cursor: 'page-2' })

      expect(mockDrives.list).toHaveBeenCalledWith(
        expect.objectContaining({
          pageToken           : 'page-2',
          q                   : 'name contains \'Marketing\'',
          useDomainAdminAccess: true,
        }),
      )
    })

    it('falls back to listing without admin access on error', async () => {
      mockDrives.list
        .mockRejectedValueOnce(new Error('Admin access denied'))
        .mockResolvedValueOnce({
          data: { nextPageToken: undefined, drives: [] },
        })

      const result = await service.getDrivesDictionary({ search: undefined, cursor: undefined })

      expect(mockDrives.list).toHaveBeenCalledTimes(2)
      expect(result.items).toHaveLength(1) // only My Drive
    })
  })

  describe('getFoldersDictionary', () => {
    it('queries for folders with search filter', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          nextPageToken: undefined,
          files        : [{ id: 'folder-1', name: 'Reports' }],
        },
      })

      const result = await service.getFoldersDictionary({
        search  : 'Reports',
        cursor  : undefined,
        criteria: { sharedDriveId: undefined },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('mimeType = \'application/vnd.google-apps.folder\''),
        }),
      )

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('name contains \'Reports\''),
        }),
      )

      expect(result.items).toEqual([
        { label: 'Reports', value: 'folder-1', note: 'ID: folder-1' },
      ])
    })
  })

  describe('getFilesDictionary', () => {
    it('queries for non-folder files', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          nextPageToken: 'next-page',
          files        : [{ id: 'file-1', name: 'report.pdf' }],
        },
      })

      const result = await service.getFilesDictionary({
        search  : undefined,
        cursor  : undefined,
        criteria: { sharedDriveId: undefined },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('mimeType != \'application/vnd.google-apps.folder\''),
        }),
      )

      expect(result).toEqual({
        items : [{ label: 'report.pdf', value: 'file-1', note: 'ID: file-1' }],
        cursor: 'next-page',
      })
    })
  })

  describe('getFilesAndFoldersDictionary', () => {
    it('queries without mimeType filter', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { nextPageToken: undefined, files: [] },
      })

      await service.getFilesAndFoldersDictionary({
        search  : undefined,
        cursor  : undefined,
        criteria: { sharedDriveId: undefined },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: undefined,
        }),
      )
    })

    it('passes search to query when provided', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { nextPageToken: undefined, files: [] },
      })

      await service.getFilesAndFoldersDictionary({
        search  : 'test',
        cursor  : undefined,
        criteria: { sharedDriveId: undefined },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'name contains \'test\'',
        }),
      )
    })
  })

  // ── Shared Drive ID Resolution ──

  describe('shared drive resolution', () => {
    it('resolves MY_GOOGLE_DRIVE to undefined', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { nextPageToken: undefined, files: [] },
      })

      await service.getFilesDictionary({
        search  : undefined,
        cursor  : undefined,
        criteria: { sharedDriveId: 'MY_GOOGLE_DRIVE' },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith({
        fields   : 'nextPageToken,files(id,name)',
        pageToken: undefined,
        q        : 'mimeType != \'application/vnd.google-apps.folder\'',
      })
    })

    it('passes real shared drive ID', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { nextPageToken: undefined, files: [] },
      })

      await service.getFilesDictionary({
        search  : undefined,
        cursor  : undefined,
        criteria: { sharedDriveId: 'real-drive-id' },
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          driveId                  : 'real-drive-id',
          corpora                  : 'drive',
          includeItemsFromAllDrives: true,
          supportsAllDrives        : true,
        }),
      )
    })
  })

  // ── Action Methods ──

  describe('addSharingPreference', () => {
    it('creates permission and returns webViewLink', async () => {
      mockDrivePermissions.create.mockResolvedValue({})
      mockDriveFiles.get.mockResolvedValue({
        data: { webViewLink: 'https://drive.google.com/file/d/abc/view' },
      })

      const result = await service.addSharingPreference('file-1', 'user', 'writer', 'test@example.com', undefined)

      expect(mockDrivePermissions.create).toHaveBeenCalledWith({
        fileId     : 'file-1',
        requestBody: {
          role        : 'writer',
          type        : 'user',
          domain      : undefined,
          emailAddress: 'test@example.com',
        },
      })

      expect(result).toEqual({ url: 'https://drive.google.com/file/d/abc/view' })
    })

    it('requires domain when shareFor is domain', async () => {
      await expect(
        service.addSharingPreference('file-1', 'domain', 'reader', undefined, undefined),
      ).rejects.toThrow('Domain is required')
    })

    it('requires email when shareFor is user', async () => {
      await expect(
        service.addSharingPreference('file-1', 'user', 'reader', undefined, undefined),
      ).rejects.toThrow('Email is required')
    })

    it('requires email when shareFor is group', async () => {
      await expect(
        service.addSharingPreference('file-1', 'group', 'reader', undefined, undefined),
      ).rejects.toThrow('Email is required')
    })

    it('throws when fileId is missing', async () => {
      await expect(
        service.addSharingPreference(undefined, 'anyone', 'reader', undefined, undefined),
      ).rejects.toThrow('File ID is required')
    })

    it('throws when shareFor is missing', async () => {
      await expect(
        service.addSharingPreference('file-1', undefined, 'reader', undefined, undefined),
      ).rejects.toThrow('Share For property is required')
    })

    it('throws when role is missing', async () => {
      await expect(
        service.addSharingPreference('file-1', 'anyone', undefined, undefined, undefined),
      ).rejects.toThrow('Role is required')
    })
  })

  describe('createShortcut', () => {
    it('creates shortcut and returns webViewLink', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: { webViewLink: 'https://drive.google.com/file/d/shortcut/view' },
      })

      const result = await service.createShortcut(undefined, 'target-file-id', 'folder-id')

      expect(mockDriveFiles.create).toHaveBeenCalledWith({
        requestBody: {
          driveId        : undefined,
          mimeType       : 'application/vnd.google-apps.shortcut',
          parents        : ['folder-id'],
          shortcutDetails: { targetId: 'target-file-id' },
        },
        fields     : 'webViewLink',
      })

      expect(result).toEqual({ url: 'https://drive.google.com/file/d/shortcut/view' })
    })

    it('creates shortcut without folder', async () => {
      mockDriveFiles.create.mockResolvedValue({
        data: { webViewLink: 'https://drive.google.com/file/d/shortcut/view' },
      })

      await service.createShortcut(undefined, 'target-file-id', undefined)

      expect(mockDriveFiles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: undefined,
          }),
        }),
      )
    })
  })

  describe('createFile', () => {
    it('creates a plain text file', async () => {
      mockDriveFiles.create.mockResolvedValue({ data: { id: 'new-file-id' } })

      const result = await service.createFile(undefined, 'folder-1', 'test.txt', 'Hello World', false)

      expect(mockDriveFiles.create).toHaveBeenCalledWith({
        media            : { mimeType: 'text/plain', body: 'Hello World' },
        requestBody      : {
          driveId : undefined,
          parents : ['folder-1'],
          name    : 'test.txt',
          mimeType: undefined,
        },
        supportsAllDrives: true,
      })

      expect(result).toEqual({ id: 'new-file-id' })
    })

    it('creates a Google Document when asDocument is true', async () => {
      mockDriveFiles.create.mockResolvedValue({ data: { id: 'doc-id' } })

      await service.createFile(undefined, 'folder-1', 'My Doc', 'Content', true)

      expect(mockDriveFiles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            mimeType: 'application/vnd.google-apps.document',
          }),
        }),
      )
    })
  })

  describe('moveFile', () => {
    it('moves file to target folder', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { parents: ['old-parent'] },
      })
      mockDriveFiles.update.mockResolvedValue({})

      await service.moveFile(undefined, 'file-1', 'new-folder')

      expect(mockDriveFiles.get).toHaveBeenCalledWith({
        fileId: 'file-1',
        fields: 'parents',
      })

      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId       : 'file-1',
        requestBody  : { driveId: undefined },
        addParents   : 'new-folder',
        removeParents: 'old-parent',
        fields       : 'id',
      })
    })

    it('moves file to root when no target folder', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { parents: ['old-parent'] },
      })
      mockDriveFiles.update.mockResolvedValue({})

      await service.moveFile(undefined, 'file-1', undefined)

      expect(mockDriveFiles.update).toHaveBeenCalledWith(
        expect.objectContaining({
          addParents: 'root',
        }),
      )
    })

    it('throws when fileId is missing', async () => {
      await expect(service.moveFile(undefined, undefined, 'folder'))
        .rejects.toThrow('File ID is required')
    })
  })

  describe('getFileContent', () => {
    it('exports Google Docs using content mime mapper', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { name: 'My Doc', mimeType: 'application/vnd.google-apps.document' },
      })
      mockDriveFiles.export.mockResolvedValue({ data: 'Document text content' })

      const result = await service.getFileContent('doc-id')

      expect(mockDriveFiles.export).toHaveBeenCalledWith(
        { fileId: 'doc-id', mimeType: 'text/plain' },
        { responseType: 'text' },
      )

      expect(result).toEqual({ content: 'Document text content' })
    })

    it('downloads regular text files directly', async () => {
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { name: 'file.txt', mimeType: 'text/plain' } })
        .mockResolvedValueOnce({ data: 'Plain text content' })

      const result = await service.getFileContent('text-file-id')

      expect(mockDriveFiles.get).toHaveBeenCalledWith(
        { fileId: 'text-file-id', alt: 'media', supportsAllDrives: true },
        { responseType: 'text' },
      )

      expect(result).toEqual({ content: 'Plain text content' })
    })

    it('throws for binary files', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { name: 'photo.png', mimeType: 'image/png' },
      })

      await expect(service.getFileContent('image-id'))
        .rejects.toThrow('Cannot read text content from binary file')
    })

    it('throws when fileId is missing', async () => {
      await expect(service.getFileContent(undefined))
        .rejects.toThrow('File ID must be provided')
    })
  })

  describe('getFileData', () => {
    it('returns file metadata', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: {
          mimeType    : 'application/pdf',
          id          : 'file-1',
          webViewLink : 'https://drive.google.com/file/d/file-1/view',
          parents     : ['parent-folder'],
          name        : 'report.pdf',
          createdTime : '2025-01-01T00:00:00Z',
          modifiedTime: '2025-01-02T00:00:00Z',
        },
      })

      const result = await service.getFileData('file-1')

      expect(mockDriveFiles.get).toHaveBeenCalledWith({
        fileId           : 'file-1',
        supportsAllDrives: true,
        fields           : 'mimeType,id,webViewLink,parents,name,createdTime,modifiedTime',
      })

      expect(result).toEqual({
        mimeType      : 'application/pdf',
        id            : 'file-1',
        webViewLink   : 'https://drive.google.com/file/d/file-1/view',
        parentFolderId: 'parent-folder',
        name          : 'report.pdf',
        createdTime   : '2025-01-01T00:00:00Z',
        modifiedTime  : '2025-01-02T00:00:00Z',
      })
    })

    it('returns null parentFolderId when no parents', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: {
          mimeType    : 'text/plain',
          id          : 'file-2',
          webViewLink : 'https://drive.google.com/file/d/file-2/view',
          parents     : undefined,
          name        : 'notes.txt',
          createdTime : '2025-01-01T00:00:00Z',
          modifiedTime: '2025-01-02T00:00:00Z',
        },
      })

      const result = await service.getFileData('file-2')

      expect(result.parentFolderId).toBeNull()
    })

    it('throws when fileId is missing', async () => {
      await expect(service.getFileData(undefined))
        .rejects.toThrow('File ID must be provided')
    })
  })

  describe('downloadFile', () => {
    it('exports Google Workspace files using MimeMapper', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { name: 'My Doc', mimeType: 'application/vnd.google-apps.document' },
      })
      mockDriveFiles.export.mockResolvedValue({
        data: Buffer.from('pdf-content'),
      })

      const result = await service.downloadFile('doc-id', '/downloads')

      expect(mockDriveFiles.export).toHaveBeenCalledWith(
        { fileId: 'doc-id', mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' },
      )

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        {
          filename   : 'My Doc',
          generateUrl: true,
          overwrite  : true,
          scope      : 'FLOW',
        },
      )

      expect(result).toEqual({ url: 'https://storage.example.com/mock-file.pdf' })
    })

    it('downloads non-Google files directly', async () => {
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { name: 'report.pdf', mimeType: 'application/pdf' } })
        .mockResolvedValueOnce({ data: Buffer.from('binary-data') })

      const result = await service.downloadFile('pdf-id', undefined)

      expect(mockDriveFiles.get).toHaveBeenLastCalledWith(
        { fileId: 'pdf-id', alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      )

      expect(result).toEqual({ url: 'https://storage.example.com/mock-file.pdf' })
    })

    it('throws when fileId is missing', async () => {
      await expect(service.downloadFile(undefined, '/downloads'))
        .rejects.toThrow('File ID must be provided')
    })
  })

  describe('exportFile', () => {
    it('exports file and uploads to Flowrunner Files', async () => {
      mockDriveFiles.get.mockResolvedValue({
        data: { name: 'Spreadsheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
      })
      mockDriveFiles.export.mockResolvedValue({
        data: Buffer.from('csv-content'),
      })

      const result = await service.exportFile('sheet-id', '/exports', 'data.csv')

      expect(mockDriveFiles.export).toHaveBeenCalledWith(
        { fileId: 'sheet-id', mimeType: 'text/csv' },
        { responseType: 'arraybuffer' },
      )

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'data.csv' }),
      )

      expect(result).toEqual({ url: 'https://storage.example.com/mock-file.pdf' })
    })

    it('uses original filename when targetFileName not provided', async () => {
      mockDriveFiles.get
        .mockResolvedValueOnce({ data: { name: 'photo.jpg', mimeType: 'image/jpeg' } })
        .mockResolvedValueOnce({ data: Buffer.from('image-data') })

      await service.exportFile('img-id', undefined, undefined)

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'photo.jpg' }),
      )
    })

    it('throws when fileId is missing', async () => {
      await expect(service.exportFile(undefined, '/exports', 'file.pdf'))
        .rejects.toThrow('File ID must be provided')
    })
  })

  describe('findFolder', () => {
    it('returns first matching folder', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { kind: 'drive#file', id: 'folder-1', name: 'Reports', mimeType: 'application/vnd.google-apps.folder' },
          ],
        },
      })

      const result = await service.findFolder(undefined, 'Reports')

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q       : expect.stringContaining('mimeType = \'application/vnd.google-apps.folder\''),
          pageSize: 1,
        }),
      )

      expect(result).toEqual(
        expect.objectContaining({ id: 'folder-1', name: 'Reports' }),
      )
    })

    it('searches without name filter when search is empty', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.findFolder(undefined, undefined)

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'mimeType = \'application/vnd.google-apps.folder\'',
        }),
      )
    })
  })

  describe('findFile', () => {
    it('returns first matching file with all filters', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [{ id: 'file-1', name: 'report.pdf', mimeType: 'application/pdf' }],
        },
      })

      const result = await service.findFile('drive-1', 'report', 'folder-1', 'application/pdf')

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q       : expect.stringContaining('name contains \'report\''),
          pageSize: 1,
        }),
      )

      const query = mockDriveFiles.list.mock.calls[0][0].q

      expect(query).toContain('\'folder-1\' in parents')
      expect(query).toContain('mimeType contains \'application/pdf\'')

      expect(result).toEqual(expect.objectContaining({ id: 'file-1' }))
    })

    it('returns undefined when no files match', async () => {
      mockDriveFiles.list.mockResolvedValue({ data: { files: [] } })

      const result = await service.findFile(undefined, 'nonexistent', undefined, undefined)

      expect(result).toBeUndefined()
    })

    it('passes no query when all filters are empty', async () => {
      mockDriveFiles.list.mockResolvedValue({ data: { files: [] } })

      await service.findFile(undefined, undefined, undefined, undefined)

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({ q: undefined }),
      )
    })
  })

  describe('findMultipleFiles', () => {
    it('returns files with file paths', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', kind: 'drive#file', mimeType: 'application/pdf', name: 'report.pdf', parents: ['root-id'] },
          ],
        },
      })

      // Mock for buildFilePath - parent folder lookup
      mockDriveFiles.get.mockRejectedValue(new Error('Root reached'))

      const result = await service.findMultipleFiles(undefined, 'report', undefined, undefined)

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q       : expect.stringContaining('trashed = false'),
          pageSize: 1000,
          fields  : 'files(id,kind,mimeType,name,parents)',
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('filePath')
      expect(result[0]).toHaveProperty('id', 'f1')
    })

    it('includes all query filters', async () => {
      mockDriveFiles.list.mockResolvedValue({ data: { files: [] } })

      await service.findMultipleFiles('drive-1', 'invoice', 'folder-1', 'application/pdf')

      const query = mockDriveFiles.list.mock.calls[0][0].q

      expect(query).toContain('trashed = false')
      expect(query).toContain('name contains \'invoice\'')
      expect(query).toContain('\'folder-1\' in parents')
      expect(query).toContain('mimeType contains \'application/pdf\'')
    })
  })

  describe('renameEntity', () => {
    it('updates file name', async () => {
      mockDriveFiles.update.mockResolvedValue({})

      await service.renameEntity(undefined, 'file-1', 'New Name.pdf')

      expect(mockDriveFiles.update).toHaveBeenCalledWith({
        fileId           : 'file-1',
        supportsAllDrives: true,
        requestBody      : {
          driveId: undefined,
          name   : 'New Name.pdf',
        },
      })
    })

    it('resolves shared drive ID correctly', async () => {
      mockDriveFiles.update.mockResolvedValue({})

      await service.renameEntity('shared-drive-1', 'file-1', 'New Name')

      expect(mockDriveFiles.update).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            driveId: 'shared-drive-1',
          }),
        }),
      )
    })
  })

  describe('deleteFile', () => {
    it('deletes file with correct params', async () => {
      mockDriveFiles.delete.mockResolvedValue({})

      await service.deleteFile('file-to-delete')

      expect(mockDriveFiles.delete).toHaveBeenCalledWith({
        fileId           : 'file-to-delete',
        supportsAllDrives: true,
      })
    })
  })

  describe('copyFile', () => {
    it('copies file with new name and target folder', async () => {
      mockDriveFiles.copy.mockResolvedValue({ data: { id: 'copy-id' } })

      const result = await service.copyFile(undefined, 'source-id', 'Copy of File', 'target-folder')

      expect(mockDriveFiles.copy).toHaveBeenCalledWith({
        fileId           : 'source-id',
        requestBody      : {
          driveId: undefined,
          name   : 'Copy of File',
          parents: ['target-folder'],
        },
        supportsAllDrives: true,
      })

      expect(result).toEqual({ id: 'copy-id' })
    })

    it('omits optional params when not provided', async () => {
      mockDriveFiles.copy.mockResolvedValue({ data: { id: 'copy-id' } })

      await service.copyFile(undefined, 'source-id', undefined, undefined)

      expect(mockDriveFiles.copy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name   : undefined,
            parents: undefined,
          }),
        }),
      )
    })
  })

  describe('createFolder', () => {
    it('creates folder with correct params', async () => {
      mockDriveFiles.create.mockResolvedValue({ data: { id: 'new-folder-id' } })

      const result = await service.createFolder(undefined, 'parent-id', 'New Folder')

      expect(mockDriveFiles.create).toHaveBeenCalledWith({
        requestBody      : {
          driveId : undefined,
          name    : 'New Folder',
          mimeType: 'application/vnd.google-apps.folder',
          parents : ['parent-id'],
        },
        supportsAllDrives: true,
      })

      expect(result).toEqual({ id: 'new-folder-id' })
    })

    it('creates folder without parent (root)', async () => {
      mockDriveFiles.create.mockResolvedValue({ data: { id: 'root-folder-id' } })

      await service.createFolder(undefined, undefined, 'Root Folder')

      expect(mockDriveFiles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: undefined,
          }),
        }),
      )
    })
  })

  describe('getFolderListing', () => {
    it('lists files in a folder without recurring retrieval', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'doc.txt', mimeType: 'text/plain', webViewLink: 'https://link', parents: ['p1'] },
          ],
        },
      })

      // Mock for buildFilePath
      mockDriveFiles.get.mockRejectedValue(new Error('Root reached'))

      const result = await service.getFolderListing(undefined, 'folder-1', undefined, false, false)

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q       : expect.stringContaining('\'folder-1\' in parents'),
          pageSize: 1000,
          fields  : 'files(*)',
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('id', 'f1')
      expect(result[0]).toHaveProperty('fullPath')
      expect(result[0]).toHaveProperty('name', 'doc.txt')
      expect(result[0]).toHaveProperty('mimeType', 'text/plain')
      expect(result[0]).toHaveProperty('webViewLink', 'https://link')
    })

    it('adds root filter when no folderId and not recurring', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.getFolderListing(undefined, undefined, undefined, false, false)

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('\'root\' in parents'),
        }),
      )
    })

    it('applies name filter for non-mime patterns', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.getFolderListing(undefined, 'folder-1', 'report', false, false)

      const query = mockDriveFiles.list.mock.calls[0][0].q

      expect(query).toContain('name contains \'report\'')
    })

    it('applies mimeType filter for patterns with slash', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.getFolderListing(undefined, 'folder-1', 'application/pdf', false, false)

      const query = mockDriveFiles.list.mock.calls[0][0].q

      expect(query).toContain('mimeType contains \'application/pdf\'')
    })

    it('returns verbose response when enabled', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            {
              id         : 'f1', name: 'doc.txt', mimeType: 'text/plain',
              webViewLink: 'https://link', parents: ['p1'],
              size       : '1234', createdTime: '2025-01-01T00:00:00Z',
            },
          ],
        },
      })

      mockDriveFiles.get.mockRejectedValue(new Error('Root reached'))

      const result = await service.getFolderListing(undefined, 'folder-1', undefined, false, true)

      expect(result[0]).toHaveProperty('size', '1234')
      expect(result[0]).toHaveProperty('createdTime')
      expect(result[0]).toHaveProperty('fullPath')
    })
  })

  // ── Polling Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct event method', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [{ id: 'f1', mimeType: 'application/vnd.google-apps.folder' }] },
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName   : 'onNewFolder',
        triggerData : { sharedDriveId: undefined, folderId: undefined },
        learningMode: true,
      })

      expect(result).toHaveProperty('events')
    })
  })

  describe('onNewFile', () => {
    it('returns first file in learning mode', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'file1.txt', mimeType: 'text/plain' },
            { id: 'f2', name: 'file2.txt', mimeType: 'text/plain' },
          ],
        },
      })

      const result = await service.onNewFile({
        triggerData : {},
        learningMode: true,
      })

      expect(result).toEqual({
        events: [{ id: 'f1', name: 'file1.txt', mimeType: 'text/plain' }],
        state : null,
      })
    })

    it('returns empty events and captures state on first run', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'file1.txt', mimeType: 'text/plain' },
          ],
        },
      })

      const result = await service.onNewFile({
        triggerData : {},
        learningMode: false,
        state       : null,
      })

      expect(result.events).toEqual([])
      expect(result.state.files).toHaveLength(1)
    })

    it('detects new files on subsequent runs', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'file1.txt', mimeType: 'text/plain' },
            { id: 'f2', name: 'file2.txt', mimeType: 'text/plain' },
          ],
        },
      })

      const result = await service.onNewFile({
        triggerData : {},
        learningMode: false,
        state       : {
          files: [{ id: 'f1', name: 'file1.txt', mimeType: 'text/plain' }],
        },
      })

      expect(result.events).toEqual([
        { id: 'f2', name: 'file2.txt', mimeType: 'text/plain' },
      ])
    })

    it('applies files_only trigger configuration', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.onNewFile({
        triggerData : { triggerConfiguration: 'files_only' },
        learningMode: false,
        state       : null,
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('mimeType != \'application/vnd.google-apps.folder\''),
        }),
      )
    })

    it('applies folders_only trigger configuration', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.onNewFile({
        triggerData : { triggerConfiguration: 'folders_only' },
        learningMode: false,
        state       : null,
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('mimeType = \'application/vnd.google-apps.folder\''),
        }),
      )
    })

    it('applies folder filter when folderId provided', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: { files: [] },
      })

      await service.onNewFile({
        triggerData : { folderId: 'folder-abc' },
        learningMode: false,
        state       : null,
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('\'folder-abc\' in parents'),
        }),
      )
    })
  })

  describe('onNewFolder', () => {
    it('returns first folder in learning mode', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [{ id: 'folder-1', name: 'New Folder', mimeType: 'application/vnd.google-apps.folder' }],
        },
      })

      const result = await service.onNewFolder({
        triggerData : {},
        learningMode: true,
      })

      expect(result).toEqual({
        events: [{ id: 'folder-1', name: 'New Folder', mimeType: 'application/vnd.google-apps.folder' }],
        state : null,
      })
    })

    it('filters only folders in query', async () => {
      mockDriveFiles.list.mockResolvedValue({ data: { files: [] } })

      await service.onNewFolder({
        triggerData : {},
        learningMode: false,
        state       : null,
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q      : expect.stringContaining('mimeType = \'application/vnd.google-apps.folder\''),
          orderBy: 'createdTime desc',
        }),
      )
    })

    it('detects new folders on subsequent runs', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'Old', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f2', name: 'New', mimeType: 'application/vnd.google-apps.folder' },
          ],
        },
      })

      const result = await service.onNewFolder({
        triggerData : {},
        learningMode: false,
        state       : {
          files: [{ id: 'f1', name: 'Old', mimeType: 'application/vnd.google-apps.folder' }],
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('f2')
    })
  })

  describe('onFileUpdated', () => {
    it('returns first file in learning mode', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [{ id: 'f1', name: 'file.txt', modifiedTime: '2025-01-01T00:00:00Z' }],
        },
      })

      const result = await service.onFileUpdated({
        triggerData : {},
        learningMode: true,
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('detects modified files by comparing modifiedTime', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'file.txt', modifiedTime: '2025-01-02T00:00:00Z' },
            { id: 'f2', name: 'other.txt', modifiedTime: '2025-01-01T00:00:00Z' },
          ],
        },
      })

      const result = await service.onFileUpdated({
        triggerData : {},
        learningMode: false,
        state       : {
          files: [
            { id: 'f1', name: 'file.txt', modifiedTime: '2025-01-01T00:00:00Z' },
            { id: 'f2', name: 'other.txt', modifiedTime: '2025-01-01T00:00:00Z' },
          ],
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('f1')
    })

    it('does not include new files as updated', async () => {
      mockDriveFiles.list.mockResolvedValue({
        data: {
          files: [
            { id: 'f1', name: 'existing.txt', modifiedTime: '2025-01-01T00:00:00Z' },
            { id: 'f2', name: 'brand-new.txt', modifiedTime: '2025-01-02T00:00:00Z' },
          ],
        },
      })

      const result = await service.onFileUpdated({
        triggerData : {},
        learningMode: false,
        state       : {
          files: [
            { id: 'f1', name: 'existing.txt', modifiedTime: '2025-01-01T00:00:00Z' },
          ],
        },
      })

      expect(result.events).toHaveLength(0)
    })

    it('requests modifiedTime fields', async () => {
      mockDriveFiles.list.mockResolvedValue({ data: { files: [] } })

      await service.onFileUpdated({
        triggerData : {},
        learningMode: false,
        state       : null,
      })

      expect(mockDriveFiles.list).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: 'modifiedTime desc',
          fields : 'files(id, name, modifiedTime)',
        }),
      )
    })
  })
})
