'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key-abc123'
const DOMAIN = 'testcompany'
const BASE = `https://${ DOMAIN }.myfreshworks.com/crm/sales/api`

describe('Freshworks CRM Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ domain: DOMAIN, apiKey: API_KEY })
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
          name: 'domain',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ contact: { id: 1, first_name: 'Jane' } })

      const result = await service.createContact('Jane', 'Doe', 'jane@example.com')

      expect(result).toEqual({ id: 1, first_name: 'Jane' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token token=${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        contact: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
        },
      })
    })

    it('sends all optional fields when provided', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({
        contact: { id: 2, first_name: 'Jane', last_name: 'Doe' },
      })

      await service.createContact(
        'Jane', 'Doe', 'jane@example.com',
        '+15550100', '+15550200', 'CTO',
        100, 200, { cf_region: 'EMEA' }
      )

      expect(mock.history[0].body).toEqual({
        contact: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          mobile_number: '+15550100',
          work_number: '+15550200',
          job_title: 'CTO',
          sales_accounts: [{ id: 100, is_primary: true }],
          owner_id: 200,
          custom_field: { cf_region: 'EMEA' },
        },
      })
    })

    it('unwraps the contact from the response envelope', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ contact: { id: 3, email: 'x@y.com' } })

      const result = await service.createContact(null, null, 'x@y.com')

      expect(result).toEqual({ id: 3, email: 'x@y.com' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        message: 'Bad Request',
        body: { errors: { message: 'Validation failed' } },
      })

      await expect(service.createContact('A')).rejects.toThrow('Freshworks CRM API error: Validation failed')
    })
  })

  describe('getContact', () => {
    it('sends GET with contact ID', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({ contact: { id: 123, first_name: 'Jane' } })

      const result = await service.getContact(123)

      expect(result).toEqual({ id: 123, first_name: 'Jane' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123`)
    })

    it('passes include query param when provided', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({ contact: { id: 123 } })

      await service.getContact(123, ['Deals', 'Notes'])

      expect(mock.history[0].query).toMatchObject({ include: 'deals,notes' })
    })

    it('maps Sales Account include correctly', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({ contact: { id: 123 } })

      await service.getContact(123, ['Sales Account'])

      expect(mock.history[0].query).toMatchObject({ include: 'sales_accounts' })
    })

    it('omits include param when not provided', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({ contact: { id: 123 } })

      await service.getContact(123)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('listContacts', () => {
    it('sends GET with view ID and default pagination', async () => {
      mock.onGet(`${ BASE }/contacts/view/999`).reply({
        contacts: [{ id: 1 }],
        meta: { total: 1, total_pages: 1 },
      })

      const result = await service.listContacts(999)

      expect(result).toEqual({
        contacts: [{ id: 1 }],
        meta: { total: 1, total_pages: 1 },
      })
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/contacts/view/999`).reply({ contacts: [], meta: {} })

      await service.listContacts(999, 3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })
  })

  describe('updateContact', () => {
    it('sends PUT with contact ID and body', async () => {
      mock.onPut(`${ BASE }/contacts/123`).reply({ contact: { id: 123, first_name: 'Updated' } })

      const result = await service.updateContact(123, 'Updated')

      expect(result).toEqual({ id: 123, first_name: 'Updated' })
      expect(mock.history[0].body).toEqual({
        contact: { first_name: 'Updated' },
      })
    })

    it('sends all optional fields when provided', async () => {
      mock.onPut(`${ BASE }/contacts/123`).reply({ contact: { id: 123 } })

      await service.updateContact(123, 'Jane', 'Doe', 'jane@new.com', '+1555', 'VP', 200, { cf_x: 'Y' })

      expect(mock.history[0].body).toEqual({
        contact: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@new.com',
          mobile_number: '+1555',
          job_title: 'VP',
          owner_id: 200,
          custom_field: { cf_x: 'Y' },
        },
      })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/123`).reply({})

      const result = await service.deleteContact(123)

      expect(result).toEqual({ deleted: true, contactId: 123 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('upsertContact', () => {
    it('sends POST with unique_identifier query and body', async () => {
      mock.onPost(`${ BASE }/contacts/upsert`).reply({ contact: { id: 1, email: 'jane@x.com' } })

      const result = await service.upsertContact('jane@x.com', 'Jane', 'Doe')

      expect(result).toEqual({ id: 1, email: 'jane@x.com' })
      expect(mock.history[0].query).toMatchObject({
        unique_identifier: JSON.stringify({ email: 'jane@x.com' }),
      })
      expect(mock.history[0].body).toEqual({
        contact: {
          email: 'jane@x.com',
          first_name: 'Jane',
          last_name: 'Doe',
        },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${ BASE }/contacts/upsert`).reply({ contact: { id: 2 } })

      await service.upsertContact('jane@x.com', 'Jane', 'Doe', '+1555', 'CTO', 100, { cf_a: 'B' })

      expect(mock.history[0].body).toEqual({
        contact: {
          email: 'jane@x.com',
          first_name: 'Jane',
          last_name: 'Doe',
          mobile_number: '+1555',
          job_title: 'CTO',
          owner_id: 100,
          custom_field: { cf_a: 'B' },
        },
      })
    })
  })

  describe('searchCrm', () => {
    it('sends GET with query and defaults to Contacts entity', async () => {
      mock.onGet(`${ BASE }/search`).reply([{ id: 1, type: 'contact', display_name: 'Jane' }])

      const result = await service.searchCrm('Jane')

      expect(result).toEqual([{ id: 1, type: 'contact', display_name: 'Jane' }])
      expect(mock.history[0].query).toMatchObject({ q: 'Jane', include: 'contact' })
    })

    it('maps multiple entity types', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchCrm('Acme', ['Contacts', 'Deals', 'Accounts'])

      expect(mock.history[0].query).toMatchObject({ include: 'contact,deal,sales_account' })
    })

    it('maps Leads entity', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchCrm('test', ['Leads'])

      expect(mock.history[0].query).toMatchObject({ include: 'lead' })
    })
  })

  // ── Accounts ──

  describe('createAccount', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/sales_accounts`).reply({ sales_account: { id: 1, name: 'Acme' } })

      const result = await service.createAccount('Acme')

      expect(result).toEqual({ id: 1, name: 'Acme' })
      expect(mock.history[0].body).toEqual({
        sales_account: { name: 'Acme' },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${ BASE }/sales_accounts`).reply({ sales_account: { id: 2 } })

      await service.createAccount('Acme', 'https://acme.com', '+1555', 'Tech', 250, 100, { cf_tier: 'Enterprise' })

      expect(mock.history[0].body).toEqual({
        sales_account: {
          name: 'Acme',
          website: 'https://acme.com',
          phone: '+1555',
          industry_type: 'Tech',
          number_of_employees: 250,
          owner_id: 100,
          custom_field: { cf_tier: 'Enterprise' },
        },
      })
    })
  })

  describe('getAccount', () => {
    it('sends GET and unwraps sales_account', async () => {
      mock.onGet(`${ BASE }/sales_accounts/456`).reply({ sales_account: { id: 456, name: 'Acme' } })

      const result = await service.getAccount(456)

      expect(result).toEqual({ id: 456, name: 'Acme' })
    })
  })

  describe('listAccounts', () => {
    it('sends GET with view ID and default pagination', async () => {
      mock.onGet(`${ BASE }/sales_accounts/view/777`).reply({
        sales_accounts: [{ id: 1 }],
        meta: { total: 1 },
      })

      const result = await service.listAccounts(777)

      expect(result.sales_accounts).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/sales_accounts/view/777`).reply({ sales_accounts: [], meta: {} })

      await service.listAccounts(777, 2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 50 })
    })
  })

  describe('updateAccount', () => {
    it('sends PUT with account ID and body', async () => {
      mock.onPut(`${ BASE }/sales_accounts/456`).reply({ sales_account: { id: 456, name: 'New' } })

      const result = await service.updateAccount(456, 'New')

      expect(result).toEqual({ id: 456, name: 'New' })
      expect(mock.history[0].body).toEqual({
        sales_account: { name: 'New' },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPut(`${ BASE }/sales_accounts/456`).reply({ sales_account: { id: 456 } })

      await service.updateAccount(456, 'Acme', 'https://acme.com', '+1555', 300, 100, { cf_x: 'Y' })

      expect(mock.history[0].body).toEqual({
        sales_account: {
          name: 'Acme',
          website: 'https://acme.com',
          phone: '+1555',
          number_of_employees: 300,
          owner_id: 100,
          custom_field: { cf_x: 'Y' },
        },
      })
    })
  })

  describe('deleteAccount', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/sales_accounts/456`).reply({})

      const result = await service.deleteAccount(456)

      expect(result).toEqual({ deleted: true, accountId: 456 })
    })
  })

  // ── Deals ──

  describe('createDeal', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ deal: { id: 1, name: 'Deal A', amount: '5000' } })

      const result = await service.createDeal('Deal A', 5000)

      expect(result).toEqual({ id: 1, name: 'Deal A', amount: '5000' })
      expect(mock.history[0].body).toEqual({
        deal: { name: 'Deal A', amount: 5000 },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${ BASE }/deals`).reply({ deal: { id: 2 } })

      await service.createDeal(
        'Deal A', 5000, 100, 200, 300,
        '2026-08-01', 60, ['10', '20'], { cf_source: 'Referral' }
      )

      expect(mock.history[0].body).toEqual({
        deal: {
          name: 'Deal A',
          amount: 5000,
          sales_account_id: 100,
          deal_stage_id: 200,
          owner_id: 300,
          expected_close: '2026-08-01',
          probability: 60,
          contacts_added_list: [10, 20],
          custom_field: { cf_source: 'Referral' },
        },
      })
    })
  })

  describe('getDeal', () => {
    it('sends GET and unwraps deal', async () => {
      mock.onGet(`${ BASE }/deals/789`).reply({ deal: { id: 789, name: 'Deal X' } })

      const result = await service.getDeal(789)

      expect(result).toEqual({ id: 789, name: 'Deal X' })
    })
  })

  describe('listDeals', () => {
    it('sends GET with view ID and default pagination', async () => {
      mock.onGet(`${ BASE }/deals/view/555`).reply({ deals: [{ id: 1 }], meta: { total: 1 } })

      const result = await service.listDeals(555)

      expect(result.deals).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/deals/view/555`).reply({ deals: [], meta: {} })

      await service.listDeals(555, 4, 100)

      expect(mock.history[0].query).toMatchObject({ page: 4, per_page: 100 })
    })
  })

  describe('updateDeal', () => {
    it('sends PUT with deal ID and body', async () => {
      mock.onPut(`${ BASE }/deals/789`).reply({ deal: { id: 789, name: 'Updated' } })

      const result = await service.updateDeal(789, 'Updated')

      expect(result).toEqual({ id: 789, name: 'Updated' })
      expect(mock.history[0].body).toEqual({
        deal: { name: 'Updated' },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPut(`${ BASE }/deals/789`).reply({ deal: { id: 789 } })

      await service.updateDeal(789, 'Deal B', 10000, 200, 300, '2026-09-01', 80, { cf_x: 'Y' })

      expect(mock.history[0].body).toEqual({
        deal: {
          name: 'Deal B',
          amount: 10000,
          deal_stage_id: 200,
          owner_id: 300,
          expected_close: '2026-09-01',
          probability: 80,
          custom_field: { cf_x: 'Y' },
        },
      })
    })
  })

  describe('deleteDeal', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/deals/789`).reply({})

      const result = await service.deleteDeal(789)

      expect(result).toEqual({ deleted: true, dealId: 789 })
    })
  })

  // ── Activities ──

  describe('createTask', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ task: { id: 1, title: 'Follow up' } })

      const result = await service.createTask('Follow up', '2026-08-01T17:00:00Z', 'Contact', 123)

      expect(result).toEqual({ id: 1, title: 'Follow up' })
      expect(mock.history[0].body).toEqual({
        task: {
          title: 'Follow up',
          due_date: '2026-08-01T17:00:00Z',
          targetable_type: 'Contact',
          targetable_id: 123,
        },
      })
    })

    it('maps Account targetable type to SalesAccount', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ task: { id: 2 } })

      await service.createTask('Task', '2026-08-01T17:00:00Z', 'Account', 456)

      expect(mock.history[0].body.task.targetable_type).toBe('SalesAccount')
    })

    it('sends optional owner and description', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ task: { id: 3 } })

      await service.createTask('Task', '2026-08-01T17:00:00Z', 'Deal', 789, 100, 'Some details')

      expect(mock.history[0].body).toEqual({
        task: {
          title: 'Task',
          due_date: '2026-08-01T17:00:00Z',
          targetable_type: 'Deal',
          targetable_id: 789,
          owner_id: 100,
          description: 'Some details',
        },
      })
    })
  })

  describe('listTasks', () => {
    it('sends GET with default filter', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [{ id: 1 }], meta: { total: 1 } })

      const result = await service.listTasks()

      expect(result.tasks).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })

    it('maps Open status to open filter', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [], meta: {} })

      await service.listTasks('Open')

      expect(mock.history[0].query).toMatchObject({ filter: 'open' })
    })

    it('maps Completed status to completed filter', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [], meta: {} })

      await service.listTasks('Completed')

      expect(mock.history[0].query).toMatchObject({ filter: 'completed' })
    })

    it('passes custom page', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [], meta: {} })

      await service.listTasks(null, null, 5)

      expect(mock.history[0].query).toMatchObject({ page: 5 })
    })
  })

  describe('createAppointment', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ appointment: { id: 1, title: 'Meeting' } })

      const result = await service.createAppointment('Meeting', '2026-08-01T15:00:00Z', '2026-08-01T16:00:00Z')

      expect(result).toEqual({ id: 1, title: 'Meeting' })
      expect(mock.history[0].body).toEqual({
        appointment: {
          title: 'Meeting',
          from_date: '2026-08-01T15:00:00Z',
          end_date: '2026-08-01T16:00:00Z',
        },
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ appointment: { id: 2 } })

      await service.createAppointment(
        'Meeting', '2026-08-01T15:00:00Z', '2026-08-01T16:00:00Z',
        'Zoom', 'Deal', 789, 'Discuss renewal'
      )

      expect(mock.history[0].body).toEqual({
        appointment: {
          title: 'Meeting',
          from_date: '2026-08-01T15:00:00Z',
          end_date: '2026-08-01T16:00:00Z',
          location: 'Zoom',
          targetable_type: 'Deal',
          targetable_id: 789,
          description: 'Discuss renewal',
        },
      })
    })

    it('maps Account targetable type to SalesAccount', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ appointment: { id: 3 } })

      await service.createAppointment(
        'Call', '2026-08-01T15:00:00Z', '2026-08-01T16:00:00Z',
        null, 'Account', 456
      )

      expect(mock.history[0].body.appointment.targetable_type).toBe('SalesAccount')
    })
  })

  describe('createNote', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ note: { id: 1, description: 'Test note' } })

      const result = await service.createNote('Test note', 'Contact', 123)

      expect(result).toEqual({ id: 1, description: 'Test note' })
      expect(mock.history[0].body).toEqual({
        note: {
          description: 'Test note',
          targetable_type: 'Contact',
          targetable_id: 123,
        },
      })
    })

    it('maps Deal targetable type correctly', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ note: { id: 2 } })

      await service.createNote('Note', 'Deal', 789)

      expect(mock.history[0].body.note.targetable_type).toBe('Deal')
    })
  })

  describe('listSalesActivities', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/sales_activities`).reply({
        sales_activities: [{ id: 1 }],
        meta: { total: 1 },
      })

      const result = await service.listSalesActivities()

      expect(result.sales_activities).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/sales_activities`).reply({ sales_activities: [], meta: {} })

      await service.listSalesActivities(3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })
  })

  // ── Dictionaries ──

  describe('getOwnersDictionary', () => {
    it('returns formatted items from API response', async () => {
      mock.onGet(`${ BASE }/selector/owners`).reply({
        users: [
          { id: 1, display_name: 'Alice', email: 'alice@co.com' },
          { id: 2, display_name: 'Bob', email: 'bob@co.com' },
        ],
      })

      const result = await service.getOwnersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alice', value: '1', note: 'alice@co.com' },
          { label: 'Bob', value: '2', note: 'bob@co.com' },
        ],
        cursor: null,
      })
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/selector/owners`).reply({
        users: [
          { id: 1, display_name: 'Alice', email: 'alice@co.com' },
          { id: 2, display_name: 'Bob', email: 'bob@co.com' },
        ],
      })

      const result = await service.getOwnersDictionary({ search: 'alice' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Alice')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/selector/owners`).reply({ users: [{ id: 1, display_name: 'X' }] })

      const result = await service.getOwnersDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty users response', async () => {
      mock.onGet(`${ BASE }/selector/owners`).reply({})

      const result = await service.getOwnersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getDealStagesDictionary', () => {
    it('returns formatted items from API response', async () => {
      mock.onGet(`${ BASE }/selector/deal_stages`).reply({
        deal_stages: [
          { id: 10, name: 'Qualification', deal_pipeline_id: 1 },
          { id: 20, name: 'Won', deal_pipeline_id: 1 },
        ],
      })

      const result = await service.getDealStagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Qualification', value: '10', note: 'Pipeline 1' },
          { label: 'Won', value: '20', note: 'Pipeline 1' },
        ],
        cursor: null,
      })
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/selector/deal_stages`).reply({
        deal_stages: [
          { id: 10, name: 'Qualification' },
          { id: 20, name: 'Won' },
        ],
      })

      const result = await service.getDealStagesDictionary({ search: 'won' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Won')
    })
  })

  describe('getAccountsDictionary', () => {
    it('returns formatted items from array response', async () => {
      mock.onGet(`${ BASE }/search`).reply([
        { id: 1, name: 'Acme Inc', type: 'sales_account', website: 'https://acme.com' },
      ])

      const result = await service.getAccountsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Acme Inc', value: '1', note: 'https://acme.com' },
        ],
        cursor: null,
      })
    })

    it('uses wildcard search when no search text provided', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.getAccountsDictionary({})

      expect(mock.history[0].query).toMatchObject({ q: '*', include: 'sales_account' })
    })

    it('passes search text to query', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.getAccountsDictionary({ search: 'Acme' })

      expect(mock.history[0].query).toMatchObject({ q: 'Acme', include: 'sales_account' })
    })

    it('handles object response with sales_accounts key', async () => {
      mock.onGet(`${ BASE }/search`).reply({
        sales_accounts: [{ id: 2, name: 'Beta Corp' }],
      })

      const result = await service.getAccountsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Beta Corp')
    })
  })

  describe('getContactViewsDictionary', () => {
    it('returns formatted items from API response', async () => {
      mock.onGet(`${ BASE }/contacts/filters`).reply({
        filters: [
          { id: 100, name: 'All Contacts', model_class_name: 'Contact' },
          { id: 200, name: 'My Contacts', model_class_name: 'Contact' },
        ],
      })

      const result = await service.getContactViewsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'All Contacts', value: '100', note: 'Contact' },
          { label: 'My Contacts', value: '200', note: 'Contact' },
        ],
        cursor: null,
      })
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/contacts/filters`).reply({
        filters: [
          { id: 100, name: 'All Contacts' },
          { id: 200, name: 'My Contacts' },
        ],
      })

      const result = await service.getContactViewsDictionary({ search: 'my' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('My Contacts')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('handles array errors in response', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        message: 'Bad Request',
        body: {
          errors: [
            { message: 'Email is required' },
            { message: 'Name is required' },
          ],
        },
      })

      await expect(service.createContact()).rejects.toThrow(
        'Freshworks CRM API error: Email is required; Name is required'
      )
    })

    it('handles rate limiting (429) error', async () => {
      mock.onGet(`${ BASE }/contacts/123`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        headers: { 'retry-after': '30' },
      })

      await expect(service.getContact(123)).rejects.toThrow('Rate limit exceeded')
    })

    it('handles unknown error with no body', async () => {
      mock.onGet(`${ BASE }/contacts/123`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getContact(123)).rejects.toThrow('Freshworks CRM API error: Network Error')
    })
  })
})
