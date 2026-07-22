'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('DynamoDB Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('dynamodb-service')
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

  // ── describeTable ──

  describe('describeTable', () => {
    it('returns table metadata with expected shape', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping describeTable: testValues.tableName not set')
        return
      }

      const result = await service.describeTable(tableName)

      expect(result).toHaveProperty('tableName', tableName)
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('itemCount')
      expect(result).toHaveProperty('sizeBytes')
      expect(result).toHaveProperty('keySchema')
      expect(result).toHaveProperty('attributeDefinitions')
      expect(result).toHaveProperty('indexes')
      expect(Array.isArray(result.keySchema)).toBe(true)
    })
  })

  // ── listTablesDictionary ──

  describe('listTablesDictionary', () => {
    it('returns tables as dictionary items', async () => {
      const result = await service.listTablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('handles search filtering', async () => {
      const result = await service.listTablesDictionary({ search: 'zzz_nonexistent_table_zzz' })

      expect(result.items).toEqual([])
    })
  })

  // ── putItem + getItem + deleteItem lifecycle ──

  describe('putItem + getItem + deleteItem lifecycle', () => {
    const testItemId = `e2e-test-${Date.now()}`
    let tableName

    beforeAll(() => {
      tableName = testValues.tableName
    })

    it('puts an item into the table', async () => {
      if (!tableName) {
        console.log('Skipping putItem: testValues.tableName not set')
        return
      }

      const result = await service.putItem(tableName, { id: testItemId, name: 'E2E Test', age: 25 })

      expect(result).toHaveProperty('item')
      expect(result.item.id).toBe(testItemId)
      expect(result.item.name).toBe('E2E Test')
    })

    it('gets the item back', async () => {
      if (!tableName) {
        console.log('Skipping getItem: testValues.tableName not set')
        return
      }

      const result = await service.getItem(tableName, { id: testItemId })

      expect(result).toHaveProperty('item')
      expect(result.item).not.toBeNull()
      expect(result.item.id).toBe(testItemId)
      expect(result.item.name).toBe('E2E Test')
      expect(result.item.age).toBe(25)
    })

    it('updates the item', async () => {
      if (!tableName) {
        console.log('Skipping updateItem: testValues.tableName not set')
        return
      }

      const result = await service.updateItem(tableName, { id: testItemId }, { age: 26, status: 'updated' })

      expect(result).toHaveProperty('attributes')
      expect(result.attributes).not.toBeNull()
      expect(result.attributes.age).toBe(26)
      expect(result.attributes.status).toBe('updated')
    })

    it('deletes the item', async () => {
      if (!tableName) {
        console.log('Skipping deleteItem: testValues.tableName not set')
        return
      }

      const result = await service.deleteItem(tableName, { id: testItemId }, null, 'ALL_OLD')

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).not.toBeNull()
      expect(result.deleted.id).toBe(testItemId)
    })

    it('confirms item is gone', async () => {
      if (!tableName) {
        console.log('Skipping getItem (confirm deleted): testValues.tableName not set')
        return
      }

      const result = await service.getItem(tableName, { id: testItemId })

      expect(result.item).toBeNull()
    })
  })

  // ── scan ──

  describe('scan', () => {
    it('scans the table and returns items', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping scan: testValues.tableName not set')
        return
      }

      const result = await service.scan(tableName, null, null, null, null, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── query ──

  describe('query', () => {
    it('queries the table by partition key', async () => {
      const { tableName, queryPartitionKey, queryPartitionValue } = testValues

      if (!tableName || !queryPartitionKey || !queryPartitionValue) {
        console.log('Skipping query: testValues.tableName, queryPartitionKey, or queryPartitionValue not set')
        return
      }

      const result = await service.query(
        tableName,
        `${queryPartitionKey} = :pk`,
        { ':pk': queryPartitionValue },
      )

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── executeStatement ──

  describe('executeStatement', () => {
    it('runs a PartiQL SELECT statement', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping executeStatement: testValues.tableName not set')
        return
      }

      const result = await service.executeStatement(
        `SELECT * FROM "${tableName}" WHERE id = ?`,
        ['e2e-nonexistent-id'],
      )

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── batchWriteItem + batchGetItem ──

  describe('batchWriteItem + batchGetItem', () => {
    const testIds = [`e2e-batch-1-${Date.now()}`, `e2e-batch-2-${Date.now()}`]

    it('batch writes items', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping batchWriteItem: testValues.tableName not set')
        return
      }

      const result = await service.batchWriteItem(
        tableName,
        testIds.map(id => ({ id, type: 'batch-test' })),
      )

      expect(result).toHaveProperty('processed')
      expect(result.processed).toBe(2)
      expect(result).toHaveProperty('unprocessed')
    })

    it('batch gets the items', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping batchGetItem: testValues.tableName not set')
        return
      }

      const result = await service.batchGetItem(
        tableName,
        testIds.map(id => ({ id })),
      )

      expect(result).toHaveProperty('items')
      expect(result.items).toHaveLength(2)
    })

    it('batch deletes the items (cleanup)', async () => {
      const { tableName } = testValues

      if (!tableName) {
        console.log('Skipping batch cleanup: testValues.tableName not set')
        return
      }

      const result = await service.batchWriteItem(
        tableName,
        null,
        testIds.map(id => ({ id })),
      )

      expect(result).toHaveProperty('processed')
      expect(result.processed).toBe(2)
    })
  })
})
