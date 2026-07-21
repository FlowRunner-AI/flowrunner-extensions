'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ERPNext Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('erpnext')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── listDocuments ──

  describe('listDocuments', () => {
    it('returns a list of documents with data array', async () => {
      const result = await service.listDocuments('DocType', undefined, ['name'], 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('supports filters', async () => {
      const result = await service.listDocuments(
        'DocType',
        [['issingle', '=', 0]],
        ['name'],
        5,
      )

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('supports pagination with limit_start and limit_page_length', async () => {
      const result = await service.listDocuments('DocType', undefined, ['name'], 2, 0)

      expect(result).toHaveProperty('data')
      expect(result.data.length).toBeLessThanOrEqual(2)
    })
  })

  // ── getDocument ──

  describe('getDocument', () => {
    it('retrieves a single document by doctype and name', async () => {
      // Use a built-in DocType that always exists
      const result = await service.getDocument('DocType', 'User')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('name', 'User')
    })
  })

  // ── countDocuments ──

  describe('countDocuments', () => {
    it('returns a count of documents', async () => {
      const result = await service.countDocuments('DocType')

      expect(result).toHaveProperty('message')
      expect(typeof result.message).toBe('number')
    })

    it('supports filters', async () => {
      const result = await service.countDocuments('DocType', [['issingle', '=', 0]])

      expect(result).toHaveProperty('message')
      expect(typeof result.message).toBe('number')
    })
  })

  // ── getValue ──

  describe('getValue', () => {
    it('retrieves a field value from a document', async () => {
      const result = await service.getValue('DocType', 'module', [['name', '=', 'User']])

      expect(result).toHaveProperty('message')
      expect(result.message).toHaveProperty('module')
    })
  })

  // ── CRUD lifecycle: create, update, get, delete ──

  describe('document CRUD lifecycle', () => {
    let createdName

    it('creates a new ToDo document', async () => {
      const result = await service.createDocument('ToDo', {
        description: 'E2E Test ToDo - FlowRunner automated test',
        priority: 'Low',
      })

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('name')
      expect(result.data).toHaveProperty('description')
      createdName = result.data.name
    })

    it('retrieves the created document', async () => {
      expect(createdName).toBeDefined()

      const result = await service.getDocument('ToDo', createdName)

      expect(result).toHaveProperty('data')
      expect(result.data.name).toBe(createdName)
      expect(result.data.description).toContain('E2E Test ToDo')
    })

    it('updates the created document', async () => {
      expect(createdName).toBeDefined()

      const result = await service.updateDocument('ToDo', createdName, {
        priority: 'High',
      })

      expect(result).toHaveProperty('data')
      expect(result.data.priority).toBe('High')
    })

    it('deletes the created document', async () => {
      expect(createdName).toBeDefined()

      const result = await service.deleteDocument('ToDo', createdName)

      expect(result).toHaveProperty('message', 'ok')
    })
  })

  // ── runMethod ──

  describe('runMethod', () => {
    it('calls frappe.client.get_list via runMethod', async () => {
      const result = await service.runMethod('frappe.client.get_list', {
        doctype: 'DocType',
        limit_page_length: 3,
        fields: ['name'],
      })

      expect(result).toHaveProperty('message')
      expect(Array.isArray(result.message)).toBe(true)
    })
  })
})
