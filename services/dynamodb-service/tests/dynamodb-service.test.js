'use strict'

const { createSandbox } = require('../../../service-sandbox')
const { encodeCursor } = require('../src/marshall')

describe('DynamoDB Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: 'us-east-1',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  /**
   * Helper: stub sendJson on the service to record calls and return a response.
   * Returns { calls } where each entry is { op, body }.
   */
  function stubSendJson(response = {}) {
    const calls = []

    service.sendJson = async (op, body) => {
      calls.push({ op, body })

      return response
    }

    return { calls }
  }

  /**
   * Helper: stub sendJson with a function that returns dynamic responses.
   */
  function stubSendJsonDynamic(fn) {
    const calls = []

    service.sendJson = async (op, body) => {
      calls.push({ op, body })

      return fn(op, body, calls.length)
    }

    return { calls }
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(6)
      expect(configItems.map(i => i.name)).toEqual([
        'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
      ])
    })

    it('authenticationMethod is a CHOICE with correct options', () => {
      const configItems = sandbox.getConfigItems()
      const auth = configItems.find(i => i.name === 'authenticationMethod')

      expect(auth).toMatchObject({
        type: 'CHOICE',
        required: true,
        shared: false,
        defaultValue: 'API Key',
        options: ['API Key', 'IAM Role'],
      })
    })

    it('config displayName never contains the service name', () => {
      const configItems = sandbox.getConfigItems()

      for (const item of configItems) {
        expect(item.displayName).not.toMatch(/dynamodb/i)
      }
    })

    it('all config items have shared: false', () => {
      const configItems = sandbox.getConfigItems()

      for (const item of configItems) {
        expect(item.shared).toBe(false)
      }
    })
  })

  // ── Constructor / sendJson ──

  describe('constructor and sendJson', () => {
    it('sets region from config', () => {
      expect(service.region).toBe('us-east-1')
    })

    it('defaults region to us-east-1 when not provided', () => {
      const { DynamoDB } = require('../src/index')
      const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' })

      expect(db.region).toBe('us-east-1')
    })

    it('has a credential provider', () => {
      expect(service.credentials).toBeDefined()
    })
  })

  // ── putItem ──

  describe('putItem', () => {
    it('marshalls the item and sends PutItem', async () => {
      const { calls } = stubSendJson({})
      const out = await service.putItem('Users', { id: '1', age: 30 })

      expect(calls[0].op).toBe('PutItem')
      expect(calls[0].body.TableName).toBe('Users')
      expect(calls[0].body.Item).toEqual({ id: { S: '1' }, age: { N: '30' } })
      expect(out.item).toEqual({ id: '1', age: 30 })
      expect(out.oldItem).toBeNull()
    })

    it('passes conditionExpression and marshalled values', async () => {
      const { calls } = stubSendJson({})
      await service.putItem('Users', { id: '1' }, 'attribute_not_exists(id)', { ':x': 5 })

      expect(calls[0].body.ConditionExpression).toBe('attribute_not_exists(id)')
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':x': { N: '5' } })
    })

    it('returns unmarshalled old values when returnValues=ALL_OLD', async () => {
      stubSendJson({ Attributes: { id: { S: '1' }, age: { N: '29' } } })
      const out = await service.putItem('Users', { id: '1', age: 30 }, null, null, 'ALL_OLD')

      expect(out.oldItem).toEqual({ id: '1', age: 29 })
    })

    it('sends returnValues when provided', async () => {
      const { calls } = stubSendJson({})
      await service.putItem('Users', { id: '1' }, null, null, 'ALL_OLD')

      expect(calls[0].body.ReturnValues).toBe('ALL_OLD')
    })

    it('omits optional fields when not provided', async () => {
      const { calls } = stubSendJson({})
      await service.putItem('Users', { id: '1' })

      expect(calls[0].body.ConditionExpression).toBeUndefined()
      expect(calls[0].body.ExpressionAttributeValues).toBeUndefined()
      expect(calls[0].body.ReturnValues).toBeUndefined()
    })

    it('throws when tableName is missing', async () => {
      await expect(service.putItem(null, { id: '1' })).rejects.toThrow('tableName is required')
    })

    it('throws when item is missing', async () => {
      await expect(service.putItem('Users', null)).rejects.toThrow('item')
    })

    it('throws when item is not an object', async () => {
      await expect(service.putItem('Users', 'bad')).rejects.toThrow('item')
    })

    it('handles API error via #handleError', async () => {
      service.sendJson = async () => {
        const err = new Error('Requested resource not found')
        err.name = 'ResourceNotFoundException'
        throw err
      }

      await expect(service.putItem('Users', { id: '1' })).rejects.toThrow(/Resource not found/)
    })
  })

  // ── getItem ──

  describe('getItem', () => {
    it('marshalls the key and unmarshalls the result', async () => {
      const { calls } = stubSendJson({ Item: { id: { S: '1' }, age: { N: '30' } } })
      const out = await service.getItem('Users', { id: '1' }, true, 'id, age')

      expect(calls[0].op).toBe('GetItem')
      expect(calls[0].body.Key).toEqual({ id: { S: '1' } })
      expect(calls[0].body.ConsistentRead).toBe(true)
      expect(calls[0].body.ProjectionExpression).toBe('id, age')
      expect(out.item).toEqual({ id: '1', age: 30 })
    })

    it('returns {item: null} when no item found', async () => {
      stubSendJson({})
      const out = await service.getItem('Users', { id: 'missing' })

      expect(out).toEqual({ item: null })
    })

    it('omits optional fields when not provided', async () => {
      const { calls } = stubSendJson({ Item: { id: { S: '1' } } })
      await service.getItem('Users', { id: '1' })

      expect(calls[0].body.ConsistentRead).toBeUndefined()
      expect(calls[0].body.ProjectionExpression).toBeUndefined()
    })

    it('throws when tableName is missing', async () => {
      await expect(service.getItem(null, { id: '1' })).rejects.toThrow('tableName is required')
    })

    it('throws when key is missing', async () => {
      await expect(service.getItem('Users', null)).rejects.toThrow('key')
    })
  })

  // ── updateItem ──

  describe('updateItem', () => {
    it('builds a SET expression from the updates object', async () => {
      const { calls } = stubSendJson({ Attributes: { id: { S: '1' }, age: { N: '31' } } })
      const out = await service.updateItem('Users', { id: '1' }, { age: 31 })

      expect(calls[0].op).toBe('UpdateItem')
      expect(calls[0].body.Key).toEqual({ id: { S: '1' } })
      expect(calls[0].body.UpdateExpression).toBe('SET #n0 = :v0')
      expect(calls[0].body.ExpressionAttributeNames).toEqual({ '#n0': 'age' })
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':v0': { N: '31' } })
      expect(calls[0].body.ReturnValues).toBe('ALL_NEW')
      expect(out.attributes).toEqual({ id: '1', age: 31 })
    })

    it('uses the raw updateExpression when provided', async () => {
      const { calls } = stubSendJson({ Attributes: {} })
      await service.updateItem(
        'Users', { id: '1' }, null,
        'ADD visits :one', { ':one': 1 }, { '#v': 'visits' },
        'attribute_exists(id)',
      )

      expect(calls[0].body.UpdateExpression).toBe('ADD visits :one')
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':one': { N: '1' } })
      expect(calls[0].body.ExpressionAttributeNames).toEqual({ '#v': 'visits' })
      expect(calls[0].body.ConditionExpression).toBe('attribute_exists(id)')
    })

    it('returns null attributes when response has no Attributes key', async () => {
      stubSendJson({})
      const out = await service.updateItem('Users', { id: '1' }, { age: 5 }, null, null, null, null, 'NONE')

      expect(out).toEqual({ attributes: null })
    })

    it('defaults ReturnValues to ALL_NEW', async () => {
      const { calls } = stubSendJson({ Attributes: {} })
      await service.updateItem('Users', { id: '1' }, { x: 1 })

      expect(calls[0].body.ReturnValues).toBe('ALL_NEW')
    })

    it('uses provided returnValues', async () => {
      const { calls } = stubSendJson({ Attributes: {} })
      await service.updateItem('Users', { id: '1' }, { x: 1 }, null, null, null, null, 'UPDATED_OLD')

      expect(calls[0].body.ReturnValues).toBe('UPDATED_OLD')
    })

    it('throws when tableName is missing', async () => {
      await expect(service.updateItem(null, { id: '1' }, { x: 1 })).rejects.toThrow('tableName is required')
    })

    it('throws when key is missing', async () => {
      await expect(service.updateItem('Users', null, { x: 1 })).rejects.toThrow('key')
    })

    it('handles ConditionalCheckFailedException', async () => {
      service.sendJson = async () => {
        const err = new Error('condition failed')
        err.name = 'ConditionalCheckFailedException'
        throw err
      }

      await expect(service.updateItem('Users', { id: '1' }, { x: 1 })).rejects.toThrow(/Condition not met/)
    })
  })

  // ── deleteItem ──

  describe('deleteItem', () => {
    it('marshalls the key and sends DeleteItem', async () => {
      const { calls } = stubSendJson({})
      const out = await service.deleteItem('Users', { id: '1' })

      expect(calls[0].op).toBe('DeleteItem')
      expect(calls[0].body.Key).toEqual({ id: { S: '1' } })
      expect(out).toEqual({ deleted: null })
    })

    it('returns unmarshalled deleted item when ALL_OLD', async () => {
      stubSendJson({ Attributes: { id: { S: '1' }, name: { S: 'Ada' } } })
      const out = await service.deleteItem('Users', { id: '1' }, 'attribute_exists(id)', 'ALL_OLD')

      expect(out.deleted).toEqual({ id: '1', name: 'Ada' })
    })

    it('passes conditionExpression and returnValues', async () => {
      const { calls } = stubSendJson({})
      await service.deleteItem('Users', { id: '1' }, 'attribute_exists(id)', 'ALL_OLD')

      expect(calls[0].body.ConditionExpression).toBe('attribute_exists(id)')
      expect(calls[0].body.ReturnValues).toBe('ALL_OLD')
    })

    it('omits optional fields when not provided', async () => {
      const { calls } = stubSendJson({})
      await service.deleteItem('Users', { id: '1' })

      expect(calls[0].body.ConditionExpression).toBeUndefined()
      expect(calls[0].body.ReturnValues).toBeUndefined()
    })

    it('throws when tableName is missing', async () => {
      await expect(service.deleteItem(null, { id: '1' })).rejects.toThrow('tableName is required')
    })

    it('throws when key is missing', async () => {
      await expect(service.deleteItem('Users', null)).rejects.toThrow('key')
    })
  })

  // ── query ──

  describe('query', () => {
    it('sends KeyConditionExpression with marshalled values and unmarshalls items', async () => {
      const { calls } = stubSendJson({ Items: [{ id: { S: '1' } }, { id: { S: '2' } }], Count: 2 })
      const out = await service.query('Users', 'pk = :p', { ':p': 'tenant1' })

      expect(calls[0].op).toBe('Query')
      expect(calls[0].body.KeyConditionExpression).toBe('pk = :p')
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':p': { S: 'tenant1' } })
      expect(out.items).toEqual([{ id: '1' }, { id: '2' }])
      expect(out.count).toBe(2)
      expect(out.cursor).toBeNull()
    })

    it('decodes incoming cursor and encodes LastEvaluatedKey', async () => {
      const startKey = { id: { S: '10' } }
      const { calls } = stubSendJson({ Items: [], Count: 0, LastEvaluatedKey: { id: { S: '20' } } })
      const out = await service.query(
        'Users', 'pk = :p', { ':p': 'a' },
        null, null, null, 50, false, null,
        encodeCursor(startKey),
      )

      expect(calls[0].body.ExclusiveStartKey).toEqual(startKey)
      expect(calls[0].body.Limit).toBe(50)
      expect(calls[0].body.ScanIndexForward).toBe(false)
      expect(out.cursor).toBe(encodeCursor({ id: { S: '20' } }))
    })

    it('passes optional parameters when provided', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })
      await service.query(
        'Users', 'pk = :p', { ':p': 'a' },
        { '#n': 'name' }, '#n = :f', 'gsi1', 10, true, 'pk, sk',
      )

      expect(calls[0].body.ExpressionAttributeNames).toEqual({ '#n': 'name' })
      expect(calls[0].body.FilterExpression).toBe('#n = :f')
      expect(calls[0].body.IndexName).toBe('gsi1')
      expect(calls[0].body.Limit).toBe(10)
      expect(calls[0].body.ProjectionExpression).toBe('pk, sk')
    })

    it('does not set ScanIndexForward when true (default behavior)', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })
      await service.query('Users', 'pk = :p', { ':p': 'a' }, null, null, null, null, true)

      // ScanIndexForward is only explicitly set when false
      expect(calls[0].body.ScanIndexForward).toBeUndefined()
    })

    it('returns empty items when Items is missing', async () => {
      stubSendJson({})
      const out = await service.query('Users', 'pk = :p', { ':p': 'a' })

      expect(out.items).toEqual([])
      expect(out.count).toBe(0)
    })

    it('throws when tableName is missing', async () => {
      await expect(service.query(null, 'pk = :p', {})).rejects.toThrow('tableName is required')
    })

    it('throws when keyConditionExpression is missing', async () => {
      await expect(service.query('Users', null, {})).rejects.toThrow('keyConditionExpression is required')
    })

    it('handles ValidationException', async () => {
      service.sendJson = async () => {
        const err = new Error('Invalid key expression')
        err.name = 'ValidationException'
        throw err
      }

      await expect(service.query('Users', 'bad', {})).rejects.toThrow(/Invalid request/)
    })
  })

  // ── scan ──

  describe('scan', () => {
    it('sends optional filter and unmarshalls items', async () => {
      const { calls } = stubSendJson({ Items: [{ id: { S: '1' } }], Count: 1 })
      const out = await service.scan('Users', '#a = :v', { ':v': true }, { '#a': 'active' })

      expect(calls[0].op).toBe('Scan')
      expect(calls[0].body.FilterExpression).toBe('#a = :v')
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':v': { BOOL: true } })
      expect(calls[0].body.ExpressionAttributeNames).toEqual({ '#a': 'active' })
      expect(out.items).toEqual([{ id: '1' }])
      expect(out.count).toBe(1)
    })

    it('sends only TableName when no filter provided', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })
      await service.scan('Users')

      expect(Object.keys(calls[0].body)).toEqual(['TableName'])
    })

    it('passes optional indexName, limit, projectionExpression, and cursor', async () => {
      const startKey = { id: { S: '5' } }
      const { calls } = stubSendJson({ Items: [], Count: 0 })
      await service.scan('Users', null, null, null, 'gsi1', 20, 'id, name', encodeCursor(startKey))

      expect(calls[0].body.IndexName).toBe('gsi1')
      expect(calls[0].body.Limit).toBe(20)
      expect(calls[0].body.ProjectionExpression).toBe('id, name')
      expect(calls[0].body.ExclusiveStartKey).toEqual(startKey)
    })

    it('throws when tableName is missing', async () => {
      await expect(service.scan(null)).rejects.toThrow('tableName is required')
    })
  })

  // ── batchGetItem ──

  describe('batchGetItem', () => {
    it('marshalls keys and returns unmarshalled items', async () => {
      const { calls } = stubSendJson({ Responses: { Users: [{ id: { S: '1' } }, { id: { S: '2' } }] } })
      const out = await service.batchGetItem('Users', [{ id: '1' }, { id: '2' }])

      expect(calls[0].op).toBe('BatchGetItem')
      expect(calls[0].body.RequestItems.Users.Keys).toEqual([{ id: { S: '1' } }, { id: { S: '2' } }])
      expect(out.items).toEqual([{ id: '1' }, { id: '2' }])
    })

    it('retries UnprocessedKeys until drained', async () => {
      service._sleep = async () => {}
      let callCount = 0
      service.sendJson = async () => {
        callCount++
        if (callCount === 1) {
          return {
            Responses: { Users: [{ id: { S: '1' } }] },
            UnprocessedKeys: { Users: { Keys: [{ id: { S: '2' } }] } },
          }
        }

        return { Responses: { Users: [{ id: { S: '2' } }] } }
      }

      const out = await service.batchGetItem('Users', [{ id: '1' }, { id: '2' }])

      expect(callCount).toBe(2)
      expect(out.items).toEqual([{ id: '1' }, { id: '2' }])
    })

    it('passes consistentRead and projectionExpression', async () => {
      const { calls } = stubSendJson({ Responses: { Users: [] } })
      await service.batchGetItem('Users', [{ id: '1' }], true, 'id, name')

      expect(calls[0].body.RequestItems.Users.ConsistentRead).toBe(true)
      expect(calls[0].body.RequestItems.Users.ProjectionExpression).toBe('id, name')
    })

    it('throws when tableName is missing', async () => {
      await expect(service.batchGetItem(null, [{ id: '1' }])).rejects.toThrow('tableName is required')
    })

    it('throws when keys is empty', async () => {
      await expect(service.batchGetItem('Users', [])).rejects.toThrow('keys must be a non-empty array')
    })

    it('throws when keys is not an array', async () => {
      await expect(service.batchGetItem('Users', 'bad')).rejects.toThrow('keys must be a non-empty array')
    })
  })

  // ── batchWriteItem ──

  describe('batchWriteItem', () => {
    it('builds Put and Delete requests', async () => {
      const { calls } = stubSendJson({})
      const out = await service.batchWriteItem('Users', [{ id: '1', n: 'a' }], [{ id: '2' }])

      expect(calls[0].op).toBe('BatchWriteItem')
      const reqs = calls[0].body.RequestItems.Users

      expect(reqs[0]).toEqual({ PutRequest: { Item: { id: { S: '1' }, n: { S: 'a' } } } })
      expect(reqs[1]).toEqual({ DeleteRequest: { Key: { id: { S: '2' } } } })
      expect(out.processed).toBe(2)
      expect(out.unprocessed).toEqual([])
    })

    it('retries UnprocessedItems and reports leftovers after max retries', async () => {
      service._sleep = async () => {}
      service.sendJson = async () => ({
        UnprocessedItems: { Users: [{ PutRequest: { Item: { id: { S: '1' } } } }] },
      })

      const out = await service.batchWriteItem('Users', [{ id: '1' }])

      expect(out.processed).toBe(0)
      expect(out.unprocessed).toHaveLength(1)
      expect(out.unprocessed[0]).toEqual({ put: { id: '1' } })
    })

    it('throws when tableName is missing', async () => {
      await expect(service.batchWriteItem(null, [{ id: '1' }])).rejects.toThrow('tableName is required')
    })

    it('throws when both putItems and deleteKeys are empty', async () => {
      await expect(service.batchWriteItem('Users', [], [])).rejects.toThrow('at least one item')
    })

    it('throws when putItems and deleteKeys are not provided', async () => {
      await expect(service.batchWriteItem('Users')).rejects.toThrow('at least one item')
    })
  })

  // ── executeStatement ──

  describe('executeStatement', () => {
    it('marshalls parameters and unmarshalls items', async () => {
      const { calls } = stubSendJson({ Items: [{ id: { S: '1' } }], NextToken: 'TOK' })
      const out = await service.executeStatement('SELECT * FROM Users WHERE id = ?', ['1'])

      expect(calls[0].op).toBe('ExecuteStatement')
      expect(calls[0].body.Statement).toBe('SELECT * FROM Users WHERE id = ?')
      expect(calls[0].body.Parameters).toEqual([{ S: '1' }])
      expect(out.items).toEqual([{ id: '1' }])
      expect(out.cursor).toBe('TOK')
    })

    it('passes NextToken from incoming cursor', async () => {
      const { calls } = stubSendJson({ Items: [] })
      const out = await service.executeStatement('SELECT * FROM Users', null, false, 'PREV')

      expect(calls[0].body.NextToken).toBe('PREV')
      expect(out.cursor).toBeNull()
    })

    it('omits Parameters when not provided', async () => {
      const { calls } = stubSendJson({ Items: [] })
      await service.executeStatement('SELECT * FROM Users')

      expect(calls[0].body.Parameters).toBeUndefined()
    })

    it('passes ConsistentRead when true', async () => {
      const { calls } = stubSendJson({ Items: [] })
      await service.executeStatement('SELECT * FROM Users', null, true)

      expect(calls[0].body.ConsistentRead).toBe(true)
    })

    it('throws when statement is missing', async () => {
      await expect(service.executeStatement(null)).rejects.toThrow('statement is required')
    })
  })

  // ── describeTable ──

  describe('describeTable', () => {
    it('returns normalized metadata', async () => {
      const { calls } = stubSendJson({
        Table: {
          TableName: 'Users',
          TableStatus: 'ACTIVE',
          ItemCount: 42,
          TableSizeBytes: 1024,
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
          GlobalSecondaryIndexes: [{ IndexName: 'gsi1' }],
        },
      })

      const out = await service.describeTable('Users')

      expect(calls[0].op).toBe('DescribeTable')
      expect(calls[0].body).toEqual({ TableName: 'Users' })
      expect(out.tableName).toBe('Users')
      expect(out.status).toBe('ACTIVE')
      expect(out.itemCount).toBe(42)
      expect(out.sizeBytes).toBe(1024)
      expect(out.keySchema).toEqual([{ AttributeName: 'id', KeyType: 'HASH' }])
      expect(out.attributeDefinitions).toEqual([{ AttributeName: 'id', AttributeType: 'S' }])
      expect(out.indexes.global).toEqual([{ IndexName: 'gsi1' }])
      expect(out.indexes.local).toEqual([])
    })

    it('handles missing Table gracefully', async () => {
      stubSendJson({})
      const out = await service.describeTable('Users')

      expect(out.tableName).toBeUndefined()
      expect(out.keySchema).toEqual([])
      expect(out.indexes).toEqual({ global: [], local: [] })
    })

    it('throws when tableName is missing', async () => {
      await expect(service.describeTable(null)).rejects.toThrow('tableName is required')
    })
  })

  // ── listTablesDictionary ──

  describe('listTablesDictionary', () => {
    it('maps table names to label/value items', async () => {
      stubSendJson({ TableNames: ['Users', 'Orders'] })
      const out = await service.listTablesDictionary({})

      expect(out.items).toEqual([
        { label: 'Users', value: 'Users' },
        { label: 'Orders', value: 'Orders' },
      ])
      expect(out.cursor).toBeNull()
    })

    it('filters by search (case-insensitive)', async () => {
      stubSendJson({ TableNames: ['Users', 'Orders', 'UserEvents'] })
      const out = await service.listTablesDictionary({ search: 'user' })

      expect(out.items.map(i => i.value)).toEqual(['Users', 'UserEvents'])
    })

    it('paginates with ExclusiveStartTableName and returns next cursor', async () => {
      const { calls } = stubSendJson({ TableNames: ['Users'], LastEvaluatedTableName: 'Users' })
      const out = await service.listTablesDictionary({ cursor: encodeCursor('Orders') })

      expect(calls[0].body.ExclusiveStartTableName).toBe('Orders')
      expect(out.cursor).toBe(encodeCursor('Users'))
    })

    it('handles null payload', async () => {
      stubSendJson({ TableNames: ['Users'] })
      const out = await service.listTablesDictionary(null)

      expect(out.items).toHaveLength(1)
      expect(out.cursor).toBeNull()
    })

    it('handles empty TableNames', async () => {
      stubSendJson({ TableNames: [] })
      const out = await service.listTablesDictionary({})

      expect(out.items).toEqual([])
    })

    it('sends Limit of 100', async () => {
      const { calls } = stubSendJson({ TableNames: [] })
      await service.listTablesDictionary({})

      expect(calls[0].body.Limit).toBe(100)
    })
  })

  // ── Error handling ──

  describe('error handling (#handleError)', () => {
    it('maps ResourceNotFoundException', async () => {
      service.sendJson = async () => {
        const err = new Error('Table not found')
        err.name = 'ResourceNotFoundException'
        throw err
      }

      await expect(service.getItem('Users', { id: '1' })).rejects.toThrow(/Resource not found.*Check the table name/)
    })

    it('maps ConditionalCheckFailedException', async () => {
      service.sendJson = async () => {
        const err = new Error('condition')
        err.name = 'ConditionalCheckFailedException'
        throw err
      }

      await expect(service.deleteItem('Users', { id: '1' })).rejects.toThrow(/Condition not met/)
    })

    it('maps ValidationException', async () => {
      service.sendJson = async () => {
        const err = new Error('bad key')
        err.name = 'ValidationException'
        throw err
      }

      await expect(service.scan('Users')).rejects.toThrow(/Invalid request.*bad key/)
    })

    it('maps TransactionConflictException', async () => {
      service.sendJson = async () => {
        const err = new Error('conflict')
        err.name = 'TransactionConflictException'
        throw err
      }

      await expect(service.putItem('Users', { id: '1' })).rejects.toThrow(/Transaction conflict/)
    })

    it('maps ThrottlingException via mapAwsError', async () => {
      service.sendJson = async () => {
        const err = new Error('rate')
        err.name = 'ThrottlingException'
        throw err
      }

      await expect(service.scan('Users')).rejects.toThrow(/throttl/i)
    })

    it('maps InvalidSignatureException via mapAwsError', async () => {
      service.sendJson = async () => {
        const err = new Error('bad')
        err.name = 'InvalidSignatureException'
        throw err
      }

      await expect(service.scan('Users')).rejects.toThrow(/credential/i)
    })

    it('passes through unknown errors via mapAwsError', async () => {
      service.sendJson = async () => {
        const err = new Error('weird')
        err.name = 'SomethingElse'
        throw err
      }

      await expect(service.scan('Users')).rejects.toThrow(/weird/)
    })
  })

  // ── Marshall / unmarshall utilities ──

  describe('marshall utilities', () => {
    const {
      marshall, unmarshall, marshallItem, unmarshallItem,
      isAttributeValue, marshallValues, buildUpdateExpression,
      encodeCursor: encode, decodeCursor: decode, chunk,
    } = require('../src/marshall')

    describe('marshall / unmarshall', () => {
      it('handles primitive types', () => {
        expect(marshall('hi')).toEqual({ S: 'hi' })
        expect(marshall(42)).toEqual({ N: '42' })
        expect(marshall(true)).toEqual({ BOOL: true })
        expect(marshall(null)).toEqual({ NULL: true })
      })

      it('handles lists and maps recursively', () => {
        expect(marshall([1, 'a'])).toEqual({ L: [{ N: '1' }, { S: 'a' }] })
        expect(marshall({ a: 1, b: 'x' })).toEqual({ M: { a: { N: '1' }, b: { S: 'x' } } })
      })

      it('handles Buffer to B (base64)', () => {
        expect(marshall(Buffer.from('hi'))).toEqual({ B: Buffer.from('hi').toString('base64') })
      })

      it('round-trips all types', () => {
        const values = ['hi', 42, true, null, [1, 'a', false], { nested: { deep: [1, 2] } }]

        for (const v of values) {
          expect(unmarshall(marshall(v))).toEqual(v)
        }
      })

      it('round-trips empty string', () => {
        expect(unmarshall(marshall(''))).toBe('')
      })
    })

    describe('marshallItem / unmarshallItem', () => {
      it('operates on top-level maps', () => {
        const item = { id: '1', age: 30, tags: ['a', 'b'] }
        const marshalled = marshallItem(item)

        expect(marshalled).toEqual({
          id: { S: '1' },
          age: { N: '30' },
          tags: { L: [{ S: 'a' }, { S: 'b' }] },
        })
        expect(unmarshallItem(marshalled)).toEqual(item)
      })
    })

    describe('isAttributeValue', () => {
      it('detects typed values', () => {
        expect(isAttributeValue({ S: 'x' })).toBe(true)
        expect(isAttributeValue({ N: '1' })).toBe(true)
        expect(isAttributeValue({ foo: 'bar' })).toBe(false)
        expect(isAttributeValue('plain')).toBe(false)
      })
    })

    describe('marshallValues', () => {
      it('marshals plain values but passes typed ones through', () => {
        expect(marshallValues({ ':a': 'x', ':b': 2 })).toEqual({ ':a': { S: 'x' }, ':b': { N: '2' } })
        expect(marshallValues({ ':a': { S: 'raw' } })).toEqual({ ':a': { S: 'raw' } })
      })
    })

    describe('buildUpdateExpression', () => {
      it('builds a SET clause with aliased names and marshalled values', () => {
        const out = buildUpdateExpression({ age: 31, status: 'active' })

        expect(out.UpdateExpression).toBe('SET #n0 = :v0, #n1 = :v1')
        expect(out.ExpressionAttributeNames).toEqual({ '#n0': 'age', '#n1': 'status' })
        expect(out.ExpressionAttributeValues).toEqual({ ':v0': { N: '31' }, ':v1': { S: 'active' } })
      })

      it('throws on empty updates', () => {
        expect(() => buildUpdateExpression({})).toThrow(/at least one/i)
      })
    })

    describe('encodeCursor / decodeCursor', () => {
      it('round-trips an object and a string', () => {
        const key = { id: { S: '1' }, sk: { N: '5' } }

        expect(decode(encode(key))).toEqual(key)
        expect(decode(encode('TableName'))).toBe('TableName')
      })
    })

    describe('chunk', () => {
      it('splits arrays into fixed-size groups', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
        expect(chunk([], 2)).toEqual([])
      })
    })
  })

  // ── AWS client utilities ──

  describe('AWS client utilities', () => {
    const { buildAwsJsonRequest, parseJsonResponse } = require('../src/aws-client')

    describe('buildAwsJsonRequest', () => {
      it('builds endpoint, headers, and serialized body', () => {
        const req = buildAwsJsonRequest({
          region: 'us-east-1',
          service: 'dynamodb',
          target: 'DynamoDB_20120810.GetItem',
          body: { TableName: 'T' },
          contentType: 'application/x-amz-json-1.0',
        })

        expect(req.method).toBe('POST')
        expect(req.url).toBe('https://dynamodb.us-east-1.amazonaws.com/')
        expect(req.headers['content-type']).toBe('application/x-amz-json-1.0')
        expect(req.headers['x-amz-target']).toBe('DynamoDB_20120810.GetItem')
        expect(req.body).toBe('{"TableName":"T"}')
      })
    })

    describe('parseJsonResponse', () => {
      it('returns parsed object on 2xx', () => {
        const out = parseJsonResponse({ statusCode: 200, body: '{"Item":{"id":{"S":"1"}}}' })

        expect(out).toEqual({ Item: { id: { S: '1' } } })
      })

      it('returns {} for empty 2xx body', () => {
        expect(parseJsonResponse({ statusCode: 200, body: '' })).toEqual({})
      })

      it('throws with name derived from __type', () => {
        expect(() => parseJsonResponse({
          statusCode: 400,
          body: '{"__type":"com.amazon.coral.validate#ValidationException","message":"bad key"}',
        })).toThrow(
          expect.objectContaining({
            name: 'ValidationException',
            message: 'bad key',
          }),
        )
      })
    })

    describe('parseXmlTag / parseXmlTags', () => {
      const { parseXmlTag, parseXmlTags } = require('../src/aws-client')

      it('returns the first tag content or null', () => {
        expect(parseXmlTag('<Code>NoSuchKey</Code>', 'Code')).toBe('NoSuchKey')
        expect(parseXmlTag('<other>x</other>', 'Code')).toBeNull()
      })

      it('returns all matches', () => {
        expect(parseXmlTags('<N>a</N><N>b</N>', 'N')).toEqual(['a', 'b'])
      })
    })

    describe('jsonRequest', () => {
      it('signs, sends via injected httpRequest, and parses', async () => {
        const { jsonRequest } = require('../src/aws-client')
        const calls = []
        const fakeHttp = async (method, url, headers, body) => {
          calls.push({ method, url, headers, body })

          return { statusCode: 200, headers: {}, body: '{"ok":true}' }
        }

        const out = await jsonRequest(
          { region: 'us-east-1', service: 'dynamodb', target: 'DynamoDB_20120810.PutItem', body: { TableName: 'T' }, contentType: 'application/x-amz-json-1.0' },
          { accessKeyId: 'AK', secretAccessKey: 'SK' },
          { httpRequest: fakeHttp },
        )

        expect(out).toEqual({ ok: true })
        expect(calls).toHaveLength(1)
        expect(calls[0].headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 /)
        expect(calls[0].headers['x-amz-target']).toBe('DynamoDB_20120810.PutItem')
      })
    })
  })

  // ── SigV4 signing ──

  describe('SigV4 signing', () => {
    const crypto = require('crypto')
    const { signRequest } = require('../src/sigv4')
    const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

    it('sets x-amz-date and x-amz-content-sha256 from body', () => {
      const headers = {}
      const body = '{"hello":"world"}'

      signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, body, CREDS, 'us-east-1', 'dynamodb')

      expect(headers['x-amz-content-sha256']).toBe(
        crypto.createHash('sha256').update(body).digest('hex'),
      )
      expect(headers['host']).toBe('dynamodb.us-east-1.amazonaws.com')
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    })

    it('authorization header has the SigV4 structure', () => {
      const headers = {}

      signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, '', CREDS, 'us-east-1', 'dynamodb')

      expect(headers['authorization']).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/dynamodb\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
      )
    })

    it('is deterministic for a fixed time', () => {
      const RealDate = Date
      const frozenDate = new RealDate('2024-01-01T00:00:00.000Z')

      global.Date = class extends RealDate {
        constructor(...args) {
          if (args.length) return new RealDate(...args)

          return frozenDate
        }

        static now() {
          return frozenDate.getTime()
        }
      }

      try {
        const h1 = {}
        const h2 = {}

        signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', h1, 'x', CREDS, 'us-east-1', 'dynamodb')
        signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', h2, 'x', CREDS, 'us-east-1', 'dynamodb')

        expect(h1['authorization']).toBe(h2['authorization'])
      } finally {
        global.Date = RealDate
      }
    })

    it('includes session token in signed headers when present', () => {
      const headers = {}

      signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, '', { ...CREDS, sessionToken: 'TOKEN' }, 'us-east-1', 'dynamodb')

      expect(headers['x-amz-security-token']).toBe('TOKEN')
      expect(headers['authorization']).toMatch(/SignedHeaders=[^,]*x-amz-security-token/)
    })
  })

  // ── Credential provider ──

  describe('CredentialProvider', () => {
    const { CredentialProvider } = require('../src/credentials')

    it('API Key method returns static credentials', async () => {
      const cp = new CredentialProvider({ authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1' })

      expect(await cp.resolve()).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
    })

    it('API Key method throws when credentials missing', async () => {
      const cp = new CredentialProvider({ authenticationMethod: 'API Key', region: 'us-east-1' })

      await expect(cp.resolve()).rejects.toThrow(/Access Key and Secret Key are required/)
    })

    it('IAM Role method assumes role and returns session credentials', async () => {
      let now = 1_000_000
      const calls = []
      const fakeSts = async (creds, region, roleArn, sessionName, externalId) => {
        calls.push({ roleArn, externalId })

        return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 3_600_000) }
      }

      const cp = new CredentialProvider(
        { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R', externalId: 'EID' },
        { stsAssumeRole: fakeSts, now: () => now },
      )

      const out = await cp.resolve()

      expect(out).toEqual({ accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK' })
      expect(calls[0].roleArn).toBe('arn:aws:iam::1:role/R')
      expect(calls[0].externalId).toBe('EID')
    })

    it('IAM Role credentials are cached until near expiry', async () => {
      let now = 1_000_000
      let stsCount = 0
      const fakeSts = async () => {
        stsCount++

        return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 3_600_000) }
      }

      const cp = new CredentialProvider(
        { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R' },
        { stsAssumeRole: fakeSts, now: () => now },
      )

      await cp.resolve()
      await cp.resolve()

      expect(stsCount).toBe(1) // second call served from cache

      now += 3_600_000 // advance past expiry buffer
      await cp.resolve()

      expect(stsCount).toBe(2) // re-assumed after expiry
    })

    it('IAM Role credentials are re-assumed inside the 5-minute expiry buffer', async () => {
      let now = 0
      let stsCount = 0
      const fakeSts = async () => {
        stsCount++

        return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 1_000_000) }
      }

      const cp = new CredentialProvider(
        { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R' },
        { stsAssumeRole: fakeSts, now: () => now },
      )

      await cp.resolve()
      expect(stsCount).toBe(1)

      now = 699_999
      await cp.resolve()
      expect(stsCount).toBe(1) // still cached

      now = 700_001
      await cp.resolve()
      expect(stsCount).toBe(2) // re-assumed inside buffer zone
    })
  })

  // ── Errors utilities ──

  describe('errors utilities', () => {
    const { mapAwsError } = require('../src/errors')

    it('maps throttling errors', () => {
      const err = mapAwsError(Object.assign(new Error('rate'), { name: 'ThrottlingException' }))

      expect(err.message).toMatch(/throttl/i)
    })

    it('maps credential errors', () => {
      const err = mapAwsError(Object.assign(new Error('bad'), { name: 'InvalidSignatureException' }))

      expect(err.message).toMatch(/credential/i)
    })

    it('maps access denied errors', () => {
      const err = mapAwsError(Object.assign(new Error('nope'), { name: 'AccessDeniedException' }))

      expect(err.message).toMatch(/Access denied/i)
    })

    it('maps connection errors', () => {
      const err = mapAwsError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))

      expect(err.message).toMatch(/Connection to AWS failed/i)
    })

    it('passes through unknown errors with cause', () => {
      const original = Object.assign(new Error('weird'), { name: 'SomethingElse' })
      const mapped = mapAwsError(original)

      expect(mapped.message).toMatch(/weird/)
      expect(mapped.cause).toBe(original)
    })
  })
})
