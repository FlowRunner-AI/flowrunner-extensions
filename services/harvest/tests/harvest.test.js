'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT_ID = 'test-account-id'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.harvestapp.com/v2'

const EXPECTED_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Harvest-Account-Id': ACCOUNT_ID,
  'User-Agent': 'FlowRunner',
  'Content-Type': 'application/json',
}

describe('Harvest Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accountId', required: true, shared: false }),
          expect.objectContaining({ name: 'accessToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Time Entries ──

  describe('createTimeEntry', () => {
    it('sends POST with all fields', async () => {
      const mockResponse = { id: 1, spent_date: '2024-01-15', hours: 2.5, is_running: false }
      mock.onPost(`${BASE}/time_entries`).reply(mockResponse)

      const result = await service.createTimeEntry(100, 200, '2024-01-15', 2.5, '8:00am', '10:30am', 'Design work', 999)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(mock.history[0].body).toEqual({
        project_id: 100,
        task_id: 200,
        spent_date: '2024-01-15',
        hours: 2.5,
        started_time: '8:00am',
        ended_time: '10:30am',
        notes: 'Design work',
        user_id: 999,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/time_entries`).reply({ id: 2 })

      await service.createTimeEntry(100, 200, '2024-01-15')

      expect(mock.history[0].body).toEqual({
        project_id: 100,
        task_id: 200,
        spent_date: '2024-01-15',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/time_entries`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid project' },
      })

      await expect(service.createTimeEntry(999, 200, '2024-01-15')).rejects.toThrow('Harvest API error')
    })
  })

  describe('startTimer', () => {
    it('sends POST without hours or ended_time', async () => {
      const mockResponse = { id: 3, hours: 0.0, is_running: true }
      mock.onPost(`${BASE}/time_entries`).reply(mockResponse)

      const result = await service.startTimer(100, 200, '2024-01-15', '8:00am', 'Timer notes', 999)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toEqual({
        project_id: 100,
        task_id: 200,
        spent_date: '2024-01-15',
        started_time: '8:00am',
        notes: 'Timer notes',
        user_id: 999,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/time_entries`).reply({ id: 4 })

      await service.startTimer(100, 200, '2024-01-15')

      expect(mock.history[0].body).toEqual({
        project_id: 100,
        task_id: 200,
        spent_date: '2024-01-15',
      })
    })
  })

  describe('stopTimer', () => {
    it('sends PATCH to stop endpoint', async () => {
      const mockResponse = { id: 5, hours: 1.5, is_running: false }
      mock.onPatch(`${BASE}/time_entries/5/stop`).reply(mockResponse)

      const result = await service.stopTimer(5)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${BASE}/time_entries/5/stop`)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
    })
  })

  describe('restartTimer', () => {
    it('sends PATCH to restart endpoint', async () => {
      const mockResponse = { id: 6, hours: 1.0, is_running: true }
      mock.onPatch(`${BASE}/time_entries/6/restart`).reply(mockResponse)

      const result = await service.restartTimer(6)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/time_entries/6/restart`)
      expect(mock.history[0].method).toBe('patch')
    })
  })

  describe('getTimeEntry', () => {
    it('sends GET with correct URL', async () => {
      const mockResponse = { id: 7, spent_date: '2024-01-15', hours: 2.0 }
      mock.onGet(`${BASE}/time_entries/7`).reply(mockResponse)

      const result = await service.getTimeEntry(7)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/time_entries/7`)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
    })
  })

  describe('listTimeEntries', () => {
    it('sends GET with all filter parameters', async () => {
      const mockResponse = { time_entries: [], per_page: 100, total_pages: 1, page: 1, next_page: null }
      mock.onGet(`${BASE}/time_entries`).reply(mockResponse)

      const result = await service.listTimeEntries(10, 20, 30, true, '2024-01-01', '2024-01-31', 2, 50)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        user_id: 10,
        client_id: 20,
        project_id: 30,
        is_running: true,
        from: '2024-01-01',
        to: '2024-01-31',
        page: 2,
        per_page: 50,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/time_entries`).reply({ time_entries: [] })

      await service.listTimeEntries()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('updateTimeEntry', () => {
    it('sends PATCH with provided fields', async () => {
      const mockResponse = { id: 8, hours: 3.0, notes: 'Updated' }
      mock.onPatch(`${BASE}/time_entries/8`).reply(mockResponse)

      const result = await service.updateTimeEntry(8, 100, 200, '2024-02-01', 3.0, '9:00am', '12:00pm', 'Updated')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/time_entries/8`)
      expect(mock.history[0].body).toEqual({
        project_id: 100,
        task_id: 200,
        spent_date: '2024-02-01',
        hours: 3.0,
        started_time: '9:00am',
        ended_time: '12:00pm',
        notes: 'Updated',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPatch(`${BASE}/time_entries/8`).reply({ id: 8 })

      await service.updateTimeEntry(8)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteTimeEntry', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/time_entries/9`).reply({})

      const result = await service.deleteTimeEntry(9)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/time_entries/9`)
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends GET with filter parameters', async () => {
      const mockResponse = { projects: [{ id: 1, name: 'Test' }], per_page: 100, total_pages: 1, page: 1 }
      mock.onGet(`${BASE}/projects`).reply(mockResponse)

      const result = await service.listProjects(true, 5, 2, 50)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        client_id: 5,
        page: 2,
        per_page: 50,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/projects`).reply({ projects: [] })

      await service.listProjects()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getProject', () => {
    it('sends GET with correct URL', async () => {
      const mockResponse = { id: 10, name: 'Project X' }
      mock.onGet(`${BASE}/projects/10`).reply(mockResponse)

      const result = await service.getProject(10)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/projects/10`)
    })
  })

  describe('createProject', () => {
    it('sends POST with all fields and resolves choices', async () => {
      const mockResponse = { id: 11, name: 'New Project' }
      mock.onPost(`${BASE}/projects`).reply(mockResponse)

      const result = await service.createProject(5, 'New Project', true, 'None', 'Hours Per Project', 100, 75, false, 'Notes')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].body).toEqual({
        client_id: 5,
        name: 'New Project',
        is_billable: true,
        bill_by: 'none',
        budget_by: 'project',
        budget: 100,
        hourly_rate: 75,
        is_fixed_fee: false,
        notes: 'Notes',
      })
    })

    it('resolves all budgetBy choices correctly', async () => {
      const budgetByMappings = {
        'Hours Per Project': 'project',
        'Total Project Fees': 'project_cost',
        'Hours Per Task': 'task',
        'Fees Per Task': 'task_fees',
        'Hours Per Person': 'person',
        'No Budget': 'none',
      }

      for (const [input, expected] of Object.entries(budgetByMappings)) {
        mock.reset()
        mock.onPost(`${BASE}/projects`).reply({ id: 1 })

        await service.createProject(1, 'Test', true, 'Project', input)

        expect(mock.history[0].body.budget_by).toBe(expected)
      }
    })

    it('resolves billBy choices correctly', async () => {
      mock.onPost(`${BASE}/projects`).reply({ id: 1 })

      await service.createProject(1, 'Test', true, 'Project', 'No Budget')

      expect(mock.history[0].body.bill_by).toBe('Project')
    })

    it('resolves billBy "None" to "none"', async () => {
      mock.onPost(`${BASE}/projects`).reply({ id: 1 })

      await service.createProject(1, 'Test', true, 'None', 'No Budget')

      expect(mock.history[0].body.bill_by).toBe('none')
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/projects`).reply({ id: 12 })

      await service.createProject(5, 'Minimal', true, 'Project', 'No Budget')

      expect(mock.history[0].body).toEqual({
        client_id: 5,
        name: 'Minimal',
        is_billable: true,
        bill_by: 'Project',
        budget_by: 'none',
      })
    })
  })

  describe('updateProject', () => {
    it('sends PATCH with provided fields', async () => {
      const mockResponse = { id: 13, name: 'Updated' }
      mock.onPatch(`${BASE}/projects/13`).reply(mockResponse)

      const result = await service.updateProject(13, 'Updated', true, true, 'Tasks', 200, 100, 'New notes')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/projects/13`)
      expect(mock.history[0].body).toEqual({
        name: 'Updated',
        is_active: true,
        is_billable: true,
        bill_by: 'Tasks',
        budget: 200,
        hourly_rate: 100,
        notes: 'New notes',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPatch(`${BASE}/projects/13`).reply({ id: 13 })

      await service.updateProject(13)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/projects/14`).reply({})

      const result = await service.deleteProject(14)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/projects/14`)
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('sends GET with filter parameters', async () => {
      const mockResponse = { clients: [{ id: 1, name: 'Client A' }], per_page: 100, page: 1 }
      mock.onGet(`${BASE}/clients`).reply(mockResponse)

      const result = await service.listClients(true, 3, 25)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        page: 3,
        per_page: 25,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/clients`).reply({ clients: [] })

      await service.listClients()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getClient', () => {
    it('sends GET with correct URL', async () => {
      const mockResponse = { id: 20, name: 'Acme Corp' }
      mock.onGet(`${BASE}/clients/20`).reply(mockResponse)

      const result = await service.getClient(20)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/clients/20`)
    })
  })

  describe('createClient', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/clients`).reply({ id: 21, name: 'New Client' })

      const result = await service.createClient('New Client', 'EUR', true, '123 Main St')

      expect(result).toEqual({ id: 21, name: 'New Client' })
      expect(mock.history[0].body).toEqual({
        name: 'New Client',
        currency: 'EUR',
        is_active: true,
        address: '123 Main St',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/clients`).reply({ id: 22 })

      await service.createClient('Minimal Client')

      expect(mock.history[0].body).toEqual({
        name: 'Minimal Client',
      })
    })
  })

  describe('updateClient', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/clients/23`).reply({ id: 23, name: 'Updated Client' })

      const result = await service.updateClient(23, 'Updated Client', 'USD', false, '456 Oak Ave')

      expect(result).toEqual({ id: 23, name: 'Updated Client' })
      expect(mock.history[0].url).toBe(`${BASE}/clients/23`)
      expect(mock.history[0].body).toEqual({
        name: 'Updated Client',
        currency: 'USD',
        is_active: false,
        address: '456 Oak Ave',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPatch(`${BASE}/clients/23`).reply({ id: 23 })

      await service.updateClient(23)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteClient', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/clients/24`).reply({})

      const result = await service.deleteClient(24)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends GET with filter parameters', async () => {
      mock.onGet(`${BASE}/tasks`).reply({ tasks: [{ id: 1, name: 'Design' }], per_page: 100, page: 1 })

      const result = await service.listTasks(true, 1, 50)

      expect(result.tasks).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        page: 1,
        per_page: 50,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/tasks`).reply({ tasks: [] })

      await service.listTasks()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getTask', () => {
    it('sends GET with correct URL', async () => {
      const mockResponse = { id: 30, name: 'Development' }
      mock.onGet(`${BASE}/tasks/30`).reply(mockResponse)

      const result = await service.getTask(30)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/tasks/30`)
    })
  })

  describe('createTask', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 31, name: 'QA Testing' })

      const result = await service.createTask('QA Testing', true, 50, false)

      expect(result).toEqual({ id: 31, name: 'QA Testing' })
      expect(mock.history[0].body).toEqual({
        name: 'QA Testing',
        billable_by_default: true,
        default_hourly_rate: 50,
        is_default: false,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 32 })

      await service.createTask('Minimal Task')

      expect(mock.history[0].body).toEqual({
        name: 'Minimal Task',
      })
    })
  })

  describe('updateTask', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/tasks/33`).reply({ id: 33, name: 'Renamed Task' })

      const result = await service.updateTask(33, 'Renamed Task', true, 75, false)

      expect(result).toEqual({ id: 33, name: 'Renamed Task' })
      expect(mock.history[0].url).toBe(`${BASE}/tasks/33`)
      expect(mock.history[0].body).toEqual({
        name: 'Renamed Task',
        billable_by_default: true,
        default_hourly_rate: 75,
        is_active: false,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPatch(`${BASE}/tasks/33`).reply({ id: 33 })

      await service.updateTask(33)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/tasks/34`).reply({})

      const result = await service.deleteTask(34)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('listTaskAssignments', () => {
    it('sends GET with project ID and filter parameters', async () => {
      const mockResponse = { task_assignments: [{ id: 1, task: { id: 100, name: 'Design' } }], per_page: 100, page: 1 }
      mock.onGet(`${BASE}/projects/50/task_assignments`).reply(mockResponse)

      const result = await service.listTaskAssignments(50, true, 1, 25)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/projects/50/task_assignments`)
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        page: 1,
        per_page: 25,
      })
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('sends GET with all filter parameters and resolves state', async () => {
      const mockResponse = { invoices: [], per_page: 100, page: 1 }
      mock.onGet(`${BASE}/invoices`).reply(mockResponse)

      const result = await service.listInvoices(5, 'Draft', '2024-01-01', '2024-12-31', 1, 50)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        client_id: 5,
        state: 'draft',
        from: '2024-01-01',
        to: '2024-12-31',
        page: 1,
        per_page: 50,
      })
    })

    it('resolves all state choices correctly', async () => {
      const stateMappings = {
        Draft: 'draft',
        Open: 'open',
        Paid: 'paid',
        Closed: 'closed',
      }

      for (const [input, expected] of Object.entries(stateMappings)) {
        mock.reset()
        mock.onGet(`${BASE}/invoices`).reply({ invoices: [] })

        await service.listInvoices(undefined, input)

        expect(mock.history[0].query.state).toBe(expected)
      }
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/invoices`).reply({ invoices: [] })

      await service.listInvoices()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getInvoice', () => {
    it('sends GET with correct URL', async () => {
      const mockResponse = { id: 40, number: '1001', amount: 500 }
      mock.onGet(`${BASE}/invoices/40`).reply(mockResponse)

      const result = await service.getInvoice(40)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/invoices/40`)
    })
  })

  describe('createInvoice', () => {
    it('sends POST with all fields', async () => {
      const lineItems = [{ kind: 'Service', description: 'Design', quantity: 10, unit_price: 100 }]
      mock.onPost(`${BASE}/invoices`).reply({ id: 41, amount: 1000 })

      const result = await service.createInvoice(5, 'Q1 Invoice', lineItems, 'Payment due net 30', 'USD')

      expect(result).toEqual({ id: 41, amount: 1000 })
      expect(mock.history[0].body).toEqual({
        client_id: 5,
        subject: 'Q1 Invoice',
        line_items: lineItems,
        notes: 'Payment due net 30',
        currency: 'USD',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/invoices`).reply({ id: 42 })

      await service.createInvoice(5)

      expect(mock.history[0].body).toEqual({
        client_id: 5,
      })
    })
  })

  describe('updateInvoice', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/invoices/43`).reply({ id: 43, subject: 'Updated Subject' })

      const lineItems = [{ kind: 'Service', description: 'Updated', quantity: 5, unit_price: 50 }]
      const result = await service.updateInvoice(43, 'Updated Subject', lineItems, 'New notes', '2024-03-01', '2024-04-01')

      expect(result).toEqual({ id: 43, subject: 'Updated Subject' })
      expect(mock.history[0].url).toBe(`${BASE}/invoices/43`)
      expect(mock.history[0].body).toEqual({
        subject: 'Updated Subject',
        line_items: lineItems,
        notes: 'New notes',
        issue_date: '2024-03-01',
        due_date: '2024-04-01',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPatch(`${BASE}/invoices/43`).reply({ id: 43 })

      await service.updateInvoice(43)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteInvoice', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/invoices/44`).reply({})

      const result = await service.deleteInvoice(44)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('sendInvoice', () => {
    it('sends POST with recipients and all fields', async () => {
      mock.onPost(`${BASE}/invoices/45/messages`).reply({ id: 100, sent_by: 'Bob' })

      const result = await service.sendInvoice(
        45,
        ['client@example.com', 'billing@example.com'],
        'Invoice #1001',
        'Please pay',
        true,
        true
      )

      expect(result).toEqual({ id: 100, sent_by: 'Bob' })
      expect(mock.history[0].url).toBe(`${BASE}/invoices/45/messages`)
      expect(mock.history[0].body).toEqual({
        recipients: [
          { email: 'client@example.com' },
          { email: 'billing@example.com' },
        ],
        subject: 'Invoice #1001',
        body: 'Please pay',
        include_link_to_client_invoice: true,
        attach_pdf: true,
      })
    })

    it('handles empty recipients array', async () => {
      mock.onPost(`${BASE}/invoices/46/messages`).reply({ id: 101 })

      await service.sendInvoice(46, [])

      expect(mock.history[0].body.recipients).toEqual([])
    })

    it('handles null recipients', async () => {
      mock.onPost(`${BASE}/invoices/47/messages`).reply({ id: 102 })

      await service.sendInvoice(47, null)

      expect(mock.history[0].body.recipients).toEqual([])
    })
  })

  // ── Users & Company ──

  describe('getCurrentUser', () => {
    it('sends GET to users/me', async () => {
      const mockResponse = { id: 1, first_name: 'Kim', last_name: 'Allen', email: 'kim@example.com' }
      mock.onGet(`${BASE}/users/me`).reply(mockResponse)

      const result = await service.getCurrentUser()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/users/me`)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('listUsers', () => {
    it('sends GET with filter parameters', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [{ id: 1 }], per_page: 100, page: 1 })

      const result = await service.listUsers(true, 1, 50)

      expect(result.users).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        page: 1,
        per_page: 50,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/users`).reply({ users: [] })

      await service.listUsers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCompany', () => {
    it('sends GET to company endpoint', async () => {
      const mockResponse = { name: '123 Industries', is_active: true, wants_timestamp_timers: false }
      mock.onGet(`${BASE}/company`).reply(mockResponse)

      const result = await service.getCompany()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].url).toBe(`${BASE}/company`)
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns formatted project items', async () => {
      mock.onGet(`${BASE}/projects`).reply({
        projects: [
          { id: 100, name: 'Website Redesign', client: { name: 'Acme Corp' } },
          { id: 101, name: 'Mobile App', client: null },
        ],
        next_page: null,
      })

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([
        { label: 'Website Redesign', value: '100', note: 'Acme Corp' },
        { label: 'Mobile App', value: '101', note: undefined },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({
        is_active: true,
        page: 1,
        per_page: 100,
      })
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/projects`).reply({
        projects: [
          { id: 100, name: 'Website Redesign', client: { name: 'Acme' } },
          { id: 101, name: 'Mobile App', client: { name: 'Beta' } },
        ],
        next_page: null,
      })

      const result = await service.getProjectsDictionary({ search: 'mobile' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Mobile App')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${BASE}/projects`).reply({ projects: [], next_page: 3 })

      const result = await service.getProjectsDictionary({ cursor: '2' })

      expect(mock.history[0].query.page).toBe('2')
      expect(result.cursor).toBe('3')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/projects`).reply({ projects: [], next_page: null })

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getClientsDictionary', () => {
    it('returns formatted client items', async () => {
      mock.onGet(`${BASE}/clients`).reply({
        clients: [
          { id: 200, name: 'Acme Corp', currency: 'USD' },
          { id: 201, name: 'Beta Inc', currency: null },
        ],
        next_page: null,
      })

      const result = await service.getClientsDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Corp', value: '200', note: 'USD' },
        { label: 'Beta Inc', value: '201', note: undefined },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/clients`).reply({
        clients: [
          { id: 200, name: 'Acme Corp', currency: 'USD' },
          { id: 201, name: 'Beta Inc', currency: 'EUR' },
        ],
        next_page: null,
      })

      const result = await service.getClientsDictionary({ search: 'beta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Beta Inc')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/clients`).reply({ clients: [], next_page: null })

      const result = await service.getClientsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getTaskAssignmentsDictionary', () => {
    it('returns formatted task assignment items', async () => {
      mock.onGet(`${BASE}/projects/50/task_assignments`).reply({
        task_assignments: [
          { id: 1, task: { id: 300, name: 'Design' }, billable: true },
          { id: 2, task: { id: 301, name: 'Development' }, billable: false },
        ],
        next_page: null,
      })

      const result = await service.getTaskAssignmentsDictionary({ criteria: { project: 50 } })

      expect(result.items).toEqual([
        { label: 'Design', value: '300', note: 'Billable' },
        { label: 'Development', value: '301', note: 'Non-billable' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('returns empty items when no project criteria', async () => {
      const result = await service.getTaskAssignmentsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getTaskAssignmentsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/projects/50/task_assignments`).reply({
        task_assignments: [
          { id: 1, task: { id: 300, name: 'Design' }, billable: true },
          { id: 2, task: { id: 301, name: 'Development' }, billable: false },
        ],
        next_page: null,
      })

      const result = await service.getTaskAssignmentsDictionary({
        search: 'dev',
        criteria: { project: 50 },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Development')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${BASE}/projects/50/task_assignments`).reply({
        task_assignments: [],
        next_page: 4,
      })

      const result = await service.getTaskAssignmentsDictionary({
        cursor: '3',
        criteria: { project: 50 },
      })

      expect(mock.history[0].query.page).toBe('3')
      expect(result.cursor).toBe('4')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts message from error.body.message', async () => {
      mock.onGet(`${BASE}/users/me`).replyWithError({
        message: 'Server Error',
        body: { message: 'Rate limit exceeded' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Harvest API error: Rate limit exceeded')
    })

    it('extracts message from error.body.error', async () => {
      mock.onGet(`${BASE}/users/me`).replyWithError({
        message: 'Server Error',
        body: { error: 'Invalid token' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Harvest API error: Invalid token')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/users/me`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Harvest API error: Network timeout')
    })
  })
})
