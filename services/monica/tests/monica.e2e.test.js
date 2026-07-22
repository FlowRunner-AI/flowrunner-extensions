'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Monica Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('monica')
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

  // ── User ──

  describe('getMe', () => {
    it('returns the authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('first_name')
      expect(result.data).toHaveProperty('email')
    })
  })

  // ── Contacts ──

  describe('contact lifecycle', () => {
    let createdContactId

    it('creates a contact', async () => {
      const result = await service.createContact('E2E-Test', 'User', 'e2e-nick')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.first_name).toBe('E2E-Test')
      expect(result.data.last_name).toBe('User')

      createdContactId = result.data.id
    })

    it('retrieves the created contact', async () => {
      const result = await service.getContact(createdContactId)

      expect(result).toHaveProperty('data')
      expect(result.data.id).toBe(createdContactId)
      expect(result.data.first_name).toBe('E2E-Test')
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(
        createdContactId, 'E2E-Updated', 'User', 'e2e-updated'
      )

      expect(result).toHaveProperty('data')
      expect(result.data.first_name).toBe('E2E-Updated')
    })

    it('lists contacts', async () => {
      const result = await service.listContacts(undefined, 1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('current_page')
    })

    it('searches contacts by name', async () => {
      const result = await service.searchContacts('E2E-Updated', 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('lists contacts with sort', async () => {
      const result = await service.listContacts(undefined, 1, 5, 'Created (Newest First)')

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the created contact', async () => {
      const result = await service.deleteContact(createdContactId)

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBe(true)
    })
  })

  // ── Notes ──

  describe('note lifecycle', () => {
    let contactId
    let createdNoteId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Notes', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates a note', async () => {
      const result = await service.createNote(contactId, 'E2E test note body', true)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.body).toBe('E2E test note body')

      createdNoteId = result.data.id
    })

    it('retrieves the note', async () => {
      const result = await service.getNote(createdNoteId)

      expect(result).toHaveProperty('data')
      expect(result.data.id).toBe(createdNoteId)
      expect(result.data.body).toBe('E2E test note body')
    })

    it('updates the note', async () => {
      const result = await service.updateNote(createdNoteId, contactId, 'Updated note body', false)

      expect(result).toHaveProperty('data')
      expect(result.data.body).toBe('Updated note body')
    })

    it('lists notes', async () => {
      const result = await service.listNotes(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the note', async () => {
      const result = await service.deleteNote(createdNoteId)

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBe(true)
    })
  })

  // ── Tasks ──

  describe('task lifecycle', () => {
    let contactId
    let createdTaskId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Tasks', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates a task', async () => {
      const result = await service.createTask(contactId, 'E2E test task', 'Task description', false)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.title).toBe('E2E test task')

      createdTaskId = result.data.id
    })

    it('updates the task', async () => {
      const result = await service.updateTask(
        createdTaskId, contactId, 'Updated task', 'Updated desc', true
      )

      expect(result).toHaveProperty('data')
      expect(result.data.title).toBe('Updated task')
    })

    it('lists tasks', async () => {
      const result = await service.listTasks(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(createdTaskId)

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBe(true)
    })
  })

  // ── Activities ──

  describe('activity lifecycle', () => {
    let contactId
    let createdActivityId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Activities', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates an activity', async () => {
      const activityTypeId = testValues.activityTypeId ? Number(testValues.activityTypeId) : 1
      const result = await service.createActivity(
        activityTypeId, 'E2E lunch', 'Had lunch', '2024-06-15', [contactId]
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.summary).toBe('E2E lunch')

      createdActivityId = result.data.id
    })

    it('updates the activity', async () => {
      const activityTypeId = testValues.activityTypeId ? Number(testValues.activityTypeId) : 1
      const result = await service.updateActivity(
        createdActivityId, activityTypeId, 'E2E dinner', 'Had dinner', '2024-06-16', [contactId]
      )

      expect(result).toHaveProperty('data')
      expect(result.data.summary).toBe('E2E dinner')
    })

    it('lists activities', async () => {
      const result = await service.listActivities(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the activity', async () => {
      const result = await service.deleteActivity(createdActivityId)

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBe(true)
    })
  })

  // ── Reminders ──

  describe('createReminder', () => {
    let contactId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Reminders', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates a one-time reminder', async () => {
      const result = await service.createReminder(
        contactId, 'E2E reminder', '2025-12-01', 'One Time'
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.title).toBe('E2E reminder')
    })

    it('creates a recurring reminder', async () => {
      const result = await service.createReminder(
        contactId, 'E2E weekly reminder', '2025-12-01', 'Weekly', 2
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
    })
  })

  // ── Calls ──

  describe('createCall', () => {
    let contactId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Calls', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('creates a call log', async () => {
      const result = await service.createCall(contactId, '2024-06-15', 'E2E test call notes')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.content).toBe('E2E test call notes')
    })
  })

  // ── Tags ──

  describe('tag lifecycle', () => {
    let contactId

    beforeAll(async () => {
      const contact = await service.createContact('E2E-Tags', 'Test')

      contactId = contact.data.id
    })

    afterAll(async () => {
      await service.deleteContact(contactId)
    })

    it('lists tags', async () => {
      const result = await service.listTags(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('creates a tag', async () => {
      const result = await service.createTag('e2e-test-tag-' + Date.now())

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('name')
    })

    it('sets tags on a contact', async () => {
      const result = await service.setContactTags(contactId, ['e2e-tag-1', 'e2e-tag-2'])

      expect(result).toHaveProperty('data')
    })
  })

  // ── Journal ──

  describe('journal lifecycle', () => {
    it('creates a journal entry', async () => {
      const result = await service.createJournalEntry('E2E Journal', 'E2E journal body text')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.title).toBe('E2E Journal')
    })

    it('lists journal entries', async () => {
      const result = await service.listJournalEntries(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Dictionary ──

  describe('getContactsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getContactsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.getContactsDictionary({ search: 'nonexistent-e2e-xyz' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
