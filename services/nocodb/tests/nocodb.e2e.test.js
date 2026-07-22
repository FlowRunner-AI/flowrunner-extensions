'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('NocoDB Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('nocodb')
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

  // ── Bases ──

  describe('listBases', () => {
    it('returns a list of bases', async () => {
      const result = await service.listBases()

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
    })
  })

  describe('getBase', () => {
    it('retrieves a single base by ID', async () => {
      const { baseId } = testValues

      if (!baseId) {
        console.log('Skipping getBase: testValues.baseId not set')
        return
      }

      const result = await service.getBase(baseId)

      expect(result).toHaveProperty('id', baseId)
      expect(result).toHaveProperty('title')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('returns tables for a base', async () => {
      const { baseId } = testValues

      if (!baseId) {
        console.log('Skipping listTables: testValues.baseId not set')
        return
      }

      const result = await service.listTables(baseId)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
    })
  })

  describe('getTable', () => {
    it('retrieves table metadata with columns', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping getTable: testValues.tableId not set')
        return
      }

      const result = await service.getTable(tableId)

      expect(result).toHaveProperty('id', tableId)
      expect(result).toHaveProperty('columns')
      expect(Array.isArray(result.columns)).toBe(true)
    })
  })

  // ── Views ──

  describe('listViews', () => {
    it('returns views for a table', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping listViews: testValues.tableId not set')
        return
      }

      const result = await service.listViews(tableId)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getBasesDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getBasesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getTablesDictionary', () => {
    it('returns table items for a base', async () => {
      const { baseId } = testValues

      if (!baseId) {
        console.log('Skipping getTablesDictionary: testValues.baseId not set')
        return
      }

      const result = await service.getTablesDictionary({ criteria: { baseId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns field items for a table', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping getFieldsDictionary: testValues.tableId not set')
        return
      }

      const result = await service.getFieldsDictionary({ criteria: { tableId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getViewsDictionary', () => {
    it('returns view items for a table', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping getViewsDictionary: testValues.tableId not set')
        return
      }

      const result = await service.getViewsDictionary({ criteria: { tableId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Records CRUD ──

  describe('records lifecycle (create, list, get, update, count, delete)', () => {
    const { tableId } = {}
    let createdRecordId

    beforeAll(() => {
      // Re-read testValues inside the describe block
    })

    it('creates a record', async () => {
      if (!testValues.tableId) {
        console.log('Skipping createRecords: testValues.tableId not set')
        return
      }

      const result = await service.createRecords(testValues.tableId, { Title: 'E2E Test Record' })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('Id')
      createdRecordId = result[0].Id
    })

    it('lists records from the table', async () => {
      if (!testValues.tableId) {
        console.log('Skipping listRecords: testValues.tableId not set')
        return
      }

      const result = await service.listRecords(testValues.tableId, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('list')
      expect(Array.isArray(result.list)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
    })

    it('gets a single record by ID', async () => {
      if (!testValues.tableId || !createdRecordId) {
        console.log('Skipping getRecord: tableId or createdRecordId not available')
        return
      }

      const result = await service.getRecord(testValues.tableId, createdRecordId)

      expect(result).toHaveProperty('Id', createdRecordId)
    })

    it('updates the created record', async () => {
      if (!testValues.tableId || !createdRecordId) {
        console.log('Skipping updateRecords: tableId or createdRecordId not available')
        return
      }

      const result = await service.updateRecords(testValues.tableId, {
        Id: createdRecordId,
        Title: 'E2E Test Record Updated',
      })

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('Id', createdRecordId)
    })

    it('counts records in the table', async () => {
      if (!testValues.tableId) {
        console.log('Skipping countRecords: testValues.tableId not set')
        return
      }

      const result = await service.countRecords(testValues.tableId)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
    })

    it('deletes the created record', async () => {
      if (!testValues.tableId || !createdRecordId) {
        console.log('Skipping deleteRecords: tableId or createdRecordId not available')
        return
      }

      const result = await service.deleteRecords(testValues.tableId, createdRecordId)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
