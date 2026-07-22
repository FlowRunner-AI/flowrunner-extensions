'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const ME_URL = `${GRAPH}/me`
const ACCESS_TOKEN = 'test-access-token'

const SITE_ID = 'contoso.sharepoint.com,abc,def'
const LIST_ID = 'list-123'
const DRIVE_ID = 'b!drive'
const ITEM_ID = '01ITEM'

describe('SharePoint Service', () => {
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

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: false, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: false, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toContain('Sites.ReadWrite.All')
      expect(service.scopes).toContain('offline_access')
    })
  })

  // ── OAuth system methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with required params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain('prompt=select_account')
      expect(url).toContain(encodeURIComponent('offline_access'))
      expect(url).toContain(encodeURIComponent('Files.ReadWrite.All'))
    })
  })

  describe('refreshToken', () => {
    it('exchanges a refresh token for a new access token', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('falls back to the current refresh token when the response omits one', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('kept-refresh-token')

      expect(result.refreshToken).toBe('kept-refresh-token')
    })

    it('throws on token endpoint error', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.refreshToken('bad')).rejects.toThrow('invalid_grant')
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code and resolves the connection identity', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const userData = {
        id: 'user-1',
        displayName: 'John Smith',
        mail: 'john@contoso.com',
      }

      mock.onGet(ME_URL).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@contoso.com (John Smith)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('uses mail only when displayName is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 1 })
      mock.onGet(ME_URL).reply({ mail: 'solo@contoso.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result.connectionIdentityName).toBe('solo@contoso.com')
    })

    it('falls back to userPrincipalName', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 1 })
      mock.onGet(ME_URL).reply({ userPrincipalName: 'upn@contoso.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result.connectionIdentityName).toBe('upn@contoso.com')
    })

    it('falls back to a default identity when the profile lookup fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 1 })
      mock.onGet(ME_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result.connectionIdentityName).toBe('SharePoint Connection')
      expect(result.userData).toEqual({})
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`).reply({
        value: [{ id: '1', fields: { Title: 'Sample' } }],
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewListItem',
        learningMode: true,
        triggerData: { siteId: SITE_ID, listId: LIST_ID },
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })
  })

  // ── Dictionaries ──

  describe('getSitesDictionary', () => {
    it('returns mapped sites with a wildcard search by default', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({
        value: [
          { id: 'site-1', displayName: 'Marketing', webUrl: 'https://contoso.sharepoint.com/sites/marketing' },
        ],
      })

      const result = await service.getSitesDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          {
            label: 'Marketing',
            note: 'URL: https://contoso.sharepoint.com/sites/marketing',
            value: 'site-1',
          },
        ],
      })

      expect(mock.history[0].query).toMatchObject({
        search: '*',
        $top: 25,
        $select: 'id,displayName,name,webUrl',
      })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({ value: [] })

      const result = await service.getSitesDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
      expect(mock.history[0].query).toMatchObject({ search: '*' })
    })

    it('passes the search string to Graph', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({ value: [] })

      await service.getSitesDictionary({ search: 'market' })

      expect(mock.history[0].query).toMatchObject({ search: 'market' })
    })

    it('follows the cursor URL without query params', async () => {
      const cursor = `${GRAPH}/sites?$skiptoken=abc`

      mock.onGet(cursor).reply({
        value: [{ id: 'site-2', name: 'Sales' }],
        '@odata.nextLink': `${GRAPH}/sites?$skiptoken=def`,
      })

      const result = await service.getSitesDictionary({ cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
      expect(result.cursor).toBe(`${GRAPH}/sites?$skiptoken=def`)
      expect(result.items[0]).toEqual({ label: 'Sales', note: 'ID: site-2', value: 'site-2' })
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({})

      const result = await service.getSitesDictionary({})

      expect(result).toEqual({ cursor: null, items: [] })
    })
  })

  describe('getListsDictionary', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists`

    it('returns empty when siteId is missing', async () => {
      const result = await service.getListsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped lists', async () => {
      mock.onGet(url).reply({ value: [{ id: 'l1', displayName: 'Tasks' }] })

      const result = await service.getListsDictionary({ criteria: { siteId: SITE_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Tasks', note: 'ID: l1', value: 'l1' }],
      })
      expect(mock.history[0].query).toMatchObject({ $top: 25, $select: 'id,displayName,name' })
    })

    it('filters locally by search', async () => {
      mock.onGet(url).reply({
        value: [
          { id: 'l1', displayName: 'Tasks' },
          { id: 'l2', displayName: 'Documents' },
        ],
      })

      const result = await service.getListsDictionary({ criteria: { siteId: SITE_ID }, search: 'DOC' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('l2')
    })

    it('follows a cursor', async () => {
      const cursor = `${url}?$skiptoken=next`

      mock.onGet(cursor).reply({ value: [{ id: 'l3', name: 'Archive' }] })

      const result = await service.getListsDictionary({ criteria: { siteId: SITE_ID }, cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
      expect(result.items[0].label).toBe('Archive')
    })
  })

  describe('getDrivesDictionary', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/drives`

    it('returns empty when siteId is missing', async () => {
      expect(await service.getDrivesDictionary({})).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped drives', async () => {
      mock.onGet(url).reply({ value: [{ id: 'd1', name: 'Documents', driveType: 'documentLibrary' }] })

      const result = await service.getDrivesDictionary({ criteria: { siteId: SITE_ID } })

      expect(result.items).toEqual([{ label: 'Documents', note: 'Type: documentLibrary', value: 'd1' }])
    })

    it('defaults the drive type note', async () => {
      mock.onGet(url).reply({ value: [{ id: 'd2' }] })

      const result = await service.getDrivesDictionary({ criteria: { siteId: SITE_ID } })

      expect(result.items[0]).toEqual({ label: 'd2', note: 'Type: documentLibrary', value: 'd2' })
    })

    it('filters by search', async () => {
      mock.onGet(url).reply({
        value: [
          { id: 'd1', name: 'Documents' },
          { id: 'd2', name: 'Images' },
        ],
      })

      const result = await service.getDrivesDictionary({ criteria: { siteId: SITE_ID }, search: 'imag' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('d2')
    })
  })

  describe('getDriveItemsDictionary', () => {
    it('returns empty when no drive is provided', async () => {
      expect(await service.getDriveItemsDictionary({ criteria: {} })).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('lists the drive root when no folder is provided', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/root/children`).reply({
        value: [
          { id: 'f1', name: 'Reports', folder: { childCount: 2 } },
          { id: 'f2', name: 'data.xlsx', file: {} },
        ],
      })

      const result = await service.getDriveItemsDictionary({ criteria: { driveId: DRIVE_ID } })

      expect(result.items).toEqual([
        { label: 'Reports', note: 'Type: folder', value: 'f1' },
        { label: 'data.xlsx', note: 'Type: file', value: 'f2' },
      ])
      expect(mock.history[0].query).toMatchObject({ $top: 25, $select: 'id,name,folder,file,size' })
    })

    it('lists a folder when folderId is provided', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/folder-1/children`).reply({ value: [] })

      await service.getDriveItemsDictionary({ criteria: { driveId: DRIVE_ID, folderId: 'folder-1' } })

      expect(mock.history[0].url).toBe(`${GRAPH}/drives/${DRIVE_ID}/items/folder-1/children`)
    })

    it('accepts the targetDriveId alias', async () => {
      mock.onGet(`${GRAPH}/drives/target-drive/root/children`).reply({ value: [] })

      await service.getDriveItemsDictionary({ criteria: { targetDriveId: 'target-drive' } })

      expect(mock.history[0].url).toBe(`${GRAPH}/drives/target-drive/root/children`)
    })

    it('filters by search and follows a cursor', async () => {
      const cursor = `${GRAPH}/drives/${DRIVE_ID}/root/children?$skiptoken=x`

      mock.onGet(cursor).reply({
        value: [
          { id: 'f1', name: 'Reports', folder: {} },
          { id: 'f2', name: 'notes.txt', file: {} },
        ],
      })

      const result = await service.getDriveItemsDictionary({
        criteria: { driveId: DRIVE_ID },
        cursor,
        search: 'notes',
      })

      expect(mock.history[0].url).toBe(cursor)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f2')
    })
  })

  describe('getListItemsDictionary', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`

    it('returns empty when site or list is missing', async () => {
      expect(await service.getListItemsDictionary({ criteria: { siteId: SITE_ID } })).toEqual({
        items: [],
        cursor: null,
      })
      expect(await service.getListItemsDictionary(null)).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps items by Title', async () => {
      mock.onGet(url).reply({
        value: [
          { id: '1', fields: { Title: 'Quarterly Report' } },
          { id: '2', fields: {} },
        ],
      })

      const result = await service.getListItemsDictionary({ criteria: { siteId: SITE_ID, listId: LIST_ID } })

      expect(result.items).toEqual([
        { label: 'Quarterly Report', note: 'ID: 1', value: '1' },
        { label: 'Item 2', note: 'ID: 2', value: '2' },
      ])
      expect(mock.history[0].query).toMatchObject({ $top: 25, $expand: 'fields($select=Title)' })
    })

    it('filters case-insensitively by Title', async () => {
      mock.onGet(url).reply({
        value: [
          { id: '1', fields: { Title: 'Alpha' } },
          { id: '2', fields: { Title: 'Beta' } },
          { id: '3', fields: {} },
        ],
      })

      const result = await service.getListItemsDictionary({
        criteria: { siteId: SITE_ID, listId: LIST_ID },
        search: 'BET',
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('follows a cursor', async () => {
      const cursor = `${url}?$skiptoken=next`

      mock.onGet(cursor).reply({ value: [] })

      await service.getListItemsDictionary({ criteria: { siteId: SITE_ID, listId: LIST_ID }, cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── User ──

  describe('getUserProfile', () => {
    it('requests the /me endpoint', async () => {
      mock.onGet(ME_URL).reply({ id: 'u1', displayName: 'John Smith' })

      const result = await service.getUserProfile()

      expect(result).toEqual({ id: 'u1', displayName: 'John Smith' })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws a friendly message on 401', async () => {
      mock.onGet(ME_URL).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { message: 'Access token expired' } },
      })

      await expect(service.getUserProfile()).rejects.toThrow(
        'Authentication failed — reconnect the SharePoint account. (Access token expired)'
      )
    })

    it('passes through unmapped error statuses', async () => {
      mock.onGet(ME_URL).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getUserProfile()).rejects.toThrow('Boom')
    })
  })

  // ── Sites ──

  describe('getRootSite', () => {
    it('requests the root site', async () => {
      mock.onGet(`${GRAPH}/sites/root`).reply({ id: 'root-site' })

      expect(await service.getRootSite()).toEqual({ id: 'root-site' })
    })
  })

  describe('getSiteById', () => {
    it('requests the site by id', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}`).reply({ id: SITE_ID })

      expect(await service.getSiteById(SITE_ID)).toEqual({ id: SITE_ID })
    })

    it('requires siteId', async () => {
      await expect(service.getSiteById()).rejects.toThrow('Parameter "Site" is required')
    })
  })

  describe('searchSites', () => {
    it('sends the search query with defaults', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({ value: [] })

      await service.searchSites('marketing')

      expect(mock.history[0].query).toMatchObject({
        search: 'marketing',
        $top: 25,
        $select: 'id,displayName,name,webUrl,description,createdDateTime',
      })
    })

    it('caps maxResults at 200', async () => {
      mock.onGet(`${GRAPH}/sites`).reply({ value: [] })

      await service.searchSites('*', 5000)

      expect(mock.history[0].query.$top).toBe(200)
    })

    it('requires a query', async () => {
      await expect(service.searchSites()).rejects.toThrow('Parameter "Query" is required')
    })
  })

  describe('getFollowedSites', () => {
    it('requests followed sites', async () => {
      mock.onGet(`${ME_URL}/followedSites`).reply({ value: [] })

      expect(await service.getFollowedSites()).toEqual({ value: [] })
    })
  })

  describe('getSiteByPath', () => {
    it('builds the hostname:path URL', async () => {
      mock.onGet(`${GRAPH}/sites/contoso.sharepoint.com:/sites/marketing`).reply({ id: 'x' })

      const result = await service.getSiteByPath('contoso.sharepoint.com', '/sites/marketing/')

      expect(result).toEqual({ id: 'x' })
      expect(mock.history[0].url).toBe(`${GRAPH}/sites/contoso.sharepoint.com:/sites/marketing`)
    })

    it('encodes path segments', async () => {
      mock.onGet(`${GRAPH}/sites/host.com:/sites/my%20site`).reply({ id: 'y' })

      await service.getSiteByPath('host.com', 'sites/my site')

      expect(mock.history[0].url).toBe(`${GRAPH}/sites/host.com:/sites/my%20site`)
    })

    it('requires hostname', async () => {
      await expect(service.getSiteByPath(null, '/sites/x')).rejects.toThrow('Parameter "Hostname" is required')
    })

    it('requires sitePath', async () => {
      await expect(service.getSiteByPath('host.com')).rejects.toThrow('Parameter "Site Path" is required')
    })

    it('rejects a path that is only slashes', async () => {
      await expect(service.getSiteByPath('host.com', '///')).rejects.toThrow(
        'Parameter "Site Path" cannot be empty or just slashes'
      )
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('requests lists with the default top', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists`).reply({ value: [] })

      await service.getLists(SITE_ID)

      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('caps maxResults', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists`).reply({ value: [] })

      await service.getLists(SITE_ID, 1000)

      expect(mock.history[0].query.$top).toBe(200)
    })

    it('requires siteId', async () => {
      await expect(service.getLists()).rejects.toThrow('Parameter "Site" is required')
    })
  })

  describe('getList', () => {
    it('expands columns', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}`).reply({ id: LIST_ID })

      await service.getList(SITE_ID, LIST_ID)

      expect(mock.history[0].query).toMatchObject({ $expand: 'columns' })
    })

    it('requires siteId', async () => {
      await expect(service.getList(null, LIST_ID)).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires listId', async () => {
      await expect(service.getList(SITE_ID)).rejects.toThrow('Parameter "List" is required')
    })
  })

  describe('createList', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists`

    it('creates a generic list by default', async () => {
      mock.onPost(url).reply({ id: 'new-list' })

      const result = await service.createList(SITE_ID, 'My List')

      expect(result).toEqual({ id: 'new-list' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        displayName: 'My List',
        list: { template: 'genericList' },
      })
    })

    it('maps the template label and includes the description', async () => {
      mock.onPost(url).reply({ id: 'new-list' })

      await service.createList(SITE_ID, 'Docs', 'Some description', 'Document Library')

      expect(mock.history[0].body).toEqual({
        displayName: 'Docs',
        description: 'Some description',
        list: { template: 'documentLibrary' },
      })
    })

    it('passes an unmapped template value through', async () => {
      mock.onPost(url).reply({ id: 'new-list' })

      await service.createList(SITE_ID, 'Docs', undefined, 'genericList')

      expect(mock.history[0].body.list.template).toBe('genericList')
    })

    it('requires siteId', async () => {
      await expect(service.createList(null, 'Name')).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires displayName', async () => {
      await expect(service.createList(SITE_ID)).rejects.toThrow('Parameter "Display Name" is required')
    })
  })

  describe('deleteList', () => {
    it('deletes and returns a message', async () => {
      mock.onDelete(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}`).reply('')

      const result = await service.deleteList(SITE_ID, LIST_ID)

      expect(result).toEqual({ message: 'List deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('requires siteId', async () => {
      await expect(service.deleteList(null, LIST_ID)).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires listId', async () => {
      await expect(service.deleteList(SITE_ID)).rejects.toThrow('Parameter "List" is required')
    })

    it('throws a friendly 404 message', async () => {
      mock.onDelete(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: { message: 'List not found' } },
      })

      await expect(service.deleteList(SITE_ID, LIST_ID)).rejects.toThrow(/Not found/)
    })
  })

  describe('getListColumns', () => {
    it('requests the columns endpoint', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/columns`).reply({ value: [] })

      expect(await service.getListColumns(SITE_ID, LIST_ID)).toEqual({ value: [] })
    })

    it('requires site and list', async () => {
      await expect(service.getListColumns(SITE_ID)).rejects.toThrow(
        'Parameters "Site" and "List" are required'
      )
    })
  })

  // ── List items ──

  describe('getListItems', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`

    it('expands fields with the default top', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getListItems(SITE_ID, LIST_ID)

      expect(mock.history[0].query).toMatchObject({ $expand: 'fields', $top: 25 })
      expect(mock.history[0].headers.Prefer).toBeUndefined()
    })

    it('adds filter, orderby and the Prefer header', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getListItems(SITE_ID, LIST_ID, 10, "fields/Title eq 'Foo'", 'fields/Modified desc')

      expect(mock.history[0].query).toMatchObject({
        $top: 10,
        $filter: "fields/Title eq 'Foo'",
        $orderby: 'fields/Modified desc',
      })
      expect(mock.history[0].headers).toMatchObject({
        Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
      })
    })

    it('uses nextLink and ignores other params', async () => {
      const nextLink = `${url}?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [{ id: '9' }] })

      const result = await service.getListItems(null, null, null, null, null, nextLink)

      expect(result.value).toHaveLength(1)
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('requires siteId', async () => {
      await expect(service.getListItems(null, LIST_ID)).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires listId', async () => {
      await expect(service.getListItems(SITE_ID)).rejects.toThrow('Parameter "List" is required')
    })
  })

  describe('getListItem', () => {
    it('expands fields', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/42`).reply({ id: '42' })

      const result = await service.getListItem(SITE_ID, LIST_ID, '42')

      expect(result).toEqual({ id: '42' })
      expect(mock.history[0].query).toMatchObject({ $expand: 'fields' })
    })

    it('requires all identifiers', async () => {
      await expect(service.getListItem(SITE_ID, LIST_ID)).rejects.toThrow(
        'Parameters "Site", "List" and "Item" are required'
      )
    })
  })

  describe('createListItem', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`

    it('wraps fields in the request body', async () => {
      mock.onPost(url).reply({ id: '42' })

      const result = await service.createListItem(SITE_ID, LIST_ID, { Title: 'My item' })

      expect(result).toEqual({ id: '42' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ fields: { Title: 'My item' } })
    })

    it('requires siteId', async () => {
      await expect(service.createListItem(null, LIST_ID, {})).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires listId', async () => {
      await expect(service.createListItem(SITE_ID, null, {})).rejects.toThrow('Parameter "List" is required')
    })

    it('requires an object for fields', async () => {
      await expect(service.createListItem(SITE_ID, LIST_ID, 'nope')).rejects.toThrow(
        'Parameter "Fields" is required and must be an object'
      )
    })
  })

  describe('updateListItem', () => {
    const url = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/42/fields`

    it('patches the fields endpoint', async () => {
      mock.onPatch(url).reply({ Title: 'Updated' })

      const result = await service.updateListItem(SITE_ID, LIST_ID, '42', { Title: 'Updated' })

      expect(result).toEqual({ Title: 'Updated' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ Title: 'Updated' })
    })

    it('requires all identifiers', async () => {
      await expect(service.updateListItem(SITE_ID, LIST_ID, null, {})).rejects.toThrow(
        'Parameters "Site", "List" and "Item" are required'
      )
    })

    it('requires fields', async () => {
      await expect(service.updateListItem(SITE_ID, LIST_ID, '42', null)).rejects.toThrow(
        'Parameter "Fields" is required and must be an object'
      )
    })
  })

  describe('deleteListItem', () => {
    it('deletes and returns a message', async () => {
      mock.onDelete(`${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items/42`).reply('')

      expect(await service.deleteListItem(SITE_ID, LIST_ID, '42')).toEqual({
        message: 'Item deleted successfully',
      })
    })

    it('requires all identifiers', async () => {
      await expect(service.deleteListItem(SITE_ID, LIST_ID)).rejects.toThrow(
        'Parameters "Site", "List" and "Item" are required'
      )
    })
  })

  // ── Drives ──

  describe('getDrives', () => {
    it('requests site drives', async () => {
      mock.onGet(`${GRAPH}/sites/${SITE_ID}/drives`).reply({ value: [] })

      expect(await service.getDrives(SITE_ID)).toEqual({ value: [] })
    })

    it('requires siteId', async () => {
      await expect(service.getDrives()).rejects.toThrow('Parameter "Site" is required')
    })
  })

  describe('listFolderChildren', () => {
    it('lists the drive root by default', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/root/children`).reply({ value: [] })

      await service.listFolderChildren(SITE_ID, DRIVE_ID)

      expect(mock.history[0].url).toBe(`${GRAPH}/drives/${DRIVE_ID}/root/children`)
      expect(mock.history[0].query).toMatchObject({ $top: 25 })
    })

    it('lists a folder and caps maxResults', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/folder-1/children`).reply({ value: [] })

      await service.listFolderChildren(SITE_ID, DRIVE_ID, 'folder-1', 900)

      expect(mock.history[0].query.$top).toBe(200)
    })

    it('uses nextLink when provided', async () => {
      const nextLink = `${GRAPH}/drives/${DRIVE_ID}/root/children?$skiptoken=x`

      mock.onGet(nextLink).reply({ value: [] })

      await service.listFolderChildren(null, null, null, null, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('requires siteId', async () => {
      await expect(service.listFolderChildren(null, DRIVE_ID)).rejects.toThrow('Parameter "Site" is required')
    })

    it('requires driveId', async () => {
      await expect(service.listFolderChildren(SITE_ID)).rejects.toThrow('Parameter "Drive" is required')
    })
  })

  describe('getDriveItem', () => {
    it('requests the item by id', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`).reply({ id: ITEM_ID })

      expect(await service.getDriveItem(SITE_ID, DRIVE_ID, ITEM_ID)).toEqual({ id: ITEM_ID })
    })

    it('requires all identifiers', async () => {
      await expect(service.getDriveItem(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Item" are required'
      )
    })
  })

  describe('getDriveItemByPath', () => {
    it('builds an encoded root-relative path', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/root:/Reports/Q1%20report.docx`).reply({ id: 'x' })

      await service.getDriveItemByPath(SITE_ID, DRIVE_ID, '/Reports/Q1 report.docx/')

      expect(mock.history[0].url).toBe(`${GRAPH}/drives/${DRIVE_ID}/root:/Reports/Q1%20report.docx`)
    })

    it('requires all parameters', async () => {
      await expect(service.getDriveItemByPath(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Item Path" are required'
      )
    })

    it('rejects a slash-only path', async () => {
      await expect(service.getDriveItemByPath(SITE_ID, DRIVE_ID, '//')).rejects.toThrow(
        'Parameter "Item Path" cannot be empty or just slashes'
      )
    })
  })

  describe('createFolder', () => {
    it('creates a folder in the drive root with the default conflict behavior', async () => {
      mock.onPost(`${GRAPH}/drives/${DRIVE_ID}/root/children`).reply({ id: 'folder-new' })

      const result = await service.createFolder(SITE_ID, DRIVE_ID, null, 'Reports')

      expect(result).toEqual({ id: 'folder-new' })
      expect(mock.history[0].body).toEqual({
        name: 'Reports',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      })
    })

    it('creates a folder inside a parent and maps the conflict label', async () => {
      mock.onPost(`${GRAPH}/drives/${DRIVE_ID}/items/parent-1/children`).reply({ id: 'folder-new' })

      await service.createFolder(SITE_ID, DRIVE_ID, 'parent-1', 'Reports', 'Rename')

      expect(mock.history[0].body['@microsoft.graph.conflictBehavior']).toBe('rename')
    })

    it('requires site, drive and folder name', async () => {
      await expect(service.createFolder(SITE_ID, DRIVE_ID, null, null)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Folder Name" are required'
      )
    })
  })

  describe('uploadFile', () => {
    it('uploads inline content to the drive root', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/root:/notes.txt:/content?@microsoft.graph.conflictBehavior=replace`

      mock.onPut(url).reply({ id: 'uploaded' })

      const result = await service.uploadFile(SITE_ID, DRIVE_ID, null, 'notes.txt', null, 'hello')

      expect(result).toEqual({ id: 'uploaded' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toBe('hello')
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('encodes the file name and honours parent folder and conflict behavior', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/items/parent-1:/my%20file.txt:/content?@microsoft.graph.conflictBehavior=rename`

      mock.onPut(url).reply({ id: 'uploaded' })

      await service.uploadFile(SITE_ID, DRIVE_ID, 'parent-1', 'my file.txt', null, 'x', 'text/csv', 'Rename')

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers['Content-Type']).toBe('text/csv')
    })

    it('downloads from a source URL and uploads the bytes', async () => {
      const sourceUrl = 'https://files.example.com/data.bin'
      const url = `${GRAPH}/drives/${DRIVE_ID}/root:/data.bin:/content?@microsoft.graph.conflictBehavior=replace`

      mock.onGet(sourceUrl).reply('binary-bytes')
      mock.onPut(url).reply({ id: 'uploaded' })

      await service.uploadFile(SITE_ID, DRIVE_ID, null, 'data.bin', sourceUrl)

      expect(mock.history[0].url).toBe(sourceUrl)
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].headers['Content-Type']).toBe('application/octet-stream')
      expect(mock.history[1].body).toBe('binary-bytes')
    })

    it('throws when the source URL cannot be fetched', async () => {
      mock.onGet('https://bad.example.com/x').replyWithError({ message: 'gone' })

      await expect(
        service.uploadFile(SITE_ID, DRIVE_ID, null, 'x.bin', 'https://bad.example.com/x')
      ).rejects.toThrow('Failed to fetch source URL: gone')
    })

    it('requires site, drive and file name', async () => {
      await expect(service.uploadFile(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "File Name" are required'
      )
    })

    it('requires one of source URL or content', async () => {
      await expect(service.uploadFile(SITE_ID, DRIVE_ID, null, 'a.txt')).rejects.toThrow(
        'One of "Source URL" or "Content" must be provided'
      )
    })

    it('rejects both source URL and content', async () => {
      await expect(
        service.uploadFile(SITE_ID, DRIVE_ID, null, 'a.txt', 'https://x/y', 'content')
      ).rejects.toThrow('Provide either "Source URL" or "Content", not both')
    })

    it('normalizes upload errors', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/root:/a.txt:/content?@microsoft.graph.conflictBehavior=replace`

      mock.onPut(url).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { error: { message: 'No write access' } },
      })

      await expect(service.uploadFile(SITE_ID, DRIVE_ID, null, 'a.txt', null, 'x')).rejects.toThrow(
        /Permission denied/
      )
    })
  })

  describe('downloadFile', () => {
    it('returns download metadata', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`).reply({
        id: ITEM_ID,
        name: 'data.xlsx',
        size: 1234,
        file: { mimeType: 'application/vnd.ms-excel' },
        '@microsoft.graph.downloadUrl': 'https://download.example.com/x',
      })

      const result = await service.downloadFile(SITE_ID, DRIVE_ID, ITEM_ID)

      expect(result).toEqual({
        id: ITEM_ID,
        name: 'data.xlsx',
        size: 1234,
        mimeType: 'application/vnd.ms-excel',
        downloadUrl: 'https://download.example.com/x',
      })
      expect(mock.history[0].query).toMatchObject({
        $select: 'id,name,size,file,@microsoft.graph.downloadUrl',
      })
    })

    it('nulls the download URL for a folder', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`).reply({
        id: ITEM_ID,
        name: 'Folder',
        size: 0,
      })

      const result = await service.downloadFile(SITE_ID, DRIVE_ID, ITEM_ID)

      expect(result.downloadUrl).toBeNull()
      expect(result.mimeType).toBeUndefined()
    })

    it('requires all identifiers', async () => {
      await expect(service.downloadFile(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Item" are required'
      )
    })
  })

  describe('deleteDriveItem', () => {
    it('deletes and returns a message', async () => {
      mock.onDelete(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`).reply('')

      expect(await service.deleteDriveItem(SITE_ID, DRIVE_ID, ITEM_ID)).toEqual({
        message: 'Item deleted successfully',
      })
    })

    it('requires all identifiers', async () => {
      await expect(service.deleteDriveItem(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Item" are required'
      )
    })
  })

  describe('moveDriveItem', () => {
    const url = `${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`

    it('patches the parent reference', async () => {
      mock.onPatch(url).reply({ id: ITEM_ID })

      await service.moveDriveItem(SITE_ID, DRIVE_ID, ITEM_ID, 'new-parent')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ parentReference: { id: 'new-parent' } })
    })

    it('includes a new name when provided', async () => {
      mock.onPatch(url).reply({ id: ITEM_ID })

      await service.moveDriveItem(SITE_ID, DRIVE_ID, ITEM_ID, 'new-parent', 'renamed.txt')

      expect(mock.history[0].body).toEqual({
        parentReference: { id: 'new-parent' },
        name: 'renamed.txt',
      })
    })

    it('requires the new parent folder', async () => {
      await expect(service.moveDriveItem(SITE_ID, DRIVE_ID, ITEM_ID)).rejects.toThrow(
        'Parameters "Site", "Drive", "Item" and "New Parent Folder" are required'
      )
    })
  })

  describe('copyDriveItem', () => {
    it('posts the copy request with the default conflict behavior', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}/copy?@microsoft.graph.conflictBehavior=rename`

      mock.onPost(url).reply('')

      const result = await service.copyDriveItem(SITE_ID, DRIVE_ID, ITEM_ID, 'target-drive', 'target-folder')

      expect(result).toEqual({ status: 'accepted' })
      expect(mock.history[0].body).toEqual({
        parentReference: { driveId: 'target-drive', id: 'target-folder' },
      })
    })

    it('maps the conflict label and includes the new name', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}/copy?@microsoft.graph.conflictBehavior=replace`

      mock.onPost(url).reply('')

      await service.copyDriveItem(
        SITE_ID,
        DRIVE_ID,
        ITEM_ID,
        'target-drive',
        'target-folder',
        'copy.txt',
        'Replace'
      )

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body.name).toBe('copy.txt')
    })

    it('requires the target drive and folder', async () => {
      await expect(service.copyDriveItem(SITE_ID, DRIVE_ID, ITEM_ID, 'target-drive')).rejects.toThrow(
        'Parameters "Site", "Drive", "Item", "Target Drive" and "Target Parent Folder" are required'
      )
    })
  })

  describe('createSharingLink', () => {
    const url = `${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}/createLink`

    it('creates an organization view link by default', async () => {
      mock.onPost(url).reply({ link: { webUrl: 'https://share' } })

      const result = await service.createSharingLink(SITE_ID, DRIVE_ID, ITEM_ID, 'View')

      expect(result).toEqual({ link: { webUrl: 'https://share' } })
      expect(mock.history[0].body).toEqual({ type: 'view', scope: 'organization' })
    })

    it('includes password and expiration when provided', async () => {
      mock.onPost(url).reply({})

      await service.createSharingLink(
        SITE_ID,
        DRIVE_ID,
        ITEM_ID,
        'Edit',
        'Anonymous',
        'secret',
        '2030-01-01T00:00:00Z'
      )

      expect(mock.history[0].body).toEqual({
        type: 'edit',
        scope: 'anonymous',
        password: 'secret',
        expirationDateTime: '2030-01-01T00:00:00Z',
      })
    })

    it('requires the link type', async () => {
      await expect(service.createSharingLink(SITE_ID, DRIVE_ID, ITEM_ID)).rejects.toThrow(
        'Parameters "Site", "Drive", "Item" and "Link Type" are required'
      )
    })
  })

  describe('renameDriveItem', () => {
    it('patches the item name', async () => {
      mock.onPatch(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}`).reply({ id: ITEM_ID })

      await service.renameDriveItem(SITE_ID, DRIVE_ID, ITEM_ID, 'renamed.txt')

      expect(mock.history[0].body).toEqual({ name: 'renamed.txt' })
    })

    it('requires the new name', async () => {
      await expect(service.renameDriveItem(SITE_ID, DRIVE_ID, ITEM_ID)).rejects.toThrow(
        'Parameters "Site", "Drive", "Item" and "New Name" are required'
      )
    })
  })

  describe('listDriveItemVersions', () => {
    it('requests the versions endpoint', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/${ITEM_ID}/versions`).reply({ value: [] })

      expect(await service.listDriveItemVersions(SITE_ID, DRIVE_ID, ITEM_ID)).toEqual({ value: [] })
    })

    it('requires all identifiers', async () => {
      await expect(service.listDriveItemVersions(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "Item" are required'
      )
    })
  })

  describe('createUploadSession', () => {
    it('creates a session at the drive root', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/root:/big%20file.zip:/createUploadSession`

      mock.onPost(url).reply({ uploadUrl: 'https://upload.example.com/session' })

      const result = await service.createUploadSession(SITE_ID, DRIVE_ID, null, 'big file.zip')

      expect(result).toEqual({ uploadUrl: 'https://upload.example.com/session' })
      expect(mock.history[0].body).toEqual({
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
          name: 'big file.zip',
        },
      })
    })

    it('creates a session inside a parent folder with a mapped conflict label', async () => {
      const url = `${GRAPH}/drives/${DRIVE_ID}/items/parent-1:/big.zip:/createUploadSession`

      mock.onPost(url).reply({ uploadUrl: 'u' })

      await service.createUploadSession(SITE_ID, DRIVE_ID, 'parent-1', 'big.zip', 'Fail')

      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].body.item['@microsoft.graph.conflictBehavior']).toBe('fail')
    })

    it('requires site, drive and file name', async () => {
      await expect(service.createUploadSession(SITE_ID, DRIVE_ID)).rejects.toThrow(
        'Parameters "Site", "Drive" and "File Name" are required'
      )
    })
  })

  describe('uploadLargeFile', () => {
    const uploadUrl = 'https://upload.example.com/session'
    const fileUrl = 'https://files.example.com/big.bin'

    it('uploads the file in a single byte range', async () => {
      mock.onGet(fileUrl).reply('abcdef')
      mock.onPut(uploadUrl).reply({ id: 'finished' })

      const result = await service.uploadLargeFile(uploadUrl, fileUrl)

      expect(result).toEqual({ id: 'finished' })
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].headers).toEqual({
        'Content-Type': 'application/octet-stream',
        'Content-Range': 'bytes 0-5/6',
      })
      expect(mock.history[1].headers.Authorization).toBeUndefined()
      expect(Buffer.isBuffer(mock.history[1].body)).toBe(true)
    })

    it('serializes a parsed JSON body into a buffer', async () => {
      mock.onGet(fileUrl).reply({ a: 1 })
      mock.onPut(uploadUrl).reply({ id: 'finished' })

      await service.uploadLargeFile(uploadUrl, fileUrl)

      expect(mock.history[1].body.toString()).toBe('{"a":1}')
    })

    it('requires the upload URL', async () => {
      await expect(service.uploadLargeFile()).rejects.toThrow(
        'Parameter "Upload URL" is required - call Create Upload Session first to obtain it'
      )
    })

    it('requires the file URL', async () => {
      await expect(service.uploadLargeFile(uploadUrl)).rejects.toThrow('Parameter "File" is required')
    })

    it('throws when the source file cannot be fetched', async () => {
      mock.onGet(fileUrl).replyWithError({ message: 'gone' })

      await expect(service.uploadLargeFile(uploadUrl, fileUrl)).rejects.toThrow(
        'Failed to fetch the source file: gone'
      )
    })

    it('throws when the source file is empty', async () => {
      mock.onGet(fileUrl).reply('')

      await expect(service.uploadLargeFile(uploadUrl, fileUrl)).rejects.toThrow('The source file is empty.')
    })

    it('normalizes chunk upload errors', async () => {
      mock.onGet(fileUrl).reply('abc')
      mock.onPut(uploadUrl).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { error: { message: 'Slow down' } },
      })

      await expect(service.uploadLargeFile(uploadUrl, fileUrl)).rejects.toThrow(/rate limit/)
    })
  })

  // ── Search ──

  describe('search', () => {
    const url = `${GRAPH}/search/query`

    it('searches driveItem by default', async () => {
      mock.onPost(url).reply({ value: [] })

      await service.search('report')

      expect(mock.history[0].body).toEqual({
        requests: [
          {
            entityTypes: ['driveItem'],
            query: { queryString: 'report' },
            from: 0,
            size: 25,
          },
        ],
      })
    })

    it('maps the entity type label and caps the size', async () => {
      mock.onPost(url).reply({ value: [] })

      await service.search('report', 'List Item', 500, 10)

      expect(mock.history[0].body.requests[0]).toEqual({
        entityTypes: ['listItem'],
        query: { queryString: 'report' },
        from: 10,
        size: 100,
      })
    })

    it('requires a query', async () => {
      await expect(service.search()).rejects.toThrow('Parameter "Query" is required')
    })
  })

  // ── Polling triggers ──

  describe('onNewListItem', () => {
    const itemsUrl = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`
    const triggerData = { siteId: SITE_ID, listId: LIST_ID }

    it('requires site and list', async () => {
      await expect(service.onNewListItem({ triggerData: {} })).rejects.toThrow(
        'Trigger requires "Site" and "List" parameters'
      )
    })

    it('returns one sample in learning mode', async () => {
      mock.onGet(itemsUrl).reply({ value: [{ id: '1', fields: { Title: 'Sample' } }] })

      const result = await service.onNewListItem({ learningMode: true, triggerData })

      expect(result.events).toEqual([{ id: '1', fields: { Title: 'Sample' } }])
      expect(result.state).toBeNull()
      expect(mock.history[0].query).toMatchObject({ $expand: 'fields', $top: 1 })
    })

    it('returns no events in learning mode when the list is empty', async () => {
      mock.onGet(itemsUrl).reply({})

      const result = await service.onNewListItem({ learningMode: true, triggerData })

      expect(result.events).toEqual([])
    })

    it('seeds state on the first poll without emitting events', async () => {
      mock.onGet(itemsUrl).reply({ value: [{ id: '1' }, { id: '2' }] })

      const result = await service.onNewListItem({ triggerData })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual(['1', '2'])
      expect(result.state.since).toEqual(expect.any(String))
      expect(mock.history[0].query.$filter).toMatch(/^fields\/Created ge '/)
      expect(mock.history[0].headers).toMatchObject({
        Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
      })
    })

    it('emits only unseen items on subsequent polls', async () => {
      mock.onGet(itemsUrl).reply({ value: [{ id: '1' }, { id: '3' }] })

      const result = await service.onNewListItem({
        triggerData,
        state: { since: new Date().toISOString(), seenIds: ['1'] },
      })

      expect(result.events).toEqual([{ id: '3' }])
      expect(result.state.seenIds).toEqual(['1', '3', '1'])
    })

    it('follows pagination when fetching items', async () => {
      const nextLink = `${itemsUrl}?$skiptoken=page2`

      mock.onGet(itemsUrl).reply({ value: [{ id: '1' }], '@odata.nextLink': nextLink })
      mock.onGet(nextLink).reply({ value: [{ id: '2' }] })

      const result = await service.onNewListItem({
        triggerData,
        state: { since: new Date().toISOString(), seenIds: [] },
      })

      expect(result.events).toEqual([{ id: '1' }, { id: '2' }])
      expect(mock.history).toHaveLength(2)
    })
  })

  describe('onUpdatedListItem', () => {
    const itemsUrl = `${GRAPH}/sites/${SITE_ID}/lists/${LIST_ID}/items`
    const triggerData = { siteId: SITE_ID, listId: LIST_ID }

    it('requires site and list', async () => {
      await expect(service.onUpdatedListItem({ triggerData: {} })).rejects.toThrow(
        'Trigger requires "Site" and "List" parameters'
      )
    })

    it('returns one sample in learning mode', async () => {
      mock.onGet(itemsUrl).reply({ value: [{ id: '1' }] })

      const result = await service.onUpdatedListItem({ learningMode: true, triggerData })

      expect(result.events).toEqual([{ id: '1' }])
      expect(result.state).toBeNull()
    })

    it('seeds state with id|modified keys', async () => {
      mock.onGet(itemsUrl).reply({
        value: [{ id: '1', lastModifiedDateTime: '2026-01-01T00:00:00Z' }],
      })

      const result = await service.onUpdatedListItem({ triggerData })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual(['1|2026-01-01T00:00:00Z'])
      expect(mock.history[0].query.$filter).toMatch(/^fields\/Modified ge '/)
    })

    it('emits updates to pre-existing items only', async () => {
      const since = '2026-06-01T00:00:00Z'

      mock.onGet(itemsUrl).reply({
        value: [
          // updated, created before the watermark → emitted
          { id: '1', createdDateTime: '2026-01-01T00:00:00Z', lastModifiedDateTime: '2026-06-02T00:00:00Z' },
          // brand new → belongs to onNewListItem
          { id: '2', createdDateTime: '2026-06-02T00:00:00Z', lastModifiedDateTime: '2026-06-02T00:00:00Z' },
          // already seen
          { id: '3', createdDateTime: '2026-01-01T00:00:00Z', lastModifiedDateTime: '2026-05-01T00:00:00Z' },
        ],
      })

      const result = await service.onUpdatedListItem({
        triggerData,
        state: { since, seenIds: ['3|2026-05-01T00:00:00Z'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('1')
      expect(result.state.seenIds).toContain('1|2026-06-02T00:00:00Z')
    })
  })

  describe('onNewFile', () => {
    const rootUrl = `${GRAPH}/drives/${DRIVE_ID}/root/children`
    const triggerData = { siteId: SITE_ID, driveId: DRIVE_ID }

    it('requires site and drive', async () => {
      await expect(service.onNewFile({ triggerData: { siteId: SITE_ID } })).rejects.toThrow(
        'Trigger requires "Site" and "Drive" parameters'
      )
    })

    it('returns one sample file in learning mode and ignores folders', async () => {
      mock.onGet(rootUrl).reply({
        value: [
          { id: 'folder-1', name: 'Reports', folder: {} },
          { id: 'file-1', name: 'a.txt', file: {} },
        ],
      })

      const result = await service.onNewFile({ learningMode: true, triggerData })

      expect(result.events).toEqual([{ id: 'file-1', name: 'a.txt', file: {} }])
      expect(result.state).toEqual({ fileIds: ['file-1'] })
      expect(mock.history[0].query).toMatchObject({ $top: 50, $orderby: 'lastModifiedDateTime desc' })
    })

    it('seeds state on the first poll', async () => {
      mock.onGet(rootUrl).reply({ value: [{ id: 'file-1', file: {} }] })

      const result = await service.onNewFile({ triggerData })

      expect(result).toEqual({ events: [], state: { fileIds: ['file-1'] } })
    })

    it('emits only files not present in the previous state', async () => {
      mock.onGet(rootUrl).reply({
        value: [
          { id: 'file-1', file: {} },
          { id: 'file-2', file: {} },
        ],
      })

      const result = await service.onNewFile({ triggerData, state: { fileIds: ['file-1'] } })

      expect(result.events).toEqual([{ id: 'file-2', file: {} }])
      expect(result.state.fileIds).toEqual(['file-1', 'file-2'])
    })

    it('lists a specific folder when folderId is provided', async () => {
      mock.onGet(`${GRAPH}/drives/${DRIVE_ID}/items/folder-1/children`).reply({ value: [] })

      const result = await service.onNewFile({
        triggerData: { ...triggerData, folderId: 'folder-1' },
        state: { fileIds: [] },
      })

      expect(result.events).toEqual([])
      expect(mock.history[0].url).toBe(`${GRAPH}/drives/${DRIVE_ID}/items/folder-1/children`)
    })

    it('follows pagination and stops when nextLink repeats', async () => {
      const nextLink = `${rootUrl}?$skiptoken=page2`

      mock.onGet(rootUrl).reply({ value: [{ id: 'file-1', file: {} }], '@odata.nextLink': nextLink })
      mock.onGet(nextLink).reply({ value: [{ id: 'file-2', file: {} }], '@odata.nextLink': nextLink })

      const result = await service.onNewFile({ triggerData, state: { fileIds: [] } })

      expect(result.events.map(f => f.id)).toEqual(['file-1', 'file-2'])
      expect(mock.history).toHaveLength(2)
    })
  })

  describe('onFileUpdated', () => {
    const rootUrl = `${GRAPH}/drives/${DRIVE_ID}/root/children`
    const triggerData = { siteId: SITE_ID, driveId: DRIVE_ID }

    it('requires site and drive', async () => {
      await expect(service.onFileUpdated({ triggerData: {} })).rejects.toThrow(
        'Trigger requires "Site" and "Drive" parameters'
      )
    })

    it('returns a sample and snapshot in learning mode', async () => {
      mock.onGet(rootUrl).reply({
        value: [{ id: 'file-1', file: {}, lastModifiedDateTime: '2026-01-01T00:00:00Z' }],
      })

      const result = await service.onFileUpdated({ learningMode: true, triggerData })

      expect(result.events).toHaveLength(1)
      expect(result.state.files).toEqual([
        { id: 'file-1', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
      ])
    })

    it('returns no events in learning mode when the folder is empty', async () => {
      mock.onGet(rootUrl).reply({ value: [] })

      const result = await service.onFileUpdated({ learningMode: true, triggerData })

      expect(result).toEqual({ events: [], state: { files: [] } })
    })

    it('seeds the snapshot on the first poll', async () => {
      mock.onGet(rootUrl).reply({
        value: [{ id: 'file-1', file: {}, lastModifiedDateTime: '2026-01-01T00:00:00Z' }],
      })

      const result = await service.onFileUpdated({ triggerData })

      expect(result.events).toEqual([])
      expect(result.state.files).toHaveLength(1)
    })

    it('emits files whose modified timestamp changed', async () => {
      mock.onGet(rootUrl).reply({
        value: [
          { id: 'file-1', file: {}, lastModifiedDateTime: '2026-02-01T00:00:00Z' },
          { id: 'file-2', file: {}, lastModifiedDateTime: '2026-01-01T00:00:00Z' },
          { id: 'file-3', file: {}, lastModifiedDateTime: '2026-01-01T00:00:00Z' },
        ],
      })

      const result = await service.onFileUpdated({
        triggerData,
        state: {
          files: [
            { id: 'file-1', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
            { id: 'file-2', lastModifiedDateTime: '2026-01-01T00:00:00Z' },
          ],
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('file-1')
      expect(result.state.files).toHaveLength(3)
    })
  })
})
