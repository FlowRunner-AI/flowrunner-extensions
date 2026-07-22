'use strict'

const { createSandbox } = require('../../../service-sandbox')

const USER_TOKEN = 'test-user-token'
const REALM_HOSTNAME = 'testcompany.quickbase.com'
const BASE = 'https://api.quickbase.com/v1'

const EXPECTED_HEADERS = {
  'Authorization': `QB-USER-TOKEN ${ USER_TOKEN }`,
  'QB-Realm-Hostname': REALM_HOSTNAME,
  'Content-Type': 'application/json',
}

describe('QuickBase Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ userToken: USER_TOKEN, realmHostname: REALM_HOSTNAME })
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
          expect.objectContaining({ name: 'realmHostname', required: true, shared: false }),
          expect.objectContaining({ name: 'userToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns mapped table items', async () => {
      mock.onGet(`${BASE}/tables`).reply([
        { id: 'bqr5abc', name: 'Tasks' },
        { id: 'bqr5def', name: 'Projects' },
      ])

      const result = await service.getTablesDictionary({ criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Tasks', value: 'bqr5abc', note: 'ID: bqr5abc' })
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/tables`).reply([
        { id: 'bqr5abc', name: 'Tasks' },
        { id: 'bqr5def', name: 'Projects' },
      ])

      const result = await service.getTablesDictionary({ search: 'TASK', criteria: { appId: 'app1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('bqr5abc')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/tables`).reply([{ id: 'a', name: 'A' }])

      const result = await service.getTablesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles null response', async () => {
      mock.onGet(`${BASE}/tables`).reply(null)

      const result = await service.getTablesDictionary({})

      expect(result.items).toEqual([])
    })

    it('uses fallback label for unnamed table', async () => {
      mock.onGet(`${BASE}/tables`).reply([{ id: 'x' }])

      const result = await service.getTablesDictionary({})

      expect(result.items[0].label).toBe('[unnamed table]')
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns mapped field items with fid and type', async () => {
      mock.onGet(`${BASE}/fields`).reply([
        { id: 3, label: 'Record ID#', fieldType: 'recordid' },
        { id: 6, label: 'Title', fieldType: 'text' },
      ])

      const result = await service.getFieldsDictionary({ criteria: { tableId: 'tbl1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Record ID#',
        value: '3',
        note: 'fid: 3 (recordid)',
      })
      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/fields`).reply([
        { id: 3, label: 'Record ID#', fieldType: 'recordid' },
        { id: 6, label: 'Title', fieldType: 'text' },
      ])

      const result = await service.getFieldsDictionary({ search: 'title', criteria: { tableId: 'tbl1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('6')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/fields`).reply([{ id: 1, label: 'F' }])

      const result = await service.getFieldsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles field without fieldType', async () => {
      mock.onGet(`${BASE}/fields`).reply([{ id: 1, label: 'X' }])

      const result = await service.getFieldsDictionary({})

      expect(result.items[0].note).toBe('fid: 1')
    })

    it('uses fallback label for unnamed field', async () => {
      mock.onGet(`${BASE}/fields`).reply([{ id: 5 }])

      const result = await service.getFieldsDictionary({})

      expect(result.items[0].label).toBe('[field 5]')
    })
  })

  describe('getAppTablesDictionary', () => {
    it('delegates to getTablesDictionary', async () => {
      mock.onGet(`${BASE}/tables`).reply([{ id: 'tbl1', name: 'Alpha' }])

      const result = await service.getAppTablesDictionary({ criteria: { appId: 'a1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tbl1')
    })
  })

  // ── Records ──

  describe('queryRecords', () => {
    it('sends POST with required tableId only', async () => {
      mock.onPost(`${BASE}/records/query`).reply({
        data: [],
        fields: [],
        metadata: { numRecords: 0, totalRecords: 0 },
      })

      const result = await service.queryRecords('tbl1')

      expect(mock.history[0].body).toEqual({ from: 'tbl1' })
      expect(result.data).toEqual([])
    })

    it('includes select, where, sortBy, groupBy, options', async () => {
      mock.onPost(`${BASE}/records/query`).reply({
        data: [{ '6': { value: 'A' } }],
        fields: [{ id: 6, label: 'Title', type: 'text' }],
        metadata: { numRecords: 1, totalRecords: 10, skip: 5, top: 1 },
      })

      await service.queryRecords(
        'tbl1',
        ['3', '6'],
        '{6.CT.\'urgent\'}',
        [{ fieldId: 6, order: 'DESC' }],
        [{ fieldId: 6, grouping: 'equal-values' }],
        5,
        1
      )

      const body = mock.history[0].body

      expect(body.from).toBe('tbl1')
      expect(body.select).toEqual([3, 6])
      expect(body.where).toBe('{6.CT.\'urgent\'}')
      expect(body.sortBy).toEqual([{ fieldId: 6, order: 'DESC' }])
      expect(body.groupBy).toEqual([{ fieldId: 6, grouping: 'equal-values' }])
      expect(body.options).toEqual({ skip: 5, top: 1 })
    })

    it('omits options when skip and top are not provided', async () => {
      mock.onPost(`${BASE}/records/query`).reply({ data: [], fields: [], metadata: {} })

      await service.queryRecords('tbl1', ['3'])

      expect(mock.history[0].body.options).toBeUndefined()
    })

    it('includes fieldLabels when mapFieldLabels is true', async () => {
      mock.onPost(`${BASE}/records/query`).reply({
        data: [{ '6': { value: 'A' } }],
        fields: [{ id: 6, label: 'Title', type: 'text' }],
        metadata: { numRecords: 1 },
      })

      const result = await service.queryRecords('tbl1', null, null, null, null, null, null, true)

      expect(result.fieldLabels).toEqual({ '6': 'Title' })
    })

    it('does not include fieldLabels when mapFieldLabels is falsy', async () => {
      mock.onPost(`${BASE}/records/query`).reply({
        data: [],
        fields: [],
        metadata: {},
      })

      const result = await service.queryRecords('tbl1')

      expect(result.fieldLabels).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/records/query`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid query', description: 'Syntax error in where clause' },
      })

      await expect(service.queryRecords('tbl1')).rejects.toThrow('Quick Base API error')
    })
  })

  describe('upsertRecords', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/records`).reply({
        data: [],
        metadata: { createdRecordIds: [1], totalNumberOfRecordsProcessed: 1 },
      })

      await service.upsertRecords('tbl1', [{ '6': { value: 'Test' } }])

      const body = mock.history[0].body

      expect(body.to).toBe('tbl1')
      expect(body.data).toEqual([{ '6': { value: 'Test' } }])
      expect(body.mergeFieldId).toBeUndefined()
      expect(body.fieldsToReturn).toBeUndefined()
    })

    it('includes mergeFieldId and fieldsToReturn when provided', async () => {
      mock.onPost(`${BASE}/records`).reply({ data: [], metadata: {} })

      await service.upsertRecords('tbl1', [{ '3': { value: 1 } }], 3, ['3', '6'])

      const body = mock.history[0].body

      expect(body.mergeFieldId).toBe(3)
      expect(body.fieldsToReturn).toEqual([3, 6])
    })

    it('handles non-array data gracefully', async () => {
      mock.onPost(`${BASE}/records`).reply({ data: [], metadata: {} })

      await service.upsertRecords('tbl1', 'not-an-array')

      expect(mock.history[0].body.data).toEqual([])
    })
  })

  describe('deleteRecords', () => {
    it('sends DELETE with correct body', async () => {
      mock.onDelete(`${BASE}/records`).reply({ numberDeleted: 1 })

      const result = await service.deleteRecords('tbl1', '{3.EX.\'42\'}')

      expect(mock.history[0].body).toEqual({ from: 'tbl1', where: '{3.EX.\'42\'}' })
      expect(result.numberDeleted).toBe(1)
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('sends GET with appId query', async () => {
      mock.onGet(`${BASE}/tables`).reply([{ id: 'tbl1', name: 'Tasks' }])

      const result = await service.listTables('app1')

      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
      expect(result).toEqual([{ id: 'tbl1', name: 'Tasks' }])
    })
  })

  describe('getTable', () => {
    it('sends GET with tableId in URL and appId in query', async () => {
      mock.onGet(`${BASE}/tables/tbl1`).reply({ id: 'tbl1', name: 'Tasks', keyFieldId: 3 })

      const result = await service.getTable('app1', 'tbl1')

      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
      expect(result.name).toBe('Tasks')
    })
  })

  describe('createTable', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${BASE}/tables`).reply({ id: 'newtbl', name: 'Invoices' })

      await service.createTable('app1', 'Invoices')

      expect(mock.history[0].body).toEqual({ name: 'Invoices' })
      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/tables`).reply({ id: 'newtbl', name: 'Invoices' })

      await service.createTable('app1', 'Invoices', 'Billing invoices', 'Invoice', 'Invoices')

      const body = mock.history[0].body

      expect(body.name).toBe('Invoices')
      expect(body.description).toBe('Billing invoices')
      expect(body.singleRecordName).toBe('Invoice')
      expect(body.pluralRecordName).toBe('Invoices')
    })

    it('omits optional fields when empty', async () => {
      mock.onPost(`${BASE}/tables`).reply({ id: 'newtbl', name: 'T' })

      await service.createTable('app1', 'T', '', '', '')

      const body = mock.history[0].body

      expect(body.description).toBeUndefined()
      expect(body.singleRecordName).toBeUndefined()
      expect(body.pluralRecordName).toBeUndefined()
    })
  })

  describe('updateTable', () => {
    it('sends POST to table URL with appId query', async () => {
      mock.onPost(`${BASE}/tables/tbl1`).reply({ id: 'tbl1', name: 'Updated' })

      await service.updateTable('app1', 'tbl1', 'Updated')

      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
      expect(mock.history[0].body).toEqual({ name: 'Updated' })
    })

    it('includes description when non-empty', async () => {
      mock.onPost(`${BASE}/tables/tbl1`).reply({ id: 'tbl1' })

      await service.updateTable('app1', 'tbl1', null, 'New desc')

      expect(mock.history[0].body).toEqual({ description: 'New desc' })
    })

    it('omits description when empty string', async () => {
      mock.onPost(`${BASE}/tables/tbl1`).reply({ id: 'tbl1' })

      await service.updateTable('app1', 'tbl1', null, '')

      expect(mock.history[0].body.description).toBeUndefined()
    })
  })

  describe('deleteTable', () => {
    it('sends DELETE with appId query', async () => {
      mock.onDelete(`${BASE}/tables/tbl1`).reply({ deletedTableId: 'tbl1' })

      const result = await service.deleteTable('app1', 'tbl1')

      expect(mock.history[0].query).toMatchObject({ appId: 'app1' })
      expect(result.deletedTableId).toBe('tbl1')
    })
  })

  // ── Fields ──

  describe('listFields', () => {
    it('sends GET with tableId query', async () => {
      mock.onGet(`${BASE}/fields`).reply([{ id: 3, label: 'Record ID#', fieldType: 'recordid' }])

      const result = await service.listFields('tbl1')

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(result).toHaveLength(1)
    })
  })

  describe('getField', () => {
    it('sends GET with fieldId in URL and tableId in query', async () => {
      mock.onGet(`${BASE}/fields/6`).reply({ id: 6, label: 'Title', fieldType: 'text' })

      const result = await service.getField('tbl1', 6)

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(result.label).toBe('Title')
    })
  })

  describe('createField', () => {
    it('sends POST with label and resolved fieldType', async () => {
      mock.onPost(`${BASE}/fields`).reply({ id: 10, label: 'Amount', fieldType: 'numeric' })

      await service.createField('tbl1', 'Amount', 'Numeric')

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(mock.history[0].body).toEqual({ label: 'Amount', fieldType: 'numeric' })
    })

    it('passes through unknown fieldType unchanged', async () => {
      mock.onPost(`${BASE}/fields`).reply({ id: 11, label: 'Custom', fieldType: 'custom-type' })

      await service.createField('tbl1', 'Custom', 'custom-type')

      expect(mock.history[0].body.fieldType).toBe('custom-type')
    })

    it('includes required and unique flags when set', async () => {
      mock.onPost(`${BASE}/fields`).reply({ id: 12, label: 'Email', fieldType: 'email' })

      await service.createField('tbl1', 'Email', 'Email', true, true)

      const body = mock.history[0].body

      expect(body.fieldType).toBe('email')
      expect(body.required).toBe(true)
      expect(body.unique).toBe(true)
    })

    it('omits required and unique when not provided', async () => {
      mock.onPost(`${BASE}/fields`).reply({ id: 13, label: 'Note', fieldType: 'text' })

      await service.createField('tbl1', 'Note', 'Text')

      expect(mock.history[0].body.required).toBeUndefined()
      expect(mock.history[0].body.unique).toBeUndefined()
    })

    it('resolves all dropdown labels to API tokens', async () => {
      const mappings = {
        'Text': 'text',
        'Text - Multiple Choice': 'text-multiple-choice',
        'Rich Text': 'rich-text',
        'Numeric': 'numeric',
        'Currency': 'currency',
        'Percent': 'percent',
        'Rating': 'rating',
        'Date': 'date',
        'Date / Time': 'datetime',
        'Time of Day': 'timeofday',
        'Duration': 'duration',
        'Checkbox': 'checkbox',
        'Phone Number': 'phone',
        'Email': 'email',
        'URL': 'url',
        'User': 'user',
        'List - User': 'multiuser',
        'Address': 'address',
        'File Attachment': 'file',
      }

      for (const [label, expected] of Object.entries(mappings)) {
        mock.reset()
        mock.onPost(`${BASE}/fields`).reply({ id: 99, label: 'F', fieldType: expected })

        await service.createField('tbl1', 'F', label)

        expect(mock.history[0].body.fieldType).toBe(expected)
      }
    })
  })

  describe('deleteFields', () => {
    it('sends DELETE with numeric field IDs', async () => {
      mock.onDelete(`${BASE}/fields`).reply({ deletedFieldIds: [10, 11], errors: [] })

      const result = await service.deleteFields('tbl1', ['10', '11'])

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(mock.history[0].body).toEqual({ fieldIds: [10, 11] })
      expect(result.deletedFieldIds).toEqual([10, 11])
    })

    it('handles non-array fieldIds gracefully', async () => {
      mock.onDelete(`${BASE}/fields`).reply({ deletedFieldIds: [], errors: [] })

      await service.deleteFields('tbl1', null)

      expect(mock.history[0].body).toEqual({ fieldIds: [] })
    })
  })

  // ── Apps ──

  describe('getApp', () => {
    it('sends GET with appId in URL', async () => {
      mock.onGet(`${BASE}/apps/app1`).reply({ id: 'app1', name: 'Project Tracker' })

      const result = await service.getApp('app1')

      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(result.name).toBe('Project Tracker')
    })

    it('throws on API error with description', async () => {
      mock.onGet(`${BASE}/apps/bad`).replyWithError({
        message: 'Not Found',
        body: { message: 'App not found', description: 'No app with that ID' },
      })

      await expect(service.getApp('bad')).rejects.toThrow('Quick Base API error: App not found - No app with that ID')
    })

    it('throws with error.message fallback when body is missing', async () => {
      mock.onGet(`${BASE}/apps/bad`).replyWithError({ message: 'Network error' })

      await expect(service.getApp('bad')).rejects.toThrow('Quick Base API error: Network error')
    })
  })

  // ── Reports ──

  describe('listReports', () => {
    it('sends GET with tableId query', async () => {
      mock.onGet(`${BASE}/reports`).reply([{ id: '1', name: 'List All', type: 'table' }])

      const result = await service.listReports('tbl1')

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(result).toHaveLength(1)
    })
  })

  describe('runReport', () => {
    it('sends POST with tableId in query', async () => {
      mock.onPost(`${BASE}/reports/1/run`).reply({
        data: [{ '3': { value: 1 } }],
        fields: [],
        metadata: { numRecords: 1 },
      })

      const result = await service.runReport('tbl1', '1')

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1' })
      expect(result.data).toHaveLength(1)
    })

    it('includes skip and top when provided', async () => {
      mock.onPost(`${BASE}/reports/1/run`).reply({ data: [], fields: [], metadata: {} })

      await service.runReport('tbl1', '1', 10, 5)

      expect(mock.history[0].query).toMatchObject({ tableId: 'tbl1', skip: 10, top: 5 })
    })

    it('omits skip and top when not provided', async () => {
      mock.onPost(`${BASE}/reports/1/run`).reply({ data: [], fields: [], metadata: {} })

      await service.runReport('tbl1', '1')

      expect(mock.history[0].query.skip).toBeUndefined()
      expect(mock.history[0].query.top).toBeUndefined()
    })
  })

  // ── Files ──

  describe('downloadFile', () => {
    let originalFlowrunner

    beforeEach(() => {
      originalFlowrunner = service.flowrunner
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/test.pdf' }),
        },
      }
    })

    afterEach(() => {
      service.flowrunner = originalFlowrunner
    })

    it('downloads file, decodes base64, and uploads to storage', async () => {
      const base64Content = Buffer.from('hello world').toString('base64')

      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply(base64Content)

      const result = await service.downloadFile('tbl1', 1, 7, 0, 'test.pdf')

      expect(result.url).toBe('https://files.flowrunner.com/test.pdf')
      expect(result.filename).toBe('test.pdf')
      expect(result.size).toBe(11)

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'test.pdf', generateUrl: true, overwrite: true })
      )
    })

    it('handles base64 in object data property', async () => {
      const base64Content = Buffer.from('file data').toString('base64')

      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply({ data: base64Content })

      const result = await service.downloadFile('tbl1', 1, 7, 0, 'doc.pdf')

      expect(result.size).toBe(9)
    })

    it('defaults version to 0 when not provided', async () => {
      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply('')

      await service.downloadFile('tbl1', 1, 7, undefined, 'f.pdf')

      expect(mock.history[0].url).toBe(`${BASE}/files/tbl1/1/7/0`)
    })

    it('generates filename when not provided', async () => {
      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply('')

      const result = await service.downloadFile('tbl1', 1, 7, 0)

      expect(result.filename).toMatch(/^quickbase_\d+$/)
    })

    it('passes fileOptions to upload when provided', async () => {
      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply('')

      await service.downloadFile('tbl1', 1, 7, 0, 'f.pdf', { scope: 'APP' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'APP' })
      )
    })

    it('defaults fileOptions to scope FLOW when not provided', async () => {
      mock.onGet(`${BASE}/files/tbl1/1/7/0`).reply('')

      await service.downloadFile('tbl1', 1, 7, 0, 'f.pdf')

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'FLOW' })
      )
    })
  })
})
