'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-access-token'
const EMAIL = 'user@example.com'
const BASE = 'https://api.copper.com/developer/v1'

const AUTH_HEADERS = {
  'X-PW-AccessToken': API_KEY,
  'X-PW-Application': 'developer_api',
  'X-PW-UserEmail': EMAIL,
  'Content-Type': 'application/json',
}

describe('Copper Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, email: EMAIL })
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
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'email',
          displayName: 'User Email',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Copper auth headers on every request', async () => {
      mock.onGet(`${ BASE }/people/1`).reply({ id: 1 })

      await service.getPerson('1')

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── People ──

  describe('createPerson', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/people`).reply({ id: 123, name: 'Jane Doe' })

      const result = await service.createPerson('Jane Doe')

      expect(result).toEqual({ id: 123, name: 'Jane Doe' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/people`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({ name: 'Jane Doe' })
    })

    it('sends POST with all params, building nested email/phone/address', async () => {
      mock.onPost(`${ BASE }/people`).reply({ id: 124 })

      await service.createPerson(
        'Jane Doe',
        'jane@example.com',
        'Personal',
        '555-1000',
        'Acme',
        'VP Sales',
        '1 Main St',
        'Springfield',
        'IL',
        '62704',
        'US',
        '55',
        ['lead', 'vip'],
        'Important contact',
        [{ custom_field_definition_id: 1, value: 'x' }]
      )

      expect(mock.history[0].body).toEqual({
        name: 'Jane Doe',
        emails: [{ email: 'jane@example.com', category: 'personal' }],
        phone_numbers: [{ number: '555-1000', category: 'work' }],
        company_name: 'Acme',
        title: 'VP Sales',
        assignee_id: '55',
        details: 'Important contact',
        tags: ['lead', 'vip'],
        address: {
          street: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          postal_code: '62704',
          country: 'US',
        },
        custom_fields: [{ custom_field_definition_id: 1, value: 'x' }],
      })
    })

    it('defaults the email category to work when not specified', async () => {
      mock.onPost(`${ BASE }/people`).reply({ id: 125 })

      await service.createPerson('Jane Doe', 'jane@example.com')

      expect(mock.history[0].body).toEqual({
        name: 'Jane Doe',
        emails: [{ email: 'jane@example.com', category: 'work' }],
      })
    })

    it('splits a comma-separated tags string into a list', async () => {
      mock.onPost(`${ BASE }/people`).reply({ id: 126 })

      await service.createPerson('Jane Doe', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'lead, vip , ')

      expect(mock.history[0].body.tags).toEqual(['lead', 'vip'])
    })

    it('throws a Copper API error on failure', async () => {
      mock.onPost(`${ BASE }/people`).replyWithError({
        message: 'Unprocessable Entity',
        status: 422,
        body: { message: 'Name is required', status: 422 },
      })

      await expect(service.createPerson('Bad')).rejects.toThrow('Copper API error: Name is required')
    })

    it('joins the errors array when present in the error body', async () => {
      mock.onPost(`${ BASE }/people`).replyWithError({
        message: 'Unprocessable Entity',
        body: { errors: ['name too short', 'email invalid'] },
      })

      await expect(service.createPerson('Bad')).rejects.toThrow('Copper API error: name too short; email invalid')
    })

    it('falls back to error.message when body has no detail', async () => {
      mock.onPost(`${ BASE }/people`).replyWithError({ message: 'Network down' })

      await expect(service.createPerson('Bad')).rejects.toThrow('Copper API error: Network down')
    })
  })

  describe('getPerson', () => {
    it('sends GET to the person endpoint', async () => {
      mock.onGet(`${ BASE }/people/123`).reply({ id: 123, name: 'Jane Doe' })

      const result = await service.getPerson('123')

      expect(result).toEqual({ id: 123, name: 'Jane Doe' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/people/123`)
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('searchPeople', () => {
    it('sends POST with default paging and no filters', async () => {
      mock.onPost(`${ BASE }/people/search`).reply([])

      const result = await service.searchPeople()

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${ BASE }/people/search`)
      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('maps name, email, paging and sort options', async () => {
      mock.onPost(`${ BASE }/people/search`).reply([{ id: 1 }])

      await service.searchPeople('Jane', 'jane@example.com', 2, 50, 'Date Created', 'Descending')

      expect(mock.history[0].body).toEqual({
        page_number: 2,
        page_size: 50,
        name: 'Jane',
        emails: ['jane@example.com'],
        sort_by: 'date_created',
        sort_direction: 'desc',
      })
    })

    it('caps page_size at 200', async () => {
      mock.onPost(`${ BASE }/people/search`).reply([])

      await service.searchPeople(undefined, undefined, 1, 5000)

      expect(mock.history[0].body.page_size).toBe(200)
    })
  })

  describe('updatePerson', () => {
    it('sends PUT with only the supplied fields', async () => {
      mock.onPut(`${ BASE }/people/123`).reply({ id: 123, title: 'Director' })

      const result = await service.updatePerson('123', undefined, undefined, undefined, undefined, undefined, 'Director')

      expect(result).toEqual({ id: 123, title: 'Director' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/people/123`)
      expect(mock.history[0].body).toEqual({ title: 'Director' })
    })

    it('builds email/phone/tags/custom fields when provided', async () => {
      mock.onPut(`${ BASE }/people/123`).reply({ id: 123 })

      await service.updatePerson('123', 'New Name', 'new@example.com', 'Work', '555-2000', 'NewCo', 'Manager', '77', 'a,b', 'notes', [{ custom_field_definition_id: 2, value: 'y' }])

      expect(mock.history[0].body).toEqual({
        name: 'New Name',
        emails: [{ email: 'new@example.com', category: 'work' }],
        phone_numbers: [{ number: '555-2000', category: 'work' }],
        company_name: 'NewCo',
        title: 'Manager',
        assignee_id: '77',
        details: 'notes',
        tags: ['a', 'b'],
        custom_fields: [{ custom_field_definition_id: 2, value: 'y' }],
      })
    })
  })

  describe('deletePerson', () => {
    it('sends DELETE and returns a synthesized result', async () => {
      mock.onDelete(`${ BASE }/people/123`).reply({})

      const result = await service.deletePerson('123')

      expect(result).toEqual({ deleted: true, id: '123' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/people/123`)
    })
  })

  // ── Companies ──

  describe('createCompany', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 456, name: 'Acme Inc' })

      const result = await service.createCompany('Acme Inc')

      expect(result).toEqual({ id: 456, name: 'Acme Inc' })
      expect(mock.history[0].url).toBe(`${ BASE }/companies`)
      expect(mock.history[0].body).toEqual({ name: 'Acme Inc' })
    })

    it('sends POST with all params', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 457 })

      await service.createCompany('Acme Inc', 'acme.com', '555-1000', '1 Main St', 'Springfield', 'IL', '62704', 'US', '55', 'a,b', 'notes', [{ custom_field_definition_id: 3, value: 'z' }])

      expect(mock.history[0].body).toEqual({
        name: 'Acme Inc',
        email_domain: 'acme.com',
        phone_numbers: [{ number: '555-1000', category: 'work' }],
        assignee_id: '55',
        details: 'notes',
        tags: ['a', 'b'],
        address: {
          street: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          postal_code: '62704',
          country: 'US',
        },
        custom_fields: [{ custom_field_definition_id: 3, value: 'z' }],
      })
    })
  })

  describe('getCompany', () => {
    it('sends GET to the company endpoint', async () => {
      mock.onGet(`${ BASE }/companies/456`).reply({ id: 456, name: 'Acme Inc' })

      const result = await service.getCompany('456')

      expect(result).toEqual({ id: 456, name: 'Acme Inc' })
      expect(mock.history[0].url).toBe(`${ BASE }/companies/456`)
    })
  })

  describe('searchCompanies', () => {
    it('sends POST with default paging', async () => {
      mock.onPost(`${ BASE }/companies/search`).reply([])

      await service.searchCompanies()

      expect(mock.history[0].url).toBe(`${ BASE }/companies/search`)
      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('maps name and sort options', async () => {
      mock.onPost(`${ BASE }/companies/search`).reply([{ id: 456 }])

      await service.searchCompanies('Acme', 1, 10, 'Name', 'Ascending')

      expect(mock.history[0].body).toEqual({
        page_number: 1,
        page_size: 10,
        name: 'Acme',
        sort_by: 'name',
        sort_direction: 'asc',
      })
    })
  })

  describe('updateCompany', () => {
    it('sends PUT with only supplied fields', async () => {
      mock.onPut(`${ BASE }/companies/456`).reply({ id: 456 })

      await service.updateCompany('456', 'Acme Corp')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'Acme Corp' })
    })

    it('builds all fields when provided', async () => {
      mock.onPut(`${ BASE }/companies/456`).reply({ id: 456 })

      await service.updateCompany('456', 'Acme Corp', 'acme.com', '555-3000', '88', 'x,y', 'notes', [{ custom_field_definition_id: 4, value: 'w' }])

      expect(mock.history[0].body).toEqual({
        name: 'Acme Corp',
        email_domain: 'acme.com',
        phone_numbers: [{ number: '555-3000', category: 'work' }],
        assignee_id: '88',
        details: 'notes',
        tags: ['x', 'y'],
        custom_fields: [{ custom_field_definition_id: 4, value: 'w' }],
      })
    })
  })

  describe('deleteCompany', () => {
    it('sends DELETE and returns a synthesized result', async () => {
      mock.onDelete(`${ BASE }/companies/456`).reply({})

      const result = await service.deleteCompany('456')

      expect(result).toEqual({ deleted: true, id: '456' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Leads ──

  describe('createLead', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/leads`).reply({ id: 789, name: 'Big Deal Lead' })

      const result = await service.createLead('Big Deal Lead')

      expect(result).toEqual({ id: 789, name: 'Big Deal Lead' })
      expect(mock.history[0].url).toBe(`${ BASE }/leads`)
      expect(mock.history[0].body).toEqual({ name: 'Big Deal Lead' })
    })

    it('uses the singular email object shape for leads', async () => {
      mock.onPost(`${ BASE }/leads`).reply({ id: 790 })

      await service.createLead(
        'Big Deal Lead',
        'lead@example.com',
        '555-4000',
        'Prospect Co',
        'CTO',
        'New',
        '3',
        5000,
        '55',
        'hot,priority',
        'notes',
        [{ custom_field_definition_id: 5, value: 'v' }]
      )

      expect(mock.history[0].body).toEqual({
        name: 'Big Deal Lead',
        email: { email: 'lead@example.com', category: 'work' },
        phone_numbers: [{ number: '555-4000', category: 'work' }],
        company_name: 'Prospect Co',
        title: 'CTO',
        status: 'New',
        customer_source_id: '3',
        monetary_value: 5000,
        assignee_id: '55',
        tags: ['hot', 'priority'],
        details: 'notes',
        custom_fields: [{ custom_field_definition_id: 5, value: 'v' }],
      })
    })
  })

  describe('getLead', () => {
    it('sends GET to the lead endpoint', async () => {
      mock.onGet(`${ BASE }/leads/789`).reply({ id: 789 })

      await service.getLead('789')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/leads/789`)
    })
  })

  describe('searchLeads', () => {
    it('sends POST with default paging', async () => {
      mock.onPost(`${ BASE }/leads/search`).reply([])

      await service.searchLeads()

      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('maps name and sort options', async () => {
      mock.onPost(`${ BASE }/leads/search`).reply([{ id: 789 }])

      await service.searchLeads('Big', 3, 25, 'Date Modified', 'Descending')

      expect(mock.history[0].body).toEqual({
        page_number: 3,
        page_size: 25,
        name: 'Big',
        sort_by: 'date_modified',
        sort_direction: 'desc',
      })
    })
  })

  describe('updateLead', () => {
    it('sends PUT with only supplied fields', async () => {
      mock.onPut(`${ BASE }/leads/789`).reply({ id: 789 })

      await service.updateLead('789', undefined, undefined, undefined, undefined, undefined, 'Qualified', 8000)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ status: 'Qualified', monetary_value: 8000 })
    })

    it('builds the singular email object and all fields', async () => {
      mock.onPut(`${ BASE }/leads/789`).reply({ id: 789 })

      await service.updateLead('789', 'New', 'lead@new.com', '555-5000', 'NewCo', 'VP', 'Open', 9000, '66', 'a,b', [{ custom_field_definition_id: 6, value: 'u' }])

      expect(mock.history[0].body).toEqual({
        name: 'New',
        email: { email: 'lead@new.com', category: 'work' },
        phone_numbers: [{ number: '555-5000', category: 'work' }],
        company_name: 'NewCo',
        title: 'VP',
        status: 'Open',
        monetary_value: 9000,
        assignee_id: '66',
        tags: ['a', 'b'],
        custom_fields: [{ custom_field_definition_id: 6, value: 'u' }],
      })
    })
  })

  describe('deleteLead', () => {
    it('sends DELETE and returns a synthesized result', async () => {
      mock.onDelete(`${ BASE }/leads/789`).reply({})

      const result = await service.deleteLead('789')

      expect(result).toEqual({ deleted: true, id: '789' })
    })
  })

  describe('convertLead', () => {
    it('sends an empty body when no details are provided', async () => {
      mock.onPost(`${ BASE }/leads/789/convert`).reply({ person: { id: 1 } })

      const result = await service.convertLead('789')

      expect(result).toEqual({ person: { id: 1 } })
      expect(mock.history[0].url).toBe(`${ BASE }/leads/789/convert`)
      expect(mock.history[0].body).toEqual({})
    })

    it('wraps conversion options in a details object', async () => {
      mock.onPost(`${ BASE }/leads/789/convert`).reply({ opportunity: { id: 321 } })

      await service.convertLead('789', '11', '101', 'Converted Deal', 12000)

      expect(mock.history[0].body).toEqual({
        details: {
          name: 'Converted Deal',
          pipeline_id: '11',
          pipeline_stage_id: '101',
          monetary_value: 12000,
        },
      })
    })
  })

  // ── Opportunities ──

  describe('createOpportunity', () => {
    it('sends POST with required name and pipeline', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 321 })

      const result = await service.createOpportunity('Acme Deal', '11')

      expect(result).toEqual({ id: 321 })
      expect(mock.history[0].url).toBe(`${ BASE }/opportunities`)
      expect(mock.history[0].body).toEqual({ name: 'Acme Deal', pipeline_id: '11' })
    })

    it('formats the close date to MM/DD/YYYY and maps all fields', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 322 })

      await service.createOpportunity(
        'Acme Deal',
        '11',
        '101',
        '123',
        '456',
        25000,
        60,
        '2024-12-31',
        '3',
        '55',
        'a,b',
        [{ custom_field_definition_id: 7, value: 't' }]
      )

      expect(mock.history[0].body).toEqual({
        name: 'Acme Deal',
        pipeline_id: '11',
        pipeline_stage_id: '101',
        primary_contact_id: '123',
        company_id: '456',
        monetary_value: 25000,
        win_probability: 60,
        close_date: '12/31/2024',
        customer_source_id: '3',
        assignee_id: '55',
        tags: ['a', 'b'],
        custom_fields: [{ custom_field_definition_id: 7, value: 't' }],
      })
    })

    it('passes an already-formatted close date through unchanged', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 323 })

      await service.createOpportunity('Acme Deal', '11', undefined, undefined, undefined, undefined, undefined, 'not-a-date')

      expect(mock.history[0].body.close_date).toBe('not-a-date')
    })
  })

  describe('getOpportunity', () => {
    it('sends GET to the opportunity endpoint', async () => {
      mock.onGet(`${ BASE }/opportunities/321`).reply({ id: 321 })

      await service.getOpportunity('321')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/opportunities/321`)
    })
  })

  describe('searchOpportunities', () => {
    it('sends POST with default paging and no pipeline filter', async () => {
      mock.onPost(`${ BASE }/opportunities/search`).reply([])

      await service.searchOpportunities()

      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('wraps the pipeline id into a pipeline_ids array', async () => {
      mock.onPost(`${ BASE }/opportunities/search`).reply([{ id: 321 }])

      await service.searchOpportunities('Acme', '11', 1, 10, 'Name', 'Ascending')

      expect(mock.history[0].body).toEqual({
        page_number: 1,
        page_size: 10,
        name: 'Acme',
        sort_by: 'name',
        sort_direction: 'asc',
        pipeline_ids: ['11'],
      })
    })
  })

  describe('updateOpportunity', () => {
    it('sends PUT with only supplied fields', async () => {
      mock.onPut(`${ BASE }/opportunities/321`).reply({ id: 321 })

      await service.updateOpportunity('321', undefined, undefined, 30000)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ monetary_value: 30000 })
    })

    it('formats close date, resolves status, and maps all fields', async () => {
      mock.onPut(`${ BASE }/opportunities/321`).reply({ id: 321 })

      await service.updateOpportunity('321', 'Renamed', '102', 30000, 75, '2025-01-15', 'Won', '7', '66', [{ custom_field_definition_id: 8, value: 's' }])

      expect(mock.history[0].body).toEqual({
        name: 'Renamed',
        pipeline_stage_id: '102',
        monetary_value: 30000,
        win_probability: 75,
        close_date: '01/15/2025',
        status: 'Won',
        loss_reason_id: '7',
        assignee_id: '66',
        custom_fields: [{ custom_field_definition_id: 8, value: 's' }],
      })
    })
  })

  describe('deleteOpportunity', () => {
    it('sends DELETE and returns a synthesized result', async () => {
      mock.onDelete(`${ BASE }/opportunities/321`).reply({})

      const result = await service.deleteOpportunity('321')

      expect(result).toEqual({ deleted: true, id: '321' })
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 901, name: 'Follow up call' })

      const result = await service.createTask('Follow up call')

      expect(result).toEqual({ id: 901, name: 'Follow up call' })
      expect(mock.history[0].url).toBe(`${ BASE }/tasks`)
      expect(mock.history[0].body).toEqual({ name: 'Follow up call' })
    })

    it('builds related_resource and converts dates to unix seconds', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 902 })

      await service.createTask('Follow up', 'Person', '123', '2024-01-01T00:00:00Z', 1700200000, '55', 'High', 'Open', 'call them')

      expect(mock.history[0].body).toEqual({
        name: 'Follow up',
        related_resource: { id: 123, type: 'person' },
        due_date: 1704067200,
        reminder_date: 1700200000,
        assignee_id: '55',
        priority: 'High',
        status: 'Open',
        details: 'call them',
      })
    })

    it('omits related_resource when only the type is provided', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 903 })

      await service.createTask('Standalone', 'Person')

      expect(mock.history[0].body).toEqual({ name: 'Standalone' })
    })

    it('keeps a numeric-string epoch value as a number', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 904 })

      await service.createTask('Timed', undefined, undefined, '1700200000')

      expect(mock.history[0].body.due_date).toBe(1700200000)
    })
  })

  describe('listTasks', () => {
    it('sends POST with default paging', async () => {
      mock.onPost(`${ BASE }/tasks/search`).reply([])

      await service.listTasks()

      expect(mock.history[0].url).toBe(`${ BASE }/tasks/search`)
      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('wraps assignee into an array and maps sort options', async () => {
      mock.onPost(`${ BASE }/tasks/search`).reply([{ id: 901 }])

      await service.listTasks(2, 30, '55', 'Due Date', 'Descending')

      expect(mock.history[0].body).toEqual({
        page_number: 2,
        page_size: 30,
        assignee_ids: ['55'],
        sort_by: 'due_date',
        sort_direction: 'desc',
      })
    })
  })

  describe('updateTask', () => {
    it('sends PUT with only supplied fields', async () => {
      mock.onPut(`${ BASE }/tasks/901`).reply({ id: 901 })

      await service.updateTask('901', undefined, undefined, undefined, undefined, 'Completed')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ status: 'Completed' })
    })

    it('maps all fields and converts the due date', async () => {
      mock.onPut(`${ BASE }/tasks/901`).reply({ id: 901 })

      await service.updateTask('901', 'Renamed', '2024-01-01T00:00:00Z', '55', 'High', 'Open', 'notes')

      expect(mock.history[0].body).toEqual({
        name: 'Renamed',
        due_date: 1704067200,
        assignee_id: '55',
        priority: 'High',
        status: 'Open',
        details: 'notes',
      })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns a synthesized result', async () => {
      mock.onDelete(`${ BASE }/tasks/901`).reply({})

      const result = await service.deleteTask('901')

      expect(result).toEqual({ deleted: true, id: '901' })
    })
  })

  // ── Activities ──

  describe('createActivity', () => {
    it('builds the type and parent objects with resolved categories', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ id: 1001 })

      const result = await service.createActivity('User', 'note', 'Person', '123', 'Called and left voicemail')

      expect(result).toEqual({ id: 1001 })
      expect(mock.history[0].url).toBe(`${ BASE }/activities`)
      expect(mock.history[0].body).toEqual({
        type: { category: 'user', id: 'note' },
        parent: { type: 'person', id: 123 },
        details: 'Called and left voicemail',
      })
    })

    it('coerces numeric type and parent ids to numbers', async () => {
      mock.onPost(`${ BASE }/activities`).reply({ id: 1002 })

      await service.createActivity('System', '42', 'Company', '456')

      expect(mock.history[0].body).toEqual({
        type: { category: 'system', id: 42 },
        parent: { type: 'company', id: 456 },
      })
    })
  })

  describe('listActivities', () => {
    it('sends POST with default paging and no parent scope', async () => {
      mock.onPost(`${ BASE }/activities/search`).reply([])

      await service.listActivities()

      expect(mock.history[0].url).toBe(`${ BASE }/activities/search`)
      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 20 })
    })

    it('adds a parent scope when both type and id are provided', async () => {
      mock.onPost(`${ BASE }/activities/search`).reply([{ id: 1001 }])

      await service.listActivities('Person', '123', 2, 50)

      expect(mock.history[0].body).toEqual({
        page_number: 2,
        page_size: 50,
        parent: { type: 'person', id: 123 },
      })
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('maps users to items and hits the users search endpoint', async () => {
      mock.onPost(`${ BASE }/users/search`).reply([
        { id: 55, name: 'Jane Doe', email: 'jane@example.com' },
        { id: 66, name: 'John Roe', email: 'john@example.com' },
      ])

      const result = await service.getUsersDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/users/search`)
      expect(mock.history[0].body).toEqual({ page_number: 1, page_size: 200 })
      expect(result.items).toEqual([
        { label: 'Jane Doe', value: '55', note: 'jane@example.com' },
        { label: 'John Roe', value: '66', note: 'john@example.com' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term against name and email', async () => {
      mock.onPost(`${ BASE }/users/search`).reply([
        { id: 55, name: 'Jane Doe', email: 'jane@example.com' },
        { id: 66, name: 'John Roe', email: 'john@example.com' },
      ])

      const result = await service.getUsersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('55')
    })

    it('advances the page number from the cursor and returns a next cursor when full', async () => {
      const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `User ${ i + 1 }` }))

      mock.onPost(`${ BASE }/users/search`).reply(fullPage)

      const result = await service.getUsersDictionary({ cursor: '2' })

      expect(mock.history[0].body).toEqual({ page_number: 2, page_size: 200 })
      expect(result.cursor).toBe('3')
    })

    it('returns an empty list when the API returns a non-array', async () => {
      mock.onPost(`${ BASE }/users/search`).reply({ message: 'no users' })

      const result = await service.getUsersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getPipelinesDictionary', () => {
    it('maps pipelines and hits the pipelines endpoint', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply([
        { id: 11, name: 'Sales Pipeline' },
        { id: 12, name: 'Support Pipeline' },
      ])

      const result = await service.getPipelinesDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/pipelines`)
      expect(result.items).toEqual([
        { label: 'Sales Pipeline', value: '11', note: 'Pipeline ID: 11' },
        { label: 'Support Pipeline', value: '12', note: 'Pipeline ID: 12' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters pipelines by search term', async () => {
      mock.onGet(`${ BASE }/pipelines`).reply([
        { id: 11, name: 'Sales Pipeline' },
        { id: 12, name: 'Support Pipeline' },
      ])

      const result = await service.getPipelinesDictionary({ search: 'support' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('12')
    })
  })

  describe('getPipelineStagesDictionary', () => {
    const stages = [
      { id: 101, name: 'Qualification', pipeline_id: 11 },
      { id: 102, name: 'Proposal', pipeline_id: 11 },
      { id: 201, name: 'Triage', pipeline_id: 12 },
    ]

    it('lists all stages and hits the pipeline_stages endpoint', async () => {
      mock.onGet(`${ BASE }/pipeline_stages`).reply(stages)

      const result = await service.getPipelineStagesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/pipeline_stages`)
      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'Qualification', value: '101', note: 'Stage in pipeline 11' })
      expect(result.cursor).toBeNull()
    })

    it('filters stages by the pipeline criteria', async () => {
      mock.onGet(`${ BASE }/pipeline_stages`).reply(stages)

      const result = await service.getPipelineStagesDictionary({ criteria: { pipelineId: '11' } })

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(['101', '102'])
    })

    it('applies both the pipeline criteria and the search term', async () => {
      mock.onGet(`${ BASE }/pipeline_stages`).reply(stages)

      const result = await service.getPipelineStagesDictionary({ criteria: { pipelineId: '11' }, search: 'propos' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('102')
    })
  })

  describe('getCustomerSourcesDictionary', () => {
    it('maps customer sources and hits the endpoint', async () => {
      mock.onGet(`${ BASE }/customer_sources`).reply([
        { id: 3, name: 'Referral' },
        { id: 4, name: 'Website' },
      ])

      const result = await service.getCustomerSourcesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/customer_sources`)
      expect(result.items).toEqual([
        { label: 'Referral', value: '3', note: 'Source ID: 3' },
        { label: 'Website', value: '4', note: 'Source ID: 4' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters customer sources by search term', async () => {
      mock.onGet(`${ BASE }/customer_sources`).reply([
        { id: 3, name: 'Referral' },
        { id: 4, name: 'Website' },
      ])

      const result = await service.getCustomerSourcesDictionary({ search: 'web' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('4')
    })
  })

  describe('getLossReasonsDictionary', () => {
    it('maps loss reasons and hits the endpoint', async () => {
      mock.onGet(`${ BASE }/loss_reasons`).reply([
        { id: 7, name: 'Price too high' },
        { id: 8, name: 'Chose competitor' },
      ])

      const result = await service.getLossReasonsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/loss_reasons`)
      expect(result.items).toEqual([
        { label: 'Price too high', value: '7', note: 'Loss reason ID: 7' },
        { label: 'Chose competitor', value: '8', note: 'Loss reason ID: 8' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters loss reasons by search term', async () => {
      mock.onGet(`${ BASE }/loss_reasons`).reply([
        { id: 7, name: 'Price too high' },
        { id: 8, name: 'Chose competitor' },
      ])

      const result = await service.getLossReasonsDictionary({ search: 'competitor' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('8')
    })
  })
})
