'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SUPABASE_URL = 'https://project.supabase.co'
const SUPABASE_KEY = 'test-anon-key'
const REST = `${ SUPABASE_URL }/rest/v1`

const AUTH_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${ SUPABASE_KEY }`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

describe('Supabase Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY })
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
    it('registers the project URL and API key config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['supabaseUrl', 'supabaseKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'supabaseUrl', required: true, type: 'STRING' }),
          expect.objectContaining({ name: 'supabaseKey', required: true, type: 'STRING' }),
        ])
      )
    })
  })

  // ── CRUD: select ──

  describe('select', () => {
    it('selects all columns by default with the auth headers', async () => {
      mock.onGet(`${ REST }/users`).reply([{ id: 1 }])

      const result = await service.select('users')

      expect(result).toEqual([{ id: 1 }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ select: '*' })
    })

    it('passes an explicit column list', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', 'id, name')

      expect(mock.history[0].query).toEqual({ select: 'id, name' })
    })

    it('applies a simple filter as column=operator.value', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', '*', { column: 'status', operator: 'eq', value: 'active' })

      expect(mock.history[0].query).toEqual({ select: '*', status: 'eq.active' })
    })

    it('ignores an incomplete filter', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', '*', { column: 'status', operator: 'eq' })

      expect(mock.history[0].query).toEqual({ select: '*' })
    })

    it('parses an advanced filter string into query params', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', '*', undefined, 'id=eq.1&status=eq.active')

      expect(mock.history[0].query).toEqual({ select: '*', id: 'eq.1', status: 'eq.active' })
    })

    it('skips malformed advanced filter segments', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', '*', undefined, 'broken&id=eq.1&=nokey')

      expect(mock.history[0].query).toEqual({ select: '*', id: 'eq.1' })
    })

    it('lets the advanced filter override the simple filter for the same column', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.select('users', '*', { column: 'id', operator: 'eq', value: 1 }, 'id=eq.2')

      expect(mock.history[0].query).toEqual({ select: '*', id: 'eq.2' })
    })

    it('wraps request failures', async () => {
      mock.onGet(`${ REST }/users`).replyWithError({ message: 'Invalid API key' })

      await expect(service.select('users')).rejects.toThrow('Supabase API request failed: Invalid API key')
    })
  })

  // ── CRUD: insert ──

  describe('insert', () => {
    it('reduces the data fields into a record and returns the first row', async () => {
      mock.onPost(`${ REST }/users`).reply([{ id: 1, name: 'Ada' }])

      const result = await service.insert('users', [
        { key: 'name', value: 'Ada' },
        { key: 'email', value: 'ada@example.com' },
      ])

      expect(result).toEqual({ id: 1, name: 'Ada' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Ada', email: 'ada@example.com' })
      expect(mock.history[0].headers).toMatchObject({ Prefer: 'return=representation' })
    })

    it('returns a non-array response as-is', async () => {
      mock.onPost(`${ REST }/users`).reply({ id: 2 })

      const result = await service.insert('users', [{ key: 'name', value: 'Bob' }])

      expect(result).toEqual({ id: 2 })
    })

    it('sends an empty record when no data is supplied', async () => {
      mock.onPost(`${ REST }/users`).reply([])

      const result = await service.insert('users')

      expect(mock.history[0].body).toEqual({})
      expect(result).toBeUndefined()
    })

    it('wraps request failures', async () => {
      mock.onPost(`${ REST }/users`).replyWithError({ message: 'duplicate key value' })

      await expect(service.insert('users', [])).rejects.toThrow(
        'Supabase API request failed: duplicate key value'
      )
    })
  })

  // ── CRUD: update ──

  describe('update', () => {
    it('patches matching rows using the simple filter', async () => {
      mock.onPatch(`${ REST }/users`).reply([{ id: 1, name: 'Ada L.' }])

      const result = await service.update(
        'users',
        [{ key: 'name', value: 'Ada L.' }],
        { column: 'id', operator: 'eq', value: 1 }
      )

      expect(result).toEqual([{ id: 1, name: 'Ada L.' }])
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ name: 'Ada L.' })
      expect(mock.history[0].query).toEqual({ id: 'eq.1' })
    })

    it('accepts an advanced filter only', async () => {
      mock.onPatch(`${ REST }/users`).reply([])

      await service.update('users', [{ key: 'name', value: 'X' }], undefined, 'status=eq.active')

      expect(mock.history[0].query).toEqual({ status: 'eq.active' })
    })

    it('refuses to update every row when no filter is provided', async () => {
      await expect(service.update('users', [{ key: 'name', value: 'X' }])).rejects.toThrow(
        'Update requires a filter to avoid updating all records.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('refuses to update when the filter is incomplete', async () => {
      await expect(
        service.update('users', [], { column: 'id', operator: 'eq' })
      ).rejects.toThrow('Update requires a filter to avoid updating all records.')

      expect(mock.history).toHaveLength(0)
    })

    it('refuses to update when the advanced filter is malformed', async () => {
      await expect(service.update('users', [], undefined, 'garbage')).rejects.toThrow(
        'Update requires a filter to avoid updating all records.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── CRUD: delete ──

  describe('delete', () => {
    it('deletes matching rows using the simple filter', async () => {
      mock.onDelete(`${ REST }/users`).reply([{ id: 1 }])

      const result = await service.delete('users', { column: 'id', operator: 'eq', value: 1 })

      expect(result).toEqual([{ id: 1 }])
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ id: 'eq.1' })
    })

    it('deletes using an advanced filter', async () => {
      mock.onDelete(`${ REST }/users`).reply([])

      await service.delete('users', undefined, 'status=eq.stale&kind=eq.temp')

      expect(mock.history[0].query).toEqual({ status: 'eq.stale', kind: 'eq.temp' })
    })

    it('refuses to delete every row when no filter is provided', async () => {
      await expect(service.delete('users')).rejects.toThrow(
        'Delete requires a filter to avoid deleting all records.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('refuses to delete when the filter is incomplete', async () => {
      await expect(service.delete('users', { column: 'id', value: 1 })).rejects.toThrow(
        'Delete requires a filter to avoid deleting all records.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('refuses to delete when the advanced filter has no usable pairs', async () => {
      await expect(service.delete('users', null, 'nope&&')).rejects.toThrow(
        'Delete requires a filter to avoid deleting all records.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Triggers (passthrough shells) ──

  describe('trigger operations', () => {
    it.each(['onRecordCreated', 'onRecordUpdated', 'onRecordDeleted'])(
      '%s returns the payload unchanged',
      async method => {
        const payload = { id: 1, table: 'users' }

        await expect(service[method](payload)).resolves.toBe(payload)
      }
    )
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('maps the OpenAPI definitions to dictionary items', async () => {
      mock.onGet(`${ REST }/`).reply({ definitions: { users: {}, orders: {} } })

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'users', value: 'users', note: 'Table' },
          { label: 'orders', value: 'orders', note: 'Table' },
        ],
        cursor: null,
      })
    })

    it('filters tables case-insensitively', async () => {
      mock.onGet(`${ REST }/`).reply({ definitions: { users: {}, orders: {} } })

      const result = await service.getTablesDictionary({ search: 'ORD' })

      expect(result.items).toEqual([{ label: 'orders', value: 'orders', note: 'Table' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ REST }/`).reply({ definitions: { users: {} } })

      const result = await service.getTablesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('returns an empty list when there are no definitions', async () => {
      mock.onGet(`${ REST }/`).reply({})

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getColumnsDictionary', () => {
    const SCHEMA = {
      definitions: {
        users: {
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            meta: {},
          },
        },
      },
    }

    it('maps the table properties to dictionary items with type notes', async () => {
      mock.onGet(`${ REST }/`).reply(SCHEMA)

      const result = await service.getColumnsDictionary({ criteria: { table: 'users' } })

      expect(result).toEqual({
        items: [
          { label: 'id', value: 'id', note: 'integer' },
          { label: 'name', value: 'name', note: 'string' },
          { label: 'meta', value: 'meta', note: 'unknown' },
        ],
        cursor: null,
      })
    })

    it('filters columns case-insensitively', async () => {
      mock.onGet(`${ REST }/`).reply(SCHEMA)

      const result = await service.getColumnsDictionary({
        search: 'NA',
        criteria: { table: 'users' },
      })

      expect(result.items).toEqual([{ label: 'name', value: 'name', note: 'string' }])
    })

    it('returns an empty list without hitting the API when no table is given', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('handles a null payload', async () => {
      const result = await service.getColumnsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty list for an unknown table', async () => {
      mock.onGet(`${ REST }/`).reply(SCHEMA)

      const result = await service.getColumnsDictionary({ criteria: { table: 'ghosts' } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns an empty list when the definition has no properties', async () => {
      mock.onGet(`${ REST }/`).reply({ definitions: { users: {} } })

      const result = await service.getColumnsDictionary({ criteria: { table: 'users' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getOperatorsDictionary', () => {
    it('returns the static PostgREST operator list without any request', async () => {
      const result = await service.getOperatorsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(10)
      expect(result.items[0]).toEqual({ label: 'Equals', value: 'eq', note: '=' })

      expect(result.items.map(item => item.value)).toEqual(
        expect.arrayContaining(['eq', 'gt', 'lt', 'gte', 'lte', 'neq', 'like', 'ilike', 'in', 'is'])
      )

      expect(mock.history).toHaveLength(0)
    })

    it('tolerates a null payload', async () => {
      await expect(service.getOperatorsDictionary(null)).resolves.toHaveProperty('cursor', null)
    })
  })

  // ── Sample result loader ──

  describe('getRecordSchema', () => {
    it('returns the first record of the table', async () => {
      mock.onGet(`${ REST }/users`).reply([{ id: 1, name: 'Ada' }])

      const result = await service.getRecordSchema({ criteria: { table: 'users' } })

      expect(result).toEqual({ id: 1, name: 'Ada' })
      expect(mock.history[0].query).toEqual({ limit: 1 })
    })

    it('returns an empty object when no table is given', async () => {
      await expect(service.getRecordSchema({})).resolves.toEqual({})
      await expect(service.getRecordSchema(null)).resolves.toEqual({})
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty object when the table is empty', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await expect(service.getRecordSchema({ criteria: { table: 'users' } })).resolves.toEqual({})
    })

    it('swallows request errors and returns an empty object', async () => {
      mock.onGet(`${ REST }/users`).replyWithError({ message: 'permission denied' })

      await expect(service.getRecordSchema({ criteria: { table: 'users' } })).resolves.toEqual({})
    })
  })

  // ── Trigger system methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('echoes back the webhook URL for manual setup', async () => {
      await expect(service.handleTriggerUpsertWebhook('https://hook.example.com', [])).resolves.toBe(
        'https://hook.example.com'
      )
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('is a no-op that resolves true', async () => {
      await expect(service.handleTriggerDeleteWebhook('https://hook.example.com', [])).resolves.toBe(true)
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('wraps a typed event body in an array', async () => {
      const event = { type: 'INSERT', table: 'users', record: { id: 1 } }

      await expect(service.handleTriggerResolveEvents({ body: event })).resolves.toEqual([event])
    })

    it('returns an empty array for a missing or untyped body', async () => {
      await expect(service.handleTriggerResolveEvents({})).resolves.toEqual([])
      await expect(service.handleTriggerResolveEvents({ body: { table: 'users' } })).resolves.toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    const events = [
      { type: 'INSERT', table: 'users', record: { id: 1 } },
      { type: 'UPDATE', table: 'users', record: { id: 2 } },
      { type: 'DELETE', table: 'users', old_record: { id: 3 } },
      { type: 'INSERT', table: 'orders', record: { id: 4 } },
    ]

    it('selects inserted records for the configured table', async () => {
      const result = await service.handleTriggerSelectMatched(events, {
        method: 'onRecordCreated',
        input: { table: 'users' },
      })

      expect(result).toEqual([{ id: 1 }])
    })

    it('selects updated records', async () => {
      const result = await service.handleTriggerSelectMatched(events, {
        method: 'onRecordUpdated',
        input: { table: 'users' },
      })

      expect(result).toEqual([{ id: 2 }])
    })

    it('selects the old record for delete events', async () => {
      const result = await service.handleTriggerSelectMatched(events, {
        method: 'onRecordDeleted',
        input: { table: 'users' },
      })

      expect(result).toEqual([{ id: 3 }])
    })

    it('returns nothing for an unrelated table', async () => {
      const result = await service.handleTriggerSelectMatched(events, {
        method: 'onRecordCreated',
        input: { table: 'invoices' },
      })

      expect(result).toEqual([])
    })

    it('returns nothing for an unknown trigger method', async () => {
      const result = await service.handleTriggerSelectMatched(events, {
        method: 'onSomethingElse',
        input: { table: 'users' },
      })

      expect(result).toEqual([])
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('polls with the default timestamp column from the epoch', async () => {
      mock.onGet(`${ REST }/users`).reply([{ id: 1 }])

      const result = await service.handleTriggerPollingForEvent(
        { method: 'onRecordCreated', input: { table: 'users' } },
        null
      )

      expect(result).toEqual([{ id: 1 }])

      expect(mock.history[0].query).toEqual({
        created_at: `gt.${ new Date(0).toISOString() }`,
        order: 'created_at.asc',
      })
    })

    it('uses the supplied timestamp column and last poll time', async () => {
      mock.onGet(`${ REST }/users`).reply([])

      await service.handleTriggerPollingForEvent(
        { method: 'onRecordUpdated', input: { table: 'users', timestampColumn: 'updated_at' } },
        '2024-01-01T00:00:00.000Z'
      )

      expect(mock.history[0].query).toEqual({
        updated_at: 'gt.2024-01-01T00:00:00.000Z',
        order: 'updated_at.asc',
      })
    })

    it('does not poll for delete triggers', async () => {
      const result = await service.handleTriggerPollingForEvent(
        { method: 'onRecordDeleted', input: { table: 'users' } },
        null
      )

      expect(result).toEqual([])
      expect(mock.history).toHaveLength(0)
    })

    it('normalizes a non-array response to an empty array', async () => {
      mock.onGet(`${ REST }/users`).reply({ message: 'oops' })

      const result = await service.handleTriggerPollingForEvent(
        { method: 'onRecordCreated', input: { table: 'users' } },
        null
      )

      expect(result).toEqual([])
    })

    it('wraps polling request failures', async () => {
      mock.onGet(`${ REST }/users`).replyWithError({ message: 'relation does not exist' })

      await expect(
        service.handleTriggerPollingForEvent({ method: 'onRecordCreated', input: { table: 'users' } }, null)
      ).rejects.toThrow('Supabase API request failed: relation does not exist')
    })
  })
})
