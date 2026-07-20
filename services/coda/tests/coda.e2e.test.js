'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * E2E tests for the Coda service (real HTTP against https://coda.io/apis/v1).
 *
 * Required e2e-config.json entry for "coda":
 *   configs:
 *     apiToken   - a real Coda API token (Account Settings → API Settings → Generate API token)
 *   testValues:
 *     docId      - the ID of an existing doc the token can access (used for read tests)
 *     tableId    - the ID of a table inside docId (used for row/column read tests)
 *
 * Prerequisites the developer must set up in Coda before running:
 *   1. Generate an API token.
 *   2. Create (or pick) a doc and copy its ID into testValues.docId.
 *   3. Create a table in that doc with at least one column and one row, and copy
 *      its table ID into testValues.tableId.
 *   4. The token must have edit access to the doc (the write lifecycle test creates
 *      and deletes a page in docId).
 */
describe('Coda Service (e2e)', () => {
  let sandbox
  let service
  let docId
  let tableId

  beforeAll(() => {
    sandbox = createE2ESandbox('coda')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    const testValues = sandbox.getTestValues()
    docId = testValues.docId
    tableId = testValues.tableId

    if (!docId) {
      console.log('Missing testValues.docId in e2e-config.json for coda')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Docs ──

  describe('listDocs', () => {
    it('returns docs with expected shape', async () => {
      const result = await service.listDocs(undefined, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDoc', () => {
    it('returns metadata for the test doc', async () => {
      const result = await service.getDoc(docId)

      expect(result).toHaveProperty('id', docId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('type', 'doc')
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('returns tables with expected shape', async () => {
      const result = await service.listTables(docId, 'Tables', 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTable', () => {
    it('returns table metadata when tableId is provided', async () => {
      if (!tableId) {
        console.log('Skipping getTable: no testValues.tableId provided')
        return
      }

      const result = await service.getTable(docId, tableId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('type', 'table')
    })
  })

  // ── Columns ──

  describe('listColumns', () => {
    it('returns columns with expected shape when tableId is provided', async () => {
      if (!tableId) {
        console.log('Skipping listColumns: no testValues.tableId provided')
        return
      }

      const result = await service.listColumns(docId, tableId, false, 25)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Rows ──

  describe('listRows', () => {
    it('returns normalized rows with a values object when tableId is provided', async () => {
      if (!tableId) {
        console.log('Skipping listRows: no testValues.tableId provided')
        return
      }

      const result = await service.listRows(docId, tableId, undefined, true, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('id')
        expect(result.items[0]).toHaveProperty('values')
      }
    })
  })

  // ── Pages ──

  describe('listPages', () => {
    it('returns pages with expected shape', async () => {
      const result = await service.listPages(docId, 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Formulas & Controls ──

  describe('listFormulas', () => {
    it('returns formulas with expected shape', async () => {
      const result = await service.listFormulas(docId, 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listControls', () => {
    it('returns controls with expected shape', async () => {
      const result = await service.listControls(docId, 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Write lifecycle: create a page in the test doc ──

  describe('createPage', () => {
    it('creates a page in the test doc', async () => {
      const result = await service.createPage(
        docId,
        `E2E Test Page ${ suffix }`,
        'Created by automated e2e test',
        '# Hello from e2e',
        'Markdown'
      )

      // Coda returns a requestId (and usually an id) for the async mutation.
      expect(result).toHaveProperty('requestId')
    })
  })

  // ── Dictionaries ──

  describe('getDocsDictionary', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getDocsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getTablesDictionary', () => {
    it('returns an empty list without a docId criterion', async () => {
      const result = await service.getTablesDictionary({})

      expect(result.items).toEqual([])
    })

    it('returns tables for the test doc', async () => {
      const result = await service.getTablesDictionary({ criteria: { docId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without docId/tableId criteria', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result.items).toEqual([])
    })

    it('returns columns for the test table when tableId is provided', async () => {
      if (!tableId) {
        console.log('Skipping getColumnsDictionary: no testValues.tableId provided')
        return
      }

      const result = await service.getColumnsDictionary({ criteria: { docId, tableId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
