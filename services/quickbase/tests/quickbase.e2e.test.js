'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('QuickBase Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('quickbase')
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

  // ── Apps ──

  describe('getApp', () => {
    it('returns app metadata', async () => {
      const { appId } = testValues

      if (!appId) {
        console.log('Skipping getApp: testValues.appId not set')
        return
      }

      const result = await service.getApp(appId)

      expect(result).toHaveProperty('id', appId)
      expect(result).toHaveProperty('name')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('returns an array of tables', async () => {
      const { appId } = testValues

      if (!appId) {
        console.log('Skipping listTables: testValues.appId not set')
        return
      }

      const result = await service.listTables(appId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  describe('getTable', () => {
    it('returns table metadata', async () => {
      const { appId, tableId } = testValues

      if (!appId || !tableId) {
        console.log('Skipping getTable: testValues.appId or testValues.tableId not set')
        return
      }

      const result = await service.getTable(appId, tableId)

      expect(result).toHaveProperty('id', tableId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('keyFieldId')
    })
  })

  describe('createTable + updateTable + deleteTable', () => {
    let createdTableId

    it('creates a table', async () => {
      const { appId } = testValues

      if (!appId) {
        console.log('Skipping createTable: testValues.appId not set')
        return
      }

      const result = await service.createTable(
        appId,
        'E2E Test Table',
        'Created by e2e test',
        'Item',
        'Items'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Table')
      createdTableId = result.id
    })

    it('updates the created table', async () => {
      const { appId } = testValues

      if (!appId || !createdTableId) {
        console.log('Skipping updateTable: no table to update')
        return
      }

      const result = await service.updateTable(appId, createdTableId, 'E2E Updated Table')

      expect(result).toHaveProperty('name', 'E2E Updated Table')
    })

    it('deletes the created table', async () => {
      const { appId } = testValues

      if (!appId || !createdTableId) {
        console.log('Skipping deleteTable: no table to delete')
        return
      }

      const result = await service.deleteTable(appId, createdTableId)

      expect(result).toHaveProperty('deletedTableId', createdTableId)
    })
  })

  // ── Fields ──

  describe('listFields', () => {
    it('returns an array of fields', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping listFields: testValues.tableId not set')
        return
      }

      const result = await service.listFields(tableId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('label')
        expect(result[0]).toHaveProperty('fieldType')
      }
    })
  })

  describe('getField', () => {
    it('returns field metadata for a built-in field', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping getField: testValues.tableId not set')
        return
      }

      const result = await service.getField(tableId, 3)

      expect(result).toHaveProperty('id', 3)
      expect(result).toHaveProperty('label')
      expect(result).toHaveProperty('fieldType')
    })
  })

  describe('createField + deleteFields', () => {
    let createdFieldId

    it('creates a text field', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping createField: testValues.tableId not set')
        return
      }

      const result = await service.createField(tableId, 'E2E Test Field', 'Text')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('label', 'E2E Test Field')
      createdFieldId = result.id
    })

    it('deletes the created field', async () => {
      const { tableId } = testValues

      if (!tableId || !createdFieldId) {
        console.log('Skipping deleteFields: no field to delete')
        return
      }

      const result = await service.deleteFields(tableId, [String(createdFieldId)])

      expect(result).toHaveProperty('deletedFieldIds')
      expect(result.deletedFieldIds).toContain(createdFieldId)
    })
  })

  // ── Records ──

  describe('upsertRecords + queryRecords + deleteRecords', () => {
    let createdRecordId

    it('inserts a record', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping upsertRecords: testValues.tableId not set')
        return
      }

      const result = await service.upsertRecords(
        tableId,
        [{ '6': { value: 'E2E Test Record' } }],
        undefined,
        ['3', '6']
      )

      expect(result).toHaveProperty('metadata')
      expect(result.metadata).toHaveProperty('totalNumberOfRecordsProcessed')

      if (result.metadata.createdRecordIds?.length) {
        createdRecordId = result.metadata.createdRecordIds[0]
      }
    })

    it('queries records', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping queryRecords: testValues.tableId not set')
        return
      }

      const result = await service.queryRecords(tableId, ['3', '6'], null, null, null, 0, 5)

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('metadata')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('queries records with mapFieldLabels', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping queryRecords with fieldLabels: testValues.tableId not set')
        return
      }

      const result = await service.queryRecords(tableId, ['3'], null, null, null, 0, 1, true)

      expect(result).toHaveProperty('fieldLabels')
      expect(typeof result.fieldLabels).toBe('object')
    })

    it('deletes the created record', async () => {
      const { tableId } = testValues

      if (!tableId || !createdRecordId) {
        console.log('Skipping deleteRecords: no record to delete')
        return
      }

      const result = await service.deleteRecords(tableId, `{3.EX.'${createdRecordId}'}`)

      expect(result).toHaveProperty('numberDeleted')
      expect(result.numberDeleted).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Reports ──

  describe('listReports', () => {
    it('returns an array of reports', async () => {
      const { tableId } = testValues

      if (!tableId) {
        console.log('Skipping listReports: testValues.tableId not set')
        return
      }

      const result = await service.listReports(tableId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  describe('runReport', () => {
    it('runs a report and returns data', async () => {
      const { tableId, reportId } = testValues

      if (!tableId || !reportId) {
        console.log('Skipping runReport: testValues.tableId or testValues.reportId not set')
        return
      }

      const result = await service.runReport(tableId, reportId, 0, 5)

      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('metadata')
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns dictionary items for tables', async () => {
      const { appId } = testValues

      if (!appId) {
        console.log('Skipping getTablesDictionary: testValues.appId not set')
        return
      }

      const result = await service.getTablesDictionary({ criteria: { appId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns dictionary items for fields', async () => {
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
})
