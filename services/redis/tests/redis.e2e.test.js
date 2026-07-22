'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Redis Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  const TEST_PREFIX = `frtest:${Date.now()}:`

  beforeAll(() => {
    sandbox = createE2ESandbox('redis')
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

  afterAll(async () => {
    // Clean up all test keys
    try {
      const { keys } = await service.findKeys(`${TEST_PREFIX}*`, 1000)

      if (keys.length > 0) {
        await service.deleteKeys(keys)
      }
    } catch (e) {
      console.log('Cleanup warning:', e.message)
    }

    sandbox.cleanup()
  })

  // ── Strings ──

  describe('setValue + getValue', () => {
    it('stores and retrieves a string value', async () => {
      const key = `${TEST_PREFIX}str:1`

      const setResult = await service.setValue(key, 'hello-world')

      expect(setResult).toEqual({ key, set: true })

      const getResult = await service.getValue(key)

      expect(getResult).toEqual({ key, value: 'hello-world', exists: true })
    })

    it('stores a value with TTL', async () => {
      const key = `${TEST_PREFIX}str:ttl`

      await service.setValue(key, 'expires-soon', 300)

      const ttlResult = await service.getTtl(key)

      expect(ttlResult.exists).toBe(true)
      expect(ttlResult.hasExpiration).toBe(true)
      expect(ttlResult.ttlSeconds).toBeGreaterThan(0)
      expect(ttlResult.ttlSeconds).toBeLessThanOrEqual(300)
    })

    it('respects NX flag (only set if not exists)', async () => {
      const key = `${TEST_PREFIX}str:nx`

      const first = await service.setValue(key, 'first', undefined, true)

      expect(first.set).toBe(true)

      const second = await service.setValue(key, 'second', undefined, true)

      expect(second.set).toBe(false)

      const value = await service.getValue(key)

      expect(value.value).toBe('first')
    })

    it('stores JSON objects as strings', async () => {
      const key = `${TEST_PREFIX}str:obj`

      await service.setValue(key, { foo: 'bar', num: 42 })

      const result = await service.getValue(key)

      expect(result.value).toBe('{"foo":"bar","num":42}')
    })

    it('returns exists: false for a non-existent key', async () => {
      const result = await service.getValue(`${TEST_PREFIX}nonexistent`)

      expect(result.exists).toBe(false)
      expect(result.value).toBeNull()
    })
  })

  // ── Increment / Decrement ──

  describe('increment + decrement', () => {
    it('increments a counter', async () => {
      const key = `${TEST_PREFIX}counter:1`

      const r1 = await service.increment(key)

      expect(r1).toEqual({ key, value: 1 })

      const r2 = await service.increment(key, 5)

      expect(r2).toEqual({ key, value: 6 })
    })

    it('decrements a counter', async () => {
      const key = `${TEST_PREFIX}counter:2`

      await service.increment(key, 10)

      const result = await service.decrement(key, 3)

      expect(result).toEqual({ key, value: 7 })
    })

    it('handles fractional increment', async () => {
      const key = `${TEST_PREFIX}counter:frac`

      const result = await service.increment(key, 1.5)

      expect(result.value).toBeCloseTo(1.5)
    })
  })

  // ── Keys ──

  describe('key operations', () => {
    it('checks key existence', async () => {
      const key = `${TEST_PREFIX}exists:1`

      await service.setValue(key, 'val')

      const result = await service.keyExists([key])

      expect(result).toEqual({ existingCount: 1, checkedCount: 1, allExist: true })
    })

    it('reports missing keys correctly', async () => {
      const result = await service.keyExists([`${TEST_PREFIX}nonexistent:a`, `${TEST_PREFIX}nonexistent:b`])

      expect(result.existingCount).toBe(0)
      expect(result.allExist).toBe(false)
    })

    it('deletes keys', async () => {
      const key = `${TEST_PREFIX}del:1`

      await service.setValue(key, 'to-delete')

      const result = await service.deleteKeys([key])

      expect(result.deletedCount).toBe(1)

      const check = await service.getValue(key)

      expect(check.exists).toBe(false)
    })

    it('sets and removes expiration', async () => {
      const key = `${TEST_PREFIX}exp:1`

      await service.setValue(key, 'persistent')

      const setResult = await service.setExpiration(key, 600)

      expect(setResult.applied).toBe(true)

      const ttl = await service.getTtl(key)

      expect(ttl.hasExpiration).toBe(true)

      const removeResult = await service.removeExpiration(key)

      expect(removeResult.removed).toBe(true)

      const ttlAfter = await service.getTtl(key)

      expect(ttlAfter.hasExpiration).toBe(false)
    })

    it('finds keys by pattern', async () => {
      const k1 = `${TEST_PREFIX}find:a`
      const k2 = `${TEST_PREFIX}find:b`

      await service.setValue(k1, '1')
      await service.setValue(k2, '2')

      const result = await service.findKeys(`${TEST_PREFIX}find:*`, 100)

      expect(result.keys).toContain(k1)
      expect(result.keys).toContain(k2)
      expect(result.count).toBeGreaterThanOrEqual(2)
    })
  })

  // ── Hashes ──

  describe('hash operations', () => {
    it('sets and gets hash fields', async () => {
      const key = `${TEST_PREFIX}hash:1`

      const setResult = await service.setHashFields(key, { name: 'Ada', email: 'ada@example.com' })

      expect(setResult.addedFields).toBe(2)

      const getResult = await service.getHashField(key, 'name')

      expect(getResult).toEqual({ key, field: 'name', value: 'Ada', exists: true })
    })

    it('gets all hash fields', async () => {
      const key = `${TEST_PREFIX}hash:2`

      await service.setHashFields(key, { a: '1', b: '2' })

      const result = await service.getHash(key)

      expect(result.fields).toEqual({ a: '1', b: '2' })
      expect(result.fieldCount).toBe(2)
      expect(result.exists).toBe(true)
    })

    it('returns empty for non-existent hash', async () => {
      const result = await service.getHash(`${TEST_PREFIX}hash:missing`)

      expect(result.exists).toBe(false)
      expect(result.fieldCount).toBe(0)
    })

    it('deletes hash fields', async () => {
      const key = `${TEST_PREFIX}hash:3`

      await service.setHashFields(key, { x: '1', y: '2', z: '3' })

      const result = await service.deleteHashFields(key, ['x', 'y'])

      expect(result.deletedCount).toBe(2)

      const remaining = await service.getHash(key)

      expect(remaining.fields).toEqual({ z: '3' })
    })
  })

  // ── Lists ──

  describe('list operations', () => {
    it('pushes and pops from a list', async () => {
      const key = `${TEST_PREFIX}list:1`

      const pushResult = await service.pushToList(key, ['a', 'b', 'c'], 'Right')

      expect(pushResult.length).toBe(3)

      const popResult = await service.popFromList(key, 'Left')

      expect(popResult.values).toEqual(['a'])
      expect(popResult.poppedCount).toBe(1)
    })

    it('pushes to the left', async () => {
      const key = `${TEST_PREFIX}list:2`

      await service.pushToList(key, ['a'], 'Right')
      await service.pushToList(key, ['b'], 'Left')

      const range = await service.getListRange(key, 0, -1)

      expect(range.values[0]).toBe('b')
      expect(range.values[1]).toBe('a')
    })

    it('pops multiple elements at once', async () => {
      const key = `${TEST_PREFIX}list:3`

      await service.pushToList(key, ['1', '2', '3', '4'], 'Right')

      const result = await service.popFromList(key, 'Left', 2)

      expect(result.values).toHaveLength(2)
      expect(result.poppedCount).toBe(2)
    })

    it('returns empty when popping from non-existent list', async () => {
      const result = await service.popFromList(`${TEST_PREFIX}list:missing`, 'Left')

      expect(result.values).toEqual([])
      expect(result.poppedCount).toBe(0)
    })

    it('gets list range', async () => {
      const key = `${TEST_PREFIX}list:4`

      await service.pushToList(key, ['a', 'b', 'c', 'd'], 'Right')

      const result = await service.getListRange(key, 1, 2)

      expect(result.values).toEqual(['b', 'c'])
      expect(result.count).toBe(2)
    })

    it('gets list length', async () => {
      const key = `${TEST_PREFIX}list:5`

      await service.pushToList(key, ['x', 'y'], 'Right')

      const result = await service.listLength(key)

      expect(result.length).toBe(2)
    })
  })

  // ── Sets ──

  describe('set operations', () => {
    it('adds and retrieves set members', async () => {
      const key = `${TEST_PREFIX}set:1`

      const addResult = await service.addToSet(key, ['alpha', 'beta', 'gamma'])

      expect(addResult.addedCount).toBe(3)

      const members = await service.getSetMembers(key)

      expect(members.count).toBe(3)
      expect(members.members).toContain('alpha')
      expect(members.members).toContain('beta')
      expect(members.members).toContain('gamma')
    })

    it('ignores duplicate members', async () => {
      const key = `${TEST_PREFIX}set:2`

      await service.addToSet(key, ['a', 'b'])

      const secondAdd = await service.addToSet(key, ['b', 'c'])

      expect(secondAdd.addedCount).toBe(1)
    })

    it('removes members from a set', async () => {
      const key = `${TEST_PREFIX}set:3`

      await service.addToSet(key, ['x', 'y', 'z'])

      const result = await service.removeFromSet(key, ['x', 'y'])

      expect(result.removedCount).toBe(2)

      const remaining = await service.getSetMembers(key)

      expect(remaining.members).toEqual(['z'])
    })
  })

  // ── Sorted Sets ──

  describe('sorted set operations', () => {
    it('adds members with scores and retrieves by rank', async () => {
      const key = `${TEST_PREFIX}zset:1`

      const addResult = await service.addToSortedSet(key, [
        { score: 100, value: 'player-1' },
        { score: 85, value: 'player-2' },
        { score: 92, value: 'player-3' },
      ])

      expect(addResult.addedCount).toBe(3)

      const range = await service.getSortedRange(key, 0, -1, true)

      expect(range.count).toBe(3)
      // Ascending order by score
      expect(range.members[0].value).toBe('player-2')
      expect(range.members[0].score).toBe(85)
      expect(range.members[2].value).toBe('player-1')
      expect(range.members[2].score).toBe(100)
    })

    it('retrieves members without scores', async () => {
      const key = `${TEST_PREFIX}zset:2`

      await service.addToSortedSet(key, [
        { score: 1, value: 'a' },
        { score: 2, value: 'b' },
      ])

      const range = await service.getSortedRange(key, 0, -1, false)

      expect(range.members).toEqual(['a', 'b'])
    })

    it('retrieves members in reverse order', async () => {
      const key = `${TEST_PREFIX}zset:3`

      await service.addToSortedSet(key, [
        { score: 10, value: 'low' },
        { score: 50, value: 'mid' },
        { score: 90, value: 'high' },
      ])

      const range = await service.getSortedRange(key, 0, -1, false, true)

      expect(range.members[0]).toBe('high')
      expect(range.members[2]).toBe('low')
    })
  })

  // ── Pub/Sub ──

  describe('publishMessage', () => {
    it('publishes a message and returns receiver count', async () => {
      const result = await service.publishMessage(`${TEST_PREFIX}channel`, 'test-message')

      expect(result).toHaveProperty('channel', `${TEST_PREFIX}channel`)
      expect(result).toHaveProperty('receiverCount')
      expect(typeof result.receiverCount).toBe('number')
    })
  })

  // ── Server ──

  describe('getServerInfo', () => {
    it('returns parsed server info sections', async () => {
      const result = await service.getServerInfo()

      expect(result).toHaveProperty('server')
      expect(result.server).toHaveProperty('redis_version')
      expect(result).toHaveProperty('memory')
    })
  })

  // ── Advanced ──

  describe('executeCommand', () => {
    it('executes a raw PING command', async () => {
      const result = await service.executeCommand('PING')

      expect(result).toEqual({ result: 'PONG' })
    })

    it('executes a raw SET and GET command', async () => {
      const key = `${TEST_PREFIX}raw:1`

      await service.executeCommand('SET', [key, 'raw-value'])

      const result = await service.executeCommand('GET', [key])

      expect(result).toEqual({ result: 'raw-value' })
    })
  })
})
