'use strict'

const crypto = require('crypto')
const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const API_BASE = 'https://api.box.com/2.0'
const UPLOAD_BASE = 'https://upload.box.com/api/2.0'
const OAUTH_TOKEN_URL = 'https://api.box.com/oauth2/token'
const WEBHOOK_PRIMARY_KEY = 'test-primary-key'
const WEBHOOK_SECONDARY_KEY = 'test-secondary-key'

describe('Box Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      webhookPrimaryKey: WEBHOOK_PRIMARY_KEY,
      webhookSecondaryKey: WEBHOOK_SECONDARY_KEY,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clientId', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'clientSecret', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'webhookPrimaryKey', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'webhookSecondaryKey', required: false, shared: false, type: 'STRING' }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://account.box.com/api/oauth2/authorize')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=root_readwrite')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'new-token',
        expires_in: 3600,
        refresh_token: 'new-refresh',
      })
      mock.onGet(`${ API_BASE }/users/me`).reply({
        name: 'Jane Doe',
        login: 'jane@example.com',
        avatar_url: 'https://app.box.com/avatar.png',
      })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/callback' })

      expect(result).toEqual({
        token: 'new-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh',
        connectionIdentityName: 'Jane Doe',
        connectionIdentityImageURL: 'https://app.box.com/avatar.png',
        overwrite: true,
      })

      // Verify token request
      expect(mock.history[0].url).toBe(OAUTH_TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code')

      // Verify user info request
      expect(mock.history[1].url).toBe(`${ API_BASE }/users/me`)
      expect(mock.history[1].query).toMatchObject({ fields: 'name,login,avatar_url' })
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
        refresh_token: 'refreshed-refresh',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
        refreshToken: 'refreshed-refresh',
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)
    })
  })

  // ── Files ──

  describe('getFileInfo', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/files/12345`).reply({ id: '12345', type: 'file', name: 'Contract.pdf' })

      const result = await service.getFileInfo('12345')

      expect(result).toEqual({ id: '12345', type: 'file', name: 'Contract.pdf' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ OAUTH_TOKEN }` })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/files/bad`).replyWithError({ message: 'Not found', body: { message: 'Not found' }, status: 404 })

      await expect(service.getFileInfo('bad')).rejects.toThrow()
    })
  })

  describe('uploadFile', () => {
    it('downloads file and uploads via multipart form', async () => {
      const fileBytes = Buffer.from('test file content')
      mock.onGet('https://files.example.com/doc.pdf').reply(fileBytes)
      mock.onPost(`${ UPLOAD_BASE }/files/content`).reply({
        total_count: 1,
        entries: [{ id: '99', type: 'file', name: 'doc.pdf' }],
      })

      const result = await service.uploadFile('0', 'https://files.example.com/doc.pdf')

      expect(result).toMatchObject({ total_count: 1 })
      // Second call is the upload
      expect(mock.history[1].url).toBe(`${ UPLOAD_BASE }/files/content`)
      expect(mock.history[1].formData).toBeDefined()
    })

    it('uses provided fileName over URL-derived name', async () => {
      mock.onGet('https://files.example.com/doc.pdf').reply(Buffer.from('bytes'))
      mock.onPost(`${ UPLOAD_BASE }/files/content`).reply({
        total_count: 1,
        entries: [{ id: '100', type: 'file', name: 'Custom.pdf' }],
      })

      await service.uploadFile('0', 'https://files.example.com/doc.pdf', 'Custom.pdf')

      expect(mock.history).toHaveLength(2)
    })
  })

  describe('downloadFile', () => {
    it('downloads file content and uploads to flowrunner storage', async () => {
      mock.onGet(`${ API_BASE }/files/12345`).reply({ id: '12345', name: 'Report.pdf', content_type: 'application/pdf', size: 1024 })
      mock.onGet(`${ API_BASE }/files/12345/content`).reply(Buffer.from('file bytes'))

      // Mock flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/Report.pdf' }),
        },
      }

      const result = await service.downloadFile('12345')

      expect(result).toEqual({
        fileName: 'Report.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        downloadUrl: 'https://storage.example.com/Report.pdf',
      })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].encoding).toBeNull()
    })
  })

  describe('updateFile', () => {
    it('sends PUT with name, description, and tags', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345', name: 'New.pdf' })

      await service.updateFile('12345', 'New.pdf', 'A description', 'tag1,tag2')

      expect(mock.history[0].body).toEqual({
        name: 'New.pdf',
        description: 'A description',
        tags: ['tag1', 'tag2'],
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345' })

      await service.updateFile('12345')

      expect(mock.history[0].body).toEqual({})
    })

    it('includes description even if empty string', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345' })

      await service.updateFile('12345', undefined, '')

      expect(mock.history[0].body).toEqual({ description: '' })
    })
  })

  describe('moveFile', () => {
    it('sends PUT with parent id', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345', parent: { id: '678' } })

      await service.moveFile('12345', '678')

      expect(mock.history[0].body).toEqual({ parent: { id: '678' } })
    })
  })

  describe('copyFile', () => {
    it('sends POST to copy endpoint with parent', async () => {
      mock.onPost(`${ API_BASE }/files/12345/copy`).reply({ id: '99999' })

      await service.copyFile('12345', '678')

      expect(mock.history[0].body).toEqual({ parent: { id: '678' } })
    })

    it('includes name when provided', async () => {
      mock.onPost(`${ API_BASE }/files/12345/copy`).reply({ id: '99999' })

      await service.copyFile('12345', '678', 'Copy.pdf')

      expect(mock.history[0].body).toEqual({ parent: { id: '678' }, name: 'Copy.pdf' })
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/files/12345`).reply(undefined)

      const result = await service.deleteFile('12345')

      expect(result).toEqual({ deleted: true, fileId: '12345' })
    })
  })

  // ── Folders ──

  describe('createFolder', () => {
    it('sends POST with name and parent', async () => {
      mock.onPost(`${ API_BASE }/folders`).reply({ id: '678', type: 'folder', name: 'New Folder' })

      const result = await service.createFolder('New Folder', '0')

      expect(result).toMatchObject({ id: '678', name: 'New Folder' })
      expect(mock.history[0].body).toEqual({ name: 'New Folder', parent: { id: '0' } })
    })
  })

  describe('getFolderInfo', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/folders/678`).reply({ id: '678', type: 'folder' })

      const result = await service.getFolderInfo('678')

      expect(result).toMatchObject({ id: '678' })
    })
  })

  describe('listFolderItems', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/folders/0/items`).reply({ total_count: 0, entries: [] })

      await service.listFolderItems('0')

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })

    it('resolves sort and direction choices', async () => {
      mock.onGet(`${ API_BASE }/folders/0/items`).reply({ total_count: 0, entries: [] })

      await service.listFolderItems('0', 50, 10, 'Name', 'Descending')

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 10, sort: 'name', direction: 'DESC' })
    })
  })

  describe('updateFolder', () => {
    it('sends PUT with name and description', async () => {
      mock.onPut(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.updateFolder('678', 'Renamed', 'Description')

      expect(mock.history[0].body).toEqual({ name: 'Renamed', description: 'Description' })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPut(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.updateFolder('678')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('moveFolder', () => {
    it('sends PUT with parent', async () => {
      mock.onPut(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.moveFolder('678', '345')

      expect(mock.history[0].body).toEqual({ parent: { id: '345' } })
    })
  })

  describe('copyFolder', () => {
    it('sends POST to copy endpoint', async () => {
      mock.onPost(`${ API_BASE }/folders/678/copy`).reply({ id: '9001' })

      await service.copyFolder('678', '345')

      expect(mock.history[0].body).toEqual({ parent: { id: '345' } })
    })

    it('includes name when provided', async () => {
      mock.onPost(`${ API_BASE }/folders/678/copy`).reply({ id: '9001' })

      await service.copyFolder('678', '345', 'CopiedFolder')

      expect(mock.history[0].body).toEqual({ parent: { id: '345' }, name: 'CopiedFolder' })
    })
  })

  describe('deleteFolder', () => {
    it('sends DELETE with recursive query', async () => {
      mock.onDelete(`${ API_BASE }/folders/678`).reply(undefined)

      const result = await service.deleteFolder('678', true)

      expect(result).toEqual({ deleted: true, folderId: '678' })
      expect(mock.history[0].query).toMatchObject({ recursive: true })
    })

    it('defaults recursive to false', async () => {
      mock.onDelete(`${ API_BASE }/folders/678`).reply(undefined)

      await service.deleteFolder('678')

      expect(mock.history[0].query).toMatchObject({ recursive: false })
    })
  })

  // ── Sharing ──

  describe('createFileSharedLink', () => {
    it('sends PUT with shared_link body and fields query', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345', shared_link: { url: 'https://app.box.com/s/abc' } })

      await service.createFileSharedLink('12345', 'Open (anyone with link)', 'secret', true, '2025-12-31')

      expect(mock.history[0].query).toMatchObject({ fields: 'shared_link' })
      expect(mock.history[0].body).toEqual({
        shared_link: {
          access: 'open',
          password: 'secret',
          permissions: { can_download: true },
          unshared_at: '2025-12-31',
        },
      })
    })

    it('omits optional shared link fields', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345' })

      await service.createFileSharedLink('12345', 'Company only')

      expect(mock.history[0].body).toEqual({
        shared_link: { access: 'company' },
      })
    })
  })

  describe('createFolderSharedLink', () => {
    it('sends PUT with shared_link to folders endpoint', async () => {
      mock.onPut(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.createFolderSharedLink('678', 'Collaborators only')

      expect(mock.history[0].body).toEqual({
        shared_link: { access: 'collaborators' },
      })
    })
  })

  describe('removeSharedLink', () => {
    it('removes shared link from a file', async () => {
      mock.onPut(`${ API_BASE }/files/12345`).reply({ id: '12345', shared_link: null })

      await service.removeSharedLink('File', '12345')

      expect(mock.history[0].body).toEqual({ shared_link: null })
      expect(mock.history[0].query).toMatchObject({ fields: 'shared_link' })
    })

    it('removes shared link from a folder', async () => {
      mock.onPut(`${ API_BASE }/folders/678`).reply({ id: '678', shared_link: null })

      await service.removeSharedLink('Folder', '678')

      expect(mock.history[0].url).toBe(`${ API_BASE }/folders/678`)
    })
  })

  // ── Collaborations ──

  describe('addCollaboration', () => {
    it('sends POST with user collaboration', async () => {
      mock.onPost(`${ API_BASE }/collaborations`).reply({ id: '55555', type: 'collaboration' })

      await service.addCollaboration('File', '12345', 'User', 'user@example.com', undefined, 'Editor', true)

      expect(mock.history[0].body).toEqual({
        item: { type: 'file', id: '12345' },
        accessible_by: { type: 'user', login: 'user@example.com' },
        role: 'editor',
      })
      expect(mock.history[0].query).toMatchObject({ notify: true })
    })

    it('sends POST with group collaboration', async () => {
      mock.onPost(`${ API_BASE }/collaborations`).reply({ id: '55555' })

      await service.addCollaboration('Folder', '678', 'Group', undefined, 'group-123', 'Viewer', false)

      expect(mock.history[0].body).toEqual({
        item: { type: 'folder', id: '678' },
        accessible_by: { type: 'group', id: 'group-123' },
        role: 'viewer',
      })
      expect(mock.history[0].query).toMatchObject({ notify: false })
    })

    it('throws when inviting a group without groupId', async () => {
      await expect(
        service.addCollaboration('File', '12345', 'Group', undefined, undefined, 'Editor')
      ).rejects.toThrow('group')
    })

    it('throws when inviting a user without login', async () => {
      await expect(
        service.addCollaboration('File', '12345', 'User', undefined, undefined, 'Editor')
      ).rejects.toThrow('Email')
    })
  })

  describe('getCollaboration', () => {
    it('fetches collaboration by ID, ignoring folderId', async () => {
      mock.onGet(`${ API_BASE }/collaborations/55555`).reply({ id: '55555', role: 'editor' })

      const result = await service.getCollaboration('some-folder', '55555')

      expect(result).toMatchObject({ id: '55555' })
    })
  })

  describe('listFolderCollaborations', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/folders/678/collaborations`).reply({ entries: [] })

      await service.listFolderCollaborations('678')

      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('includes marker when provided', async () => {
      mock.onGet(`${ API_BASE }/folders/678/collaborations`).reply({ entries: [] })

      await service.listFolderCollaborations('678', 50, 'next-marker-abc')

      expect(mock.history[0].query).toMatchObject({ limit: 50, marker: 'next-marker-abc' })
    })
  })

  describe('listFileCollaborations', () => {
    it('sends GET to file collaborations endpoint', async () => {
      mock.onGet(`${ API_BASE }/files/12345/collaborations`).reply({ entries: [] })

      await service.listFileCollaborations('12345')

      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })
  })

  describe('updateCollaboration', () => {
    it('sends PUT with resolved role', async () => {
      mock.onPut(`${ API_BASE }/collaborations/55555`).reply({ id: '55555', role: 'viewer' })

      await service.updateCollaboration('some-folder', '55555', 'Viewer')

      expect(mock.history[0].body).toEqual({ role: 'viewer' })
    })
  })

  describe('removeCollaboration', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/collaborations/55555`).reply(undefined)

      const result = await service.removeCollaboration('some-folder', '55555')

      expect(result).toEqual({ deleted: true, collaborationId: '55555' })
    })
  })

  // ── Search ──

  describe('searchContent', () => {
    it('sends GET with required query and defaults', async () => {
      mock.onGet(`${ API_BASE }/search`).reply({ entries: [], total_count: 0 })

      await service.searchContent('contract')

      expect(mock.history[0].query).toMatchObject({ query: 'contract', limit: 30, offset: 0 })
    })

    it('resolves type, scope, and file extensions', async () => {
      mock.onGet(`${ API_BASE }/search`).reply({ entries: [], total_count: 0 })

      await service.searchContent('report', 'File', 'User content', 'pdf,docx', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        query: 'report',
        type: 'file',
        scope: 'user_content',
        file_extensions: 'pdf,docx',
        limit: 10,
        offset: 5,
      })
    })
  })

  // ── Account ──

  describe('getCurrentUser', () => {
    it('sends GET to users/me', async () => {
      mock.onGet(`${ API_BASE }/users/me`).reply({ id: '33333', name: 'Jane Doe' })

      const result = await service.getCurrentUser()

      expect(result).toMatchObject({ id: '33333', name: 'Jane Doe' })
    })
  })

  // ── File Versions ──

  describe('listFileVersions', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/files/12345/versions`).reply({ entries: [], total_count: 0 })

      await service.listFileVersions('12345')

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })
  })

  describe('getFileVersion', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/files/12345/versions/v1`).reply({ id: 'v1', type: 'file_version' })

      const result = await service.getFileVersion('12345', 'v1')

      expect(result).toMatchObject({ id: 'v1' })
    })
  })

  describe('promoteFileVersion', () => {
    it('sends POST with version body', async () => {
      mock.onPost(`${ API_BASE }/files/12345/versions/current`).reply({ id: 'v2' })

      await service.promoteFileVersion('12345', 'v1')

      expect(mock.history[0].body).toEqual({ type: 'file_version', id: 'v1' })
    })
  })

  describe('deleteFileVersion', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/files/12345/versions/v1`).reply(undefined)

      const result = await service.deleteFileVersion('12345', 'v1')

      expect(result).toEqual({ deleted: true, fileId: '12345', versionId: 'v1' })
    })
  })

  // ── Comments ──

  describe('createComment', () => {
    it('sends POST with message and file item', async () => {
      mock.onPost(`${ API_BASE }/comments`).reply({ id: '77777', type: 'comment' })

      await service.createComment('12345', 'Great work!')

      expect(mock.history[0].body).toEqual({
        message: 'Great work!',
        item: { type: 'file', id: '12345' },
      })
    })
  })

  describe('listFileComments', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/files/12345/comments`).reply({ entries: [], total_count: 0 })

      await service.listFileComments('12345')

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })
  })

  describe('getComment', () => {
    it('fetches comment by ID, ignoring fileId', async () => {
      mock.onGet(`${ API_BASE }/comments/77777`).reply({ id: '77777' })

      const result = await service.getComment('some-file', '77777')

      expect(result).toMatchObject({ id: '77777' })
    })
  })

  describe('updateComment', () => {
    it('sends PUT with new message', async () => {
      mock.onPut(`${ API_BASE }/comments/77777`).reply({ id: '77777', message: 'Updated' })

      await service.updateComment('some-file', '77777', 'Updated')

      expect(mock.history[0].body).toEqual({ message: 'Updated' })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/comments/77777`).reply(undefined)

      const result = await service.deleteComment('some-file', '77777')

      expect(result).toEqual({ deleted: true, commentId: '77777' })
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ API_BASE }/tasks`).reply({ id: '88888', type: 'task' })

      await service.createTask('12345', 'Review')

      expect(mock.history[0].body).toEqual({
        item: { type: 'file', id: '12345' },
        action: 'review',
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ API_BASE }/tasks`).reply({ id: '88888' })

      await service.createTask('12345', 'Complete', 'Do this', '2025-02-01T17:00:00Z', 'All assignees')

      expect(mock.history[0].body).toEqual({
        item: { type: 'file', id: '12345' },
        action: 'complete',
        message: 'Do this',
        due_at: '2025-02-01T17:00:00Z',
        completion_rule: 'all_assignees',
      })
    })
  })

  describe('listFileTasks', () => {
    it('sends GET to correct endpoint', async () => {
      mock.onGet(`${ API_BASE }/files/12345/tasks`).reply({ entries: [], total_count: 0 })

      await service.listFileTasks('12345')

      expect(mock.history[0].url).toBe(`${ API_BASE }/files/12345/tasks`)
    })
  })

  describe('getTask', () => {
    it('fetches task by ID, ignoring fileId', async () => {
      mock.onGet(`${ API_BASE }/tasks/88888`).reply({ id: '88888' })

      const result = await service.getTask('some-file', '88888')

      expect(result).toMatchObject({ id: '88888' })
    })
  })

  describe('updateTask', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ API_BASE }/tasks/88888`).reply({ id: '88888' })

      await service.updateTask('some-file', '88888', 'Complete', 'Updated msg', '2025-03-01T00:00:00Z', 'Any assignee')

      expect(mock.history[0].body).toEqual({
        action: 'complete',
        message: 'Updated msg',
        due_at: '2025-03-01T00:00:00Z',
        completion_rule: 'any_assignee',
      })
    })

    it('omits all optional fields when not provided', async () => {
      mock.onPut(`${ API_BASE }/tasks/88888`).reply({ id: '88888' })

      await service.updateTask('some-file', '88888')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/tasks/88888`).reply(undefined)

      const result = await service.deleteTask('some-file', '88888')

      expect(result).toEqual({ deleted: true, taskId: '88888' })
    })
  })

  // ── Metadata ──

  describe('createMetadataInstance', () => {
    it('sends POST with scope and template in URL', async () => {
      mock.onPost(`${ API_BASE }/files/12345/metadata/enterprise/myTemplate`).reply({ $template: 'myTemplate' })

      await service.createMetadataInstance('12345', 'Enterprise', 'myTemplate', { status: 'active' })

      expect(mock.history[0].body).toEqual({ status: 'active' })
    })

    it('resolves Global scope', async () => {
      mock.onPost(`${ API_BASE }/files/12345/metadata/global/properties`).reply({})

      await service.createMetadataInstance('12345', 'Global', 'properties', {})

      expect(mock.history[0].url).toBe(`${ API_BASE }/files/12345/metadata/global/properties`)
    })
  })

  describe('getMetadataInstance', () => {
    it('sends GET with scope and template', async () => {
      mock.onGet(`${ API_BASE }/files/12345/metadata/enterprise/myTemplate`).reply({ $template: 'myTemplate' })

      const result = await service.getMetadataInstance('12345', 'Enterprise', 'myTemplate')

      expect(result).toMatchObject({ $template: 'myTemplate' })
    })
  })

  describe('listMetadataInstances', () => {
    it('sends GET to metadata endpoint', async () => {
      mock.onGet(`${ API_BASE }/files/12345/metadata`).reply({ entries: [] })

      await service.listMetadataInstances('12345')

      expect(mock.history[0].url).toBe(`${ API_BASE }/files/12345/metadata`)
    })
  })

  describe('deleteMetadataInstance', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/files/12345/metadata/enterprise/myTemplate`).reply(undefined)

      const result = await service.deleteMetadataInstance('12345', 'Enterprise', 'myTemplate')

      expect(result).toEqual({ deleted: true, fileId: '12345', scope: 'enterprise', templateKey: 'myTemplate' })
    })
  })

  // ── Trash ──

  describe('listTrashedItems', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/folders/trash/items`).reply({ entries: [], total_count: 0 })

      await service.listTrashedItems()

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0 })
    })

    it('resolves sort and direction', async () => {
      mock.onGet(`${ API_BASE }/folders/trash/items`).reply({ entries: [], total_count: 0 })

      await service.listTrashedItems(50, 10, 'Date', 'Ascending')

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 10, sort: 'date', direction: 'ASC' })
    })
  })

  describe('restoreFile', () => {
    it('sends POST with empty body when no optional params', async () => {
      mock.onPost(`${ API_BASE }/files/12345`).reply({ id: '12345', item_status: 'active' })

      await service.restoreFile('12345')

      expect(mock.history[0].body).toEqual({})
    })

    it('includes name and parentFolderId when provided', async () => {
      mock.onPost(`${ API_BASE }/files/12345`).reply({ id: '12345' })

      await service.restoreFile('12345', 'Restored.pdf', '678')

      expect(mock.history[0].body).toEqual({ name: 'Restored.pdf', parent: { id: '678' } })
    })
  })

  describe('restoreFolder', () => {
    it('sends POST with empty body when no optional params', async () => {
      mock.onPost(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.restoreFolder('678')

      expect(mock.history[0].body).toEqual({})
    })

    it('includes name and parentFolderId when provided', async () => {
      mock.onPost(`${ API_BASE }/folders/678`).reply({ id: '678' })

      await service.restoreFolder('678', 'RestoredFolder', '0')

      expect(mock.history[0].body).toEqual({ name: 'RestoredFolder', parent: { id: '0' } })
    })
  })

  describe('permanentlyDeleteFile', () => {
    it('sends DELETE to trash endpoint', async () => {
      mock.onDelete(`${ API_BASE }/files/12345/trash`).reply(undefined)

      const result = await service.permanentlyDeleteFile('12345')

      expect(result).toEqual({ deleted: true, fileId: '12345' })
    })
  })

  describe('permanentlyDeleteFolder', () => {
    it('sends DELETE to trash endpoint', async () => {
      mock.onDelete(`${ API_BASE }/folders/678/trash`).reply(undefined)

      const result = await service.permanentlyDeleteFolder('678')

      expect(result).toEqual({ deleted: true, folderId: '678' })
    })
  })

  // ── Triggers ──

  describe('onFileEvent', () => {
    it('shapes a file event', () => {
      const body = {
        id: 'evt-1',
        trigger: 'FILE.UPLOADED',
        source: { id: '12345', name: 'doc.pdf', type: 'file', parent: { id: '0' } },
        created_at: '2024-01-15T09:30:00-08:00',
        created_by: { id: '33333', name: 'Jane' },
      }

      const result = service.onFileEvent('SHAPE_EVENT', body)

      expect(result).toEqual([{
        name: 'onFileEvent',
        data: {
          eventId: 'evt-1',
          trigger: 'FILE.UPLOADED',
          fileId: '12345',
          fileName: 'doc.pdf',
          source: body.source,
          createdAt: '2024-01-15T09:30:00-08:00',
          createdBy: body.created_by,
        },
      }])
    })

    it('filters matching triggers', () => {
      const payload = {
        eventData: {
          trigger: 'FILE.UPLOADED',
          source: { id: '12345', type: 'file' },
        },
        triggers: [
          { id: 'trig-1', data: { fileId: '12345', event: 'File Uploaded' } },
          { id: 'trig-2', data: { fileId: '99999', event: 'File Uploaded' } },
          { id: 'trig-3', data: { fileId: '12345', event: 'File Deleted' } },
        ],
      }

      const result = service.onFileEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['trig-1'] })
    })
  })

  describe('onFolderEvent', () => {
    it('shapes a folder event', () => {
      const body = {
        id: 'evt-2',
        trigger: 'FOLDER.CREATED',
        source: { id: '678', name: 'New Folder', type: 'folder', parent: { id: '0' } },
        created_at: '2024-01-15T09:30:00-08:00',
        created_by: { id: '33333' },
      }

      const result = service.onFolderEvent('SHAPE_EVENT', body)

      expect(result).toEqual([{
        name: 'onFolderEvent',
        data: {
          eventId: 'evt-2',
          trigger: 'FOLDER.CREATED',
          folderId: '678',
          folderName: 'New Folder',
          source: body.source,
          createdAt: '2024-01-15T09:30:00-08:00',
          createdBy: body.created_by,
        },
      }])
    })

    it('filters matching folder triggers including file-into-folder events', () => {
      const payload = {
        eventData: {
          trigger: 'FILE.UPLOADED',
          source: { id: '12345', type: 'file', parent: { id: '678' } },
        },
        triggers: [
          { id: 'trig-1', data: { folderId: '678', event: 'File Uploaded (into folder)' } },
          { id: 'trig-2', data: { folderId: '999', event: 'File Uploaded (into folder)' } },
        ],
      }

      const result = service.onFolderEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['trig-1'] })
    })
  })

  describe('onCollaborationEvent', () => {
    it('shapes a collaboration event', () => {
      const body = {
        id: 'evt-3',
        trigger: 'COLLABORATION.CREATED',
        source: { id: '55555', type: 'collaboration', item: { type: 'folder', id: '678' } },
        created_at: '2024-01-15T09:30:00-08:00',
        created_by: { id: '33333' },
      }

      const result = service.onCollaborationEvent('SHAPE_EVENT', body)

      expect(result).toEqual([{
        name: 'onCollaborationEvent',
        data: {
          eventId: 'evt-3',
          trigger: 'COLLABORATION.CREATED',
          collaborationId: '55555',
          source: body.source,
          createdAt: '2024-01-15T09:30:00-08:00',
          createdBy: body.created_by,
        },
      }])
    })

    it('filters matching collaboration triggers', () => {
      const payload = {
        eventData: {
          trigger: 'COLLABORATION.CREATED',
          source: { id: '55555', type: 'collaboration', item: { type: 'folder', id: '678' } },
        },
        triggers: [
          { id: 'trig-1', data: { folderId: '678', event: 'Collaboration Created' } },
          { id: 'trig-2', data: { folderId: '999', event: 'Collaboration Created' } },
        ],
      }

      const result = service.onCollaborationEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['trig-1'] })
    })
  })

  // ── Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for each event', async () => {
      mock.onPost(`${ API_BASE }/webhooks`).reply({ id: 'wh-1' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://callback.example.com/trigger',
        connectionId: 'conn-1',
        events: [
          { id: 'trig-1', name: 'onFileEvent', triggerData: { fileId: '12345', event: 'File Uploaded' } },
        ],
      })

      expect(result).toEqual({
        webhookData: {
          webhooks: [{
            triggerId: 'trig-1',
            webhookId: 'wh-1',
            targetType: 'file',
            targetId: '12345',
            event: 'FILE.UPLOADED',
          }],
        },
        connectionId: 'conn-1',
      })

      expect(mock.history[0].body).toMatchObject({
        target: { id: '12345', type: 'file' },
        triggers: ['FILE.UPLOADED'],
      })
    })

    it('creates folder webhooks for onFolderEvent', async () => {
      mock.onPost(`${ API_BASE }/webhooks`).reply({ id: 'wh-2' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://callback.example.com/trigger?existing=1',
        connectionId: 'conn-2',
        events: [
          { id: 'trig-2', name: 'onFolderEvent', triggerData: { folderId: '678', event: 'Folder Created' } },
        ],
      })

      expect(result.webhookData.webhooks[0]).toMatchObject({ targetType: 'folder', targetId: '678' })
      // callbackUrl already has ?, so & should be used
      expect(mock.history[0].body.address).toContain('&connectionId=conn-2')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns handshake when body is missing', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns empty events for unknown trigger family', async () => {
      // Need to bypass signature verification: no keys => skips
      const svc = sandbox.getService()
      const origConfig = svc.config
      svc.config = { ...origConfig, webhookPrimaryKey: undefined, webhookSecondaryKey: undefined }

      const result = await svc.handleTriggerResolveEvents({
        body: { trigger: 'UNKNOWN.EVENT' },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result).toEqual({ connectionId: 'conn-1', events: [] })
      svc.config = origConfig
    })

    it('shapes FILE events and routes to both onFileEvent and onFolderEvent', async () => {
      const svc = sandbox.getService()
      const origConfig = svc.config
      svc.config = { ...origConfig, webhookPrimaryKey: undefined, webhookSecondaryKey: undefined }

      const result = await svc.handleTriggerResolveEvents({
        body: {
          trigger: 'FILE.UPLOADED',
          id: 'evt-1',
          source: { id: '12345', name: 'doc.pdf', type: 'file', parent: { id: '678' } },
          created_at: '2024-01-15T09:30:00-08:00',
          created_by: { id: '33333' },
        },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(2)
      expect(result.events[0].name).toBe('onFileEvent')
      expect(result.events[1].name).toBe('onFolderEvent')

      svc.config = origConfig
    })

    it('rejects deliveries with invalid signature', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { trigger: 'FILE.UPLOADED' },
        headers: {
          'box-delivery-timestamp': new Date().toISOString(),
          'box-signature-primary': 'invalid-sig',
          'box-signature-secondary': 'invalid-sig',
        },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toEqual([])
    })

    it('accepts deliveries with valid primary signature', async () => {
      const body = JSON.stringify({ trigger: 'FOLDER.CREATED', id: 'evt-2', source: { id: '678', name: 'F', type: 'folder' }, created_at: '2024-01-15', created_by: {} })
      const timestamp = new Date().toISOString()
      const message = Buffer.concat([Buffer.from(body), Buffer.from(timestamp)])
      const signature = crypto.createHmac('sha256', WEBHOOK_PRIMARY_KEY).update(message).digest('base64')

      const result = await service.handleTriggerResolveEvents({
        body: JSON.parse(body),
        rawBody: body,
        headers: {
          'box-delivery-timestamp': timestamp,
          'box-signature-primary': signature,
          'box-signature-secondary': 'wrong',
        },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onFolderEvent')
    })

    it('rejects deliveries older than 10 minutes', async () => {
      const oldTimestamp = new Date(Date.now() - 11 * 60 * 1000).toISOString()

      const result = await service.handleTriggerResolveEvents({
        body: { trigger: 'FILE.UPLOADED' },
        headers: {
          'box-delivery-timestamp': oldTimestamp,
          'box-signature-primary': 'some-sig',
        },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named trigger method with FILTER_TRIGGER', async () => {
      const payload = {
        eventName: 'onFileEvent',
        eventData: {
          trigger: 'FILE.UPLOADED',
          source: { id: '12345' },
        },
        triggers: [
          { id: 'trig-1', data: { fileId: '12345', event: 'File Uploaded' } },
        ],
      }

      const result = await service.handleTriggerSelectMatched(payload)

      expect(result).toEqual({ ids: ['trig-1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all webhooks', async () => {
      mock.onDelete(`${ API_BASE }/webhooks/wh-1`).reply(undefined)
      mock.onDelete(`${ API_BASE }/webhooks/wh-2`).reply(undefined)

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { webhookId: 'wh-1' },
            { webhookId: 'wh-2' },
          ],
        },
      })

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(2)
    })

    it('skips webhooks without webhookId', async () => {
      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [{ triggerId: 'trig-1' }],
        },
      })

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Dictionaries ──

  describe('getFoldersDictionary', () => {
    it('lists root folder items filtered to folders when no search', async () => {
      mock.onGet(`${ API_BASE }/folders/0/items`).reply({
        entries: [
          { id: '1', name: 'Folder A', type: 'folder' },
          { id: '2', name: 'File B', type: 'file' },
        ],
        total_count: 2,
        offset: 0,
        limit: 100,
      })

      const result = await service.getFoldersDictionary({})

      expect(result.items).toEqual([
        { label: 'Folder A', value: '1', note: 'Folder ID: 1' },
      ])
    })

    it('uses search when provided', async () => {
      mock.onGet(`${ API_BASE }/search`).reply({
        entries: [{ id: '5', name: 'Projects', type: 'folder' }],
        total_count: 1,
        offset: 0,
        limit: 50,
      })

      const result = await service.getFoldersDictionary({ search: 'proj' })

      expect(result.items).toEqual([
        { label: 'Projects', value: '5', note: 'Folder ID: 5' },
      ])
      expect(mock.history[0].query).toMatchObject({ query: 'proj', type: 'folder' })
    })
  })

  describe('getFilesDictionary', () => {
    it('lists root folder items filtered to files', async () => {
      mock.onGet(`${ API_BASE }/folders/0/items`).reply({
        entries: [
          { id: '1', name: 'Folder A', type: 'folder' },
          { id: '2', name: 'Doc.pdf', type: 'file' },
        ],
        total_count: 2,
        offset: 0,
        limit: 100,
      })

      const result = await service.getFilesDictionary({})

      expect(result.items).toEqual([
        { label: 'Doc.pdf', value: '2', note: 'File ID: 2' },
      ])
    })
  })

  describe('getItemsDictionary', () => {
    it('lists all items without type filter', async () => {
      mock.onGet(`${ API_BASE }/folders/0/items`).reply({
        entries: [
          { id: '1', name: 'Folder A', type: 'folder' },
          { id: '2', name: 'Doc.pdf', type: 'file' },
        ],
        total_count: 2,
        offset: 0,
        limit: 100,
      })

      const result = await service.getItemsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0].note).toBe('folder 1')
      expect(result.items[1].note).toBe('file 2')
    })
  })

  describe('getCollaborationsDictionary', () => {
    it('returns empty when no folderId in criteria', async () => {
      const result = await service.getCollaborationsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('lists collaborations for a folder', async () => {
      mock.onGet(`${ API_BASE }/folders/678/collaborations`).reply({
        entries: [
          { id: '55', accessible_by: { login: 'user@example.com' }, role: 'editor' },
        ],
        next_marker: null,
      })

      const result = await service.getCollaborationsDictionary({ criteria: { folderId: '678' } })

      expect(result.items).toEqual([
        { label: 'user@example.com — editor', value: '55', note: 'Collaboration ID: 55' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/folders/678/collaborations`).reply({
        entries: [
          { id: '55', accessible_by: { login: 'alice@example.com' }, role: 'editor' },
          { id: '56', accessible_by: { login: 'bob@example.com' }, role: 'viewer' },
        ],
        next_marker: null,
      })

      const result = await service.getCollaborationsDictionary({ search: 'alice', criteria: { folderId: '678' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('55')
    })
  })

  describe('getMetadataTemplatesDictionary', () => {
    it('lists enterprise metadata templates', async () => {
      mock.onGet(`${ API_BASE }/metadata_templates/enterprise`).reply({
        entries: [
          { displayName: 'Contract', templateKey: 'contract', scope: 'enterprise_123' },
        ],
        next_marker: null,
      })

      const result = await service.getMetadataTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Contract', value: 'contract', note: 'Scope: enterprise_123' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/metadata_templates/enterprise`).reply({
        entries: [
          { displayName: 'Contract', templateKey: 'contract', scope: 'enterprise_123' },
          { displayName: 'Invoice', templateKey: 'invoice', scope: 'enterprise_123' },
        ],
        next_marker: null,
      })

      const result = await service.getMetadataTemplatesDictionary({ search: 'inv' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('invoice')
    })
  })

  describe('getGroupsDictionary', () => {
    it('lists groups', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({
        entries: [{ id: '24681012', name: 'Engineering' }],
        total_count: 1,
        offset: 0,
        limit: 100,
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Engineering', value: '24681012', note: 'Group ID: 24681012' },
      ])
    })

    it('passes filter_term when searching', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({ entries: [], total_count: 0, offset: 0, limit: 100 })

      await service.getGroupsDictionary({ search: 'eng' })

      expect(mock.history[0].query).toMatchObject({ filter_term: 'eng' })
    })
  })

  describe('getFileVersionsDictionary', () => {
    it('returns empty when no fileId in criteria', async () => {
      const result = await service.getFileVersionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('lists versions for a file', async () => {
      mock.onGet(`${ API_BASE }/files/12345/versions`).reply({
        entries: [{ id: 'v1', name: 'doc.pdf', size: 1024 }],
        total_count: 1,
        offset: 0,
        limit: 100,
      })

      const result = await service.getFileVersionsDictionary({ criteria: { fileId: '12345' } })

      expect(result.items).toEqual([
        { label: 'doc.pdf (1024 bytes)', value: 'v1', note: 'Version ID: v1' },
      ])
    })
  })

  describe('getFileCommentsDictionary', () => {
    it('returns empty when no fileId in criteria', async () => {
      const result = await service.getFileCommentsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('lists comments for a file', async () => {
      mock.onGet(`${ API_BASE }/files/12345/comments`).reply({
        entries: [{ id: '77', message: 'Nice work!' }],
        total_count: 1,
        offset: 0,
        limit: 100,
      })

      const result = await service.getFileCommentsDictionary({ criteria: { fileId: '12345' } })

      expect(result.items).toEqual([
        { label: 'Nice work!', value: '77', note: 'Comment ID: 77' },
      ])
    })
  })

  describe('getFileTasksDictionary', () => {
    it('returns empty when no fileId in criteria', async () => {
      const result = await service.getFileTasksDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('lists tasks for a file', async () => {
      mock.onGet(`${ API_BASE }/files/12345/tasks`).reply({
        entries: [{ id: '88', message: 'Review this', action: 'review' }],
        total_count: 1,
      })

      const result = await service.getFileTasksDictionary({ criteria: { fileId: '12345' } })

      expect(result.items).toEqual([
        { label: 'Review this (review)', value: '88', note: 'Task ID: 88' },
      ])
    })
  })

  describe('getTrashedFilesDictionary', () => {
    it('lists trashed files', async () => {
      mock.onGet(`${ API_BASE }/folders/trash/items`).reply({
        entries: [
          { id: '1', name: 'Deleted.pdf', type: 'file' },
          { id: '2', name: 'Old Folder', type: 'folder' },
        ],
        total_count: 2,
        offset: 0,
        limit: 100,
      })

      const result = await service.getTrashedFilesDictionary({})

      expect(result.items).toEqual([
        { label: 'Deleted.pdf', value: '1', note: 'File ID: 1' },
      ])
    })
  })

  describe('getTrashedFoldersDictionary', () => {
    it('lists trashed folders', async () => {
      mock.onGet(`${ API_BASE }/folders/trash/items`).reply({
        entries: [
          { id: '1', name: 'Deleted.pdf', type: 'file' },
          { id: '2', name: 'Old Folder', type: 'folder' },
        ],
        total_count: 2,
        offset: 0,
        limit: 100,
      })

      const result = await service.getTrashedFoldersDictionary({})

      expect(result.items).toEqual([
        { label: 'Old Folder', value: '2', note: 'Folder ID: 2' },
      ])
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('includes hint for 401 errors', async () => {
      mock.onGet(`${ API_BASE }/users/me`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Unauthorized' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Authentication failed')
    })

    it('includes hint for 404 errors', async () => {
      mock.onGet(`${ API_BASE }/files/bad`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Not Found' },
      })

      await expect(service.getFileInfo('bad')).rejects.toThrow('Not found')
    })

    it('includes hint for 409 errors', async () => {
      mock.onPost(`${ API_BASE }/folders`).replyWithError({
        message: 'Conflict',
        status: 409,
        body: { message: 'Conflict' },
      })

      await expect(service.createFolder('dup', '0')).rejects.toThrow('Conflict')
    })
  })
})
