'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Odoo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('odoo')
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

  // ── fieldsGet ──

  describe('fieldsGet', () => {
    it('returns field metadata for res.partner', async () => {
      const result = await service.fieldsGet('res.partner')

      expect(result).toHaveProperty('name')
      expect(result.name).toHaveProperty('type')
      expect(result.name).toHaveProperty('string')
    })

    it('returns custom attributes when specified', async () => {
      const result = await service.fieldsGet('res.partner', ['string', 'type', 'help'])

      expect(result).toHaveProperty('name')
      expect(result.name).toHaveProperty('string')
    })
  })

  // ── searchCount ──

  describe('searchCount', () => {
    it('returns a number count for res.partner', async () => {
      const count = await service.searchCount('res.partner', [])

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('returns count with a domain filter', async () => {
      const count = await service.searchCount('res.partner', [['is_company', '=', true]])

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  // ── search ──

  describe('search', () => {
    it('returns an array of IDs', async () => {
      const ids = await service.search('res.partner', [], 5)

      expect(Array.isArray(ids)).toBe(true)
      ids.forEach(id => expect(typeof id).toBe('number'))
    })

    it('respects limit parameter', async () => {
      const ids = await service.search('res.partner', [], 2)

      expect(ids.length).toBeLessThanOrEqual(2)
    })
  })

  // ── searchRead ──

  describe('searchRead', () => {
    it('returns records with field values', async () => {
      const records = await service.searchRead('res.partner', [], ['name', 'email'], 3)

      expect(Array.isArray(records)).toBe(true)
      expect(records.length).toBeLessThanOrEqual(3)

      if (records.length > 0) {
        expect(records[0]).toHaveProperty('id')
        expect(records[0]).toHaveProperty('name')
      }
    })

    it('returns records with domain filter', async () => {
      const records = await service.searchRead(
        'res.partner',
        [['is_company', '=', true]],
        ['name'],
        5
      )

      expect(Array.isArray(records)).toBe(true)
    })
  })

  // ── read ──

  describe('read', () => {
    it('reads records by IDs', async () => {
      const ids = await service.search('res.partner', [], 1)

      if (ids.length === 0) {
        console.log('Skipping read: no res.partner records found')
        return
      }

      const records = await service.read('res.partner', ids, ['name', 'email'])

      expect(Array.isArray(records)).toBe(true)
      expect(records.length).toBe(1)
      expect(records[0]).toHaveProperty('id', ids[0])
      expect(records[0]).toHaveProperty('name')
    })
  })

  // ── create + update + delete lifecycle ──

  describe('create, update, and delete lifecycle', () => {
    let createdId

    it('creates a new res.partner record', async () => {
      createdId = await service.create('res.partner', {
        name: 'E2E Test Partner',
        is_company: false,
        email: 'e2e-test@flowrunner.test',
      })

      expect(typeof createdId).toBe('number')
      expect(createdId).toBeGreaterThan(0)
    })

    it('reads the created record', async () => {
      const records = await service.read('res.partner', [createdId], ['name', 'email'])

      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        id: createdId,
        name: 'E2E Test Partner',
        email: 'e2e-test@flowrunner.test',
      })
    })

    it('updates the created record', async () => {
      const result = await service.update('res.partner', [createdId], {
        name: 'E2E Test Partner Updated',
      })

      expect(result).toBe(true)

      const records = await service.read('res.partner', [createdId], ['name'])
      expect(records[0].name).toBe('E2E Test Partner Updated')
    })

    it('deletes the created record', async () => {
      const result = await service.delete('res.partner', [createdId])

      expect(result).toBe(true)
    })
  })

  // ── callMethod ──

  describe('callMethod', () => {
    it('calls name_get on res.partner', async () => {
      const ids = await service.search('res.partner', [], 1)

      if (ids.length === 0) {
        console.log('Skipping callMethod: no res.partner records found')
        return
      }

      const result = await service.callMethod('res.partner', 'name_get', [ids])

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
      expect(Array.isArray(result[0])).toBe(true)
      expect(result[0][0]).toBe(ids[0])
    })
  })
})
