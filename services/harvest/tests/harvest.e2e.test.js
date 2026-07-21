'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Harvest Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('harvest')
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

  // ── Users & Company ──

  describe('getCurrentUser', () => {
    it('returns the authenticated user with expected shape', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('first_name')
      expect(result).toHaveProperty('last_name')
      expect(result).toHaveProperty('email')
    })
  })

  describe('getCompany', () => {
    it('returns company settings with expected shape', async () => {
      const result = await service.getCompany()

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('is_active')
      expect(typeof result.name).toBe('string')
    })
  })

  describe('listUsers', () => {
    it('returns paginated users list', async () => {
      const result = await service.listUsers(true, 1, 10)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
      expect(result).toHaveProperty('per_page')
      expect(result).toHaveProperty('total_pages')
    })
  })

  // ── Clients CRUD ──

  describe('clients lifecycle', () => {
    let clientId

    it('creates a client', async () => {
      const result = await service.createClient('E2E Test Client', 'USD', true, '123 Test St')

      expect(result).toHaveProperty('id')
      expect(result.name).toBe('E2E Test Client')
      clientId = result.id
    })

    it('gets the created client', async () => {
      const result = await service.getClient(clientId)

      expect(result.id).toBe(clientId)
      expect(result.name).toBe('E2E Test Client')
    })

    it('lists clients and finds the created one', async () => {
      const result = await service.listClients(true, 1, 2000)

      expect(result).toHaveProperty('clients')
      expect(Array.isArray(result.clients)).toBe(true)

      const found = result.clients.find(c => c.id === clientId)
      expect(found).toBeDefined()
    })

    it('updates the client', async () => {
      const result = await service.updateClient(clientId, 'E2E Updated Client')

      expect(result.id).toBe(clientId)
      expect(result.name).toBe('E2E Updated Client')
    })

    it('deletes the client', async () => {
      const result = await service.deleteClient(clientId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Tasks CRUD ──

  describe('tasks lifecycle', () => {
    let taskId

    it('creates a task', async () => {
      const result = await service.createTask('E2E Test Task', false, 0, false)

      expect(result).toHaveProperty('id')
      expect(result.name).toBe('E2E Test Task')
      taskId = result.id
    })

    it('gets the created task', async () => {
      const result = await service.getTask(taskId)

      expect(result.id).toBe(taskId)
      expect(result.name).toBe('E2E Test Task')
    })

    it('lists tasks and finds the created one', async () => {
      const result = await service.listTasks(true, 1, 2000)

      expect(result).toHaveProperty('tasks')
      const found = result.tasks.find(t => t.id === taskId)
      expect(found).toBeDefined()
    })

    it('updates the task', async () => {
      const result = await service.updateTask(taskId, 'E2E Updated Task')

      expect(result.id).toBe(taskId)
      expect(result.name).toBe('E2E Updated Task')
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(taskId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Projects CRUD ──
  // Projects require a client, so we create one first.

  describe('projects lifecycle', () => {
    let clientId
    let projectId

    it('creates a client for the project', async () => {
      const result = await service.createClient('E2E Project Client', 'USD')

      expect(result).toHaveProperty('id')
      clientId = result.id
    })

    it('creates a project', async () => {
      const result = await service.createProject(clientId, 'E2E Test Project', true, 'Project', 'No Budget')

      expect(result).toHaveProperty('id')
      expect(result.name).toBe('E2E Test Project')
      projectId = result.id
    })

    it('gets the created project', async () => {
      const result = await service.getProject(projectId)

      expect(result.id).toBe(projectId)
      expect(result.name).toBe('E2E Test Project')
    })

    it('lists projects and finds the created one', async () => {
      const result = await service.listProjects(true, undefined, 1, 2000)

      expect(result).toHaveProperty('projects')
      const found = result.projects.find(p => p.id === projectId)
      expect(found).toBeDefined()
    })

    it('updates the project', async () => {
      const result = await service.updateProject(projectId, 'E2E Updated Project')

      expect(result.id).toBe(projectId)
      expect(result.name).toBe('E2E Updated Project')
    })

    it('lists task assignments for the project', async () => {
      const result = await service.listTaskAssignments(projectId)

      expect(result).toHaveProperty('task_assignments')
      expect(Array.isArray(result.task_assignments)).toBe(true)
    })

    it('deletes the project', async () => {
      const result = await service.deleteProject(projectId)

      expect(result).toEqual({ success: true })
    })

    it('cleans up the client', async () => {
      const result = await service.deleteClient(clientId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Time Entries CRUD ──
  // Time entries require a project with an assigned task.

  describe('time entries lifecycle', () => {
    let clientId
    let projectId
    let taskId
    let timeEntryId

    it('creates supporting resources (client + project)', async () => {
      const client = await service.createClient('E2E Time Client', 'USD')
      clientId = client.id

      const project = await service.createProject(clientId, 'E2E Time Project', true, 'Project', 'No Budget')
      projectId = project.id

      // Get the task assignments auto-created for the project
      const assignments = await service.listTaskAssignments(projectId, true, 1, 10)
      expect(assignments.task_assignments.length).toBeGreaterThan(0)
      taskId = assignments.task_assignments[0].task.id
    })

    it('creates a time entry', async () => {
      const today = new Date().toISOString().split('T')[0]
      const result = await service.createTimeEntry(projectId, taskId, today, 1.5, undefined, undefined, 'E2E test entry')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('spent_date')
      expect(result).toHaveProperty('hours')
      timeEntryId = result.id
    })

    it('gets the created time entry', async () => {
      const result = await service.getTimeEntry(timeEntryId)

      expect(result.id).toBe(timeEntryId)
      expect(result).toHaveProperty('project')
      expect(result).toHaveProperty('task')
    })

    it('lists time entries and finds the created one', async () => {
      const result = await service.listTimeEntries(undefined, undefined, projectId, undefined, undefined, undefined, 1, 100)

      expect(result).toHaveProperty('time_entries')
      const found = result.time_entries.find(t => t.id === timeEntryId)
      expect(found).toBeDefined()
    })

    it('updates the time entry', async () => {
      const result = await service.updateTimeEntry(timeEntryId, undefined, undefined, undefined, 2.0, undefined, undefined, 'E2E updated entry')

      expect(result.id).toBe(timeEntryId)
      expect(result.notes).toBe('E2E updated entry')
    })

    it('deletes the time entry', async () => {
      const result = await service.deleteTimeEntry(timeEntryId)

      expect(result).toEqual({ success: true })
    })

    it('cleans up supporting resources', async () => {
      await service.deleteProject(projectId)
      await service.deleteClient(clientId)
    })
  })

  // ── Invoices CRUD ──

  describe('invoices lifecycle', () => {
    let clientId
    let invoiceId

    it('creates a client for invoicing', async () => {
      const client = await service.createClient('E2E Invoice Client', 'USD')
      clientId = client.id
    })

    it('creates an invoice', async () => {
      const lineItems = [{ kind: 'Service', description: 'E2E test service', quantity: 1, unit_price: 100 }]
      const result = await service.createInvoice(clientId, 'E2E Test Invoice', lineItems, 'Test notes', 'USD')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('state')
      invoiceId = result.id
    })

    it('gets the created invoice', async () => {
      const result = await service.getInvoice(invoiceId)

      expect(result.id).toBe(invoiceId)
      expect(result).toHaveProperty('line_items')
    })

    it('lists invoices and finds the created one', async () => {
      const result = await service.listInvoices(clientId, undefined, undefined, undefined, 1, 100)

      expect(result).toHaveProperty('invoices')
      const found = result.invoices.find(i => i.id === invoiceId)
      expect(found).toBeDefined()
    })

    it('updates the invoice', async () => {
      const result = await service.updateInvoice(invoiceId, 'E2E Updated Invoice')

      expect(result.id).toBe(invoiceId)
      expect(result.subject).toBe('E2E Updated Invoice')
    })

    it('deletes the invoice', async () => {
      const result = await service.deleteInvoice(invoiceId)

      expect(result).toEqual({ success: true })
    })

    it('cleans up the client', async () => {
      await service.deleteClient(clientId)
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.getProjectsDictionary({ search: 'zzz-nonexistent-zzz' })

      expect(result.items).toEqual([])
    })
  })

  describe('getClientsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getClientsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  describe('getTaskAssignmentsDictionary', () => {
    it('returns empty items when no project criteria', async () => {
      const result = await service.getTaskAssignmentsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
