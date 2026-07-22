'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'
const ACCESS_TOKEN = 'test-access-token'

const ITEM_ID = '01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K'

const workbookUrl = path => `${API_BASE}/me/drive/items/${encodeURIComponent(ITEM_ID)}/workbook${path}`
const rangeUrl = (worksheet, address) =>
  workbookUrl(`/worksheets/${encodeURIComponent(worksheet)}/range(address='${encodeURIComponent(address)}')`)
const searchUrl = text => `${API_BASE}/me/drive/root/search(q='${encodeURIComponent(text)}')`

describe('Microsoft Excel 365 Service', () => {
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toBe('offline_access User.Read Files.ReadWrite.All')
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent('offline_access'))
      expect(url).toContain(encodeURIComponent('Files.ReadWrite.All'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user profile', async () => {
      const userData = {
        displayName: 'John Doe',
        mail: 'john@test.com',
      }

      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@test.com (John Doe)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain(
        `redirect_uri=${encodeURIComponent('https://redirect.example.com/callback')}`
      )

      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('falls back to default identity name when profile lookup fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redirect.example.com' })

      expect(result.connectionIdentityName).toBe('Microsoft Excel 365 Connection')
      expect(result.userData).toEqual({})
    })

    it('uses userPrincipalName when mail is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply({ userPrincipalName: 'jane@test.com', displayName: 'Jane' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redirect.example.com' })

      expect(result.connectionIdentityName).toBe('jane@test.com (Jane)')
    })

    it('uses displayName only when email is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply({ displayName: 'Jane Doe' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redirect.example.com' })

      expect(result.connectionIdentityName).toBe('Jane Doe')
    })

    it('uses email only when displayName is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply({ mail: 'solo@test.com' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redirect.example.com' })

      expect(result.connectionIdentityName).toBe('solo@test.com')
    })
  })

  describe('refreshToken', () => {
    it('sends refresh token request and returns new tokens', async () => {
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

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws on refresh error', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'Invalid grant' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getWorkbooksDictionary', () => {
    it('returns mapped workbooks using the default search term', async () => {
      mock.onGet(searchUrl('xlsx')).reply({
        value: [
          { id: 'wb-1', name: 'Sales Report.xlsx', file: {}, parentReference: { path: '/drive/root:/Documents' } },
          { id: 'wb-2', name: 'Notes.docx', file: {} },
          { id: 'folder-1', name: 'Reports.xlsx' },
        ],
      })

      const result = await service.getWorkbooksDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Sales Report.xlsx', note: '/drive/root:/Documents', value: 'wb-1' }],
      })

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
      expect(mock.history[0].query).toMatchObject({ $top: 50 })
    })

    it('handles a null payload', async () => {
      mock.onGet(searchUrl('xlsx')).reply({ value: [] })

      const result = await service.getWorkbooksDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('uses the search term and falls back to the item ID as note', async () => {
      mock.onGet(searchUrl('budget')).reply({
        value: [{ id: 'wb-9', name: 'Budget.xlsx', file: {} }],
        '@odata.nextLink': 'https://graph.microsoft.com/next-page',
      })

      const result = await service.getWorkbooksDictionary({ search: 'budget' })

      expect(result).toEqual({
        cursor: 'https://graph.microsoft.com/next-page',
        items: [{ label: 'Budget.xlsx', note: 'ID: wb-9', value: 'wb-9' }],
      })
    })

    it('escapes single quotes in the search term', async () => {
      mock.onGet(searchUrl("O''Brien")).reply({ value: [] })

      const result = await service.getWorkbooksDictionary({ search: "O'Brien" })

      expect(result.items).toEqual([])
    })

    it('follows the cursor without applying the xlsx filter', async () => {
      const cursor = 'https://graph.microsoft.com/v1.0/next-page'

      mock.onGet(cursor).reply({ value: [{ id: 'wb-3', name: 'Anything', parentReference: { path: '/p' } }] })

      const result = await service.getWorkbooksDictionary({ cursor })

      expect(result.items).toEqual([{ label: 'Anything', note: '/p', value: 'wb-3' }])
      expect(mock.history[0].url).toBe(cursor)
    })

    it('handles a missing value array', async () => {
      mock.onGet(searchUrl('xlsx')).reply({})

      const result = await service.getWorkbooksDictionary({})

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(searchUrl('xlsx')).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Insufficient privileges' } },
      })

      await expect(service.getWorkbooksDictionary({})).rejects.toThrow(
        'Microsoft Excel 365 API error: Insufficient privileges'
      )
    })

    it('falls back to error.message when the error body is missing', async () => {
      mock.onGet(searchUrl('xlsx')).replyWithError({ message: 'Network timeout' })

      await expect(service.getWorkbooksDictionary({})).rejects.toThrow('Microsoft Excel 365 API error: Network timeout')
    })
  })

  describe('getWorksheetsDictionary', () => {
    it('returns mapped worksheets', async () => {
      mock.onGet(workbookUrl('/worksheets')).reply({
        value: [
          { id: '{sheet-1}', name: 'Sheet1' },
          { id: '{sheet-2}', name: 'Summary' },
        ],
      })

      const result = await service.getWorksheetsDictionary({ criteria: { itemId: ITEM_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Sheet1', note: 'ID: {sheet-1}', value: 'Sheet1' },
          { label: 'Summary', note: 'ID: {sheet-2}', value: 'Summary' },
        ],
      })
    })

    it('filters worksheets by case-insensitive search', async () => {
      mock.onGet(workbookUrl('/worksheets')).reply({
        value: [
          { id: '{sheet-1}', name: 'Sheet1' },
          { id: '{sheet-2}', name: 'Summary' },
        ],
      })

      const result = await service.getWorksheetsDictionary({ search: 'SUMM', criteria: { itemId: ITEM_ID } })

      expect(result.items).toEqual([{ label: 'Summary', note: 'ID: {sheet-2}', value: 'Summary' }])
    })

    it('returns empty items when no workbook criteria is provided', async () => {
      const result = await service.getWorksheetsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items for a null payload', async () => {
      const result = await service.getWorksheetsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('handles a missing value array', async () => {
      mock.onGet(workbookUrl('/worksheets')).reply({})

      const result = await service.getWorksheetsDictionary({ criteria: { itemId: ITEM_ID } })

      expect(result).toEqual({ cursor: null, items: [] })
    })
  })

  describe('getTablesDictionary', () => {
    it('returns mapped tables', async () => {
      mock.onGet(workbookUrl('/tables')).reply({
        value: [
          { id: '1', name: 'SalesTable' },
          { id: '2', name: 'CostTable' },
        ],
      })

      const result = await service.getTablesDictionary({ criteria: { itemId: ITEM_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'SalesTable', note: 'ID: 1', value: 'SalesTable' },
          { label: 'CostTable', note: 'ID: 2', value: 'CostTable' },
        ],
      })
    })

    it('filters tables by case-insensitive search', async () => {
      mock.onGet(workbookUrl('/tables')).reply({
        value: [
          { id: '1', name: 'SalesTable' },
          { id: '2', name: 'CostTable' },
        ],
      })

      const result = await service.getTablesDictionary({ search: 'cost', criteria: { itemId: ITEM_ID } })

      expect(result.items).toEqual([{ label: 'CostTable', note: 'ID: 2', value: 'CostTable' }])
    })

    it('returns empty items when no workbook criteria is provided', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items for a null payload', async () => {
      const result = await service.getTablesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a missing value array', async () => {
      mock.onGet(workbookUrl('/tables')).reply({})

      const result = await service.getTablesDictionary({ criteria: { itemId: ITEM_ID } })

      expect(result).toEqual({ cursor: null, items: [] })
    })
  })

  // ── Workbooks ──

  describe('listWorkbooks', () => {
    it('returns mapped workbooks with the default search term', async () => {
      mock.onGet(searchUrl('xlsx')).reply({
        value: [
          {
            id: 'wb-1',
            name: 'Sales Report.xlsx',
            file: {},
            webUrl: 'https://onedrive.live.com/edit.aspx?resid=ABC123',
            parentReference: { path: '/drive/root:/Documents' },
            size: 24576,
            createdDateTime: '2026-06-01T09:00:00Z',
            lastModifiedDateTime: '2026-07-10T15:30:00Z',
          },
          { id: 'wb-2', name: 'Notes.docx', file: {} },
        ],
      })

      const result = await service.listWorkbooks()

      expect(result).toEqual({
        nextLink: null,
        value: [
          {
            id: 'wb-1',
            name: 'Sales Report.xlsx',
            webUrl: 'https://onedrive.live.com/edit.aspx?resid=ABC123',
            parentPath: '/drive/root:/Documents',
            size: 24576,
            createdDateTime: '2026-06-01T09:00:00Z',
            lastModifiedDateTime: '2026-07-10T15:30:00Z',
          },
        ],
      })
    })

    it('passes the search term and returns the next link', async () => {
      mock.onGet(searchUrl('sales')).reply({
        value: [{ id: 'wb-1', name: 'Sales.xlsx', file: {} }],
        '@odata.nextLink': 'https://graph.microsoft.com/next',
      })

      const result = await service.listWorkbooks('sales')

      expect(result.nextLink).toBe('https://graph.microsoft.com/next')
      expect(result.value[0].parentPath).toBeNull()
    })

    it('follows the next link when provided', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/page-2'

      mock.onGet(nextLink).reply({ value: [{ id: 'wb-5', name: 'Later.xlsx' }] })

      const result = await service.listWorkbooks('ignored', nextLink)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(nextLink)
      expect(result.value[0].id).toBe('wb-5')
    })

    it('handles a missing value array', async () => {
      mock.onGet(searchUrl('xlsx')).reply({})

      const result = await service.listWorkbooks()

      expect(result).toEqual({ value: [], nextLink: null })
    })
  })

  // ── Worksheets ──

  describe('listWorksheets', () => {
    it('returns worksheets for the workbook', async () => {
      const response = { value: [{ id: '{sheet-1}', name: 'Sheet1', position: 0, visibility: 'Visible' }] }

      mock.onGet(workbookUrl('/worksheets')).reply(response)

      const result = await service.listWorksheets(ITEM_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.listWorksheets()).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(workbookUrl('/worksheets')).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Item not found' } },
      })

      await expect(service.listWorksheets(ITEM_ID)).rejects.toThrow('Microsoft Excel 365 API error: Item not found')
    })
  })

  describe('addWorksheet', () => {
    it('posts the new worksheet name', async () => {
      const response = { id: '{sheet-4}', name: 'Q3 Data', position: 3, visibility: 'Visible' }

      mock.onPost(workbookUrl('/worksheets/add')).reply(response)

      const result = await service.addWorksheet(ITEM_ID, 'Q3 Data')

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Q3 Data' })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.addWorksheet(null, 'Q3')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet name is missing', async () => {
      await expect(service.addWorksheet(ITEM_ID)).rejects.toThrow('Parameter "Worksheet Name" is required')
    })
  })

  describe('deleteWorksheet', () => {
    it('deletes the worksheet and returns a confirmation', async () => {
      mock.onDelete(workbookUrl('/worksheets/Sheet1')).reply({})

      const result = await service.deleteWorksheet(ITEM_ID, 'Sheet1')

      expect(result).toEqual({ message: 'Worksheet deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('encodes worksheet names with special characters', async () => {
      mock.onDelete(workbookUrl(`/worksheets/${encodeURIComponent('Q3 Data')}`)).reply({})

      await service.deleteWorksheet(ITEM_ID, 'Q3 Data')

      expect(mock.history[0].url).toContain('Q3%20Data')
    })

    it('throws when workbook is missing', async () => {
      await expect(service.deleteWorksheet(null, 'Sheet1')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.deleteWorksheet(ITEM_ID)).rejects.toThrow('Parameter "Worksheet" is required')
    })
  })

  // ── Ranges ──

  describe('getRangeValues', () => {
    const values = [
      ['Name', 'Email', 'Score'],
      ['John', 'john@example.com', 95],
      ['Jane', 'jane@example.com', 88],
    ]

    it('reads a range and returns raw values', async () => {
      mock.onGet(rangeUrl('Sheet1', 'A1:C3')).reply({
        address: 'Sheet1!A1:C3',
        rowCount: 3,
        columnCount: 3,
        values,
      })

      const result = await service.getRangeValues(ITEM_ID, 'Sheet1', 'A1:C3')

      expect(result).toEqual({ address: 'Sheet1!A1:C3', rowCount: 3, columnCount: 3, values })
      expect(mock.history[0].query).toMatchObject({ $select: 'address,rowCount,columnCount,values' })
    })

    it('converts rows to objects when firstRowAsHeaders is enabled', async () => {
      mock.onGet(rangeUrl('Sheet1', 'A1:C3')).reply({
        address: 'Sheet1!A1:C3',
        rowCount: 3,
        columnCount: 3,
        values,
      })

      const result = await service.getRangeValues(ITEM_ID, 'Sheet1', 'A1:C3', true)

      expect(result.objects).toEqual([
        { Name: 'John', Email: 'john@example.com', Score: 95 },
        { Name: 'Jane', Email: 'jane@example.com', Score: 88 },
      ])
    })

    it('generates fallback header names for blank headers and fills missing cells', async () => {
      mock.onGet(rangeUrl('Sheet1', 'A1:C2')).reply({
        address: 'Sheet1!A1:C2',
        rowCount: 2,
        columnCount: 3,
        values: [
          ['Name', '', null],
          ['John'],
        ],
      })

      const result = await service.getRangeValues(ITEM_ID, 'Sheet1', 'A1:C2', true)

      expect(result.objects).toEqual([{ Name: 'John', column2: null, column3: null }])
    })

    it('returns an empty objects array when the range has no values', async () => {
      mock.onGet(rangeUrl('Sheet1', 'A1')).reply({ address: 'Sheet1!A1', rowCount: 1, columnCount: 1 })

      const result = await service.getRangeValues(ITEM_ID, 'Sheet1', 'A1', true)

      expect(result.values).toEqual([])
      expect(result.objects).toEqual([])
    })

    it('throws when workbook is missing', async () => {
      await expect(service.getRangeValues(null, 'Sheet1', 'A1')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.getRangeValues(ITEM_ID, null, 'A1')).rejects.toThrow('Parameter "Worksheet" is required')
    })

    it('throws when address is missing', async () => {
      await expect(service.getRangeValues(ITEM_ID, 'Sheet1')).rejects.toThrow('Parameter "Range Address" is required')
    })
  })

  describe('updateRangeValues', () => {
    it('writes a two-dimensional array to the given range', async () => {
      const values = [
        ['Name', 'Score'],
        ['John', 95],
      ]

      mock.onPatch(rangeUrl('Sheet1', 'A1:B2')).reply({
        address: 'Sheet1!A1:B2',
        rowCount: 2,
        columnCount: 2,
        values,
      })

      const result = await service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1:B2', values)

      expect(result).toEqual({ address: 'Sheet1!A1:B2', rowCount: 2, columnCount: 2, values })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ values })
    })

    it('expands a single-cell address to fit the data', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'A1:C2')).reply({ address: 'Sheet1!A1:C2', rowCount: 2, columnCount: 3 })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', [
        ['Name', 'Email', 'Score'],
        ['John', 'john@example.com', 95],
      ])

      expect(mock.history[0].url).toBe(rangeUrl('Sheet1', 'A1:C2'))
    })

    it('expands a single-cell address across a column-letter boundary', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'Z1:AB1')).reply({ address: 'Sheet1!Z1:AB1', rowCount: 1, columnCount: 3 })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'Z1', [['a', 'b', 'c']])

      expect(mock.history[0].url).toBe(rangeUrl('Sheet1', 'Z1:AB1'))
    })

    it('expands an absolute sheet-prefixed single-cell address', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'Sheet1!B2:C3')).reply({ address: 'Sheet1!B2:C3' })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'Sheet1!$B$2', [
        ['a', 'b'],
        ['c', 'd'],
      ])

      expect(mock.history[0].url).toBe(rangeUrl('Sheet1', 'Sheet1!B2:C3'))
    })

    it('leaves an unparsable address untouched', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'MyNamedRange')).reply({ address: 'MyNamedRange' })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'MyNamedRange', [['a']])

      expect(mock.history[0].url).toBe(rangeUrl('Sheet1', 'MyNamedRange'))
    })

    it('derives a header row from an array of objects', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'A1:B3')).reply({ address: 'Sheet1!A1:B3' })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', [
        { Name: 'John', Score: 95 },
        { Name: 'Jane', Score: 88 },
      ])

      expect(mock.history[0].body).toEqual({
        values: [
          ['Name', 'Score'],
          ['John', 95],
          ['Jane', 88],
        ],
      })
    })

    it('omits the header row when includeHeaderRow is false', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'A1:B2')).reply({ address: 'Sheet1!A1:B2' })

      await service.updateRangeValues(
        ITEM_ID,
        'Sheet1',
        'A1',
        [
          { Name: 'John', Score: 95 },
          { Name: 'Jane', Score: 88 },
        ],
        false
      )

      expect(mock.history[0].body).toEqual({
        values: [
          ['John', 95],
          ['Jane', 88],
        ],
      })
    })

    it('unions keys across objects and fills missing values with null', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'A1:C3')).reply({ address: 'Sheet1!A1:C3' })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', [{ Name: 'John' }, { Score: 88, Extra: 'x' }])

      expect(mock.history[0].body).toEqual({
        values: [
          ['Name', 'Score', 'Extra'],
          ['John', null, null],
          [null, 88, 'x'],
        ],
      })
    })

    it('treats a flat array of scalars as a single row', async () => {
      mock.onPatch(rangeUrl('Sheet1', 'A1:C1')).reply({ address: 'Sheet1!A1:C1' })

      await service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', ['John', 'john@example.com', 95])

      expect(mock.history[0].body).toEqual({ values: [['John', 'john@example.com', 95]] })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.updateRangeValues(null, 'Sheet1', 'A1', [['a']])).rejects.toThrow(
        'Parameter "Workbook" is required'
      )
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.updateRangeValues(ITEM_ID, null, 'A1', [['a']])).rejects.toThrow(
        'Parameter "Worksheet" is required'
      )
    })

    it('throws when address is missing', async () => {
      await expect(service.updateRangeValues(ITEM_ID, 'Sheet1', null, [['a']])).rejects.toThrow(
        'Parameter "Range Address" is required'
      )
    })

    it('throws when values is not an array', async () => {
      await expect(service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', 'not-an-array')).rejects.toThrow(
        'Parameter "Values" must be an array'
      )
    })

    it('throws when values is empty', async () => {
      await expect(service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', [])).rejects.toThrow(
        'Parameter "Values" must contain at least one row of data'
      )
    })

    it('throws when the first row is empty', async () => {
      await expect(service.updateRangeValues(ITEM_ID, 'Sheet1', 'A1', [[]])).rejects.toThrow(
        'Parameter "Values" must contain at least one row of data'
      )
    })
  })

  describe('getUsedRange', () => {
    it('reads the used range', async () => {
      mock.onGet(workbookUrl('/worksheets/Sheet1/usedRange')).reply({
        address: 'Sheet1!A1:B2',
        rowCount: 2,
        columnCount: 2,
        values: [
          ['Name', 'Score'],
          ['John', 95],
        ],
      })

      const result = await service.getUsedRange(ITEM_ID, 'Sheet1')

      expect(result.address).toBe('Sheet1!A1:B2')
      expect(result.objects).toBeUndefined()
      expect(mock.history[0].query).toMatchObject({ $select: 'address,rowCount,columnCount,values' })
    })

    it('uses the valuesOnly variant and converts rows to objects', async () => {
      mock.onGet(workbookUrl('/worksheets/Sheet1/usedRange(valuesOnly=true)')).reply({
        address: 'Sheet1!A1:B2',
        rowCount: 2,
        columnCount: 2,
        values: [
          ['Name', 'Score'],
          ['John', 95],
        ],
      })

      const result = await service.getUsedRange(ITEM_ID, 'Sheet1', true, true)

      expect(result.objects).toEqual([{ Name: 'John', Score: 95 }])
    })

    it('throws when workbook is missing', async () => {
      await expect(service.getUsedRange(null, 'Sheet1')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.getUsedRange(ITEM_ID)).rejects.toThrow('Parameter "Worksheet" is required')
    })
  })

  describe('clearRange', () => {
    it('clears the range with the default applyTo', async () => {
      mock.onPost(`${rangeUrl('Sheet1', 'A1:C10')}/clear`).reply({})

      const result = await service.clearRange(ITEM_ID, 'Sheet1', 'A1:C10')

      expect(result).toEqual({ message: 'Range cleared successfully' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ applyTo: 'All' })
    })

    it('passes a custom applyTo value', async () => {
      mock.onPost(`${rangeUrl('Sheet1', 'A1:C10')}/clear`).reply({})

      await service.clearRange(ITEM_ID, 'Sheet1', 'A1:C10', 'Contents')

      expect(mock.history[0].body).toEqual({ applyTo: 'Contents' })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.clearRange(null, 'Sheet1', 'A1')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.clearRange(ITEM_ID, null, 'A1')).rejects.toThrow('Parameter "Worksheet" is required')
    })

    it('throws when address is missing', async () => {
      await expect(service.clearRange(ITEM_ID, 'Sheet1')).rejects.toThrow('Parameter "Range Address" is required')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('returns tables for the workbook', async () => {
      const response = { value: [{ id: '1', name: 'SalesTable', showHeaders: true }] }

      mock.onGet(workbookUrl('/tables')).reply(response)

      const result = await service.listTables(ITEM_ID)

      expect(result).toEqual(response)
    })

    it('throws when workbook is missing', async () => {
      await expect(service.listTables()).rejects.toThrow('Parameter "Workbook" is required')
    })
  })

  describe('createTable', () => {
    it('creates a table with headers by default', async () => {
      const response = { id: '2', name: 'Table2' }

      mock.onPost(workbookUrl('/worksheets/Sheet1/tables/add')).reply(response)

      const result = await service.createTable(ITEM_ID, 'Sheet1', 'A1:D8')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ address: 'A1:D8', hasHeaders: true })
    })

    it('passes hasHeaders false', async () => {
      mock.onPost(workbookUrl('/worksheets/Sheet1/tables/add')).reply({ id: '3' })

      await service.createTable(ITEM_ID, 'Sheet1', 'A1:D8', false)

      expect(mock.history[0].body).toEqual({ address: 'A1:D8', hasHeaders: false })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.createTable(null, 'Sheet1', 'A1:D8')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when worksheet is missing', async () => {
      await expect(service.createTable(ITEM_ID, null, 'A1:D8')).rejects.toThrow('Parameter "Worksheet" is required')
    })

    it('throws when address is missing', async () => {
      await expect(service.createTable(ITEM_ID, 'Sheet1')).rejects.toThrow('Parameter "Range Address" is required')
    })
  })

  describe('addTableRows', () => {
    it('appends a two-dimensional array of rows', async () => {
      const rows = [
        ['John', 95],
        ['Jane', 88],
      ]

      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 5, values: rows })

      const result = await service.addTableRows(ITEM_ID, 'SalesTable', rows)

      expect(result).toEqual({ index: 5, values: rows })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ values: rows })
    })

    it('includes the insert index when provided', async () => {
      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 2 })

      await service.addTableRows(ITEM_ID, 'SalesTable', [['John', 95]], 2)

      expect(mock.history[0].body).toEqual({ values: [['John', 95]], index: 2 })
    })

    it('includes index 0', async () => {
      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 0 })

      await service.addTableRows(ITEM_ID, 'SalesTable', [['John', 95]], 0)

      expect(mock.history[0].body).toEqual({ values: [['John', 95]], index: 0 })
    })

    it('maps objects to the table column order with case-insensitive keys', async () => {
      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply({
        value: [{ name: 'Name' }, { name: 'Email' }, { name: 'Score' }],
      })
      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 0 })

      await service.addTableRows(ITEM_ID, 'SalesTable', [
        { Name: 'John', Email: 'john@example.com', Score: 95 },
        { name: 'Jane', score: 88 },
      ])

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].body).toEqual({
        values: [
          ['John', 'john@example.com', 95],
          ['Jane', null, 88],
        ],
      })
    })

    it('handles an empty columns response when mapping objects', async () => {
      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply({})
      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 0 })

      await service.addTableRows(ITEM_ID, 'SalesTable', [{ Name: 'John' }])

      expect(mock.history[1].body).toEqual({ values: [[]] })
    })

    it('treats a flat array of scalars as a single row', async () => {
      mock.onPost(workbookUrl('/tables/SalesTable/rows/add')).reply({ index: 0 })

      await service.addTableRows(ITEM_ID, 'SalesTable', ['John', 95])

      expect(mock.history[0].body).toEqual({ values: [['John', 95]] })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.addTableRows(null, 'SalesTable', [['a']])).rejects.toThrow(
        'Parameter "Workbook" is required'
      )
    })

    it('throws when table is missing', async () => {
      await expect(service.addTableRows(ITEM_ID, null, [['a']])).rejects.toThrow('Parameter "Table" is required')
    })

    it('throws when rows is not an array', async () => {
      await expect(service.addTableRows(ITEM_ID, 'SalesTable', 'nope')).rejects.toThrow(
        'Parameter "Rows" must be a non-empty array'
      )
    })

    it('throws when rows is empty', async () => {
      await expect(service.addTableRows(ITEM_ID, 'SalesTable', [])).rejects.toThrow(
        'Parameter "Rows" must be a non-empty array'
      )
    })
  })

  describe('listTableRows', () => {
    it('returns column names, raw values, and row objects', async () => {
      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply({
        value: [{ name: 'Name' }, { name: 'Email' }, { name: 'Score' }],
      })
      mock.onGet(workbookUrl('/tables/SalesTable/rows')).reply({
        value: [
          { index: 0, values: [['John', 'john@example.com', 95]] },
          { index: 1, values: [['Jane', 'jane@example.com', 88]] },
        ],
      })

      const result = await service.listTableRows(ITEM_ID, 'SalesTable')

      expect(result).toEqual({
        columnNames: ['Name', 'Email', 'Score'],
        rowCount: 2,
        values: [
          ['John', 'john@example.com', 95],
          ['Jane', 'jane@example.com', 88],
        ],
        rows: [
          { index: 0, Name: 'John', Email: 'john@example.com', Score: 95 },
          { index: 1, Name: 'Jane', Email: 'jane@example.com', Score: 88 },
        ],
      })
    })

    it('falls back to the array position when a row index is missing and fills missing cells', async () => {
      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply({
        value: [{ name: 'Name' }, { name: 'Score' }],
      })
      mock.onGet(workbookUrl('/tables/SalesTable/rows')).reply({
        value: [{ values: [['John']] }, {}],
      })

      const result = await service.listTableRows(ITEM_ID, 'SalesTable')

      expect(result.values).toEqual([['John'], []])
      expect(result.rows).toEqual([
        { index: 0, Name: 'John', Score: null },
        { index: 1, Name: null, Score: null },
      ])
    })

    it('handles an empty rows response', async () => {
      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply({ value: [{ name: 'Name' }] })
      mock.onGet(workbookUrl('/tables/SalesTable/rows')).reply({})

      const result = await service.listTableRows(ITEM_ID, 'SalesTable')

      expect(result).toEqual({ columnNames: ['Name'], rowCount: 0, values: [], rows: [] })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.listTableRows(null, 'SalesTable')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when table is missing', async () => {
      await expect(service.listTableRows(ITEM_ID)).rejects.toThrow('Parameter "Table" is required')
    })
  })

  describe('listTableColumns', () => {
    it('returns table columns', async () => {
      const response = { value: [{ id: '1', name: 'Name', index: 0, values: [['Name'], ['John']] }] }

      mock.onGet(workbookUrl('/tables/SalesTable/columns')).reply(response)

      const result = await service.listTableColumns(ITEM_ID, 'SalesTable')

      expect(result).toEqual(response)
    })

    it('throws when workbook is missing', async () => {
      await expect(service.listTableColumns(null, 'SalesTable')).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when table is missing', async () => {
      await expect(service.listTableColumns(ITEM_ID)).rejects.toThrow('Parameter "Table" is required')
    })
  })

  describe('deleteTableRow', () => {
    it('deletes the row and returns a confirmation', async () => {
      mock.onDelete(workbookUrl('/tables/SalesTable/rows/3')).reply({})

      const result = await service.deleteTableRow(ITEM_ID, 'SalesTable', 3)

      expect(result).toEqual({ message: 'Table row deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('accepts index 0', async () => {
      mock.onDelete(workbookUrl('/tables/SalesTable/rows/0')).reply({})

      await expect(service.deleteTableRow(ITEM_ID, 'SalesTable', 0)).resolves.toEqual({
        message: 'Table row deleted successfully',
      })
    })

    it('throws when workbook is missing', async () => {
      await expect(service.deleteTableRow(null, 'SalesTable', 0)).rejects.toThrow('Parameter "Workbook" is required')
    })

    it('throws when table is missing', async () => {
      await expect(service.deleteTableRow(ITEM_ID, null, 0)).rejects.toThrow('Parameter "Table" is required')
    })

    it('throws when index is missing', async () => {
      await expect(service.deleteTableRow(ITEM_ID, 'SalesTable')).rejects.toThrow('Parameter "Row Index" is required')
    })

    it('throws when index is null', async () => {
      await expect(service.deleteTableRow(ITEM_ID, 'SalesTable', null)).rejects.toThrow(
        'Parameter "Row Index" is required'
      )
    })
  })
})
