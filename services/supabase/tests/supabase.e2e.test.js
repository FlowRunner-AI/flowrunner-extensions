'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Supabase Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('supabase')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('lists the tables exposed by PostgREST', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Table')
      }
    })

    it('filters tables by search term', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping getTablesDictionary search: testValues.table not set')

        return
      }

      const result = await service.getTablesDictionary({ search: table })

      expect(result.items.map(item => item.value)).toContain(table)
    })
  })

  describe('getColumnsDictionary', () => {
    it('lists the columns of the configured table', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping getColumnsDictionary: testValues.table not set')

        return
      }

      const result = await service.getColumnsDictionary({ criteria: { table } })

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('returns an empty list without criteria', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getOperatorsDictionary', () => {
    it('returns the static operator list', async () => {
      const result = await service.getOperatorsDictionary({})

      expect(result.items).toHaveLength(10)
      expect(result.cursor).toBeNull()
    })
  })

  // ── CRUD ──

  describe('select', () => {
    it('reads rows from the configured table', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping select: testValues.table not set')

        return
      }

      const result = await service.select(table)

      expect(Array.isArray(result)).toBe(true)
    })

    it('supports an advanced filter', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping select (advanced filter): testValues.table not set')

        return
      }

      const result = await service.select(table, '*', undefined, 'limit=1')

      expect(Array.isArray(result)).toBe(true)
    })

    it('rejects for an unknown table', async () => {
      await expect(service.select(`missing_table_${ SUFFIX }`)).rejects.toThrow(
        /Supabase API request failed/
      )
    })
  })

  describe('record lifecycle', () => {
    let createdId

    it('inserts a record', async () => {
      const { table, insertFields } = testValues

      if (!table || !insertFields) {
        console.log('Skipping record lifecycle: testValues.table or testValues.insertFields not set')

        return
      }

      const result = await service.insert(table, insertFields)

      expect(result).toBeTruthy()
      expect(result).toHaveProperty('id')
      createdId = result.id
    })

    it('updates the inserted record', async () => {
      const { table, updateFields } = testValues

      if (!createdId || !updateFields) {
        console.log('Skipping update: no record was inserted or testValues.updateFields not set')

        return
      }

      const result = await service.update(table, updateFields, {
        column: 'id',
        operator: 'eq',
        value: createdId,
      })

      expect(Array.isArray(result)).toBe(true)
    })

    it('selects the inserted record back with a simple filter', async () => {
      if (!createdId) {
        console.log('Skipping select by id: no record was inserted')

        return
      }

      const result = await service.select(testValues.table, '*', {
        column: 'id',
        operator: 'eq',
        value: createdId,
      })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
    })

    it('deletes the inserted record', async () => {
      if (!createdId) {
        console.log('Skipping delete: no record was inserted')

        return
      }

      const result = await service.delete(testValues.table, {
        column: 'id',
        operator: 'eq',
        value: createdId,
      })

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Destructive-operation guards (no request is made) ──

  describe('unfiltered write guards', () => {
    it('refuses an unfiltered update', async () => {
      await expect(
        service.update(testValues.table || 'any_table', [{ key: 'x', value: 1 }])
      ).rejects.toThrow('Update requires a filter to avoid updating all records.')
    })

    it('refuses an unfiltered delete', async () => {
      await expect(service.delete(testValues.table || 'any_table')).rejects.toThrow(
        'Delete requires a filter to avoid deleting all records.'
      )
    })
  })

  // ── Sample result loader ──

  describe('getRecordSchema', () => {
    it('returns a sample record shape for the configured table', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping getRecordSchema: testValues.table not set')

        return
      }

      const result = await service.getRecordSchema({ criteria: { table } })

      expect(typeof result).toBe('object')
    })

    it('returns an empty object without a table', async () => {
      await expect(service.getRecordSchema({})).resolves.toEqual({})
    })
  })

  // ── Trigger system methods (no network) ──

  describe('trigger system methods', () => {
    it('echoes the webhook URL and no-ops on delete', async () => {
      await expect(service.handleTriggerUpsertWebhook('https://hook.example.com', [])).resolves.toBe(
        'https://hook.example.com'
      )

      await expect(service.handleTriggerDeleteWebhook('https://hook.example.com', [])).resolves.toBe(true)
    })

    it('resolves and filters webhook events', async () => {
      const event = { type: 'INSERT', table: 'users', record: { id: 1 } }
      const events = await service.handleTriggerResolveEvents({ body: event })

      expect(events).toEqual([event])

      const matched = await service.handleTriggerSelectMatched(events, {
        method: 'onRecordCreated',
        input: { table: 'users' },
      })

      expect(matched).toEqual([{ id: 1 }])
    })

    it('polls the configured table for new rows', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping polling: testValues.table not set')

        return
      }

      const result = await service.handleTriggerPollingForEvent(
        { method: 'onRecordCreated', input: { table } },
        new Date().toISOString()
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
