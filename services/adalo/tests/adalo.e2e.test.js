'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Adalo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('adalo')
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

  // ── listRecords ──

  describe('listRecords', () => {
    it('returns records with expected shape', async () => {
      const result = await service.listRecords(testValues.collectionId, 0, 5)

      expect(result).toHaveProperty('records')
      expect(Array.isArray(result.records)).toBe(true)
    })

    it('respects limit parameter', async () => {
      const result = await service.listRecords(testValues.collectionId, 0, 2)

      expect(result.records.length).toBeLessThanOrEqual(2)
    })
  })

  // ── CRUD lifecycle ──

  describe('create, get, update, delete record', () => {
    let createdId

    it('creates a record', async () => {
      const result = await service.createRecord(testValues.collectionId, {
        Name: 'E2E Test Record',
        Email: 'e2e@test.com',
      })

      expect(result).toHaveProperty('id')
      createdId = result.id
    })

    it('retrieves the created record', async () => {
      const result = await service.getRecord(testValues.collectionId, createdId)

      expect(result).toHaveProperty('id', createdId)
      expect(result).toHaveProperty('Name', 'E2E Test Record')
    })

    it('updates the created record', async () => {
      const result = await service.updateRecord(testValues.collectionId, createdId, {
        Name: 'E2E Updated Record',
      })

      expect(result).toHaveProperty('id', createdId)
      expect(result).toHaveProperty('Name', 'E2E Updated Record')
    })

    it('deletes the created record', async () => {
      const result = await service.deleteRecord(testValues.collectionId, createdId)

      expect(result).toEqual({
        success: true,
        collectionId: testValues.collectionId,
        recordId: createdId,
      })
    })
  })
})
