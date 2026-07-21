'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const BASE = 'https://app.monicahq.com/api'

describe('Monica Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'baseUrl',
          displayName: 'Base URL',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends correct auth and content headers', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 1 } })

      await service.getMe()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [], meta: { total: 0 } })

      const result = await service.listContacts()

      expect(result).toEqual({ data: [], meta: { total: 0 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })

    it('passes custom parameters', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [], meta: {} })

      await service.listContacts('john', 2, 10, 'Created (Newest First)')

      expect(mock.history[0].query).toMatchObject({
        query: 'john',
        page: 2,
        limit: 10,
        sort: '-created_at',
      })
    })

    it('resolves all sort options correctly', async () => {
      const sortMappings = {
        'Created (Oldest First)': 'created_at',
        'Created (Newest First)': '-created_at',
        'Updated (Oldest First)': 'updated_at',
        'Updated (Newest First)': '-updated_at',
      }

      for (const [label, expected] of Object.entries(sortMappings)) {
        mock.onGet(`${ BASE }/contacts`).reply({ data: [] })
        await service.listContacts(undefined, undefined, undefined, label)
        expect(mock.history[0].query).toMatchObject({ sort: expected })
        mock.reset()
      }
    })
  })

  describe('searchContacts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [], meta: {} })

      await service.searchContacts('jane')

      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].query).toMatchObject({ query: 'jane', limit: 15 })
    })

    it('passes custom limit', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [] })

      await service.searchContacts('jane', 5)

      expect(mock.history[0].query).toMatchObject({ query: 'jane', limit: 5 })
    })
  })

  describe('getContact', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/contacts/42`).reply({ data: { id: 42, first_name: 'John' } })

      const result = await service.getContact(42)

      expect(result).toEqual({ data: { id: 42, first_name: 'John' } })
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/42`)
    })
  })

  describe('createContact', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 1, first_name: 'John' } })

      await service.createContact('John')

      expect(mock.history[0].body).toMatchObject({
        first_name: 'John',
        is_birthdate_known: false,
        is_deceased: false,
        is_deceased_date_known: false,
      })
      // Optional fields should be omitted by clean()
      expect(mock.history[0].body).not.toHaveProperty('last_name')
      expect(mock.history[0].body).not.toHaveProperty('nickname')
      expect(mock.history[0].body).not.toHaveProperty('gender_id')
      expect(mock.history[0].body).not.toHaveProperty('description')
    })

    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 1 } })

      await service.createContact('John', 'Doe', 'Johnny', 3, true, false, false, 'A friend')

      expect(mock.history[0].body).toEqual({
        first_name: 'John',
        last_name: 'Doe',
        nickname: 'Johnny',
        gender_id: 3,
        is_birthdate_known: true,
        is_deceased: false,
        is_deceased_date_known: false,
        description: 'A friend',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        message: 'Validation error',
        body: { message: 'The first name field is required.' },
      })

      await expect(service.createContact()).rejects.toThrow('Monica API error')
    })
  })

  describe('updateContact', () => {
    it('sends PUT to correct URL with body', async () => {
      mock.onPut(`${ BASE }/contacts/5`).reply({ data: { id: 5 } })

      await service.updateContact(5, 'Jane', 'Smith')

      expect(mock.history[0].url).toBe(`${ BASE }/contacts/5`)
      expect(mock.history[0].body).toMatchObject({
        first_name: 'Jane',
        last_name: 'Smith',
        is_birthdate_known: false,
        is_deceased: false,
        is_deceased_date_known: false,
      })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ BASE }/contacts/5`).reply({ deleted: true, id: 5 })

      const result = await service.deleteContact(5)

      expect(result).toEqual({ deleted: true, id: 5 })
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/5`)
    })
  })

  // ── Notes ──

  describe('listNotes', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/notes`).reply({ data: [], meta: {} })

      await service.listNotes()

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })

    it('passes custom page and limit', async () => {
      mock.onGet(`${ BASE }/notes`).reply({ data: [] })

      await service.listNotes(3, 10)

      expect(mock.history[0].query).toMatchObject({ page: 3, limit: 10 })
    })
  })

  describe('getNote', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/notes/7`).reply({ data: { id: 7, body: 'Test note' } })

      const result = await service.getNote(7)

      expect(result).toEqual({ data: { id: 7, body: 'Test note' } })
    })
  })

  describe('createNote', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ data: { id: 1, body: 'Hello' } })

      await service.createNote(42, 'Hello', true)

      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        body: 'Hello',
        is_favorited: 1,
      })
    })

    it('sends is_favorited as 0 when false', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ data: { id: 1 } })

      await service.createNote(42, 'Hello')

      expect(mock.history[0].body).toMatchObject({
        contact_id: 42,
        body: 'Hello',
        is_favorited: 0,
      })
    })
  })

  describe('updateNote', () => {
    it('sends PUT to correct URL with body', async () => {
      mock.onPut(`${ BASE }/notes/7`).reply({ data: { id: 7 } })

      await service.updateNote(7, 42, 'Updated body', true)

      expect(mock.history[0].url).toBe(`${ BASE }/notes/7`)
      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        body: 'Updated body',
        is_favorited: 1,
      })
    })
  })

  describe('deleteNote', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ BASE }/notes/7`).reply({ deleted: true, id: 7 })

      const result = await service.deleteNote(7)

      expect(result).toEqual({ deleted: true, id: 7 })
    })
  })

  // ── Activities ──

  describe('listActivities', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/activities`).reply({ data: [], meta: {} })

      await service.listActivities()

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })

    it('passes custom page and limit', async () => {
      mock.onGet(`${ BASE }/activities`).reply({ data: [] })

      await service.listActivities(2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 5 })
    })
  })

  describe('createActivity', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ data: { id: 1 } })

      await service.createActivity(1, 'Lunch', 'Had lunch', '2024-01-10', [42, 43])

      expect(mock.history[0].body).toEqual({
        activity_type_id: 1,
        summary: 'Lunch',
        description: 'Had lunch',
        happened_at: '2024-01-10',
        contacts: [42, 43],
      })
    })

    it('omits optional description when not provided', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ data: { id: 1 } })

      await service.createActivity(1, 'Lunch', undefined, '2024-01-10', [42])

      expect(mock.history[0].body).not.toHaveProperty('description')
      expect(mock.history[0].body).toMatchObject({
        activity_type_id: 1,
        summary: 'Lunch',
        happened_at: '2024-01-10',
        contacts: [42],
      })
    })
  })

  describe('updateActivity', () => {
    it('sends PUT to correct URL with body', async () => {
      mock.onPut(`${ BASE }/activities/10`).reply({ data: { id: 10 } })

      await service.updateActivity(10, 2, 'Dinner', 'Nice dinner', '2024-01-11', [42])

      expect(mock.history[0].url).toBe(`${ BASE }/activities/10`)
      expect(mock.history[0].body).toEqual({
        activity_type_id: 2,
        summary: 'Dinner',
        description: 'Nice dinner',
        happened_at: '2024-01-11',
        contacts: [42],
      })
    })
  })

  describe('deleteActivity', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ BASE }/activities/10`).reply({ deleted: true, id: 10 })

      const result = await service.deleteActivity(10)

      expect(result).toEqual({ deleted: true, id: 10 })
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ data: [], meta: {} })

      await service.listTasks()

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })
  })

  describe('createTask', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ data: { id: 1 } })

      await service.createTask(42, 'Buy gift', 'Birthday gift for John', true)

      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        title: 'Buy gift',
        description: 'Birthday gift for John',
        completed: 1,
      })
    })

    it('sends completed as 0 when false', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ data: { id: 1 } })

      await service.createTask(42, 'Buy gift')

      expect(mock.history[0].body).toMatchObject({
        contact_id: 42,
        title: 'Buy gift',
        completed: 0,
      })
    })
  })

  describe('updateTask', () => {
    it('sends PUT to correct URL with body', async () => {
      mock.onPut(`${ BASE }/tasks/5`).reply({ data: { id: 5 } })

      await service.updateTask(5, 42, 'Updated task', 'New desc', true)

      expect(mock.history[0].url).toBe(`${ BASE }/tasks/5`)
      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        title: 'Updated task',
        description: 'New desc',
        completed: 1,
      })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ BASE }/tasks/5`).reply({ deleted: true, id: 5 })

      const result = await service.deleteTask(5)

      expect(result).toEqual({ deleted: true, id: 5 })
    })
  })

  // ── Reminders ──

  describe('createReminder', () => {
    it('sends POST with correct body and resolves frequency type', async () => {
      mock.onPost(`${ BASE }/reminders`).reply({ data: { id: 1 } })

      await service.createReminder(42, 'Call about trip', '2024-02-01', 'Weekly', 2)

      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        title: 'Call about trip',
        next_expected_date: '2024-02-01',
        frequency_type: 'week',
        frequency_number: 2,
      })
    })

    it('resolves all frequency type options', async () => {
      const freqMappings = {
        'One Time': 'one_time',
        'Weekly': 'week',
        'Monthly': 'month',
        'Yearly': 'year',
      }

      for (const [label, expected] of Object.entries(freqMappings)) {
        mock.onPost(`${ BASE }/reminders`).reply({ data: { id: 1 } })
        await service.createReminder(1, 'Test', '2024-01-01', label)
        expect(mock.history[0].body).toMatchObject({ frequency_type: expected })
        mock.reset()
      }
    })

    it('omits frequency_number when not provided', async () => {
      mock.onPost(`${ BASE }/reminders`).reply({ data: { id: 1 } })

      await service.createReminder(42, 'Birthday', '2024-06-15', 'One Time')

      expect(mock.history[0].body).not.toHaveProperty('frequency_number')
    })
  })

  // ── Calls ──

  describe('createCall', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ BASE }/calls`).reply({ data: { id: 1 } })

      await service.createCall(42, '2024-01-10', 'Discussed vacation plans')

      expect(mock.history[0].body).toEqual({
        contact_id: 42,
        called_at: '2024-01-10',
        content: 'Discussed vacation plans',
      })
    })

    it('omits content when not provided', async () => {
      mock.onPost(`${ BASE }/calls`).reply({ data: { id: 1 } })

      await service.createCall(42, '2024-01-10')

      expect(mock.history[0].body).not.toHaveProperty('content')
      expect(mock.history[0].body).toMatchObject({
        contact_id: 42,
        called_at: '2024-01-10',
      })
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ data: [], meta: {} })

      await service.listTags()

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })
  })

  describe('createTag', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ data: { id: 1, name: 'Friend' } })

      const result = await service.createTag('Friend')

      expect(mock.history[0].body).toEqual({ name: 'Friend' })
      expect(result).toEqual({ data: { id: 1, name: 'Friend' } })
    })
  })

  describe('setContactTags', () => {
    it('sends POST to correct URL with tags array', async () => {
      mock.onPost(`${ BASE }/contacts/42/setTags`).reply({ data: { id: 42, tags: [] } })

      await service.setContactTags(42, ['Friend', 'Work'])

      expect(mock.history[0].url).toBe(`${ BASE }/contacts/42/setTags`)
      expect(mock.history[0].body).toEqual({ tags: ['Friend', 'Work'] })
    })
  })

  // ── Journal ──

  describe('listJournalEntries', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/journal`).reply({ data: [], meta: {} })

      await service.listJournalEntries()

      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 15 })
    })

    it('passes custom page and limit', async () => {
      mock.onGet(`${ BASE }/journal`).reply({ data: [] })

      await service.listJournalEntries(2, 5)

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 5 })
    })
  })

  describe('createJournalEntry', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ BASE }/journal`).reply({ data: { id: 1, title: 'Great day' } })

      await service.createJournalEntry('Great day', 'Had a wonderful walk.')

      expect(mock.history[0].body).toEqual({ title: 'Great day', post: 'Had a wonderful walk.' })
    })
  })

  // ── User ──

  describe('getMe', () => {
    it('sends GET to /me', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 1, first_name: 'Jane' } })

      const result = await service.getMe()

      expect(result).toEqual({ data: { id: 1, first_name: 'Jane' } })
      expect(mock.history[0].url).toBe(`${ BASE }/me`)
    })
  })

  // ── Dictionary ──

  describe('getContactsDictionary', () => {
    it('maps contacts to dictionary items', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        data: [
          { id: 1, complete_name: 'John Doe', first_name: 'John', last_name: 'Doe', nickname: 'Johnny' },
          { id: 2, complete_name: 'Jane Roe', first_name: 'Jane', last_name: 'Roe', nickname: null },
        ],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.items).toEqual([
        { label: 'John Doe', value: '1', note: 'Johnny' },
        { label: 'Jane Roe', value: '2', note: undefined },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('passes search text to the API', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [], meta: { current_page: 1, last_page: 1 } })

      await service.getContactsDictionary({ search: 'john' })

      expect(mock.history[0].query).toMatchObject({ query: 'john' })
    })

    it('returns cursor when more pages exist', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        data: [{ id: 1, complete_name: 'John', first_name: 'John', last_name: '' }],
        meta: { current_page: 1, last_page: 3 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        data: [],
        meta: { current_page: 2, last_page: 3 },
      })

      await service.getContactsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [], meta: {} })

      const result = await service.getContactsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('falls back to first_name + last_name when complete_name is missing', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        data: [{ id: 1, first_name: 'John', last_name: 'Doe' }],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.items[0].label).toBe('John Doe')
    })

    it('falls back to Contact {id} when no name fields exist', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        data: [{ id: 99 }],
        meta: { current_page: 1, last_page: 1 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.items[0].label).toBe('Contact 99')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('includes status code in error message', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({
        message: 'Unauthenticated',
        status: 401,
        body: { message: 'Unauthenticated.' },
      })

      await expect(service.getMe()).rejects.toThrow('Monica API error [401]: Unauthenticated.')
    })

    it('includes validation errors in error message', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        message: 'Unprocessable Entity',
        status: 422,
        body: { errors: { first_name: ['The first name field is required.'] } },
      })

      await expect(service.createContact()).rejects.toThrow('Monica API error [422]')
    })

    it('handles errors without body', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({ message: 'Network Error' })

      await expect(service.getMe()).rejects.toThrow('Monica API error: Network Error')
    })
  })

  // ── Custom Base URL ──

  describe('custom base URL', () => {
    it('defaults to https://app.monicahq.com when baseUrl is not provided', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 1 } })

      await service.getMe()

      expect(mock.history[0].url).toContain('https://app.monicahq.com/api/')
    })
  })
})

describe('Monica Service (custom base URL)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: 'https://my-monica.example.com/', apiToken: 'tok' })

    jest.resetModules()
    require('../src/index.js')

    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('strips trailing slash and builds correct API URL', async () => {
    mock.onGet('https://my-monica.example.com/api/me').reply({ data: { id: 1 } })

    await service.getMe()

    expect(mock.history[0].url).toBe('https://my-monica.example.com/api/me')
  })
})
