'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Baserow Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('baserow')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // Structure/metadata operations (databases, tables, fields) require a JWT
  // access token, so those blocks are skipped unless testValues.jwtConfigured
  // is set. Row operations use the database token and run whenever a tableId
  // is supplied.

  // ── Databases (JWT) ──

  describe('listDatabases', () => {
    it('returns an array of databases', async () => {
      if (!testValues.jwtConfigured) {
        console.log('Skipping listDatabases: set testValues.jwtConfigured=true once a JWT token is present')
        return
      }

      const result = await service.listDatabases()

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('type', 'database')
      }
    })
  })

  describe('getDatabasesDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      if (!testValues.jwtConfigured) {
        console.log('Skipping getDatabasesDictionary: JWT token required')
        return
      }

      const result = await service.getDatabasesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tables (JWT) ──

  describe('listTables + getTable', () => {
    it('lists tables for the configured database', async () => {
      if (!testValues.jwtConfigured || !testValues.databaseId) {
        console.log('Skipping listTables: set testValues.jwtConfigured=true and testValues.databaseId')
        return
      }

      const result = await service.listTables(testValues.databaseId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves the configured table', async () => {
      if (!testValues.jwtConfigured || !testValues.tableId) {
        console.log('Skipping getTable: set testValues.jwtConfigured=true and testValues.tableId')
        return
      }

      const result = await service.getTable(testValues.tableId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  describe('getTablesDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      if (!testValues.jwtConfigured || !testValues.databaseId) {
        console.log('Skipping getTablesDictionary: JWT token and databaseId required')
        return
      }

      const result = await service.getTablesDictionary({ criteria: { databaseId: testValues.databaseId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createTable', () => {
    // Creating a table is destructive-ish (it persists), so only run when the
    // developer explicitly opts in with testValues.allowCreateTable=true.
    it('creates a new table in the configured database', async () => {
      if (!testValues.jwtConfigured || !testValues.databaseId || !testValues.allowCreateTable) {
        console.log('Skipping createTable: set testValues.jwtConfigured, databaseId and allowCreateTable=true')
        return
      }

      const result = await service.createTable(testValues.databaseId, `E2E Table ${ suffix }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Fields (JWT) ──

  describe('listFields', () => {
    it('lists fields for the configured table', async () => {
      if (!testValues.jwtConfigured || !testValues.tableId) {
        console.log('Skipping listFields: set testValues.jwtConfigured=true and testValues.tableId')
        return
      }

      const result = await service.listFields(testValues.tableId)

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('type')
      }
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      if (!testValues.jwtConfigured || !testValues.tableId) {
        console.log('Skipping getFieldsDictionary: JWT token and tableId required')
        return
      }

      const result = await service.getFieldsDictionary({ criteria: { tableId: testValues.tableId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createField', () => {
    it('creates a text field in the configured table', async () => {
      if (!testValues.jwtConfigured || !testValues.tableId || !testValues.allowCreateField) {
        console.log('Skipping createField: set testValues.jwtConfigured, tableId and allowCreateField=true')
        return
      }

      const result = await service.createField(testValues.tableId, `E2E Field ${ suffix }`, 'Text')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'text')
    })
  })

  // ── Rows (database token) ──

  describe('listRows', () => {
    it('returns rows with count/next/previous/results shape', async () => {
      if (!testValues.tableId) {
        console.log('Skipping listRows: set testValues.tableId')
        return
      }

      const result = await service.listRows(testValues.tableId, 1, 5)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('next')
      expect(result).toHaveProperty('previous')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  describe('createRow + getRow + updateRow + moveRow + deleteRow', () => {
    let rowId

    it('creates a row', async () => {
      if (!testValues.tableId || !testValues.rowData) {
        console.log('Skipping createRow: set testValues.tableId and testValues.rowData (an object of field values)')
        return
      }

      const result = await service.createRow(testValues.tableId, testValues.rowData)

      expect(result).toHaveProperty('id')
      rowId = result.id
    })

    it('retrieves the created row', async () => {
      if (!rowId) {
        console.log('Skipping getRow: no row was created')
        return
      }

      const result = await service.getRow(testValues.tableId, rowId)

      expect(result).toHaveProperty('id', rowId)
    })

    it('updates the created row', async () => {
      if (!rowId) {
        console.log('Skipping updateRow: no row was created')
        return
      }

      const result = await service.updateRow(testValues.tableId, rowId, testValues.rowUpdate || testValues.rowData)

      expect(result).toHaveProperty('id', rowId)
    })

    it('moves the created row to the end', async () => {
      if (!rowId) {
        console.log('Skipping moveRow: no row was created')
        return
      }

      const result = await service.moveRow(testValues.tableId, rowId)

      expect(result).toHaveProperty('id', rowId)
    })

    it('deletes the created row', async () => {
      if (!rowId) {
        console.log('Skipping deleteRow: no row was created')
        return
      }

      const result = await service.deleteRow(testValues.tableId, rowId)

      expect(result).toEqual({
        deleted: true,
        tableId: String(testValues.tableId),
        rowId: String(rowId),
      })
    })
  })

  describe('createRows + updateRows + deleteRows (batch)', () => {
    let createdIds = []

    it('creates a batch of rows', async () => {
      if (!testValues.tableId || !testValues.rowData) {
        console.log('Skipping createRows: set testValues.tableId and testValues.rowData')
        return
      }

      const result = await service.createRows(testValues.tableId, [testValues.rowData, testValues.rowData])

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      createdIds = result.items.map(r => r.id)
    })

    it('updates the batch of rows', async () => {
      if (!createdIds.length) {
        console.log('Skipping updateRows: no rows were created')
        return
      }

      const items = createdIds.map(id => ({ id, ...(testValues.rowUpdate || testValues.rowData) }))
      const result = await service.updateRows(testValues.tableId, items)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the batch of rows', async () => {
      if (!createdIds.length) {
        console.log('Skipping deleteRows: no rows were created')
        return
      }

      const result = await service.deleteRows(testValues.tableId, createdIds)

      expect(result).toEqual({
        deleted: true,
        tableId: String(testValues.tableId),
        items: createdIds,
      })
    })
  })
})
