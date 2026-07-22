'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.smartsheet.com/2.0'

const AUTH = { 'Authorization': `Bearer ${ ACCESS_TOKEN }` }

const SHEET_ID = 1234567890123456
const ROW_ID = 2234567890123456
const COLUMN_ID = 3234567890123456

describe('Smartsheet Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['accessToken', 'region'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accessToken', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'region', required: false, shared: false, type: 'CHOICE', defaultValue: 'US' }),
        ])
      )

      expect(configItems[1].options).toEqual(['US', 'EU', 'Gov'])
    })

    it('defaults to the US base URL', () => {
      expect(service.accessToken).toBe(ACCESS_TOKEN)
      expect(service.baseUrl).toBe(BASE)
    })

    it('selects the regional base URL from config', () => {
      const euSandbox = createSandbox({ accessToken: 'eu-token', region: 'EU' })

      jest.resetModules()
      require('../src/index.js')

      expect(euSandbox.getService().baseUrl).toBe('https://api.smartsheet.eu/2.0')

      const govSandbox = createSandbox({ accessToken: 'gov-token', region: 'Gov' })

      jest.resetModules()
      require('../src/index.js')

      expect(govSandbox.getService().baseUrl).toBe('https://api.smartsheetgov.com/2.0')

      const unknownSandbox = createSandbox({ accessToken: 't', region: 'Mars' })

      jest.resetModules()
      require('../src/index.js')

      expect(unknownSandbox.getService().baseUrl).toBe(BASE)

      // restore the shared sandbox used by the rest of the suite
      sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
      jest.resetModules()
      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  // ── Request gateway behaviour ──

  describe('request gateway', () => {
    it('sends the bearer token and a JSON content type by default', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 1 })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toEqual({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('unwraps the {message:SUCCESS, result} envelope', async () => {
      mock.onPost(`${ BASE }/sheets`).reply({ message: 'SUCCESS', resultCode: 0, result: { id: 9, name: 'New' } })

      const result = await service.createSheet('New', [])

      expect(result).toEqual({ id: 9, name: 'New' })
    })

    it('returns unwrapped responses untouched when there is no envelope', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({ data: [], totalCount: 0 })

      await expect(service.listSheets()).resolves.toEqual({ data: [], totalCount: 0 })
    })

    it('strips empty query parameters', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({ data: [] })

      await service.listSheets(undefined, null, '')

      expect(mock.history[0].query).toEqual({})
    })

    it('wraps API errors with the Smartsheet error code and refId', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({
        message: 'Request failed',
        body: { message: 'Not Found', errorCode: 1006, refId: 'abc123' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow(
        'Smartsheet API error: Not Found (errorCode 1006, refId abc123)'
      )
    })

    it('falls back to the transport error message when no body is present', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({ message: 'socket hang up' })

      await expect(service.getCurrentUser()).rejects.toThrow('Smartsheet API error: socket hang up')
    })
  })

  // ── Sheets ──

  describe('listSheets', () => {
    it('passes paging and converts a millisecond modifiedSince to ISO', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({ data: [] })

      await service.listSheets(2, 50, 1700000000000)

      expect(mock.history[0].query).toEqual({
        page: 2,
        pageSize: 50,
        modifiedSince: new Date(1700000000000).toISOString(),
      })
    })

    it('passes an ISO modifiedSince through unchanged', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({ data: [] })

      await service.listSheets(1, 10, '2024-01-01T00:00:00Z')

      expect(mock.history[0].query.modifiedSince).toBe('2024-01-01T00:00:00Z')
    })
  })

  describe('getSheet', () => {
    it('maps include labels, ids and row numbers into CSV query params', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply({ id: SHEET_ID })

      await service.getSheet(SHEET_ID, ['Attachments', 'Format'], 1700000000000, ['1', '2'], [3], 1, 100)

      expect(mock.history[0].query).toEqual({
        include: 'attachments,format',
        rowsModifiedSince: new Date(1700000000000).toISOString(),
        columnIds: '1,2',
        rowNumbers: '3',
        page: 1,
        pageSize: 100,
      })
    })

    it('passes unknown include values through unchanged', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply({ id: SHEET_ID })

      await service.getSheet(SHEET_ID, ['crossSheetReferences'])

      expect(mock.history[0].query).toEqual({ include: 'crossSheetReferences' })
    })

    it('omits optional query params entirely', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply({ id: SHEET_ID })

      await service.getSheet(SHEET_ID)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('createSheet', () => {
    it('maps friendly column types and defaults the type', async () => {
      mock.onPost(`${ BASE }/sheets`).reply({ message: 'SUCCESS', result: { id: 1 } })

      await service.createSheet('Project', [
        { title: 'Task', type: 'Text / Number', primary: true },
        { title: 'Due', type: 'Date & Time' },
        { title: 'Status', type: 'Dropdown (Picklist)', options: ['A', 'B'] },
        { title: 'Plain' },
      ])

      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        name: 'Project',
        columns: [
          { title: 'Task', type: 'TEXT_NUMBER', primary: true },
          { title: 'Due', type: 'DATETIME' },
          { title: 'Status', type: 'PICKLIST', options: ['A', 'B'] },
          { title: 'Plain', type: 'TEXT_NUMBER' },
        ],
      })
    })

    it('handles a missing columns array', async () => {
      mock.onPost(`${ BASE }/sheets`).reply({ message: 'SUCCESS', result: { id: 2 } })

      await service.createSheet('Empty')

      expect(mock.history[0].body).toEqual({ name: 'Empty', columns: [] })
    })
  })

  describe('copySheet', () => {
    it('maps destination type, coerces the id and maps includes', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/copy`).reply({ message: 'SUCCESS', result: { id: 5 } })

      await service.copySheet(SHEET_ID, 'Folder', '99', 'Copy of Sheet', ['Data', 'Attachments'])

      expect(mock.history[0].query).toEqual({ include: 'data,attachments' })

      expect(mock.history[0].body).toEqual({
        destinationType: 'folder',
        destinationId: 99,
        newName: 'Copy of Sheet',
      })
    })

    it('defaults the destination type to home', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/copy`).reply({ message: 'SUCCESS', result: {} })

      await service.copySheet(SHEET_ID, undefined, undefined, 'Copy')

      expect(mock.history[0].body).toEqual({ destinationType: 'home', newName: 'Copy' })
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('moveSheet', () => {
    it('moves a sheet into a workspace', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/move`).reply({ message: 'SUCCESS', result: { id: SHEET_ID } })

      await service.moveSheet(SHEET_ID, 'Workspace', 77)

      expect(mock.history[0].body).toEqual({ destinationType: 'workspace', destinationId: 77 })
    })
  })

  describe('updateSheet', () => {
    it('sends only the provided fields', async () => {
      mock.onPut(`${ BASE }/sheets/${ SHEET_ID }`).reply({ message: 'SUCCESS', result: { id: SHEET_ID } })

      await service.updateSheet(SHEET_ID, 'Renamed')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'Renamed' })
    })

    it('includes user settings when provided', async () => {
      mock.onPut(`${ BASE }/sheets/${ SHEET_ID }`).reply({ message: 'SUCCESS', result: {} })

      await service.updateSheet(SHEET_ID, undefined, { criticalPathEnabled: true })

      expect(mock.history[0].body).toEqual({ userSettings: { criticalPathEnabled: true } })
    })
  })

  describe('deleteSheet', () => {
    it('issues a DELETE and unwraps the envelope', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }`).reply({ message: 'SUCCESS', resultCode: 0, result: SHEET_ID })

      await expect(service.deleteSheet(SHEET_ID)).resolves.toBe(SHEET_ID)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('exportSheet', () => {
    let uploadFile

    beforeEach(() => {
      // The sandbox does not provide a Files API — stub the one the service uses.
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.example.com/out' })
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads a binary Excel export and saves it to file storage', async () => {
      const buffer = Buffer.from('excel-bytes')

      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply(buffer)

      const result = await service.exportSheet(SHEET_ID, 'Excel', undefined, 'report')

      expect(mock.history[0].headers).toMatchObject({ ...AUTH, 'Accept': 'application/vnd.ms-excel' })
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].query).toEqual({})

      expect(uploadFile).toHaveBeenCalledWith(buffer, {
        filename: 'report.xlsx',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        fileURL: 'https://files.example.com/out',
        filename: 'report.xlsx',
        sizeBytes: buffer.length,
        format: 'Excel',
      })
    })

    it('passes the mapped paper size for PDF exports and keeps an existing extension', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply(Buffer.from('pdf'))

      const result = await service.exportSheet(SHEET_ID, 'PDF', 'A4', 'plan.pdf', { scope: 'APP' })

      expect(mock.history[0].headers).toMatchObject({ 'Accept': 'application/pdf' })
      expect(mock.history[0].query).toEqual({ paperSize: 'A4' })

      expect(uploadFile.mock.calls[0][1]).toEqual({
        filename: 'plan.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })

      expect(result.format).toBe('PDF')
    })

    it('defaults to Excel for an unknown format and generates a filename', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply(Buffer.from('x'))

      const result = await service.exportSheet(SHEET_ID, 'Word')

      expect(mock.history[0].headers).toMatchObject({ 'Accept': 'application/vnd.ms-excel' })
      expect(result.filename).toMatch(/^sheet_\d+_\d+\.xlsx$/)
      expect(result.format).toBe('Word')
    })

    it('converts non-Buffer binary payloads into a Buffer', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }`).reply('csv,bytes')

      await service.exportSheet(SHEET_ID, 'CSV', undefined, 'data')

      expect(Buffer.isBuffer(uploadFile.mock.calls[0][0])).toBe(true)
      expect(uploadFile.mock.calls[0][1].filename).toBe('data.csv')
    })
  })

  // ── Rows ──

  describe('addRows', () => {
    it('normalizes an explicit rows array', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [{ id: ROW_ID }] })

      await service.addRows(SHEET_ID, [
        { cells: [{ columnId: '5', value: 'A' }], toTop: true, parentId: '7', expanded: false },
      ])

      expect(mock.history[0].body).toEqual([
        { cells: [{ columnId: 5, value: 'A' }], toTop: true, parentId: 7, expanded: false },
      ])
    })

    it('builds a single row from the flat cells parameter', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [] })

      await service.addRows(SHEET_ID, [], [{ columnId: COLUMN_ID, value: 'Done' }], undefined, true, undefined, '12')

      expect(mock.history[0].body).toEqual([
        { cells: [{ columnId: COLUMN_ID, value: 'Done' }], toBottom: true, siblingId: 12 },
      ])
    })

    it('throws when neither rows nor cells are provided', async () => {
      await expect(service.addRows(SHEET_ID)).rejects.toThrow(
        'Smartsheet API error: provide either Rows or Cells so at least one row can be added.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('tolerates rows without cells', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [] })

      await service.addRows(SHEET_ID, [{ toTop: true }])

      expect(mock.history[0].body).toEqual([{ cells: [], toTop: true }])
    })
  })

  describe('updateRows', () => {
    it('coerces row and column ids to numbers', async () => {
      mock.onPut(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [] })

      await service.updateRows(SHEET_ID, [{ id: String(ROW_ID), cells: [{ columnId: String(COLUMN_ID), value: 1 }] }])

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual([{ id: ROW_ID, cells: [{ columnId: COLUMN_ID, value: 1 }] }])
    })

    it('sends an empty payload when no rows are given', async () => {
      mock.onPut(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [] })

      await service.updateRows(SHEET_ID)

      expect(mock.history[0].body).toEqual([])
    })
  })

  describe('getRow', () => {
    it('maps row include labels', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }`).reply({ id: ROW_ID })

      await service.getRow(SHEET_ID, ROW_ID, ['Column Type', 'Object Value'])

      expect(mock.history[0].query).toEqual({ include: 'columnType,objectValue' })
    })
  })

  describe('deleteRows', () => {
    it('sends the ids as CSV and defaults ignoreRowsNotFound to true', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [1, 2] })

      const result = await service.deleteRows(SHEET_ID, ['1', 2])

      expect(mock.history[0].query).toEqual({ ids: '1,2', ignoreRowsNotFound: true })
      expect(result).toEqual({ deletedRowIds: [1, 2] })
    })

    it('honours an explicit false for ignoreRowsNotFound', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }/rows`).reply({ message: 'SUCCESS', result: [] })

      await service.deleteRows(SHEET_ID, [1], false)

      expect(mock.history[0].query).toEqual({ ids: '1', ignoreRowsNotFound: false })
    })
  })

  describe('moveRowsToSheet / copyRowsToSheet', () => {
    it('moves rows to another sheet', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/move`).reply({ message: 'SUCCESS', result: { rowMappings: [] } })

      await service.moveRowsToSheet(SHEET_ID, ['1', '2'], '999', ['Attachments'], true)

      expect(mock.history[0].query).toEqual({ include: 'attachments', ignoreRowsNotFound: true })
      expect(mock.history[0].body).toEqual({ rowIds: [1, 2], to: { sheetId: 999 } })
    })

    it('omits ignoreRowsNotFound unless explicitly true', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/copy`).reply({ message: 'SUCCESS', result: {} })

      await service.copyRowsToSheet(SHEET_ID, [1], 999, ['Discussions'])

      expect(mock.history[0].query).toEqual({ include: 'discussions' })
      expect(mock.history[0].body).toEqual({ rowIds: [1], to: { sheetId: 999 } })
    })
  })

  describe('getCellHistory', () => {
    it('requests the cell history endpoint with paging', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }/columns/${ COLUMN_ID }/history`).reply({ data: [] })

      await service.getCellHistory(SHEET_ID, ROW_ID, COLUMN_ID, 1, 20)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 20 })
    })
  })

  // ── Columns ──

  describe('columns', () => {
    it('lists columns', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/columns`).reply({ data: [] })

      await service.listColumns(SHEET_ID, 1, 100)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 100 })
    })

    it('gets a single column', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/columns/${ COLUMN_ID }`).reply({ id: COLUMN_ID })

      await expect(service.getColumn(SHEET_ID, COLUMN_ID)).resolves.toEqual({ id: COLUMN_ID })
    })

    it('adds a column with a mapped type', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/columns`).reply({ message: 'SUCCESS', result: { id: 1 } })

      await service.addColumn(SHEET_ID, 'Status', 'Dropdown (Picklist)', '2', ['Open', 'Closed'], { type: 'PICKLIST' })

      expect(mock.history[0].body).toEqual({
        title: 'Status',
        type: 'PICKLIST',
        index: 2,
        options: ['Open', 'Closed'],
        validation: { type: 'PICKLIST' },
      })
    })

    it('defaults the added column type to TEXT_NUMBER', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/columns`).reply({ message: 'SUCCESS', result: {} })

      await service.addColumn(SHEET_ID, 'Notes')

      expect(mock.history[0].body).toEqual({ title: 'Notes', type: 'TEXT_NUMBER' })
    })

    it('updates a column without defaulting the type', async () => {
      mock.onPut(`${ BASE }/sheets/${ SHEET_ID }/columns/${ COLUMN_ID }`).reply({ message: 'SUCCESS', result: {} })

      await service.updateColumn(SHEET_ID, COLUMN_ID, 'Renamed')

      expect(mock.history[0].body).toEqual({ title: 'Renamed' })
    })

    it('deletes a column', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }/columns/${ COLUMN_ID }`).reply({ message: 'SUCCESS', result: {} })

      await service.deleteColumn(SHEET_ID, COLUMN_ID)

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Attachments ──

  describe('attachments', () => {
    it('lists attachments', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/attachments`).reply({ data: [] })

      await service.listAttachments(SHEET_ID, 1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 10 })
    })

    it('attaches a URL to a row', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }/attachments`).reply({ message: 'SUCCESS', result: { id: 1 } })

      await service.attachUrlToRow(SHEET_ID, ROW_ID, 'https://example.com/doc', 'Doc')

      expect(mock.history[0].body).toEqual({
        attachmentType: 'LINK',
        url: 'https://example.com/doc',
        name: 'Doc',
      })
    })

    it('downloads a file and uploads it as a row attachment', async () => {
      const fileUrl = 'https://cdn.example.com/files/report%20final.pdf?token=1'

      mock.onGet(fileUrl).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }/attachments`).reply({ message: 'SUCCESS', result: { id: 2 } })

      await service.attachFileToRow(SHEET_ID, ROW_ID, fileUrl)

      expect(mock.history[0].url).toBe(fileUrl)
      expect(mock.history[0].encoding).toBeNull()

      expect(mock.history[1].headers).toMatchObject({
        ...AUTH,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ encodeURIComponent('report final.pdf') }"`,
        'Content-Length': 9,
      })

      expect(Buffer.isBuffer(mock.history[1].body)).toBe(true)
    })

    it('uses the supplied file name and content type', async () => {
      const fileUrl = 'https://cdn.example.com/a.bin'

      mock.onGet(fileUrl).reply('raw-bytes')
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }/attachments`).reply({ message: 'SUCCESS', result: {} })

      await service.attachFileToRow(SHEET_ID, ROW_ID, fileUrl, 'custom.txt', 'text/plain')

      expect(mock.history[1].headers).toMatchObject({
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="custom.txt"',
      })
    })

    it('gets attachment metadata', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/attachments/55`).reply({ id: 55, name: 'a.pdf' })

      await expect(service.getAttachment(SHEET_ID, 55)).resolves.toEqual({ id: 55, name: 'a.pdf' })
    })

    it('downloads an attachment and stores it in file storage', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.example.com/a.pdf' })

      service.flowrunner = { Files: { uploadFile } }

      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/attachments/55`).reply({
        id: 55,
        name: 'a.pdf',
        url: 'https://presigned.example.com/a.pdf',
        mimeType: 'application/pdf',
        attachmentType: 'FILE',
      })

      mock.onGet('https://presigned.example.com/a.pdf').reply(Buffer.from('bytes'))

      const result = await service.downloadAttachment(SHEET_ID, 55)

      expect(mock.history[1].encoding).toBeNull()

      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('bytes'), {
        filename: 'a.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        fileURL: 'https://files.example.com/a.pdf',
        filename: 'a.pdf',
        sizeBytes: 5,
        mimeType: 'application/pdf',
        attachmentType: 'FILE',
      })

      delete service.flowrunner
    })

    it('throws when the attachment has no downloadable URL', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/attachments/56`).reply({ id: 56, attachmentType: 'LINK' })

      await expect(service.downloadAttachment(SHEET_ID, 56)).rejects.toThrow(
        'Smartsheet API error: attachment 56 has no downloadable URL (attachmentType LINK). Only FILE attachments can be downloaded.'
      )
    })

    it('deletes an attachment', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }/attachments/55`).reply({ message: 'SUCCESS', result: {} })

      await service.deleteAttachment(SHEET_ID, 55)

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Discussions ──

  describe('discussions', () => {
    it('lists discussions and includes comments only when requested', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/discussions`).reply({ data: [] })

      await service.listDiscussions(SHEET_ID, true, 1, 10)

      expect(mock.history[0].query).toEqual({ include: 'comments', page: 1, pageSize: 10 })

      await service.listDiscussions(SHEET_ID, false)

      expect(mock.history[1].query).toEqual({})
    })

    it('creates a row discussion', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/rows/${ ROW_ID }/discussions`).reply({ message: 'SUCCESS', result: { id: 1 } })

      await service.createRowDiscussion(SHEET_ID, ROW_ID, 'Hello')

      expect(mock.history[0].body).toEqual({ comment: { text: 'Hello' } })
    })

    it('creates a sheet discussion', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/discussions`).reply({ message: 'SUCCESS', result: { id: 2 } })

      await service.createSheetDiscussion(SHEET_ID, 'Sheet level')

      expect(mock.history[0].body).toEqual({ comment: { text: 'Sheet level' } })
    })

    it('adds a comment to a discussion', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/discussions/9/comments`).reply({ message: 'SUCCESS', result: { id: 3 } })

      await service.addComment(SHEET_ID, 9, 'Reply')

      expect(mock.history[0].body).toEqual({ text: 'Reply' })
    })

    it('deletes a discussion', async () => {
      mock.onDelete(`${ BASE }/sheets/${ SHEET_ID }/discussions/9`).reply({ message: 'SUCCESS', result: {} })

      await service.deleteDiscussion(SHEET_ID, 9)

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Workspaces & folders ──

  describe('workspaces and folders', () => {
    it('lists workspaces', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply({ data: [] })

      await service.listWorkspaces(1, 25)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 25 })
    })

    it('gets a workspace and passes loadAll only when true', async () => {
      mock.onGet(`${ BASE }/workspaces/42`).reply({ id: 42 })

      await service.getWorkspace(42, true)

      expect(mock.history[0].query).toEqual({ loadAll: true })

      await service.getWorkspace(42, false)

      expect(mock.history[1].query).toEqual({})
    })

    it('creates a workspace', async () => {
      mock.onPost(`${ BASE }/workspaces`).reply({ message: 'SUCCESS', result: { id: 43 } })

      await service.createWorkspace('Team')

      expect(mock.history[0].body).toEqual({ name: 'Team' })
    })

    it('lists home folders', async () => {
      mock.onGet(`${ BASE }/home/folders`).reply({ data: [] })

      await service.listHomeFolders(2, 5)

      expect(mock.history[0].query).toEqual({ page: 2, pageSize: 5 })
    })

    it('gets a folder', async () => {
      mock.onGet(`${ BASE }/folders/7`).reply({ id: 7 })

      await expect(service.getFolder(7)).resolves.toEqual({ id: 7 })
    })

    it('creates a folder in a workspace', async () => {
      mock.onPost(`${ BASE }/workspaces/42/folders`).reply({ message: 'SUCCESS', result: { id: 8 } })

      await service.createFolderInWorkspace(42, 'Docs')

      expect(mock.history[0].body).toEqual({ name: 'Docs' })
    })
  })

  // ── Reports ──

  describe('reports', () => {
    it('lists reports', async () => {
      mock.onGet(`${ BASE }/reports`).reply({ data: [] })

      await service.listReports(1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 10 })
    })

    it('gets a report', async () => {
      mock.onGet(`${ BASE }/reports/11`).reply({ id: 11 })

      await service.getReport(11, 1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 10 })
    })
  })

  // ── Search ──

  describe('search', () => {
    it('searches within a sheet', async () => {
      mock.onGet(`${ BASE }/search/sheets/${ SHEET_ID }`).reply({ results: [] })

      await service.searchSheet(SHEET_ID, 'urgent')

      expect(mock.history[0].query).toEqual({ query: 'urgent' })
    })

    it('searches everything with mapped scopes', async () => {
      mock.onGet(`${ BASE }/search`).reply({ results: [] })

      await service.searchEverything('budget', ['Sheet Names', 'Cell Data'])

      expect(mock.history[0].query).toEqual({ query: 'budget', scopes: 'sheetNames,cellData' })
    })

    it('omits scopes when none are given', async () => {
      mock.onGet(`${ BASE }/search`).reply({ results: [] })

      await service.searchEverything('budget')

      expect(mock.history[0].query).toEqual({ query: 'budget' })
    })
  })

  // ── Users & contacts ──

  describe('users and contacts', () => {
    it('gets the current user', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 1, email: 'me@example.com' })

      await expect(service.getCurrentUser()).resolves.toEqual({ id: 1, email: 'me@example.com' })
    })

    it('lists users filtered by email', async () => {
      mock.onGet(`${ BASE }/users`).reply({ data: [] })

      await service.listUsers('a@b.com', 1, 10)

      expect(mock.history[0].query).toEqual({ email: 'a@b.com', page: 1, pageSize: 10 })
    })

    it('lists contacts', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [] })

      await service.listContacts(1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 10 })
    })
  })

  // ── Update requests ──

  describe('createUpdateRequest', () => {
    it('builds the recipient list and coerces ids', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/updaterequests`).reply({ message: 'SUCCESS', result: { id: 1 } })

      await service.createUpdateRequest(
        SHEET_ID, ['1', '2'], ['a@b.com'], 'Subject', 'Message', [String(COLUMN_ID)], true, false
      )

      expect(mock.history[0].body).toEqual({
        rowIds: [1, 2],
        columnIds: [COLUMN_ID],
        includeAttachments: true,
        includeDiscussions: false,
        sendTo: [{ email: 'a@b.com' }],
        subject: 'Subject',
        message: 'Message',
      })
    })

    it('sends an empty recipient list when sendTo is omitted', async () => {
      mock.onPost(`${ BASE }/sheets/${ SHEET_ID }/updaterequests`).reply({ message: 'SUCCESS', result: {} })

      await service.createUpdateRequest(SHEET_ID, [1])

      expect(mock.history[0].body).toEqual({ rowIds: [1], sendTo: [] })
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    it('lists webhooks', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ data: [] })

      await service.listWebhooks(1, 10)

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 10 })
    })

    it('creates a sheet-scoped webhook', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ message: 'SUCCESS', result: { id: 3 } })

      await service.createWebhook('hook', 'https://cb.example.com', String(SHEET_ID))

      expect(mock.history[0].body).toEqual({
        name: 'hook',
        callbackUrl: 'https://cb.example.com',
        scope: 'sheet',
        scopeObjectId: SHEET_ID,
        events: ['*.*'],
        version: 1,
      })
    })

    it('enables and disables a webhook', async () => {
      mock.onPut(`${ BASE }/webhooks/3`).reply({ message: 'SUCCESS', result: { id: 3 } })

      await service.setWebhookStatus(3)

      expect(mock.history[0].body).toEqual({ enabled: true })

      await service.setWebhookStatus(3, false)

      expect(mock.history[1].body).toEqual({ enabled: false })
    })

    it('deletes a webhook', async () => {
      mock.onDelete(`${ BASE }/webhooks/3`).reply({ message: 'SUCCESS', result: {} })

      await service.deleteWebhook(3)

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Dictionaries ──

  describe('getSheetsDictionary', () => {
    it('maps sheets to dictionary items and computes the next cursor', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({
        data: [
          { id: 1, name: 'Alpha', modifiedAt: '2024-01-01T00:00:00Z' },
          { id: 2, name: 'Beta' },
        ],
        pageNumber: 1,
        totalPages: 3,
      })

      const result = await service.getSheetsDictionary({})

      expect(mock.history[0].query).toEqual({ page: 1, pageSize: 100 })

      expect(result).toEqual({
        items: [
          { label: 'Alpha', value: '1', note: 'Modified 2024-01-01T00:00:00Z' },
          { label: 'Beta', value: '2', note: undefined },
        ],
        cursor: '2',
      })
    })

    it('filters case-insensitively and uses the cursor as the page number', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({
        data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
        pageNumber: 2,
        totalPages: 2,
      })

      const result = await service.getSheetsDictionary({ search: 'BET', cursor: '2' })

      expect(mock.history[0].query).toEqual({ page: 2, pageSize: 100 })
      expect(result.items).toEqual([{ label: 'Beta', value: '2', note: undefined }])
      expect(result.cursor).toBeNull()
    })

    it('handles a null payload and missing data', async () => {
      mock.onGet(`${ BASE }/sheets`).reply({})

      await expect(service.getSheetsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without a sheet criteria', async () => {
      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getColumnsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps columns with a type note', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/columns`).reply({
        data: [
          { id: 10, title: 'Task', type: 'TEXT_NUMBER', primary: true },
          { id: 11, title: 'Status', type: 'PICKLIST' },
        ],
        pageNumber: 1,
        totalPages: 1,
      })

      const result = await service.getColumnsDictionary({ criteria: { sheetId: SHEET_ID }, search: 'stat' })

      expect(result).toEqual({
        items: [{ label: 'Status', value: '11', note: 'PICKLIST' }],
        cursor: null,
      })
    })

    it('marks the primary column in the note', async () => {
      mock.onGet(`${ BASE }/sheets/${ SHEET_ID }/columns`).reply({
        data: [{ id: 10, title: 'Task', type: 'TEXT_NUMBER', primary: true }],
        pageNumber: 1,
        totalPages: 2,
      })

      const result = await service.getColumnsDictionary({ criteria: { sheetId: SHEET_ID } })

      expect(result.items[0].note).toBe('TEXT_NUMBER (primary)')
      expect(result.cursor).toBe('2')
    })
  })

  describe('getWorkspacesDictionary', () => {
    it('maps workspaces with the access level note', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply({
        data: [{ id: 20, name: 'Team', accessLevel: 'OWNER' }, { id: 21, name: 'Other' }],
        pageNumber: 1,
        totalPages: 1,
      })

      const result = await service.getWorkspacesDictionary({ search: 'team' })

      expect(result).toEqual({ items: [{ label: 'Team', value: '20', note: 'OWNER' }], cursor: null })
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply({})

      await expect(service.getWorkspacesDictionary()).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getReportsDictionary', () => {
    it('maps reports with the access level note', async () => {
      mock.onGet(`${ BASE }/reports`).reply({
        data: [{ id: 30, name: 'Weekly', accessLevel: 'VIEWER' }],
        pageNumber: 1,
        totalPages: 1,
      })

      await expect(service.getReportsDictionary({})).resolves.toEqual({
        items: [{ label: 'Weekly', value: '30', note: 'VIEWER' }],
        cursor: null,
      })
    })

    it('filters reports by search term', async () => {
      mock.onGet(`${ BASE }/reports`).reply({
        data: [{ id: 30, name: 'Weekly' }, { id: 31, name: 'Monthly' }],
        pageNumber: 1,
        totalPages: 1,
      })

      const result = await service.getReportsDictionary({ search: 'month' })

      expect(result.items).toEqual([{ label: 'Monthly', value: '31', note: undefined }])
    })
  })
})
