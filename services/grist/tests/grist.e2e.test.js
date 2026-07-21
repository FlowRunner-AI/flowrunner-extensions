'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Grist Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let docId

  beforeAll(() => {
    sandbox = createE2ESandbox('grist')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
    docId = testValues.docId

    if (!docId) {
      console.log('Missing testValues.docId in e2e-config.json for grist')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish table id so repeated e2e runs don't collide. Grist table ids
  // must be identifier-safe (no spaces), so use underscores.
  const tableId = `E2E_Test_${ Date.now() }`

  // ── Documents & Workspaces ──

  describe('listWorkspaces', () => {
    it('returns an array of workspaces', async () => {
      const result = await service.listWorkspaces(testValues.orgId || 'current')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('listDocuments', () => {
    it('returns a flattened array of documents', async () => {
      const result = await service.listDocuments(testValues.orgId || 'current')

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('workspace')
      }
    })
  })

  describe('getDocument', () => {
    it('returns metadata for the test document', async () => {
      const result = await service.getDocument(docId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Dictionaries ──

  describe('getDocsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDocsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTablesDictionary', () => {
    it('returns dictionary items array for the test document', async () => {
      const result = await service.getTablesDictionary({ criteria: { docId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Full lifecycle: table -> columns -> records -> SQL ──

  describe('table + columns + records lifecycle', () => {
    it('creates a table with an initial column', async () => {
      const result = await service.createTable(docId, tableId, [
        { id: 'Name', fields: { label: 'Name', type: 'Text' } },
      ])

      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)
      expect(result.tables[0]).toHaveProperty('id', tableId)
    })

    it('lists tables and finds the created table', async () => {
      const tables = await service.listTables(docId)

      expect(Array.isArray(tables)).toBe(true)
      expect(tables.some(t => t.id === tableId)).toBe(true)
    })

    it('returns the columns dictionary for the new table', async () => {
      const result = await service.getColumnsDictionary({ criteria: { docId, tableId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('adds a column to the table', async () => {
      const result = await service.addColumns(docId, tableId, [
        { id: 'Status', fields: { label: 'Status', type: 'Text' } },
      ])

      expect(result).toHaveProperty('columns')
      expect(Array.isArray(result.columns)).toBe(true)
    })

    it('lists columns and finds both columns', async () => {
      const columns = await service.listColumns(docId, tableId)

      expect(Array.isArray(columns)).toBe(true)
      const ids = columns.map(c => c.id)
      expect(ids).toContain('Name')
      expect(ids).toContain('Status')
    })

    let createdRowId

    it('adds a record to the table', async () => {
      const result = await service.addRecords(docId, tableId, { Name: 'Alice', Status: 'Open' })

      expect(result).toHaveProperty('records')
      expect(Array.isArray(result.records)).toBe(true)
      expect(result.records[0]).toHaveProperty('id')
      createdRowId = result.records[0].id
    })

    it('lists records and finds the created record', async () => {
      const records = await service.listRecords(docId, tableId)

      expect(Array.isArray(records)).toBe(true)
      const found = records.find(r => r.id === createdRowId)
      expect(found).toBeDefined()
      expect(found.fields).toHaveProperty('Name', 'Alice')
    })

    it('filters records with an exact-match filter', async () => {
      const records = await service.listRecords(docId, tableId, { Status: ['Open'] }, undefined, 10)

      expect(Array.isArray(records)).toBe(true)
      expect(records.every(r => r.fields.Status === 'Open')).toBe(true)
    })

    it('updates the record', async () => {
      const result = await service.updateRecords(docId, tableId, [
        { id: createdRowId, fields: { Status: 'Closed' } },
      ])

      expect(result).toEqual({ updated: 1 })

      const records = await service.listRecords(docId, tableId, { Status: ['Closed'] })
      expect(records.some(r => r.id === createdRowId)).toBe(true)
    })

    it('upserts a record keyed on Name', async () => {
      const result = await service.addOrUpdateRecords(docId, tableId, [
        { require: { Name: 'Alice' }, fields: { Status: 'Reopened' } },
      ])

      expect(result).toEqual({ processed: 1 })
    })

    it('queries the table with SQL', async () => {
      const records = await service.queryWithSql(docId, `SELECT Name, Status FROM ${ tableId }`)

      expect(Array.isArray(records)).toBe(true)
      if (records.length) {
        expect(records[0]).toHaveProperty('fields')
      }
    })

    it('deletes the record', async () => {
      const result = await service.deleteRecords(docId, tableId, [createdRowId])

      expect(result).toEqual({ deleted: 1 })
    })

    // Grist tables cannot be deleted via the public REST API, so the temporary
    // table is left in place. Its records are cleaned up above. If a workspace
    // is provided the developer can prune leftover E2E_Test_* tables manually.
  })

  // ── Attachments ──

  describe('listAttachments', () => {
    it('returns an array of attachment records', async () => {
      const result = await service.listAttachments(docId)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
