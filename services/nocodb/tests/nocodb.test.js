'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-xc-token'
const BASE_URL = 'https://app.nocodb.com'
const API_BASE = `${BASE_URL}/api/v2`

describe('NocoDB Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, apiToken: API_TOKEN })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'baseUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionaries ──

  describe('getBasesDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({
        list: [
          { id: 'p_abc123', title: 'CRM' },
          { id: 'p_def456', title: 'HR' },
        ],
      })

      const result = await service.getBasesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'CRM',
        value: 'p_abc123',
        note: 'ID: p_abc123',
      })
      expect(mock.history[0].headers).toMatchObject({ 'xc-token': API_TOKEN })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({
        list: [
          { id: 'p_abc123', title: 'CRM' },
          { id: 'p_def456', title: 'HR Database' },
        ],
      })

      const result = await service.getBasesDictionary({ search: 'crm' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p_abc123')
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({ list: [{ id: 'p_1', title: 'A' }] })

      const result = await service.getBasesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty list', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({ list: [] })

      const result = await service.getBasesDictionary({})

      expect(result.items).toHaveLength(0)
    })

    it('handles null list in response', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({})

      const result = await service.getBasesDictionary({})

      expect(result.items).toEqual([])
    })

    it('uses [untitled] for bases with no title', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({ list: [{ id: 'p_1' }] })

      const result = await service.getBasesDictionary({})

      expect(result.items[0].label).toBe('[untitled]')
    })
  })

  describe('getTablesDictionary', () => {
    it('returns tables for a given base', async () => {
      mock.onGet(`${API_BASE}/meta/bases/p_abc123/tables`).reply({
        list: [{ id: 'm_xyz789', title: 'Contacts' }],
      })

      const result = await service.getTablesDictionary({
        criteria: { baseId: 'p_abc123' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Contacts',
        value: 'm_xyz789',
        note: 'ID: m_xyz789',
      })
    })

    it('filters by search', async () => {
      mock.onGet(`${API_BASE}/meta/bases/p_1/tables`).reply({
        list: [
          { id: 'm_1', title: 'Orders' },
          { id: 'm_2', title: 'Products' },
        ],
      })

      const result = await service.getTablesDictionary({
        search: 'prod',
        criteria: { baseId: 'p_1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('m_2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/meta/bases/undefined/tables`).reply({ list: [] })

      const result = await service.getTablesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns fields for a given table', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_xyz789`).reply({
        columns: [
          { id: 'c_field1', title: 'Name', uidt: 'SingleLineText' },
          { id: 'c_field2', title: 'Email', uidt: 'Email' },
        ],
      })

      const result = await service.getFieldsDictionary({
        criteria: { tableId: 'm_xyz789' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Name',
        value: 'Name',
        note: 'SingleLineText (ID: c_field1)',
      })
    })

    it('filters by search', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_1`).reply({
        columns: [
          { id: 'c_1', title: 'Name', uidt: 'SingleLineText' },
          { id: 'c_2', title: 'Age', uidt: 'Number' },
        ],
      })

      const result = await service.getFieldsDictionary({
        search: 'age',
        criteria: { tableId: 'm_1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Age')
    })

    it('handles null columns', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_1`).reply({})

      const result = await service.getFieldsDictionary({ criteria: { tableId: 'm_1' } })

      expect(result.items).toEqual([])
    })

    it('uses [untitled] and Field fallback for missing values', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_1`).reply({
        columns: [{ id: 'c_1' }],
      })

      const result = await service.getFieldsDictionary({ criteria: { tableId: 'm_1' } })

      expect(result.items[0].label).toBe('[untitled]')
      expect(result.items[0].note).toBe('Field (ID: c_1)')
    })
  })

  describe('getViewsDictionary', () => {
    it('returns views for a given table', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_xyz789/views`).reply({
        list: [{ id: 'v_abc123', title: 'Grid view', type: 'grid' }],
      })

      const result = await service.getViewsDictionary({
        criteria: { tableId: 'm_xyz789' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Grid view',
        value: 'v_abc123',
        note: 'grid (ID: v_abc123)',
      })
    })

    it('filters by search', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_1/views`).reply({
        list: [
          { id: 'v_1', title: 'Grid view', type: 'grid' },
          { id: 'v_2', title: 'Gallery view', type: 'gallery' },
        ],
      })

      const result = await service.getViewsDictionary({
        search: 'gallery',
        criteria: { tableId: 'm_1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('v_2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/meta/tables/undefined/views`).reply({ list: [] })

      const result = await service.getViewsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('uses fallback for missing type', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_1/views`).reply({
        list: [{ id: 'v_1', title: 'Custom' }],
      })

      const result = await service.getViewsDictionary({ criteria: { tableId: 'm_1' } })

      expect(result.items[0].note).toBe('view (ID: v_1)')
    })
  })

  // ── Records ──

  describe('listRecords', () => {
    it('sends GET with only tableId when no optional params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records`).reply({
        list: [{ Id: 1, Name: 'John' }],
        pageInfo: { totalRows: 1 },
      })

      const result = await service.listRecords('m_1')

      expect(result.list).toHaveLength(1)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'xc-token': API_TOKEN })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes all optional query params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records`).reply({ list: [], pageInfo: {} })

      await service.listRecords('m_1', 'Name,Email', '-CreatedAt', '(Status,eq,Active)', 10, 20, 'v_1')

      expect(mock.history[0].query).toMatchObject({
        fields: 'Name,Email',
        sort: '-CreatedAt',
        where: '(Status,eq,Active)',
        limit: 10,
        offset: 20,
        viewId: 'v_1',
      })
    })

    it('omits undefined optional params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records`).reply({ list: [] })

      await service.listRecords('m_1', undefined, undefined, undefined, undefined, undefined, undefined)

      expect(mock.history[0].query).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records`).replyWithError({
        message: 'Unauthorized',
        body: { msg: 'Invalid token' },
      })

      await expect(service.listRecords('m_1')).rejects.toThrow('NocoDB API error: Invalid token')
    })
  })

  describe('getRecord', () => {
    it('sends GET with correct URL and returns record', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/1`).reply({ Id: 1, Name: 'John' })

      const result = await service.getRecord('m_1', '1')

      expect(result).toEqual({ Id: 1, Name: 'John' })
    })

    it('passes fields query param', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/1`).reply({ Id: 1, Name: 'John' })

      await service.getRecord('m_1', '1', 'Name,Email')

      expect(mock.history[0].query).toMatchObject({ fields: 'Name,Email' })
    })

    it('omits fields when not provided', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/1`).reply({ Id: 1 })

      await service.getRecord('m_1', '1')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('createRecords', () => {
    it('sends POST with array body for single record', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }])

      const result = await service.createRecords('m_1', { Name: 'John', Status: 'Active' })

      expect(mock.history[0].body).toEqual([{ Name: 'John', Status: 'Active' }])
      expect(result).toEqual([{ Id: 1 }])
    })

    it('sends POST with array body for multiple records', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }, { Id: 2 }])

      await service.createRecords('m_1', [{ Name: 'A' }, { Name: 'B' }])

      expect(mock.history[0].body).toEqual([{ Name: 'A' }, { Name: 'B' }])
    })

    it('handles null records as empty array', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/records`).reply([])

      await service.createRecords('m_1', null)

      expect(mock.history[0].body).toEqual([])
    })
  })

  describe('updateRecords', () => {
    it('sends PATCH with array body', async () => {
      mock.onPatch(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }])

      await service.updateRecords('m_1', { Id: 1, Status: 'Closed' })

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual([{ Id: 1, Status: 'Closed' }])
    })

    it('sends PATCH with array of multiple records', async () => {
      mock.onPatch(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }, { Id: 2 }])

      await service.updateRecords('m_1', [{ Id: 1, Status: 'A' }, { Id: 2, Status: 'B' }])

      expect(mock.history[0].body).toHaveLength(2)
    })
  })

  describe('deleteRecords', () => {
    it('sends DELETE with Id-wrapped objects for scalar IDs', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }])

      await service.deleteRecords('m_1', 1)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual([{ Id: 1 }])
    })

    it('sends DELETE with array of Id objects for array of scalars', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/records`).reply([{ Id: 1 }, { Id: 2 }])

      await service.deleteRecords('m_1', [1, 2])

      expect(mock.history[0].body).toEqual([{ Id: 1 }, { Id: 2 }])
    })

    it('passes through objects that already have Id', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/records`).reply([{ Id: 5 }])

      await service.deleteRecords('m_1', { Id: 5 })

      expect(mock.history[0].body).toEqual([{ Id: 5 }])
    })

    it('handles null recordIds as empty array', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/records`).reply([])

      await service.deleteRecords('m_1', null)

      expect(mock.history[0].body).toEqual([])
    })
  })

  describe('countRecords', () => {
    it('sends GET with no query params when no filters', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/count`).reply({ count: 42 })

      const result = await service.countRecords('m_1')

      expect(result).toEqual({ count: 42 })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes where and viewId query params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/count`).reply({ count: 5 })

      await service.countRecords('m_1', '(Status,eq,Active)', 'v_1')

      expect(mock.history[0].query).toMatchObject({
        where: '(Status,eq,Active)',
        viewId: 'v_1',
      })
    })

    it('omits undefined optional params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/records/count`).reply({ count: 0 })

      await service.countRecords('m_1', undefined, undefined)

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Linked Records ──

  describe('listLinkedRecords', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply({
        list: [{ Id: 5, Name: 'Related' }],
        pageInfo: { totalRows: 1 },
      })

      const result = await service.listLinkedRecords('m_1', 'c_link1', '1')

      expect(result.list).toHaveLength(1)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes optional query params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply({ list: [] })

      await service.listLinkedRecords('m_1', 'c_link1', '1', 'Name,Email', 10, 20)

      expect(mock.history[0].query).toMatchObject({
        fields: 'Name,Email',
        limit: 10,
        offset: 20,
      })
    })

    it('omits undefined optional params', async () => {
      mock.onGet(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply({ list: [] })

      await service.listLinkedRecords('m_1', 'c_link1', '1')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('linkRecords', () => {
    it('sends POST with Id-wrapped objects for scalar IDs', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply(true)

      const result = await service.linkRecords('m_1', 'c_link1', '1', 5)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual([{ Id: 5 }])
      expect(result).toBe(true)
    })

    it('passes through objects that already have Id', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply(true)

      await service.linkRecords('m_1', 'c_link1', '1', [{ Id: 5 }, { Id: 6 }])

      expect(mock.history[0].body).toEqual([{ Id: 5 }, { Id: 6 }])
    })

    it('handles mixed array of scalars and objects', async () => {
      mock.onPost(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply(true)

      await service.linkRecords('m_1', 'c_link1', '1', [7, { Id: 8 }])

      expect(mock.history[0].body).toEqual([{ Id: 7 }, { Id: 8 }])
    })
  })

  describe('unlinkRecords', () => {
    it('sends DELETE with Id-wrapped objects', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply(true)

      const result = await service.unlinkRecords('m_1', 'c_link1', '1', [5, 6])

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual([{ Id: 5 }, { Id: 6 }])
      expect(result).toBe(true)
    })

    it('handles null targetRecordIds as empty array', async () => {
      mock.onDelete(`${API_BASE}/tables/m_1/links/c_link1/records/1`).reply(true)

      await service.unlinkRecords('m_1', 'c_link1', '1', null)

      expect(mock.history[0].body).toEqual([])
    })
  })

  // ── Bases & Tables ──

  describe('listBases', () => {
    it('sends GET and returns bases', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).reply({
        list: [{ id: 'p_abc123', title: 'CRM', type: 'database' }],
        pageInfo: { totalRows: 1 },
      })

      const result = await service.listBases()

      expect(result.list).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'xc-token': API_TOKEN,
        'Content-Type': 'application/json',
      })
    })
  })

  describe('getBase', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${API_BASE}/meta/bases/p_abc123`).reply({
        id: 'p_abc123',
        title: 'CRM',
        type: 'database',
      })

      const result = await service.getBase('p_abc123')

      expect(result).toEqual({ id: 'p_abc123', title: 'CRM', type: 'database' })
    })
  })

  describe('listTables', () => {
    it('sends GET with baseId in URL', async () => {
      mock.onGet(`${API_BASE}/meta/bases/p_abc123/tables`).reply({
        list: [{ id: 'm_xyz789', title: 'Contacts' }],
      })

      const result = await service.listTables('p_abc123')

      expect(result.list).toHaveLength(1)
    })
  })

  describe('getTable', () => {
    it('sends GET with tableId in URL', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_xyz789`).reply({
        id: 'm_xyz789',
        title: 'Contacts',
        columns: [{ id: 'c_1', title: 'Name', uidt: 'SingleLineText' }],
      })

      const result = await service.getTable('m_xyz789')

      expect(result.title).toBe('Contacts')
      expect(result.columns).toHaveLength(1)
    })
  })

  describe('createTable', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/meta/bases/p_1/tables`).reply({
        id: 'm_new123',
        title: 'Projects',
      })

      const columns = [
        { title: 'Name', uidt: 'SingleLineText' },
        { title: 'Age', uidt: 'Number' },
      ]

      const result = await service.createTable('p_1', 'Projects', columns)

      expect(mock.history[0].body).toEqual({
        table_name: 'Projects',
        title: 'Projects',
        columns,
      })
      expect(result.id).toBe('m_new123')
    })

    it('sends empty array when columns is not an array', async () => {
      mock.onPost(`${API_BASE}/meta/bases/p_1/tables`).reply({ id: 'm_1' })

      await service.createTable('p_1', 'Test', 'invalid')

      expect(mock.history[0].body.columns).toEqual([])
    })
  })

  // ── Views ──

  describe('listViews', () => {
    it('sends GET with tableId in URL', async () => {
      mock.onGet(`${API_BASE}/meta/tables/m_xyz789/views`).reply({
        list: [{ id: 'v_abc123', title: 'Grid view', type: 'grid' }],
      })

      const result = await service.listViews('m_xyz789')

      expect(result.list).toHaveLength(1)
      expect(result.list[0].title).toBe('Grid view')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('uses error.body.msg when available', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).replyWithError({
        message: 'Bad Request',
        body: { msg: 'Invalid token' },
      })

      await expect(service.listBases()).rejects.toThrow('NocoDB API error: Invalid token')
    })

    it('uses error.body.message when msg is not available', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).replyWithError({
        message: 'Fail',
        body: { message: 'Forbidden' },
      })

      await expect(service.listBases()).rejects.toThrow('NocoDB API error: Forbidden')
    })

    it('uses error.body.error when msg and message are not available', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).replyWithError({
        message: 'Fail',
        body: { error: 'Not found' },
      })

      await expect(service.listBases()).rejects.toThrow('NocoDB API error: Not found')
    })

    it('uses error.message as fallback', async () => {
      mock.onGet(`${API_BASE}/meta/bases/`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listBases()).rejects.toThrow('NocoDB API error: Network timeout')
    })
  })

  // ── Constructor ──

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', async () => {
      // The service used by all tests was created with BASE_URL (no trailing slash).
      // Verify the URL used in requests does not contain a double slash before /api.
      mock.onGet(`${API_BASE}/meta/bases/`).reply({ list: [] })

      await service.listBases()

      expect(mock.history[0].url).toBe(`${BASE_URL}/api/v2/meta/bases/`)
      expect(mock.history[0].url).not.toMatch(/\/\/api/)
    })
  })
})
