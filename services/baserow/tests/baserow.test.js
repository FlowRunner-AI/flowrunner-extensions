'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-database-token'
const JWT_TOKEN = 'test-jwt-token'
// Use a self-hosted base URL (with a trailing slash) to prove the service
// honours the configured baseUrl and strips trailing slashes consistently.
const BASE_URL = 'https://baserow.example.com/'
const BASE = 'https://baserow.example.com/api'

// The service registers itself at module top-level via addService(); requiring
// it a second time hits Jest's module registry and never re-registers. Using
// isolateModules gives a fresh evaluation so a new sandbox picks up a freshly
// registered service instance.
function requireServiceFresh() {
  jest.isolateModules(() => {
    require('../src/index.js')
  })
}

describe('Baserow Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, apiToken: API_TOKEN, jwtToken: JWT_TOKEN })
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
          name: 'baseUrl',
          displayName: 'Base URL',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: 'https://api.baserow.io',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'Database Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'jwtToken',
          displayName: 'JWT Access Token',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('strips trailing slashes from the configured base URL and appends /api', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([])

      await service.listDatabases()

      expect(mock.history[0].url).toBe(`${ BASE }/applications/`)
    })

    it('sends the JWT Authorization header on structure endpoints', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([])

      await service.listDatabases()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `JWT ${ JWT_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('sends the Token Authorization header on row-data endpoints', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).reply({ count: 0, results: [] })

      await service.listRows('678')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionaries ──

  describe('getDatabasesDictionary', () => {
    it('lists databases (filtered to type "database") as items with JWT auth', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([
        { id: 123, name: 'CRM', type: 'database', workspace: { id: 45 } },
        { id: 200, name: 'Not a DB', type: 'other', workspace: { id: 45 } },
      ])

      const result = await service.getDatabasesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/applications/`)
      expect(mock.history[0].headers.Authorization).toBe(`JWT ${ JWT_TOKEN }`)
      expect(result.items).toEqual([
        { label: 'CRM', value: '123', note: 'Workspace: 45' },
      ])
    })

    it('falls back to group id in the note when workspace is absent', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([
        { id: 5, name: 'Legacy', type: 'database', group: { id: 9 } },
      ])

      const result = await service.getDatabasesDictionary({})

      expect(result.items[0].note).toBe('Workspace: 9')
    })

    it('filters databases by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([
        { id: 123, name: 'CRM', type: 'database', workspace: { id: 45 } },
        { id: 124, name: 'Inventory', type: 'database', workspace: { id: 45 } },
      ])

      const result = await service.getDatabasesDictionary({ search: 'crm' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('123')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([])

      const result = await service.getDatabasesDictionary(null)

      expect(result.items).toEqual([])
    })

    it('uses [empty] label when a database has no name', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([
        { id: 7, type: 'database', workspace: { id: 1 } },
      ])

      const result = await service.getDatabasesDictionary({})

      expect(result.items[0].label).toBe('[empty]')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getDatabasesDictionary({})).rejects.toThrow('Baserow API error')
    })
  })

  describe('getTablesDictionary', () => {
    it('lists tables for a database as items', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).reply([
        { id: 678, name: 'Contacts' },
        { id: 679, name: 'Companies' },
      ])

      const result = await service.getTablesDictionary({ criteria: { databaseId: '123' } })

      expect(mock.history[0].url).toBe(`${ BASE }/database/tables/database/123/`)
      expect(mock.history[0].headers.Authorization).toBe(`JWT ${ JWT_TOKEN }`)
      expect(result.items).toEqual([
        { label: 'Contacts', value: '678', note: 'ID: 678' },
        { label: 'Companies', value: '679', note: 'ID: 679' },
      ])
    })

    it('filters tables by search term', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).reply([
        { id: 678, name: 'Contacts' },
        { id: 679, name: 'Companies' },
      ])

      const result = await service.getTablesDictionary({
        search: 'compan',
        criteria: { databaseId: '123' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('679')
    })

    it('handles a null/empty API response', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).reply(null)

      const result = await service.getTablesDictionary({ criteria: { databaseId: '123' } })

      expect(result.items).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).replyWithError({ message: 'Boom' })

      await expect(
        service.getTablesDictionary({ criteria: { databaseId: '123' } })
      ).rejects.toThrow('Baserow API error')
    })
  })

  describe('getFieldsDictionary', () => {
    it('lists fields for a table using the field name as the value', async () => {
      mock.onGet(`${ BASE }/database/fields/table/678/`).reply([
        { id: 999, name: 'Name', type: 'text' },
        { id: 1000, name: 'Status', type: 'single_select' },
      ])

      const result = await service.getFieldsDictionary({ criteria: { tableId: '678' } })

      expect(mock.history[0].url).toBe(`${ BASE }/database/fields/table/678/`)
      expect(result.items).toEqual([
        { label: 'Name', value: 'Name', note: 'Type: text (id 999)' },
        { label: 'Status', value: 'Status', note: 'Type: single_select (id 1000)' },
      ])
    })

    it('filters fields by search term', async () => {
      mock.onGet(`${ BASE }/database/fields/table/678/`).reply([
        { id: 999, name: 'Name', type: 'text' },
        { id: 1000, name: 'Status', type: 'single_select' },
      ])

      const result = await service.getFieldsDictionary({
        search: 'status',
        criteria: { tableId: '678' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Status')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/fields/table/678/`).replyWithError({ message: 'Boom' })

      await expect(
        service.getFieldsDictionary({ criteria: { tableId: '678' } })
      ).rejects.toThrow('Baserow API error')
    })
  })

  // ── Databases ──

  describe('listDatabases', () => {
    it('returns only "database" type applications', async () => {
      mock.onGet(`${ BASE }/applications/`).reply([
        { id: 123, name: 'CRM', type: 'database' },
        { id: 200, name: 'App', type: 'other' },
      ])

      const result = await service.listDatabases()

      expect(result).toEqual([{ id: 123, name: 'CRM', type: 'database' }])
    })

    it('handles a null API response', async () => {
      mock.onGet(`${ BASE }/applications/`).reply(null)

      const result = await service.listDatabases()

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/applications/`).replyWithError({ message: 'Boom' })

      await expect(service.listDatabases()).rejects.toThrow('Baserow API error')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('lists tables for a database with JWT auth', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).reply([{ id: 678, name: 'Contacts' }])

      const result = await service.listTables('123')

      expect(result).toEqual([{ id: 678, name: 'Contacts' }])
      expect(mock.history[0].url).toBe(`${ BASE }/database/tables/database/123/`)
      expect(mock.history[0].headers.Authorization).toBe(`JWT ${ JWT_TOKEN }`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/tables/database/123/`).replyWithError({ message: 'Boom' })

      await expect(service.listTables('123')).rejects.toThrow('Baserow API error')
    })
  })

  describe('getTable', () => {
    it('fetches a single table by id', async () => {
      mock.onGet(`${ BASE }/database/tables/678/`).reply({ id: 678, name: 'Contacts' })

      const result = await service.getTable('678')

      expect(result).toEqual({ id: 678, name: 'Contacts' })
      expect(mock.history[0].url).toBe(`${ BASE }/database/tables/678/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/tables/678/`).replyWithError({ message: 'Boom' })

      await expect(service.getTable('678')).rejects.toThrow('Baserow API error')
    })
  })

  describe('createTable', () => {
    it('creates a table with only a name when no data is supplied', async () => {
      mock.onPost(`${ BASE }/database/tables/database/123/`).reply({ id: 678, name: 'Contacts' })

      const result = await service.createTable('123', 'Contacts')

      expect(result).toEqual({ id: 678, name: 'Contacts' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers.Authorization).toBe(`JWT ${ JWT_TOKEN }`)
      expect(mock.history[0].body).toEqual({ name: 'Contacts' })
    })

    it('includes initial data and first_row_header when a 2D array is supplied', async () => {
      mock.onPost(`${ BASE }/database/tables/database/123/`).reply({ id: 679, name: 'Seeded' })

      const data = [['Name', 'Email'], ['Acme', 'a@x.com']]
      await service.createTable('123', 'Seeded', data)

      expect(mock.history[0].body).toEqual({
        name: 'Seeded',
        data,
        first_row_header: true,
      })
    })

    it('omits data for an empty array', async () => {
      mock.onPost(`${ BASE }/database/tables/database/123/`).reply({ id: 680, name: 'Empty' })

      await service.createTable('123', 'Empty', [])

      expect(mock.history[0].body).toEqual({ name: 'Empty' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/database/tables/database/123/`).replyWithError({ message: 'Boom' })

      await expect(service.createTable('123', 'Contacts')).rejects.toThrow('Baserow API error')
    })
  })

  // ── Fields ──

  describe('listFields', () => {
    it('lists fields for a table with JWT auth', async () => {
      mock.onGet(`${ BASE }/database/fields/table/678/`).reply([{ id: 999, name: 'Name', type: 'text' }])

      const result = await service.listFields('678')

      expect(result).toEqual([{ id: 999, name: 'Name', type: 'text' }])
      expect(mock.history[0].headers.Authorization).toBe(`JWT ${ JWT_TOKEN }`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/fields/table/678/`).replyWithError({ message: 'Boom' })

      await expect(service.listFields('678')).rejects.toThrow('Baserow API error')
    })
  })

  describe('createField', () => {
    it('maps the UI label to the Baserow field type token', async () => {
      mock.onPost(`${ BASE }/database/fields/table/678/`).reply({ id: 1010, name: 'Notes', type: 'long_text' })

      const result = await service.createField('678', 'Notes', 'Long Text')

      expect(result).toEqual({ id: 1010, name: 'Notes', type: 'long_text' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Notes', type: 'long_text' })
    })

    it('resolves each supported field type label', async () => {
      const expectations = {
        'Text': 'text',
        'Long Text': 'long_text',
        'Number': 'number',
        'Boolean': 'boolean',
        'Date': 'date',
        'Single Select': 'single_select',
        'Email': 'email',
        'URL': 'url',
        'Phone': 'phone_number',
      }

      for (const [label, token] of Object.entries(expectations)) {
        mock.reset()
        mock.onPost(`${ BASE }/database/fields/table/678/`).reply({ id: 1, name: label, type: token })

        await service.createField('678', label, label)

        expect(mock.history[0].body.type).toBe(token)
      }
    })

    it('passes an unknown type token through unchanged', async () => {
      mock.onPost(`${ BASE }/database/fields/table/678/`).reply({ id: 1011, name: 'Custom', type: 'rating' })

      await service.createField('678', 'Custom', 'rating')

      expect(mock.history[0].body.type).toBe('rating')
    })

    it('merges type-specific options into the body', async () => {
      mock.onPost(`${ BASE }/database/fields/table/678/`).reply({ id: 1012, name: 'Status', type: 'single_select' })

      await service.createField('678', 'Status', 'Single Select', {
        select_options: [{ value: 'Open', color: 'blue' }],
      })

      expect(mock.history[0].body).toEqual({
        name: 'Status',
        type: 'single_select',
        select_options: [{ value: 'Open', color: 'blue' }],
      })
    })

    it('ignores non-object options', async () => {
      mock.onPost(`${ BASE }/database/fields/table/678/`).reply({ id: 1013, name: 'Amount', type: 'number' })

      await service.createField('678', 'Amount', 'Number', 'not-an-object')

      expect(mock.history[0].body).toEqual({ name: 'Amount', type: 'number' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/database/fields/table/678/`).replyWithError({ message: 'Boom' })

      await expect(service.createField('678', 'Name', 'Text')).rejects.toThrow('Baserow API error')
    })
  })

  // ── Rows ──

  describe('listRows', () => {
    it('uses Token auth and defaults user_field_names to true', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).reply({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, Name: 'Acme' }],
      })

      const result = await service.listRows('678')

      expect(mock.history[0].headers.Authorization).toBe(`Token ${ API_TOKEN }`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
      expect(result).toEqual({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, Name: 'Acme' }],
      })
    })

    it('normalizes a missing results array and next/previous to null', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).reply({ count: 0 })

      const result = await service.listRows('678')

      expect(result).toEqual({ count: 0, next: null, previous: null, results: [] })
    })

    it('includes all pagination, search, ordering and filter query params', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).reply({ count: 0, results: [] })

      await service.listRows(
        '678',
        2,
        50,
        'Acme',
        '-Created,Name',
        { 'filter__Name__contains': 'Acme', 'filter__Age__higher_than': '18' },
        'OR',
        true
      )

      expect(mock.history[0].query).toEqual({
        user_field_names: true,
        page: 2,
        size: 50,
        search: 'Acme',
        order_by: '-Created,Name',
        filter_type: 'OR',
        'filter__Name__contains': 'Acme',
        'filter__Age__higher_than': '18',
      })
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).reply({ count: 0, results: [] })

      await service.listRows('678', undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).replyWithError({ message: 'Boom' })

      await expect(service.listRows('678')).rejects.toThrow('Baserow API error')
    })
  })

  describe('getRow', () => {
    it('fetches a single row with user_field_names defaulting to true', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/1/`).reply({ id: 1, Name: 'Acme' })

      const result = await service.getRow('678', '1')

      expect(result).toEqual({ id: 1, Name: 'Acme' })
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/1/`)
      expect(mock.history[0].headers.Authorization).toBe(`Token ${ API_TOKEN }`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/1/`).reply({ id: 1, field_999: 'Acme' })

      await service.getRow('678', '1', false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/1/`).replyWithError({ message: 'Boom' })

      await expect(service.getRow('678', '1')).rejects.toThrow('Baserow API error')
    })
  })

  describe('createRow', () => {
    it('posts row data with user_field_names true by default', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/`).reply({ id: 3, Name: 'Acme' })

      const result = await service.createRow('678', { Name: 'Acme', Status: 'Open' })

      expect(result).toEqual({ id: 3, Name: 'Acme' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers.Authorization).toBe(`Token ${ API_TOKEN }`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
      expect(mock.history[0].body).toEqual({ Name: 'Acme', Status: 'Open' })
    })

    it('sends an empty body object when data is omitted', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/`).reply({ id: 4 })

      await service.createRow('678')

      expect(mock.history[0].body).toEqual({})
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/`).reply({ id: 5 })

      await service.createRow('678', { field_999: 'Acme' }, false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/`).replyWithError({ message: 'Boom' })

      await expect(service.createRow('678', { Name: 'Acme' })).rejects.toThrow('Baserow API error')
    })
  })

  describe('updateRow', () => {
    it('patches a row with the supplied data', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/`).reply({ id: 1, Status: 'Won' })

      const result = await service.updateRow('678', '1', { Status: 'Won' })

      expect(result).toEqual({ id: 1, Status: 'Won' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/1/`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
      expect(mock.history[0].body).toEqual({ Status: 'Won' })
    })

    it('sends an empty body object when data is omitted', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/`).reply({ id: 1 })

      await service.updateRow('678', '1')

      expect(mock.history[0].body).toEqual({})
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/`).reply({ id: 1 })

      await service.updateRow('678', '1', { field_999: 'Won' }, false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/`).replyWithError({ message: 'Boom' })

      await expect(service.updateRow('678', '1', { Status: 'Won' })).rejects.toThrow('Baserow API error')
    })
  })

  describe('deleteRow', () => {
    it('deletes a row and returns a confirmation object with string ids', async () => {
      mock.onDelete(`${ BASE }/database/rows/table/678/1/`).reply(undefined)

      const result = await service.deleteRow(678, 1)

      expect(result).toEqual({ deleted: true, tableId: '678', rowId: '1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/1/`)
      expect(mock.history[0].headers.Authorization).toBe(`Token ${ API_TOKEN }`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/database/rows/table/678/1/`).replyWithError({ message: 'Boom' })

      await expect(service.deleteRow('678', '1')).rejects.toThrow('Baserow API error')
    })
  })

  describe('moveRow', () => {
    it('moves a row to the end when no beforeId is supplied', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/move/`).reply({ id: 1, order: '2.5' })

      const result = await service.moveRow('678', '1')

      expect(result).toEqual({ id: 1, order: '2.5' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/1/move/`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
    })

    it('includes before_id when a beforeId is supplied', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/move/`).reply({ id: 1 })

      await service.moveRow('678', '1', '5')

      expect(mock.history[0].query).toEqual({ user_field_names: true, before_id: '5' })
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/move/`).reply({ id: 1 })

      await service.moveRow('678', '1', undefined, false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/1/move/`).replyWithError({ message: 'Boom' })

      await expect(service.moveRow('678', '1')).rejects.toThrow('Baserow API error')
    })
  })

  describe('createRows', () => {
    it('posts a batch of rows wrapped in an items array', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [{ id: 3 }, { id: 4 }] })

      const result = await service.createRows('678', [{ Name: 'Acme' }, { Name: 'Globex' }])

      expect(result).toEqual({ items: [{ id: 3 }, { id: 4 }] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/batch/`)
      expect(mock.history[0].query).toEqual({ user_field_names: true })
      expect(mock.history[0].body).toEqual({ items: [{ Name: 'Acme' }, { Name: 'Globex' }] })
    })

    it('coerces a non-array items argument to an empty array', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [] })

      await service.createRows('678', undefined)

      expect(mock.history[0].body).toEqual({ items: [] })
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [] })

      await service.createRows('678', [{ field_999: 'Acme' }], false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch/`).replyWithError({ message: 'Boom' })

      await expect(service.createRows('678', [{ Name: 'Acme' }])).rejects.toThrow('Baserow API error')
    })
  })

  describe('updateRows', () => {
    it('patches a batch of rows wrapped in an items array', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [{ id: 1 }, { id: 2 }] })

      const result = await service.updateRows('678', [{ id: 1, Status: 'Won' }, { id: 2, Status: 'Lost' }])

      expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }] })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/batch/`)
      expect(mock.history[0].body).toEqual({
        items: [{ id: 1, Status: 'Won' }, { id: 2, Status: 'Lost' }],
      })
    })

    it('coerces a non-array items argument to an empty array', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [] })

      await service.updateRows('678', null)

      expect(mock.history[0].body).toEqual({ items: [] })
    })

    it('sends user_field_names=false when explicitly disabled', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/batch/`).reply({ items: [] })

      await service.updateRows('678', [{ id: 1 }], false)

      expect(mock.history[0].query).toEqual({ user_field_names: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/database/rows/table/678/batch/`).replyWithError({ message: 'Boom' })

      await expect(service.updateRows('678', [{ id: 1 }])).rejects.toThrow('Baserow API error')
    })
  })

  describe('deleteRows', () => {
    it('posts row ids to the batch-delete endpoint and returns a confirmation', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch-delete/`).reply(undefined)

      const result = await service.deleteRows(678, [1, 2, 3])

      expect(result).toEqual({ deleted: true, tableId: '678', items: [1, 2, 3] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/database/rows/table/678/batch-delete/`)
      expect(mock.history[0].headers.Authorization).toBe(`Token ${ API_TOKEN }`)
      expect(mock.history[0].body).toEqual({ items: [1, 2, 3] })
    })

    it('coerces a non-array items argument to an empty array', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch-delete/`).reply(undefined)

      const result = await service.deleteRows('678', undefined)

      expect(result).toEqual({ deleted: true, tableId: '678', items: [] })
      expect(mock.history[0].body).toEqual({ items: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/database/rows/table/678/batch-delete/`).replyWithError({ message: 'Boom' })

      await expect(service.deleteRows('678', [1])).rejects.toThrow('Baserow API error')
    })
  })

  // ── Error wrapping ──

  describe('error wrapping', () => {
    it('includes the error code and detail from a structured error body', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).replyWithError({
        message: 'Request failed',
        body: { error: 'ERROR_NO_PERMISSION_TO_TABLE', detail: 'You do not have access.' },
      })

      await expect(service.listRows('678')).rejects.toThrow(
        'Baserow API error [ERROR_NO_PERMISSION_TO_TABLE]: You do not have access.'
      )
    })

    it('falls back to the error body "error" field when there is no detail', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).replyWithError({
        message: 'Request failed',
        body: { error: 'ERROR_TABLE_DOES_NOT_EXIST' },
      })

      await expect(service.listRows('678')).rejects.toThrow(
        'Baserow API error [ERROR_TABLE_DOES_NOT_EXIST]: ERROR_TABLE_DOES_NOT_EXIST'
      )
    })

    it('falls back to error.message when the body has no detail or error', async () => {
      mock.onGet(`${ BASE }/database/rows/table/678/`).replyWithError({ message: 'Network Error' })

      await expect(service.listRows('678')).rejects.toThrow('Baserow API error: Network Error')
    })
  })

  // ── Missing-credential guards ──

  describe('credential guards', () => {
    it('rejects JWT-only operations when no JWT token is configured', async () => {
      const jwtlessSandbox = createSandbox({ baseUrl: BASE_URL, apiToken: API_TOKEN })
      requireServiceFresh()
      const jwtlessService = jwtlessSandbox.getService()
      const jwtlessMock = jwtlessSandbox.getRequestMock()

      await expect(jwtlessService.listDatabases()).rejects.toThrow(
        /requires a JWT access token/
      )
      // The guard fires before any HTTP call is made.
      expect(jwtlessMock.history).toHaveLength(0)

      jwtlessSandbox.cleanup()
    })

    it('rejects row operations when no database token is configured', async () => {
      const tokenlessSandbox = createSandbox({ baseUrl: BASE_URL, jwtToken: JWT_TOKEN })
      requireServiceFresh()
      const tokenlessService = tokenlessSandbox.getService()
      const tokenlessMock = tokenlessSandbox.getRequestMock()

      await expect(tokenlessService.listRows('678')).rejects.toThrow(
        /requires a database token/
      )
      expect(tokenlessMock.history).toHaveLength(0)

      tokenlessSandbox.cleanup()
    })
  })

  // ── Default base URL ──

  describe('default base URL', () => {
    it('uses https://api.baserow.io when no baseUrl is configured', async () => {
      const defaultSandbox = createSandbox({ apiToken: API_TOKEN, jwtToken: JWT_TOKEN })
      requireServiceFresh()
      const defaultService = defaultSandbox.getService()
      const defaultMock = defaultSandbox.getRequestMock()

      defaultMock.onGet('https://api.baserow.io/api/applications/').reply([])

      await defaultService.listDatabases()

      expect(defaultMock.history[0].url).toBe('https://api.baserow.io/api/applications/')

      defaultSandbox.cleanup()
    })
  })
})
