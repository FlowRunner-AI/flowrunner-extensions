'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Agile CRM Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('agile-crm')
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

  // ── Contacts CRUD ──

  describe('contact lifecycle', () => {
    let contactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        'E2ETest',
        'AgileCRM',
        `e2e-test-${ Date.now() }@flowrunner-test.com`,
        undefined,
        undefined,
        undefined,
        ['e2e-test']
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'PERSON')
      expect(result).toHaveProperty('simple')
      expect(result.simple).toHaveProperty('first_name', 'E2ETest')
      contactId = result.id
    })

    it('gets the created contact by id', async () => {
      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
      expect(result.simple).toHaveProperty('first_name', 'E2ETest')
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(contactId, undefined, undefined, undefined, undefined, undefined, 'Updated Title')

      expect(result).toHaveProperty('id')
      expect(result.simple).toHaveProperty('title', 'Updated Title')
    })

    it('deletes the contact', async () => {
      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ success: true, id: String(contactId) })
    })
  })

  // ── List Contacts ──

  describe('listContacts', () => {
    it('returns paginated list with expected shape', async () => {
      const result = await service.listContacts(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Search Contacts ──

  describe('searchContacts', () => {
    it('returns array of results', async () => {
      const result = await service.searchContacts('test', 'Person', 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Companies CRUD ──

  describe('company lifecycle', () => {
    let companyId

    it('creates a company', async () => {
      const result = await service.createCompany(
        `E2E Test Co ${ Date.now() }`,
        'https://e2e-test.example.com',
        undefined,
        ['e2e-test']
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'COMPANY')
      expect(result).toHaveProperty('simple')
      companyId = result.id
    })

    it('gets the created company by id', async () => {
      const result = await service.getCompany(companyId)

      expect(result).toHaveProperty('id', companyId)
      expect(result).toHaveProperty('simple')
    })

    it('updates the company', async () => {
      const result = await service.updateCompany(companyId, 'Updated Co Name')

      expect(result).toHaveProperty('id')
      expect(result.simple).toHaveProperty('name', 'Updated Co Name')
    })

    it('deletes the company', async () => {
      const result = await service.deleteCompany(companyId)

      expect(result).toEqual({ success: true, id: String(companyId) })
    })
  })

  // ── List Companies ──

  describe('listCompanies', () => {
    it('returns paginated list with expected shape', async () => {
      const result = await service.listCompanies(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Deals CRUD ──

  describe('deal lifecycle', () => {
    let dealId

    it('creates a deal', async () => {
      const result = await service.createDeal(`E2E Deal ${ Date.now() }`, 1000)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('expected_value')
      dealId = result.id
    })

    it('gets the created deal by id', async () => {
      const result = await service.getDeal(dealId)

      expect(result).toHaveProperty('id', dealId)
    })

    it('updates the deal', async () => {
      const result = await service.updateDeal(dealId, undefined, 2000)

      expect(result).toHaveProperty('id')
    })

    it('deletes the deal', async () => {
      const result = await service.deleteDeal(dealId)

      expect(result).toEqual({ success: true, id: String(dealId) })
    })
  })

  // ── List Deals ──

  describe('listDeals', () => {
    it('returns paginated list with expected shape', async () => {
      const result = await service.listDeals(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tasks CRUD ──

  describe('task lifecycle', () => {
    let taskId

    it('creates a task', async () => {
      const result = await service.createTask(`E2E Task ${ Date.now() }`, 'Call', 'Normal')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type')
      taskId = result.id
    })

    it('updates the task', async () => {
      const result = await service.updateTask(taskId, 'Updated Subject', undefined, undefined, undefined, true)

      expect(result).toHaveProperty('id')
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(taskId)

      expect(result).toEqual({ success: true, id: String(taskId) })
    })
  })

  // ── Pending Tasks ──

  describe('listPendingTasks', () => {
    it('returns array of pending tasks', async () => {
      const result = await service.listPendingTasks(30)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Notes ──

  describe('notes lifecycle', () => {
    let contactId

    beforeAll(async () => {
      const contact = await service.createContact('NoteTest', 'E2E', `note-test-${ Date.now() }@flowrunner-test.com`)
      contactId = contact.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates a note for a contact', async () => {
      const result = await service.createNote('E2E Test Note', 'This is a test note', [String(contactId)])

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', 'E2E Test Note')
    })

    it('lists notes for the contact', async () => {
      const result = await service.listNotesForContact(String(contactId))

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Dictionaries ──

  describe('getTracksDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getTracksDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Track')
      }
    })
  })

  describe('getMilestonesDictionary', () => {
    it('returns milestones for default track', async () => {
      const result = await service.getMilestonesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Milestone')
      }
    })
  })
})
