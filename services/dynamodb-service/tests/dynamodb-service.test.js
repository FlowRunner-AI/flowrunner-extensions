'use strict'

const { EventEmitter } = require('events')
const nodeCrypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

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
        'attribute_exists(id)'
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
        encodeCursor(startKey)
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
        { '#n': 'name' }, '#n = :f', 'gsi1', 10, true, 'pk, sk'
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
          })
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
          { httpRequest: fakeHttp }
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
        crypto.createHash('sha256').update(body).digest('hex')
      )

      expect(headers['host']).toBe('dynamodb.us-east-1.amazonaws.com')
      expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    })

    it('authorization header has the SigV4 structure', () => {
      const headers = {}

      signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, '', CREDS, 'us-east-1', 'dynamodb')

      expect(headers['authorization']).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/dynamodb\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
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
      const now = 1_000_000
      const calls = []

      const fakeSts = async (creds, region, roleArn, sessionName, externalId) => {
        calls.push({ roleArn, externalId })

        return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 3_600_000) }
      }

      const cp = new CredentialProvider(
        { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R', externalId: 'EID' },
        { stsAssumeRole: fakeSts, now: () => now }
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
        { stsAssumeRole: fakeSts, now: () => now }
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
        { stsAssumeRole: fakeSts, now: () => now }
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

  // ── sendJson: the real (unstubbed) request path ──

  describe('sendJson (real path)', () => {
    // A dedicated instance so the shared `service.sendJson` stubs above are untouched.
    function freshService(config = {}) {
      const { DynamoDB } = require('../src/index')

      return new DynamoDB({
        authenticationMethod: 'API Key',
        region: 'eu-west-1',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        ...config,
      })
    }

    it('resolves credentials and forwards a fully built AWS JSON request', async () => {
      const db = freshService()
      const calls = []

      db.deps.jsonRequest = async (opts, creds) => {
        calls.push({ opts, creds })

        return { Item: { id: { S: '1' } } }
      }

      const res = await db.sendJson('GetItem', { TableName: 'Users' })

      expect(res).toEqual({ Item: { id: { S: '1' } } })
      expect(calls).toHaveLength(1)

      expect(calls[0].opts).toEqual({
        region: 'eu-west-1',
        service: 'dynamodb',
        target: 'DynamoDB_20120810.GetItem',
        contentType: 'application/x-amz-json-1.0',
        body: { TableName: 'Users' },
      })

      expect(calls[0].creds).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
    })

    it('flows through a public operation and surfaces the mapped error', async () => {
      const db = freshService()

      db.deps.jsonRequest = async () => ({ Item: { id: { S: '7' }, name: { S: 'Ada' } } })

      await expect(db.getItem('Users', { id: '7' })).resolves.toEqual({ item: { id: '7', name: 'Ada' } })

      db.deps.jsonRequest = async () => {
        throw Object.assign(new Error('boom'), { name: 'ResourceNotFoundException' })
      }

      await expect(db.getItem('Users', { id: '7' })).rejects.toThrow(/Resource not found/)
    })

    it('propagates a credential resolution failure', async () => {
      const db = freshService({ accessKeyId: undefined, secretAccessKey: undefined })

      db.deps.jsonRequest = async () => ({})

      await expect(db.sendJson('ListTables', {})).rejects.toThrow(/Access Key and Secret Key are required/)
    })

    it('passes the session token through when an IAM role is assumed', async () => {
      const db = freshService({ authenticationMethod: 'IAM Role', roleArn: 'arn:aws:iam::1:role/R' })
      const calls = []

      db.credentials._stsAssumeRole = async () => ({
        accessKeyId: 'ASIA',
        secretAccessKey: 'TMPS',
        sessionToken: 'TOK',
        expiration: new Date(Date.now() + 3_600_000),
      })

      db.deps.jsonRequest = async (opts, creds) => {
        calls.push(creds)

        return {}
      }

      await db.sendJson('ListTables', {})

      expect(calls[0]).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'TMPS', sessionToken: 'TOK' })
    })
  })

  // ── Error mapping for the remaining operations ──

  describe('error handling for batch, PartiQL and metadata operations', () => {
    function failWith(name, message = 'failed') {
      service.sendJson = async () => {
        throw Object.assign(new Error(message), { name })
      }
    }

    it('maps errors thrown by batchGetItem', async () => {
      failWith('ValidationException', 'bad key')

      await expect(service.batchGetItem('Users', [{ id: '1' }])).rejects.toThrow(/Invalid request.*bad key/)
    })

    it('maps errors thrown by batchWriteItem', async () => {
      failWith('ProvisionedThroughputExceededException', 'slow down')

      await expect(service.batchWriteItem('Users', [{ id: '1' }])).rejects.toThrow(/throttl/i)
    })

    it('maps errors thrown by executeStatement', async () => {
      failWith('ResourceNotFoundException', 'no table')

      await expect(service.executeStatement('SELECT * FROM "Users"')).rejects.toThrow(/Resource not found/)
    })

    it('maps errors thrown by describeTable', async () => {
      failWith('AccessDeniedException', 'nope')

      await expect(service.describeTable('Users')).rejects.toThrow(/Access denied/)
    })

    it('maps errors thrown by listTablesDictionary', async () => {
      failWith('ThrottlingException', 'rate')

      await expect(service.listTablesDictionary({})).rejects.toThrow(/throttl/i)
    })

    it('maps a marshalling failure raised before the request is sent', async () => {
      service.sendJson = async () => ({})

      // A function cannot be marshalled — marshall() throws inside the try block.
      await expect(service.batchWriteItem('Users', [{ fn: () => 1 }])).rejects.toThrow(
        /Cannot marshall value of type function/
      )
    })
  })

  // ── Empty / degenerate AWS responses and retry exhaustion ──

  describe('degenerate responses and retry exhaustion', () => {
    beforeEach(() => {
      // Keep the exponential backoff instant.
      service._sleep = async () => {}
    })

    it('constructs with no arguments at all', () => {
      const { DynamoDB } = require('../src/index')

      expect(new DynamoDB().region).toBe('us-east-1')
    })

    it('returns empty results when query and scan omit Items and LastEvaluatedKey', async () => {
      stubSendJson({})

      await expect(service.query('Users', 'id = :i', { ':i': '1' })).resolves.toMatchObject({
        items: [],
        cursor: null,
      })

      await expect(service.scan('Users')).resolves.toMatchObject({ items: [], cursor: null })
    })

    it('returns empty results when executeStatement omits Items and NextToken', async () => {
      stubSendJson({})

      await expect(service.executeStatement('SELECT * FROM "Users"')).resolves.toEqual({ items: [], cursor: null })
    })

    it('returns an empty dictionary when ListTables omits TableNames', async () => {
      stubSendJson({})

      await expect(service.listTablesDictionary()).resolves.toEqual({ items: [], cursor: null })
    })

    it('tolerates a BatchGetItem response with no Responses map', async () => {
      stubSendJson({})

      await expect(service.batchGetItem('Users', [{ id: '1' }])).resolves.toEqual({ items: [] })
    })

    it('gives up on BatchGetItem after the retry limit and returns what it collected', async () => {
      const { calls } = stubSendJsonDynamic(() => ({
        Responses: { Users: [{ id: { S: '1' } }] },
        UnprocessedKeys: { Users: { Keys: [{ id: { S: '2' } }] } },
      }))

      const res = await service.batchGetItem('Users', [{ id: '1' }, { id: '2' }])

      // 1 initial call + MAX_BATCH_RETRIES (5) retries, then the loop breaks.
      expect(calls).toHaveLength(6)
      expect(res.items).toHaveLength(6)
    })

    it('reports leftover deletes after BatchWriteItem exhausts its retries', async () => {
      const { calls } = stubSendJsonDynamic(() => ({
        UnprocessedItems: { Users: [{ DeleteRequest: { Key: { id: { S: 'x' } } } }] },
      }))

      const res = await service.batchWriteItem('Users', undefined, [{ id: 'x' }])

      expect(calls).toHaveLength(6)
      expect(res.processed).toBe(0)
      expect(res.unprocessed).toEqual([{ delete: { id: 'x' } }])
    })

    it('sends a raw updateExpression with no attribute values or names', async () => {
      const { calls } = stubSendJson({ Attributes: { id: { S: '1' } } })

      await service.updateItem('Users', { id: '1' }, undefined, 'REMOVE nickname')

      expect(calls[0].body.UpdateExpression).toBe('REMOVE nickname')
      expect(calls[0].body).not.toHaveProperty('ExpressionAttributeValues')
      expect(calls[0].body).not.toHaveProperty('ExpressionAttributeNames')
    })

    it('omits expression attribute names from a query when none are supplied', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })

      await service.query('Users', 'pk = :p', { ':p': 'tenant1' })

      expect(calls[0].body).not.toHaveProperty('ExpressionAttributeNames')
      expect(calls[0].body.ExpressionAttributeValues).toEqual({ ':p': { S: 'tenant1' } })
    })

    it('passes expression attribute names through on a query', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })

      await service.query('Users', 'pk = :p', { ':p': 'a' }, { '#n': 'name' }, '#n = :p')

      expect(calls[0].body.ExpressionAttributeNames).toEqual({ '#n': 'name' })
      expect(calls[0].body.FilterExpression).toBe('#n = :p')
    })

    it('omits expression attribute values from a query when none are supplied', async () => {
      const { calls } = stubSendJson({ Items: [], Count: 0 })

      await service.query('Users', 'pk = :p')

      expect(calls[0].body).not.toHaveProperty('ExpressionAttributeValues')
    })

    it('exposes a working default sleep helper', async () => {
      const { DynamoDB } = require('../src/index')

      await expect(new DynamoDB()._sleep(1)).resolves.toBeUndefined()
    })

    it('encodes the scan cursor when the response is truncated', async () => {
      stubSendJson({ Items: [], Count: 0, LastEvaluatedKey: { id: { S: '9' } } })

      const res = await service.scan('Users')

      expect(res.cursor).toBe(encodeCursor({ id: { S: '9' } }))
    })

    it('reports leftover puts after BatchWriteItem exhausts its retries', async () => {
      stubSendJsonDynamic(() => ({
        UnprocessedItems: { Users: [{ PutRequest: { Item: { id: { S: 'y' } } } }] },
      }))

      const res = await service.batchWriteItem('Users', [{ id: 'y' }])

      expect(res.unprocessed).toEqual([{ put: { id: 'y' } }])
    })
  })
})

// ── marshall.js ──
//
// Pure helper module — safe to require at describe level (it never touches global.Flowrunner).

describe('marshall module', () => {
  const {
    marshall,
    unmarshall,
    marshallItem,
    unmarshallItem,
    isAttributeValue,
    marshallValues,
    chunk,
  } = require('../src/marshall')

  describe('marshall', () => {
    it('maps every supported JavaScript type to its attribute value', () => {
      expect(marshall('')).toEqual({ S: '' })
      expect(marshall('hi')).toEqual({ S: 'hi' })
      expect(marshall(0)).toEqual({ N: '0' })
      expect(marshall(-1.5)).toEqual({ N: '-1.5' })
      expect(marshall(false)).toEqual({ BOOL: false })
      expect(marshall(null)).toEqual({ NULL: true })
      expect(marshall(undefined)).toEqual({ NULL: true })
      expect(marshall([])).toEqual({ L: [] })
      expect(marshall({})).toEqual({ M: {} })
      expect(marshall(Buffer.from('bin'))).toEqual({ B: Buffer.from('bin').toString('base64') })
    })

    it('marshalls a deeply nested structure', () => {
      expect(marshall({ a: [1, { b: [true, null] }] })).toEqual({
        M: {
          a: { L: [{ N: '1' }, { M: { b: { L: [{ BOOL: true }, { NULL: true }] } } } ] },
        },
      })
    })

    it('throws for values it cannot represent', () => {
      expect(() => marshall(() => 1)).toThrow('Cannot marshall value of type function')
      expect(() => marshall(Symbol('s'))).toThrow('Cannot marshall value of type symbol')
      expect(() => marshall(10n)).toThrow('Cannot marshall value of type bigint')
    })
  })

  describe('unmarshall', () => {
    it('returns null for a missing attribute value', () => {
      expect(unmarshall(null)).toBeNull()
      expect(unmarshall(undefined)).toBeNull()
    })

    it('reads the scalar attribute types', () => {
      expect(unmarshall({ S: 'x' })).toBe('x')
      expect(unmarshall({ N: '4.25' })).toBe(4.25)
      expect(unmarshall({ BOOL: false })).toBe(false)
      expect(unmarshall({ NULL: true })).toBeNull()
      expect(unmarshall({ B: Buffer.from('bin').toString('base64') })).toEqual(Buffer.from('bin'))
    })

    it('reads the set attribute types', () => {
      expect(unmarshall({ SS: ['a', 'b'] })).toEqual(['a', 'b'])
      expect(unmarshall({ NS: ['1', '2.5'] })).toEqual([1, 2.5])

      expect(unmarshall({ BS: [Buffer.from('a').toString('base64'), Buffer.from('b').toString('base64')] })).toEqual([
        Buffer.from('a'),
        Buffer.from('b'),
      ])
    })

    it('copies a string set rather than aliasing it', () => {
      const attr = { SS: ['a'] }
      const out = unmarshall(attr)

      out.push('b')

      expect(attr.SS).toEqual(['a'])
    })

    it('reads nested lists and maps', () => {
      expect(unmarshall({ L: [{ S: 'a' }, { M: { n: { N: '1' } } }] })).toEqual(['a', { n: 1 }])
    })

    it('throws for an unrecognised attribute value', () => {
      expect(() => unmarshall({ XX: 1 })).toThrow(/Cannot unmarshall attribute value: \{"XX":1\}/)
      expect(() => unmarshall({})).toThrow(/Cannot unmarshall attribute value/)
    })
  })

  describe('round trips', () => {
    it('survives marshall → unmarshall for a nested item', () => {
      const item = {
        id: 'user#1',
        age: 30,
        active: true,
        deleted: null,
        tags: ['a', 'b'],
        profile: { city: 'Paris', scores: [1, 2, 3], meta: { nested: { deep: true } } },
        blob: Buffer.from('binary'),
      }

      expect(unmarshallItem(marshallItem(item))).toEqual(item)
    })

    it('survives an empty item', () => {
      expect(unmarshallItem(marshallItem({}))).toEqual({})
    })
  })

  describe('isAttributeValue', () => {
    it('accepts every known single-key attribute type', () => {
      for (const type of ['S', 'N', 'BOOL', 'NULL', 'B', 'L', 'M', 'SS', 'NS', 'BS']) {
        expect(isAttributeValue({ [type]: 'x' })).toBe(true)
      }
    })

    it('rejects non attribute-value shapes', () => {
      expect(isAttributeValue(null)).toBe(false)
      expect(isAttributeValue(undefined)).toBe(false)
      expect(isAttributeValue(0)).toBe(false)
      expect(isAttributeValue('S')).toBe(false)
      expect(isAttributeValue([])).toBe(false)
      expect(isAttributeValue(Buffer.from('x'))).toBe(false)
      expect(isAttributeValue({})).toBe(false)
      expect(isAttributeValue({ S: 'a', N: '1' })).toBe(false)
      expect(isAttributeValue({ Z: 'a' })).toBe(false)
    })
  })

  describe('marshallValues', () => {
    it('leaves already-typed values alone and marshalls the rest', () => {
      expect(marshallValues({ ':a': { NULL: true }, ':b': [1], ':c': Buffer.from('x') })).toEqual({
        ':a': { NULL: true },
        ':b': { L: [{ N: '1' }] },
        ':c': { B: Buffer.from('x').toString('base64') },
      })
    })

    it('handles an empty map', () => {
      expect(marshallValues({})).toEqual({})
    })
  })

  describe('chunk', () => {
    it('returns one group when the array fits the size', () => {
      expect(chunk([1, 2], 5)).toEqual([[1, 2]])
      expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]])
    })
  })
})

// ── aws-client.js: pure builders and parsers ──

describe('aws-client builders and parsers (branch coverage)', () => {
  const { buildAwsJsonRequest, parseJsonResponse, parseXmlTag, parseXmlTags } = require('../src/aws-client')
  const { buildUpdateExpression } = require('../src/marshall')

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({ region: 'us-east-1', service: 'dynamodb', body: '{"a":1}', contentType: 'application/json' })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'dynamodb', contentType: 'application/json' }).body).toBe('{}')
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'dynamodb', body: null, contentType: 'x' }).body).toBe('{}')
  })

  it('treats an absent body as an empty object', () => {
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200, body: '   ' })).toEqual({})
  })

  it('reads the error name from a bare code and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDeniedException","Message":"nope"}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AccessDeniedException')
      expect(error.message).toBe('nope')
      expect(error.statusCode).toBe(403)
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })

  it('handles multi-line and absent XML tags', () => {
    expect(parseXmlTag('<M>line1\nline2</M>', 'M')).toBe('line1\nline2')
    expect(parseXmlTags('<a/>', 'N')).toEqual([])
  })

  it('rejects a missing updates object', () => {
    expect(() => buildUpdateExpression()).toThrow(/at least one/i)
    expect(() => buildUpdateExpression(null)).toThrow(/at least one/i)
  })
})

// ── errors.js: createLogger ──

describe('errors createLogger', () => {
  const { createLogger } = require('../src/errors')

  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('DynamoDB')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d', 1)

    expect(spy.mock.calls).toEqual([
      ['[DynamoDB Service]', 'info:', 'a'],
      ['[DynamoDB Service]', 'debug:', 'b'],
      ['[DynamoDB Service]', 'warn:', 'c'],
      ['[DynamoDB Service]', 'error:', 'd', 1],
    ])

    spy.mockRestore()
  })

  it('maps an error object with no name and no message', () => {
    const { mapAwsError } = require('../src/errors')

    expect(mapAwsError({}).message).toBe('Unknown error')
    expect(mapAwsError(Object.assign(new Error(''), { name: '' })).message).toBe('Unknown error')
  })

  it('maps the remaining throttling, credential and connectivity aliases', () => {
    const { mapAwsError } = require('../src/errors')
    const mapped = (name, message, extra = {}) => mapAwsError(Object.assign(new Error(message), { name }, extra)).message

    expect(mapped('Throttling', 'x')).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x')).toMatch(/throttled by AWS/)
    expect(mapped('UnrecognizedClientException', 'x')).toMatch(/Invalid AWS credentials/)
    expect(mapped('InvalidClientTokenId', 'x')).toMatch(/Invalid AWS credentials/)
    expect(mapped('Other', 'the security credential is bad')).toMatch(/Invalid AWS credentials/)
    expect(mapped('AccessDenied', 'nope')).toMatch(/Access denied/)
    expect(mapped('Other', 'Request timed out')).toMatch(/Connection to AWS failed/)
    expect(mapped('Other', 'boom', { code: 'ECONNREFUSED' })).toMatch(/Connection to AWS failed/)
    expect(mapped('Other', 'boom', { code: 'ENOTFOUND' })).toMatch(/Connection to AWS failed/)
    expect(mapped('Other', 'boom', { code: 'ETIMEDOUT' })).toMatch(/Connection to AWS failed/)
  })
})

// ── credentials.js: IAM role guard clauses ──

describe('CredentialProvider IAM Role guards', () => {
  const { CredentialProvider } = require('../src/credentials')

  it('defaults the authentication method, region and cache state', () => {
    const cp = new CredentialProvider()

    expect(cp.authenticationMethod).toBe('API Key')
    expect(cp.region).toBe('us-east-1')
    expect(cp._cached).toBeNull()
  })

  it('requires a Role ARN', async () => {
    const cp = new CredentialProvider(
      { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' },
      {
        stsAssumeRole: async () => {
          throw new Error('should not be called') 
        }, 
      }
    )

    await expect(cp.resolve()).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')
  })

  it('requires static keys to assume the role', async () => {
    const missingSecret = new CredentialProvider(
      { authenticationMethod: 'IAM Role', roleArn: 'arn:role', accessKeyId: 'AK' },
      {
        stsAssumeRole: async () => {
          throw new Error('should not be called') 
        }, 
      }
    )

    await expect(missingSecret.resolve()).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    const missingKey = new CredentialProvider(
      { authenticationMethod: 'IAM Role', roleArn: 'arn:role', secretAccessKey: 'SK' },
      {
        stsAssumeRole: async () => {
          throw new Error('should not be called') 
        }, 
      }
    )

    await expect(missingKey.resolve()).rejects.toThrow(/required to assume an IAM Role/)
  })

  it('builds a dynamodb-scoped session name and omits an absent external id', async () => {
    const now = 1_700_000_000_000
    const calls = []

    const cp = new CredentialProvider(
      { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'ap-south-1', roleArn: 'arn:role' },
      {
        now: () => now,
        stsAssumeRole: async (...args) => {
          calls.push(args)

          return { accessKeyId: 'A', secretAccessKey: 'B', sessionToken: 'C', expiration: new Date(now + 3_600_000) }
        },
      }
    )

    await cp.resolve()

    expect(calls[0]).toEqual([
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'ap-south-1',
      'arn:role',
      `flowrunner-dynamodb-${ now }`,
      undefined,
    ])
  })
})

// ── sigv4.js ──
//
// Signatures are only ever asserted under a frozen clock, and only ever against an
// independently written reference implementation — never against constants lifted
// from src/sigv4.js.

const { signRequest, generatePresignedUrl } = require('../src/sigv4')

// Well-known credentials from the published AWS SigV4 test suite.
const SIGV4_CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

const FIXED_NOW = new Date('2015-08-30T12:36:00Z')
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

const sha256Hex = data => nodeCrypto.createHash('sha256').update(data).digest('hex')
const hmacSha256 = (key, data) => nodeCrypto.createHmac('sha256', key).update(data).digest()

function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
}

/**
 * Independent SigV4 signer written from the AWS "Create a signed AWS API request"
 * specification. Anchored below to the published `get-vanilla` test vector, which
 * makes it a trustworthy oracle for the service's own signer.
 */
function referenceSign({ method, url, headers, payloadHash, credentials, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri =
    '/' + parsed.pathname.slice(1).split('/').map(seg => rfc3986Encode(decodeURIComponent(seg))).join('/')

  const canonicalQuery = [...parsed.searchParams.entries()]
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${ key }=${ value }`)
    .join('&')

  const lowered = Object.keys(headers)
    .map(key => [key.toLowerCase(), String(headers[key]).trim()])
    .sort()

  const canonicalHeaders = lowered.map(([key, value]) => `${ key }:${ value }\n`).join('')
  const signedHeaders = lowered.map(([key]) => key).join(';')

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256('AWS4' + credentials.secretAccessKey, dateStamp), region), service),
    'aws4_request'
  )

  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  return {
    signature,
    signedHeaders,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
      `SignedHeaders=${ signedHeaders }, Signature=${ signature }`,
  }
}

describe('sigv4 reference oracle', () => {
  it('reproduces the published AWS SigV4 test-suite vector (get-vanilla)', () => {
    const { authorization } = referenceSign({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': FIXED_AMZ_DATE },
      payloadHash: sha256Hex(''),
      credentials: SIGV4_CREDS,
      region: 'us-east-1',
      service: 'service',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })
})

describe('sigv4 signRequest under a frozen clock', () => {
  const URL_BASE = 'https://dynamodb.us-east-1.amazonaws.com/'
  const BODY = '{"TableName":"Users"}'

  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-amz-json-1.0', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || URL_BASE,
      headers,
      overrides.body !== undefined ? overrides.body : BODY,
      overrides.credentials || SIGV4_CREDS,
      overrides.region || 'us-east-1',
      overrides.service || 'dynamodb'
    )

    return headers
  }

  function expectedAuthorization(headers, opts = {}) {
    const signedInput = { ...headers }

    delete signedInput.authorization

    return referenceSign({
      method: opts.method || 'POST',
      url: opts.url || URL_BASE,
      headers: signedInput,
      payloadHash: headers['x-amz-content-sha256'],
      credentials: opts.credentials || SIGV4_CREDS,
      region: opts.region || 'us-east-1',
      service: opts.service || 'dynamodb',
      amzDate: headers['x-amz-date'],
    }).authorization
  }

  it('sets the deterministic SigV4 headers', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe('dynamodb.us-east-1.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(BODY))

    expect(headers['authorization']).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/dynamodb/aws4_request, ` +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('matches the independently derived reference signature', () => {
    const headers = sign()

    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('produces a stable signature for identical input', () => {
    expect(sign()['authorization']).toBe(sign()['authorization'])
  })

  it('changes the signature when the payload, secret, region or service change', () => {
    const baseline = sign()['authorization']

    expect(sign({ body: `${ BODY } ` })['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...SIGV4_CREDS, secretAccessKey: 'OTHER' } })['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })['authorization']).not.toBe(baseline)
    expect(sign({ service: 'sts' })['authorization']).not.toBe(baseline)
    expect(sign({ method: 'GET' })['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    expect(sign({ body: '' })['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(sign({ body: null })['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(sign({ body: undefined })['x-amz-content-sha256']).toBe(sha256Hex(BODY))
  })

  it('adds the session token to the signed headers when present', () => {
    const credentials = { ...SIGV4_CREDS, sessionToken: 'SESSION' }
    const headers = sign({ credentials })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { credentials }))
  })

  it('keeps an existing host header and includes only a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    expect(sign({ url: 'https://localhost:4566/' })['host']).toBe('localhost:4566')
    expect(sign({ url: 'https://localhost:443/' })['host']).toBe('localhost')
    expect(sign({ url: 'http://localhost:80/' })['host']).toBe('localhost')
  })

  it('matches the reference for a GET with a query string and an encoded path', () => {
    const url = 'https://dynamodb.eu-west-1.amazonaws.com/some%20path/sub?Marker=a&MaxItems=2'
    const headers = sign({ method: 'GET', url, body: '', region: 'eu-west-1' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, region: 'eu-west-1' }))
  })

  it('is insensitive to query ordering and sorts repeated keys by value', () => {
    const first = sign({ method: 'GET', url: 'https://s3.us-east-1.amazonaws.com/b?b=2&a=1', body: '' })
    const second = sign({ method: 'GET', url: 'https://s3.us-east-1.amazonaws.com/b?a=1&b=2', body: '' })

    expect(first['authorization']).toBe(second['authorization'])

    const url = 'https://s3.us-east-1.amazonaws.com/b?a=2&a=1'
    const repeated = sign({ method: 'GET', url, body: '' })

    expect(repeated['authorization']).toBe(expectedAuthorization(repeated, { method: 'GET', url }))
  })

  it('percent-encodes reserved and multi-byte characters in the path byte by byte', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/my bucket/résumé (1)!*.txt?nom=café&x=a~b_c.d-e'
    const headers = sign({ method: 'GET', url, body: '' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url }))
  })

  it('signs a body with multi-byte characters identically to the reference', () => {
    const body = '{"note":"café & résumé (100%)"}'
    const headers = sign({ body })

    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(body))
    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('returns the mutated headers object', () => {
    const headers = {}

    expect(signRequest('POST', URL_BASE, headers, '', SIGV4_CREDS, 'us-east-1', 'dynamodb')).toBe(headers)
  })
})

describe('sigv4 generatePresignedUrl under a frozen clock', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  // Re-derives the presigned signature from the produced URL with the independent reference.
  function referencePresignedSignature(presigned, { region = 'us-east-1', service = 's3', method = 'GET', credentials = SIGV4_CREDS } = {}) {
    const parsed = new URL(presigned)

    parsed.searchParams.delete('X-Amz-Signature')

    const port = parsed.port && parsed.port !== '443' && parsed.port !== '80' ? `:${ parsed.port }` : ''

    return referenceSign({
      method,
      url: parsed.toString(),
      headers: { host: `${ parsed.hostname }${ port }` },
      payloadHash: 'UNSIGNED-PAYLOAD',
      credentials,
      region,
      service,
      amzDate: parsed.searchParams.get('X-Amz-Date'),
    }).signature
  }

  it('adds every SigV4 query parameter and a reference-verified signature', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      900
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`)
    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
    expect(url.searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('includes the session token and a non-standard port in the signature', () => {
    const credentials = { ...SIGV4_CREDS, sessionToken: 'SESSION' }
    const presigned = generatePresignedUrl('PUT', 'https://localhost:4566/bucket/key', credentials, 'us-east-1', 's3', 60)
    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature(presigned, { method: 'PUT', credentials })
    )
  })

  it('preserves pre-existing query parameters and encodes multi-byte path segments', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://b.s3.us-east-1.amazonaws.com/résumé.txt?versionId=abc&a=1',
      SIGV4_CREDS,
      'eu-west-1',
      's3',
      120
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('versionId')).toBe('abc')
    expect(url.searchParams.get('a')).toBe('1')
    expect(url.searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned, { region: 'eu-west-1' }))
  })

  it('sorts repeated pre-existing query parameters by value', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://b.s3.us-east-1.amazonaws.com/k?a=2&a=1',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      60
    )

    expect(new URL(presigned).searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('drops a standard port from the signed host value', () => {
    for (const url of ['https://b.s3.amazonaws.com:443/k', 'http://b.s3.amazonaws.com:80/k']) {
      const presigned = generatePresignedUrl('GET', url, SIGV4_CREDS, 'us-east-1', 's3', 60)

      expect(new URL(presigned).searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
    }
  })

  it('is stable for identical input and reacts to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const longer = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 120)

    expect(first).toBe(second)
    expect(longer).not.toBe(first)
  })
})

// ── aws-client.js: node transport ──

const { httpRequest, stsAssumeRole } = require('../src/aws-client')

/**
 * Drives the mocked `https.request` / `http.request` with a canned response,
 * a transport error, a response-stream error, or a socket timeout.
 */
function stubTransport({
  statusCode = 200,
  body = '',
  error = null,
  responseError = null,
  fireTimeout = false,
  transport = https,
} = {}) {
  const captured = { options: null, written: [], timeoutMs: null, destroyedWith: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.destroy = jest.fn(err => {
      captured.destroyedWith = err

      if (err) {
        process.nextTick(() => req.emit('error', err))
      }
    })

    req.setTimeout = jest.fn((ms, onTimeout) => {
      captured.timeoutMs = ms

      if (fireTimeout) {
        onTimeout()
      }
    })

    req.end = () => {
      if (fireTimeout) {
        return
      }

      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)

        if (responseError) {
          res.emit('error', responseError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

describe('aws-client httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubTransport({ statusCode: 200, body: '{"ok":true}' })

    const response = await httpRequest(
      'POST',
      'https://dynamodb.us-east-1.amazonaws.com/path?a=1',
      { 'content-type': 'application/x-amz-json-1.0' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'dynamodb.us-east-1.amazonaws.com',
      port: 443,
      path: '/path?a=1',
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.0', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(captured.timeoutMs).toBe(30000)
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '{"ok":true}' })
  })

  it('does not mutate the caller headers', async () => {
    stubTransport({ statusCode: 200, body: '' })

    const headers = { 'content-type': 'text/plain' }

    await httpRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, 'body')

    expect(headers).toEqual({ 'content-type': 'text/plain' })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubTransport({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://dynamodb.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('concatenates multi-byte chunks into a utf8 body', async () => {
    https.request.mockImplementation((options, callback) => {
      const req = new EventEmitter()

      req.write = () => {}

      req.setTimeout = jest.fn()
      req.destroy = jest.fn()

      req.end = () => {
        process.nextTick(() => {
          const res = new EventEmitter()

          res.statusCode = 200
          res.headers = {}

          callback(res)

          // Split a multi-byte character across two chunks.
          const full = Buffer.from('café', 'utf8')

          res.emit('data', full.subarray(0, 3))
          res.emit('data', full.subarray(3))
          res.emit('end')
        })
      }

      return req
    })

    const response = await httpRequest('GET', 'https://dynamodb.us-east-1.amazonaws.com/', {})

    expect(response.body).toBe('café')
  })

  it('honours an explicit port', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'x' })

    await httpRequest('GET', 'https://localhost:4566/health', {})

    expect(captured.options.port).toBe('4566')
  })

  it('uses the http transport and port 80 for http URLs', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'plain', transport: http })

    const response = await httpRequest('GET', 'http://localhost/health', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options.port).toBe(80)
    expect(response.body).toBe('plain')
  })

  it('rejects on a transport error', async () => {
    stubTransport({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://dynamodb.us-east-1.amazonaws.com/', {})).rejects.toThrow(
      'connect ECONNREFUSED'
    )
  })

  it('rejects when the response stream errors', async () => {
    stubTransport({ responseError: new Error('stream aborted') })

    await expect(httpRequest('GET', 'https://dynamodb.us-east-1.amazonaws.com/', {})).rejects.toThrow('stream aborted')
  })

  it('destroys the request and rejects when the socket times out', async () => {
    const captured = stubTransport({ fireTimeout: true })

    await expect(httpRequest('GET', 'https://dynamodb.us-east-1.amazonaws.com/', {})).rejects.toThrow('Request timed out')

    expect(captured.destroyedWith).toBeInstanceOf(Error)
  })
})

describe('aws-client stsAssumeRole', () => {
  const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  afterEach(() => {
    https.request.mockReset()
  })

  it('signs the STS call and returns the temporary credentials', async () => {
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(SIGV4_CREDS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

    expect(captured.options).toMatchObject({
      hostname: 'sts.eu-west-1.amazonaws.com',
      port: 443,
      path: '/',
      method: 'POST',
    })

    expect(captured.options.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(captured.options.headers['content-length']).toBeGreaterThan(0)

    expect(captured.written.join('')).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not provided', async () => {
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 'session-2')

    expect(captured.written.join('')).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubTransport({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body has no Code or Message', async () => {
    stubTransport({ statusCode: 500, body: '<html>gateway</html>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubTransport({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>A</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSParseError',
      message: expect.stringContaining('missing credential fields'),
    })
  })

  it('propagates a socket error', async () => {
    stubTransport({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow('socket hang up')
  })
})

// ── aws-client.js: jsonRequest end to end over the mocked transport ──

describe('aws-client jsonRequest with the real signer and transport', () => {
  const { jsonRequest } = require('../src/aws-client')

  afterEach(() => {
    https.request.mockReset()
  })

  it('signs, sends and parses without injected dependencies', async () => {
    const captured = stubTransport({ statusCode: 200, body: '{"TableNames":["Users"]}' })

    const result = await jsonRequest(
      {
        region: 'us-east-1',
        service: 'dynamodb',
        target: 'DynamoDB_20120810.ListTables',
        contentType: 'application/x-amz-json-1.0',
        body: {},
      },
      SIGV4_CREDS
    )

    expect(result).toEqual({ TableNames: ['Users'] })
    expect(captured.options.headers['x-amz-target']).toBe('DynamoDB_20120810.ListTables')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
  })

  it('throws the parsed AWS error for a failed response', async () => {
    stubTransport({ statusCode: 400, body: '{"__type":"x#ValidationException","message":"bad request"}' })

    await expect(
      jsonRequest(
        { region: 'us-east-1', service: 'dynamodb', target: 'T.Op', contentType: 'application/x-amz-json-1.0', body: {} },
        SIGV4_CREDS
      )
    ).rejects.toMatchObject({ name: 'ValidationException', message: 'bad request', statusCode: 400 })
  })
})
