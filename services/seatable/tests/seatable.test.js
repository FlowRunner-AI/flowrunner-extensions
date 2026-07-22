'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-base-api-token'
const SERVER_URL = 'https://cloud.seatable.io'
const TOKEN_URL = `${ SERVER_URL }/api/v2.1/dtable/app-access-token/`

const ACCESS_TOKEN = 'base-access-token'
const DTABLE_UUID = 'uuid-1234'
const GATEWAY = 'https://cloud.seatable.io/api-gateway/'
const DATA_BASE = `${ GATEWAY }api/v2/dtables/${ DTABLE_UUID }`

const TOKEN_RESPONSE = {
  access_token: ACCESS_TOKEN,
  dtable_uuid: DTABLE_UUID,
  dtable_server: GATEWAY,
  workspace_id: 42,
  dtable_name: 'Demo Base',
}

const METADATA_RESPONSE = {
  metadata: {
    tables: [
      {
        _id: '0000',
        name: 'Tasks',
        columns: [
          { key: '0000', name: 'Name', type: 'text' },
          { key: '88o8', name: 'Done', type: 'checkbox' },
        ],
      },
      {
        _id: '1111',
        name: 'Projects',
        columns: [{ key: '0000', name: 'Title', type: 'text' }],
      },
    ],
  },
}

describe('SeaTable Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    // The service caches the exchanged base access token on the instance. Clearing it keeps
    // every test deterministic: history[0] is always the token exchange.
    service._baseContext = null
    mock.onGet(TOKEN_URL).reply(TOKEN_RESPONSE)
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const tokenCall = () => mock.history[0]
  const dataCall = () => mock.history[mock.history.length - 1]

  // ── Registration ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'serverUrl',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: SERVER_URL,
        }),
        expect.objectContaining({ name: 'apiToken', required: true, shared: false, type: 'STRING' }),
      ])
    })
  })

  // ── Authentication ──

  describe('base access token exchange', () => {
    it('exchanges the API token and calls the gateway with a Bearer token', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)

      await service.getBaseMetadata()

      expect(mock.history).toHaveLength(2)
      expect(tokenCall().method).toBe('get')
      expect(tokenCall().url).toBe(TOKEN_URL)
      expect(tokenCall().headers).toMatchObject({ Authorization: `Token ${ API_TOKEN }` })

      expect(dataCall().headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('reuses the cached base context for subsequent calls', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)

      await service.getBaseMetadata()
      await service.getBaseMetadata()

      const tokenCalls = mock.history.filter(call => call.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      expect(mock.history).toHaveLength(3)
    })

    it('falls back to the server-derived gateway when dtable_server is missing', async () => {
      mock.reset()
      mock.onGet(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, dtable_uuid: DTABLE_UUID })
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)

      await service.getBaseMetadata()

      expect(dataCall().url).toBe(`${ DATA_BASE }/metadata/`)
    })

    it('normalises a gateway URL without a trailing slash', async () => {
      mock.reset()

      mock.onGet(TOKEN_URL).reply({
        access_token: ACCESS_TOKEN,
        dtable_uuid: DTABLE_UUID,
        dtable_server: 'https://cloud.seatable.io/api-gateway',
      })

      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)

      await service.getBaseMetadata()

      expect(dataCall().url).toBe(`${ DATA_BASE }/metadata/`)
    })

    it('throws a helpful error when no access token is returned', async () => {
      mock.reset()
      mock.onGet(TOKEN_URL).reply({})

      await expect(service.getBaseMetadata()).rejects.toThrow(
        /failed to obtain a base access token/
      )
    })

    it('wraps token exchange failures with the API error message', async () => {
      mock.reset()

      mock.onGet(TOKEN_URL).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { error_msg: 'Permission denied.' },
      })

      await expect(service.getBaseMetadata()).rejects.toThrow('SeaTable API error: Permission denied.')
    })

    it('re-exchanges the token and retries once on a 401 from the gateway', async () => {
      let attempts = 0

      mock.onGet(`${ DATA_BASE }/metadata/`).replyWith(() => {
        attempts += 1

        if (attempts === 1) {
          throw Object.assign(new Error('Unauthorized'), { status: 401 })
        }

        return METADATA_RESPONSE
      })

      const result = await service.getBaseMetadata()

      expect(result).toEqual(METADATA_RESPONSE.metadata)
      expect(attempts).toBe(2)
      expect(mock.history.filter(call => call.url === TOKEN_URL)).toHaveLength(2)
    })

    it('throws when the retry after a 403 also fails', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { detail: 'Base token expired.' },
      })

      await expect(service.getBaseMetadata()).rejects.toThrow('SeaTable API error: Base token expired.')
    })

    it('does not retry on non-auth errors', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).replyWithError({
        message: 'Server exploded',
        status: 500,
      })

      await expect(service.getBaseMetadata()).rejects.toThrow('SeaTable API error: Server exploded')
      expect(mock.history.filter(call => call.url === TOKEN_URL)).toHaveLength(1)
    })
  })

  // ── Metadata ──

  describe('getBaseMetadata', () => {
    it('returns the metadata object', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)

      const result = await service.getBaseMetadata()

      expect(result).toEqual(METADATA_RESPONSE.metadata)
      expect(dataCall().method).toBe('get')
      expect(dataCall().url).toBe(`${ DATA_BASE }/metadata/`)
    })

    it('falls back to an empty table list when metadata is absent', async () => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply({})

      await expect(service.getBaseMetadata()).resolves.toEqual({ tables: [] })
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    beforeEach(() => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)
    })

    it('maps tables to dictionary items', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Tasks', value: 'Tasks', note: '2 columns' },
          { label: 'Projects', value: 'Projects', note: '1 columns' },
        ],
      })
    })

    it('handles a null payload', async () => {
      const result = await service.getTablesDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('filters case-insensitively by search', async () => {
      const result = await service.getTablesDictionary({ search: 'PROJ' })

      expect(result.items).toEqual([{ label: 'Projects', value: 'Projects', note: '1 columns' }])
    })

    it('returns an empty list when nothing matches', async () => {
      const result = await service.getTablesDictionary({ search: 'nope' })

      expect(result.items).toEqual([])
    })
  })

  describe('getColumnsDictionary', () => {
    beforeEach(() => {
      mock.onGet(`${ DATA_BASE }/metadata/`).reply(METADATA_RESPONSE)
    })

    it('maps the columns of the requested table', async () => {
      const result = await service.getColumnsDictionary({ criteria: { tableName: 'Tasks' } })

      expect(result).toEqual({
        items: [
          { label: 'Name', value: 'Name', note: 'text' },
          { label: 'Done', value: 'Done', note: 'checkbox' },
        ],
      })
    })

    it('filters columns case-insensitively by search', async () => {
      const result = await service.getColumnsDictionary({
        search: 'don',
        criteria: { tableName: 'Tasks' },
      })

      expect(result.items).toEqual([{ label: 'Done', value: 'Done', note: 'checkbox' }])
    })

    it('returns an empty list for an unknown table', async () => {
      const result = await service.getColumnsDictionary({ criteria: { tableName: 'Missing' } })

      expect(result).toEqual({ items: [] })
    })

    it('returns an empty list when no criteria are supplied', async () => {
      await expect(service.getColumnsDictionary(null)).resolves.toEqual({ items: [] })
    })
  })

  // ── Rows ──

  describe('listRows', () => {
    it('applies the documented defaults', async () => {
      mock.onGet(`${ DATA_BASE }/rows/`).reply({ rows: [] })

      await service.listRows('Tasks')

      expect(dataCall().url).toBe(`${ DATA_BASE }/rows/`)
      expect(dataCall().query).toEqual({ table_name: 'Tasks', limit: 100, convert_keys: true })
    })

    it('passes view, start, limit and convertKeys through', async () => {
      mock.onGet(`${ DATA_BASE }/rows/`).reply({ rows: [{ _id: 'a' }] })

      const result = await service.listRows('Tasks', 'Default View', 10, 25, false)

      expect(result).toEqual({ rows: [{ _id: 'a' }] })

      expect(dataCall().query).toEqual({
        table_name: 'Tasks',
        view_name: 'Default View',
        start: 10,
        limit: 25,
        convert_keys: false,
      })
    })

    it('keeps a zero start offset', async () => {
      mock.onGet(`${ DATA_BASE }/rows/`).reply({ rows: [] })

      await service.listRows('Tasks', undefined, 0)

      expect(dataCall().query).toMatchObject({ start: 0 })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ DATA_BASE }/rows/`).replyWithError({
        message: 'Bad Request',
        body: { error_msg: 'Table not found.' },
      })

      await expect(service.listRows('Ghost')).rejects.toThrow('SeaTable API error: Table not found.')
    })
  })

  describe('getRow', () => {
    it('requests the row by id', async () => {
      mock.onGet(`${ DATA_BASE }/rows/abc123/`).reply({ _id: 'abc123', Name: 'Write report' })

      const result = await service.getRow('Tasks', 'abc123')

      expect(result).toEqual({ _id: 'abc123', Name: 'Write report' })
      expect(dataCall().query).toEqual({ table_name: 'Tasks' })
    })
  })

  describe('appendRow', () => {
    it('posts the row keyed by column name', async () => {
      mock.onPost(`${ DATA_BASE }/rows/`).reply({ _id: 'abc123' })

      await service.appendRow('Tasks', { Name: 'Write report', Done: false })

      expect(dataCall().method).toBe('post')

      expect(dataCall().body).toEqual({
        table_name: 'Tasks',
        row: { Name: 'Write report', Done: false },
      })
    })
  })

  describe('updateRow', () => {
    it('sends a PUT with the row id', async () => {
      mock.onPut(`${ DATA_BASE }/rows/`).reply({ success: true })

      await service.updateRow('Tasks', 'abc123', { Done: true })

      expect(dataCall().method).toBe('put')

      expect(dataCall().body).toEqual({
        table_name: 'Tasks',
        row_id: 'abc123',
        row: { Done: true },
      })
    })
  })

  describe('deleteRow', () => {
    it('sends a DELETE with the row id in the body', async () => {
      mock.onDelete(`${ DATA_BASE }/rows/`).reply({ success: true })

      await service.deleteRow('Tasks', 'abc123')

      expect(dataCall().method).toBe('delete')
      expect(dataCall().body).toEqual({ table_name: 'Tasks', row_id: 'abc123' })
    })
  })

  describe('appendRows', () => {
    it('posts the batch of rows', async () => {
      mock.onPost(`${ DATA_BASE }/batch-append-rows/`).reply({ inserted_row_count: 2 })

      await service.appendRows('Tasks', [{ Name: 'A' }, { Name: 'B' }])

      expect(dataCall().body).toEqual({ table_name: 'Tasks', rows: [{ Name: 'A' }, { Name: 'B' }] })
    })

    it('coerces a non-array rows argument to an empty array', async () => {
      mock.onPost(`${ DATA_BASE }/batch-append-rows/`).reply({ inserted_row_count: 0 })

      await service.appendRows('Tasks', undefined)

      expect(dataCall().body).toEqual({ table_name: 'Tasks', rows: [] })
    })
  })

  describe('updateRows', () => {
    it('puts the batch of updates', async () => {
      mock.onPut(`${ DATA_BASE }/batch-update-rows/`).reply({ success: true })

      const updates = [{ row_id: 'abc123', row: { Name: 'New' } }]

      await service.updateRows('Tasks', updates)

      expect(dataCall().body).toEqual({ table_name: 'Tasks', updates })
    })

    it('coerces a non-array updates argument to an empty array', async () => {
      mock.onPut(`${ DATA_BASE }/batch-update-rows/`).reply({ success: true })

      await service.updateRows('Tasks', 'nope')

      expect(dataCall().body).toEqual({ table_name: 'Tasks', updates: [] })
    })
  })

  describe('deleteRows', () => {
    it('deletes the batch of row ids', async () => {
      mock.onDelete(`${ DATA_BASE }/batch-delete-rows/`).reply({ success: true })

      await service.deleteRows('Tasks', ['a', 'b'])

      expect(dataCall().body).toEqual({ table_name: 'Tasks', row_ids: ['a', 'b'] })
    })

    it('coerces a non-array rowIds argument to an empty array', async () => {
      mock.onDelete(`${ DATA_BASE }/batch-delete-rows/`).reply({ success: true })

      await service.deleteRows('Tasks', null)

      expect(dataCall().body).toEqual({ table_name: 'Tasks', row_ids: [] })
    })
  })

  // ── SQL ──

  describe('queryWithSql', () => {
    it('posts the statement with key conversion enabled', async () => {
      mock.onPost(`${ DATA_BASE }/sql/`).reply({ success: true, results: [], metadata: [] })

      const sql = 'SELECT `Name` FROM `Tasks` LIMIT 1'
      const result = await service.queryWithSql(sql)

      expect(result).toEqual({ success: true, results: [], metadata: [] })
      expect(dataCall().body).toEqual({ sql, convert_keys: true })
    })

    it('wraps SQL errors', async () => {
      mock.onPost(`${ DATA_BASE }/sql/`).replyWithError({
        message: 'Bad Request',
        body: { error: 'syntax error' },
      })

      await expect(service.queryWithSql('SELECT')).rejects.toThrow('SeaTable API error: syntax error')
    })
  })

  // ── Links ──

  describe('listRowLinks', () => {
    it('posts the link query', async () => {
      mock.onPost(`${ DATA_BASE }/query-links/`).reply({ abc123: [] })

      await service.listRowLinks('0000', 'link-key', ['abc123'])

      expect(dataCall().body).toEqual({
        table_id: '0000',
        link_column_key: 'link-key',
        rows: ['abc123'],
      })
    })

    it('coerces a non-array rowIds argument to an empty array', async () => {
      mock.onPost(`${ DATA_BASE }/query-links/`).reply({})

      await service.listRowLinks('0000', 'link-key')

      expect(dataCall().body).toMatchObject({ rows: [] })
    })
  })

  describe('addLink', () => {
    it('posts the link payload', async () => {
      mock.onPost(`${ DATA_BASE }/links/`).reply({ success: true })

      await service.addLink('link-key', 'Tasks', 'Projects', 'row-1', 'row-2')

      expect(dataCall().body).toEqual({
        link_id: 'link-key',
        table_name: 'Tasks',
        other_table_name: 'Projects',
        row_id: 'row-1',
        other_row_id: 'row-2',
      })
    })
  })

  describe('removeLink', () => {
    it('deletes the link payload', async () => {
      mock.onDelete(`${ DATA_BASE }/links/`).reply({ success: true })

      await service.removeLink('link-key', 'Tasks', 'Projects', 'row-1', 'row-2')

      expect(dataCall().method).toBe('delete')

      expect(dataCall().body).toEqual({
        link_id: 'link-key',
        table_name: 'Tasks',
        other_table_name: 'Projects',
        row_id: 'row-1',
        other_row_id: 'row-2',
      })
    })

    it('wraps errors without a body using the raw message', async () => {
      mock.onDelete(`${ DATA_BASE }/links/`).replyWithError({ message: 'Network timeout' })

      await expect(service.removeLink('k', 'A', 'B', '1', '2')).rejects.toThrow(
        'SeaTable API error: Network timeout'
      )
    })
  })
})

describe('SeaTable Service (custom server URL)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ serverUrl: 'https://seatable.example.com/', apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('strips trailing slashes from the configured server URL', async () => {
    mock.onGet('https://seatable.example.com/api/v2.1/dtable/app-access-token/').reply({
      access_token: ACCESS_TOKEN,
      dtable_uuid: DTABLE_UUID,
      dtable_server: 'https://seatable.example.com/api-gateway/',
    })

    mock
      .onGet(`https://seatable.example.com/api-gateway/api/v2/dtables/${ DTABLE_UUID }/metadata/`)
      .reply(METADATA_RESPONSE)

    await expect(service.getBaseMetadata()).resolves.toEqual(METADATA_RESPONSE.metadata)
  })
})
