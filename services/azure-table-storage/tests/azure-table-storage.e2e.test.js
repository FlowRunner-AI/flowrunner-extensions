'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure Table Storage Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-table-storage')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Tables ──

  describe('table operations', () => {
    const testTableName = `E2ETest${ Date.now() }`

    it('creates a table', async () => {
      const result = await service.createTable(testTableName)

      expect(result).toHaveProperty('TableName', testTableName)
    })

    it('lists tables and includes the created table', async () => {
      const result = await service.listTables()

      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)

      const found = result.tables.find(t => t.TableName === testTableName)

      expect(found).toBeDefined()
    })

    it('queries tables with filter', async () => {
      const result = await service.queryTables(`TableName eq '${ testTableName }'`)

      expect(result).toHaveProperty('tables')
      expect(result.tables).toHaveLength(1)
      expect(result.tables[0].TableName).toBe(testTableName)
    })

    it('queries tables with top limit', async () => {
      const result = await service.queryTables(undefined, 1)

      expect(result.tables.length).toBeLessThanOrEqual(1)
    })

    // ── Entities (within the test table) ──

    describe('entity operations', () => {
      const partitionKey = 'e2e-test'
      const rowKey = `row-${ Date.now() }`

      it('inserts an entity', async () => {
        const result = await service.insertEntity(testTableName, partitionKey, rowKey, {
          Name: 'Ada',
          Age: 30,
        })

        expect(result).toHaveProperty('PartitionKey', partitionKey)
        expect(result).toHaveProperty('RowKey', rowKey)
      })

      it('gets the inserted entity', async () => {
        const result = await service.getEntity(testTableName, partitionKey, rowKey)

        expect(result).toHaveProperty('PartitionKey', partitionKey)
        expect(result).toHaveProperty('RowKey', rowKey)
        expect(result).toHaveProperty('Name', 'Ada')
        expect(result).toHaveProperty('Age', 30)
      })

      it('gets entity with $select', async () => {
        const result = await service.getEntity(testTableName, partitionKey, rowKey, 'Name')

        expect(result).toHaveProperty('Name', 'Ada')
        expect(result).not.toHaveProperty('Age')
      })

      it('queries entities with filter', async () => {
        const result = await service.queryEntities(
          testTableName,
          `PartitionKey eq '${ partitionKey }' and RowKey eq '${ rowKey }'`,
        )

        expect(result).toHaveProperty('value')
        expect(result.value).toHaveLength(1)
        expect(result.value[0]).toHaveProperty('Name', 'Ada')
      })

      it('queries entities with $select and $top', async () => {
        const result = await service.queryEntities(testTableName, undefined, 'Name', 10)

        expect(result).toHaveProperty('value')
        expect(Array.isArray(result.value)).toBe(true)
        result.value.forEach(entity => {
          expect(entity).toHaveProperty('Name')
        })
      })

      it('merges entity (partial update)', async () => {
        const result = await service.mergeEntity(testTableName, partitionKey, rowKey, {
          Age: 31,
          City: 'London',
        })

        expect(result).toEqual({ success: true, PartitionKey: partitionKey, RowKey: rowKey })

        const entity = await service.getEntity(testTableName, partitionKey, rowKey)

        expect(entity.Age).toBe(31)
        expect(entity.City).toBe('London')
        expect(entity.Name).toBe('Ada') // retained from original
      })

      it('updates entity (full replace)', async () => {
        const result = await service.updateEntity(testTableName, partitionKey, rowKey, {
          Name: 'Ada Lovelace',
        })

        expect(result).toEqual({ success: true, PartitionKey: partitionKey, RowKey: rowKey })

        const entity = await service.getEntity(testTableName, partitionKey, rowKey)

        expect(entity.Name).toBe('Ada Lovelace')
        expect(entity).not.toHaveProperty('Age')   // removed by full replace
        expect(entity).not.toHaveProperty('City')   // removed by full replace
      })

      it('insert-or-replace entity (upsert replace)', async () => {
        const upsertRowKey = `upsert-replace-${ Date.now() }`
        const result = await service.insertOrReplaceEntity(testTableName, partitionKey, upsertRowKey, {
          Name: 'Upserted',
        })

        expect(result).toEqual({ success: true, PartitionKey: partitionKey, RowKey: upsertRowKey })

        const entity = await service.getEntity(testTableName, partitionKey, upsertRowKey)

        expect(entity.Name).toBe('Upserted')

        // Cleanup
        await service.deleteEntity(testTableName, partitionKey, upsertRowKey)
      })

      it('insert-or-merge entity (upsert merge)', async () => {
        const upsertRowKey = `upsert-merge-${ Date.now() }`
        const result = await service.insertOrMergeEntity(testTableName, partitionKey, upsertRowKey, {
          Name: 'MergeUpserted',
        })

        expect(result).toEqual({ success: true, PartitionKey: partitionKey, RowKey: upsertRowKey })

        const entity = await service.getEntity(testTableName, partitionKey, upsertRowKey)

        expect(entity.Name).toBe('MergeUpserted')

        // Cleanup
        await service.deleteEntity(testTableName, partitionKey, upsertRowKey)
      })

      it('deletes the entity', async () => {
        const result = await service.deleteEntity(testTableName, partitionKey, rowKey)

        expect(result).toEqual({ success: true, PartitionKey: partitionKey, RowKey: rowKey })
      })

      it('returns empty results after entity is deleted', async () => {
        const result = await service.queryEntities(
          testTableName,
          `PartitionKey eq '${ partitionKey }' and RowKey eq '${ rowKey }'`,
        )

        expect(result.value).toHaveLength(0)
      })
    })

    // ── Dictionary ──

    describe('getTablesDictionary', () => {
      it('returns dictionary items with expected shape', async () => {
        const result = await service.getTablesDictionary({})

        expect(result).toHaveProperty('items')
        expect(Array.isArray(result.items)).toBe(true)

        if (result.items.length > 0) {
          expect(result.items[0]).toHaveProperty('label')
          expect(result.items[0]).toHaveProperty('value')
          expect(result.items[0]).toHaveProperty('note', 'Table')
        }
      })

      it('filters by search string', async () => {
        const result = await service.getTablesDictionary({ search: testTableName })

        expect(result.items.length).toBeGreaterThanOrEqual(1)
        expect(result.items[0].value).toBe(testTableName)
      })
    })

    // ── Cleanup: delete test table ──

    it('deletes the test table', async () => {
      const result = await service.deleteTable(testTableName)

      expect(result).toEqual({ success: true, tableName: testTableName })
    })
  })
})
