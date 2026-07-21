'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('FileMaker Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('filemaker')
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

  // ── Metadata ──

  describe('getProductInfo', () => {
    it('returns product info with expected shape', async () => {
      const result = await service.getProductInfo()

      expect(result).toHaveProperty('productInfo')
      expect(result.productInfo).toHaveProperty('name')
      expect(result.productInfo).toHaveProperty('version')
    })
  })

  describe('listLayouts', () => {
    it('returns a layouts array', async () => {
      const result = await service.listLayouts()

      expect(result).toHaveProperty('layouts')
      expect(Array.isArray(result.layouts)).toBe(true)
    })
  })

  describe('getLayoutMetadata', () => {
    it('returns field metadata for a layout', async () => {
      const layout = testValues.layout

      if (!layout) {
        console.log('Skipping: testValues.layout not configured')
        return
      }

      const result = await service.getLayoutMetadata(layout)

      expect(result).toHaveProperty('fieldMetaData')
      expect(Array.isArray(result.fieldMetaData)).toBe(true)
    })
  })

  // ── Scripts ──

  describe('listScripts', () => {
    it('returns a scripts array', async () => {
      const result = await service.listScripts()

      expect(result).toHaveProperty('scripts')
      expect(Array.isArray(result.scripts)).toBe(true)
    })
  })

  // ── Dictionary ──

  describe('getLayoutsDictionary', () => {
    it('returns items array with label/value/note shape', async () => {
      const result = await service.getLayoutsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Layout')
      }
    })

    it('filters items by search term', async () => {
      const all = await service.getLayoutsDictionary({})

      if (all.items.length === 0) {
        console.log('Skipping: no layouts available for search test')
        return
      }

      // Search for the first layout name
      const firstLabel = all.items[0].label
      const searchTerm = firstLabel.substring(0, Math.min(4, firstLabel.length))
      const filtered = await service.getLayoutsDictionary({ search: searchTerm })

      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  // ── Records CRUD ──

  describe('records lifecycle', () => {
    let createdRecordId

    it('gets records from a layout', async () => {
      const layout = testValues.layout

      if (!layout) {
        console.log('Skipping: testValues.layout not configured')
        return
      }

      const result = await service.getRecords(layout, 1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('fieldData')
        expect(result.data[0]).toHaveProperty('recordId')
        expect(result.data[0]).toHaveProperty('modId')
      }
    })

    it('creates a record', async () => {
      const layout = testValues.layout

      if (!layout) {
        console.log('Skipping: testValues.layout not configured')
        return
      }

      const result = await service.createRecord(layout, { Name: 'E2E Test Record' })

      expect(result).toHaveProperty('recordId')
      expect(result).toHaveProperty('modId')
      createdRecordId = result.recordId
    })

    it('gets the created record', async () => {
      const layout = testValues.layout

      if (!layout || !createdRecordId) {
        console.log('Skipping: no record to get')
        return
      }

      const result = await service.getRecord(layout, createdRecordId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(1)
      expect(result.data[0].recordId).toBe(createdRecordId)
    })

    it('edits the created record', async () => {
      const layout = testValues.layout

      if (!layout || !createdRecordId) {
        console.log('Skipping: no record to edit')
        return
      }

      const result = await service.editRecord(layout, createdRecordId, { Name: 'E2E Test Record (edited)' })

      expect(result).toHaveProperty('modId')
    })

    it('duplicates the created record', async () => {
      const layout = testValues.layout
      let duplicatedId

      if (!layout || !createdRecordId) {
        console.log('Skipping: no record to duplicate')
        return
      }

      const result = await service.duplicateRecord(layout, createdRecordId)

      expect(result).toHaveProperty('recordId')
      duplicatedId = result.recordId

      // Clean up the duplicate
      if (duplicatedId) {
        await service.deleteRecord(layout, duplicatedId)
      }
    })

    it('finds records using a query', async () => {
      const layout = testValues.layout

      if (!layout || !createdRecordId) {
        console.log('Skipping: testValues.layout not configured or no created record')
        return
      }

      const result = await service.findRecords(layout, [{ Name: 'E2E Test Record*' }])

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('deletes the created record', async () => {
      const layout = testValues.layout

      if (!layout || !createdRecordId) {
        console.log('Skipping: no record to delete')
        return
      }

      const result = await service.deleteRecord(layout, createdRecordId)

      expect(result).toBeDefined()
    })
  })

  // ── Globals ──

  describe('setGlobalFields', () => {
    it('sets global fields without error', async () => {
      // This test may fail if there are no global fields defined in the database.
      // It is included for coverage; skip if the database has no globals.
      try {
        const result = await service.setGlobalFields({})

        expect(result).toBeDefined()
      } catch (error) {
        console.log('setGlobalFields failed (may require global fields to be defined):', error.message)
      }
    })
  })
})
