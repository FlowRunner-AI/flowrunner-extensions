'use strict'

// ============================================================================
//  MongoDB Service — Unit Tests
//
//  The MongoDB service uses the native `mongodb` driver (MongoClient) instead
//  of Flowrunner.Request, so we mock the entire `mongodb` module with Jest.
// ============================================================================

const { createSandbox } = require('../../../service-sandbox')

// ---------------------------------------------------------------------------
//  Mock mongodb driver — all variables prefixed with `mock` so Jest allows
//  referencing them inside jest.mock() factory.
// ---------------------------------------------------------------------------

const mockFindCursor = {
  project: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue([]),
}

const mockAggregateCursor = {
  toArray: jest.fn().mockResolvedValue([]),
}

const mockSearchIndexCursor = {
  toArray: jest.fn().mockResolvedValue([]),
}

const mockCollection = {
  find: jest.fn().mockReturnValue(mockFindCursor),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: { _bsontype: 'ObjectId', toHexString: () => 'aaa000000000000000000000' }, acknowledged: true }),
  insertMany: jest.fn().mockResolvedValue({ insertedCount: 2, insertedIds: {} }),
  updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null }),
  updateMany: jest.fn().mockResolvedValue({ matchedCount: 5, modifiedCount: 5, upsertedId: null }),
  replaceOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 42 }),
  countDocuments: jest.fn().mockResolvedValue(128),
  distinct: jest.fn().mockResolvedValue(['London', 'Paris', 'Tokyo']),
  aggregate: jest.fn().mockReturnValue(mockAggregateCursor),
  indexes: jest.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]),
  createIndex: jest.fn().mockResolvedValue('email_1'),
  drop: jest.fn().mockResolvedValue(true),
  createSearchIndex: jest.fn().mockResolvedValue('vector_index'),
  listSearchIndexes: jest.fn().mockReturnValue(mockSearchIndexCursor),
  updateSearchIndex: jest.fn().mockResolvedValue(undefined),
  dropSearchIndex: jest.fn().mockResolvedValue(undefined),
}

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
  listCollections: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([
      { name: 'users', type: 'collection' },
      { name: 'orders', type: 'collection' },
    ]),
  }),
  createCollection: jest.fn().mockResolvedValue(undefined),
}

const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  db: jest.fn().mockReturnValue(mockDb),
  close: jest.fn().mockResolvedValue(undefined),
}

// A minimal ObjectId stand-in for the service's #normalizeFilter.
class MockObjectId {
  constructor(hex) {
    this._hex = hex
    this._bsontype = 'ObjectId'
  }

  toHexString() {
    return this._hex
  }

  toString() {
    return this._hex
  }
}

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => mockClient),
  ObjectId: MockObjectId,
}))

// ---------------------------------------------------------------------------
//  Helper utilities
// ---------------------------------------------------------------------------

function mockObjectId(hex24) {
  const padded = hex24.padEnd(24, '0')

  return { _bsontype: 'ObjectId', toHexString: () => padded }
}

function resetAllMocks() {
  // Reset all mock function call history but keep the implementations.
  Object.values(mockFindCursor).forEach(fn => fn.mockClear())
  Object.values(mockAggregateCursor).forEach(fn => fn.mockClear())
  Object.values(mockSearchIndexCursor).forEach(fn => fn.mockClear())
  Object.values(mockCollection).forEach(fn => fn.mockClear())
  Object.values(mockDb).forEach(fn => { if (typeof fn.mockClear === 'function') fn.mockClear() })
  mockClient.connect.mockClear()
  mockClient.db.mockClear()
  mockClient.close.mockClear()

  // Restore default return values that get overridden in individual tests.
  mockFindCursor.project.mockReturnThis()
  mockFindCursor.sort.mockReturnThis()
  mockFindCursor.skip.mockReturnThis()
  mockFindCursor.limit.mockReturnThis()
  mockFindCursor.toArray.mockResolvedValue([])
  mockAggregateCursor.toArray.mockResolvedValue([])
  mockSearchIndexCursor.toArray.mockResolvedValue([])
  mockCollection.find.mockReturnValue(mockFindCursor)
  mockCollection.aggregate.mockReturnValue(mockAggregateCursor)
  mockCollection.listSearchIndexes.mockReturnValue(mockSearchIndexCursor)
  mockClient.connect.mockResolvedValue(undefined)
  mockClient.db.mockReturnValue(mockDb)
  mockClient.close.mockResolvedValue(undefined)
  mockDb.collection.mockReturnValue(mockCollection)
  mockDb.listCollections.mockReturnValue({
    toArray: jest.fn().mockResolvedValue([
      { name: 'users', type: 'collection' },
      { name: 'orders', type: 'collection' },
    ]),
  })
}

// ---------------------------------------------------------------------------
//  Helper: build a fresh service instance
// ---------------------------------------------------------------------------
function buildService(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()

  // Re-apply the mock after resetModules (resetModules clears the module registry).
  jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => mockClient),
    ObjectId: MockObjectId,
  }))

  require('../src/index.js')

  return {
    sandbox,
    service: sandbox.getService(),
  }
}

// ===========================================================================
//  Tests
// ===========================================================================

describe('MongoDB Service', () => {
  let sandbox
  let service

  beforeEach(() => {
    resetAllMocks()
    ;({ sandbox, service } = buildService({
      connectionString: 'mongodb+srv://user:pass@cluster0.example.mongodb.net',
      database: 'testdb',
      connectionTimeoutSeconds: '5',
    }))
  })

  afterEach(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'connectionString',
          displayName: 'Connection String',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'database',
          displayName: 'Database',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'connectionTimeoutSeconds',
          displayName: 'Connection Timeout (seconds)',
          required: false,
          shared: false,
          defaultValue: '10',
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Configuration validation ──

  describe('configuration validation', () => {
    it('throws when connection string is missing', async () => {
      ;({ sandbox, service } = buildService({ database: 'testdb' }))

      await expect(service.findDocuments('users')).rejects.toThrow('Connection String is not configured')
    })

    it('throws when database is missing', async () => {
      ;({ sandbox, service } = buildService({
        connectionString: 'mongodb+srv://user:pass@cluster0.example.mongodb.net',
      }))

      await expect(service.findDocuments('users')).rejects.toThrow('Database is not configured')
    })

    it('throws when collection name is empty', async () => {
      await expect(service.findDocuments('')).rejects.toThrow('Collection name is required')
    })

    it('throws when collection name is not a string', async () => {
      await expect(service.findDocuments(123)).rejects.toThrow('Collection name is required')
    })
  })

  // ── findDocuments ──

  describe('findDocuments', () => {
    it('queries with default limit when no params provided', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('665f1c2ab7e4a3d2f0a11b22'), name: 'Ada' },
      ])

      const result = await service.findDocuments('users')

      expect(mockDb.collection).toHaveBeenCalledWith('users')
      expect(mockCollection.find).toHaveBeenCalledWith({})
      expect(mockFindCursor.limit).toHaveBeenCalledWith(100)
      expect(result).toHaveProperty('documents')
      expect(result).toHaveProperty('count', 1)
    })

    it('applies filter, projection, sort, limit and skip', async () => {
      mockFindCursor.toArray.mockResolvedValue([])

      await service.findDocuments(
        'users',
        { status: 'active' },
        { name: 1, email: 1 },
        { createdAt: -1 },
        10,
        20
      )

      expect(mockCollection.find).toHaveBeenCalledWith({ status: 'active' })
      expect(mockFindCursor.project).toHaveBeenCalledWith({ name: 1, email: 1 })
      expect(mockFindCursor.sort).toHaveBeenCalledWith({ createdAt: -1 })
      expect(mockFindCursor.limit).toHaveBeenCalledWith(10)
      expect(mockFindCursor.skip).toHaveBeenCalledWith(20)
    })

    it('does not call project/sort/skip when not provided', async () => {
      mockFindCursor.toArray.mockResolvedValue([])

      await service.findDocuments('users')

      expect(mockFindCursor.project).not.toHaveBeenCalled()
      expect(mockFindCursor.sort).not.toHaveBeenCalled()
      expect(mockFindCursor.skip).not.toHaveBeenCalled()
    })

    it('serializes ObjectId values in results to hex strings', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('665f1c2ab7e4a3d2f0a11b22'), name: 'Ada' },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0]._id).toBe('665f1c2ab7e4a3d2f0a11b22')
    })

    it('serializes Date values in results to ISO strings', async () => {
      const date = new Date('2024-01-01T00:00:00.000Z')

      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('665f1c2ab7e4a3d2f0a11b22'), createdAt: date },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].createdAt).toBe('2024-01-01T00:00:00.000Z')
    })

    it('converts 24-hex _id string in filter to ObjectId', async () => {
      mockFindCursor.toArray.mockResolvedValue([])

      await service.findDocuments('users', { _id: '665f1c2ab7e4a3d2f0a11b22' })

      const calledFilter = mockCollection.find.mock.calls[0][0]

      expect(calledFilter._id).toBeInstanceOf(MockObjectId)
    })

    it('does not convert non-24-hex _id strings', async () => {
      mockFindCursor.toArray.mockResolvedValue([])

      await service.findDocuments('users', { _id: 'custom-string-id' })

      const calledFilter = mockCollection.find.mock.calls[0][0]

      expect(calledFilter._id).toBe('custom-string-id')
    })

    it('closes the connection after success', async () => {
      mockFindCursor.toArray.mockResolvedValue([])

      await service.findDocuments('users')

      expect(mockClient.close).toHaveBeenCalled()
    })
  })

  // ── findOneDocument ──

  describe('findOneDocument', () => {
    it('returns found document', async () => {
      mockCollection.findOne.mockResolvedValue({
        _id: mockObjectId('665f1c2ab7e4a3d2f0a11b22'),
        name: 'Ada',
      })

      const result = await service.findOneDocument('users', { email: 'ada@example.com' })

      expect(result.found).toBe(true)
      expect(result.document._id).toBe('665f1c2ab7e4a3d2f0a11b22')
    })

    it('returns found=false when no document matches', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await service.findOneDocument('users', { email: 'nobody@example.com' })

      expect(result.found).toBe(false)
      expect(result.document).toBeNull()
    })

    it('applies projection when provided', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      await service.findOneDocument('users', { email: 'ada@example.com' }, { name: 1 })

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.any(Object),
        { projection: { name: 1 } }
      )
    })

    it('omits projection option when not provided', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      await service.findOneDocument('users', { email: 'ada@example.com' })

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.any(Object),
        {}
      )
    })

    it('throws when filter is empty', async () => {
      await expect(service.findOneDocument('users', {})).rejects.toThrow('must be a non-empty object')
    })

    it('throws when filter is not provided', async () => {
      await expect(service.findOneDocument('users')).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── insertDocument ──

  describe('insertDocument', () => {
    it('inserts a document and returns insertedId', async () => {
      mockCollection.insertOne.mockResolvedValue({
        insertedId: mockObjectId('665f1c2ab7e4a3d2f0a11b22'),
        acknowledged: true,
      })

      const result = await service.insertDocument('users', { name: 'Ada', email: 'ada@example.com' })

      expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: 'Ada', email: 'ada@example.com' })
      expect(result.insertedId).toBe('665f1c2ab7e4a3d2f0a11b22')
      expect(result.acknowledged).toBe(true)
    })

    it('throws when document is empty', async () => {
      await expect(service.insertDocument('users', {})).rejects.toThrow('must be a non-empty object')
    })

    it('throws when document is not provided', async () => {
      await expect(service.insertDocument('users')).rejects.toThrow('must be a non-empty object')
    })

    it('throws when document is an array', async () => {
      await expect(service.insertDocument('users', [{ name: 'Ada' }])).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── insertDocuments ──

  describe('insertDocuments', () => {
    it('bulk-inserts documents and returns insertedCount', async () => {
      mockCollection.insertMany.mockResolvedValue({
        insertedCount: 2,
        insertedIds: { 0: mockObjectId('bbb'), 1: mockObjectId('ccc') },
      })

      const result = await service.insertDocuments('users', [{ name: 'Ada' }, { name: 'Linus' }])

      expect(mockCollection.insertMany).toHaveBeenCalledWith([{ name: 'Ada' }, { name: 'Linus' }])
      expect(result.insertedCount).toBe(2)
    })

    it('throws when documents is not an array', async () => {
      await expect(service.insertDocuments('users', 'not-array')).rejects.toThrow('must be a non-empty array')
    })

    it('throws when documents is an empty array', async () => {
      await expect(service.insertDocuments('users', [])).rejects.toThrow('must be a non-empty array')
    })

    it('throws when any document in the array is empty', async () => {
      await expect(service.insertDocuments('users', [{ name: 'Ada' }, {}])).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── updateDocument ──

  describe('updateDocument', () => {
    it('updates a document with plain fields (auto-wrapped in $set)', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null })

      const result = await service.updateDocument('users', { _id: '665f1c2ab7e4a3d2f0a11b22' }, { status: 'archived' })

      const calledUpdate = mockCollection.updateOne.mock.calls[0][1]

      expect(calledUpdate).toHaveProperty('$set')
      expect(calledUpdate.$set).toMatchObject({ status: 'archived' })
      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)
    })

    it('passes through update operators without wrapping', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null })

      await service.updateDocument('users', { _id: '665f1c2ab7e4a3d2f0a11b22' }, { $set: { status: 'archived' }, $inc: { loginCount: 1 } })

      const calledUpdate = mockCollection.updateOne.mock.calls[0][1]

      expect(calledUpdate).toHaveProperty('$set')
      expect(calledUpdate).toHaveProperty('$inc')
    })

    it('passes upsert option when true', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0, upsertedId: mockObjectId('ddd') })

      await service.updateDocument('users', { email: 'new@example.com' }, { name: 'New' }, true)

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { upsert: true }
      )
    })

    it('defaults upsert to false', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null })

      await service.updateDocument('users', { email: 'ada@example.com' }, { name: 'Ada' })

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { upsert: false }
      )
    })

    it('throws when filter is empty', async () => {
      await expect(service.updateDocument('users', {}, { name: 'Ada' })).rejects.toThrow('must be a non-empty object')
    })

    it('throws when update is empty', async () => {
      await expect(service.updateDocument('users', { _id: 'abc' }, {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── updateDocuments ──

  describe('updateDocuments', () => {
    it('updates multiple documents', async () => {
      mockCollection.updateMany.mockResolvedValue({ matchedCount: 5, modifiedCount: 5, upsertedId: null })

      const result = await service.updateDocuments('users', { status: 'active' }, { $set: { status: 'archived' } })

      expect(mockCollection.updateMany).toHaveBeenCalled()
      expect(result.matchedCount).toBe(5)
      expect(result.modifiedCount).toBe(5)
    })

    it('throws when filter is empty', async () => {
      await expect(service.updateDocuments('users', {}, { name: 'Ada' })).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── replaceDocument ──

  describe('replaceDocument', () => {
    it('replaces a document', async () => {
      mockCollection.replaceOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedId: null })

      const result = await service.replaceDocument(
        'users',
        { _id: '665f1c2ab7e4a3d2f0a11b22' },
        { name: 'Ada', email: 'ada@new.com' }
      )

      expect(mockCollection.replaceOne).toHaveBeenCalled()
      expect(result.matchedCount).toBe(1)
    })

    it('passes upsert option when true', async () => {
      mockCollection.replaceOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0, upsertedId: mockObjectId('eee') })

      await service.replaceDocument('users', { email: 'new@example.com' }, { name: 'New' }, true)

      expect(mockCollection.replaceOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { upsert: true }
      )
    })

    it('throws when filter is empty', async () => {
      await expect(service.replaceDocument('users', {}, { name: 'Ada' })).rejects.toThrow('must be a non-empty object')
    })

    it('throws when replacement is empty', async () => {
      await expect(service.replaceDocument('users', { _id: 'abc' }, {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── deleteDocument ──

  describe('deleteDocument', () => {
    it('deletes a single document', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 })

      const result = await service.deleteDocument('users', { _id: '665f1c2ab7e4a3d2f0a11b22' })

      expect(mockCollection.deleteOne).toHaveBeenCalled()
      expect(result.deletedCount).toBe(1)
    })

    it('returns deletedCount 0 when nothing matches', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 })

      const result = await service.deleteDocument('users', { _id: '000000000000000000000000' })

      expect(result.deletedCount).toBe(0)
    })

    it('throws when filter is empty', async () => {
      await expect(service.deleteDocument('users', {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── deleteDocuments ──

  describe('deleteDocuments', () => {
    it('deletes multiple documents', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 42 })

      const result = await service.deleteDocuments('users', { status: 'archived' })

      expect(mockCollection.deleteMany).toHaveBeenCalled()
      expect(result.deletedCount).toBe(42)
    })

    it('throws when filter is empty', async () => {
      await expect(service.deleteDocuments('users', {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── countDocuments ──

  describe('countDocuments', () => {
    it('counts all documents when no filter', async () => {
      mockCollection.countDocuments.mockResolvedValue(128)

      const result = await service.countDocuments('users')

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({})
      expect(result.count).toBe(128)
    })

    it('counts with a filter', async () => {
      mockCollection.countDocuments.mockResolvedValue(42)

      const result = await service.countDocuments('users', { status: 'active' })

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({ status: 'active' })
      expect(result.count).toBe(42)
    })
  })

  // ── distinctValues ──

  describe('distinctValues', () => {
    it('returns distinct values for a field', async () => {
      mockCollection.distinct.mockResolvedValue(['London', 'Paris', 'Tokyo'])

      const result = await service.distinctValues('users', 'city')

      expect(mockCollection.distinct).toHaveBeenCalledWith('city', {})
      expect(result.values).toEqual(['London', 'Paris', 'Tokyo'])
      expect(result.count).toBe(3)
    })

    it('passes filter to distinct', async () => {
      mockCollection.distinct.mockResolvedValue(['active'])

      await service.distinctValues('users', 'status', { role: 'admin' })

      expect(mockCollection.distinct).toHaveBeenCalledWith('status', { role: 'admin' })
    })

    it('throws when field is empty', async () => {
      await expect(service.distinctValues('users', '')).rejects.toThrow('Field is required')
    })

    it('throws when field is not a string', async () => {
      await expect(service.distinctValues('users', 123)).rejects.toThrow('Field is required')
    })
  })

  // ── aggregate ──

  describe('aggregate', () => {
    it('runs an aggregation pipeline', async () => {
      mockAggregateCursor.toArray.mockResolvedValue([
        { _id: 'US', total: 42 },
        { _id: 'UK', total: 17 },
      ])

      const pipeline = [
        { $match: { status: 'active' } },
        { $group: { _id: '$country', total: { $sum: 1 } } },
      ]

      const result = await service.aggregate('users', pipeline)

      expect(mockCollection.aggregate).toHaveBeenCalledWith(
        expect.any(Array),
        { allowDiskUse: true }
      )
      expect(result.results).toEqual([{ _id: 'US', total: 42 }, { _id: 'UK', total: 17 }])
      expect(result.count).toBe(2)
    })

    it('throws when pipeline is not an array', async () => {
      await expect(service.aggregate('users', 'not-array')).rejects.toThrow('must be a non-empty array')
    })

    it('throws when pipeline is an empty array', async () => {
      await expect(service.aggregate('users', [])).rejects.toThrow('must be a non-empty array')
    })
  })

  // ── listCollections ──

  describe('listCollections', () => {
    it('returns sorted collections with name and type', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'orders', type: 'collection' },
          { name: 'active_users', type: 'view' },
          { name: 'users', type: 'collection' },
        ]),
      })

      const result = await service.listCollections()

      expect(result.collections).toEqual([
        { name: 'active_users', type: 'view' },
        { name: 'orders', type: 'collection' },
        { name: 'users', type: 'collection' },
      ])
      expect(result.count).toBe(3)
    })

    it('defaults type to "collection" when not present', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ name: 'legacy' }]),
      })

      const result = await service.listCollections()

      expect(result.collections[0].type).toBe('collection')
    })
  })

  // ── createCollection ──

  describe('createCollection', () => {
    it('creates a collection and returns confirmation', async () => {
      const result = await service.createCollection('orders')

      expect(mockDb.createCollection).toHaveBeenCalledWith('orders')
      expect(result).toEqual({ collection: 'orders', created: true })
    })

    it('trims whitespace from collection name', async () => {
      await service.createCollection('  orders  ')

      expect(mockDb.createCollection).toHaveBeenCalledWith('orders')
    })
  })

  // ── dropCollection ──

  describe('dropCollection', () => {
    it('drops a collection and returns dropped=true', async () => {
      mockCollection.drop.mockResolvedValue(true)

      const result = await service.dropCollection('old_logs')

      expect(result).toEqual({ collection: 'old_logs', dropped: true })
    })

    it('returns dropped=false when collection does not exist (NamespaceNotFound)', async () => {
      mockCollection.drop.mockRejectedValue({ codeName: 'NamespaceNotFound', message: 'ns not found' })

      const result = await service.dropCollection('nonexistent')

      expect(result).toEqual({ collection: 'nonexistent', dropped: false })
    })

    it('returns dropped=false when collection does not exist (ns not found message)', async () => {
      mockCollection.drop.mockRejectedValue({ message: 'ns not found' })

      const result = await service.dropCollection('nonexistent')

      expect(result).toEqual({ collection: 'nonexistent', dropped: false })
    })
  })

  // ── createIndex ──

  describe('createIndex', () => {
    it('creates an index and returns the index name', async () => {
      mockCollection.createIndex.mockResolvedValue('email_1')

      const result = await service.createIndex('users', { email: 1 })

      expect(mockCollection.createIndex).toHaveBeenCalledWith({ email: 1 }, {})
      expect(result).toEqual({ indexName: 'email_1', collection: 'users' })
    })

    it('passes options when provided', async () => {
      mockCollection.createIndex.mockResolvedValue('email_unique')

      await service.createIndex('users', { email: 1 }, { unique: true })

      expect(mockCollection.createIndex).toHaveBeenCalledWith({ email: 1 }, { unique: true })
    })

    it('uses empty options when options is not a plain object', async () => {
      mockCollection.createIndex.mockResolvedValue('email_1')

      await service.createIndex('users', { email: 1 }, 'not-an-object')

      expect(mockCollection.createIndex).toHaveBeenCalledWith({ email: 1 }, {})
    })

    it('throws when keys is empty', async () => {
      await expect(service.createIndex('users', {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── listIndexes ──

  describe('listIndexes', () => {
    it('lists indexes for a collection', async () => {
      mockCollection.indexes.mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'email_1', key: { email: 1 }, unique: true },
      ])

      const result = await service.listIndexes('users')

      expect(result.indexes).toHaveLength(2)
      expect(result.count).toBe(2)
    })
  })

  // ── vectorSearch ──

  describe('vectorSearch', () => {
    it('builds a $vectorSearch pipeline and returns results', async () => {
      mockAggregateCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('665f1c2ab7e4a3d2f0a11b22'), title: 'Test', vectorSearchScore: 0.94 },
      ])

      const queryVector = [0.1, 0.2, 0.3]

      const result = await service.vectorSearch('movies', 'vector_index', 'embedding', queryVector, 100, 10)

      expect(mockCollection.aggregate).toHaveBeenCalled()
      const calledPipeline = mockCollection.aggregate.mock.calls[0][0]

      expect(calledPipeline[0]).toHaveProperty('$vectorSearch')
      expect(calledPipeline[0].$vectorSearch).toMatchObject({
        index: 'vector_index',
        path: 'embedding',
        queryVector,
        numCandidates: 100,
        limit: 10,
      })
      expect(calledPipeline[1]).toHaveProperty('$addFields')
      expect(result.results).toHaveLength(1)
      expect(result.count).toBe(1)
    })

    it('includes pre-filter when provided', async () => {
      mockAggregateCursor.toArray.mockResolvedValue([])

      await service.vectorSearch('movies', 'vector_index', 'embedding', [0.1], 100, 10, { category: 'news' })

      const calledPipeline = mockCollection.aggregate.mock.calls[0][0]

      expect(calledPipeline[0].$vectorSearch).toHaveProperty('filter', { category: 'news' })
    })

    it('omits filter from pipeline when not provided', async () => {
      mockAggregateCursor.toArray.mockResolvedValue([])

      await service.vectorSearch('movies', 'vector_index', 'embedding', [0.1])

      const calledPipeline = mockCollection.aggregate.mock.calls[0][0]

      expect(calledPipeline[0].$vectorSearch).not.toHaveProperty('filter')
    })

    it('uses defaults for numCandidates and limit', async () => {
      mockAggregateCursor.toArray.mockResolvedValue([])

      await service.vectorSearch('movies', 'vector_index', 'embedding', [0.1])

      const calledPipeline = mockCollection.aggregate.mock.calls[0][0]

      expect(calledPipeline[0].$vectorSearch.numCandidates).toBe(100)
      expect(calledPipeline[0].$vectorSearch.limit).toBe(10)
    })

    it('throws when indexName is empty', async () => {
      await expect(service.vectorSearch('movies', '', 'embedding', [0.1])).rejects.toThrow('Index Name is required')
    })

    it('throws when path is empty', async () => {
      await expect(service.vectorSearch('movies', 'idx', '', [0.1])).rejects.toThrow('Vector Field Path is required')
    })

    it('throws when queryVector is not an array of numbers', async () => {
      await expect(service.vectorSearch('movies', 'idx', 'embedding', ['a', 'b'])).rejects.toThrow('Query Vector is required')
    })

    it('throws when queryVector is empty', async () => {
      await expect(service.vectorSearch('movies', 'idx', 'embedding', [])).rejects.toThrow('Query Vector is required')
    })
  })

  // ── createSearchIndex ──

  describe('createSearchIndex', () => {
    it('creates a vector search index', async () => {
      mockCollection.createSearchIndex.mockResolvedValue('vector_index')

      const definition = { fields: [{ type: 'vector', path: 'embedding', numDimensions: 1536, similarity: 'cosine' }] }

      const result = await service.createSearchIndex('movies', 'vector_index', 'Vector Search', definition)

      expect(mockCollection.createSearchIndex).toHaveBeenCalledWith({
        name: 'vector_index',
        type: 'vectorSearch',
        definition,
      })
      expect(result).toEqual({ indexName: 'vector_index', collection: 'movies', type: 'vectorSearch' })
    })

    it('maps "Search" type to "search"', async () => {
      mockCollection.createSearchIndex.mockResolvedValue('text_index')

      await service.createSearchIndex('movies', 'text_index', 'Search', { mappings: { dynamic: true } })

      expect(mockCollection.createSearchIndex).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'search' })
      )
    })

    it('defaults type to vectorSearch when not provided', async () => {
      mockCollection.createSearchIndex.mockResolvedValue('default_index')

      await service.createSearchIndex('movies', 'default_index', undefined, { fields: [] })

      expect(mockCollection.createSearchIndex).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'vectorSearch' })
      )
    })

    it('throws when name is empty', async () => {
      await expect(service.createSearchIndex('movies', '', 'Vector Search', { fields: [] })).rejects.toThrow('Index Name is required')
    })

    it('throws when definition is empty', async () => {
      await expect(service.createSearchIndex('movies', 'idx', 'Vector Search', {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── listSearchIndexes ──

  describe('listSearchIndexes', () => {
    it('lists search indexes', async () => {
      mockSearchIndexCursor.toArray.mockResolvedValue([
        { name: 'vector_index', type: 'vectorSearch', status: 'READY', queryable: true },
      ])

      const result = await service.listSearchIndexes('movies')

      expect(result.indexes).toHaveLength(1)
      expect(result.count).toBe(1)
    })
  })

  // ── updateSearchIndex ──

  describe('updateSearchIndex', () => {
    it('updates a search index definition', async () => {
      const definition = { fields: [{ type: 'vector', path: 'embedding', numDimensions: 768, similarity: 'dotProduct' }] }

      const result = await service.updateSearchIndex('movies', 'vector_index', definition)

      expect(mockCollection.updateSearchIndex).toHaveBeenCalledWith('vector_index', definition)
      expect(result).toEqual({ indexName: 'vector_index', collection: 'movies', updated: true })
    })

    it('throws when name is empty', async () => {
      await expect(service.updateSearchIndex('movies', '', { fields: [] })).rejects.toThrow('Index Name is required')
    })

    it('throws when definition is empty', async () => {
      await expect(service.updateSearchIndex('movies', 'idx', {})).rejects.toThrow('must be a non-empty object')
    })
  })

  // ── dropSearchIndex ──

  describe('dropSearchIndex', () => {
    it('drops a search index', async () => {
      const result = await service.dropSearchIndex('movies', 'vector_index')

      expect(mockCollection.dropSearchIndex).toHaveBeenCalledWith('vector_index')
      expect(result).toEqual({ indexName: 'vector_index', collection: 'movies', dropped: true })
    })

    it('throws when name is empty', async () => {
      await expect(service.dropSearchIndex('movies', '')).rejects.toThrow('Index Name is required')
    })
  })

  // ── getCollectionsDictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns all collections as dictionary items sorted by name', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'users', type: 'collection' },
          { name: 'orders', type: 'collection' },
        ]),
      })

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toEqual([
        { label: 'orders', value: 'orders', note: 'collection' },
        { label: 'users', value: 'users', note: 'collection' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search text (case-insensitive)', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'users', type: 'collection' },
          { name: 'orders', type: 'collection' },
          { name: 'user_settings', type: 'collection' },
        ]),
      })

      const result = await service.getCollectionsDictionary({ search: 'USER' })

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(['user_settings', 'users'])
    })

    it('returns all items when search is empty', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'users', type: 'collection' },
        ]),
      })

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toHaveLength(1)
    })

    it('handles null payload', async () => {
      mockDb.listCollections.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'users', type: 'collection' },
        ]),
      })

      const result = await service.getCollectionsDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps MongoServerSelectionError with network hint', async () => {
      const error = new Error('Server selection timed out')

      error.name = 'MongoServerSelectionError'

      mockClient.connect.mockRejectedValue(error)

      await expect(service.findDocuments('users')).rejects.toThrow(/hint.*IP Access List/)
    })

    it('wraps connection errors with ETIMEDOUT hint', async () => {
      const error = new Error('connect ETIMEDOUT 1.2.3.4:27017')

      mockClient.connect.mockRejectedValue(error)

      await expect(service.findDocuments('users')).rejects.toThrow(/hint/)
    })

    it('wraps errors with codeName and code', async () => {
      const error = new Error('bad auth')

      error.codeName = 'AuthenticationFailed'
      error.code = 18

      mockClient.connect.mockRejectedValue(error)

      await expect(service.findDocuments('users')).rejects.toThrow(/codeName: AuthenticationFailed.*code: 18/)
    })

    it('closes the connection even when the operation fails', async () => {
      mockCollection.find.mockReturnValue({
        project: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockRejectedValue(new Error('query failed')),
      })

      await expect(service.findDocuments('users')).rejects.toThrow()
      expect(mockClient.close).toHaveBeenCalled()
    })
  })

  // ── BSON serialization ──

  describe('BSON serialization', () => {
    it('serializes Long values to numbers', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), count: { _bsontype: 'Long', toNumber: () => 9999 } },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].count).toBe(9999)
    })

    it('serializes Decimal128 values to numbers', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), price: { _bsontype: 'Decimal128', toString: () => '19.99' } },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].price).toBe(19.99)
    })

    it('serializes Binary values to base64 strings', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), data: { _bsontype: 'Binary', toString: (enc) => enc === 'base64' ? 'AQID' : 'other' } },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].data).toBe('AQID')
    })

    it('serializes unknown BSON types via toString', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), ts: { _bsontype: 'Timestamp', toString: () => 'Timestamp(1, 1)' } },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].ts).toBe('Timestamp(1, 1)')
    })

    it('handles null and undefined values', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), a: null, b: undefined },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].a).toBeNull()
      expect(result.documents[0].b).toBeUndefined()
    })

    it('serializes nested arrays', async () => {
      mockFindCursor.toArray.mockResolvedValue([
        { _id: mockObjectId('aaa'), tags: ['a', 'b'] },
      ])

      const result = await service.findDocuments('users')

      expect(result.documents[0].tags).toEqual(['a', 'b'])
    })
  })
})
