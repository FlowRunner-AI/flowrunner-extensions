'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT_NAME = 'testaccount'
const ACCOUNT_KEY = Buffer.from('fake-account-key-for-testing').toString('base64')
const BASE = `https://${ ACCOUNT_NAME }.table.core.windows.net`

describe('Azure Table Storage Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accountName: ACCOUNT_NAME, accountKey: ACCOUNT_KEY })
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
          name: 'accountName',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accountKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Common headers ──

  describe('common request headers', () => {
    it('sends correct Azure headers on every request', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      await service.listTables()

      expect(mock.history).toHaveLength(1)
      const headers = mock.history[0].headers

      expect(headers).toHaveProperty('x-ms-date')
      expect(headers).toHaveProperty('x-ms-version', '2019-02-02')
      expect(headers['Authorization']).toMatch(new RegExp(`^SharedKeyLite ${ ACCOUNT_NAME }:`))
      expect(headers['Accept']).toBe('application/json;odata=nometadata')
      expect(headers['DataServiceVersion']).toBe('3.0;NetFx')
      expect(headers['MaxDataServiceVersion']).toBe('3.0;NetFx')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('sends GET to /Tables with no query params by default', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [{ TableName: 'Customers' }] }, headers: {} })

      const result = await service.listTables()

      expect(result).toEqual({
        tables: [{ TableName: 'Customers' }],
        nextTableName: null,
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes continuation token as NextTableName query param', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      await service.listTables('nextToken123')

      expect(mock.history[0].query).toMatchObject({ NextTableName: 'nextToken123' })
    })

    it('returns nextTableName from response headers', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({
        body: { value: [{ TableName: 'T1' }] },
        headers: { 'x-ms-continuation-nexttablename': 'T2' },
      })

      const result = await service.listTables()

      expect(result.nextTableName).toBe('T2')
    })
  })

  describe('createTable', () => {
    it('sends POST to /Tables with TableName in body', async () => {
      mock.onPost(`${ BASE }/Tables`).reply({ TableName: 'NewTable' })

      const result = await service.createTable('NewTable')

      expect(result).toEqual({ TableName: 'NewTable' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ TableName: 'NewTable' })
      expect(mock.history[0].headers['Content-Type']).toBe('application/json')
    })

    it('throws when tableName is not provided', async () => {
      await expect(service.createTable()).rejects.toThrow('tableName is required.')
    })
  })

  describe('deleteTable', () => {
    it('sends DELETE to /Tables with encoded table name', async () => {
      mock.onDelete(`${ BASE }/Tables('TestTable')`).reply(undefined)

      const result = await service.deleteTable('TestTable')

      expect(result).toEqual({ success: true, tableName: 'TestTable' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when tableName is not provided', async () => {
      await expect(service.deleteTable()).rejects.toThrow('tableName is required.')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/Tables('Missing')`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.deleteTable('Missing')).rejects.toThrow('Azure Table Storage API error')
    })
  })

  describe('queryTables', () => {
    it('sends GET to /Tables with no query params when none provided', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      const result = await service.queryTables()

      expect(result).toEqual({ tables: [], nextTableName: null })
      expect(mock.history).toHaveLength(1)
    })

    it('passes filter, top, and continuation token as query params', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      await service.queryTables("TableName eq 'Customers'", 10, 'nextToken')

      expect(mock.history[0].query).toMatchObject({
        $filter: "TableName eq 'Customers'",
        $top: 10,
        NextTableName: 'nextToken',
      })
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      await service.queryTables(undefined, undefined, undefined)

      const query = mock.history[0].query

      expect(query).not.toHaveProperty('$filter')
      expect(query).not.toHaveProperty('$top')
      expect(query).not.toHaveProperty('NextTableName')
    })
  })

  // ── Entities ──

  describe('queryEntities', () => {
    it('sends GET to /{tableName}() with no optional params', async () => {
      mock.onGet(`${ BASE }/MyTable()`).reply({
        body: { value: [{ PartitionKey: 'p1', RowKey: 'r1', Name: 'Ada' }] },
        headers: {},
      })

      const result = await service.queryEntities('MyTable')

      expect(result).toEqual({
        value: [{ PartitionKey: 'p1', RowKey: 'r1', Name: 'Ada' }],
        nextPartitionKey: null,
        nextRowKey: null,
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes all optional query params', async () => {
      mock.onGet(`${ BASE }/MyTable()`).reply({ body: { value: [] }, headers: {} })

      await service.queryEntities('MyTable', "Age gt 30", 'Name,Age', 5, 'npk', 'nrk')

      expect(mock.history[0].query).toMatchObject({
        $filter: 'Age gt 30',
        $select: 'Name,Age',
        $top: 5,
        NextPartitionKey: 'npk',
        NextRowKey: 'nrk',
      })
    })

    it('returns continuation tokens from response headers', async () => {
      mock.onGet(`${ BASE }/MyTable()`).reply({
        body: { value: [] },
        headers: {
          'x-ms-continuation-nextpartitionkey': 'pk2',
          'x-ms-continuation-nextrowkey': 'rk2',
        },
      })

      const result = await service.queryEntities('MyTable')

      expect(result.nextPartitionKey).toBe('pk2')
      expect(result.nextRowKey).toBe('rk2')
    })

    it('throws when tableName is not provided', async () => {
      await expect(service.queryEntities()).rejects.toThrow('tableName is required.')
    })
  })

  describe('getEntity', () => {
    it('sends GET to entity path with partition and row keys', async () => {
      mock.onGet(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply({
        PartitionKey: 'us', RowKey: '1', Name: 'Ada',
      })

      const result = await service.getEntity('MyTable', 'us', '1')

      expect(result).toEqual({ PartitionKey: 'us', RowKey: '1', Name: 'Ada' })
      expect(mock.history).toHaveLength(1)
    })

    it('passes $select query param when provided', async () => {
      mock.onGet(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply({
        PartitionKey: 'us', RowKey: '1', Name: 'Ada',
      })

      await service.getEntity('MyTable', 'us', '1', 'Name,Age')

      expect(mock.history[0].query).toMatchObject({ $select: 'Name,Age' })
    })

    it('throws when tableName is missing', async () => {
      await expect(service.getEntity(undefined, 'us', '1')).rejects.toThrow('tableName is required.')
    })

    it('throws when partitionKey is missing', async () => {
      await expect(service.getEntity('MyTable', undefined, '1')).rejects.toThrow('partitionKey is required.')
    })

    it('throws when rowKey is missing', async () => {
      await expect(service.getEntity('MyTable', 'us')).rejects.toThrow('rowKey is required.')
    })
  })

  describe('insertEntity', () => {
    it('sends POST to /{tableName} with body containing keys and properties', async () => {
      mock.onPost(`${ BASE }/MyTable`).reply({
        PartitionKey: 'us', RowKey: '1', Name: 'Ada', Age: 30,
      })

      const result = await service.insertEntity('MyTable', 'us', '1', { Name: 'Ada', Age: 30 })

      expect(result).toEqual({ PartitionKey: 'us', RowKey: '1', Name: 'Ada', Age: 30 })
      expect(mock.history[0].body).toEqual({
        PartitionKey: 'us', RowKey: '1', Name: 'Ada', Age: 30,
      })
    })

    it('sends body with only keys when no properties provided', async () => {
      mock.onPost(`${ BASE }/MyTable`).reply({ PartitionKey: 'us', RowKey: '1' })

      await service.insertEntity('MyTable', 'us', '1')

      expect(mock.history[0].body).toEqual({ PartitionKey: 'us', RowKey: '1' })
    })

    it('throws when tableName is missing', async () => {
      await expect(service.insertEntity(undefined, 'us', '1')).rejects.toThrow('tableName is required.')
    })

    it('throws when partitionKey is missing', async () => {
      await expect(service.insertEntity('MyTable', undefined, '1')).rejects.toThrow('partitionKey is required.')
    })

    it('throws when rowKey is missing', async () => {
      await expect(service.insertEntity('MyTable', 'us')).rejects.toThrow('rowKey is required.')
    })
  })

  describe('updateEntity', () => {
    it('sends PUT to entity path with If-Match:* header', async () => {
      mock.onPut(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply(undefined)

      const result = await service.updateEntity('MyTable', 'us', '1', { Name: 'Updated' })

      expect(result).toEqual({ success: true, PartitionKey: 'us', RowKey: '1' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers['If-Match']).toBe('*')
      expect(mock.history[0].body).toEqual({
        PartitionKey: 'us', RowKey: '1', Name: 'Updated',
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.updateEntity()).rejects.toThrow('tableName is required.')
      await expect(service.updateEntity('T', undefined, '1')).rejects.toThrow('partitionKey is required.')
      await expect(service.updateEntity('T', 'p')).rejects.toThrow('rowKey is required.')
    })
  })

  describe('mergeEntity', () => {
    it('sends POST to entity path with X-HTTP-Method:MERGE and If-Match:* headers', async () => {
      mock.onPost(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply(undefined)

      const result = await service.mergeEntity('MyTable', 'us', '1', { Age: 31 })

      expect(result).toEqual({ success: true, PartitionKey: 'us', RowKey: '1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['If-Match']).toBe('*')
      expect(mock.history[0].headers['X-HTTP-Method']).toBe('MERGE')
      expect(mock.history[0].body).toEqual({
        PartitionKey: 'us', RowKey: '1', Age: 31,
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.mergeEntity()).rejects.toThrow('tableName is required.')
    })
  })

  describe('insertOrReplaceEntity', () => {
    it('sends PUT to entity path without If-Match header', async () => {
      mock.onPut(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply(undefined)

      const result = await service.insertOrReplaceEntity('MyTable', 'us', '1', { Name: 'Ada' })

      expect(result).toEqual({ success: true, PartitionKey: 'us', RowKey: '1' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers['If-Match']).toBeUndefined()
      expect(mock.history[0].body).toEqual({
        PartitionKey: 'us', RowKey: '1', Name: 'Ada',
      })
    })

    it('throws when required params are missing', async () => {
      await expect(service.insertOrReplaceEntity()).rejects.toThrow('tableName is required.')
    })
  })

  describe('insertOrMergeEntity', () => {
    it('sends POST to entity path with X-HTTP-Method:MERGE but no If-Match header', async () => {
      mock.onPost(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply(undefined)

      const result = await service.insertOrMergeEntity('MyTable', 'us', '1', { Name: 'Ada' })

      expect(result).toEqual({ success: true, PartitionKey: 'us', RowKey: '1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['X-HTTP-Method']).toBe('MERGE')
      expect(mock.history[0].headers['If-Match']).toBeUndefined()
    })

    it('throws when required params are missing', async () => {
      await expect(service.insertOrMergeEntity()).rejects.toThrow('tableName is required.')
    })
  })

  describe('deleteEntity', () => {
    it('sends DELETE to entity path with If-Match:* header', async () => {
      mock.onDelete(`${ BASE }/MyTable(PartitionKey='us',RowKey='1')`).reply(undefined)

      const result = await service.deleteEntity('MyTable', 'us', '1')

      expect(result).toEqual({ success: true, PartitionKey: 'us', RowKey: '1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers['If-Match']).toBe('*')
    })

    it('throws when required params are missing', async () => {
      await expect(service.deleteEntity()).rejects.toThrow('tableName is required.')
      await expect(service.deleteEntity('T', undefined, '1')).rejects.toThrow('partitionKey is required.')
      await expect(service.deleteEntity('T', 'p')).rejects.toThrow('rowKey is required.')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/MyTable(PartitionKey='us',RowKey='missing')`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { 'odata.error': { code: 'ResourceNotFound', message: { value: 'The specified resource does not exist.' } } },
      })

      await expect(service.deleteEntity('MyTable', 'us', 'missing')).rejects.toThrow('Azure Table Storage API error')
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns tables formatted as dictionary items', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({
        body: { value: [{ TableName: 'Customers' }, { TableName: 'Orders' }] },
        headers: {},
      })

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Customers', value: 'Customers', note: 'Table' },
          { label: 'Orders', value: 'Orders', note: 'Table' },
        ],
        cursor: null,
      })
    })

    it('filters tables by search string (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({
        body: { value: [{ TableName: 'Customers' }, { TableName: 'Orders' }] },
        headers: {},
      })

      const result = await service.getTablesDictionary({ search: 'cust' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Customers')
    })

    it('passes cursor as NextTableName query param', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      await service.getTablesDictionary({ cursor: 'cursorToken' })

      expect(mock.history[0].query).toMatchObject({ NextTableName: 'cursorToken' })
    })

    it('returns cursor from continuation header', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({
        body: { value: [] },
        headers: { 'x-ms-continuation-nexttablename': 'nextCursor' },
      })

      const result = await service.getTablesDictionary({})

      expect(result.cursor).toBe('nextCursor')
    })

    it('handles empty/null payload', async () => {
      mock.onGet(`${ BASE }/Tables`).reply({ body: { value: [] }, headers: {} })

      const result = await service.getTablesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats OData error from response body', async () => {
      mock.onGet(`${ BASE }/Tables`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: {
          'odata.error': {
            code: 'AuthorizationFailure',
            message: { value: 'This request is not authorized.' },
          },
        },
      })

      await expect(service.listTables()).rejects.toThrow(
        'Azure Table Storage API error (403) [AuthorizationFailure]: This request is not authorized.'
      )
    })

    it('handles error without OData body', async () => {
      mock.onGet(`${ BASE }/Tables`).replyWithError({
        message: 'Server Error',
        status: 500,
      })

      await expect(service.listTables()).rejects.toThrow('Azure Table Storage API error (500): Server Error')
    })
  })

  // ── Key encoding ──

  describe('key encoding', () => {
    it('handles keys with single quotes (O\'Brien pattern)', async () => {
      // O'Brien -> O''Brien -> URL-encoded in the path
      mock.onGet(new RegExp(`${ BASE }/MyTable`)).reply({ PartitionKey: "O'Brien", RowKey: '1' })

      await service.getEntity('MyTable', "O'Brien", '1')

      expect(mock.history[0].url).toContain("O''Brien")
    })
  })
})
