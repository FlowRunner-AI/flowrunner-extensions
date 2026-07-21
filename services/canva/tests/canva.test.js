'use strict'

const crypto = require('crypto')
const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const API_BASE = 'https://api.canva.com/rest/v1'
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token'
const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize'

const BASIC_TOKEN = Buffer.from(`${ CLIENT_ID }:${ CLIENT_SECRET }`).toString('base64')

// Reproduce the deterministic PKCE derivation from the service
const CODE_VERIFIER = crypto.createHash('sha256')
  .update(`${ CLIENT_SECRET }::${ CLIENT_ID }`)
  .digest('base64url')

const CODE_CHALLENGE = crypto.createHash('sha256')
  .update(CODE_VERIFIER)
  .digest('base64url')

describe('Canva Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }

    // Mock the flowrunner.Files API
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.pro/test-file.pdf' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
      },
    }
  })

  afterEach(() => {
    mock.reset()
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
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with PKCE params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(AUTHORIZE_URL)
      expect(url).toContain(`code_challenge=${ CODE_CHALLENGE }`)
      expect(url).toContain('code_challenge_method=s256')
      expect(url).toContain('response_type=code')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('state=flowrunner_')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges auth code for tokens and fetches user profile', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${ API_BASE }/users/me/profile`).reply({
        profile: { display_name: 'Jane Doe' },
      })

      mock.onGet(`${ API_BASE }/users/me`).reply({
        team_user: { user_id: 'u123', team_id: 't456' },
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://flowrunner.pro/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.connectionIdentityName).toBe('Jane Doe')
      expect(result.overwrite).toBe(true)
      expect(result.userData).toMatchObject({
        display_name: 'Jane Doe',
        user_id: 'u123',
        team_id: 't456',
      })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Basic ${ BASIC_TOKEN }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      const body = mock.history[0].body
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain('code=auth-code-123')
      expect(body).toContain(`code_verifier=${ CODE_VERIFIER }`)
    })

    it('falls back to "Canva Account" when profile fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${ API_BASE }/users/me/profile`).replyWithError({
        message: 'Forbidden',
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://flowrunner.pro/callback',
      })

      expect(result.connectionIdentityName).toBe('Canva Account')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token with basic auth', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe('refreshed-token')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.refreshToken).toBe('new-refresh-token')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Basic ${ BASIC_TOKEN }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      const body = mock.history[0].body
      expect(body).toContain('grant_type=refresh_token')
      expect(body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps the old refresh token when none is returned', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.refreshToken).toBe('old-refresh-token')
    })

    it('throws a re-auth error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })
  })

  // ── Dictionaries ──

  describe('getDesignsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${ API_BASE }/designs`).reply({
        items: [
          { id: 'D1', title: 'My Design', page_count: 3 },
          { id: 'D2', title: null, page_count: 1 },
        ],
        continuation: 'next-page-token',
      })

      const result = await service.getDesignsDictionary({ search: 'test' })

      expect(result.cursor).toBe('next-page-token')
      expect(result.items).toEqual([
        { label: 'My Design', value: 'D1', note: '3 pages' },
        { label: 'Untitled design', value: 'D2', note: '1 page' },
      ])

      expect(mock.history[0].query).toMatchObject({ query: 'test' })
    })

    it('passes cursor for pagination', async () => {
      mock.onGet(`${ API_BASE }/designs`).reply({ items: [] })

      await service.getDesignsDictionary({ cursor: 'abc123' })

      expect(mock.history[0].query).toMatchObject({ continuation: 'abc123' })
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ API_BASE }/designs`).reply({ items: [] })

      const result = await service.getDesignsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns folders with Root entry on first page', async () => {
      mock.onGet(`${ API_BASE }/folders/root/items`).reply({
        items: [
          { folder: { id: 'F1', name: 'Brand Assets' } },
          { folder: { id: 'F2', name: 'Campaign' } },
        ],
      })

      const result = await service.getFoldersDictionary({})

      expect(result.items[0]).toEqual({ label: 'Root (Projects)', value: 'root', note: 'Top level' })
      expect(result.items[1]).toEqual({ label: 'Brand Assets', value: 'F1', note: 'Folder' })
      expect(result.items[2]).toEqual({ label: 'Campaign', value: 'F2', note: 'Folder' })
    })

    it('filters folders by search locally', async () => {
      mock.onGet(`${ API_BASE }/folders/root/items`).reply({
        items: [
          { folder: { id: 'F1', name: 'Brand Assets' } },
          { folder: { id: 'F2', name: 'Campaign' } },
        ],
      })

      const result = await service.getFoldersDictionary({ search: 'brand' })

      expect(result.items).toEqual([
        { label: 'Brand Assets', value: 'F1', note: 'Folder' },
      ])
    })

    it('excludes Root entry when cursor is provided', async () => {
      mock.onGet(`${ API_BASE }/folders/root/items`).reply({ items: [] })

      const result = await service.getFoldersDictionary({ cursor: 'page2' })

      expect(result.items).toEqual([])
    })
  })

  describe('getBrandTemplatesDictionary', () => {
    it('returns formatted brand template items', async () => {
      mock.onGet(`${ API_BASE }/brand-templates`).reply({
        items: [
          { id: 'BT1', title: 'Ad Template' },
          { id: 'BT2', title: null },
        ],
        continuation: 'next',
      })

      const result = await service.getBrandTemplatesDictionary({ search: 'ad' })

      expect(result.cursor).toBe('next')
      expect(result.items).toEqual([
        { label: 'Ad Template', value: 'BT1', note: 'Brand template' },
        { label: 'Untitled template', value: 'BT2', note: 'Brand template' },
      ])

      expect(mock.history[0].query).toMatchObject({ query: 'ad' })
    })
  })

  // ── Designs ──

  describe('listDesigns', () => {
    it('sends correct request with all parameters', async () => {
      mock.onGet(`${ API_BASE }/designs`).reply({ items: [], continuation: null })

      await service.listDesigns('logo', 'Owned', 'Title (A-Z)', 'token123')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ OAUTH_TOKEN }`,
      })
      expect(mock.history[0].query).toMatchObject({
        query: 'logo',
        ownership: 'owned',
        sort_by: 'title_ascending',
        continuation: 'token123',
      })
    })

    it('omits optional parameters when not provided', async () => {
      mock.onGet(`${ API_BASE }/designs`).reply({ items: [] })

      await service.listDesigns()

      // cleanupObject removes undefined/null/empty values
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getDesign', () => {
    it('fetches a design by id', async () => {
      const designData = { design: { id: 'DAFVz', title: 'Test' } }
      mock.onGet(`${ API_BASE }/designs/DAFVz`).reply(designData)

      const result = await service.getDesign('DAFVz')

      expect(result).toEqual(designData)
    })

    it('throws when designId is missing', async () => {
      await expect(service.getDesign()).rejects.toThrow('"Design" is required')
    })
  })

  describe('createDesign', () => {
    it('creates a preset presentation design', async () => {
      mock.onPost(`${ API_BASE }/designs`).reply({ design: { id: 'D1' } })

      await service.createDesign('Presentation', null, null, 'My Deck')

      expect(mock.history[0].body).toEqual({
        design_type: { type: 'preset', name: 'presentation' },
        title: 'My Deck',
      })
    })

    it('creates a custom-dimension design', async () => {
      mock.onPost(`${ API_BASE }/designs`).reply({ design: { id: 'D2' } })

      await service.createDesign('Custom', 800, 600, 'Banner', 'asset123')

      expect(mock.history[0].body).toEqual({
        design_type: { type: 'custom', width: 800, height: 600 },
        title: 'Banner',
        asset_id: 'asset123',
      })
    })

    it('throws when Custom is selected without dimensions', async () => {
      await expect(service.createDesign('Custom'))
        .rejects.toThrow('"Width" and "Height" are required when Design Type is "Custom"')
    })

    it('omits title and assetId when not provided', async () => {
      mock.onPost(`${ API_BASE }/designs`).reply({ design: { id: 'D3' } })

      await service.createDesign('Doc')

      expect(mock.history[0].body).toEqual({
        design_type: { type: 'preset', name: 'doc' },
      })
    })
  })

  // ── Exports ──

  describe('exportDesign', () => {
    it('starts a PDF export with default options', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j1', status: 'in_progress' } })

      await service.exportDesign('D1', 'PDF')

      expect(mock.history[0].body).toEqual({
        design_id: 'D1',
        format: { type: 'pdf' },
      })
    })

    it('includes PDF size and export quality', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j2', status: 'in_progress' } })

      await service.exportDesign('D1', 'PDF', 'Pro', 'Letter')

      expect(mock.history[0].body.format).toEqual({
        type: 'pdf',
        export_quality: 'pro',
        size: 'letter',
      })
    })

    it('sets default JPG quality to 90', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j3', status: 'in_progress' } })

      await service.exportDesign('D1', 'JPG')

      expect(mock.history[0].body.format.quality).toBe(90)
    })

    it('passes custom JPG quality', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j4', status: 'in_progress' } })

      await service.exportDesign('D1', 'JPG', undefined, undefined, 75)

      expect(mock.history[0].body.format.quality).toBe(75)
    })

    it('sets default MP4 quality to horizontal_1080p', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j5', status: 'in_progress' } })

      await service.exportDesign('D1', 'Video (MP4)')

      expect(mock.history[0].body.format.quality).toBe('horizontal_1080p')
    })

    it('passes custom MP4 quality', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j6', status: 'in_progress' } })

      await service.exportDesign('D1', 'Video (MP4)', undefined, undefined, undefined, 'Vertical 720p')

      expect(mock.history[0].body.format.quality).toBe('vertical_720p')
    })

    it('includes width, height, and pages for PNG exports', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j7', status: 'in_progress' } })

      await service.exportDesign('D1', 'PNG', 'Regular', undefined, undefined, undefined, 1024, 768, [1, 3])

      expect(mock.history[0].body.format).toMatchObject({
        type: 'png',
        export_quality: 'regular',
        width: 1024,
        height: 768,
        pages: [1, 3],
      })
    })

    it('includes transparent background for PNG', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j8', status: 'in_progress' } })

      await service.exportDesign('D1', 'PNG', undefined, undefined, undefined, undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].body.format.transparent_background).toBe(true)
    })

    it('does not include export_quality for PPTX', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({ job: { id: 'j9', status: 'in_progress' } })

      await service.exportDesign('D1', 'PowerPoint (PPTX)', 'Pro')

      expect(mock.history[0].body.format).toEqual({ type: 'pptx' })
    })

    it('throws when designId is missing', async () => {
      await expect(service.exportDesign()).rejects.toThrow('"Design" is required')
    })
  })

  describe('getExportJob', () => {
    it('fetches export job status', async () => {
      const jobData = { job: { id: 'j1', status: 'success', urls: ['https://example.com/file.pdf'] } }
      mock.onGet(`${ API_BASE }/exports/j1`).reply(jobData)

      const result = await service.getExportJob('j1')

      expect(result).toEqual(jobData)
    })

    it('throws when exportId is missing', async () => {
      await expect(service.getExportJob()).rejects.toThrow('"Export Job ID" is required')
    })
  })

  describe('exportDesignAndWait', () => {
    it('starts export, polls until success, downloads and uploads files', async () => {
      // Start export
      mock.onPost(`${ API_BASE }/exports`).reply({
        job: { id: 'j1', status: 'in_progress' },
      })

      // First poll: in_progress, second poll: success
      mock.onGet(`${ API_BASE }/exports/j1`).replyWith(() => {
        const callCount = mock.history.filter(c => c.url === `${ API_BASE }/exports/j1`).length
        if (callCount <= 1) {
          return { job: { id: 'j1', status: 'in_progress' } }
        }
        return { job: { id: 'j1', status: 'success', urls: ['https://canva.com/download/file.pdf'] } }
      })

      // Download file
      mock.onGet('https://canva.com/download/file.pdf').reply(Buffer.from('pdf-content'))

      const result = await service.exportDesignAndWait('D1', 'PDF')

      expect(result.job.status).toBe('success')
      expect(result.files).toEqual(['https://files.flowrunner.pro/test-file.pdf'])
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'canva_D1_1.pdf',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('throws when export job fails', async () => {
      mock.onPost(`${ API_BASE }/exports`).reply({
        job: { id: 'j2', status: 'in_progress' },
      })

      mock.onGet(`${ API_BASE }/exports/j2`).reply({
        job: { id: 'j2', status: 'failed', error: { message: 'Design too large' } },
      })

      await expect(service.exportDesignAndWait('D1', 'PDF'))
        .rejects.toThrow('Canva export job j2 failed: Design too large')
    })
  })

  // ── Assets ──

  describe('uploadAsset', () => {
    it('downloads the file and uploads to Canva', async () => {
      mock.onGet('https://files.flowrunner.pro/image.png').reply(Buffer.from('image-bytes'))
      mock.onPost(`${ API_BASE }/asset-uploads`).reply({
        job: { id: 'a1', status: 'in_progress' },
      })

      const result = await service.uploadAsset('https://files.flowrunner.pro/image.png', 'My Image')

      expect(result.job.id).toBe('a1')

      // The POST to asset-uploads should have binary content and metadata header
      const uploadCall = mock.history.find(c => c.method === 'post')
      expect(uploadCall.headers).toMatchObject({
        'Authorization': `Bearer ${ OAUTH_TOKEN }`,
        'Content-Type': 'application/octet-stream',
      })
      expect(uploadCall.headers['Asset-Upload-Metadata']).toBeDefined()

      const metadata = JSON.parse(uploadCall.headers['Asset-Upload-Metadata'])
      expect(Buffer.from(metadata.name_base64, 'base64').toString()).toBe('My Image')
    })

    it('uses filename from URL when no name is provided', async () => {
      mock.onGet('https://files.flowrunner.pro/photo.jpg').reply(Buffer.from('bytes'))
      mock.onPost(`${ API_BASE }/asset-uploads`).reply({
        job: { id: 'a2', status: 'in_progress' },
      })

      await service.uploadAsset('https://files.flowrunner.pro/photo.jpg')

      const uploadCall = mock.history.find(c => c.method === 'post')
      const metadata = JSON.parse(uploadCall.headers['Asset-Upload-Metadata'])
      expect(Buffer.from(metadata.name_base64, 'base64').toString()).toBe('photo.jpg')
    })

    it('throws when fileUrl is missing', async () => {
      await expect(service.uploadAsset()).rejects.toThrow('"File" is required')
    })
  })

  describe('getAssetUploadJob', () => {
    it('fetches upload job status', async () => {
      const jobData = { job: { id: 'a1', status: 'success', asset: { id: 'asset1' } } }
      mock.onGet(`${ API_BASE }/asset-uploads/a1`).reply(jobData)

      const result = await service.getAssetUploadJob('a1')

      expect(result).toEqual(jobData)
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getAssetUploadJob()).rejects.toThrow('"Upload Job ID" is required')
    })
  })

  describe('uploadAssetAndWait', () => {
    it('uploads and polls until success', async () => {
      mock.onGet('https://files.flowrunner.pro/image.png').reply(Buffer.from('image-bytes'))
      mock.onPost(`${ API_BASE }/asset-uploads`).reply({
        job: { id: 'a1', status: 'in_progress' },
      })

      mock.onGet(`${ API_BASE }/asset-uploads/a1`).reply({
        job: { id: 'a1', status: 'success', asset: { id: 'asset1', name: 'My Image' } },
      })

      const result = await service.uploadAssetAndWait('https://files.flowrunner.pro/image.png', 'My Image')

      expect(result.job.status).toBe('success')
      expect(result.job.asset.id).toBe('asset1')
    })
  })

  describe('getAsset', () => {
    it('fetches asset metadata', async () => {
      const assetData = { asset: { id: 'Msd59', name: 'Logo' } }
      mock.onGet(`${ API_BASE }/assets/Msd59`).reply(assetData)

      const result = await service.getAsset('Msd59')

      expect(result).toEqual(assetData)
      expect(mock.history[0].headers['Authorization']).toBe(`Bearer ${ OAUTH_TOKEN }`)
    })

    it('throws when assetId is missing', async () => {
      await expect(service.getAsset()).rejects.toThrow('"Asset ID" is required')
    })
  })

  describe('updateAsset', () => {
    it('updates name only', async () => {
      mock.onPatch(`${ API_BASE }/assets/Msd59`).reply({ asset: { id: 'Msd59', name: 'New Name' } })

      await service.updateAsset('Msd59', 'New Name')

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })

    it('updates tags only', async () => {
      mock.onPatch(`${ API_BASE }/assets/Msd59`).reply({ asset: { id: 'Msd59', tags: ['a', 'b'] } })

      await service.updateAsset('Msd59', undefined, ['a', 'b'])

      expect(mock.history[0].body).toEqual({ tags: ['a', 'b'] })
    })

    it('updates both name and tags', async () => {
      mock.onPatch(`${ API_BASE }/assets/Msd59`).reply({ asset: { id: 'Msd59' } })

      await service.updateAsset('Msd59', 'Renamed', ['tag1'])

      expect(mock.history[0].body).toEqual({ name: 'Renamed', tags: ['tag1'] })
    })

    it('throws when assetId is missing', async () => {
      await expect(service.updateAsset()).rejects.toThrow('"Asset ID" is required')
    })

    it('throws when neither name nor tags are provided', async () => {
      await expect(service.updateAsset('Msd59'))
        .rejects.toThrow('At least one of "Name" or "Tags" is required')
    })
  })

  describe('deleteAsset', () => {
    it('sends DELETE request and returns success', async () => {
      mock.onDelete(`${ API_BASE }/assets/Msd59`).reply({})

      const result = await service.deleteAsset('Msd59')

      // Empty response is normalized to { status: 'success' }
      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when assetId is missing', async () => {
      await expect(service.deleteAsset()).rejects.toThrow('"Asset ID" is required')
    })
  })

  // ── Folders ──

  describe('createFolder', () => {
    it('creates a folder with name and parent', async () => {
      mock.onPost(`${ API_BASE }/folders`).reply({ folder: { id: 'F1', name: 'New Folder' } })

      await service.createFolder('New Folder', 'parentId')

      expect(mock.history[0].body).toEqual({
        name: 'New Folder',
        parent_folder_id: 'parentId',
      })
    })

    it('defaults parent to root', async () => {
      mock.onPost(`${ API_BASE }/folders`).reply({ folder: { id: 'F1' } })

      await service.createFolder('Test Folder')

      expect(mock.history[0].body.parent_folder_id).toBe('root')
    })

    it('throws when name is missing', async () => {
      await expect(service.createFolder()).rejects.toThrow('"Name" is required')
    })
  })

  describe('getFolder', () => {
    it('fetches folder metadata', async () => {
      const folderData = { folder: { id: 'F1', name: 'Assets' } }
      mock.onGet(`${ API_BASE }/folders/F1`).reply(folderData)

      const result = await service.getFolder('F1')

      expect(result).toEqual(folderData)
    })

    it('throws when folderId is missing', async () => {
      await expect(service.getFolder()).rejects.toThrow('"Folder" is required')
    })
  })

  describe('updateFolder', () => {
    it('renames a folder', async () => {
      mock.onPatch(`${ API_BASE }/folders/F1`).reply({ folder: { id: 'F1', name: 'Renamed' } })

      await service.updateFolder('F1', 'Renamed')

      expect(mock.history[0].body).toEqual({ name: 'Renamed' })
    })

    it('throws when folderId is missing', async () => {
      await expect(service.updateFolder()).rejects.toThrow('"Folder" is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.updateFolder('F1')).rejects.toThrow('"Name" is required')
    })
  })

  describe('deleteFolder', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${ API_BASE }/folders/F1`).reply({})

      const result = await service.deleteFolder('F1')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when folderId is missing', async () => {
      await expect(service.deleteFolder()).rejects.toThrow('"Folder" is required')
    })
  })

  describe('listFolderItems', () => {
    it('lists folder items with type filter', async () => {
      const response = {
        items: [{ type: 'design', design: { id: 'D1' } }],
        continuation: 'next',
      }
      mock.onGet(`${ API_BASE }/folders/F1/items`).reply(response)

      const result = await service.listFolderItems('F1', ['Design', 'Folder'], 'token')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        item_types: 'design,folder',
        continuation: 'token',
      })
    })

    it('omits item_types when not provided', async () => {
      mock.onGet(`${ API_BASE }/folders/root/items`).reply({ items: [] })

      await service.listFolderItems('root')

      // cleanupObject removes undefined values
      expect(mock.history[0].query.item_types).toBeUndefined()
    })

    it('throws when folderId is missing', async () => {
      await expect(service.listFolderItems()).rejects.toThrow('"Folder" is required')
    })
  })

  describe('moveFolderItem', () => {
    it('moves an item to a folder', async () => {
      mock.onPost(`${ API_BASE }/folders/move`).reply({})

      const result = await service.moveFolderItem('D1', 'F2')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({
        item_id: 'D1',
        to_folder_id: 'F2',
      })
    })

    it('throws when itemId is missing', async () => {
      await expect(service.moveFolderItem()).rejects.toThrow('"Item ID" is required')
    })

    it('throws when toFolderId is missing', async () => {
      await expect(service.moveFolderItem('D1')).rejects.toThrow('"Destination Folder" is required')
    })
  })

  // ── Brand Templates ──

  describe('listBrandTemplates', () => {
    it('lists brand templates with search and pagination', async () => {
      const response = { items: [{ id: 'BT1', title: 'Ad' }], continuation: 'next' }
      mock.onGet(`${ API_BASE }/brand-templates`).reply(response)

      const result = await service.listBrandTemplates('ad', 'cursor1')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ query: 'ad', continuation: 'cursor1' })
    })
  })

  describe('getBrandTemplate', () => {
    it('fetches a brand template by id', async () => {
      const data = { brand_template: { id: 'BT1', title: 'Ad Template' } }
      mock.onGet(`${ API_BASE }/brand-templates/BT1`).reply(data)

      const result = await service.getBrandTemplate('BT1')

      expect(result).toEqual(data)
    })

    it('throws when brandTemplateId is missing', async () => {
      await expect(service.getBrandTemplate()).rejects.toThrow('"Brand Template" is required')
    })
  })

  describe('getBrandTemplateDataset', () => {
    it('fetches the dataset definition', async () => {
      const data = { dataset: { headline: { type: 'text' } } }
      mock.onGet(`${ API_BASE }/brand-templates/BT1/dataset`).reply(data)

      const result = await service.getBrandTemplateDataset('BT1')

      expect(result).toEqual(data)
    })

    it('throws when brandTemplateId is missing', async () => {
      await expect(service.getBrandTemplateDataset()).rejects.toThrow('"Brand Template" is required')
    })
  })

  // ── Autofill ──

  describe('autofillDesign', () => {
    it('starts an autofill job with data and title', async () => {
      mock.onPost(`${ API_BASE }/autofills`).reply({
        job: { id: 'af1', status: 'in_progress' },
      })

      const data = { headline: { type: 'text', text: 'Sale' } }
      await service.autofillDesign('BT1', data, 'Spring Ad')

      expect(mock.history[0].body).toEqual({
        brand_template_id: 'BT1',
        data,
        title: 'Spring Ad',
      })
    })

    it('omits title when not provided', async () => {
      mock.onPost(`${ API_BASE }/autofills`).reply({
        job: { id: 'af2', status: 'in_progress' },
      })

      const data = { headline: { type: 'text', text: 'Sale' } }
      await service.autofillDesign('BT1', data)

      expect(mock.history[0].body).toEqual({
        brand_template_id: 'BT1',
        data,
      })
    })

    it('throws when brandTemplateId is missing', async () => {
      await expect(service.autofillDesign()).rejects.toThrow('"Brand Template" is required')
    })

    it('throws when data is empty', async () => {
      await expect(service.autofillDesign('BT1', {}))
        .rejects.toThrow('"Data" is required and must map at least one dataset field to a value')
    })

    it('throws when data is not an object', async () => {
      await expect(service.autofillDesign('BT1', 'invalid'))
        .rejects.toThrow('"Data" is required and must map at least one dataset field to a value')
    })
  })

  describe('getAutofillJob', () => {
    it('fetches autofill job status', async () => {
      const data = { job: { id: 'af1', status: 'success', result: { type: 'create_design' } } }
      mock.onGet(`${ API_BASE }/autofills/af1`).reply(data)

      const result = await service.getAutofillJob('af1')

      expect(result).toEqual(data)
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getAutofillJob()).rejects.toThrow('"Autofill Job ID" is required')
    })
  })

  describe('autofillDesignAndWait', () => {
    it('starts autofill and polls until success', async () => {
      mock.onPost(`${ API_BASE }/autofills`).reply({
        job: { id: 'af1', status: 'in_progress' },
      })

      mock.onGet(`${ API_BASE }/autofills/af1`).reply({
        job: { id: 'af1', status: 'success', result: { type: 'create_design', design: { id: 'D1' } } },
      })

      const data = { headline: { type: 'text', text: 'Hello' } }
      const result = await service.autofillDesignAndWait('BT1', data, 'Title')

      expect(result.job.status).toBe('success')
      expect(result.job.result.design.id).toBe('D1')
    })
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('fetches current user info', async () => {
      const data = { team_user: { user_id: 'u1', team_id: 't1' } }
      mock.onGet(`${ API_BASE }/users/me`).reply(data)

      const result = await service.getCurrentUser()

      expect(result).toEqual(data)
      expect(mock.history[0].headers['Authorization']).toBe(`Bearer ${ OAUTH_TOKEN }`)
    })
  })

  describe('getUserProfile', () => {
    it('fetches user profile', async () => {
      const data = { profile: { display_name: 'Jane Doe' } }
      mock.onGet(`${ API_BASE }/users/me/profile`).reply(data)

      const result = await service.getUserProfile()

      expect(result).toEqual(data)
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts Canva error with code', async () => {
      mock.onGet(`${ API_BASE }/designs/bad`).replyWithError({
        message: 'Not Found',
        body: { message: 'Design not found', code: 'not_found' },
      })

      await expect(service.getDesign('bad'))
        .rejects.toThrow('Canva API error: Design not found [not_found]')
    })

    it('extracts error_description from OAuth errors', async () => {
      mock.onGet(`${ API_BASE }/designs/bad`).replyWithError({
        message: 'Unauthorized',
        body: { error_description: 'Token expired' },
      })

      await expect(service.getDesign('bad'))
        .rejects.toThrow('Canva API error: Token expired')
    })

    it('extracts plain error string', async () => {
      mock.onGet(`${ API_BASE }/designs/bad`).replyWithError({
        message: 'Server Error',
        body: { error: 'internal_error' },
      })

      await expect(service.getDesign('bad'))
        .rejects.toThrow('Canva API error: internal_error')
    })

    it('falls back to error.message when body has no recognized shape', async () => {
      mock.onGet(`${ API_BASE }/designs/bad`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getDesign('bad'))
        .rejects.toThrow('Canva API error: Network Error')
    })
  })
})
