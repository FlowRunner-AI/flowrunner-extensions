'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const BASE = 'https://coda.io/apis/v1'
const AUTH = `Bearer ${ API_TOKEN }`

describe('Coda Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Bearer auth and JSON content-type headers', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [] })

      await service.listDocs()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH,
        'Content-Type': 'application/json',
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Docs
  // ═══════════════════════════════════════════════════════════════════════

  describe('listDocs', () => {
    it('sends GET with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [], href: `${ BASE }/docs` })

      const result = await service.listDocs()

      expect(result).toEqual({ items: [], href: `${ BASE }/docs` })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/docs`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all params when provided', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [] })

      await service.listDocs('tracker', true, 10, 'tok-1')

      expect(mock.history[0].query).toEqual({
        query: 'tracker',
        isOwner: true,
        limit: 10,
        pageToken: 'tok-1',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid token' },
      })

      await expect(service.listDocs()).rejects.toThrow('Coda API error: Invalid token')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${ BASE }/docs`).replyWithError({ message: 'Network down' })

      await expect(service.listDocs()).rejects.toThrow('Coda API error: Network down')
    })
  })

  describe('getDoc', () => {
    it('sends GET to the encoded doc endpoint', async () => {
      mock.onGet(`${ BASE }/docs/AbC%20DeF`).reply({ id: 'AbC DeF', name: 'Project Tracker' })

      const result = await service.getDoc('AbC DeF')

      expect(result).toEqual({ id: 'AbC DeF', name: 'Project Tracker' })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/AbC%20DeF`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/x`).replyWithError({ message: 'Not found' })

      await expect(service.getDoc('x')).rejects.toThrow('Coda API error: Not found')
    })
  })

  describe('createDoc', () => {
    it('sends POST with title only', async () => {
      mock.onPost(`${ BASE }/docs`).reply({ id: 'NewDocId', name: 'Q3 Planning' })

      const result = await service.createDoc('Q3 Planning')

      expect(result).toEqual({ id: 'NewDocId', name: 'Q3 Planning' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'Q3 Planning' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/docs`).reply({ id: 'NewDocId' })

      await service.createDoc('Copy', 'SrcDoc', 'fl-1', 'America/Los_Angeles')

      expect(mock.history[0].body).toEqual({
        title: 'Copy',
        sourceDoc: 'SrcDoc',
        folderId: 'fl-1',
        timezone: 'America/Los_Angeles',
      })
    })

    it('omits empty optional fields via clean', async () => {
      mock.onPost(`${ BASE }/docs`).reply({ id: 'NewDocId' })

      await service.createDoc('Title', '', undefined, null)

      expect(mock.history[0].body).toEqual({ title: 'Title' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/docs`).replyWithError({ message: 'Bad request' })

      await expect(service.createDoc('Title')).rejects.toThrow('Coda API error: Bad request')
    })
  })

  describe('deleteDoc', () => {
    it('sends DELETE and returns a deleted marker', async () => {
      mock.onDelete(`${ BASE }/docs/AbCDeFGH`).reply(undefined)

      const result = await service.deleteDoc('AbCDeFGH')

      expect(result).toEqual({ deleted: true, docId: 'AbCDeFGH' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/AbCDeFGH`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/docs/x`).replyWithError({ message: 'Forbidden' })

      await expect(service.deleteDoc('x')).rejects.toThrow('Coda API error: Forbidden')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Tables
  // ═══════════════════════════════════════════════════════════════════════

  describe('listTables', () => {
    it('defaults tableTypes to undefined (stripped) with no filter', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.listTables('D1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps Views to view and includes pagination', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.listTables('D1', 'Views', 5, 'tok-2')

      expect(mock.history[0].query).toEqual({
        tableTypes: 'view',
        limit: 5,
        pageToken: 'tok-2',
      })
    })

    it('maps Tables to table', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.listTables('D1', 'Tables')

      expect(mock.history[0].query).toEqual({ tableTypes: 'table' })
    })

    it('treats All as no tableTypes filter', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.listTables('D1', 'All')

      expect(mock.history[0].query).toEqual({})
    })

    it('passes through an unknown raw table type', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.listTables('D1', 'view')

      expect(mock.history[0].query).toEqual({ tableTypes: 'view' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).replyWithError({ message: 'Boom' })

      await expect(service.listTables('D1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getTable', () => {
    it('sends GET to the table endpoint', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/grid-1`).reply({ id: 'grid-1', name: 'Tasks' })

      const result = await service.getTable('D1', 'grid-1')

      expect(result).toEqual({ id: 'grid-1', name: 'Tasks' })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/grid-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/grid-1`).replyWithError({ message: 'Boom' })

      await expect(service.getTable('D1', 'grid-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Rows
  // ═══════════════════════════════════════════════════════════════════════

  describe('listRows', () => {
    it('defaults useColumnNames to true and normalizes rows', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows`).reply({
        href: `${ BASE }/docs/D1/tables/T1/rows`,
        nextPageToken: null,
        items: [
          {
            id: 'i-1',
            name: 'Draft',
            index: 1,
            href: 'h',
            browserLink: 'b',
            createdAt: 'c',
            updatedAt: 'u',
            values: { Name: 'Draft', Status: 'In Progress' },
            extraField: 'dropped',
          },
        ],
      })

      const result = await service.listRows('D1', 'T1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows`)
      expect(mock.history[0].query).toEqual({
        useColumnNames: true,
        valueFormat: 'simpleWithArrays',
      })
      expect(result.nextPageToken).toBeNull()
      expect(result.items).toEqual([
        {
          id: 'i-1',
          name: 'Draft',
          index: 1,
          href: 'h',
          browserLink: 'b',
          createdAt: 'c',
          updatedAt: 'u',
          values: { Name: 'Draft', Status: 'In Progress' },
        },
      ])
    })

    it('includes all query params and respects useColumnNames=false', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows`).reply({ items: [] })

      await service.listRows('D1', 'T1', '"Status":"Done"', false, true, 5, 'tok-3')

      expect(mock.history[0].query).toEqual({
        query: '"Status":"Done"',
        useColumnNames: false,
        visibleOnly: true,
        limit: 5,
        pageToken: 'tok-3',
        valueFormat: 'simpleWithArrays',
      })
    })

    it('returns empty items array when response has no items', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows`).reply({ href: 'h' })

      const result = await service.listRows('D1', 'T1')

      expect(result.items).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows`).replyWithError({ message: 'Boom' })

      await expect(service.listRows('D1', 'T1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getRow', () => {
    it('defaults useColumnNames to true and normalizes the row', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows/i-1`).reply({
        id: 'i-1',
        name: 'Draft',
        index: 1,
        href: 'h',
        browserLink: 'b',
        createdAt: 'c',
        updatedAt: 'u',
        values: { Name: 'Draft' },
      })

      const result = await service.getRow('D1', 'T1', 'i-1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows/i-1`)
      expect(mock.history[0].query).toEqual({
        useColumnNames: true,
        valueFormat: 'simpleWithArrays',
      })
      expect(result).toEqual({
        id: 'i-1',
        name: 'Draft',
        index: 1,
        href: 'h',
        browserLink: 'b',
        createdAt: 'c',
        updatedAt: 'u',
        values: { Name: 'Draft' },
      })
    })

    it('passes useColumnNames=false through', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows/i-1`).reply({ id: 'i-1', values: {} })

      await service.getRow('D1', 'T1', 'i-1', false)

      expect(mock.history[0].query).toMatchObject({ useColumnNames: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/rows/i-1`).replyWithError({ message: 'Boom' })

      await expect(service.getRow('D1', 'T1', 'i-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('insertRows', () => {
    it('converts a single row object into cells', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows`).reply({ requestId: 'r-1', addedRowIds: ['i-new'] })

      const result = await service.insertRows('D1', 'T1', { Name: 'New task', Status: 'To Do' })

      expect(result).toEqual({ requestId: 'r-1', addedRowIds: ['i-new'] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows`)
      expect(mock.history[0].body).toEqual({
        rows: [
          {
            cells: [
              { column: 'Name', value: 'New task' },
              { column: 'Status', value: 'To Do' },
            ],
          },
        ],
      })
    })

    it('converts an array of rows and includes keyColumns for upsert', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows`).reply({ requestId: 'r-2', addedRowIds: [] })

      await service.insertRows(
        'D1',
        'T1',
        [{ Name: 'A' }, { Name: 'B' }],
        ['Name']
      )

      expect(mock.history[0].body).toEqual({
        rows: [
          { cells: [{ column: 'Name', value: 'A' }] },
          { cells: [{ column: 'Name', value: 'B' }] },
        ],
        keyColumns: ['Name'],
      })
    })

    it('omits keyColumns when the array is empty', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows`).reply({ requestId: 'r-3', addedRowIds: [] })

      await service.insertRows('D1', 'T1', [{ Name: 'A' }], [])

      expect(mock.history[0].body).toEqual({
        rows: [{ cells: [{ column: 'Name', value: 'A' }] }],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows`).replyWithError({ message: 'Boom' })

      await expect(service.insertRows('D1', 'T1', [{ Name: 'A' }])).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('updateRow', () => {
    it('sends PUT with a single-row cells payload', async () => {
      mock.onPut(`${ BASE }/docs/D1/tables/T1/rows/i-1`).reply({ requestId: 'r-1', id: 'i-1' })

      const result = await service.updateRow('D1', 'T1', 'i-1', { Status: 'Done' })

      expect(result).toEqual({ requestId: 'r-1', id: 'i-1' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows/i-1`)
      expect(mock.history[0].body).toEqual({
        row: { cells: [{ column: 'Status', value: 'Done' }] },
      })
    })

    it('sends empty cells when values is not an object', async () => {
      mock.onPut(`${ BASE }/docs/D1/tables/T1/rows/i-1`).reply({ requestId: 'r-2', id: 'i-1' })

      await service.updateRow('D1', 'T1', 'i-1', null)

      expect(mock.history[0].body).toEqual({ row: { cells: [] } })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/docs/D1/tables/T1/rows/i-1`).replyWithError({ message: 'Boom' })

      await expect(service.updateRow('D1', 'T1', 'i-1', { Status: 'Done' })).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('deleteRow', () => {
    it('sends DELETE to the row endpoint', async () => {
      mock.onDelete(`${ BASE }/docs/D1/tables/T1/rows/i-1`).reply({ requestId: 'r-1', id: 'i-1' })

      const result = await service.deleteRow('D1', 'T1', 'i-1')

      expect(result).toEqual({ requestId: 'r-1', id: 'i-1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows/i-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/docs/D1/tables/T1/rows/i-1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteRow('D1', 'T1', 'i-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('deleteRows', () => {
    it('sends DELETE with a rowIds body array', async () => {
      mock.onDelete(`${ BASE }/docs/D1/tables/T1/rows`).reply({ requestId: 'r-1', rowIds: ['i-1', 'i-2'] })

      const result = await service.deleteRows('D1', 'T1', ['i-1', 'i-2'])

      expect(result).toEqual({ requestId: 'r-1', rowIds: ['i-1', 'i-2'] })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows`)
      expect(mock.history[0].body).toEqual({ rowIds: ['i-1', 'i-2'] })
    })

    it('wraps a single rowId string into an array', async () => {
      mock.onDelete(`${ BASE }/docs/D1/tables/T1/rows`).reply({ requestId: 'r-2', rowIds: ['i-1'] })

      await service.deleteRows('D1', 'T1', 'i-1')

      expect(mock.history[0].body).toEqual({ rowIds: ['i-1'] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/docs/D1/tables/T1/rows`).replyWithError({ message: 'Boom' })

      await expect(service.deleteRows('D1', 'T1', ['i-1'])).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Columns
  // ═══════════════════════════════════════════════════════════════════════

  describe('listColumns', () => {
    it('sends GET with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).reply({ items: [] })

      await service.listColumns('D1', 'T1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/columns`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes visibleOnly and pagination when provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).reply({ items: [] })

      await service.listColumns('D1', 'T1', true, 25, 'tok-4')

      expect(mock.history[0].query).toEqual({
        visibleOnly: true,
        limit: 25,
        pageToken: 'tok-4',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).replyWithError({ message: 'Boom' })

      await expect(service.listColumns('D1', 'T1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getColumn', () => {
    it('sends GET to the column endpoint', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns/c-status`).reply({ id: 'c-status', name: 'Status' })

      const result = await service.getColumn('D1', 'T1', 'c-status')

      expect(result).toEqual({ id: 'c-status', name: 'Status' })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/columns/c-status`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns/c-status`).replyWithError({ message: 'Boom' })

      await expect(service.getColumn('D1', 'T1', 'c-status')).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Formulas & Controls
  // ═══════════════════════════════════════════════════════════════════════

  describe('listFormulas', () => {
    it('sends GET with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/formulas`).reply({ items: [] })

      await service.listFormulas('D1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/formulas`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pagination when provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/formulas`).reply({ items: [] })

      await service.listFormulas('D1', 10, 'tok-5')

      expect(mock.history[0].query).toEqual({ limit: 10, pageToken: 'tok-5' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/formulas`).replyWithError({ message: 'Boom' })

      await expect(service.listFormulas('D1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getFormula', () => {
    it('sends GET to the formula endpoint', async () => {
      mock.onGet(`${ BASE }/docs/D1/formulas/f-1`).reply({ id: 'f-1', value: 124500 })

      const result = await service.getFormula('D1', 'f-1')

      expect(result).toEqual({ id: 'f-1', value: 124500 })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/formulas/f-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/formulas/f-1`).replyWithError({ message: 'Boom' })

      await expect(service.getFormula('D1', 'f-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('listControls', () => {
    it('sends GET with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/controls`).reply({ items: [] })

      await service.listControls('D1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/controls`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pagination when provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/controls`).reply({ items: [] })

      await service.listControls('D1', 5, 'tok-6')

      expect(mock.history[0].query).toEqual({ limit: 5, pageToken: 'tok-6' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/controls`).replyWithError({ message: 'Boom' })

      await expect(service.listControls('D1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getControl', () => {
    it('sends GET to the control endpoint', async () => {
      mock.onGet(`${ BASE }/docs/D1/controls/ctrl-1`).reply({ id: 'ctrl-1', value: 75 })

      const result = await service.getControl('D1', 'ctrl-1')

      expect(result).toEqual({ id: 'ctrl-1', value: 75 })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/controls/ctrl-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/controls/ctrl-1`).replyWithError({ message: 'Boom' })

      await expect(service.getControl('D1', 'ctrl-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Buttons
  // ═══════════════════════════════════════════════════════════════════════

  describe('pushButton', () => {
    it('sends POST to the button endpoint with no body', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows/i-1/buttons/c-btn`).reply({ requestId: 'r-1' })

      const result = await service.pushButton('D1', 'T1', 'i-1', 'c-btn')

      expect(result).toEqual({ requestId: 'r-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/rows/i-1/buttons/c-btn`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/docs/D1/tables/T1/rows/i-1/buttons/c-btn`).replyWithError({ message: 'Boom' })

      await expect(service.pushButton('D1', 'T1', 'i-1', 'c-btn')).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Pages
  // ═══════════════════════════════════════════════════════════════════════

  describe('listPages', () => {
    it('sends GET with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/pages`).reply({ items: [] })

      await service.listPages('D1')

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/pages`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pagination when provided', async () => {
      mock.onGet(`${ BASE }/docs/D1/pages`).reply({ items: [] })

      await service.listPages('D1', 10, 'tok-7')

      expect(mock.history[0].query).toEqual({ limit: 10, pageToken: 'tok-7' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/pages`).replyWithError({ message: 'Boom' })

      await expect(service.listPages('D1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getPage', () => {
    it('sends GET to the page endpoint', async () => {
      mock.onGet(`${ BASE }/docs/D1/pages/canvas-1`).reply({ id: 'canvas-1', name: 'Overview' })

      const result = await service.getPage('D1', 'canvas-1')

      expect(result).toEqual({ id: 'canvas-1', name: 'Overview' })
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/pages/canvas-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/pages/canvas-1`).replyWithError({ message: 'Boom' })

      await expect(service.getPage('D1', 'canvas-1')).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('createPage', () => {
    it('sends POST with name only when no content provided', async () => {
      mock.onPost(`${ BASE }/docs/D1/pages`).reply({ requestId: 'r-1', id: 'canvas-new' })

      const result = await service.createPage('D1', 'New Page')

      expect(result).toEqual({ requestId: 'r-1', id: 'canvas-new' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/pages`)
      expect(mock.history[0].body).toEqual({ name: 'New Page' })
    })

    it('includes subtitle and markdown page content by default', async () => {
      mock.onPost(`${ BASE }/docs/D1/pages`).reply({ requestId: 'r-2', id: 'canvas-new' })

      await service.createPage('D1', 'New Page', 'A subtitle', '# Hello')

      expect(mock.history[0].body).toEqual({
        name: 'New Page',
        subtitle: 'A subtitle',
        pageContent: {
          type: 'canvas',
          canvasContent: {
            format: 'markdown',
            content: '# Hello',
          },
        },
      })
    })

    it('maps HTML content format', async () => {
      mock.onPost(`${ BASE }/docs/D1/pages`).reply({ requestId: 'r-3', id: 'canvas-new' })

      await service.createPage('D1', 'New Page', undefined, '<p>Hi</p>', 'HTML')

      expect(mock.history[0].body).toEqual({
        name: 'New Page',
        pageContent: {
          type: 'canvas',
          canvasContent: {
            format: 'html',
            content: '<p>Hi</p>',
          },
        },
      })
    })

    it('passes through an unknown content format value', async () => {
      mock.onPost(`${ BASE }/docs/D1/pages`).reply({ requestId: 'r-4', id: 'canvas-new' })

      await service.createPage('D1', 'New Page', undefined, 'content', 'weird')

      expect(mock.history[0].body.pageContent.canvasContent.format).toBe('weird')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/docs/D1/pages`).replyWithError({ message: 'Boom' })

      await expect(service.createPage('D1', 'New Page')).rejects.toThrow('Coda API error: Boom')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Dictionaries
  // ═══════════════════════════════════════════════════════════════════════

  describe('getDocsDictionary', () => {
    const docsResponse = {
      items: [
        { id: 'D1', name: 'Project Tracker', owner: 'jane@example.com' },
        { id: 'D2', name: 'Roadmap' },
      ],
      nextPageToken: 'tok-next',
    }

    it('maps docs to items and hits the docs endpoint with a limit', async () => {
      mock.onGet(`${ BASE }/docs`).reply(docsResponse)

      const result = await service.getDocsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/docs`)
      expect(mock.history[0].query).toEqual({ limit: 25 })
      expect(result.items).toEqual([
        { label: 'Project Tracker', value: 'D1', note: 'Owned by jane@example.com' },
        { label: 'Roadmap', value: 'D2', note: undefined },
      ])
      expect(result.cursor).toBe('tok-next')
    })

    it('passes search as query and cursor as pageToken', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [] })

      await service.getDocsDictionary({ search: 'track', cursor: 'tok-prev' })

      expect(mock.history[0].query).toEqual({ query: 'track', pageToken: 'tok-prev', limit: 25 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [] })

      const result = await service.getDocsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('omits cursor when nextPageToken is absent', async () => {
      mock.onGet(`${ BASE }/docs`).reply({ items: [{ id: 'D1', name: 'Doc' }] })

      const result = await service.getDocsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs`).replyWithError({ message: 'Boom' })

      await expect(service.getDocsDictionary({})).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getTablesDictionary', () => {
    const tablesResponse = {
      items: [
        { id: 'grid-1', name: 'Tasks', tableType: 'table', rowCount: 42 },
        { id: 'grid-2', name: 'Notes', tableType: 'table' },
      ],
      nextPageToken: null,
    }

    it('returns empty items when no docId in criteria', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('maps tables to items with a type/rows note', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({ criteria: { docId: 'D1' } })

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables`)
      expect(mock.history[0].query).toEqual({ tableTypes: 'table', limit: 25 })
      expect(result.items).toEqual([
        { label: 'Tasks', value: 'grid-1', note: 'table - 42 rows' },
        { label: 'Notes', value: 'grid-2', note: 'table' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search term over the label', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({ search: 'note', criteria: { docId: 'D1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('grid-2')
    })

    it('passes cursor through as pageToken', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [] })

      await service.getTablesDictionary({ cursor: 'tok-p', criteria: { docId: 'D1' } })

      expect(mock.history[0].query).toEqual({ tableTypes: 'table', pageToken: 'tok-p', limit: 25 })
    })

    it('returns a cursor when nextPageToken is present', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).reply({ items: [], nextPageToken: 'tok-more' })

      const result = await service.getTablesDictionary({ criteria: { docId: 'D1' } })

      expect(result.cursor).toBe('tok-more')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables`).replyWithError({ message: 'Boom' })

      await expect(service.getTablesDictionary({ criteria: { docId: 'D1' } })).rejects.toThrow('Coda API error: Boom')
    })
  })

  describe('getColumnsDictionary', () => {
    const columnsResponse = {
      items: [
        { id: 'c-name', name: 'Name', format: { type: 'text' } },
        { id: 'c-status', name: 'Status', format: { type: 'select' } },
      ],
      nextPageToken: null,
    }

    it('returns empty items when docId is missing', async () => {
      const result = await service.getColumnsDictionary({ criteria: { tableId: 'T1' } })

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when tableId is missing', async () => {
      const result = await service.getColumnsDictionary({ criteria: { docId: 'D1' } })

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('maps columns to items with the format type as note', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).reply(columnsResponse)

      const result = await service.getColumnsDictionary({ criteria: { docId: 'D1', tableId: 'T1' } })

      expect(mock.history[0].url).toBe(`${ BASE }/docs/D1/tables/T1/columns`)
      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(result.items).toEqual([
        { label: 'Name', value: 'c-name', note: 'text' },
        { label: 'Status', value: 'c-status', note: 'select' },
      ])
    })

    it('filters columns by search term', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).reply(columnsResponse)

      const result = await service.getColumnsDictionary({
        search: 'status',
        criteria: { docId: 'D1', tableId: 'T1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c-status')
    })

    it('passes cursor through as pageToken', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).reply({ items: [] })

      await service.getColumnsDictionary({ cursor: 'tok-c', criteria: { docId: 'D1', tableId: 'T1' } })

      expect(mock.history[0].query).toEqual({ pageToken: 'tok-c', limit: 50 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/docs/D1/tables/T1/columns`).replyWithError({ message: 'Boom' })

      await expect(
        service.getColumnsDictionary({ criteria: { docId: 'D1', tableId: 'T1' } })
      ).rejects.toThrow('Coda API error: Boom')
    })
  })
})
