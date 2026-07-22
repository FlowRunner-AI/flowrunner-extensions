'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'
const DRIVE_BASE = `${ API_BASE }/me/drive`

const AUTH_HEADER = { Authorization: `Bearer ${ ACCESS_TOKEN }` }

const searchUrl = q => `${ DRIVE_BASE }/root/search(q='${ encodeURIComponent(String(q).replace(/'/g, "''")) }')`

describe('Microsoft OneDrive Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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

      expect(configItems).toEqual([
        expect.objectContaining({
          name: 'clientId',
          displayName: 'Client ID',
          type: 'STRING',
          required: true,
          shared: true,
        }),
        expect.objectContaining({
          name: 'clientSecret',
          displayName: 'Client Secret',
          type: 'STRING',
          required: true,
          shared: true,
        }),
      ])
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toBe('offline_access User.Read Files.ReadWrite.All')
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with client id, scopes and response mode', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${ OAUTH_BASE }/authorize?`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain('scope=offline_access+User.Read+Files.ReadWrite.All')
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for tokens and loads the user profile', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const userData = { mail: 'john@test.com', displayName: 'John Smith' }

      mock.onGet(`${ API_BASE }/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@test.com (John Smith)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ OAUTH_BASE }/token`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)
      expect(mock.history[0].body).toContain(`redirect_uri=${ encodeURIComponent('https://redirect.example.com/callback') }`)

      expect(mock.history[1].url).toBe(`${ API_BASE }/me`)
      expect(mock.history[1].headers).toMatchObject({ Authorization: 'Bearer new-access-token' })
    })

    it('falls back to userPrincipalName when mail is missing', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 10 })
      mock.onGet(`${ API_BASE }/me`).reply({ userPrincipalName: 'jane@test.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x/cb' })

      expect(result.connectionIdentityName).toBe('jane@test.com')
    })

    it('falls back to displayName when no email is present', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 10 })
      mock.onGet(`${ API_BASE }/me`).reply({ displayName: 'Jane Roe' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x/cb' })

      expect(result.connectionIdentityName).toBe('Jane Roe')
    })

    it('uses a generic identity name when the profile request fails', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 10 })
      mock.onGet(`${ API_BASE }/me`).replyWithError({ message: 'profile unavailable' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x/cb' })

      expect(result.connectionIdentityName).toBe('Microsoft OneDrive Connection')
      expect(result.userData).toEqual({})
      expect(result.token).toBe('t')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'refreshed-refresh',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh')
      expect(mock.history[0].body).toContain('scope=offline_access+User.Read+Files.ReadWrite.All')
    })

    it('keeps the current refresh token when the response omits one', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({ access_token: 'refreshed-token', expires_in: 7200 })

      const result = await service.refreshToken('old-refresh')

      expect(result.refreshToken).toBe('old-refresh')
    })

    it('rethrows the original error on failure', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.refreshToken('old-refresh')).rejects.toThrow('invalid_grant')
    })
  })

  // ── Dictionaries ──

  describe('getFoldersDictionary', () => {
    it('lists root folders and skips files', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({
        value: [
          { id: 'f1', name: 'Documents', folder: { childCount: 12 } },
          { id: 'f2', name: 'Single', folder: { childCount: 1 } },
          { id: 'file1', name: 'report.pdf', file: { mimeType: 'application/pdf' } },
        ],
      })

      const result = await service.getFoldersDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Documents', value: 'f1', note: '12 items' },
          { label: 'Single', value: 'f2', note: '1 item' },
        ],
      })

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({ $top: 50 })
    })

    it('falls back to the parent path or a generic note when childCount is missing', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({
        value: [
          { id: 'f1', name: 'WithPath', folder: {}, parentReference: { path: '/drive/root:' } },
          { id: 'f2', name: 'NoPath', folder: {} },
        ],
      })

      const result = await service.getFoldersDictionary(null)

      expect(result.items).toEqual([
        { label: 'WithPath', value: 'f1', note: '/drive/root:' },
        { label: 'NoPath', value: 'f2', note: 'Folder' },
      ])
    })

    it('searches the whole drive when a search string is provided', async () => {
      mock.onGet(searchUrl('rep')).reply({
        value: [{ id: 'f1', name: 'Reports', folder: { childCount: 2 } }],
        '@odata.nextLink': `${ DRIVE_BASE }/next-page`,
      })

      const result = await service.getFoldersDictionary({ search: 'rep' })

      expect(result.cursor).toBe(`${ DRIVE_BASE }/next-page`)
      expect(result.items).toHaveLength(1)
      expect(mock.history[0].url).toBe(searchUrl('rep'))
    })

    it('follows the cursor without extra query params', async () => {
      const cursor = `${ DRIVE_BASE }/root/children?$skiptoken=abc`

      mock.onGet(cursor).reply({ value: [] })

      const result = await service.getFoldersDictionary({ cursor })

      expect(result).toEqual({ cursor: null, items: [] })
      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({})

      await expect(service.getFoldersDictionary({})).resolves.toEqual({ cursor: null, items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Access token has expired' } },
      })

      await expect(service.getFoldersDictionary({})).rejects.toThrow(
        'Microsoft OneDrive API error: Access token has expired'
      )
    })
  })

  describe('getItemsDictionary', () => {
    it('lists root items with file and folder notes', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({
        value: [
          { id: 'f1', name: 'Documents', folder: { childCount: 3 } },
          { id: 'f2', name: 'Empty', folder: {} },
          { id: 'i1', name: 'report.pdf', size: 24576 },
          { id: 'i2', name: 'unknown.bin' },
        ],
      })

      const result = await service.getItemsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Documents', value: 'f1', note: 'Folder, 3 items' },
          { label: 'Empty', value: 'f2', note: 'Folder, 0 items' },
          { label: 'report.pdf', value: 'i1', note: 'File, 24576 bytes' },
          { label: 'unknown.bin', value: 'i2', note: 'File, 0 bytes' },
        ],
      })

      expect(mock.history[0].query).toEqual({ $top: 50 })
    })

    it('searches the whole drive and escapes single quotes', async () => {
      mock.onGet(searchUrl("it's")).reply({ value: [{ id: 'i1', name: "it's.txt", size: 1 }] })

      const result = await service.getItemsDictionary({ search: "it's" })

      expect(result.items).toEqual([{ label: "it's.txt", value: 'i1', note: 'File, 1 bytes' }])
      expect(mock.history[0].url).toContain("q='it''s'")
    })

    it('follows the cursor and returns the next link', async () => {
      const cursor = `${ DRIVE_BASE }/root/children?$skiptoken=xyz`

      mock.onGet(cursor).reply({ value: [], '@odata.nextLink': 'https://next' })

      const result = await service.getItemsDictionary({ cursor })

      expect(result).toEqual({ cursor: 'https://next', items: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('handles a null payload and empty results', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({ value: null })

      await expect(service.getItemsDictionary(null)).resolves.toEqual({ cursor: null, items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).replyWithError({ message: 'boom' })

      await expect(service.getItemsDictionary({})).rejects.toThrow('Microsoft OneDrive API error: boom')
    })
  })

  // ── Items ──

  describe('listItemsInFolder', () => {
    it('lists the drive root with the default page size', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({
        value: [
          {
            id: 'i1',
            name: 'report.pdf',
            size: 24576,
            webUrl: 'https://onedrive.live.com/report',
            lastModifiedDateTime: '2026-07-13T10:00:00Z',
            createdDateTime: '2026-07-01T09:00:00Z',
            file: { mimeType: 'application/pdf' },
            parentReference: { path: '/drive/root:' },
          },
        ],
      })

      const result = await service.listItemsInFolder()

      expect(result).toEqual({
        nextLink: null,
        items: [
          {
            id: 'i1',
            name: 'report.pdf',
            type: 'file',
            size: 24576,
            webUrl: 'https://onedrive.live.com/report',
            lastModifiedDateTime: '2026-07-13T10:00:00Z',
            createdDateTime: '2026-07-01T09:00:00Z',
            mimeType: 'application/pdf',
            childCount: null,
            parentPath: '/drive/root:',
          },
        ],
      })

      expect(mock.history[0].query).toEqual({ $top: 50 })
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('maps folders and fills missing fields with null', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/folder-1/children`).reply({
        value: [{ id: 'f1', name: 'Reports', folder: { childCount: 4 } }],
        '@odata.nextLink': 'https://next-page',
      })

      const result = await service.listItemsInFolder('folder-1', 10)

      expect(result.nextLink).toBe('https://next-page')

      expect(result.items[0]).toEqual({
        id: 'f1',
        name: 'Reports',
        type: 'folder',
        size: null,
        webUrl: null,
        lastModifiedDateTime: null,
        createdDateTime: null,
        mimeType: null,
        childCount: 4,
        parentPath: null,
      })

      expect(mock.history[0].query).toEqual({ $top: 10 })
    })

    it('caps the page size at 200', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).reply({ value: [] })

      await service.listItemsInFolder(null, 5000)

      expect(mock.history[0].query).toEqual({ $top: 200 })
    })

    it('follows the next page link and ignores other params', async () => {
      const nextLink = `${ DRIVE_BASE }/root/children?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [] })

      const result = await service.listItemsInFolder('folder-1', 25, nextLink)

      expect(result).toEqual({ items: [], nextLink: null })
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DRIVE_BASE }/root/children`).replyWithError({
        body: { error: { message: 'itemNotFound' } },
        message: 'Not Found',
      })

      await expect(service.listItemsInFolder()).rejects.toThrow('Microsoft OneDrive API error: itemNotFound')
    })
  })

  describe('searchItems', () => {
    it('searches the drive with the default page size', async () => {
      mock.onGet(searchUrl('quarterly')).reply({
        value: [{ id: 'i1', name: 'Q1-report.pdf', size: 100, file: { mimeType: 'application/pdf' } }],
      })

      const result = await service.searchItems('quarterly')

      expect(result.items[0]).toMatchObject({ id: 'i1', name: 'Q1-report.pdf', type: 'file' })
      expect(result.nextLink).toBeNull()
      expect(mock.history[0].query).toEqual({ $top: 50 })
    })

    it('caps the page size at 200', async () => {
      mock.onGet(searchUrl('x')).reply({ value: [] })

      await service.searchItems('x', 999)

      expect(mock.history[0].query).toEqual({ $top: 200 })
    })

    it('follows the next page link without a query', async () => {
      const nextLink = `${ DRIVE_BASE }/root/search?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [], '@odata.nextLink': 'https://more' })

      const result = await service.searchItems(null, 10, nextLink)

      expect(result).toEqual({ items: [], nextLink: 'https://more' })
      expect(mock.history[0].query).toEqual({})
    })

    it('requires a query when no next link is given', async () => {
      await expect(service.searchItems()).rejects.toThrow('Parameter "Query" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(searchUrl('boom')).replyWithError({ message: 'search failed' })

      await expect(service.searchItems('boom')).rejects.toThrow('Microsoft OneDrive API error: search failed')
    })
  })

  describe('getItem', () => {
    it('retrieves an item by id', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'summary.pdf' })

      const result = await service.getItem('item-1')

      expect(result).toEqual({ id: 'item-1', name: 'summary.pdf' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('retrieves an item by path, encoding each segment', async () => {
      const url = `${ DRIVE_BASE }/root:/Reports/Q1%20Data/summary.pdf`

      mock.onGet(url).reply({ id: 'item-2' })

      const result = await service.getItem(null, '/Reports/Q1 Data/summary.pdf/')

      expect(result).toEqual({ id: 'item-2' })
      expect(mock.history[0].url).toBe(url)
    })

    it('prefers the item id over the path', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1' })

      await service.getItem('item-1', 'Reports/summary.pdf')

      expect(mock.history[0].url).toBe(`${ DRIVE_BASE }/items/item-1`)
    })

    it('requires an item id or a path', async () => {
      await expect(service.getItem()).rejects.toThrow('One of "Item" or "Path" must be provided')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/missing`).replyWithError({
        body: { error: { message: 'The resource could not be found.' } },
      })

      await expect(service.getItem('missing')).rejects.toThrow(
        'Microsoft OneDrive API error: The resource could not be found.'
      )
    })
  })

  // ── Files ──

  describe('downloadFile', () => {
    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://storage.flowrunner.com/files/flow/report.pdf' })
      service.flowrunner = { Files: { uploadFile } }
    })

    it('downloads a file and stores it in FlowRunner file storage', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({
        id: 'item-1',
        name: 'report.pdf',
        size: 5,
        file: { mimeType: 'application/pdf' },
      })

      mock.onGet(`${ DRIVE_BASE }/items/item-1/content`).reply(Buffer.from('hello'))

      const result = await service.downloadFile('item-1')

      expect(result).toEqual({
        fileUrl: 'https://storage.flowrunner.com/files/flow/report.pdf',
        fileName: 'report.pdf',
        size: 5,
        mimeType: 'application/pdf',
        itemId: 'item-1',
      })

      expect(mock.history[0].query).toEqual({ $select: 'id,name,size,file,folder' })
      expect(mock.history[1].encoding).toBeNull()
      expect(mock.history[1].headers).toMatchObject(AUTH_HEADER)

      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('hello'), {
        filename: 'report.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
    })

    it('passes custom file options through to file storage', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'notes.txt' })
      mock.onGet(`${ DRIVE_BASE }/items/item-1/content`).reply('plain text body')

      const result = await service.downloadFile('item-1', { scope: 'APP' })

      expect(result.size).toBe('plain text body'.length)
      expect(result.mimeType).toBeNull()
      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('plain text body'), expect.objectContaining({ scope: 'APP' }))
    })

    it('re-serializes a parsed JSON body into a buffer', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'data.json' })
      mock.onGet(`${ DRIVE_BASE }/items/item-1/content`).reply({ a: 1 })

      await service.downloadFile('item-1')

      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('{"a":1}'), expect.any(Object))
    })

    it('requires an item id', async () => {
      await expect(service.downloadFile()).rejects.toThrow('Parameter "Item" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('rejects folders', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/folder-1`).reply({ id: 'folder-1', name: 'Docs', folder: { childCount: 0 } })

      await expect(service.downloadFile('folder-1')).rejects.toThrow(
        'The selected item is a folder - only files can be downloaded'
      )

      expect(uploadFile).not.toHaveBeenCalled()
    })

    it('wraps content download errors', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'report.pdf' })

      mock.onGet(`${ DRIVE_BASE }/items/item-1/content`).replyWithError({
        body: { error: { message: 'Download URL expired' } },
        message: 'Gone',
      })

      await expect(service.downloadFile('item-1')).rejects.toThrow(
        'Microsoft OneDrive API error: Download URL expired'
      )
    })

    it('wraps content download errors without an error body', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'report.pdf' })
      mock.onGet(`${ DRIVE_BASE }/items/item-1/content`).replyWithError({ message: 'socket hang up' })

      await expect(service.downloadFile('item-1')).rejects.toThrow(
        'Microsoft OneDrive API error: socket hang up'
      )
    })

    it('wraps metadata errors', async () => {
      mock.onGet(`${ DRIVE_BASE }/items/item-1`).replyWithError({ message: 'itemNotFound' })

      await expect(service.downloadFile('item-1')).rejects.toThrow('Microsoft OneDrive API error: itemNotFound')
    })
  })

  describe('uploadFile', () => {
    const SOURCE_URL = 'https://files.example.com/report.pdf'
    const smallBody = Buffer.from('small file content')

    it('uploads a small file to the drive root', async () => {
      const uploadUrl = `${ DRIVE_BASE }/root:/report.pdf:/content?@microsoft.graph.conflictBehavior=rename`

      mock.onGet(SOURCE_URL).reply(smallBody)
      mock.onPut(uploadUrl).reply({ id: 'new-1', name: 'report.pdf' })

      const result = await service.uploadFile(SOURCE_URL, 'report.pdf')

      expect(result).toEqual({ id: 'new-1', name: 'report.pdf' })
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].url).toBe(uploadUrl)

      expect(mock.history[1].headers).toMatchObject({
        ...AUTH_HEADER,
        'Content-Type': 'application/octet-stream',
      })

      expect(mock.history[1].body).toEqual(smallBody)
    })

    it('uploads into a parent folder with the Replace conflict behavior', async () => {
      const uploadUrl = `${ DRIVE_BASE }/items/folder-1:/my%20file.pdf:/content?@microsoft.graph.conflictBehavior=replace`

      mock.onGet(SOURCE_URL).reply(smallBody)
      mock.onPut(uploadUrl).reply({ id: 'new-2' })

      await service.uploadFile(SOURCE_URL, 'my file.pdf', 'folder-1', 'Ignored/Path', 'Replace')

      expect(mock.history[1].url).toBe(uploadUrl)
    })

    it('uploads into a folder path, encoding each segment', async () => {
      const uploadUrl = `${ DRIVE_BASE }/root:/Reports/Q1%20Data/report.pdf:/content?@microsoft.graph.conflictBehavior=fail`

      mock.onGet(SOURCE_URL).reply(smallBody)
      mock.onPut(uploadUrl).reply({ id: 'new-3' })

      await service.uploadFile(SOURCE_URL, 'report.pdf', null, '/Reports/Q1 Data/', 'Fail')

      expect(mock.history[1].url).toBe(uploadUrl)
    })

    it('passes an unmapped conflict behavior through unchanged', async () => {
      const uploadUrl = `${ DRIVE_BASE }/root:/report.pdf:/content?@microsoft.graph.conflictBehavior=replace`

      mock.onGet(SOURCE_URL).reply(smallBody)
      mock.onPut(uploadUrl).reply({ id: 'new-4' })

      await service.uploadFile(SOURCE_URL, 'report.pdf', null, null, 'replace')

      expect(mock.history[1].url).toBe(uploadUrl)
    })

    it('uploads a large file through a resumable session in 5 MiB chunks', async () => {
      const total = 11 * 1024 * 1024
      const large = Buffer.alloc(total, 7)
      const sessionUrl = `${ DRIVE_BASE }/root:/big.bin:/createUploadSession`

      mock.onGet(SOURCE_URL).reply(large)
      mock.onPost(sessionUrl).reply({ uploadUrl: 'https://upload.example.com/session-1' })

      mock.onPut('https://upload.example.com/session-1').replyWith(call => {
        return call.headers['Content-Range'] === `bytes 10485760-${ total - 1 }/${ total }`
          ? { id: 'big-1', name: 'big.bin' }
          : {}
      })

      const result = await service.uploadFile(SOURCE_URL, 'big.bin')

      expect(result).toEqual({ id: 'big-1', name: 'big.bin' })

      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(sessionUrl)

      expect(mock.history[1].body).toEqual({
        item: {
          '@microsoft.graph.conflictBehavior': 'rename',
          name: 'big.bin',
        },
      })

      const chunks = mock.history.slice(2)

      expect(chunks).toHaveLength(3)

      expect(chunks.map(c => c.headers['Content-Range'])).toEqual([
        `bytes 0-5242879/${ total }`,
        `bytes 5242880-10485759/${ total }`,
        `bytes 10485760-${ total - 1 }/${ total }`,
      ])

      expect(chunks[0].body.length).toBe(5 * 1024 * 1024)
      expect(chunks[2].body.length).toBe(total - 10 * 1024 * 1024)
      // Chunk PUTs must not carry the bearer token - Graph rejects them if they do
      chunks.forEach(chunk => expect(chunk.headers.Authorization).toBeUndefined())
    })

    it('requires the source file url', async () => {
      await expect(service.uploadFile()).rejects.toThrow('Parameter "File" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('requires the file name', async () => {
      await expect(service.uploadFile(SOURCE_URL)).rejects.toThrow('Parameter "File Name" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('fails when the source file cannot be fetched', async () => {
      mock.onGet(SOURCE_URL).replyWithError({ message: 'connect ECONNREFUSED' })

      await expect(service.uploadFile(SOURCE_URL, 'report.pdf')).rejects.toThrow(
        'Failed to fetch the source file: connect ECONNREFUSED'
      )
    })

    it('fails when the source file is empty', async () => {
      mock.onGet(SOURCE_URL).reply(Buffer.alloc(0))

      await expect(service.uploadFile(SOURCE_URL, 'report.pdf')).rejects.toThrow('The source file is empty.')
    })

    it('wraps simple upload errors', async () => {
      mock.onGet(SOURCE_URL).reply(smallBody)

      mock.onPut(`${ DRIVE_BASE }/root:/report.pdf:/content?@microsoft.graph.conflictBehavior=rename`).replyWithError({
        body: { error: { message: 'nameAlreadyExists' } },
        message: 'Conflict',
      })

      await expect(service.uploadFile(SOURCE_URL, 'report.pdf')).rejects.toThrow(
        'Microsoft OneDrive API error: nameAlreadyExists'
      )
    })

    it('wraps chunk upload errors', async () => {
      const large = Buffer.alloc(5 * 1024 * 1024, 1)

      mock.onGet(SOURCE_URL).reply(large)

      mock.onPost(`${ DRIVE_BASE }/root:/big.bin:/createUploadSession`).reply({
        uploadUrl: 'https://upload.example.com/session-2',
      })

      mock.onPut('https://upload.example.com/session-2').replyWithError({ message: 'chunk rejected' })

      await expect(service.uploadFile(SOURCE_URL, 'big.bin')).rejects.toThrow(
        'Microsoft OneDrive API error: chunk rejected'
      )
    })

    it('wraps upload session creation errors', async () => {
      const large = Buffer.alloc(5 * 1024 * 1024, 1)

      mock.onGet(SOURCE_URL).reply(large)

      mock.onPost(`${ DRIVE_BASE }/root:/big.bin:/createUploadSession`).replyWithError({
        body: { error: { message: 'quota exceeded' } },
      })

      await expect(service.uploadFile(SOURCE_URL, 'big.bin')).rejects.toThrow(
        'Microsoft OneDrive API error: quota exceeded'
      )
    })
  })

  // ── Folders ──

  describe('createFolder', () => {
    it('creates a folder at the drive root with the default conflict behavior', async () => {
      mock.onPost(`${ DRIVE_BASE }/root/children`).reply({ id: 'f1', name: 'Reports' })

      const result = await service.createFolder('Reports')

      expect(result).toEqual({ id: 'f1', name: 'Reports' })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        name: 'Reports',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      })

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('creates a folder inside a parent with a mapped conflict behavior', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/parent-1/children`).reply({ id: 'f2' })

      await service.createFolder('Q1', 'parent-1', 'Rename')

      expect(mock.history[0].url).toBe(`${ DRIVE_BASE }/items/parent-1/children`)
      expect(mock.history[0].body['@microsoft.graph.conflictBehavior']).toBe('rename')
    })

    it('requires a folder name', async () => {
      await expect(service.createFolder()).rejects.toThrow('Parameter "Folder Name" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DRIVE_BASE }/root/children`).replyWithError({
        body: { error: { message: 'nameAlreadyExists' } },
      })

      await expect(service.createFolder('Reports')).rejects.toThrow(
        'Microsoft OneDrive API error: nameAlreadyExists'
      )
    })
  })

  // ── Item operations ──

  describe('moveItem', () => {
    it('moves an item into another folder', async () => {
      mock.onPatch(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1' })

      const result = await service.moveItem('item-1', 'folder-2')

      expect(result).toEqual({ id: 'item-1' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ parentReference: { id: 'folder-2' } })
    })

    it('moves and renames in one step', async () => {
      mock.onPatch(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1' })

      await service.moveItem('item-1', 'folder-2', 'renamed.pdf')

      expect(mock.history[0].body).toEqual({
        parentReference: { id: 'folder-2' },
        name: 'renamed.pdf',
      })
    })

    it('requires the item id', async () => {
      await expect(service.moveItem()).rejects.toThrow('Parameter "Item" is required')
    })

    it('requires the destination folder', async () => {
      await expect(service.moveItem('item-1')).rejects.toThrow('Parameter "New Parent Folder" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ DRIVE_BASE }/items/item-1`).replyWithError({ message: 'move failed' })

      await expect(service.moveItem('item-1', 'folder-2')).rejects.toThrow(
        'Microsoft OneDrive API error: move failed'
      )
    })
  })

  describe('renameItem', () => {
    it('renames an item in place', async () => {
      mock.onPatch(`${ DRIVE_BASE }/items/item-1`).reply({ id: 'item-1', name: 'Q1-report.pdf' })

      const result = await service.renameItem('item-1', 'Q1-report.pdf')

      expect(result).toEqual({ id: 'item-1', name: 'Q1-report.pdf' })
      expect(mock.history[0].body).toEqual({ name: 'Q1-report.pdf' })
    })

    it('requires the item id', async () => {
      await expect(service.renameItem()).rejects.toThrow('Parameter "Item" is required')
    })

    it('requires the new name', async () => {
      await expect(service.renameItem('item-1')).rejects.toThrow('Parameter "New Name" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ DRIVE_BASE }/items/item-1`).replyWithError({ message: 'rename failed' })

      await expect(service.renameItem('item-1', 'x.pdf')).rejects.toThrow(
        'Microsoft OneDrive API error: rename failed'
      )
    })
  })

  describe('copyItem', () => {
    it('copies an item into another folder', async () => {
      const url = `${ DRIVE_BASE }/items/item-1/copy?@microsoft.graph.conflictBehavior=rename`

      mock.onPost(url).reply('')

      const result = await service.copyItem('item-1', 'folder-2')

      expect(result).toEqual({
        status: 'accepted',
        message: 'The copy was accepted and runs in the background. List or search the destination folder in a few seconds to confirm the new item.',
      })

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({ parentReference: { id: 'folder-2' } })
    })

    it('copies within the same folder under a new name', async () => {
      const url = `${ DRIVE_BASE }/items/item-1/copy?@microsoft.graph.conflictBehavior=fail`

      mock.onPost(url).reply('')

      await service.copyItem('item-1', null, 'copy.pdf', 'Fail')

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body).toEqual({ name: 'copy.pdf' })
    })

    it('sends both parent and name when provided', async () => {
      const url = `${ DRIVE_BASE }/items/item-1/copy?@microsoft.graph.conflictBehavior=replace`

      mock.onPost(url).reply('')

      await service.copyItem('item-1', 'folder-2', 'copy.pdf', 'Replace')

      expect(mock.history[0].body).toEqual({
        parentReference: { id: 'folder-2' },
        name: 'copy.pdf',
      })
    })

    it('requires the item id', async () => {
      await expect(service.copyItem()).rejects.toThrow('Parameter "Item" is required')
    })

    it('requires a destination folder or a new name', async () => {
      await expect(service.copyItem('item-1')).rejects.toThrow(
        'Provide a "Destination Folder", a "New Name", or both - copying an item onto itself is not possible'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/item-1/copy?@microsoft.graph.conflictBehavior=rename`).replyWithError({
        body: { error: { message: 'copy not allowed' } },
      })

      await expect(service.copyItem('item-1', 'folder-2')).rejects.toThrow(
        'Microsoft OneDrive API error: copy not allowed'
      )
    })
  })

  describe('deleteItem', () => {
    it('deletes an item and returns a confirmation', async () => {
      mock.onDelete(`${ DRIVE_BASE }/items/item-1`).reply('')

      const result = await service.deleteItem('item-1')

      expect(result).toEqual({ message: 'Item deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('requires the item id', async () => {
      await expect(service.deleteItem()).rejects.toThrow('Parameter "Item" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ DRIVE_BASE }/items/item-1`).replyWithError({
        body: { error: { message: 'itemNotFound' } },
      })

      await expect(service.deleteItem('item-1')).rejects.toThrow('Microsoft OneDrive API error: itemNotFound')
    })
  })

  // ── Sharing ──

  describe('createSharingLink', () => {
    it('creates an anonymous view link by default', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/item-1/createLink`).reply({
        id: '123ABC',
        link: { type: 'view', scope: 'anonymous', webUrl: 'https://1drv.ms/b/s!AkD' },
      })

      const result = await service.createSharingLink('item-1', 'View')

      expect(result.link.webUrl).toBe('https://1drv.ms/b/s!AkD')
      expect(mock.history[0].body).toEqual({ type: 'view', scope: 'anonymous' })
    })

    it('creates an organization edit link', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/item-1/createLink`).reply({ id: '456' })

      await service.createSharingLink('item-1', 'Edit', 'Organization')

      expect(mock.history[0].body).toEqual({ type: 'edit', scope: 'organization' })
    })

    it('passes unmapped link type and scope values through', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/item-1/createLink`).reply({ id: '789' })

      await service.createSharingLink('item-1', 'embed', 'users')

      expect(mock.history[0].body).toEqual({ type: 'embed', scope: 'users' })
    })

    it('requires the item id', async () => {
      await expect(service.createSharingLink()).rejects.toThrow('Parameter "Item" is required')
    })

    it('requires the link type', async () => {
      await expect(service.createSharingLink('item-1')).rejects.toThrow('Parameter "Link Type" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ DRIVE_BASE }/items/item-1/createLink`).replyWithError({
        body: { error: { message: 'Sharing is disabled' } },
      })

      await expect(service.createSharingLink('item-1', 'View')).rejects.toThrow(
        'Microsoft OneDrive API error: Sharing is disabled'
      )
    })
  })

  // ── Drive ──

  describe('getDriveInfo', () => {
    it('returns the drive metadata', async () => {
      const drive = {
        id: 'drive-1',
        driveType: 'business',
        owner: { user: { displayName: 'John Smith' } },
        quota: { total: 100, used: 10, remaining: 90, state: 'normal' },
      }

      mock.onGet(DRIVE_BASE).reply(drive)

      const result = await service.getDriveInfo()

      expect(result).toEqual(drive)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(DRIVE_BASE)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(DRIVE_BASE).replyWithError({ message: 'Unauthorized' })

      await expect(service.getDriveInfo()).rejects.toThrow('Microsoft OneDrive API error: Unauthorized')
    })
  })
})
