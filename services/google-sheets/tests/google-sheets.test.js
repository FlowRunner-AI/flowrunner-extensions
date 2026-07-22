'use strict'

// ────────────────────────────────────────────────────────────────────────────
// Mocks for the Google SDKs used by the service.
//
// `google-spreadsheet` is mocked with an in-memory document/sheet registry so
// that every branch of the service can be driven deterministically.
// `papaparse` is intentionally NOT mocked — the real parser is deterministic and
// exercises the CSV import path for real.
// ────────────────────────────────────────────────────────────────────────────

const mockDocs = new Map()
const mockConstructorCalls = []

function mockMakeRow(rowNumber, data) {
  const row = {
    rowNumber,
    _data: { ...data },
    toObject: () => ({ ...row._data }),
    get: key => row._data[key],
    assign: jest.fn(values => Object.assign(row._data, values)),
    save: jest.fn(async () => {}),
  }

  return row
}

function mockMakeSheet(props = {}) {
  const cells = {}

  const sheet = {
    sheetId: props.sheetId ?? 111,
    title: props.title ?? 'Sheet1',
    headerValues: props.headerValues ?? ['Name', 'Email'],
    rows: props.rows ?? [],
    cells,

    getRows: jest.fn(async opts => {
      const { offset, limit } = opts || {}

      let out = sheet.rows.slice()

      if (typeof offset === 'number') {
        out = out.slice(offset)
      }

      if (typeof limit === 'number') {
        out = out.slice(0, limit)
      }

      return out
    }),

    addRow: jest.fn(async () => {}),
    addRows: jest.fn(async () => {}),
    loadHeaderRow: jest.fn(async () => {}),
    setHeaderRow: jest.fn(async () => {}),
    updateProperties: jest.fn(async () => {}),
    clearRows: jest.fn(async () => {}),
    loadCells: jest.fn(async () => {}),
    saveUpdatedCells: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),

    getCell: jest.fn((rowIndex, columnIndex) => {
      const key = `${ rowIndex },${ columnIndex }`

      cells[key] = cells[key] || { value: null }

      return cells[key]
    }),

    getCellByA1: jest.fn(a1 => {
      cells[a1] = cells[a1] || { value: null }

      return cells[a1]
    }),

    downloadAsCSV: jest.fn(async () => Buffer.from('csv-bytes')),
    downloadAsTSV: jest.fn(async () => Buffer.from('tsv-bytes')),
    downloadAsPDF: jest.fn(async () => Buffer.from('pdf-bytes')),

    copyToSpreadsheet: jest.fn(async () => ({ data: { sheetId: 999 } })),
  }

  return sheet
}

function mockMakeDoc(documentId, props = {}) {
  const doc = {
    spreadsheetId: documentId,
    title: props.title ?? 'Doc Title',
    sheetsById: {},
    sheetsByIndex: [],

    loadInfo: jest.fn(async () => {}),
    updateProperties: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    deleteSheet: jest.fn(async () => {}),

    addSheet: jest.fn(async ({ title, sheetId }) => {
      const sheet = mockMakeSheet({ title, sheetId: sheetId ?? 4242 })

      doc.sheetsById[sheet.sheetId] = sheet
      doc.sheetsByIndex.push(sheet)

      return sheet
    }),

    downloadAsXLSX: jest.fn(async () => Buffer.from('xlsx-bytes')),
    downloadAsODS: jest.fn(async () => Buffer.from('ods-bytes')),
    downloadAsHTML: jest.fn(async () => Buffer.from('html-bytes')),
  }

  if (props.sheets) {
    for (const sheet of props.sheets) {
      doc.sheetsById[sheet.sheetId] = sheet
      doc.sheetsByIndex.push(sheet)
    }
  }

  return doc
}

function mockRegisterDoc(documentId, props) {
  const doc = mockMakeDoc(documentId, props)

  mockDocs.set(documentId, doc)

  return doc
}

const mockCreateNewSpreadsheetDocument = jest.fn(async () => ({ spreadsheetId: 'new-doc-id' }))

const mockGoogleSpreadsheet = jest.fn(function(documentId, auth) {
  mockConstructorCalls.push({ documentId, auth })

  if (!mockDocs.has(documentId)) {
    mockDocs.set(documentId, mockMakeDoc(documentId))
  }

  return mockDocs.get(documentId)
})

mockGoogleSpreadsheet.createNewSpreadsheetDocument = mockCreateNewSpreadsheetDocument

jest.mock('google-spreadsheet', () => ({ GoogleSpreadsheet: mockGoogleSpreadsheet }))

const mockDriveFilesWatch = jest.fn()
const mockDriveChannelsStop = jest.fn()
const mockDriveDrivesList = jest.fn()
const mockDriveFactory = jest.fn(() => ({
  files: { watch: mockDriveFilesWatch },
  channels: { stop: mockDriveChannelsStop },
  drives: { list: mockDriveDrivesList },
}))

jest.mock('@googleapis/drive', () => ({ drive: mockDriveFactory }))

const mockSetCredentials = jest.fn()

jest.mock('@googleapis/oauth2', () => ({
  auth: {
    OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: mockSetCredentials })),
  },
}))

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const TOKEN = 'test-oauth-access-token'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

const DOC_ID = 'doc-1'
const SHEET_ID = 111

describe('Google Sheets Service', () => {
  let sandbox
  let service
  let mock
  let uploads

  let doc
  let sheet

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': TOKEN } }
  })

  beforeEach(() => {
    mockDocs.clear()
    mockConstructorCalls.length = 0

    service.documentsCache = {}
    service.sheetsCache = {}
    service.request = { headers: { 'oauth-access-token': TOKEN } }

    uploads = []

    service.flowrunner = {
      Files: {
        uploadFile: jest.fn(async (buffer, options) => {
          uploads.push({ buffer, options })

          return { url: `https://files.example.com/${ options.filename }` }
        }),
      },
    }

    sheet = mockMakeSheet({ sheetId: SHEET_ID, title: 'Sheet1' })
    doc = mockRegisterDoc(DOC_ID, { title: 'Doc Title', sheets: [sheet] })

    mockDriveFilesWatch.mockResolvedValue({
      data: { expiration: '1750000000000', resourceId: 'resource-1' },
    })

    mockDriveChannelsStop.mockResolvedValue({})
    mockDriveDrivesList.mockResolvedValue({ data: { drives: [], nextPageToken: undefined } })
  })

  afterEach(() => {
    mock.reset()
    jest.clearAllMocks()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers clientId and clientSecret as shared, required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(2)

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'clientId',
            displayName: 'Client Id',
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
      )
    })

    it('exposes the config values on the instance', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
    })

    it('every config key read from config is registered in addService', () => {
      const registered = sandbox.getConfigItems().map(item => item.name)

      // The constructor only reads clientId / clientSecret.
      expect(registered).toEqual(expect.arrayContaining(['clientId', 'clientSecret']))
    })
  })

  // ── OAuth SYSTEM methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('builds the Google consent URL with offline access and all default scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)

      const params = new URLSearchParams(url.split('?')[1])

      expect(params.get('client_id')).toBe(CLIENT_ID)
      expect(params.get('response_type')).toBe('code')
      expect(params.get('access_type')).toBe('offline')
      expect(params.get('prompt')).toBe('consent')

      expect(params.get('scope').split(' ')).toEqual(
        expect.arrayContaining([
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/userinfo.email',
        ])
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('refreshToken', () => {
    it('exchanges the refresh token and maps the response', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'fresh-token', expires_in: 3599 })

      const result = await service.refreshToken('refresh-abc')

      expect(result).toEqual({ token: 'fresh-token', expirationInSeconds: 3599 })
      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(mock.history[0].query).toEqual({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: 'refresh-abc',
        grant_type: 'refresh_token',
        scope: expect.stringContaining('https://www.googleapis.com/auth/spreadsheets'),
      })
    })

    it('returns undefined fields when the response has no rotated token payload', async () => {
      mock.onPost(TOKEN_URL).reply({})

      await expect(service.refreshToken('refresh-abc')).resolves.toEqual({
        token: undefined,
        expirationInSeconds: undefined,
      })
    })

    it('translates invalid_grant into a re-authentication message', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('stale')).rejects.toThrow(
        'Refresh token expired or invalid, please re-authenticate.'
      )
    })

    it('rethrows other OAuth errors untouched', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('whatever')).rejects.toThrow('Server Error')
    })

    // KNOWN SERVICE BUG: the catch block dereferences `error.body.error` without a
    // guard, so a transport error with no `body` is masked by a TypeError instead of
    // surfacing the original failure.
    it('masks body-less transport errors with a TypeError', async () => {
      mock.onPost(TOKEN_URL).replyWithError(new Error('socket hang up'))

      await expect(service.refreshToken('whatever')).rejects.toThrow(TypeError)
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code and resolves the connection identity from the profile', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      })

      mock.onGet(USERINFO_URL).reply({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        picture: 'https://img.example.com/ada.png',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://app.example.com/cb',
      })

      expect(result).toEqual({
        token: 'access-1',
        refreshToken: 'refresh-1',
        expirationInSeconds: 3600,
        overwrite: true,
        connectionIdentityName: 'Ada Lovelace (ada@example.com)',
        connectionIdentityImageURL: 'https://img.example.com/ada.png',
      })

      expect(mock.history).toHaveLength(2)

      const body = new URLSearchParams(mock.history[0].body)

      expect(body.get('client_id')).toBe(CLIENT_ID)
      expect(body.get('client_secret')).toBe(CLIENT_SECRET)
      expect(body.get('code')).toBe('auth-code')
      expect(body.get('redirect_uri')).toBe('https://app.example.com/cb')
      expect(body.get('grant_type')).toBe('authorization_code')

      expect(mock.history[1].headers).toEqual({ Authorization: 'Bearer access-1' })
    })

    it('falls back to a default identity name when the profile lookup fails', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'access-2', expires_in: 10 })

      mock.onGet(USERINFO_URL).replyWithError({
        message: 'Forbidden',
        body: { error: 'insufficient_scope' },
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'r' })

      expect(result).toMatchObject({
        token: 'access-2',
        refreshToken: undefined,
        connectionIdentityName: 'Google Sheets User',
        connectionIdentityImageURL: undefined,
      })
    })

    it('propagates a failed token exchange', async () => {
      mock.onPost(TOKEN_URL).replyWithError({ message: 'invalid_client' })

      await expect(service.executeCallback({ code: 'c', redirectURI: 'r' })).rejects.toThrow(
        'invalid_client'
      )

      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Access token plumbing ──

  describe('access token', () => {
    it('sends the live oauth-access-token header from this.request', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [], nextPageToken: undefined })

      await service.getSpreadsheetsDictionary({ criteria: {} })

      expect(mock.history[0].headers).toEqual({ Authorization: `Bearer ${ TOKEN }` })
    })

    it('sends "Bearer undefined" when no oauth-access-token header is present', async () => {
      service.request = { headers: {} }
      mock.onGet(DRIVE_FILES_URL).reply({ files: [], nextPageToken: undefined })

      await service.getSpreadsheetsDictionary({ criteria: {} })

      expect(mock.history[0].headers).toEqual({ Authorization: 'Bearer undefined' })
    })

    it('throws when this.request is not available at all', async () => {
      delete service.request

      await expect(service.getSpreadsheetsDictionary({ criteria: {} })).rejects.toThrow(TypeError)
    })

    it('passes the access token into the GoogleSpreadsheet constructor', async () => {
      await service.getSheetList(DOC_ID)

      expect(mockConstructorCalls[0]).toEqual({
        documentId: DOC_ID,
        auth: { token: TOKEN },
      })
    })

    it('seeds the Drive OAuth2 client with the access token and scope', async () => {
      await service.getDrivesDictionary({})

      expect(mockSetCredentials).toHaveBeenCalledWith({
        access_token: TOKEN,
        scope: expect.stringContaining('https://www.googleapis.com/auth/drive'),
        token_type: 'Bearer',
      })

      expect(mockDriveFactory).toHaveBeenCalledWith({ version: 'v3', auth: expect.any(Object) })
    })
  })

  // ── Document caching ──

  describe('document / sheet caching', () => {
    it('reuses a cached GoogleSpreadsheet instance across calls', async () => {
      await service.getSheetList(DOC_ID)
      await service.getSheetList(DOC_ID)

      expect(mockGoogleSpreadsheet).toHaveBeenCalledTimes(1)
    })

    it('caches the resolved sheet so loadInfo runs only once', async () => {
      await service.getRows(DOC_ID, SHEET_ID)
      await service.getRows(DOC_ID, SHEET_ID)

      expect(doc.loadInfo).toHaveBeenCalledTimes(1)
    })

    it('throws when the sheet id does not exist in the document', async () => {
      await expect(service.getRows(DOC_ID, 777)).rejects.toThrow(
        'Sheet with ID 777 does not exist.'
      )
    })

    it('evicts the document from cache after deleteDocument', async () => {
      await service.deleteDocument(DOC_ID)

      expect(doc.delete).toHaveBeenCalled()
      expect(service.documentsCache[DOC_ID]).toBeUndefined()
    })

    it('evicts the sheet from cache after deleteSheet', async () => {
      await service.getRows(DOC_ID, SHEET_ID)
      expect(service.sheetsCache[`${ DOC_ID }-${ SHEET_ID }`]).toBeDefined()

      await service.deleteSheet(DOC_ID, SHEET_ID)

      expect(doc.deleteSheet).toHaveBeenCalledWith(SHEET_ID)
      expect(service.sheetsCache[`${ DOC_ID }-${ SHEET_ID }`]).toBeUndefined()
    })
  })

  // ── Webhook helpers ──

  describe('createWebhook / deleteWebhook', () => {
    it('creates a Drive change channel and returns its descriptor', async () => {
      const result = await service.createWebhook('https://cb.example.com/hook', 'file-1')

      expect(mockDriveFilesWatch).toHaveBeenCalledWith({
        fileId: 'file-1',
        supportsAllDrives: true,
        requestBody: {
          payload: true,
          id: expect.any(String),
          type: 'web_hook',
          address: 'https://cb.example.com/hook',
        },
      })

      expect(result).toEqual({
        channelId: expect.any(String),
        resourceId: 'resource-1',
        fileId: 'file-1',
        expiration: '1750000000000',
        callbackUrl: 'https://cb.example.com/hook',
      })
    })

    it('rethrows watch failures that carry structured errors', async () => {
      mockDriveFilesWatch.mockRejectedValue(
        Object.assign(new Error('watch failed'), { errors: [{ reason: 'forbidden' }] })
      )

      await expect(service.createWebhook('cb', 'file-1')).rejects.toThrow('watch failed')
    })

    it('rethrows watch failures without structured errors', async () => {
      mockDriveFilesWatch.mockRejectedValue(new Error('plain failure'))

      await expect(service.createWebhook('cb', 'file-1')).rejects.toThrow('plain failure')
    })

    it('stops the channel on delete', async () => {
      await service.deleteWebhook('chan-1', 'res-1')

      expect(mockDriveChannelsStop).toHaveBeenCalledWith({
        requestBody: { id: 'chan-1', resourceId: 'res-1' },
      })
    })

    it('swallows stop failures that carry a Google response envelope', async () => {
      mockDriveChannelsStop.mockRejectedValue({ response: { data: { error: 'gone' } } })

      await expect(service.deleteWebhook('chan-1', 'res-1')).resolves.toBeUndefined()
    })

    // KNOWN SERVICE BUG: the catch handler dereferences `error.response.data.error`
    // unguarded, so a plain network Error escapes the "swallow" logic as a TypeError.
    it('throws a TypeError when the stop failure has no response envelope', async () => {
      mockDriveChannelsStop.mockRejectedValue(new Error('network down'))

      await expect(service.deleteWebhook('chan-1', 'res-1')).rejects.toThrow(TypeError)
    })
  })

  // ── Trigger SYSTEM methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for new documents and keeps existing ones', async () => {
      const invocation = {
        connectionId: 'conn-1',
        callbackUrl: 'https://cb.example.com/hook?x=1',
        webhookData: {
          'file-existing': { channelId: 'c-old', resourceId: 'r-old' },
        },
        events: [
          { triggerData: { documentId: 'file-existing' } },
          { triggerData: { documentId: 'file-new' } },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(mockDriveFilesWatch).toHaveBeenCalledTimes(1)

      expect(mockDriveFilesWatch.mock.calls[0][0].requestBody.address).toBe(
        'https://cb.example.com/hook?x=1&connectionId=conn-1'
      )

      expect(mockDriveChannelsStop).not.toHaveBeenCalled()

      expect(result).toEqual({
        connectionId: 'conn-1',
        refreshIntervalInSeconds: 60,
        webhookData: {
          'file-existing': { channelId: 'c-old', resourceId: 'r-old' },
          'file-new': expect.objectContaining({ fileId: 'file-new', resourceId: 'resource-1' }),
        },
      })
    })

    it('deletes webhooks for documents that are no longer referenced', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        connectionId: 'conn-2',
        callbackUrl: 'https://cb.example.com/hook',
        webhookData: { 'file-stale': { channelId: 'c1', resourceId: 'r1' } },
        events: [],
      })

      expect(mockDriveChannelsStop).toHaveBeenCalledWith({
        requestBody: { id: 'c1', resourceId: 'r1' },
      })

      expect(mockDriveFilesWatch).not.toHaveBeenCalled()
      // NOTE: the stale entry is not removed from webhookData, only its channel is stopped.
      expect(Object.keys(result.webhookData)).toEqual(['file-stale'])
    })

    it('defaults webhookData to an empty object when absent', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        connectionId: 'conn-3',
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ triggerData: { documentId: 'file-a' } }],
      })

      expect(Object.keys(result.webhookData)).toEqual(['file-a'])
    })
  })

  describe('handleTriggerRefreshWebhook', () => {
    // KNOWN SERVICE BUG: the guard is `Number(expiration) - 1000 > Date.now()`, which
    // recreates channels that are still far from expiring and never refreshes ones that
    // are about to expire — the comparison is inverted.
    it('recreates channels whose expiration is still in the future', async () => {
      const future = Date.now() + 60 * 60 * 1000

      const result = await service.handleTriggerRefreshWebhook({
        webhookData: {
          'file-a': {
            channelId: 'c1',
            resourceId: 'r1',
            expiration: String(future),
            callbackUrl: 'https://cb.example.com/hook',
          },
        },
      })

      expect(mockDriveChannelsStop).toHaveBeenCalledTimes(1)
      expect(mockDriveFilesWatch).toHaveBeenCalledTimes(1)
      expect(result.refreshIntervalInSeconds).toBe(60)
      expect(result.webhookData['file-a']).toMatchObject({ fileId: 'file-a' })
    })

    it('leaves already-expired channels untouched', async () => {
      const past = Date.now() - 60 * 1000

      const result = await service.handleTriggerRefreshWebhook({
        webhookData: {
          'file-a': { channelId: 'c1', resourceId: 'r1', expiration: String(past) },
        },
      })

      expect(mockDriveChannelsStop).not.toHaveBeenCalled()
      expect(mockDriveFilesWatch).not.toHaveBeenCalled()
      expect(result.webhookData['file-a'].channelId).toBe('c1')
    })

    it('handles a missing webhookData map', async () => {
      await expect(service.handleTriggerRefreshWebhook({})).resolves.toEqual({
        refreshIntervalInSeconds: 60,
        webhookData: {},
      })
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('skips Google sync pings', async () => {
      const result = await service.handleTriggerResolveEvents({
        queryParams: { connectionId: 'conn-1' },
        headers: { 'x-goog-resource-state': 'sync' },
      })

      expect(result).toEqual({ connectionId: 'conn-1', events: [] })
    })

    it('shapes a change notification into an onDocumentChanged event', async () => {
      const result = await service.handleTriggerResolveEvents({
        queryParams: { connectionId: 'conn-1' },
        headers: {
          'x-goog-resource-state': 'update',
          'x-goog-resource-uri': `https://www.googleapis.com/drive/v3/files/${ DOC_ID }?alt=json`,
          'x-goog-channel-expiration': 'Fri, 18 Apr 2025 20:32:11 GMT',
          'x-goog-resource-id': 'res-9',
          'x-goog-channel-id': 'chan-9',
        },
      })

      expect(result).toEqual({
        connectionId: 'conn-1',
        events: [
          {
            name: 'onDocumentChanged',
            data: {
              resourceUri: `https://www.googleapis.com/drive/v3/files/${ DOC_ID }?alt=json`,
              expiration: 'Fri, 18 Apr 2025 20:32:11 GMT',
              resourceId: 'res-9',
              channelId: 'chan-9',
              documentId: DOC_ID,
            },
          },
        ],
      })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns only the ids of triggers bound to the changed document', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventData: { documentId: DOC_ID },
        triggers: [
          { id: 't1', data: { documentId: DOC_ID } },
          { id: 't2', data: { documentId: 'other' } },
          { id: 't3', data: { documentId: DOC_ID } },
        ],
      })

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('returns an empty id list when nothing matches', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventData: { documentId: 'nope' },
        triggers: [{ id: 't1', data: { documentId: DOC_ID } }],
      })

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('stops every registered channel', async () => {
      await service.handleTriggerDeleteWebhook({
        webhookData: {
          'file-a': { channelId: 'c1', resourceId: 'r1' },
          'file-b': { channelId: 'c2', resourceId: 'r2' },
        },
      })

      expect(mockDriveChannelsStop).toHaveBeenCalledTimes(2)
    })

    it('is a no-op for an empty webhook map', async () => {
      await expect(service.handleTriggerDeleteWebhook({ webhookData: {} })).resolves.toBeUndefined()
      expect(mockDriveChannelsStop).not.toHaveBeenCalled()
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the method named by eventName', async () => {
      const spy = jest.spyOn(service, 'onNewSheet').mockResolvedValue({ events: [], state: null })

      const invocation = { eventName: 'onNewSheet', triggerData: { documentId: DOC_ID } }

      await expect(service.handleTriggerPollingForEvent(invocation)).resolves.toEqual({
        events: [],
        state: null,
      })

      expect(spy).toHaveBeenCalledWith(invocation)

      spy.mockRestore()
    })
  })

  describe('onDocumentChanged', () => {
    it('returns undefined for an unknown call type', async () => {
      await expect(service.onDocumentChanged('SOMETHING_ELSE', {})).resolves.toBeUndefined()
    })
  })

  // ── Polling triggers ──

  describe('onNewRow', () => {
    const invocation = (state, learningMode) => ({
      triggerData: { documentId: DOC_ID, sheetId: SHEET_ID },
      state,
      learningMode,
    })

    it('returns the first row in learning mode', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' }), mockMakeRow(3, { Name: 'Bob' })]

      await expect(service.onNewRow(invocation(null, true))).resolves.toEqual({
        events: [{ rowNumber: 2, data: { Name: 'Ada' } }],
        state: null,
      })
    })

    it('returns no events in learning mode when the sheet is empty', async () => {
      await expect(service.onNewRow(invocation(null, true))).resolves.toEqual({
        events: [],
        state: null,
      })
    })

    it('initialises state on the first poll without emitting', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' })]

      await expect(service.onNewRow(invocation(undefined, false))).resolves.toEqual({
        events: [],
        state: { rowsCount: 1 },
      })
    })

    it('emits only the newly appended rows', async () => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada' }),
        mockMakeRow(3, { Name: 'Bob' }),
        mockMakeRow(4, { Name: 'Cy' }),
      ]

      await expect(service.onNewRow(invocation({ rowsCount: 1 }, false))).resolves.toEqual({
        events: [
          { rowNumber: 3, data: { Name: 'Bob' } },
          { rowNumber: 4, data: { Name: 'Cy' } },
        ],
        state: { rowsCount: 3 },
      })
    })

    it('emits nothing when rows were removed', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' })]

      await expect(service.onNewRow(invocation({ rowsCount: 5 }, false))).resolves.toEqual({
        events: [],
        state: { rowsCount: 1 },
      })
    })
  })

  describe('onNewOrUpdatedRow', () => {
    const invocation = (state, learningMode) => ({
      triggerData: { documentId: DOC_ID, sheetId: SHEET_ID, column: 'Name' },
      state,
      learningMode,
    })

    it('returns the first row in learning mode', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' })]

      await expect(service.onNewOrUpdatedRow(invocation(null, true))).resolves.toEqual({
        events: [{ rowNumber: 2, data: { Name: 'Ada' } }],
        state: null,
      })
    })

    it('returns no events in learning mode when the sheet is empty', async () => {
      await expect(service.onNewOrUpdatedRow(invocation(null, true))).resolves.toEqual({
        events: [],
        state: null,
      })
    })

    it('initialises the column snapshot on the first poll', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' }), mockMakeRow(3, { Name: 'Bob' })]

      await expect(service.onNewOrUpdatedRow(invocation(undefined, false))).resolves.toEqual({
        events: [],
        state: { columnValues: ['Ada', 'Bob'] },
      })
    })

    it('emits rows whose trigger column changed', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' }), mockMakeRow(3, { Name: 'Bobby' })]

      await expect(
        service.onNewOrUpdatedRow(invocation({ columnValues: ['Ada', 'Bob'] }, false))
      ).resolves.toEqual({
        events: [{ rowNumber: 3, data: { Name: 'Bobby' } }],
        state: { columnValues: ['Ada', 'Bobby'] },
      })
    })

    it('treats a previously null slot with an undefined value as unchanged', async () => {
      sheet.rows = [mockMakeRow(2, { Other: 'x' })]

      await expect(
        service.onNewOrUpdatedRow(invocation({ columnValues: [null] }, false))
      ).resolves.toEqual({
        events: [],
        state: { columnValues: [undefined] },
      })
    })
  })

  describe('onNewDocument', () => {
    const FILE_A = { id: 'f1', name: 'A', createdTime: '2025-01-01' }
    const FILE_B = { id: 'f2', name: 'B', createdTime: '2025-01-02' }

    it('returns the newest document in learning mode', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [FILE_A, FILE_B] })

      await expect(
        service.onNewDocument({ triggerData: {}, learningMode: true })
      ).resolves.toEqual({ events: [FILE_A], state: null })
    })

    it('returns no events in learning mode when the drive has no spreadsheets', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [] })

      await expect(
        service.onNewDocument({ triggerData: {}, learningMode: true })
      ).resolves.toEqual({ events: [], state: null })
    })

    it('initialises state on the first poll', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [FILE_A] })

      await expect(service.onNewDocument({ triggerData: {} })).resolves.toEqual({
        events: [],
        state: { files: [FILE_A] },
      })
    })

    it('emits documents that were not present in the previous snapshot', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [FILE_B, FILE_A] })

      await expect(
        service.onNewDocument({ triggerData: {}, state: { files: [FILE_A] } })
      ).resolves.toEqual({ events: [FILE_B], state: { files: [FILE_B, FILE_A] } })
    })

    it('scopes the listing to a shared drive when one is selected', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [] })

      await service.onNewDocument({ triggerData: { sharedDriveId: 'shared-1' } })

      expect(mock.history[0].query).toMatchObject({
        driveId: 'shared-1',
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })
    })
  })

  describe('onNewSheet', () => {
    it('returns the first sheet in learning mode', async () => {
      await expect(
        service.onNewSheet({ triggerData: { documentId: DOC_ID }, learningMode: true })
      ).resolves.toEqual({
        events: [{ sheetId: SHEET_ID, title: 'Sheet1' }],
        state: null,
      })
    })

    it('returns no events in learning mode for a document with no sheets', async () => {
      mockRegisterDoc('empty-doc')

      await expect(
        service.onNewSheet({ triggerData: { documentId: 'empty-doc' }, learningMode: true })
      ).resolves.toEqual({ events: [], state: null })
    })

    it('initialises state on the first poll', async () => {
      await expect(service.onNewSheet({ triggerData: { documentId: DOC_ID } })).resolves.toEqual({
        events: [],
        state: { sheets: [{ sheetId: SHEET_ID, title: 'Sheet1' }] },
      })
    })

    it('emits sheets that were not present in the previous snapshot', async () => {
      doc.sheetsByIndex.push(mockMakeSheet({ sheetId: 222, title: 'Second' }))

      await expect(
        service.onNewSheet({
          triggerData: { documentId: DOC_ID },
          state: { sheets: [{ sheetId: SHEET_ID, title: 'Sheet1' }] },
        })
      ).resolves.toEqual({
        events: [{ sheetId: 222, title: 'Second' }],
        state: {
          sheets: [
            { sheetId: SHEET_ID, title: 'Sheet1' },
            { sheetId: 222, title: 'Second' },
          ],
        },
      })
    })
  })

  // ── Dictionaries ──

  describe('getSpreadsheetsDictionary', () => {
    const FILES = [
      { id: 'f1', name: 'Marketing Budget' },
      { id: 'f2', name: 'Sales Report' },
      { id: 'f3', name: '' },
    ]

    it('maps files to dictionary items and passes the cursor through', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: FILES, nextPageToken: 'next-1' })

      const result = await service.getSpreadsheetsDictionary({ criteria: {} })

      expect(result).toEqual({
        cursor: 'next-1',
        items: [
          { label: 'Marketing Budget', note: 'ID: f1', value: 'f1' },
          { label: 'Sales Report', note: 'ID: f2', value: 'f2' },
          { label: '[empty]', note: 'ID: f3', value: 'f3' },
        ],
      })

      expect(mock.history[0].query).toEqual({
        q: 'mimeType=\'application/vnd.google-apps.spreadsheet\'',
        fields: 'nextPageToken, files(id, name, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: 100,
      })
    })

    it('filters case-insensitively on the current page only', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: FILES })

      const result = await service.getSpreadsheetsDictionary({ search: 'sALes', criteria: {} })

      expect(result.items).toEqual([{ label: 'Sales Report', note: 'ID: f2', value: 'f2' }])
    })

    it('forwards the cursor as the Drive pageToken', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [] })

      await service.getSpreadsheetsDictionary({ cursor: 'page-2', criteria: {} })

      expect(mock.history[0].query.pageToken).toBe('page-2')
    })

    it('treats the MY_GOOGLE_DRIVE sentinel as "no shared drive"', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [] })

      await service.getSpreadsheetsDictionary({ criteria: { sharedDriveId: 'MY_GOOGLE_DRIVE' } })

      expect(mock.history[0].query.driveId).toBeUndefined()
      expect(mock.history[0].query.corpora).toBeUndefined()
    })

    it('scopes the query to a real shared drive id', async () => {
      mock.onGet(DRIVE_FILES_URL).reply({ files: [] })

      await service.getSpreadsheetsDictionary({ criteria: { sharedDriveId: 'shared-9' } })

      expect(mock.history[0].query).toMatchObject({
        driveId: 'shared-9',
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })
    })
  })

  describe('getDrivesDictionary', () => {
    it('prepends "My Google Drive" to the shared drives list', async () => {
      mockDriveDrivesList.mockResolvedValue({
        data: { drives: [{ id: 'sd1', name: 'Team Drive' }], nextPageToken: 'nx' },
      })

      const result = await service.getDrivesDictionary({})

      expect(result).toEqual({
        cursor: 'nx',
        items: [
          { label: 'My Google Drive', value: 'MY_GOOGLE_DRIVE', note: 'ID: MY_GOOGLE_DRIVE' },
          { label: 'Team Drive', value: 'sd1', note: 'ID: sd1' },
        ],
      })

      expect(mockDriveDrivesList).toHaveBeenCalledWith({
        pageToken: undefined,
        q: undefined,
        useDomainAdminAccess: true,
      })
    })

    it('builds a server-side name filter from search and forwards the cursor', async () => {
      mockDriveDrivesList.mockResolvedValue({ data: { drives: [] } })

      await service.getDrivesDictionary({ search: 'Team', cursor: 'c-1' })

      expect(mockDriveDrivesList).toHaveBeenCalledWith({
        pageToken: 'c-1',
        q: 'name contains \'Team\'',
        useDomainAdminAccess: true,
      })
    })

    it('retries without domain admin access when the admin call fails', async () => {
      mockDriveDrivesList
        .mockRejectedValueOnce(new Error('not an admin'))
        .mockResolvedValueOnce({ data: { drives: [{ id: 'sd2', name: 'Ops' }] } })

      const result = await service.getDrivesDictionary({})

      expect(mockDriveDrivesList).toHaveBeenCalledTimes(2)
      expect(mockDriveDrivesList.mock.calls[1][0]).toEqual({ pageToken: undefined, q: undefined })
      expect(result.items.map(i => i.value)).toEqual(['MY_GOOGLE_DRIVE', 'sd2'])
    })

    it('propagates the failure when both attempts fail', async () => {
      mockDriveDrivesList.mockRejectedValue(new Error('drive down'))

      await expect(service.getDrivesDictionary({})).rejects.toThrow('drive down')
    })
  })

  describe('getSheetsDictionary', () => {
    beforeEach(() => {
      doc.sheetsByIndex.push(mockMakeSheet({ sheetId: 222, title: 'Invoices' }))
      doc.sheetsByIndex.push(mockMakeSheet({ sheetId: 333, title: '' }))
    })

    it('maps sheets to dictionary items using criteria.documentId', async () => {
      const result = await service.getSheetsDictionary({ criteria: { documentId: DOC_ID } })

      expect(result).toEqual({
        items: [
          { label: 'Sheet1', note: `ID: ${ SHEET_ID }`, value: SHEET_ID },
          { label: 'Invoices', note: 'ID: 222', value: 222 },
          { label: '[empty]', note: 'ID: 333', value: 333 },
        ],
      })
    })

    it('falls back to criteria.sourceDocumentId', async () => {
      const result = await service.getSheetsDictionary({ criteria: { sourceDocumentId: DOC_ID } })

      expect(result.items).toHaveLength(3)
    })

    it('searches across sheet id and title', async () => {
      const byTitle = await service.getSheetsDictionary({
        search: 'invo',
        criteria: { documentId: DOC_ID },
      })

      expect(byTitle.items.map(i => i.value)).toEqual([222])

      const byId = await service.getSheetsDictionary({
        search: '333',
        criteria: { documentId: DOC_ID },
      })

      expect(byId.items.map(i => i.value)).toEqual([333])
    })
  })

  describe('getSheetColumnsDictionary', () => {
    it('reads the header row and maps it to column items', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title: 'Sheet1' } }],
      })

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }/values/Sheet1!1:1`).reply({
        values: [['Date', 'Amount', 'Notes']],
      })

      const result = await service.getSheetColumnsDictionary({
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(result).toEqual({
        items: [
          { label: 'Date', note: 'ID: COL$A', value: 'Date' },
          { label: 'Amount', note: 'ID: COL$B', value: 'Amount' },
          { label: 'Notes', note: 'ID: COL$C', value: 'Notes' },
        ],
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toEqual({ Authorization: `Bearer ${ TOKEN }` })
    })

    it('filters columns by a case-insensitive search', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title: 'Sheet1' } }],
      })

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }/values/Sheet1!1:1`).reply({
        values: [['Date', 'Amount']],
      })

      const result = await service.getSheetColumnsDictionary({
        search: 'AMO',
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(result.items.map(i => i.value)).toEqual(['Amount'])
    })

    it('returns an empty list when the header row is missing', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title: 'Sheet1' } }],
      })

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }/values/Sheet1!1:1`).reply({})

      const result = await service.getSheetColumnsDictionary({
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(result).toEqual({ items: [] })
    })

    it('labels blank header cells as [empty]', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title: 'Sheet1' } }],
      })

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }/values/Sheet1!1:1`).reply({ values: [['', 'B']] })

      const result = await service.getSheetColumnsDictionary({
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(result.items[0]).toEqual({ label: '[empty]', note: 'ID: COL$A', value: '' })
    })

    it('throws when the sheet id is not present in the document', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: 999, title: 'Other' } }],
      })

      await expect(
        service.getSheetColumnsDictionary({ criteria: { documentId: DOC_ID, sheetId: SHEET_ID } })
      ).rejects.toThrow(`Sheet with ID '${ SHEET_ID }' not found.`)

      expect(mock.history).toHaveLength(1)
    })

    // KNOWN SERVICE BUG: the A1 range is interpolated raw — sheet titles containing
    // spaces, quotes or '#' are neither wrapped in single quotes nor URL-encoded, so
    // Google rejects (or misinterprets) the range.
    it.each([
      ['Q1 Budget', `${ SHEETS_API }/${ DOC_ID }/values/Q1 Budget!1:1`],
      ['Bob\'s Sheet', `${ SHEETS_API }/${ DOC_ID }/values/Bob's Sheet!1:1`],
      ['A/B #2', `${ SHEETS_API }/${ DOC_ID }/values/A/B #2!1:1`],
    ])('builds an unescaped A1 range for the sheet title %p', async (title, expectedUrl) => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title } }],
      })

      mock.onGet(expectedUrl).reply({ values: [['Col']] })

      const result = await service.getSheetColumnsDictionary({
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(mock.history[1].url).toBe(expectedUrl)
      expect(result.items).toEqual([{ label: 'Col', note: 'ID: COL$A', value: 'Col' }])
    })

    // KNOWN SERVICE BUG: column ids are derived with String.fromCharCode(65 + index),
    // so the 27th column and beyond produce non-letter ids ('[', '\\', ...) instead of
    // the expected 'AA', 'AB'. Only the informational `note` is affected.
    it('produces non-letter column ids past column Z', async () => {
      const header = Array.from({ length: 28 }, (_, i) => `C${ i }`)

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).reply({
        sheets: [{ properties: { sheetId: SHEET_ID, title: 'Sheet1' } }],
      })

      mock.onGet(`${ SHEETS_API }/${ DOC_ID }/values/Sheet1!1:1`).reply({ values: [header] })

      const result = await service.getSheetColumnsDictionary({
        criteria: { documentId: DOC_ID, sheetId: SHEET_ID },
      })

      expect(result.items[25].note).toBe('ID: COL$Z')
      expect(result.items[26].note).toBe('ID: COL$[')
    })
  })

  // ── Document management ──

  describe('addDocument', () => {
    it('creates a spreadsheet with the current token and returns its id', async () => {
      const result = await service.addDocument('My New Doc')

      expect(mockCreateNewSpreadsheetDocument).toHaveBeenCalledWith(
        { token: TOKEN },
        { title: 'My New Doc' }
      )

      expect(result).toEqual({ documentId: 'new-doc-id' })
    })
  })

  describe('renameDocument', () => {
    it('updates the document title', async () => {
      await service.renameDocument(DOC_ID, 'Renamed')

      expect(doc.updateProperties).toHaveBeenCalledWith({ title: 'Renamed' })
    })
  })

  describe('getSheetList', () => {
    it('returns id/title pairs for every sheet', async () => {
      doc.sheetsByIndex.push(mockMakeSheet({ sheetId: 222, title: 'Second' }))

      await expect(service.getSheetList(DOC_ID)).resolves.toEqual([
        { sheetId: SHEET_ID, title: 'Sheet1' },
        { sheetId: 222, title: 'Second' },
      ])
    })
  })

  // ── Sheet management ──

  describe('addSheet', () => {
    it('creates a sheet with an explicit id and header values', async () => {
      const result = await service.addSheet(DOC_ID, 'New Tab', 555, ['A', 'B'])

      expect(doc.addSheet).toHaveBeenCalledWith({
        title: 'New Tab',
        sheetId: 555,
        headerValues: ['A', 'B'],
      })

      expect(result).toEqual({ sheetId: 555 })
    })

    it('lets Google assign the sheet id when none is supplied', async () => {
      const result = await service.addSheet(DOC_ID, 'New Tab', undefined, ['A'])

      expect(doc.addSheet).toHaveBeenCalledWith({
        title: 'New Tab',
        sheetId: undefined,
        headerValues: ['A'],
      })

      expect(result).toEqual({ sheetId: 4242 })
    })
  })

  describe('renameSheet', () => {
    it('coerces the new name to a string', async () => {
      await service.renameSheet(DOC_ID, SHEET_ID, 2025)

      expect(sheet.updateProperties).toHaveBeenCalledWith({ title: '2025' })
    })
  })

  describe('findSheet', () => {
    it('finds a sheet by title, case-insensitively', async () => {
      await expect(service.findSheet(DOC_ID, 'sHeEt1')).resolves.toEqual({
        sheetId: SHEET_ID,
        title: 'Sheet1',
      })

      expect(doc.addSheet).not.toHaveBeenCalled()
    })

    it('returns undefined when not found and creation is disabled', async () => {
      await expect(service.findSheet(DOC_ID, 'Missing')).resolves.toBeUndefined()
      expect(doc.addSheet).not.toHaveBeenCalled()
    })

    it('creates the sheet when createIfNotFound is enabled', async () => {
      const result = await service.findSheet(DOC_ID, 'Brand New', true)

      expect(doc.addSheet).toHaveBeenCalledWith({ title: 'Brand New' })
      expect(result).toEqual({ sheetId: 4242, title: 'Brand New' })
    })
  })

  describe('copySheetToDocument', () => {
    let targetDoc
    let copiedSheet

    beforeEach(() => {
      targetDoc = mockRegisterDoc('doc-2')
      copiedSheet = mockMakeSheet({ sheetId: 999, title: 'Copy of Sheet1' })
      targetDoc.sheetsById[999] = copiedSheet
      targetDoc.sheetsByIndex.push(copiedSheet)
    })

    it('copies the sheet and renames the copy to the source title', async () => {
      const result = await service.copySheetToDocument(DOC_ID, 'doc-2', SHEET_ID)

      expect(sheet.copyToSpreadsheet).toHaveBeenCalledWith('doc-2')
      expect(copiedSheet.updateProperties).toHaveBeenCalledWith({ title: 'Sheet1' })
      expect(sheet.delete).not.toHaveBeenCalled()
      expect(result).toEqual({ sheetId: 999 })
    })

    it('deletes the source sheet and evicts it from cache when requested', async () => {
      service.sheetsCache[`${ DOC_ID }-${ SHEET_ID }`] = sheet

      await service.copySheetToDocument(DOC_ID, 'doc-2', SHEET_ID, true)

      expect(sheet.delete).toHaveBeenCalled()
      expect(service.sheetsCache[`${ DOC_ID }-${ SHEET_ID }`]).toBeUndefined()
    })

    it('throws when the source sheet does not exist', async () => {
      await expect(service.copySheetToDocument(DOC_ID, 'doc-2', 4040)).rejects.toThrow(
        `Sheet with ID 4040 in document with ID ${ DOC_ID } not found.`
      )
    })
  })

  // ── Row operations ──

  describe('loadHeaderRow', () => {
    it('loads the default header row', async () => {
      sheet.headerValues = ['Name', 'Email']

      await expect(service.loadHeaderRow(DOC_ID, SHEET_ID)).resolves.toEqual(['Name', 'Email'])
      expect(sheet.loadHeaderRow).toHaveBeenCalledWith(undefined)
    })

    it('honours an explicit header row index', async () => {
      await service.loadHeaderRow(DOC_ID, SHEET_ID, 3)

      expect(sheet.loadHeaderRow).toHaveBeenCalledWith(3)
    })

    it('treats a zero header row index as "default"', async () => {
      await service.loadHeaderRow(DOC_ID, SHEET_ID, 0)

      expect(sheet.loadHeaderRow).toHaveBeenCalledWith(undefined)
    })
  })

  describe('setHeaderRow', () => {
    it('writes the header row', async () => {
      await service.setHeaderRow(DOC_ID, SHEET_ID, ['A', 'B'])

      expect(sheet.setHeaderRow).toHaveBeenCalledWith(['A', 'B'], undefined)
    })

    it('honours an explicit header row index', async () => {
      await service.setHeaderRow(DOC_ID, SHEET_ID, ['A'], 4)

      expect(sheet.setHeaderRow).toHaveBeenCalledWith(['A'], 4)
    })
  })

  describe('addRows', () => {
    it('appends rows with insert semantics', async () => {
      const rows = [{ Name: 'Ada' }, { Name: 'Bob' }]

      await service.addRows(DOC_ID, SHEET_ID, rows)

      expect(sheet.addRows).toHaveBeenCalledWith(rows, { insert: true })
    })

    it('accepts an empty array', async () => {
      await service.addRows(DOC_ID, SHEET_ID, [])

      expect(sheet.addRows).toHaveBeenCalledWith([], { insert: true })
    })
  })

  describe('addRow', () => {
    it('appends an object row as-is', async () => {
      await service.addRow(DOC_ID, SHEET_ID, { Name: 'Ada' })

      expect(sheet.addRow).toHaveBeenCalledWith({ Name: 'Ada' }, { insert: true })
    })

    it('zips an array row against the header row', async () => {
      sheet.headerValues = ['Name', 'Email', 'Score']

      await service.addRow(DOC_ID, SHEET_ID, ['Ada', 'ada@example.com'])

      expect(sheet.addRow).toHaveBeenCalledWith(
        { Name: 'Ada', Email: 'ada@example.com', Score: undefined },
        { insert: true }
      )
    })
  })

  describe('getRows', () => {
    beforeEach(() => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada' }),
        mockMakeRow(3, { Name: 'Bob' }),
        mockMakeRow(4, { Name: 'Cy' }),
      ]
    })

    it('returns plain row objects by default', async () => {
      await expect(service.getRows(DOC_ID, SHEET_ID)).resolves.toEqual([
        { Name: 'Ada' },
        { Name: 'Bob' },
        { Name: 'Cy' },
      ])

      expect(sheet.getRows).toHaveBeenCalledWith({ offset: undefined, limit: undefined })
    })

    it('applies offset and limit', async () => {
      await expect(service.getRows(DOC_ID, SHEET_ID, 1, 1)).resolves.toEqual([{ Name: 'Bob' }])
      expect(sheet.getRows).toHaveBeenCalledWith({ offset: 1, limit: 1 })
    })

    it('includes row numbers when requested', async () => {
      await expect(service.getRows(DOC_ID, SHEET_ID, undefined, undefined, true)).resolves.toEqual([
        { rowNumber: 2, rowData: { Name: 'Ada' } },
        { rowNumber: 3, rowData: { Name: 'Bob' } },
        { rowNumber: 4, rowData: { Name: 'Cy' } },
      ])
    })

    it('returns an empty array for an empty sheet', async () => {
      sheet.rows = []

      await expect(service.getRows(DOC_ID, SHEET_ID)).resolves.toEqual([])
    })

    it('preserves ragged rows verbatim', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' }), mockMakeRow(3, { Name: 'Bob', Extra: 'x' })]

      await expect(service.getRows(DOC_ID, SHEET_ID)).resolves.toEqual([
        { Name: 'Ada' },
        { Name: 'Bob', Extra: 'x' },
      ])
    })
  })

  describe('getLastRow', () => {
    it('returns null for an empty sheet', async () => {
      await expect(service.getLastRow(DOC_ID, SHEET_ID)).resolves.toBeNull()
    })

    it('returns the last row with its row number', async () => {
      sheet.rows = [mockMakeRow(2, { Name: 'Ada' }), mockMakeRow(3, { Name: 'Bob' })]

      await expect(service.getLastRow(DOC_ID, SHEET_ID)).resolves.toEqual({
        rowData: { Name: 'Bob' },
        rowNumber: 3,
      })
    })
  })

  describe('clearRowsOrCellsArea', () => {
    it('passes the A1 or numeric range straight through', async () => {
      await service.clearRowsOrCellsArea(DOC_ID, SHEET_ID, 'A4', 'C16')

      expect(sheet.clearRows).toHaveBeenCalledWith({ start: 'A4', end: 'C16' })
    })

    it('defaults both bounds when omitted', async () => {
      await service.clearRowsOrCellsArea(DOC_ID, SHEET_ID)

      expect(sheet.clearRows).toHaveBeenCalledWith({ start: undefined, end: undefined })
    })
  })

  describe('clearRowByIndex', () => {
    it('clears a single row', async () => {
      await service.clearRowByIndex(DOC_ID, SHEET_ID, 7)

      expect(sheet.clearRows).toHaveBeenCalledWith({ start: 7, end: 7 })
    })
  })

  describe('findSheetRow', () => {
    beforeEach(() => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada' }),
        mockMakeRow(3, { Name: 'Bob' }),
      ]
    })

    it('returns the first matching row', async () => {
      await expect(service.findSheetRow(DOC_ID, SHEET_ID, 'Name', 'Bob')).resolves.toEqual({
        rowData: { Name: 'Bob' },
        rowNumber: 3,
      })

      expect(sheet.loadCells).toHaveBeenCalled()
    })

    it('returns undefined when nothing matches', async () => {
      await expect(service.findSheetRow(DOC_ID, SHEET_ID, 'Name', 'Zed')).resolves.toBeUndefined()
    })
  })

  describe('findSheetRows', () => {
    beforeEach(() => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada' }),
        mockMakeRow(3, { Name: 'Bob' }),
        mockMakeRow(4, { Name: 'Bob' }),
      ]
    })

    it('returns all matches as plain data', async () => {
      await expect(service.findSheetRows(DOC_ID, SHEET_ID, 'Name', 'Bob')).resolves.toEqual([
        { Name: 'Bob' },
        { Name: 'Bob' },
      ])
    })

    it('returns matches with row numbers when requested', async () => {
      await expect(
        service.findSheetRows(DOC_ID, SHEET_ID, 'Name', 'Bob', true)
      ).resolves.toEqual([
        { rowData: { Name: 'Bob' }, rowNumber: 3 },
        { rowData: { Name: 'Bob' }, rowNumber: 4 },
      ])
    })

    it('returns an empty array when nothing matches', async () => {
      await expect(service.findSheetRows(DOC_ID, SHEET_ID, 'Name', 'Zed')).resolves.toEqual([])
    })

    it('caps the result set at 500 matches', async () => {
      sheet.rows = Array.from({ length: 600 }, (_, i) => mockMakeRow(i + 2, { Name: 'Bob' }))

      const result = await service.findSheetRows(DOC_ID, SHEET_ID, 'Name', 'Bob')

      expect(result).toHaveLength(500)
    })
  })

  describe('updateRows', () => {
    beforeEach(() => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada', Email: 'a@x.com' }),
        mockMakeRow(3, { Name: 'Bob', Email: 'b@x.com' }),
      ]

      sheet.headerValues = ['Name', 'Email']
    })

    it('assigns object values by 1-based index and saves each row', async () => {
      await service.updateRows(DOC_ID, SHEET_ID, [{ index: 2, values: { Name: 'Bobby' } }])

      expect(sheet.rows[1].assign).toHaveBeenCalledWith({ Name: 'Bobby' })
      expect(sheet.rows[1].save).toHaveBeenCalled()
      expect(sheet.rows[0].save).not.toHaveBeenCalled()
    })

    it('zips array values against the header row', async () => {
      await service.updateRows(DOC_ID, SHEET_ID, [{ index: 1, values: ['Ada2', 'a2@x.com'] }])

      expect(sheet.rows[0].assign).toHaveBeenCalledWith({ Name: 'Ada2', Email: 'a2@x.com' })
    })

    it('updates several rows in one call', async () => {
      await service.updateRows(DOC_ID, SHEET_ID, [
        { index: 1, values: { Name: 'A' } },
        { index: 2, values: { Name: 'B' } },
      ])

      expect(sheet.rows[0].save).toHaveBeenCalled()
      expect(sheet.rows[1].save).toHaveBeenCalled()
    })

    it('throws when a row is missing its index', async () => {
      await expect(
        service.updateRows(DOC_ID, SHEET_ID, [{ values: { Name: 'X' } }])
      ).rejects.toThrow('Property "index" is required in Row')
    })

    // NOTE: index is validated with a falsy check, so index 0 is rejected as "missing"
    // even though the intent is a 1-based index (0 is out of range anyway).
    it('rejects index 0 with the "missing index" message', async () => {
      await expect(
        service.updateRows(DOC_ID, SHEET_ID, [{ index: 0, values: {} }])
      ).rejects.toThrow('Property "index" is required in Row')
    })

    it('throws when the index points past the last row', async () => {
      await expect(
        service.updateRows(DOC_ID, SHEET_ID, [{ index: 99, values: {} }])
      ).rejects.toThrow(TypeError)
    })
  })

  describe('updateRow', () => {
    beforeEach(() => {
      sheet.rows = [
        mockMakeRow(2, { Name: 'Ada', Email: 'a@x.com' }),
        mockMakeRow(3, { Name: 'Bob', Email: 'b@x.com' }),
      ]

      sheet.headerValues = ['Name', 'Email']
    })

    it('converts the 1-based row number into a getRows offset', async () => {
      await service.updateRow(DOC_ID, SHEET_ID, 3, { Name: 'Bobby' })

      expect(sheet.getRows).toHaveBeenCalledWith({ offset: 1, limit: 1 })
      expect(sheet.rows[1].assign).toHaveBeenCalledWith({ Name: 'Bobby' })
      expect(sheet.rows[1].save).toHaveBeenCalled()
    })

    it('zips array row data against the header row', async () => {
      await service.updateRow(DOC_ID, SHEET_ID, 2, ['Ada2', 'a2@x.com'])

      expect(sheet.rows[0].assign).toHaveBeenCalledWith({ Name: 'Ada2', Email: 'a2@x.com' })
    })

    it('throws when the row number does not resolve to a row', async () => {
      await expect(service.updateRow(DOC_ID, SHEET_ID, 99, { Name: 'X' })).rejects.toThrow(
        TypeError
      )
    })
  })

  // ── Cell operations ──

  describe('getCell', () => {
    it('converts 1-based coordinates and loads only the target cell', async () => {
      sheet.cells['1,2'] = { value: 'hello' }

      await expect(service.getCell(DOC_ID, SHEET_ID, 2, 3)).resolves.toEqual({ value: 'hello' })

      expect(sheet.loadCells).toHaveBeenCalledWith({
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 2,
        endColumnIndex: 3,
      })

      expect(sheet.getCell).toHaveBeenCalledWith(1, 2)
    })
  })

  describe('updateCell', () => {
    it('writes the value and saves', async () => {
      await service.updateCell(DOC_ID, SHEET_ID, 2, 3, 'new value')

      expect(sheet.cells['1,2']).toEqual({ value: 'new value' })
      expect(sheet.saveUpdatedCells).toHaveBeenCalled()
    })
  })

  describe('clearCell', () => {
    it('blanks the cell and saves', async () => {
      sheet.cells['1,2'] = { value: 'old' }

      await service.clearCell(DOC_ID, SHEET_ID, 2, 3)

      expect(sheet.cells['1,2']).toEqual({ value: '' })
      expect(sheet.saveUpdatedCells).toHaveBeenCalled()
    })
  })

  describe('getCellByA1', () => {
    it('loads the A1 range and returns the raw value', async () => {
      sheet.cells.B5 = { value: 42 }

      await expect(service.getCellByA1(DOC_ID, SHEET_ID, 'B5')).resolves.toBe(42)
      expect(sheet.loadCells).toHaveBeenCalledWith('B5')
    })
  })

  describe('updateCellByA1', () => {
    it('writes the value and saves', async () => {
      await service.updateCellByA1(DOC_ID, SHEET_ID, 'C7', 'written')

      expect(sheet.cells.C7).toEqual({ value: 'written' })
      expect(sheet.saveUpdatedCells).toHaveBeenCalled()
    })

    // NOTE: unlike getCellByA1/clearCellByA1, updateCellByA1 never calls loadCells first,
    // so the cell must already be loaded for the underlying library to resolve it.
    it('does not preload the cell range', async () => {
      await service.updateCellByA1(DOC_ID, SHEET_ID, 'C7', 'written')

      expect(sheet.loadCells).not.toHaveBeenCalled()
    })
  })

  describe('clearCellByA1', () => {
    it('loads, blanks and saves the cell', async () => {
      sheet.cells.D2 = { value: 'old' }

      await service.clearCellByA1(DOC_ID, SHEET_ID, 'D2')

      expect(sheet.loadCells).toHaveBeenCalledWith('D2')
      expect(sheet.cells.D2).toEqual({ value: '' })
      expect(sheet.saveUpdatedCells).toHaveBeenCalled()
    })
  })

  // ── Formatting ──

  describe('formatSpreadsheetRow', () => {
    const url = `${ SHEETS_API }/${ DOC_ID }:batchUpdate`

    it('maps colour labels to Google rgb values and builds the field mask', async () => {
      mock.onPost(url).reply({})

      await service.formatSpreadsheetRow(DOC_ID, SHEET_ID, 3, 'Light Blue', 'Red', true, false, true)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toEqual({ Authorization: `Bearer ${ TOKEN }` })

      const request = mock.history[0].body.requests[0].repeatCell

      expect(request.range).toEqual({ sheetId: SHEET_ID, startRowIndex: 2, endRowIndex: 3 })

      expect(request.cell.userEnteredFormat.backgroundColorStyle).toEqual({
        rgbColor: { red: 0.68, green: 0.85, blue: 0.9 },
      })

      expect(request.cell.userEnteredFormat.textFormat).toEqual({
        foregroundColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
        bold: true,
        italic: false,
        strikethrough: true,
      })

      expect(request.fields).toBe(
        [
          'userEnteredFormat.backgroundColorStyle',
          'userEnteredFormat.textFormat.foregroundColorStyle',
          'userEnteredFormat.textFormat.bold',
          'userEnteredFormat.textFormat.italic',
          'userEnteredFormat.textFormat.strikethrough',
        ].join(',')
      )
    })

    it('omits colour styles and their field mask entries when no colours are given', async () => {
      mock.onPost(url).reply({})

      await service.formatSpreadsheetRow(DOC_ID, SHEET_ID, 1)

      const request = mock.history[0].body.requests[0].repeatCell

      expect(request.cell.userEnteredFormat.backgroundColorStyle).toBeUndefined()
      expect(request.cell.userEnteredFormat.textFormat.foregroundColorStyle).toBeUndefined()

      expect(request.fields).toBe(
        [
          'userEnteredFormat.textFormat.bold',
          'userEnteredFormat.textFormat.italic',
          'userEnteredFormat.textFormat.strikethrough',
        ].join(',')
      )

      expect(request.range).toEqual({ sheetId: SHEET_ID, startRowIndex: 0, endRowIndex: 1 })
    })

    // KNOWN SERVICE BUG: the field mask is driven by the raw label truthiness while the
    // style object is driven by ColorMap lookup, so an unknown colour label adds the
    // field to the mask without a corresponding style — clearing the existing colour.
    it('adds a field-mask entry with no style for an unrecognised colour label', async () => {
      mock.onPost(url).reply({})

      await service.formatSpreadsheetRow(DOC_ID, SHEET_ID, 1, 'Chartreuse')

      const request = mock.history[0].body.requests[0].repeatCell

      expect(request.cell.userEnteredFormat.backgroundColorStyle).toBeUndefined()
      expect(request.fields).toContain('userEnteredFormat.backgroundColorStyle')
    })

    it.each([
      ['White', { red: 1, green: 1, blue: 1 }],
      ['Black', { red: 0, green: 0, blue: 0 }],
      ['Green', { red: 0, green: 0.5, blue: 0 }],
      ['Indigo', { red: 0.29, green: 0, blue: 0.51 }],
      ['Violet', { red: 0.93, green: 0.51, blue: 0.93 }],
    ])('maps the %s label to its rgb triple', async (label, rgb) => {
      mock.onPost(url).reply({})

      await service.formatSpreadsheetRow(DOC_ID, SHEET_ID, 1, label)

      const request = mock.history[0].body.requests[0].repeatCell

      expect(request.cell.userEnteredFormat.backgroundColorStyle.rgbColor).toEqual(rgb)
    })
  })

  // ── Export ──

  describe('exportSheet', () => {
    it.each([
      [undefined, 'downloadAsCSV', 'Sheet1.csv'],
      ['csv', 'downloadAsCSV', 'Sheet1.csv'],
      ['tsv', 'downloadAsTSV', 'Sheet1.tsv'],
      ['pdf', 'downloadAsPDF', 'Sheet1.pdf'],
    ])('exports as %s using %s', async (fileType, downloadMethod, filename) => {
      const url = await service.exportSheet(DOC_ID, SHEET_ID, fileType)

      expect(sheet[downloadMethod]).toHaveBeenCalled()
      expect(uploads).toHaveLength(1)

      expect(uploads[0].options).toEqual({
        filename,
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(url).toBe(`https://files.example.com/${ filename }`)
    })

    it('uses a custom file name and forwards file options', async () => {
      await service.exportSheet(DOC_ID, SHEET_ID, 'csv', 'report', { scope: 'APP' })

      expect(uploads[0].options).toEqual({
        filename: 'report.csv',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })
    })
  })

  describe('exportDocument', () => {
    it.each([
      [undefined, 'downloadAsXLSX', 'Doc Title.xlsx'],
      ['xlsx', 'downloadAsXLSX', 'Doc Title.xlsx'],
      ['ods', 'downloadAsODS', 'Doc Title.ods'],
      ['html', 'downloadAsHTML', 'Doc Title.zip'],
    ])('exports as %s using %s', async (fileType, downloadMethod, filename) => {
      const url = await service.exportDocument(DOC_ID, fileType)

      expect(doc[downloadMethod]).toHaveBeenCalled()
      expect(uploads[0].options).toMatchObject({ filename })
      expect(url).toBe(`https://files.example.com/${ filename }`)
    })

    it('uses a custom file name and forwards file options', async () => {
      await service.exportDocument(DOC_ID, 'ods', 'backup', { scope: 'APP' })

      expect(uploads[0].options).toEqual({
        filename: 'backup.ods',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })
    })
  })

  // ── CSV import ──

  describe('importFromCSV', () => {
    const CSV_URL = 'https://files.example.com/contacts.csv'

    it('creates a new sheet named after the file when the sheet id is unknown', async () => {
      mock.onGet(CSV_URL).reply(Buffer.from('Name,Email\nAda,a@x.com\nBob,b@x.com\n'))

      const result = await service.importFromCSV(DOC_ID, CSV_URL)

      expect(doc.addSheet).toHaveBeenCalledWith({ title: 'contacts', sheetId: undefined })
      expect(mock.history[0].encoding).toBeNull()
      expect(result).toEqual({ sheetId: 4242 })

      const created = doc.sheetsById[4242]

      expect(created.loadHeaderRow).toHaveBeenCalled()
      expect(created.setHeaderRow).not.toHaveBeenCalled()

      expect(created.addRows).toHaveBeenCalledWith([
        ['Ada', 'a@x.com'],
        ['Bob', 'b@x.com'],
        [''],
      ])
    })

    it('appends to an existing sheet when the sheet id resolves', async () => {
      mock.onGet(CSV_URL).reply(Buffer.from('Name,Email\nAda,a@x.com'))

      const result = await service.importFromCSV(DOC_ID, CSV_URL, SHEET_ID)

      expect(doc.addSheet).not.toHaveBeenCalled()
      expect(sheet.addRows).toHaveBeenCalledWith([['Ada', 'a@x.com']])
      expect(result).toEqual({ sheetId: SHEET_ID })
    })

    it('sets the header row from the CSV when the sheet has none', async () => {
      sheet.loadHeaderRow.mockRejectedValue(new Error('no values in header row'))
      mock.onGet(CSV_URL).reply(Buffer.from('Name,Email\nAda,a@x.com'))

      await service.importFromCSV(DOC_ID, CSV_URL, SHEET_ID)

      expect(sheet.setHeaderRow).toHaveBeenCalledWith(['Name', 'Email'])
    })
  })

  // ── Guards ──

  describe('parameter guards', () => {
    it.each([
      [
        'renameDocument without a document id',
        () => service.renameDocument(undefined, 'x'),
        'Spreadsheet(document) ID must be provided.',
      ],
      [
        'getRows with a non-numeric sheet id',
        () => service.getRows(DOC_ID, 'not-a-number'),
        'Sheet ID is required and must be a number.',
      ],
      [
        'getRows without a sheet id',
        () => service.getRows(DOC_ID),
        'Sheet ID is required and must be a number.',
      ],
      [
        'addSheet with a non-numeric sheet id',
        () => service.addSheet(DOC_ID, 'T', 'abc', ['A']),
        'Sheet ID must be a number.',
      ],
      [
        'addSheet without header values',
        () => service.addSheet(DOC_ID, 'T', 555),
        'Header Values must be provided.',
      ],
      [
        'addSheet with empty header values',
        () => service.addSheet(DOC_ID, 'T', 555, []),
        'Header Values must be provided.',
      ],
      [
        'formatSpreadsheetRow with a non-numeric sheet id',
        () => service.formatSpreadsheetRow(DOC_ID, 'x', 1),
        'Sheet ID must be a number.',
      ],
      [
        'deleteSheet with a non-numeric sheet id',
        () => service.deleteSheet(DOC_ID, 'x'),
        'Sheet ID must be a number.',
      ],
      [
        'setHeaderRow with non-array values',
        () => service.setHeaderRow(DOC_ID, SHEET_ID, 'A,B'),
        'Header row values must be provided and must be array.',
      ],
      [
        'addRows with non-array rows',
        () => service.addRows(DOC_ID, SHEET_ID, { Name: 'Ada' }),
        'Rows must be provided and must be array.',
      ],
      [
        'updateRows with non-array rows',
        () => service.updateRows(DOC_ID, SHEET_ID, 'nope'),
        'Rows must be a valid array.',
      ],
      [
        'exportSheet with an unsupported file type',
        () => service.exportSheet(DOC_ID, SHEET_ID, 'docx'),
        'File type must be one of "csv", "tsv", or "pdf".',
      ],
      [
        'exportDocument with an unsupported file type',
        () => service.exportDocument(DOC_ID, 'csv'),
        'File type must be one of xlsx, ods, html.',
      ],
      [
        'getCell with a non-numeric row number',
        () => service.getCell(DOC_ID, SHEET_ID, '1', 1),
        'Row index must be a number.',
      ],
      [
        'getCell with a non-numeric column number',
        () => service.getCell(DOC_ID, SHEET_ID, 1, '1'),
        'Column index must be a number.',
      ],
      [
        'updateCell with a non-numeric row number',
        () => service.updateCell(DOC_ID, SHEET_ID, '1', 1, 'v'),
        'Row number must be a number.',
      ],
      [
        'updateCell with a non-numeric column number',
        () => service.updateCell(DOC_ID, SHEET_ID, 1, '1', 'v'),
        'Column index must be a number.',
      ],
      [
        'clearCell with a non-numeric row number',
        () => service.clearCell(DOC_ID, SHEET_ID, '1', 1),
        'Row index must be a number.',
      ],
      [
        'clearCell with a non-numeric column number',
        () => service.clearCell(DOC_ID, SHEET_ID, 1, '1'),
        'Column index must be a number.',
      ],
      [
        'getCellByA1 without an address',
        () => service.getCellByA1(DOC_ID, SHEET_ID, ''),
        'A1 Address must be provided.',
      ],
      [
        'updateCellByA1 without an address',
        () => service.updateCellByA1(DOC_ID, SHEET_ID, '', 'v'),
        'A1 cell address must be provided.',
      ],
      [
        'clearCellByA1 without an address',
        () => service.clearCellByA1(DOC_ID, SHEET_ID, ''),
        'A1 cell address must be provided.',
      ],
      [
        'importFromCSV without a url',
        () => service.importFromCSV(DOC_ID, ''),
        'CSV Url must be provided.',
      ],
    ])('%s throws and issues no HTTP call', async (_name, invoke, message) => {
      await expect(invoke()).rejects.toThrow(message)
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Error propagation ──

  describe('error propagation', () => {
    it.each([
      ['getSheetList', () => service.getSheetList(DOC_ID), 'doc'],
      ['findSheet', () => service.findSheet(DOC_ID, 'Sheet1'), 'doc'],
      ['exportDocument', () => service.exportDocument(DOC_ID), 'doc'],
      ['copySheetToDocument', () => service.copySheetToDocument(DOC_ID, 'doc-2', SHEET_ID), 'doc'],
      ['importFromCSV', () => service.importFromCSV(DOC_ID, 'https://x/y.csv'), 'doc'],
      ['getRows', () => service.getRows(DOC_ID, SHEET_ID), 'doc'],
      ['renameDocument', () => service.renameDocument(DOC_ID, 'x'), 'docUpdate'],
      ['deleteDocument', () => service.deleteDocument(DOC_ID), 'docDelete'],
      ['addSheet', () => service.addSheet(DOC_ID, 'T', 555, ['A']), 'docAddSheet'],
      ['deleteSheet', () => service.deleteSheet(DOC_ID, SHEET_ID), 'docDeleteSheet'],
    ])('%s propagates the underlying failure', async (_name, invoke, target) => {
      const boom = new Error('google is down')

      const targets = {
        doc: () => doc.loadInfo.mockRejectedValue(boom),
        docUpdate: () => doc.updateProperties.mockRejectedValue(boom),
        docDelete: () => doc.delete.mockRejectedValue(boom),
        docAddSheet: () => doc.addSheet.mockRejectedValue(boom),
        docDeleteSheet: () => doc.deleteSheet.mockRejectedValue(boom),
      }

      targets[target]()

      await expect(invoke()).rejects.toThrow('google is down')
    })

    it.each([
      ['setHeaderRow', () => service.setHeaderRow(DOC_ID, SHEET_ID, ['A']), 'setHeaderRow'],
      ['addRows', () => service.addRows(DOC_ID, SHEET_ID, []), 'addRows'],
      ['addRow', () => service.addRow(DOC_ID, SHEET_ID, {}), 'addRow'],
      ['getLastRow', () => service.getLastRow(DOC_ID, SHEET_ID), 'getRows'],
      ['clearRowByIndex', () => service.clearRowByIndex(DOC_ID, SHEET_ID, 2), 'clearRows'],
      [
        'clearRowsOrCellsArea',
        () => service.clearRowsOrCellsArea(DOC_ID, SHEET_ID, 'A1', 'B2'),
        'clearRows',
      ],
      ['findSheetRow', () => service.findSheetRow(DOC_ID, SHEET_ID, 'Name', 'x'), 'loadCells'],
      ['findSheetRows', () => service.findSheetRows(DOC_ID, SHEET_ID, 'Name', 'x'), 'getRows'],
      ['getCell', () => service.getCell(DOC_ID, SHEET_ID, 1, 1), 'loadCells'],
      ['updateCell', () => service.updateCell(DOC_ID, SHEET_ID, 1, 1, 'v'), 'loadCells'],
      ['clearCell', () => service.clearCell(DOC_ID, SHEET_ID, 1, 1), 'loadCells'],
      ['getCellByA1', () => service.getCellByA1(DOC_ID, SHEET_ID, 'A1'), 'loadCells'],
      ['clearCellByA1', () => service.clearCellByA1(DOC_ID, SHEET_ID, 'A1'), 'loadCells'],
      [
        'updateCellByA1',
        () => service.updateCellByA1(DOC_ID, SHEET_ID, 'A1', 'v'),
        'saveUpdatedCells',
      ],
      ['renameSheet', () => service.renameSheet(DOC_ID, SHEET_ID, 'x'), 'updateProperties'],
      ['loadHeaderRow', () => service.loadHeaderRow(DOC_ID, SHEET_ID), 'loadHeaderRow'],
      ['exportSheet', () => service.exportSheet(DOC_ID, SHEET_ID), 'downloadAsCSV'],
      ['onNewRow', () => service.onNewRow({ triggerData: { documentId: DOC_ID, sheetId: SHEET_ID } }), 'getRows'],
      [
        'onNewOrUpdatedRow',
        () => service.onNewOrUpdatedRow({ triggerData: { documentId: DOC_ID, sheetId: SHEET_ID, column: 'Name' } }),
        'getRows',
      ],
    ])('%s propagates the underlying sheet failure', async (_name, invoke, method) => {
      sheet[method].mockRejectedValue(new Error('sheet exploded'))

      await expect(invoke()).rejects.toThrow('sheet exploded')
    })

    it.each([
      ['getSpreadsheetsDictionary', () => service.getSpreadsheetsDictionary({ criteria: {} })],
      ['onNewDocument', () => service.onNewDocument({ triggerData: {} })],
    ])('%s propagates a wrapped Drive API error', async (_name, invoke) => {
      mock.onGet(DRIVE_FILES_URL).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(invoke()).rejects.toThrow('Forbidden')
    })

    it('getSheetColumnsDictionary propagates a Sheets API error', async () => {
      mock.onGet(`${ SHEETS_API }/${ DOC_ID }`).replyWithError({ message: 'Not Found' })

      await expect(
        service.getSheetColumnsDictionary({ criteria: { documentId: DOC_ID, sheetId: SHEET_ID } })
      ).rejects.toThrow('Not Found')
    })

    it('formatSpreadsheetRow propagates a batchUpdate error', async () => {
      mock.onPost(`${ SHEETS_API }/${ DOC_ID }:batchUpdate`).replyWithError({ message: 'Bad Request' })

      await expect(service.formatSpreadsheetRow(DOC_ID, SHEET_ID, 1)).rejects.toThrow('Bad Request')
    })

    it('addDocument propagates a creation failure', async () => {
      mockCreateNewSpreadsheetDocument.mockRejectedValue(new Error('quota exceeded'))

      await expect(service.addDocument('T')).rejects.toThrow('quota exceeded')
    })

    it('exportSheet propagates a file storage failure', async () => {
      service.flowrunner.Files.uploadFile.mockRejectedValue(new Error('storage full'))

      await expect(service.exportSheet(DOC_ID, SHEET_ID)).rejects.toThrow('storage full')
    })
  })
})
