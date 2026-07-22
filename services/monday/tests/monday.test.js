'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'

const API_URL = 'https://api.monday.com/v2'
const FILE_URL = `${ API_URL }/file`
const OAUTH_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize'
const OAUTH_TOKEN_URL = 'https://auth.monday.com/oauth2/token'

describe('Monday.com Service', () => {
  let sandbox
  let service
  let mock

  /**
   * Every operation POSTs to the single GraphQL endpoint, so responses are dispatched
   * on the query text. `routes` is a list of [substringOfQuery, response] pairs.
   */
  const graphql = routes => {
    mock.onPost(API_URL).replyWith(call => {
      const query = call.body.query
      const route = routes.find(([match]) => query.includes(match))

      if (!route) {
        throw new Error(`No GraphQL route matched query: ${ query }`)
      }

      return typeof route[1] === 'function' ? route[1](call) : route[1]
    })
  }

  /** Shorthand for the common single-operation case. */
  const graphqlData = data => mock.onPost(API_URL).reply({ data })

  /** The query text of the n-th GraphQL POST. */
  const queryAt = (index = 0) => mock.history[index].body.query

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // OAuth services read the live token off the per-invocation request headers.
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
        expect.objectContaining({ name: 'clientId', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'clientSecret', required: true, shared: true, type: 'STRING' }),
      ])
    })
  })

  // ── GraphQL transport ──

  describe('GraphQL transport', () => {
    it('sends auth, content-type and API version headers and a query-only body', async () => {
      graphqlData({ workspaces: [] })

      await service.getWorkspacesDictionary({})

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(API_URL)

      expect(mock.history[0].headers).toEqual({
        'Authorization': OAUTH_TOKEN,
        'Content-Type': 'application/json',
        'API-Version': '2024-10',
      })

      // The service inlines every argument into the query text; it never uses
      // GraphQL `variables`, so the body carries the query alone.
      expect(mock.history[0].body).toEqual({ query: '{ workspaces { id name } }' })
      expect(mock.history[0].body.variables).toBeUndefined()
    })

    it('sends an undefined Authorization header when the oauth token header is absent', async () => {
      const original = service.request
      service.request = { headers: {} }

      graphqlData({ workspaces: [] })

      await service.getWorkspacesDictionary({})

      expect(mock.history[0].headers.Authorization).toBeUndefined()

      service.request = original
    })

    it('surfaces a GraphQL errors array on an otherwise successful response', async () => {
      mock.onPost(API_URL).reply({
        errors: [{ message: 'Board not found' }, { message: 'Not authorized' }],
        data: null,
      })

      await expect(service.getBoard('1')).rejects.toThrow(
        'Failed to get board: Board not found; Not authorized'
      )
    })

    it('surfaces an HTTP transport error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'Service Unavailable' })

      await expect(service.getBoard('1')).rejects.toThrow('Failed to get board: Service Unavailable')
    })
  })

  // ── OAuth SYSTEM methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('builds the authorize URL with client id and default scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url.startsWith(`${ OAUTH_AUTHORIZE_URL }?`)).toBe(true)

      const params = new URLSearchParams(url.split('?')[1])

      expect(params.get('client_id')).toBe(CLIENT_ID)

      expect(params.get('scope')).toBe(
        'me:read boards:read boards:write workspaces:read workspaces:write users:read teams:read updates:read updates:write'
      )
    })
  })

  describe('refreshToken', () => {
    it('returns the current access token (monday tokens do not expire)', async () => {
      const result = await service.refreshToken('unused-refresh-token')

      expect(result).toEqual({ token: OAUTH_TOKEN })
      expect(mock.history).toHaveLength(0)
    })

    it('returns no rotated refresh token', async () => {
      const result = await service.refreshToken('old-refresh')

      expect(result.refreshToken).toBeUndefined()
      expect(result.expirationInSeconds).toBeUndefined()
    })
  })

  describe('executeCallback', () => {
    const tokenReply = { access_token: 'new-access-token' }

    it('exchanges the code as form-urlencoded and resolves the identity', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(tokenReply)

      mock.onPost(API_URL).reply({
        data: { me: { id: '1', name: 'Jane Doe', email: 'jane@acme.com', photo_thumb: 'https://img/j.png' } },
      })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://cb.example.com' })

      expect(result).toEqual({
        token: 'new-access-token',
        connectionIdentityName: 'jane@acme.com',
        connectionIdentityImageURL: 'https://img/j.png',
        overwrite: true,
      })

      expect(mock.history[0].headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })

      const body = new URLSearchParams(mock.history[0].body)

      expect(body.get('client_id')).toBe(CLIENT_ID)
      expect(body.get('client_secret')).toBe(CLIENT_SECRET)
      expect(body.get('code')).toBe('auth-code')
      expect(body.get('redirect_uri')).toBe('https://cb.example.com')

      expect(mock.history[1].url).toBe(API_URL)

      expect(mock.history[1].headers).toEqual({
        'Authorization': 'new-access-token',
        'Content-Type': 'application/json',
        'API-Version': '2024-10',
      })

      expect(mock.history[1].body).toEqual({ query: '{ me { id name email photo_thumb } }' })
    })

    it('falls back to the user name when no email is returned', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(tokenReply)
      mock.onPost(API_URL).reply({ data: { me: { id: '1', name: 'Jane Doe' } } })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result.connectionIdentityName).toBe('Jane Doe')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('falls back to a generic name when the profile has neither email nor name', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(tokenReply)
      mock.onPost(API_URL).reply({ data: {} })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result.connectionIdentityName).toBe('Unknown Monday.com Account')
    })

    it('returns an empty object when the token exchange fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({ message: 'invalid_grant' })

      const result = await service.executeCallback({ code: 'bad', redirectURI: 'u' })

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(1)
    })

    it('keeps the token when the profile lookup fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply(tokenReply)
      mock.onPost(API_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'u' })

      expect(result).toEqual({
        token: 'new-access-token',
        connectionIdentityName: 'Monday.com Account',
        overwrite: true,
      })
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('maps workspaces to label/value pairs', async () => {
      graphqlData({ workspaces: [{ id: 12345, name: 'Main Workspace' }, { id: 6, name: 'Engineering' }] })

      const result = await service.getWorkspacesDictionary({})

      expect(queryAt()).toBe('{ workspaces { id name } }')

      expect(result).toEqual({
        items: [
          { label: 'Main Workspace', value: '12345' },
          { label: 'Engineering', value: '6' },
        ],
      })
    })

    it('filters case-insensitively by search', async () => {
      graphqlData({ workspaces: [{ id: 1, name: 'Main' }, { id: 2, name: 'Engineering' }] })

      const result = await service.getWorkspacesDictionary({ search: 'ENGIN' })

      expect(result.items).toEqual([{ label: 'Engineering', value: '2' }])
    })

    it('handles a null payload and a null workspaces list', async () => {
      graphqlData({ workspaces: null })

      const result = await service.getWorkspacesDictionary(null)

      expect(result).toEqual({ items: [] })
    })

    it('returns an empty list on error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'boom' })

      expect(await service.getWorkspacesDictionary({})).toEqual({ items: [] })
    })
  })

  describe('getBoardsDictionary', () => {
    it('requests page 1 by default and maps boards', async () => {
      graphqlData({ boards: [{ id: 987, name: 'Project Tracker', board_kind: 'public' }] })

      const result = await service.getBoardsDictionary({})

      expect(queryAt()).toBe('{ boards(limit: 100, page: 1) { id name board_kind } }')

      expect(result).toEqual({
        items: [{ label: 'Project Tracker', value: '987', note: 'public' }],
        cursor: null,
      })
    })

    it('treats the cursor as a page number and advances it on a full page', async () => {
      const boards = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `B${ i }`, board_kind: 'public' }))
      graphqlData({ boards })

      const result = await service.getBoardsDictionary({ cursor: '3' })

      expect(queryAt()).toBe('{ boards(limit: 100, page: 3) { id name board_kind } }')
      expect(result.cursor).toBe('4')
    })

    it('filters by search and handles a null boards list', async () => {
      graphqlData({ boards: null })

      expect(await service.getBoardsDictionary({ search: 'x' })).toEqual({ items: [], cursor: null })
    })

    it('filters boards by search term', async () => {
      graphqlData({
        boards: [
          { id: 1, name: 'Sales', board_kind: 'public' },
          { id: 2, name: 'Marketing', board_kind: 'private' },
        ],
      })

      const result = await service.getBoardsDictionary({ search: 'mark' })

      expect(result.items).toEqual([{ label: 'Marketing', value: '2', note: 'private' }])
    })

    it('returns an empty list on error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'boom' })

      expect(await service.getBoardsDictionary(null)).toEqual({ items: [] })
    })
  })

  describe('getUsersDictionary', () => {
    it('maps users to "name (email)" labels', async () => {
      graphqlData({ users: [{ id: 42, name: 'John Doe', email: 'john@example.com' }] })

      const result = await service.getUsersDictionary({})

      expect(queryAt()).toBe('{ users(limit: 100) { id name email } }')
      expect(result).toEqual({ items: [{ label: 'John Doe (john@example.com)', value: '42' }] })
    })

    it('filters by search across name and email', async () => {
      graphqlData({
        users: [
          { id: 1, name: 'John', email: 'john@acme.com' },
          { id: 2, name: 'Jane', email: 'jane@other.com' },
        ],
      })

      expect((await service.getUsersDictionary({ search: 'other.com' })).items).toEqual([
        { label: 'Jane (jane@other.com)', value: '2' },
      ])
    })

    it('handles a null users list and errors', async () => {
      graphqlData({ users: null })
      expect(await service.getUsersDictionary(null)).toEqual({ items: [] })

      mock.reset()
      mock.onPost(API_URL).replyWithError({ message: 'boom' })
      expect(await service.getUsersDictionary({})).toEqual({ items: [] })
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns an empty list without hitting the API when no board id is given', async () => {
      expect(await service.getGroupsDictionary({})).toEqual({ items: [] })
      expect(await service.getGroupsDictionary(null)).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('maps groups for a board', async () => {
      graphqlData({ boards: [{ groups: [{ id: 'topics', title: 'To Do' }, { id: 'g2', title: 'Done' }] }] })

      const result = await service.getGroupsDictionary({ criteria: { boardId: '987' } })

      expect(queryAt()).toBe('{ boards(ids: [987]) { groups { id title } } }')
      expect(result).toEqual({ items: [{ label: 'To Do', value: 'topics' }, { label: 'Done', value: 'g2' }] })
    })

    it('filters by search and tolerates an empty boards array', async () => {
      graphqlData({ boards: [{ groups: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }] }] })

      expect((await service.getGroupsDictionary({ search: 'bet', criteria: { boardId: '1' } })).items)
        .toEqual([{ label: 'Beta', value: 'b' }])

      mock.reset()
      graphqlData({ boards: [] })
      expect(await service.getGroupsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [] })
    })

    it('returns an empty list on error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'boom' })

      expect(await service.getGroupsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [] })
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without a board id', async () => {
      expect(await service.getColumnsDictionary({ criteria: {} })).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('maps columns with type in the label and note', async () => {
      graphqlData({ boards: [{ columns: [{ id: 'status', title: 'Status', type: 'status' }] }] })

      const result = await service.getColumnsDictionary({ criteria: { boardId: '987' } })

      expect(queryAt()).toBe('{ boards(ids: [987]) { columns { id title type } } }')
      expect(result).toEqual({ items: [{ label: 'Status (status)', value: 'status', note: 'status' }] })
    })

    it('filters by search and tolerates missing columns', async () => {
      graphqlData({
        boards: [{
          columns: [
            { id: 'a', title: 'Owner', type: 'people' },
            { id: 'b', title: 'Due', type: 'date' },
          ],
        }],
      })

      expect((await service.getColumnsDictionary({ search: 'due', criteria: { boardId: '1' } })).items)
        .toEqual([{ label: 'Due (date)', value: 'b', note: 'date' }])

      mock.reset()
      graphqlData({ boards: [{}] })
      expect(await service.getColumnsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [] })
    })

    it('returns an empty list on error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'boom' })

      expect(await service.getColumnsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [] })
    })
  })

  describe('getItemsDictionary', () => {
    it('returns an empty list without a board id', async () => {
      expect(await service.getItemsDictionary({})).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('queries items_page on the first page', async () => {
      graphqlData({
        boards: [{ items_page: { cursor: 'next-cursor', items: [{ id: 1, name: 'Task 1' }] } }],
      })

      const result = await service.getItemsDictionary({ criteria: { boardId: '987' } })

      expect(queryAt()).toBe('{ boards(ids: [987]) { items_page(limit: 100) { cursor items { id name } } } }')
      expect(result).toEqual({ items: [{ label: 'Task 1', value: '1' }], cursor: 'next-cursor' })
    })

    it('continues through next_items_page when a cursor is supplied', async () => {
      graphqlData({ next_items_page: { cursor: null, items: [{ id: 2, name: 'Task 2' }] } })

      const result = await service.getItemsDictionary({ cursor: 'abc', criteria: { boardId: '987' } })

      expect(queryAt()).toBe('{ next_items_page(limit: 100, cursor: "abc") { cursor items { id name } } }')
      expect(result).toEqual({ items: [{ label: 'Task 2', value: '2' }], cursor: null })
    })

    it('filters by search and tolerates missing pages', async () => {
      graphqlData({
        boards: [{ items_page: { items: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] } }],
      })

      expect((await service.getItemsDictionary({ search: 'alp', criteria: { boardId: '1' } })).items)
        .toEqual([{ label: 'Alpha', value: '1' }])

      mock.reset()
      graphqlData({ boards: [{}] })
      expect(await service.getItemsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [], cursor: null })

      mock.reset()
      graphqlData({})

      expect(await service.getItemsDictionary({ cursor: 'c', criteria: { boardId: '1' } }))
        .toEqual({ items: [], cursor: null })
    })

    it('returns an empty list on error', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'boom' })

      expect(await service.getItemsDictionary({ criteria: { boardId: '1' } })).toEqual({ items: [] })
    })
  })

  // ── Items ──

  describe('createItem', () => {
    it('builds the mutation without a column_values clause', async () => {
      graphqlData({ create_item: { id: '1', name: 'New Task' } })

      const result = await service.createItem('987', 'topics', 'New Task')

      expect(queryAt()).toBe(
        'mutation { create_item(board_id: 987, group_id: "topics", item_name: "New Task") { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'New Task' })
    })

    it('escapes quotes and backslashes in the item name', async () => {
      graphqlData({ create_item: { id: '1' } })

      await service.createItem('1', 'g', 'Say "hi" \\ bye')

      expect(queryAt()).toContain('item_name: "Say \\"hi\\" \\\\ bye"')
    })

    it('passes a pre-formatted column values string through without a type lookup', async () => {
      graphqlData({ create_item: { id: '1' } })

      await service.createItem('1', 'g', 'Task', '{"text":"hello"}')

      expect(mock.history).toHaveLength(1)
      expect(queryAt()).toContain(', column_values: "{\\"text\\":\\"hello\\"}")')
    })

    it('resolves column types then double-encodes an object of column values', async () => {
      graphql([
        ['columns { id type }', { data: { boards: [{ columns: [{ id: 'status', type: 'status' }] }] } }],
        ['create_item', { data: { create_item: { id: '1' } } }],
      ])

      await service.createItem('987', 'topics', 'Task', { status: 'Done' })

      expect(mock.history).toHaveLength(2)
      expect(queryAt(0)).toBe('{ boards(ids: [987]) { columns { id type } } }')
      // column_values must be a JSON *string* inside the GraphQL query — double-encoded.
      expect(queryAt(1)).toContain(', column_values: "{\\"status\\":{\\"label\\":\\"Done\\"}}")')
    })

    it('wraps API failures with a create-item message', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createItem('1', 'g', 'T')).rejects.toThrow('Failed to create item: nope')
    })
  })

  describe('getItem', () => {
    it('requests the item with all column values', async () => {
      graphqlData({ items: [{ id: '1', name: 'Task' }] })

      const result = await service.getItem('987', '1')

      expect(queryAt()).toBe(
        '{ items(ids: [1]) { id name created_at updated_at group { id title } board { id name } column_values { id column { title } text type value } } }'
      )

      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('throws when the item is not found', async () => {
      graphqlData({ items: [] })

      await expect(service.getItem('987', '404')).rejects.toThrow('Failed to get item: Item with ID 404 not found.')
    })
  })

  describe('listItems', () => {
    it('defaults to a page size of 25 and no filter clause', async () => {
      graphqlData({ boards: [{ items_page: { cursor: 'c1', items: [{ id: '1' }] } }] })

      const result = await service.listItems('987')

      expect(queryAt()).toBe(
        '{ boards(ids: [987]) { items_page(limit: 25) { cursor items { id name column_values { id column { title } text type value } } } } }'
      )

      expect(result).toEqual({ items: [{ id: '1' }], cursor: 'c1' })
    })

    it('honours a custom limit', async () => {
      graphqlData({ boards: [{ items_page: { items: [] } }] })

      await service.listItems('987', null, 100)

      expect(queryAt()).toContain('items_page(limit: 100)')
    })

    it('serialises an object filter as an inline GraphQL literal with unquoted enums', async () => {
      graphqlData({ boards: [{ items_page: { items: [] } }] })

      await service.listItems('987', {
        operator: 'and',
        rules: [{ column_id: 'status', compare_value: ['Done'], operator: 'any_of' }],
      })

      expect(queryAt()).toContain(
        'query_params: {operator: and, rules: [{column_id: "status", compare_value: ["Done"], operator: any_of}]}'
      )
    })

    it('accepts a JSON string filter and quotes enum values that are not identifiers', async () => {
      graphqlData({ boards: [{ items_page: { items: [] } }] })

      await service.listItems('987', '{"operator":"any of","order_by":{"direction":"asc","column_id":"x"}}')

      expect(queryAt()).toContain(
        'query_params: {operator: "any of", order_by: {direction: asc, column_id: "x"}}'
      )
    })

    it('serialises non-string scalars in a filter literal', async () => {
      graphqlData({ boards: [{ items_page: { items: [] } }] })

      await service.listItems('987', { ids: [1, 2], active: true, missing: null })

      expect(queryAt()).toContain('query_params: {ids: [1, 2], active: true, missing: null}')
    })

    it('ignores an unparsable filter string', async () => {
      graphqlData({ boards: [{ items_page: { items: [] } }] })

      await service.listItems('987', '{not json')

      expect(queryAt()).not.toContain('query_params')
    })

    it('continues through next_items_page when a cursor is supplied', async () => {
      graphqlData({ next_items_page: { cursor: null, items: [{ id: '2' }] } })

      const result = await service.listItems('987', null, 50, 'CURSOR')

      expect(queryAt()).toBe(
        '{ next_items_page(limit: 50, cursor: "CURSOR") { cursor items { id name column_values { id column { title } text type value } } } }'
      )

      expect(result).toEqual({ items: [{ id: '2' }], cursor: null })
    })

    it('returns empty results when the page is missing', async () => {
      graphqlData({ boards: [] })

      expect(await service.listItems('987')).toEqual({ items: [], cursor: null })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.listItems('1')).rejects.toThrow('Failed to list items: nope')
    })
  })

  describe('updateItemName', () => {
    it('renames via change_simple_column_value on the name column', async () => {
      graphqlData({ change_simple_column_value: { id: '1', name: 'Renamed' } })

      const result = await service.updateItemName('987', '1', 'Renamed')

      expect(queryAt()).toBe(
        'mutation { change_simple_column_value(board_id: 987, item_id: 1, column_id: "name", value: "Renamed") { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'Renamed' })
    })

    it('escapes the new name', async () => {
      graphqlData({ change_simple_column_value: {} })

      await service.updateItemName('1', '2', 'a"b\\c')

      expect(queryAt()).toContain('value: "a\\"b\\\\c"')
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.updateItemName('1', '2', 'x')).rejects.toThrow('Failed to update item name: nope')
    })
  })

  describe('changeColumnValue', () => {
    it.each([
      ['a JSON object string', '{"label":"Done"}', 'value: "{\\"label\\":\\"Done\\"}"'],
      ['a bare string', 'Done', 'value: "\\"Done\\""'],
      ['a number', 5, 'value: "5"'],
      ['an object', { label: 'Done' }, 'value: "{\\"label\\":\\"Done\\"}"'],
    ])('double-encodes %s into the value argument', async (_label, value, expected) => {
      graphqlData({ change_column_value: { id: '1', name: 'Task' } })

      await service.changeColumnValue('987', '1', 'status', value)

      expect(queryAt()).toContain(expected)
    })

    it('builds the full mutation', async () => {
      graphqlData({ change_column_value: { id: '1', name: 'Task' } })

      const result = await service.changeColumnValue('987', '1', 'status', '{"index":1}')

      expect(queryAt()).toBe(
        'mutation { change_column_value(board_id: 987, item_id: 1, column_id: "status", value: "{\\"index\\":1}") { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.changeColumnValue('1', '2', 'c', 'v'))
        .rejects.toThrow('Failed to change column value: nope')
    })
  })

  describe('changeMultipleColumnValues', () => {
    const withColumnTypes = (columns, result = { change_multiple_column_values: { id: '1', name: 'Task' } }) => {
      graphql([
        ['columns { id type }', { data: { boards: [{ columns }] } }],
        ['change_multiple_column_values', { data: result }],
      ])
    }

    it('looks up column types then double-encodes the formatted values', async () => {
      withColumnTypes([{ id: 'text', type: 'text' }])

      const result = await service.changeMultipleColumnValues('987', '1', { text: 'hello' })

      expect(queryAt(1)).toBe(
        'mutation { change_multiple_column_values(board_id: 987, item_id: 1, column_values: "{\\"text\\":\\"hello\\"}") { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('skips null, undefined and empty-string column values', async () => {
      withColumnTypes([{ id: 'a', type: 'text' }, { id: 'b', type: 'text' }, { id: 'c', type: 'text' }])

      await service.changeMultipleColumnValues('987', '1', { a: null, b: '', c: undefined, d: 'kept' })

      expect(queryAt(1)).toContain('column_values: "{\\"d\\":\\"kept\\"}"')
    })

    it('falls back to raw scalars when the column type lookup fails', async () => {
      graphql([
        ['columns { id type }', () => {
          throw new Error('type lookup down') 
        }],
        ['change_multiple_column_values', { data: { change_multiple_column_values: { id: '1' } } }],
      ])

      await service.changeMultipleColumnValues('987', '1', { status: 'Done' })

      expect(queryAt(1)).toContain('column_values: "{\\"status\\":\\"Done\\"}"')
    })

    it('tolerates a board response without columns', async () => {
      graphql([
        ['columns { id type }', { data: { boards: [] } }],
        ['change_multiple_column_values', { data: { change_multiple_column_values: { id: '1' } } }],
      ])

      await service.changeMultipleColumnValues('987', '1', { anything: 'x' })

      expect(queryAt(1)).toContain('column_values: "{\\"anything\\":\\"x\\"}"')
    })

    // ── Per-column-type wrapping ──

    it.each([
      ['status', 'Done', '{"c":{"label":"Done"}}'],
      ['status (object passthrough)', 'status', '{"index":1}', '{"c":{"index":1}}'],
      ['dropdown', 'A, B', '{"c":{"labels":["A","B"]}}'],
      ['date', '2025-01-15', '{"c":{"date":"2025-01-15"}}'],
      ['email', 'a@b.com', '{"c":{"email":"a@b.com","text":"a@b.com"}}'],
      ['link', 'https://x', '{"c":{"url":"https://x","text":"https://x"}}'],
      ['phone', '+15551234', '{"c":{"phone":"+15551234"}}'],
      ['country', 'US', '{"c":{"countryCode":"US"}}'],
      ['hour', '14:30', '{"c":{"hour":14,"minute":30}}'],
      ['people', '1,2', '{"c":{"personsAndTeams":[{"id":1,"kind":"person"},{"id":2,"kind":"person"}]}}'],
      ['tags', '10,20', '{"c":{"tag_ids":[10,20]}}'],
      ['text', 'plain', '{"c":"plain"}'],
      ['numbers', 42, '{"c":42}'],
      ['rating', 5, '{"c":5}'],
      ['some_future_type', 'raw', '{"c":"raw"}'],
      ['timeline', '{"from":"a","to":"b"}', '{"c":{"from":"a","to":"b"}}'],
      ['week', 'not-json', '{"c":"not-json"}'],
      ['location', '{"lat":1}', '{"c":{"lat":1}}'],
    ])('wraps a %s column value', async (...args) => {
      // Rows are [type, value, expected] or [label, type, value, expected].
      const [columnType, value, expected] = args.length === 4 ? args.slice(1) : args

      withColumnTypes([{ id: 'c', type: columnType }])

      await service.changeMultipleColumnValues('987', '1', { c: value })

      expect(queryAt(1)).toContain(`column_values: ${ JSON.stringify(JSON.stringify({ c: JSON.parse(expected).c })) }`)
    })

    it.each([
      ['true', true, '{"c":{"checked":"true"}}'],
      ['1', 1, '{"c":{"checked":"true"}}'],
      ['"true"', 'true', '{"c":{"checked":"true"}}'],
      ['"1"', '1', '{"c":{"checked":"true"}}'],
      ['"no"', 'no', '{"c":{}}'],
    ])('wraps a checkbox value of %s', async (_label, value, expected) => {
      withColumnTypes([{ id: 'c', type: 'checkbox' }])

      await service.changeMultipleColumnValues('987', '1', { c: value })

      expect(queryAt(1)).toContain(`column_values: ${ JSON.stringify(expected) }`)
    })

    it('passes an already-structured hour value through', async () => {
      withColumnTypes([{ id: 'c', type: 'hour' }])

      await service.changeMultipleColumnValues('987', '1', { c: '{"hour":9,"minute":5}' })

      expect(queryAt(1)).toContain(`column_values: ${ JSON.stringify('{"c":{"hour":9,"minute":5}}') }`)
    })

    it('defaults the minute to 0 when an hour value has no minute part', async () => {
      withColumnTypes([{ id: 'c', type: 'hour' }])

      await service.changeMultipleColumnValues('987', '1', { c: '9' })

      expect(queryAt(1)).toContain(`column_values: ${ JSON.stringify('{"c":{"hour":9,"minute":0}}') }`)
    })

    it('passes an Array value through untouched instead of wrapping it', async () => {
      // KNOWN SERVICE BUG (minor): #wrapColumnValue delegates to #asObject first, and
      // #asObject treats any Array as an already-structured value. A people/dropdown/tags
      // column given a real Array therefore skips its wrapping branch and is sent raw,
      // which monday.com rejects. Only comma-separated Strings get wrapped. As a
      // consequence the Array.isArray branch of #toList is unreachable.
      withColumnTypes([{ id: 'c', type: 'people' }])

      await service.changeMultipleColumnValues('987', '1', { c: ['7'] })

      expect(queryAt(1)).toContain(`column_values: ${ JSON.stringify('{"c":["7"]}') }`)
    })

    it('wraps API failures', async () => {
      graphql([
        ['columns { id type }', { data: { boards: [{ columns: [] }] } }],
        ['change_multiple_column_values', () => {
          throw new Error('nope') 
        }],
      ])

      await expect(service.changeMultipleColumnValues('1', '2', { a: 'b' }))
        .rejects.toThrow('Failed to change multiple column values: nope')
    })
  })

  describe('addFileToColumn', () => {
    const SOURCE = 'https://files.example.com/reports/My%20Report.pdf?token=abc'

    it('downloads the file and posts a GraphQL multipart request', async () => {
      mock.onGet(SOURCE).reply(Buffer.from('PDF-BYTES'))
      mock.onPost(FILE_URL).reply({ data: { add_file_to_column: { id: '9', name: 'Report.pdf', url: 'https://x' } } })

      const result = await service.addFileToColumn('987', '1', 'files', SOURCE, 'Report.pdf')

      expect(result).toEqual({ id: '9', name: 'Report.pdf', url: 'https://x' })

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()

      expect(mock.history[1].url).toBe(FILE_URL)

      expect(mock.history[1].headers).toEqual({
        'Authorization': OAUTH_TOKEN,
        'API-Version': '2024-10',
      })

      const fields = mock.history[1].formData._fields

      expect(fields[0].name).toBe('query')

      expect(fields[0].value).toBe(
        'mutation ($file: File!) { add_file_to_column(item_id: 1, column_id: "files", file: $file) { id name url } }'
      )

      expect(fields[1]).toMatchObject({ name: 'map', value: '{"image":"variables.file"}' })
      expect(fields[2].name).toBe('image')
      expect(fields[2].filename).toEqual({ filename: 'Report.pdf' })
      expect(Buffer.isBuffer(fields[2].value)).toBe(true)
      expect(fields[2].value.toString()).toBe('PDF-BYTES')
    })

    it('derives the file name from the URL when none is given', async () => {
      mock.onGet(SOURCE).reply('text-body')
      mock.onPost(FILE_URL).reply({ data: { add_file_to_column: { id: '9' } } })

      await service.addFileToColumn('987', '1', 'files', SOURCE)

      const fields = mock.history[1].formData._fields

      expect(fields[2].filename).toEqual({ filename: 'My Report.pdf' })
      expect(fields[2].value.toString()).toBe('text-body')
    })

    it('re-serialises an auto-parsed JSON body back to bytes', async () => {
      mock.onGet(SOURCE).reply({ hello: 'world' })
      mock.onPost(FILE_URL).reply({ data: { add_file_to_column: { id: '9' } } })

      await service.addFileToColumn('987', '1', 'files', SOURCE, 'data.json')

      expect(mock.history[1].formData._fields[2].value.toString()).toBe('{"hello":"world"}')
    })

    it('surfaces a GraphQL errors array from the upload endpoint', async () => {
      mock.onGet(SOURCE).reply(Buffer.from('x'))
      mock.onPost(FILE_URL).reply({ errors: [{ message: 'Column is not a file column' }] })

      await expect(service.addFileToColumn('987', '1', 'text', SOURCE, 'f.pdf'))
        .rejects.toThrow('Failed to add file to column: Column is not a file column')
    })

    it('wraps a download failure', async () => {
      mock.onGet(SOURCE).replyWithError({ message: '404 Not Found' })

      await expect(service.addFileToColumn('987', '1', 'files', SOURCE, 'f.pdf'))
        .rejects.toThrow('Failed to add file to column: 404 Not Found')
    })
  })

  describe('moveItemToGroup', () => {
    it('builds the mutation', async () => {
      graphqlData({ move_item_to_group: { id: '1', name: 'Task' } })

      const result = await service.moveItemToGroup('987', '1', 'done_group')

      expect(queryAt()).toBe(
        'mutation { move_item_to_group(item_id: 1, group_id: "done_group") { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.moveItemToGroup('1', '2', 'g')).rejects.toThrow('Failed to move item to group: nope')
    })
  })

  describe('moveItemToBoard', () => {
    it('builds the mutation without mapping clauses', async () => {
      graphqlData({ move_item_to_board: { id: '1', name: 'Task' } })

      const result = await service.moveItemToBoard('1', '987', 'topics')

      expect(queryAt()).toBe(
        'mutation { move_item_to_board(board_id: 987, group_id: "topics", item_id: 1) { id name } }'
      )

      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('adds both column mapping clauses as GraphQL literals', async () => {
      graphqlData({ move_item_to_board: { id: '1' } })

      await service.moveItemToBoard(
        '1', '987', 'topics',
        [{ source: 'status', target: 'status_1' }, { source: 'drop', target: null }],
        '[{"source":"sub","target":"sub2"}]'
      )

      expect(queryAt()).toContain(
        ', columns_mapping: [{source: "status", target: "status_1"}, {source: "drop", target: null}]'
      )

      expect(queryAt()).toContain(', subitems_columns_mapping: [{source: "sub", target: "sub2"}]')
    })

    it('ignores non-object mapping values', async () => {
      graphqlData({ move_item_to_board: { id: '1' } })

      await service.moveItemToBoard('1', '987', 'topics', 'not-json', '')

      expect(queryAt()).not.toContain('columns_mapping')
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.moveItemToBoard('1', '2', 'g')).rejects.toThrow('Failed to move item to board: nope')
    })
  })

  describe('archiveItem', () => {
    it('builds the mutation', async () => {
      graphqlData({ archive_item: { id: '1', name: 'Task' } })

      const result = await service.archiveItem('987', '1')

      expect(queryAt()).toBe('mutation { archive_item(item_id: 1) { id name } }')
      expect(result).toEqual({ id: '1', name: 'Task' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.archiveItem('1', '2')).rejects.toThrow('Failed to archive item: nope')
    })
  })

  describe('deleteItem', () => {
    it('builds the mutation', async () => {
      graphqlData({ delete_item: { id: '1' } })

      const result = await service.deleteItem('987', '1')

      expect(queryAt()).toBe('mutation { delete_item(item_id: 1) { id } }')
      expect(result).toEqual({ id: '1' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.deleteItem('1', '2')).rejects.toThrow('Failed to delete item: nope')
    })
  })

  // ── Subitems ──

  describe('createSubitem', () => {
    it('builds the mutation without column values', async () => {
      graphqlData({ create_subitem: { id: '2', name: 'Sub', board: { id: '3' } } })

      const result = await service.createSubitem('987', '1', 'Sub')

      expect(queryAt()).toBe(
        'mutation { create_subitem(parent_item_id: 1, item_name: "Sub") { id name board { id } } }'
      )

      expect(result).toEqual({ id: '2', name: 'Sub', board: { id: '3' } })
    })

    it('escapes the subitem name', async () => {
      graphqlData({ create_subitem: { id: '2' } })

      await service.createSubitem('987', '1', 'a"b')

      expect(queryAt()).toContain('item_name: "a\\"b"')
    })

    it('passes a raw JSON string of column values through unchanged', async () => {
      graphqlData({ create_subitem: { id: '2' } })

      await service.createSubitem('987', '1', 'Sub', '{"text":"x"}')

      expect(mock.history).toHaveLength(1)
      expect(queryAt()).toContain(', column_values: "{\\"text\\":\\"x\\"}")')
    })

    it('serialises an object of column values without a board type lookup', async () => {
      graphqlData({ create_subitem: { id: '2' } })

      await service.createSubitem('987', '1', 'Sub', { status: 'Done' })

      // No boardId is passed to the formatter here, so values stay unwrapped scalars.
      expect(mock.history).toHaveLength(1)
      expect(queryAt()).toContain(', column_values: "{\\"status\\":\\"Done\\"}")')
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createSubitem('1', '2', 'S')).rejects.toThrow('Failed to create subitem: nope')
    })
  })

  describe('deleteSubitem', () => {
    it('builds the mutation', async () => {
      graphqlData({ delete_item: { id: '2' } })

      const result = await service.deleteSubitem('2')

      expect(queryAt()).toBe('mutation { delete_item(item_id: 2) { id } }')
      expect(result).toEqual({ id: '2' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.deleteSubitem('2')).rejects.toThrow('Failed to delete subitem: nope')
    })
  })

  // ── Updates ──

  describe('createUpdate', () => {
    it('builds the mutation and escapes quotes, backslashes and newlines', async () => {
      graphqlData({ create_update: { id: '5', body: '<p>Done</p>' } })

      const result = await service.createUpdate('987', '1', 'line "one"\nline \\two')

      expect(queryAt()).toBe(
        'mutation { create_update(item_id: 1, body: "line \\"one\\"\\nline \\\\two") { id body created_at creator { id name } } }'
      )

      expect(result).toEqual({ id: '5', body: '<p>Done</p>' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createUpdate('1', '2', 'b')).rejects.toThrow('Failed to create update: nope')
    })
  })

  describe('deleteUpdate', () => {
    it('builds the mutation', async () => {
      graphqlData({ delete_update: { id: '5' } })

      const result = await service.deleteUpdate('5')

      expect(queryAt()).toBe('mutation { delete_update(id: 5) { id } }')
      expect(result).toEqual({ id: '5' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.deleteUpdate('5')).rejects.toThrow('Failed to delete update: nope')
    })
  })

  // ── Boards ──

  describe('createBoard', () => {
    it.each([
      ['Public', 'public'],
      ['Private', 'private'],
      ['Shareable', 'share'],
      ['public', 'public'],
    ])('maps board kind %s to %s', async (label, apiValue) => {
      graphqlData({ create_board: { id: '1' } })

      await service.createBoard('B', label)

      expect(queryAt()).toBe(`mutation { create_board(board_name: "B", board_kind: ${ apiValue }) { id name board_kind } }`)
    })

    it('adds a workspace clause and escapes the name', async () => {
      graphqlData({ create_board: { id: '1', name: 'New "Board"', board_kind: 'public' } })

      const result = await service.createBoard('New "Board"', 'Public', '654321')

      expect(queryAt()).toBe(
        'mutation { create_board(board_name: "New \\"Board\\"", board_kind: public, workspace_id: 654321) { id name board_kind } }'
      )

      expect(result).toEqual({ id: '1', name: 'New "Board"', board_kind: 'public' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createBoard('B', 'Public')).rejects.toThrow('Failed to create board: nope')
    })
  })

  describe('duplicateBoard', () => {
    it.each([
      ['Structure Only', 'duplicate_board_with_structure'],
      ['Structure and Items', 'duplicate_board_with_pulses'],
      ['Structure, Items and Updates', 'duplicate_board_with_pulses_and_updates'],
      ['duplicate_board_with_structure', 'duplicate_board_with_structure'],
    ])('maps duplicate type %s to %s', async (label, apiValue) => {
      graphqlData({ duplicate_board: { board: { id: '2' } } })

      await service.duplicateBoard('987', label)

      expect(queryAt()).toBe(
        `mutation { duplicate_board(board_id: 987, duplicate_type: ${ apiValue }) { board { id name } } }`
      )
    })

    it('adds an escaped board name clause', async () => {
      graphqlData({ duplicate_board: { board: { id: '2', name: 'Copy' } } })

      const result = await service.duplicateBoard('987', 'Structure Only', 'My "Copy"')

      expect(queryAt()).toContain(', board_name: "My \\"Copy\\""')
      expect(result).toEqual({ board: { id: '2', name: 'Copy' } })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.duplicateBoard('1', 'Structure Only')).rejects.toThrow('Failed to duplicate board: nope')
    })
  })

  describe('getBoard', () => {
    it('requests the board with columns, groups and owners', async () => {
      graphqlData({ boards: [{ id: '987', name: 'Project Tracker' }] })

      const result = await service.getBoard('987')

      expect(queryAt()).toBe(
        '{ boards(ids: [987]) { id name description board_kind state permissions columns { id title type } groups { id title color } owners { id name } } }'
      )

      expect(result).toEqual({ id: '987', name: 'Project Tracker' })
    })

    it('throws when the board is not found', async () => {
      graphqlData({ boards: [] })

      await expect(service.getBoard('404')).rejects.toThrow('Failed to get board: Board with ID 404 not found.')
    })
  })

  describe('deleteBoard', () => {
    it('builds the mutation', async () => {
      graphqlData({ delete_board: { id: '987' } })

      const result = await service.deleteBoard('987')

      expect(queryAt()).toBe('mutation { delete_board(board_id: 987) { id } }')
      expect(result).toEqual({ id: '987' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.deleteBoard('1')).rejects.toThrow('Failed to delete board: nope')
    })
  })

  // ── Groups ──

  describe('createGroup', () => {
    it('builds the mutation and escapes the group name', async () => {
      graphqlData({ create_group: { id: 'g1', title: 'In "Progress"' } })

      const result = await service.createGroup('987', 'In "Progress"')

      expect(queryAt()).toBe(
        'mutation { create_group(board_id: 987, group_name: "In \\"Progress\\"") { id title } }'
      )

      expect(result).toEqual({ id: 'g1', title: 'In "Progress"' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createGroup('1', 'G')).rejects.toThrow('Failed to create group: nope')
    })
  })

  describe('deleteGroup', () => {
    it('builds the mutation', async () => {
      graphqlData({ delete_group: { id: 'topics', deleted: true } })

      const result = await service.deleteGroup('987', 'topics')

      expect(queryAt()).toBe('mutation { delete_group(board_id: 987, group_id: "topics") { id deleted } }')
      expect(result).toEqual({ id: 'topics', deleted: true })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.deleteGroup('1', 'g')).rejects.toThrow('Failed to delete group: nope')
    })
  })

  describe('duplicateGroup', () => {
    it('omits the add_to_top clause by default', async () => {
      graphqlData({ duplicate_group: { id: 'g2', title: 'To Do (copy)' } })

      const result = await service.duplicateGroup('987', 'topics')

      expect(queryAt()).toBe('mutation { duplicate_group(board_id: 987, group_id: "topics") { id title } }')
      expect(result).toEqual({ id: 'g2', title: 'To Do (copy)' })
    })

    it('adds the add_to_top clause when enabled', async () => {
      graphqlData({ duplicate_group: { id: 'g2' } })

      await service.duplicateGroup('987', 'topics', true)

      expect(queryAt()).toContain(', add_to_top: true')
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.duplicateGroup('1', 'g')).rejects.toThrow('Failed to duplicate group: nope')
    })
  })

  // ── Workspaces ──

  describe('createWorkspace', () => {
    it.each([
      ['Open', 'open'],
      ['Closed', 'closed'],
      ['open', 'open'],
    ])('maps workspace kind %s to %s', async (label, apiValue) => {
      graphqlData({ create_workspace: { id: '1' } })

      await service.createWorkspace('W', label)

      expect(queryAt()).toBe(
        `mutation { create_workspace(name: "W", kind: ${ apiValue }) { id name kind description } }`
      )
    })

    it('adds an escaped multi-line description clause', async () => {
      graphqlData({ create_workspace: { id: '1', name: 'Eng' } })

      const result = await service.createWorkspace('Eng', 'Open', 'line "1"\nline \\2')

      expect(queryAt()).toContain(', description: "line \\"1\\"\\nline \\\\2"')
      expect(result).toEqual({ id: '1', name: 'Eng' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createWorkspace('W', 'Open')).rejects.toThrow('Failed to create workspace: nope')
    })
  })

  // ── Columns ──

  describe('createColumn', () => {
    it.each([
      ['Text', 'text'],
      ['Long Text', 'long_text'],
      ['Numbers', 'numbers'],
      ['Status', 'status'],
      ['Dropdown', 'dropdown'],
      ['Date', 'date'],
      ['Checkbox', 'checkbox'],
      ['Email', 'email'],
      ['Phone', 'phone'],
      ['Link', 'link'],
      ['Rating', 'rating'],
      ['Hour', 'hour'],
      ['Color Picker', 'color_picker'],
      ['Country', 'country'],
      ['People', 'people'],
      ['Timeline', 'timeline'],
      ['Tags', 'tags'],
      ['Week', 'week'],
      ['Location', 'location'],
      ['text', 'text'],
    ])('maps column type %s to %s', async (label, apiValue) => {
      graphqlData({ create_column: { id: 'c1', title: 'Notes', type: apiValue } })

      await service.createColumn('987', 'Notes', label)

      expect(queryAt()).toBe(
        `mutation { create_column(board_id: 987, title: "Notes", column_type: ${ apiValue }) { id title type } }`
      )
    })

    it('adds an escaped description clause', async () => {
      graphqlData({ create_column: { id: 'c1' } })

      const result = await service.createColumn('987', 'A "B"', 'Text', 'desc "x"')

      expect(queryAt()).toContain('title: "A \\"B\\""')
      expect(queryAt()).toContain(', description: "desc \\"x\\""')
      expect(result).toEqual({ id: 'c1' })
    })

    it('wraps API failures', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'nope' })

      await expect(service.createColumn('1', 'T', 'Text')).rejects.toThrow('Failed to create column: nope')
    })
  })

  // ── Param schema loader ──

  describe('columnValuesSchemaLoader', () => {
    it('returns an empty schema without a board id', async () => {
      expect(await service.columnValuesSchemaLoader({ criteria: {} })).toEqual([])
      expect(mock.history).toHaveLength(0)
    })

    it('filters out read-only columns and maps the rest to param definitions', async () => {
      graphqlData({
        boards: [{
          columns: [
            { id: 'name', title: 'Name', type: 'name' },
            { id: 'formula', title: 'Formula', type: 'formula' },
            { id: 'mirror', title: 'Mirror', type: 'mirror' },
            { id: 'text', title: 'Notes', type: 'text' },
            { id: 'nums', title: 'Score', type: 'numbers' },
            { id: 'flag', title: 'Done?', type: 'checkbox' },
            { id: 'body', title: 'Body', type: 'long_text' },
            { id: 'stars', title: 'Stars', type: 'rating' },
          ],
        }],
      })

      const result = await service.columnValuesSchemaLoader({ criteria: { boardId: '987' } })

      expect(queryAt()).toBe('{ boards(ids: [987]) { columns { id title type } } }')

      expect(result).toEqual([
        { type: 'String', label: 'Notes', name: 'text', description: 'Plain text value.', uiComponent: { type: 'SINGLE_LINE_TEXT' } },
        { type: 'Number', label: 'Score', name: 'nums', description: 'Numeric value.', uiComponent: { type: 'NUMERIC' } },
        { type: 'Boolean', label: 'Done?', name: 'flag', description: 'Checked or unchecked.', uiComponent: { type: 'TOGGLE' } },
        { type: 'String', label: 'Body', name: 'body', description: 'Long text or rich text content.', uiComponent: { type: 'MULTI_LINE_TEXT' } },
        { type: 'Number', label: 'Stars', name: 'stars', description: 'Rating value (1-5).', uiComponent: { type: 'NUMERIC_STEPPER' } },
      ])
    })

    it('falls back to a generic definition for an unmapped column type', async () => {
      graphqlData({ boards: [{ columns: [{ id: 'x', title: 'Exotic', type: 'vote' }] }] })

      const result = await service.columnValuesSchemaLoader({ criteria: { boardId: '987' } })

      expect(result).toEqual([{
        type: 'String',
        label: 'Exotic',
        name: 'x',
        description: 'Column type: vote.',
        uiComponent: { type: 'SINGLE_LINE_TEXT' },
      }])
    })

    it('tolerates a board with no columns and returns an empty schema on error', async () => {
      graphqlData({ boards: [] })
      expect(await service.columnValuesSchemaLoader({ criteria: { boardId: '1' } })).toEqual([])

      mock.reset()
      mock.onPost(API_URL).replyWithError({ message: 'boom' })
      expect(await service.columnValuesSchemaLoader({ criteria: { boardId: '1' } })).toEqual([])
    })
  })

  // ── Polling triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named trigger method', async () => {
      graphqlData({ boards: [{ items_page: { cursor: null, items: [{ id: '1', name: 'A' }] } }] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewItem',
        triggerData: { boardId: '987' },
        learningMode: true,
      })

      expect(result).toEqual({ events: [{ id: '1', name: 'A' }], state: null })
    })
  })

  describe('onNewItem', () => {
    const page = (items, cursor = null) => ({ boards: [{ items_page: { cursor, items } }] })

    it('returns the first item and no state in learning mode', async () => {
      graphqlData(page([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]))

      const result = await service.onNewItem({ triggerData: { boardId: '987' }, learningMode: true })

      expect(queryAt()).toBe(
        '{ boards(ids: [987]) { items_page(limit: 100) { cursor items { id name created_at group { id title } column_values { id column { title } text type } } } } }'
      )

      expect(result).toEqual({ events: [{ id: '1', name: 'A' }], state: null })
    })

    it('seeds state without emitting on the first poll', async () => {
      graphqlData(page([{ id: '1' }, { id: '2' }]))

      const result = await service.onNewItem({ triggerData: { boardId: '987' } })

      expect(result).toEqual({ events: [], state: { itemIds: ['1', '2'] } })
    })

    it('emits only items absent from the previous state', async () => {
      graphqlData(page([{ id: '1' }, { id: '2' }, { id: '3' }]))

      const result = await service.onNewItem({
        triggerData: { boardId: '987' },
        state: { itemIds: ['1', '2'] },
      })

      expect(result).toEqual({ events: [{ id: '3' }], state: { itemIds: ['1', '2', '3'] } })
    })

    it('follows next_items_page cursors to collect every item', async () => {
      graphql([
        ['boards(ids: [987])', { data: page([{ id: '1' }], 'c1') }],
        ['next_items_page(limit: 100, cursor: "c1")', { data: { next_items_page: { cursor: null, items: [{ id: '2' }] } } }],
      ])

      const result = await service.onNewItem({ triggerData: { boardId: '987' } })

      expect(mock.history).toHaveLength(2)
      expect(result.state).toEqual({ itemIds: ['1', '2'] })
    })

    it('returns whatever was collected when a page request fails', async () => {
      mock.onPost(API_URL).replyWithError({ message: 'rate limited' })

      const result = await service.onNewItem({ triggerData: { boardId: '987' } })

      expect(result).toEqual({ events: [], state: { itemIds: [] } })
    })
  })

  describe('onItemColumnChange', () => {
    const page = items => ({ boards: [{ items_page: { cursor: null, items } }] })

    it('returns the first item and no state in learning mode', async () => {
      graphqlData(page([{ id: '1', updated_at: 't1' }]))

      const result = await service.onItemColumnChange({ triggerData: { boardId: '987' }, learningMode: true })

      expect(queryAt()).toContain('items { id name updated_at group { id title }')
      expect(result).toEqual({ events: [{ id: '1', updated_at: 't1' }], state: null })
    })

    it('seeds a timestamp map without emitting on the first poll', async () => {
      graphqlData(page([{ id: '1', updated_at: 't1' }, { id: '2', updated_at: 't2' }]))

      const result = await service.onItemColumnChange({ triggerData: { boardId: '987' } })

      expect(result).toEqual({ events: [], state: { itemTimestamps: { 1: 't1', 2: 't2' } } })
    })

    it('emits items whose timestamp changed and items it has never seen', async () => {
      graphqlData(page([
        { id: '1', updated_at: 't1' },
        { id: '2', updated_at: 't2-new' },
        { id: '3', updated_at: 't3' },
      ]))

      const result = await service.onItemColumnChange({
        triggerData: { boardId: '987' },
        state: { itemTimestamps: { 1: 't1', 2: 't2' } },
      })

      expect(result).toEqual({
        events: [{ id: '2', updated_at: 't2-new' }, { id: '3', updated_at: 't3' }],
        state: { itemTimestamps: { 1: 't1', 2: 't2-new', 3: 't3' } },
      })
    })

    it('emits nothing when no timestamps moved', async () => {
      graphqlData(page([{ id: '1', updated_at: 't1' }]))

      const result = await service.onItemColumnChange({
        triggerData: { boardId: '987' },
        state: { itemTimestamps: { 1: 't1' } },
      })

      expect(result.events).toEqual([])
    })
  })
})
