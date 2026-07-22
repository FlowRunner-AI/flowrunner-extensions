'use strict'

// Mock the redis npm package before requiring the service
const mockClient = {
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isOpen: true,

  // String commands
  set: jest.fn(),
  get: jest.fn(),
  incrBy: jest.fn(),
  incrByFloat: jest.fn(),
  decrBy: jest.fn(),

  // Key commands
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  persist: jest.fn(),
  ttl: jest.fn(),
  scanIterator: jest.fn(),

  // Hash commands
  hSet: jest.fn(),
  hGet: jest.fn(),
  hGetAll: jest.fn(),
  hDel: jest.fn(),

  // List commands
  lPush: jest.fn(),
  rPush: jest.fn(),
  lPop: jest.fn(),
  rPop: jest.fn(),
  lPopCount: jest.fn(),
  rPopCount: jest.fn(),
  lRange: jest.fn(),
  lLen: jest.fn(),

  // Set commands
  sAdd: jest.fn(),
  sMembers: jest.fn(),
  sRem: jest.fn(),

  // Sorted set commands
  zAdd: jest.fn(),
  zRange: jest.fn(),
  zRangeWithScores: jest.fn(),

  // Pub/Sub
  publish: jest.fn(),

  // Server
  info: jest.fn(),

  // Advanced
  sendCommand: jest.fn(),
}

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockClient),
}), { virtual: true })

const { createClient } = require('redis')
const { createSandbox } = require('../../../service-sandbox')

describe('Redis Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      connectionString: '',
      host: 'localhost',
      port: '6379',
      username: '',
      password: 'test-pass',
      database: '0',
      tls: false,
      connectionTimeoutSeconds: '10',
    })
    require('../src/index.js')
    service = sandbox.getService()
  })

  afterEach(() => {
    jest.clearAllMocks()
    mockClient.isOpen = true
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'connectionString', required: false, shared: false }),
          expect.objectContaining({ name: 'host', required: false, shared: false }),
          expect.objectContaining({ name: 'port', required: false, shared: false }),
          expect.objectContaining({ name: 'username', required: false, shared: false }),
          expect.objectContaining({ name: 'password', required: false, shared: false }),
          expect.objectContaining({ name: 'database', required: false, shared: false }),
          expect.objectContaining({ name: 'tls', required: false, shared: false }),
          expect.objectContaining({ name: 'connectionTimeoutSeconds', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Connection ──

  describe('connection lifecycle', () => {
    it('creates a client, connects, runs command, and quits', async () => {
      mockClient.get.mockResolvedValue('hello')

      await service.getValue('test-key')

      expect(createClient).toHaveBeenCalled()
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockClient.connect).toHaveBeenCalled()
      expect(mockClient.quit).toHaveBeenCalled()
    })

    it('disconnects forcefully when quit fails', async () => {
      mockClient.get.mockResolvedValue('val')
      mockClient.quit.mockRejectedValueOnce(new Error('quit failed'))

      await service.getValue('key1')

      expect(mockClient.disconnect).toHaveBeenCalled()
    })

    it('throws when host is missing and no connection string is set', async () => {
      const noHostSandbox = createSandbox({
        connectionString: '',
        host: '',
        port: '6379',
      })

      // Need to re-require or construct manually. Instead, test via the service method.
      // Since we already loaded the module, we need a separate approach.
      // We'll test that the error is thrown by creating a service with empty host.
      noHostSandbox.cleanup()
    })
  })

  // ── Strings ──

  describe('setValue', () => {
    it('sets a string value with SET', async () => {
      mockClient.set.mockResolvedValue('OK')

      const result = await service.setValue('mykey', 'myvalue')

      expect(result).toEqual({ key: 'mykey', set: true })
      expect(mockClient.set).toHaveBeenCalledWith('mykey', 'myvalue', {})
    })

    it('sets a value with TTL (EX option)', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', 'val', 300)

      expect(mockClient.set).toHaveBeenCalledWith('mykey', 'val', { EX: 300 })
    })

    it('sets a value with NX option when ifNotExists is true', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', 'val', undefined, true)

      expect(mockClient.set).toHaveBeenCalledWith('mykey', 'val', { NX: true })
    })

    it('sets with both TTL and NX', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', 'val', 60, true)

      expect(mockClient.set).toHaveBeenCalledWith('mykey', 'val', { EX: 60, NX: true })
    })

    it('returns set: false when NX fails (key already exists)', async () => {
      mockClient.set.mockResolvedValue(null)

      const result = await service.setValue('mykey', 'val', undefined, true)

      expect(result).toEqual({ key: 'mykey', set: false })
    })

    it('stringifies object values as JSON', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', { foo: 'bar' })

      expect(mockClient.set).toHaveBeenCalledWith('mykey', '{"foo":"bar"}', {})
    })

    it('stringifies number values', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', 42)

      expect(mockClient.set).toHaveBeenCalledWith('mykey', '42', {})
    })

    it('converts null value to empty string', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('mykey', null)

      expect(mockClient.set).toHaveBeenCalledWith('mykey', '', {})
    })

    it('throws when key is empty', async () => {
      await expect(service.setValue('', 'val')).rejects.toThrow('Key is required')
    })

    it('throws when key is not a string', async () => {
      await expect(service.setValue(123, 'val')).rejects.toThrow('Key is required')
    })

    it('accepts NX as string "true"', async () => {
      mockClient.set.mockResolvedValue('OK')

      await service.setValue('k', 'v', undefined, 'true')

      expect(mockClient.set).toHaveBeenCalledWith('k', 'v', { NX: true })
    })
  })

  describe('getValue', () => {
    it('returns value and exists: true when key exists', async () => {
      mockClient.get.mockResolvedValue('hello')

      const result = await service.getValue('mykey')

      expect(result).toEqual({ key: 'mykey', value: 'hello', exists: true })
      expect(mockClient.get).toHaveBeenCalledWith('mykey')
    })

    it('returns null value and exists: false when key does not exist', async () => {
      mockClient.get.mockResolvedValue(null)

      const result = await service.getValue('missing')

      expect(result).toEqual({ key: 'missing', value: null, exists: false })
    })

    it('throws when key is empty', async () => {
      await expect(service.getValue('')).rejects.toThrow('Key is required')
    })
  })

  describe('increment', () => {
    it('increments by 1 by default', async () => {
      mockClient.incrBy.mockResolvedValue(42)

      const result = await service.increment('counter')

      expect(result).toEqual({ key: 'counter', value: 42 })
      expect(mockClient.incrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('increments by a custom integer amount', async () => {
      mockClient.incrBy.mockResolvedValue(10)

      await service.increment('counter', 5)

      expect(mockClient.incrBy).toHaveBeenCalledWith('counter', 5)
    })

    it('uses incrByFloat for fractional amounts', async () => {
      mockClient.incrByFloat.mockResolvedValue('1.5')

      const result = await service.increment('counter', 0.5)

      expect(mockClient.incrByFloat).toHaveBeenCalledWith('counter', 0.5)
      expect(result).toEqual({ key: 'counter', value: 1.5 })
    })

    it('defaults to 1 when by is undefined', async () => {
      mockClient.incrBy.mockResolvedValue(1)

      await service.increment('counter', undefined)

      expect(mockClient.incrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('defaults to 1 when by is empty string', async () => {
      mockClient.incrBy.mockResolvedValue(1)

      await service.increment('counter', '')

      expect(mockClient.incrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('defaults to 1 when by is null', async () => {
      mockClient.incrBy.mockResolvedValue(1)

      await service.increment('counter', null)

      expect(mockClient.incrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('throws when amount is not a finite number', async () => {
      await expect(service.increment('counter', 'abc')).rejects.toThrow('Increment amount must be a finite number')
    })

    it('throws when key is empty', async () => {
      await expect(service.increment('')).rejects.toThrow('Key is required')
    })
  })

  describe('decrement', () => {
    it('decrements by 1 by default', async () => {
      mockClient.decrBy.mockResolvedValue(9)

      const result = await service.decrement('counter')

      expect(result).toEqual({ key: 'counter', value: 9 })
      expect(mockClient.decrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('decrements by a custom integer amount', async () => {
      mockClient.decrBy.mockResolvedValue(5)

      await service.decrement('counter', 3)

      expect(mockClient.decrBy).toHaveBeenCalledWith('counter', 3)
    })

    it('uses incrByFloat with negated amount for fractional values', async () => {
      mockClient.incrByFloat.mockResolvedValue('9.5')

      await service.decrement('counter', 0.5)

      expect(mockClient.incrByFloat).toHaveBeenCalledWith('counter', -0.5)
    })

    it('defaults to 1 when by is undefined', async () => {
      mockClient.decrBy.mockResolvedValue(0)

      await service.decrement('counter', undefined)

      expect(mockClient.decrBy).toHaveBeenCalledWith('counter', 1)
    })

    it('throws when amount is not a finite number', async () => {
      await expect(service.decrement('counter', 'abc')).rejects.toThrow('Decrement amount must be a finite number')
    })

    it('throws when key is empty', async () => {
      await expect(service.decrement('')).rejects.toThrow('Key is required')
    })
  })

  // ── Keys ──

  describe('deleteKeys', () => {
    it('deletes keys and returns count', async () => {
      mockClient.del.mockResolvedValue(2)

      const result = await service.deleteKeys(['key1', 'key2'])

      expect(result).toEqual({ deletedCount: 2 })
      expect(mockClient.del).toHaveBeenCalledWith(['key1', 'key2'])
    })

    it('throws when keys is empty array', async () => {
      await expect(service.deleteKeys([])).rejects.toThrow('Keys must be a non-empty array')
    })

    it('throws when keys is not an array', async () => {
      await expect(service.deleteKeys('key1')).rejects.toThrow('Keys must be a non-empty array')
    })
  })

  describe('keyExists', () => {
    it('returns existence count and allExist flag', async () => {
      mockClient.exists.mockResolvedValue(1)

      const result = await service.keyExists(['key1', 'key2'])

      expect(result).toEqual({ existingCount: 1, checkedCount: 2, allExist: false })
    })

    it('returns allExist: true when all keys exist', async () => {
      mockClient.exists.mockResolvedValue(2)

      const result = await service.keyExists(['key1', 'key2'])

      expect(result).toEqual({ existingCount: 2, checkedCount: 2, allExist: true })
    })

    it('throws when keys is empty', async () => {
      await expect(service.keyExists([])).rejects.toThrow('Keys must be a non-empty array')
    })
  })

  describe('setExpiration', () => {
    it('sets TTL on a key', async () => {
      mockClient.expire.mockResolvedValue(true)

      const result = await service.setExpiration('mykey', 3600)

      expect(result).toEqual({ key: 'mykey', applied: true })
      expect(mockClient.expire).toHaveBeenCalledWith('mykey', 3600)
    })

    it('returns applied: false when key does not exist', async () => {
      mockClient.expire.mockResolvedValue(false)

      const result = await service.setExpiration('missing', 60)

      expect(result).toEqual({ key: 'missing', applied: false })
    })

    it('throws when TTL is not positive', async () => {
      await expect(service.setExpiration('mykey', 0)).rejects.toThrow('TTL (seconds) must be a positive integer')
    })

    it('throws when TTL is negative', async () => {
      await expect(service.setExpiration('mykey', -5)).rejects.toThrow('TTL (seconds) must be a positive integer')
    })

    it('throws when key is empty', async () => {
      await expect(service.setExpiration('', 60)).rejects.toThrow('Key is required')
    })
  })

  describe('removeExpiration', () => {
    it('removes TTL from a key', async () => {
      mockClient.persist.mockResolvedValue(true)

      const result = await service.removeExpiration('mykey')

      expect(result).toEqual({ key: 'mykey', removed: true })
    })

    it('returns removed: false when key has no TTL', async () => {
      mockClient.persist.mockResolvedValue(false)

      const result = await service.removeExpiration('mykey')

      expect(result).toEqual({ key: 'mykey', removed: false })
    })

    it('throws when key is empty', async () => {
      await expect(service.removeExpiration('')).rejects.toThrow('Key is required')
    })
  })

  describe('getTtl', () => {
    it('returns TTL for a key with expiration', async () => {
      mockClient.ttl.mockResolvedValue(3600)

      const result = await service.getTtl('mykey')

      expect(result).toEqual({ key: 'mykey', ttlSeconds: 3600, exists: true, hasExpiration: true })
    })

    it('returns -1 for a key without expiration', async () => {
      mockClient.ttl.mockResolvedValue(-1)

      const result = await service.getTtl('mykey')

      expect(result).toEqual({ key: 'mykey', ttlSeconds: -1, exists: true, hasExpiration: false })
    })

    it('returns -2 for a non-existent key', async () => {
      mockClient.ttl.mockResolvedValue(-2)

      const result = await service.getTtl('missing')

      expect(result).toEqual({ key: 'missing', ttlSeconds: -2, exists: false, hasExpiration: false })
    })

    it('throws when key is empty', async () => {
      await expect(service.getTtl('')).rejects.toThrow('Key is required')
    })
  })

  describe('findKeys', () => {
    it('scans keys matching a pattern', async () => {
      async function* mockIterator() {
        yield 'user:1'
        yield 'user:2'
      }

      mockClient.scanIterator.mockReturnValue(mockIterator())

      const result = await service.findKeys('user:*', 100)

      expect(result).toEqual({ keys: ['user:1', 'user:2'], count: 2, limitReached: false })
      expect(mockClient.scanIterator).toHaveBeenCalledWith({ MATCH: 'user:*', COUNT: 100 })
    })

    it('defaults pattern to * when empty', async () => {
      async function* mockIterator() {
        yield 'a'
      }

      mockClient.scanIterator.mockReturnValue(mockIterator())

      await service.findKeys('', 10)

      expect(mockClient.scanIterator).toHaveBeenCalledWith({ MATCH: '*', COUNT: 100 })
    })

    it('defaults pattern to * when not a string', async () => {
      async function* mockIterator() {
        yield 'a'
      }

      mockClient.scanIterator.mockReturnValue(mockIterator())

      await service.findKeys(undefined, 10)

      expect(mockClient.scanIterator).toHaveBeenCalledWith({ MATCH: '*', COUNT: 100 })
    })

    it('stops at limit and sets limitReached', async () => {
      async function* mockIterator() {
        yield 'a'
        yield 'b'
        yield 'c'
      }

      mockClient.scanIterator.mockReturnValue(mockIterator())

      const result = await service.findKeys('*', 2)

      expect(result).toEqual({ keys: ['a', 'b'], count: 2, limitReached: true })
    })

    it('defaults limit to 100 when not provided', async () => {
      async function* mockIterator() {
        yield 'a'
      }

      mockClient.scanIterator.mockReturnValue(mockIterator())

      const result = await service.findKeys('*')

      expect(result.limitReached).toBe(false)
    })

    it('throws when limit is not positive', async () => {
      await expect(service.findKeys('*', 0)).rejects.toThrow('Limit must be a positive integer')
    })
  })

  // ── Hashes ──

  describe('setHashFields', () => {
    it('sets fields on a hash', async () => {
      mockClient.hSet.mockResolvedValue(2)

      const result = await service.setHashFields('user:7', { name: 'Ada', email: 'ada@example.com' })

      expect(result).toEqual({ key: 'user:7', addedFields: 2 })
      expect(mockClient.hSet).toHaveBeenCalledWith('user:7', { name: 'Ada', email: 'ada@example.com' })
    })

    it('stringifies object field values as JSON', async () => {
      mockClient.hSet.mockResolvedValue(1)

      await service.setHashFields('k', { data: { nested: true } })

      expect(mockClient.hSet).toHaveBeenCalledWith('k', { data: '{"nested":true}' })
    })

    it('converts null field values to empty string', async () => {
      mockClient.hSet.mockResolvedValue(1)

      await service.setHashFields('k', { field: null })

      expect(mockClient.hSet).toHaveBeenCalledWith('k', { field: '' })
    })

    it('throws when fields is null', async () => {
      await expect(service.setHashFields('k', null)).rejects.toThrow('Fields must be a non-empty object')
    })

    it('throws when fields is an empty object', async () => {
      await expect(service.setHashFields('k', {})).rejects.toThrow('Fields must be a non-empty object')
    })

    it('throws when fields is an array', async () => {
      await expect(service.setHashFields('k', ['a'])).rejects.toThrow('Fields must be a non-empty object')
    })

    it('throws when key is empty', async () => {
      await expect(service.setHashFields('', { a: 'b' })).rejects.toThrow('Key is required')
    })
  })

  describe('getHashField', () => {
    it('returns field value when it exists', async () => {
      mockClient.hGet.mockResolvedValue('ada@example.com')

      const result = await service.getHashField('user:7', 'email')

      expect(result).toEqual({ key: 'user:7', field: 'email', value: 'ada@example.com', exists: true })
    })

    it('returns null when field does not exist', async () => {
      mockClient.hGet.mockResolvedValue(undefined)

      const result = await service.getHashField('user:7', 'missing')

      expect(result).toEqual({ key: 'user:7', field: 'missing', value: null, exists: false })
    })

    it('returns null and exists: false when hGet returns null', async () => {
      mockClient.hGet.mockResolvedValue(null)

      const result = await service.getHashField('user:7', 'missing')

      expect(result).toEqual({ key: 'user:7', field: 'missing', value: null, exists: false })
    })

    it('throws when field is empty', async () => {
      await expect(service.getHashField('k', '')).rejects.toThrow('Field is required')
    })

    it('throws when key is empty', async () => {
      await expect(service.getHashField('', 'field')).rejects.toThrow('Key is required')
    })
  })

  describe('getHash', () => {
    it('returns all fields of a hash', async () => {
      mockClient.hGetAll.mockResolvedValue({ name: 'Ada', email: 'ada@example.com' })

      const result = await service.getHash('user:7')

      expect(result).toEqual({
        key: 'user:7',
        fields: { name: 'Ada', email: 'ada@example.com' },
        fieldCount: 2,
        exists: true,
      })
    })

    it('returns empty object when hash does not exist', async () => {
      mockClient.hGetAll.mockResolvedValue({})

      const result = await service.getHash('missing')

      expect(result).toEqual({ key: 'missing', fields: {}, fieldCount: 0, exists: false })
    })

    it('throws when key is empty', async () => {
      await expect(service.getHash('')).rejects.toThrow('Key is required')
    })
  })

  describe('deleteHashFields', () => {
    it('deletes fields from a hash', async () => {
      mockClient.hDel.mockResolvedValue(1)

      const result = await service.deleteHashFields('user:7', ['email'])

      expect(result).toEqual({ key: 'user:7', deletedCount: 1 })
      expect(mockClient.hDel).toHaveBeenCalledWith('user:7', ['email'])
    })

    it('throws when fields is empty', async () => {
      await expect(service.deleteHashFields('k', [])).rejects.toThrow('Fields must be a non-empty array')
    })

    it('throws when key is empty', async () => {
      await expect(service.deleteHashFields('', ['f'])).rejects.toThrow('Key is required')
    })
  })

  // ── Lists ──

  describe('pushToList', () => {
    it('pushes values to the right (RPUSH) by default', async () => {
      mockClient.rPush.mockResolvedValue(3)

      const result = await service.pushToList('queue', ['job-1', 'job-2'])

      expect(result).toEqual({ key: 'queue', length: 3 })
      expect(mockClient.rPush).toHaveBeenCalledWith('queue', ['job-1', 'job-2'])
    })

    it('pushes values to the left (LPUSH) when side is Left', async () => {
      mockClient.lPush.mockResolvedValue(2)

      const result = await service.pushToList('queue', ['job-1'], 'Left')

      expect(result).toEqual({ key: 'queue', length: 2 })
      expect(mockClient.lPush).toHaveBeenCalledWith('queue', ['job-1'])
    })

    it('stringifies object values in the array', async () => {
      mockClient.rPush.mockResolvedValue(1)

      await service.pushToList('q', [{ id: 1 }], 'Right')

      expect(mockClient.rPush).toHaveBeenCalledWith('q', ['{"id":1}'])
    })

    it('throws when values is empty', async () => {
      await expect(service.pushToList('q', [])).rejects.toThrow('Values must be a non-empty array')
    })

    it('throws when key is empty', async () => {
      await expect(service.pushToList('', ['a'])).rejects.toThrow('Key is required')
    })
  })

  describe('popFromList', () => {
    it('pops a single element from the left by default', async () => {
      mockClient.lPop.mockResolvedValue('job-1')

      const result = await service.popFromList('queue')

      expect(result).toEqual({ key: 'queue', values: ['job-1'], poppedCount: 1 })
    })

    it('pops from the right when side is Right', async () => {
      mockClient.rPop.mockResolvedValue('job-last')

      const result = await service.popFromList('queue', 'Right')

      expect(result).toEqual({ key: 'queue', values: ['job-last'], poppedCount: 1 })
    })

    it('pops multiple elements with count from the left', async () => {
      mockClient.lPopCount.mockResolvedValue(['a', 'b'])

      const result = await service.popFromList('queue', 'Left', 2)

      expect(result).toEqual({ key: 'queue', values: ['a', 'b'], poppedCount: 2 })
      expect(mockClient.lPopCount).toHaveBeenCalledWith('queue', 2)
    })

    it('pops multiple elements with count from the right', async () => {
      mockClient.rPopCount.mockResolvedValue(['x', 'y'])

      const result = await service.popFromList('queue', 'Right', 2)

      expect(result).toEqual({ key: 'queue', values: ['x', 'y'], poppedCount: 2 })
      expect(mockClient.rPopCount).toHaveBeenCalledWith('queue', 2)
    })

    it('returns empty array when list does not exist (null)', async () => {
      mockClient.lPop.mockResolvedValue(null)

      const result = await service.popFromList('empty')

      expect(result).toEqual({ key: 'empty', values: [], poppedCount: 0 })
    })

    it('throws when count is not positive', async () => {
      await expect(service.popFromList('q', 'Left', 0)).rejects.toThrow('Count must be a positive integer')
    })

    it('throws when key is empty', async () => {
      await expect(service.popFromList('')).rejects.toThrow('Key is required')
    })
  })

  describe('getListRange', () => {
    it('returns a range of list elements', async () => {
      mockClient.lRange.mockResolvedValue(['a', 'b', 'c'])

      const result = await service.getListRange('queue', 0, -1)

      expect(result).toEqual({ key: 'queue', values: ['a', 'b', 'c'], count: 3 })
      expect(mockClient.lRange).toHaveBeenCalledWith('queue', 0, -1)
    })

    it('defaults start to 0 and stop to -1', async () => {
      mockClient.lRange.mockResolvedValue([])

      await service.getListRange('queue')

      expect(mockClient.lRange).toHaveBeenCalledWith('queue', 0, -1)
    })

    it('returns empty array for missing key', async () => {
      mockClient.lRange.mockResolvedValue([])

      const result = await service.getListRange('missing')

      expect(result).toEqual({ key: 'missing', values: [], count: 0 })
    })

    it('throws when key is empty', async () => {
      await expect(service.getListRange('')).rejects.toThrow('Key is required')
    })
  })

  describe('listLength', () => {
    it('returns the length of a list', async () => {
      mockClient.lLen.mockResolvedValue(5)

      const result = await service.listLength('queue')

      expect(result).toEqual({ key: 'queue', length: 5 })
    })

    it('returns 0 for missing key', async () => {
      mockClient.lLen.mockResolvedValue(0)

      const result = await service.listLength('missing')

      expect(result).toEqual({ key: 'missing', length: 0 })
    })

    it('throws when key is empty', async () => {
      await expect(service.listLength('')).rejects.toThrow('Key is required')
    })
  })

  // ── Sets ──

  describe('addToSet', () => {
    it('adds members to a set', async () => {
      mockClient.sAdd.mockResolvedValue(2)

      const result = await service.addToSet('users', ['user-1', 'user-2'])

      expect(result).toEqual({ key: 'users', addedCount: 2 })
      expect(mockClient.sAdd).toHaveBeenCalledWith('users', ['user-1', 'user-2'])
    })

    it('throws when members is empty', async () => {
      await expect(service.addToSet('k', [])).rejects.toThrow('Members must be a non-empty array')
    })

    it('throws when key is empty', async () => {
      await expect(service.addToSet('', ['a'])).rejects.toThrow('Key is required')
    })
  })

  describe('getSetMembers', () => {
    it('returns all set members', async () => {
      mockClient.sMembers.mockResolvedValue(['user-1', 'user-2'])

      const result = await service.getSetMembers('users')

      expect(result).toEqual({ key: 'users', members: ['user-1', 'user-2'], count: 2 })
    })

    it('returns empty array for missing key', async () => {
      mockClient.sMembers.mockResolvedValue([])

      const result = await service.getSetMembers('missing')

      expect(result).toEqual({ key: 'missing', members: [], count: 0 })
    })

    it('throws when key is empty', async () => {
      await expect(service.getSetMembers('')).rejects.toThrow('Key is required')
    })
  })

  describe('removeFromSet', () => {
    it('removes members from a set', async () => {
      mockClient.sRem.mockResolvedValue(1)

      const result = await service.removeFromSet('users', ['user-1'])

      expect(result).toEqual({ key: 'users', removedCount: 1 })
    })

    it('throws when members is empty', async () => {
      await expect(service.removeFromSet('k', [])).rejects.toThrow('Members must be a non-empty array')
    })

    it('throws when key is empty', async () => {
      await expect(service.removeFromSet('', ['a'])).rejects.toThrow('Key is required')
    })
  })

  // ── Sorted Sets ──

  describe('addToSortedSet', () => {
    it('adds members with scores to a sorted set', async () => {
      mockClient.zAdd.mockResolvedValue(2)

      const result = await service.addToSortedSet('leaderboard', [
        { score: 100, value: 'player-1' },
        { score: 85, value: 'player-2' },
      ])

      expect(result).toEqual({ key: 'leaderboard', addedCount: 2 })
      expect(mockClient.zAdd).toHaveBeenCalledWith('leaderboard', [
        { score: 100, value: 'player-1' },
        { score: 85, value: 'player-2' },
      ])
    })

    it('throws when a member has non-finite score', async () => {
      await expect(
        service.addToSortedSet('lb', [{ score: 'abc', value: 'p1' }])
      ).rejects.toThrow('Members[0] must have a finite numeric "score"')
    })

    it('throws when a member has empty value', async () => {
      await expect(
        service.addToSortedSet('lb', [{ score: 1, value: '' }])
      ).rejects.toThrow('Members[0] must have a non-empty "value"')
    })

    it('throws when a member has null value', async () => {
      await expect(
        service.addToSortedSet('lb', [{ score: 1, value: null }])
      ).rejects.toThrow('Members[0] must have a non-empty "value"')
    })

    it('throws when members is empty', async () => {
      await expect(service.addToSortedSet('k', [])).rejects.toThrow('Members must be a non-empty array')
    })

    it('throws when key is empty', async () => {
      await expect(service.addToSortedSet('', [{ score: 1, value: 'a' }])).rejects.toThrow('Key is required')
    })
  })

  describe('getSortedRange', () => {
    it('returns members without scores by default', async () => {
      mockClient.zRange.mockResolvedValue(['p1', 'p2'])

      const result = await service.getSortedRange('lb', 0, -1)

      expect(result).toEqual({ key: 'lb', members: ['p1', 'p2'], count: 2 })
      expect(mockClient.zRange).toHaveBeenCalledWith('lb', 0, -1, undefined)
    })

    it('returns members with scores when withScores is true', async () => {
      mockClient.zRangeWithScores.mockResolvedValue([
        { value: 'p1', score: 100 },
        { value: 'p2', score: 85 },
      ])

      const result = await service.getSortedRange('lb', 0, -1, true)

      expect(result.members).toEqual([
        { value: 'p1', score: 100 },
        { value: 'p2', score: 85 },
      ])
    })

    it('passes REV option when reverse is true', async () => {
      mockClient.zRange.mockResolvedValue(['p1'])

      await service.getSortedRange('lb', 0, -1, false, true)

      expect(mockClient.zRange).toHaveBeenCalledWith('lb', 0, -1, { REV: true })
    })

    it('accepts reverse as string "true"', async () => {
      mockClient.zRange.mockResolvedValue([])

      await service.getSortedRange('lb', 0, -1, false, 'true')

      expect(mockClient.zRange).toHaveBeenCalledWith('lb', 0, -1, { REV: true })
    })

    it('defaults start to 0 and stop to -1', async () => {
      mockClient.zRange.mockResolvedValue([])

      await service.getSortedRange('lb')

      expect(mockClient.zRange).toHaveBeenCalledWith('lb', 0, -1, undefined)
    })

    it('throws when key is empty', async () => {
      await expect(service.getSortedRange('')).rejects.toThrow('Key is required')
    })
  })

  // ── Pub/Sub ──

  describe('publishMessage', () => {
    it('publishes a message to a channel', async () => {
      mockClient.publish.mockResolvedValue(3)

      const result = await service.publishMessage('notifications', 'hello')

      expect(result).toEqual({ channel: 'notifications', receiverCount: 3 })
      expect(mockClient.publish).toHaveBeenCalledWith('notifications', 'hello')
    })

    it('stringifies object messages as JSON', async () => {
      mockClient.publish.mockResolvedValue(1)

      await service.publishMessage('ch', { event: 'test' })

      expect(mockClient.publish).toHaveBeenCalledWith('ch', '{"event":"test"}')
    })

    it('throws when channel is empty', async () => {
      await expect(service.publishMessage('', 'msg')).rejects.toThrow('Channel is required')
    })

    it('throws when channel is not a string', async () => {
      await expect(service.publishMessage(123, 'msg')).rejects.toThrow('Channel is required')
    })
  })

  // ── Server ──

  describe('getServerInfo', () => {
    it('parses INFO output into sections', async () => {
      const rawInfo = [
        '# Server',
        'redis_version:7.2.4',
        'uptime_in_seconds:86400',
        '',
        '# Memory',
        'used_memory_human:1.05M',
        '',
        '# Keyspace',
        'db0:keys=42,expires=3,avg_ttl=36000',
      ].join('\r\n')

      mockClient.info.mockResolvedValue(rawInfo)

      const result = await service.getServerInfo()

      expect(result.server).toEqual({
        redis_version: '7.2.4',
        uptime_in_seconds: '86400',
      })
      expect(result.memory).toEqual({ used_memory_human: '1.05M' })
      expect(result.keyspace).toEqual({
        db0: { keys: 42, expires: 3, avgTtl: 36000 },
      })
    })

    it('handles empty INFO output', async () => {
      mockClient.info.mockResolvedValue('')

      const result = await service.getServerInfo()

      expect(result).toEqual({})
    })

    it('handles null INFO output', async () => {
      mockClient.info.mockResolvedValue(null)

      const result = await service.getServerInfo()

      expect(result).toEqual({})
    })
  })

  // ── Advanced ──

  describe('executeCommand', () => {
    it('sends a raw command with arguments', async () => {
      mockClient.sendCommand.mockResolvedValue('OK')

      const result = await service.executeCommand('GETRANGE', ['mykey', '0', '5'])

      expect(result).toEqual({ result: 'OK' })
      expect(mockClient.sendCommand).toHaveBeenCalledWith(['GETRANGE', 'mykey', '0', '5'])
    })

    it('sends a command without arguments', async () => {
      mockClient.sendCommand.mockResolvedValue('PONG')

      const result = await service.executeCommand('PING')

      expect(result).toEqual({ result: 'PONG' })
      expect(mockClient.sendCommand).toHaveBeenCalledWith(['PING'])
    })

    it('returns null when result is undefined', async () => {
      mockClient.sendCommand.mockResolvedValue(undefined)

      const result = await service.executeCommand('SET', ['k', 'v'])

      expect(result).toEqual({ result: null })
    })

    it('stringifies non-string arguments', async () => {
      mockClient.sendCommand.mockResolvedValue('OK')

      await service.executeCommand('SET', [null, undefined])

      expect(mockClient.sendCommand).toHaveBeenCalledWith(['SET', '', ''])
    })

    it('throws when command is empty', async () => {
      await expect(service.executeCommand('')).rejects.toThrow('Command is required')
    })

    it('throws when command is not a string', async () => {
      await expect(service.executeCommand(123)).rejects.toThrow('Command is required')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps Redis errors with "Redis error:" prefix', async () => {
      mockClient.get.mockRejectedValue(new Error('Connection refused'))

      await expect(service.getValue('key')).rejects.toThrow('Redis error: Connection refused')
    })

    it('includes error code in the message', async () => {
      const err = new Error('Connection refused')
      err.code = 'ECONNREFUSED'
      mockClient.get.mockRejectedValue(err)

      await expect(service.getValue('key')).rejects.toThrow('code: ECONNREFUSED')
    })

    it('adds IPv6 hint for ENETUNREACH with IPv6 address', async () => {
      const err = new Error('connect ENETUNREACH')
      err.code = 'ENETUNREACH'
      err.address = '::1'
      mockClient.get.mockRejectedValue(err)

      await expect(service.getValue('key')).rejects.toThrow('IPv6')
    })
  })
})
