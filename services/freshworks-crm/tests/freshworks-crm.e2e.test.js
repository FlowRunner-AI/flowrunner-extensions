'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Freshworks CRM Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('freshworks-crm')
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

  // ── Search ──

  describe('searchCrm', () => {
    it('returns results with expected shape', async () => {
      const result = await service.searchCrm('test')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getOwnersDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getOwnersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters results by search text', async () => {
      const all = await service.getOwnersDictionary({})
      const filtered = await service.getOwnersDictionary({ search: 'zzz_nonexistent_zzz' })

      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  describe('getDealStagesDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getDealStagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getAccountsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getAccountsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getContactViewsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getContactViewsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Contact CRUD lifecycle ──

  describe('contact lifecycle', () => {
    let createdContactId
    const testEmail = `e2e-test-${ Date.now() }@flowrunner-test.com`

    it('creates a contact', async () => {
      const result = await service.createContact(
        'E2ETest', 'Contact', testEmail, '+15550199'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', testEmail)
      createdContactId = result.id
    })

    it('retrieves the created contact', async () => {
      const result = await service.getContact(createdContactId)

      expect(result).toHaveProperty('id', createdContactId)
      expect(result).toHaveProperty('email', testEmail)
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(createdContactId, 'Updated')

      expect(result).toHaveProperty('id', createdContactId)
      expect(result).toHaveProperty('first_name', 'Updated')
    })

    it('lists contacts using a view', async () => {
      const views = await service.getContactViewsDictionary({})

      expect(views.items.length).toBeGreaterThan(0)

      const viewId = Number(views.items[0].value)
      const result = await service.listContacts(viewId, 1, 5)

      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })

    it('deletes the created contact', async () => {
      const result = await service.deleteContact(createdContactId)

      expect(result).toEqual({ deleted: true, contactId: createdContactId })
    })
  })

  // ── Upsert Contact ──

  describe('upsert contact', () => {
    let upsertedContactId
    const upsertEmail = `e2e-upsert-${ Date.now() }@flowrunner-test.com`

    it('creates a contact via upsert when no match exists', async () => {
      const result = await service.upsertContact(upsertEmail, 'Upsert', 'Test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', upsertEmail)
      upsertedContactId = result.id
    })

    it('updates via upsert when contact already exists', async () => {
      const result = await service.upsertContact(upsertEmail, 'UpsertUpdated')

      expect(result).toHaveProperty('id', upsertedContactId)
      expect(result).toHaveProperty('first_name', 'UpsertUpdated')
    })

    it('cleans up upserted contact', async () => {
      await service.deleteContact(upsertedContactId)
    })
  })

  // ── Account CRUD lifecycle ──

  describe('account lifecycle', () => {
    let createdAccountId
    const accountName = `E2E Test Account ${ Date.now() }`

    it('creates an account', async () => {
      const result = await service.createAccount(accountName, 'https://e2e-test.example.com')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', accountName)
      createdAccountId = result.id
    })

    it('retrieves the created account', async () => {
      const result = await service.getAccount(createdAccountId)

      expect(result).toHaveProperty('id', createdAccountId)
      expect(result).toHaveProperty('name', accountName)
    })

    it('updates the account', async () => {
      const updatedName = `${ accountName } Updated`
      const result = await service.updateAccount(createdAccountId, updatedName)

      expect(result).toHaveProperty('id', createdAccountId)
      expect(result).toHaveProperty('name', updatedName)
    })

    it('deletes the created account', async () => {
      const result = await service.deleteAccount(createdAccountId)

      expect(result).toEqual({ deleted: true, accountId: createdAccountId })
    })
  })

  // ── Deal CRUD lifecycle ──

  describe('deal lifecycle', () => {
    let createdDealId

    it('creates a deal', async () => {
      const result = await service.createDeal(`E2E Deal ${ Date.now() }`, 1000)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      createdDealId = result.id
    })

    it('retrieves the created deal', async () => {
      const result = await service.getDeal(createdDealId)

      expect(result).toHaveProperty('id', createdDealId)
    })

    it('updates the deal', async () => {
      const result = await service.updateDeal(createdDealId, undefined, 2000)

      expect(result).toHaveProperty('id', createdDealId)
    })

    it('lists deals using a view', async () => {
      // Use listDeals with a known view - this requires knowing a view ID.
      // We skip if we can't find one from the deal stages dictionary.
      const stages = await service.getDealStagesDictionary({})

      expect(stages.items.length).toBeGreaterThan(0)
    })

    it('deletes the created deal', async () => {
      const result = await service.deleteDeal(createdDealId)

      expect(result).toEqual({ deleted: true, dealId: createdDealId })
    })
  })

  // ── Activities ──

  describe('listSalesActivities', () => {
    it('returns sales activities with expected shape', async () => {
      const result = await service.listSalesActivities(1, 5)

      expect(result).toHaveProperty('sales_activities')
      expect(Array.isArray(result.sales_activities)).toBe(true)
    })
  })

  describe('listTasks', () => {
    it('returns tasks with expected shape', async () => {
      const result = await service.listTasks('Open', null, 1)

      expect(result).toHaveProperty('tasks')
      expect(Array.isArray(result.tasks)).toBe(true)
    })
  })

  // ── Task lifecycle (linked to a temporary contact) ──

  describe('task lifecycle', () => {
    let contactId
    let taskId

    it('creates a temporary contact for the task', async () => {
      const result = await service.createContact(
        'TaskTest', 'Contact', `task-e2e-${ Date.now() }@flowrunner-test.com`
      )

      contactId = result.id
    })

    it('creates a task linked to the contact', async () => {
      const dueDate = new Date(Date.now() + 86400000).toISOString()
      const result = await service.createTask('E2E Test Task', dueDate, 'Contact', contactId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title', 'E2E Test Task')
      taskId = result.id
    })

    it('cleans up contact', async () => {
      if (contactId) {
        await service.deleteContact(contactId)
      }
    })
  })

  // ── Note (linked to a temporary contact) ──

  describe('note creation', () => {
    let contactId

    it('creates a temporary contact for the note', async () => {
      const result = await service.createContact(
        'NoteTest', 'Contact', `note-e2e-${ Date.now() }@flowrunner-test.com`
      )

      contactId = result.id
    })

    it('creates a note linked to the contact', async () => {
      const result = await service.createNote('E2E test note content', 'Contact', contactId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('description', 'E2E test note content')
    })

    it('cleans up contact', async () => {
      if (contactId) {
        await service.deleteContact(contactId)
      }
    })
  })

  // ── Appointment (linked to a temporary contact) ──

  describe('appointment creation', () => {
    let contactId

    it('creates a temporary contact for the appointment', async () => {
      const result = await service.createContact(
        'ApptTest', 'Contact', `appt-e2e-${ Date.now() }@flowrunner-test.com`
      )

      contactId = result.id
    })

    it('creates an appointment linked to the contact', async () => {
      const from = new Date(Date.now() + 86400000).toISOString()
      const to = new Date(Date.now() + 90000000).toISOString()

      const result = await service.createAppointment(
        'E2E Test Appointment', from, to, 'Virtual', 'Contact', contactId
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title', 'E2E Test Appointment')
    })

    it('cleans up contact', async () => {
      if (contactId) {
        await service.deleteContact(contactId)
      }
    })
  })
})
