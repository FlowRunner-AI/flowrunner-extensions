'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT = 'myorg-myaccount'
const TOKEN = 'test-pat-token'
const BASE = `https://${ ACCOUNT }.snowflakecomputing.com/api/v2`
const STATEMENTS_URL = `${ BASE }/statements`

const EXPECTED_HEADERS = {
  'Authorization': `Bearer ${ TOKEN }`,
  'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'flowrunner-snowflake/1.0',
}

const DEFAULTS = {
  accountIdentifier: ACCOUNT,
  token: TOKEN,
  database: 'DEMO_DB',
  schema: 'PUBLIC',
  warehouse: 'COMPUTE_WH',
  role: 'ANALYST',
}

// Builds a SQL API response for a SHOW-style statement returning named text columns.
function showResponse(columns, rows, extra = {}) {
  return {
    statementHandle: 'handle-1',
    resultSetMetaData: {
      numRows: rows.length,
      rowType: columns.map(name => ({ name, type: 'text' })),
      ...extra,
    },
    data: rows,
  }
}

function bootstrap(config) {
  jest.resetModules()

  const sandbox = createSandbox(config)

  require('../src/index.js')

  return sandbox
}

describe('Snowflake Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = bootstrap(DEFAULTS)
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

      expect(configItems.map(item => item.name)).toEqual([
        'accountIdentifier', 'token', 'database', 'schema', 'warehouse', 'role',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accountIdentifier', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'token', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'database', required: false, shared: false }),
          expect.objectContaining({ name: 'schema', required: false, shared: false }),
          expect.objectContaining({ name: 'warehouse', required: false, shared: false }),
          expect.objectContaining({ name: 'role', required: false, shared: false }),
        ])
      )
    })

    it('normalizes the account identifier', () => {
      const cases = [
        ['myorg-myaccount', 'myorg-myaccount'],
        ['  xy12345.us-east-1  ', 'xy12345.us-east-1'],
        ['https://myorg-myaccount.snowflakecomputing.com', 'myorg-myaccount'],
        ['https://myorg-myaccount.snowflakecomputing.com/some/path', 'myorg-myaccount'],
        ['MY_ORG_ACCOUNT', 'MY-ORG-ACCOUNT'],
        ['myorg-myaccount/extra', 'myorg-myaccount'],
      ]

      for (const [input, expected] of cases) {
        const local = bootstrap({ accountIdentifier: input, token: TOKEN })

        expect(local.getService().accountIdentifier).toBe(expected)
        local.cleanup()
      }

      // restore the shared sandbox for the remaining tests
      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('trims the configured defaults', () => {
      const local = bootstrap({
        accountIdentifier: ACCOUNT,
        token: '  tok  ',
        database: ' DB ',
        schema: ' SC ',
        warehouse: ' WH ',
        role: ' RL ',
      })
      const svc = local.getService()

      expect(svc.token).toBe('tok')
      expect(svc.database).toBe('DB')
      expect(svc.schema).toBe('SC')
      expect(svc.warehouse).toBe('WH')
      expect(svc.role).toBe('RL')

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('tolerates a missing config object', () => {
      const local = bootstrap(undefined)

      expect(local.getService().accountIdentifier).toBe('')

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('throws a configuration error when the account identifier is missing', async () => {
      const local = bootstrap({ token: TOKEN })
      const svc = local.getService()

      await expect(svc.executeSql('SELECT 1')).rejects.toThrow(
        /Account Identifier is not configured/
      )

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  // ── executeSql ──

  describe('executeSql', () => {
    it('rejects an empty or non-string statement', async () => {
      await expect(service.executeSql()).rejects.toThrow('SQL statement is required.')
      await expect(service.executeSql('   ')).rejects.toThrow('SQL statement is required.')
      await expect(service.executeSql(42)).rejects.toThrow('SQL statement is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('posts the statement with the configured context and auth headers', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['N'], [['1']]))

      await service.executeSql('SELECT 1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].query).toEqual({ async: false })

      expect(mock.history[0].body).toEqual({
        statement: 'SELECT 1',
        database: 'DEMO_DB',
        schema: 'PUBLIC',
        warehouse: 'COMPUTE_WH',
        role: 'ANALYST',
      })
    })

    it('lets per-request context override the configured defaults', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['N'], []))

      await service.executeSql('SELECT 1', undefined, 'OTHER_DB', 'OTHER_SC', 'OTHER_WH', 'OTHER_ROLE')

      expect(mock.history[0].body).toEqual({
        statement: 'SELECT 1',
        database: 'OTHER_DB',
        schema: 'OTHER_SC',
        warehouse: 'OTHER_WH',
        role: 'OTHER_ROLE',
      })
    })

    it('omits context entirely when nothing is configured or supplied', async () => {
      const local = bootstrap({ accountIdentifier: ACCOUNT, token: TOKEN })
      const svc = local.getService()
      const localMock = local.getRequestMock()

      localMock.onPost(STATEMENTS_URL).reply(showResponse(['N'], []))

      await svc.executeSql('SELECT 1')

      expect(localMock.history[0].body).toEqual({ statement: 'SELECT 1' })

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('includes a positive timeout and ignores invalid ones', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['N'], []))

      await service.executeSql('SELECT 1', undefined, undefined, undefined, undefined, undefined, '120')

      expect(mock.history[0].body.timeout).toBe(120)

      await service.executeSql('SELECT 1', undefined, undefined, undefined, undefined, undefined, 'soon')

      expect(mock.history[1].body.timeout).toBeUndefined()

      await service.executeSql('SELECT 1', undefined, undefined, undefined, undefined, undefined, 0)

      expect(mock.history[2].body.timeout).toBeUndefined()
    })

    it('converts positional parameters into SQL API bindings', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['N'], []))

      await service.executeSql('SELECT ?', ['text', 7, 2.5, true, null, { a: 1 }])

      expect(mock.history[0].body.bindings).toEqual({
        1: { type: 'TEXT', value: 'text' },
        2: { type: 'FIXED', value: '7' },
        3: { type: 'REAL', value: '2.5' },
        4: { type: 'BOOLEAN', value: 'true' },
        5: { type: 'TEXT', value: null },
        6: { type: 'TEXT', value: '{"a":1}' },
      })
    })

    it('omits bindings for an empty or non-array parameter list', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['N'], []))

      await service.executeSql('SELECT 1', [])

      expect(mock.history[0].body.bindings).toBeUndefined()

      await service.executeSql('SELECT 1', 'nope')

      expect(mock.history[1].body.bindings).toBeUndefined()
    })

    it('converts result rows into objects with light type coercion', async () => {
      mock.onPost(STATEMENTS_URL).reply({
        statementHandle: 'h-1',
        resultSetMetaData: {
          numRows: 2,
          rowType: [
            { name: 'ID', type: 'fixed' },
            { name: 'AMOUNT', type: 'REAL' },
            { name: 'ACTIVE', type: 'boolean' },
            { name: 'NAME', type: 'text' },
            { name: 'BIG_ID', type: 'fixed' },
            { name: 'MISSING', type: 'text' },
          ],
          partitionInfo: [{ rowCount: 2 }],
        },
        data: [
          ['1', '2.5', 'true', 'Alice', '12345678901234567890123456789012345678', null],
          ['2', '3', '0', 'Bob', '99999999999999999999999999999999999999', undefined],
        ],
      })

      const result = await service.executeSql('SELECT *')

      expect(result.rows).toEqual([
        {
          ID: 1,
          AMOUNT: 2.5,
          ACTIVE: true,
          NAME: 'Alice',
          BIG_ID: '12345678901234567890123456789012345678',
          MISSING: null,
        },
        {
          ID: 2,
          AMOUNT: 3,
          ACTIVE: false,
          NAME: 'Bob',
          BIG_ID: '99999999999999999999999999999999999999',
          MISSING: null,
        },
      ])

      expect(result.rowCount).toBe(2)
      expect(result.returnedRowCount).toBe(2)
      expect(result.statementHandle).toBe('h-1')
      expect(result.partitionCount).toBeUndefined()
    })

    it('falls back to the returned row count when numRows is absent', async () => {
      mock.onPost(STATEMENTS_URL).reply({
        statementHandle: null,
        resultSetMetaData: { rowType: [{ name: 'N', type: 'text' }] },
        data: [['a']],
      })

      const result = await service.executeSql('SELECT 1')

      expect(result).toEqual({
        rows: [{ N: 'a' }],
        rowCount: 1,
        returnedRowCount: 1,
        statementHandle: null,
      })
    })

    it('reports partition information when the result set is split', async () => {
      mock.onPost(STATEMENTS_URL).reply({
        statementHandle: 'h-2',
        resultSetMetaData: {
          numRows: 300,
          rowType: [{ name: 'N', type: 'text' }],
          partitionInfo: [{ rowCount: 100 }, { rowCount: 100 }, { rowCount: 100 }],
        },
        data: [['a']],
      })

      const result = await service.executeSql('SELECT 1')

      expect(result.partitionCount).toBe(3)

      expect(result.partitions).toEqual([
        { partition: 0, rowCount: 100 },
        { partition: 1, rowCount: 100 },
        { partition: 2, rowCount: 100 },
      ])

      expect(result.note).toMatch(/only partition 0 is included/)
    })

    it('returns an in-progress marker when the statement is still running', async () => {
      mock.onPost(STATEMENTS_URL).reply({ statementHandle: 'h-3' })

      const result = await service.executeSql('CALL long_running()')

      expect(result).toEqual({
        inProgress: true,
        statementHandle: 'h-3',
        message: expect.stringContaining('still executing'),
      })
    })

    it('wraps API errors with the Snowflake code and sqlState', async () => {
      mock.onPost(STATEMENTS_URL).replyWithError({
        message: 'Request failed',
        body: { message: 'SQL compilation error', code: '000904', sqlState: '42000' },
      })

      await expect(service.executeSql('SELECT bad')).rejects.toThrow(
        'Snowflake API error: SQL compilation error | code: 000904 | sqlState: 42000'
      )
    })

    it('falls back to the transport error message when no body is present', async () => {
      mock.onPost(STATEMENTS_URL).replyWithError({ message: 'socket hang up' })

      await expect(service.executeSql('SELECT 1')).rejects.toThrow('Snowflake API error: socket hang up')
    })
  })

  // ── getStatementResults ──

  describe('getStatementResults', () => {
    const HANDLE = '01b2c3d4-0000-abcd'
    const HANDLE_URL = `${ BASE }/statements/${ encodeURIComponent(HANDLE) }`

    it('requires a statement handle', async () => {
      await expect(service.getStatementResults('')).rejects.toThrow(
        'Statement Handle is required. Provide it as a parameter or set a default in the service configuration.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('fetches partition 0 by default', async () => {
      mock.onGet(HANDLE_URL).reply(showResponse(['N'], [['a']]))

      const result = await service.getStatementResults(HANDLE)

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ partition: 0 })
      expect(result.partition).toBe(0)
      expect(result.rows).toEqual([{ N: 'a' }])
      expect(result.statementHandle).toBe('handle-1')
    })

    it('coerces an invalid partition number to 0', async () => {
      mock.onGet(HANDLE_URL).reply(showResponse(['N'], []))

      await service.getStatementResults(HANDLE, 'abc')

      expect(mock.history[0].query).toEqual({ partition: 0 })
    })

    it('fetches column metadata from partition 0 when a later partition omits it', async () => {
      mock.onGet(HANDLE_URL).replyWith(callRecord => {
        if (callRecord.query.partition === 2) {
          return { data: [['x'], ['y']] }
        }

        return showResponse(['N'], [['a']])
      })

      const result = await service.getStatementResults(HANDLE, 2)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].query).toEqual({})
      expect(result.partition).toBe(2)
      expect(result.rows).toEqual([{ N: 'x' }, { N: 'y' }])
      expect(result.statementHandle).toBe(HANDLE)
    })

    it('returns an in-progress marker while the statement runs', async () => {
      mock.onGet(HANDLE_URL).reply({ statementHandle: HANDLE })

      await expect(service.getStatementResults(HANDLE)).resolves.toEqual({
        inProgress: true,
        statementHandle: HANDLE,
        message: expect.stringContaining('still executing'),
      })
    })

    it('wraps API errors', async () => {
      mock.onGet(HANDLE_URL).replyWithError({ message: 'boom', body: { message: 'Unknown handle' } })

      await expect(service.getStatementResults(HANDLE)).rejects.toThrow('Snowflake API error: Unknown handle')
    })
  })

  // ── cancelStatement ──

  describe('cancelStatement', () => {
    const HANDLE = 'handle-9'
    const CANCEL_URL = `${ BASE }/statements/${ encodeURIComponent(HANDLE) }/cancel`

    it('requires a statement handle', async () => {
      await expect(service.cancelStatement()).rejects.toThrow('Statement Handle is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('posts a cancel request and returns the status fields', async () => {
      mock.onPost(CANCEL_URL).reply({
        statementHandle: HANDLE,
        message: 'Statement canceled',
        code: '000605',
        sqlState: '57014',
      })

      const result = await service.cancelStatement(HANDLE)

      expect(mock.history[0].body).toEqual({})

      expect(result).toEqual({
        statementHandle: HANDLE,
        message: 'Statement canceled',
        code: '000605',
        sqlState: '57014',
      })
    })

    it('falls back to the supplied handle and null status fields', async () => {
      mock.onPost(CANCEL_URL).reply({})

      await expect(service.cancelStatement(HANDLE)).resolves.toEqual({
        statementHandle: HANDLE,
        message: null,
        code: null,
        sqlState: null,
      })
    })
  })

  // ── Metadata ──

  describe('listDatabases', () => {
    it('runs SHOW DATABASES and returns the rows', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'owner'], [['DEMO_DB', 'SYSADMIN']]))

      const result = await service.listDatabases()

      expect(mock.history[0].body).toEqual({
        statement: 'SHOW DATABASES',
        timeout: 60,
        database: 'DEMO_DB',
        schema: 'PUBLIC',
        warehouse: 'COMPUTE_WH',
        role: 'ANALYST',
      })

      expect(result).toEqual({ databases: [{ name: 'DEMO_DB', owner: 'SYSADMIN' }], count: 1 })
    })

    it('throws when the metadata statement is still executing', async () => {
      mock.onPost(STATEMENTS_URL).reply({ statementHandle: 'h-async' })

      await expect(service.listDatabases()).rejects.toThrow(
        /statement is still executing \(handle h-async\)/
      )
    })
  })

  describe('listSchemas', () => {
    it('uses the configured database by default', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name'], [['PUBLIC']]))

      const result = await service.listSchemas()

      expect(mock.history[0].body.statement).toBe('SHOW SCHEMAS IN DATABASE "DEMO_DB"')
      expect(result).toEqual({ database: 'DEMO_DB', schemas: [{ name: 'PUBLIC' }], count: 1 })
    })

    it('escapes embedded double quotes in identifiers', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name'], []))

      await service.listSchemas('we"ird')

      expect(mock.history[0].body.statement).toBe('SHOW SCHEMAS IN DATABASE "we""ird"')
    })

    it('requires a database when none is configured', async () => {
      const local = bootstrap({ accountIdentifier: ACCOUNT, token: TOKEN })

      await expect(local.getService().listSchemas()).rejects.toThrow('Database is required.')

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  describe('listTables', () => {
    it('qualifies the schema with the database', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'kind'], [['ORDERS', 'TABLE']]))

      const result = await service.listTables('DB2', 'SC2')

      expect(mock.history[0].body.statement).toBe('SHOW TABLES IN SCHEMA "DB2"."SC2"')

      expect(result).toEqual({
        database: 'DB2',
        schema: 'SC2',
        tables: [{ name: 'ORDERS', kind: 'TABLE' }],
        count: 1,
      })
    })

    it('requires a schema when none is configured', async () => {
      const local = bootstrap({ accountIdentifier: ACCOUNT, token: TOKEN, database: 'DB' })

      await expect(local.getService().listTables()).rejects.toThrow('Schema is required.')

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  describe('listWarehouses', () => {
    it('runs SHOW WAREHOUSES', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'state'], [['COMPUTE_WH', 'STARTED']]))

      const result = await service.listWarehouses()

      expect(mock.history[0].body.statement).toBe('SHOW WAREHOUSES')
      expect(result).toEqual({ warehouses: [{ name: 'COMPUTE_WH', state: 'STARTED' }], count: 1 })
    })
  })

  describe('getTableSchema', () => {
    it('describes the table and maps the column descriptors', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(
        ['name', 'type', 'kind', 'null?', 'default', 'primary key', 'unique key', 'comment'],
        [
          ['ID', 'NUMBER(38,0)', 'COLUMN', 'N', null, 'Y', 'N', 'identifier'],
          ['NAME', 'VARCHAR(16777216)', 'COLUMN', 'Y', null, 'N', 'Y', null],
        ]
      ))

      const result = await service.getTableSchema(undefined, undefined, 'ORDERS')

      expect(mock.history[0].body.statement).toBe('DESCRIBE TABLE "DEMO_DB"."PUBLIC"."ORDERS"')

      expect(result).toEqual({
        database: 'DEMO_DB',
        schema: 'PUBLIC',
        table: 'ORDERS',
        columns: [
          {
            name: 'ID',
            type: 'NUMBER(38,0)',
            kind: 'COLUMN',
            nullable: false,
            default: null,
            primaryKey: true,
            uniqueKey: false,
            comment: 'identifier',
          },
          {
            name: 'NAME',
            type: 'VARCHAR(16777216)',
            kind: 'COLUMN',
            nullable: true,
            default: null,
            primaryKey: false,
            uniqueKey: true,
            comment: null,
          },
        ],
        count: 2,
      })
    })

    it('requires a table name', async () => {
      await expect(service.getTableSchema()).rejects.toThrow('Table is required.')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Dictionaries ──

  describe('getDatabasesDictionary', () => {
    it('maps databases to dictionary items with an owner note', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(
        ['name', 'owner'],
        [['DEMO_DB', 'SYSADMIN'], ['OTHER_DB', null]]
      ))

      const result = await service.getDatabasesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'DEMO_DB', value: 'DEMO_DB', note: 'owner: SYSADMIN' },
          { label: 'OTHER_DB', value: 'OTHER_DB', note: null },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively and handles a null payload', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'owner'], [['DEMO_DB', 'A'], ['SALES', 'A']]))

      const filtered = await service.getDatabasesDictionary({ search: 'sal' })

      expect(filtered.items).toEqual([{ label: 'SALES', value: 'SALES', note: 'owner: A' }])

      const all = await service.getDatabasesDictionary(null)

      expect(all.items).toHaveLength(2)
    })
  })

  describe('getSchemasDictionary', () => {
    it('lists schemas of the criteria database', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'owner'], [['PUBLIC', 'SYSADMIN']]))

      const result = await service.getSchemasDictionary({ criteria: { database: 'SALES' } })

      expect(mock.history[0].body.statement).toBe('SHOW SCHEMAS IN DATABASE "SALES"')
      expect(result.items).toEqual([{ label: 'PUBLIC', value: 'PUBLIC', note: 'owner: SYSADMIN' }])
      expect(result.cursor).toBeNull()
    })

    it('falls back to the configured database', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'owner'], []))

      await service.getSchemasDictionary(null)

      expect(mock.history[0].body.statement).toBe('SHOW SCHEMAS IN DATABASE "DEMO_DB"')
    })

    it('returns an empty list when no database is available', async () => {
      const local = bootstrap({ accountIdentifier: ACCOUNT, token: TOKEN })
      const localMock = local.getRequestMock()

      await expect(local.getService().getSchemasDictionary({})).resolves.toEqual({ items: [], cursor: null })
      expect(localMock.history).toHaveLength(0)

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  describe('getTablesDictionary', () => {
    it('lists tables with a kind and row-count note', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(
        ['name', 'kind', 'rows'],
        [['ORDERS', 'TABLE', '120'], ['V_ORDERS', 'VIEW', null], ['EMPTY', null, null]]
      ))

      const result = await service.getTablesDictionary({ criteria: { database: 'DB2', schema: 'SC2' } })

      expect(mock.history[0].body.statement).toBe('SHOW TABLES IN SCHEMA "DB2"."SC2"')

      expect(result.items).toEqual([
        { label: 'ORDERS', value: 'ORDERS', note: 'TABLE · 120 rows' },
        { label: 'V_ORDERS', value: 'V_ORDERS', note: 'VIEW' },
        { label: 'EMPTY', value: 'EMPTY', note: null },
      ])
    })

    it('filters by search term', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'kind', 'rows'], [['ORDERS', 'TABLE', '1'], ['USERS', 'TABLE', '2']]))

      const result = await service.getTablesDictionary({ search: 'user', criteria: { database: 'D', schema: 'S' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('USERS')
    })

    it('returns an empty list when the database or schema is missing', async () => {
      const local = bootstrap({ accountIdentifier: ACCOUNT, token: TOKEN, database: 'DB' })
      const svc = local.getService()

      await expect(svc.getTablesDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(svc.getTablesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(local.getRequestMock().history).toHaveLength(0)

      local.cleanup()

      sandbox = bootstrap(DEFAULTS)
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  describe('getWarehousesDictionary', () => {
    it('lists warehouses with a state and size note', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(
        ['name', 'state', 'size'],
        [['COMPUTE_WH', 'STARTED', 'X-Small'], ['BARE_WH', null, null]]
      ))

      const result = await service.getWarehousesDictionary({})

      expect(mock.history[0].body.statement).toBe('SHOW WAREHOUSES')

      expect(result).toEqual({
        items: [
          { label: 'COMPUTE_WH', value: 'COMPUTE_WH', note: 'STARTED · X-Small' },
          { label: 'BARE_WH', value: 'BARE_WH', note: null },
        ],
        cursor: null,
      })
    })

    it('filters by search term and handles a null payload', async () => {
      mock.onPost(STATEMENTS_URL).reply(showResponse(['name', 'state', 'size'], [['COMPUTE_WH', 'STARTED', 'XS']]))

      await expect(service.getWarehousesDictionary({ search: 'nomatch' })).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getWarehousesDictionary(null)).resolves.toHaveProperty('items.length', 1)
    })
  })
})
