'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-grist-key'
// Use a non-default base URL with a trailing slash to exercise the trailing-slash
// stripping in the constructor and confirm URLs are built from config.
const BASE_URL = 'https://team.example.com/'
const API_BASE = 'https://team.example.com/api'

describe('Grist Service', () => {
  let sandbox
  let service
  let mock
  let sharedFlowrunner

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    // Snapshot the shared global so the isolated default-base-URL test can restore
    // it after its throwaway sandbox tears the global down.
    sharedFlowrunner = global.Flowrunner
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
          defaultValue: 'https://docs.getgrist.com',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bearer auth header and JSON content type on requests', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1`).reply({ id: 'doc1' })

      await service.getDocument('doc1')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })

    it('strips a trailing slash from the base URL when building request URLs', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1`).reply({ id: 'doc1' })

      await service.getDocument('doc1')

      // No doubled slash: exactly `${host}/api/docs/doc1`.
      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/doc1`)
    })
  })

  // ── Base URL default ──

  describe('default base URL', () => {
    it('falls back to https://docs.getgrist.com when baseUrl is omitted', async () => {
      // Isolate the module registry so a fresh service instance registers into a
      // throwaway sandbox without disturbing the shared sandbox/service/mock.
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line global-require
        const { createSandbox: createLocalSandbox } = require('../../../service-sandbox')
        const localSandbox = createLocalSandbox({ apiKey: 'k' })
        // eslint-disable-next-line global-require
        require('../src/index.js')
        const localService = localSandbox.getService()
        const localMock = localSandbox.getRequestMock()

        localMock.onGet('https://docs.getgrist.com/api/docs/doc9').reply({ id: 'doc9' })

        await localService.getDocument('doc9')

        expect(localMock.history[0].url).toBe('https://docs.getgrist.com/api/docs/doc9')

        localSandbox.cleanup()
      })

      // Restore the shared global that isolateModulesAsync's cleanup removed.
      global.Flowrunner = sharedFlowrunner
    })
  })

  // ── Dictionaries ──

  describe('getDocsDictionary', () => {
    const workspacesResponse = [
      {
        id: 1,
        name: 'Sales',
        docs: [
          { id: 'abc123', name: 'Sales CRM' },
          { id: 'def456', name: 'Leads' },
        ],
      },
      {
        id: 2,
        name: 'Ops',
        docs: [{ id: 'ghi789', name: 'Inventory' }],
      },
    ]

    it('walks all workspaces and maps docs to items', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply(workspacesResponse)

      const result = await service.getDocsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/current/workspaces`)
      expect(result.items).toEqual([
        { label: 'Sales CRM', value: 'abc123', note: 'Workspace: Sales' },
        { label: 'Leads', value: 'def456', note: 'Workspace: Sales' },
        { label: 'Inventory', value: 'ghi789', note: 'Workspace: Ops' },
      ])
    })

    it('filters by search term over name and id', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply(workspacesResponse)

      const result = await service.getDocsDictionary({ search: 'inventory' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ghi789')
    })

    it('filters by document id as search term', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply(workspacesResponse)

      const result = await service.getDocsDictionary({ search: 'def456' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('def456')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply(workspacesResponse)

      const result = await service.getDocsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('falls back to placeholders for unnamed docs', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply([
        { id: 1, name: '', docs: [{ id: 'noName' }] },
      ])

      const result = await service.getDocsDictionary({})

      expect(result.items).toEqual([
        { label: '[unnamed]', value: 'noName', note: 'ID: noName' },
      ])
    })

    it('handles workspaces without docs arrays', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply([{ id: 1, name: 'Empty' }])

      const result = await service.getDocsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getTablesDictionary', () => {
    const tablesResponse = {
      tables: [
        { id: 'Contacts' },
        { id: 'Deals' },
      ],
    }

    it('maps tables to items where label equals value', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({ criteria: { docId: 'doc1' } })

      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/doc1/tables`)
      expect(result.items).toEqual([
        { label: 'Contacts', value: 'Contacts', note: 'Table ID: Contacts' },
        { label: 'Deals', value: 'Deals', note: 'Table ID: Deals' },
      ])
    })

    it('filters tables by search term', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({ search: 'deal', criteria: { docId: 'doc1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Deals')
    })

    it('handles a missing tables array', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).reply({})

      const result = await service.getTablesDictionary({ criteria: { docId: 'doc1' } })

      expect(result.items).toEqual([])
    })
  })

  describe('getColumnsDictionary', () => {
    const columnsResponse = {
      columns: [
        { id: 'Name', fields: { label: 'Full Name', type: 'Text' } },
        { id: 'Age', fields: { label: 'Age', type: 'Int' } },
        { id: 'Bare' },
      ],
    }

    it('maps columns to items using column id as value', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply(columnsResponse)

      const result = await service.getColumnsDictionary({ criteria: { docId: 'doc1', tableId: 'Contacts' } })

      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/doc1/tables/Contacts/columns`)
      expect(result.items).toEqual([
        { label: 'Full Name', value: 'Name', note: 'Type: Text' },
        { label: 'Age', value: 'Age', note: 'Type: Int' },
        { label: 'Bare', value: 'Bare', note: 'Type: Any' },
      ])
    })

    it('filters columns by search over id and label', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply(columnsResponse)

      const result = await service.getColumnsDictionary({
        search: 'full name',
        criteria: { docId: 'doc1', tableId: 'Contacts' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Name')
    })

    it('handles a missing columns array', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply({})

      const result = await service.getColumnsDictionary({ criteria: { docId: 'doc1', tableId: 'Contacts' } })

      expect(result.items).toEqual([])
    })
  })

  // ── Records ──

  describe('listRecords', () => {
    it('sends a GET with no query params when only ids are given', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({
        records: [{ id: 1, fields: { Name: 'Alice' } }],
      })

      const result = await service.listRecords('doc1', 'Contacts')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual([{ id: 1, fields: { Name: 'Alice' } }])
    })

    it('stringifies an object filter and includes sort and limit', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [] })

      await service.listRecords('doc1', 'Contacts', { Status: ['Open'] }, '-Created,Name', 25)

      expect(mock.history[0].query).toEqual({
        filter: '{"Status":["Open"]}',
        sort: '-Created,Name',
        limit: 25,
      })
    })

    it('passes a string filter through unchanged', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [] })

      await service.listRecords('doc1', 'Contacts', '{"Status":["Closed"]}')

      expect(mock.history[0].query).toEqual({ filter: '{"Status":["Closed"]}' })
    })

    it('omits an empty-string filter and limit', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [] })

      await service.listRecords('doc1', 'Contacts', '', undefined, '')

      expect(mock.history[0].query).toEqual({})
    })

    it('returns an empty array when the response has no records', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({})

      const result = await service.listRecords('doc1', 'Contacts')

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.listRecords('doc1', 'Contacts')).rejects.toThrow('Grist API error: Unauthorized')
    })

    it('includes structured error details in the wrapped message', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid filter', details: 'bad JSON' },
      })

      await expect(service.listRecords('doc1', 'Contacts')).rejects.toThrow(
        'Grist API error: Invalid filter (bad JSON)'
      )
    })

    it('serializes object error details as JSON', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid', details: { column: 'Status' } },
      })

      await expect(service.listRecords('doc1', 'Contacts')).rejects.toThrow(
        'Grist API error: Invalid ({"column":"Status"})'
      )
    })
  })

  describe('addRecords', () => {
    it('wraps a single fields object into a records array', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [{ id: 11 }] })

      const result = await service.addRecords('doc1', 'Contacts', { Name: 'Alice', Status: 'Open' })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        records: [{ fields: { Name: 'Alice', Status: 'Open' } }],
      })
      expect(result).toEqual({ records: [{ id: 11 }] })
    })

    it('wraps an array of plain field objects', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [] })

      await service.addRecords('doc1', 'Contacts', [{ Name: 'Alice' }, { Name: 'Bob' }])

      expect(mock.history[0].body).toEqual({
        records: [{ fields: { Name: 'Alice' } }, { fields: { Name: 'Bob' } }],
      })
    })

    it('passes through items that already have a fields property', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply({ records: [] })

      await service.addRecords('doc1', 'Contacts', [{ fields: { Name: 'Alice' } }])

      expect(mock.history[0].body).toEqual({
        records: [{ fields: { Name: 'Alice' } }],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({ message: 'Boom' })

      await expect(service.addRecords('doc1', 'Contacts', { Name: 'A' })).rejects.toThrow(
        'Grist API error: Boom'
      )
    })
  })

  describe('updateRecords', () => {
    it('sends a PATCH with the records body and returns the update count', async () => {
      mock.onPatch(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply(undefined)

      const result = await service.updateRecords('doc1', 'Contacts', [
        { id: 5, fields: { Status: 'Closed' } },
        { id: 6, fields: { Status: 'Open' } },
      ])

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({
        records: [
          { id: 5, fields: { Status: 'Closed' } },
          { id: 6, fields: { Status: 'Open' } },
        ],
      })
      expect(result).toEqual({ updated: 2 })
    })

    it('throws when records is not an array without making a request', async () => {
      await expect(service.updateRecords('doc1', 'Contacts', { id: 5 })).rejects.toThrow(
        'The "records" parameter must be an array of {id, fields} objects.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({ message: 'Boom' })

      await expect(
        service.updateRecords('doc1', 'Contacts', [{ id: 5, fields: {} }])
      ).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('addOrUpdateRecords', () => {
    it('sends a PUT with the records body and no query flags by default', async () => {
      mock.onPut(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply(undefined)

      const records = [{ require: { Email: 'a@x.com' }, fields: { Name: 'Alice' } }]
      const result = await service.addOrUpdateRecords('doc1', 'Contacts', records)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toEqual({ records })
      expect(result).toEqual({ processed: 1 })
    })

    it('sets noadd and noupdate query flags when requested', async () => {
      mock.onPut(`${ API_BASE }/docs/doc1/tables/Contacts/records`).reply(undefined)

      await service.addOrUpdateRecords(
        'doc1',
        'Contacts',
        [{ require: { Email: 'a@x.com' }, fields: {} }],
        true,
        true
      )

      expect(mock.history[0].query).toEqual({ noadd: true, noupdate: true })
    })

    it('throws when records is not an array without making a request', async () => {
      await expect(service.addOrUpdateRecords('doc1', 'Contacts', 'nope')).rejects.toThrow(
        'The "records" parameter must be an array of {require, fields} objects.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ API_BASE }/docs/doc1/tables/Contacts/records`).replyWithError({ message: 'Boom' })

      await expect(
        service.addOrUpdateRecords('doc1', 'Contacts', [{ require: {}, fields: {} }])
      ).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('deleteRecords', () => {
    it('posts the raw row-id array to the delete endpoint', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records/delete`).reply(undefined)

      const result = await service.deleteRecords('doc1', 'Contacts', [3, 7, 12])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/doc1/tables/Contacts/records/delete`)
      expect(mock.history[0].body).toEqual([3, 7, 12])
      expect(result).toEqual({ deleted: 3 })
    })

    it('throws when rowIds is not an array without making a request', async () => {
      await expect(service.deleteRecords('doc1', 'Contacts', 5)).rejects.toThrow(
        'The "rowIds" parameter must be a non-empty array of numeric row IDs.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when rowIds is an empty array without making a request', async () => {
      await expect(service.deleteRecords('doc1', 'Contacts', [])).rejects.toThrow(
        'The "rowIds" parameter must be a non-empty array of numeric row IDs.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/records/delete`).replyWithError({
        message: 'Boom',
      })

      await expect(service.deleteRecords('doc1', 'Contacts', [1])).rejects.toThrow('Grist API error: Boom')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('returns the tables array from the response', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).reply({
        tables: [{ id: 'Contacts', fields: { tableRef: 1 } }],
      })

      const result = await service.listTables('doc1')

      expect(result).toEqual([{ id: 'Contacts', fields: { tableRef: 1 } }])
    })

    it('returns an empty array when tables is missing', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).reply({})

      const result = await service.listTables('doc1')

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables`).replyWithError({ message: 'Boom' })

      await expect(service.listTables('doc1')).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('createTable', () => {
    it('wraps the table definition into the tables body', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables`).reply({ tables: [{ id: 'Contacts' }] })

      const columns = [{ id: 'Name', fields: { label: 'Name', type: 'Text' } }]
      const result = await service.createTable('doc1', 'Contacts', columns)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        tables: [{ id: 'Contacts', columns }],
      })
      expect(result).toEqual({ tables: [{ id: 'Contacts' }] })
    })

    it('normalizes a non-array columns argument to an empty array', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables`).reply({ tables: [{ id: 'Contacts' }] })

      await service.createTable('doc1', 'Contacts', undefined)

      expect(mock.history[0].body).toEqual({
        tables: [{ id: 'Contacts', columns: [] }],
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables`).replyWithError({ message: 'Boom' })

      await expect(service.createTable('doc1', 'Contacts', [])).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('modifyTable', () => {
    it('sends a PATCH renaming the table and returns the new id', async () => {
      mock.onPatch(`${ API_BASE }/docs/doc1/tables`).reply(undefined)

      const result = await service.modifyTable('doc1', 'Contacts', 'Customers')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({
        tables: [{ id: 'Contacts', fields: { tableId: 'Customers' } }],
      })
      expect(result).toEqual({ tables: [{ id: 'Customers' }] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ API_BASE }/docs/doc1/tables`).replyWithError({ message: 'Boom' })

      await expect(service.modifyTable('doc1', 'Contacts', 'Customers')).rejects.toThrow(
        'Grist API error: Boom'
      )
    })
  })

  // ── Columns ──

  describe('listColumns', () => {
    it('returns the columns array from the response', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply({
        columns: [{ id: 'Name', fields: { label: 'Name', type: 'Text' } }],
      })

      const result = await service.listColumns('doc1', 'Contacts')

      expect(result).toEqual([{ id: 'Name', fields: { label: 'Name', type: 'Text' } }])
    })

    it('returns an empty array when columns is missing', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply({})

      const result = await service.listColumns('doc1', 'Contacts')

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).replyWithError({ message: 'Boom' })

      await expect(service.listColumns('doc1', 'Contacts')).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('addColumns', () => {
    it('posts the columns body to the columns endpoint', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply({ columns: [{ id: 'Email' }] })

      const columns = [{ id: 'Email', fields: { label: 'Email', type: 'Text' } }]
      const result = await service.addColumns('doc1', 'Contacts', columns)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ columns })
      expect(result).toEqual({ columns: [{ id: 'Email' }] })
    })

    it('normalizes a non-array columns argument to an empty array', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).reply({ columns: [] })

      await service.addColumns('doc1', 'Contacts', null)

      expect(mock.history[0].body).toEqual({ columns: [] })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ API_BASE }/docs/doc1/tables/Contacts/columns`).replyWithError({ message: 'Boom' })

      await expect(service.addColumns('doc1', 'Contacts', [])).rejects.toThrow('Grist API error: Boom')
    })
  })

  // ── Documents & Workspaces ──

  describe('listWorkspaces', () => {
    it('lists workspaces for the current org by default', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply([{ id: 1, name: 'Sales', docs: [] }])

      const result = await service.listWorkspaces()

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/current/workspaces`)
      expect(result).toEqual([{ id: 1, name: 'Sales', docs: [] }])
    })

    it('targets a specific org id when provided', async () => {
      mock.onGet(`${ API_BASE }/orgs/myteam/workspaces`).reply([])

      await service.listWorkspaces('myteam')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myteam/workspaces`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).replyWithError({ message: 'Boom' })

      await expect(service.listWorkspaces()).rejects.toThrow('Grist API error: Boom')
    })
  })

  describe('listDocuments', () => {
    it('flattens documents across workspaces with workspace names', async () => {
      mock.onGet(`${ API_BASE }/orgs/current/workspaces`).reply([
        { id: 1, name: 'Sales', docs: [{ id: 'abc', name: 'CRM' }] },
        { id: 2, name: 'Ops', docs: [{ id: 'def', name: 'Inventory' }] },
      ])

      const result = await service.listDocuments()

      expect(result).toEqual([
        { id: 'abc', name: 'CRM', workspace: 'Sales' },
        { id: 'def', name: 'Inventory', workspace: 'Ops' },
      ])
    })

    it('targets a specific org id when provided', async () => {
      mock.onGet(`${ API_BASE }/orgs/myteam/workspaces`).reply([])

      await service.listDocuments('myteam')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myteam/workspaces`)
    })
  })

  describe('getDocument', () => {
    it('fetches a document by id', async () => {
      mock.onGet(`${ API_BASE }/docs/abc123`).reply({ id: 'abc123', name: 'Sales CRM' })

      const result = await service.getDocument('abc123')

      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/abc123`)
      expect(result).toEqual({ id: 'abc123', name: 'Sales CRM' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/abc123`).replyWithError({ message: 'Not found' })

      await expect(service.getDocument('abc123')).rejects.toThrow('Grist API error: Not found')
    })
  })

  // ── SQL ──

  describe('queryWithSql', () => {
    it('sends the query as the q param and returns records', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/sql`).reply({
        records: [{ fields: { Name: 'Alice', Status: 'Open' } }],
      })

      const result = await service.queryWithSql('doc1', 'SELECT * FROM Contacts')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ q: 'SELECT * FROM Contacts' })
      expect(result).toEqual([{ fields: { Name: 'Alice', Status: 'Open' } }])
    })

    it('returns an empty array when records is missing', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/sql`).reply({})

      const result = await service.queryWithSql('doc1', 'SELECT 1')

      expect(result).toEqual([])
    })

    it('throws on an empty query without making a request', async () => {
      await expect(service.queryWithSql('doc1', '   ')).rejects.toThrow(
        'A non-empty SQL SELECT query is required.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/sql`).replyWithError({ message: 'Boom' })

      await expect(service.queryWithSql('doc1', 'SELECT 1')).rejects.toThrow('Grist API error: Boom')
    })
  })

  // ── Attachments ──

  describe('listAttachments', () => {
    it('returns the records array from the response', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/attachments`).reply({
        records: [{ id: 1, fields: { fileName: 'invoice.pdf' } }],
      })

      const result = await service.listAttachments('doc1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/docs/doc1/attachments`)
      expect(result).toEqual([{ id: 1, fields: { fileName: 'invoice.pdf' } }])
    })

    it('returns an empty array when records is missing', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/attachments`).reply({})

      const result = await service.listAttachments('doc1')

      expect(result).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ API_BASE }/docs/doc1/attachments`).replyWithError({ message: 'Boom' })

      await expect(service.listAttachments('doc1')).rejects.toThrow('Grist API error: Boom')
    })
  })
})
