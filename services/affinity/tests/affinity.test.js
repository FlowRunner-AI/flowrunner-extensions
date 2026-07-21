'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.affinity.co'
const AUTH_HEADER = `Basic ${ Buffer.from(`:${ API_KEY }`).toString('base64') }`

describe('Affinity Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Account ──

  describe('getCurrentUser', () => {
    it('sends GET to /auth/whoami with correct auth header', async () => {
      const response = { tenant: { id: 1 }, user: { id: 2 } }
      mock.onGet(`${ BASE }/auth/whoami`).reply(response)

      const result = await service.getCurrentUser()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/auth/whoami`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getCurrentUser()).rejects.toThrow('Affinity API error')
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('sends GET to /lists', async () => {
      const lists = [{ id: 1, name: 'Deal Flow', type: 8 }]
      mock.onGet(`${ BASE }/lists`).reply(lists)

      const result = await service.getLists()

      expect(result).toEqual(lists)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })
  })

  describe('getList', () => {
    it('sends GET to /lists/{listId}', async () => {
      const list = { id: 123, name: 'Deal Flow', fields: [] }
      mock.onGet(`${ BASE }/lists/123`).reply(list)

      const result = await service.getList('123')

      expect(result).toEqual(list)
      expect(mock.history[0].url).toBe(`${ BASE }/lists/123`)
    })
  })

  describe('getListEntries', () => {
    it('sends GET with pagination params', async () => {
      const response = { list_entries: [], next_page_token: 'abc' }
      mock.onGet(`${ BASE }/lists/123/list-entries`).reply(response)

      const result = await service.getListEntries('123', 10, 'tok')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ page_size: 10, page_token: 'tok' })
    })

    it('sends request without optional params', async () => {
      mock.onGet(`${ BASE }/lists/123/list-entries`).reply({ list_entries: [] })

      await service.getListEntries('123')

      expect(mock.history[0].query).toMatchObject({})
    })
  })

  describe('createListEntry', () => {
    it('sends POST with entity_id as number', async () => {
      const response = { id: 1001, list_id: 123, entity_id: 2002 }
      mock.onPost(`${ BASE }/lists/123/list-entries`).reply(response)

      const result = await service.createListEntry('123', '2002')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ entity_id: 2002 })
    })

    it('includes creator_id when provided', async () => {
      mock.onPost(`${ BASE }/lists/123/list-entries`).reply({ id: 1001 })

      await service.createListEntry('123', '2002', '456')

      expect(mock.history[0].body).toEqual({ entity_id: 2002, creator_id: 456 })
    })
  })

  describe('deleteListEntry', () => {
    it('sends DELETE to /lists/{listId}/list-entries/{entryId}', async () => {
      mock.onDelete(`${ BASE }/lists/123/list-entries/1001`).reply({ success: true })

      const result = await service.deleteListEntry('123', '1001')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Persons ──

  describe('getPersons', () => {
    it('sends GET with all params', async () => {
      const response = { persons: [], next_page_token: null }
      mock.onGet(`${ BASE }/persons`).reply(response)

      const result = await service.getPersons('Jane', 10, 'tok', true)

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        term: 'Jane',
        page_size: 10,
        page_token: 'tok',
        with_interaction_dates: true,
      })
    })

    it('omits with_interaction_dates when false', async () => {
      mock.onGet(`${ BASE }/persons`).reply({ persons: [] })

      await service.getPersons(undefined, undefined, undefined, false)

      expect(mock.history[0].query.with_interaction_dates).toBeUndefined()
    })
  })

  describe('searchPersons', () => {
    it('sends GET with term and pageSize', async () => {
      mock.onGet(`${ BASE }/persons`).reply({ persons: [{ id: 1 }] })

      await service.searchPersons('Jane', 5)

      expect(mock.history[0].query).toMatchObject({ term: 'Jane', page_size: 5 })
    })
  })

  describe('getPerson', () => {
    it('sends GET to /persons/{id}', async () => {
      const person = { id: 2002, first_name: 'Jane' }
      mock.onGet(`${ BASE }/persons/2002`).reply(person)

      const result = await service.getPerson('2002')

      expect(result).toEqual(person)
    })

    it('includes with_interaction_dates when true', async () => {
      mock.onGet(`${ BASE }/persons/2002`).reply({ id: 2002 })

      await service.getPerson('2002', true)

      expect(mock.history[0].query).toMatchObject({ with_interaction_dates: true })
    })
  })

  describe('createPerson', () => {
    it('sends POST with required fields', async () => {
      const response = { id: 2002, first_name: 'Jane', last_name: 'Doe' }
      mock.onPost(`${ BASE }/persons`).reply(response)

      const result = await service.createPerson('Jane', 'Doe', ['jane@acme.com'])

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        emails: ['jane@acme.com'],
      })
    })

    it('includes organization_ids when provided as comma-separated string', async () => {
      mock.onPost(`${ BASE }/persons`).reply({ id: 2002 })

      await service.createPerson('Jane', 'Doe', 'jane@acme.com', '100, 200')

      expect(mock.history[0].body).toMatchObject({
        emails: ['jane@acme.com'],
        organization_ids: [100, 200],
      })
    })
  })

  describe('updatePerson', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ BASE }/persons/2002`).reply({ id: 2002, first_name: 'Janet' })

      await service.updatePerson('2002', 'Janet')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ first_name: 'Janet' })
    })

    it('omits unchanged fields', async () => {
      mock.onPut(`${ BASE }/persons/2002`).reply({ id: 2002 })

      await service.updatePerson('2002')

      expect(mock.history[0].body.first_name).toBeUndefined()
      expect(mock.history[0].body.last_name).toBeUndefined()
      expect(mock.history[0].body.emails).toBeUndefined()
      expect(mock.history[0].body.organization_ids).toBeUndefined()
    })
  })

  describe('deletePerson', () => {
    it('sends DELETE to /persons/{id}', async () => {
      mock.onDelete(`${ BASE }/persons/2002`).reply({ success: true })

      const result = await service.deletePerson('2002')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Organizations ──

  describe('getOrganizations', () => {
    it('sends GET with all params', async () => {
      mock.onGet(`${ BASE }/organizations`).reply({ organizations: [] })

      await service.getOrganizations('Acme', 10, 'tok', true)

      expect(mock.history[0].query).toMatchObject({
        term: 'Acme',
        page_size: 10,
        page_token: 'tok',
        with_interaction_dates: true,
      })
    })
  })

  describe('searchOrganizations', () => {
    it('sends GET with term and pageSize', async () => {
      mock.onGet(`${ BASE }/organizations`).reply({ organizations: [] })

      await service.searchOrganizations('Acme', 5)

      expect(mock.history[0].query).toMatchObject({ term: 'Acme', page_size: 5 })
    })
  })

  describe('getOrganization', () => {
    it('sends GET to /organizations/{id}', async () => {
      const org = { id: 3003, name: 'Acme' }
      mock.onGet(`${ BASE }/organizations/3003`).reply(org)

      const result = await service.getOrganization('3003')

      expect(result).toEqual(org)
    })

    it('includes with_interaction_dates when true', async () => {
      mock.onGet(`${ BASE }/organizations/3003`).reply({ id: 3003 })

      await service.getOrganization('3003', true)

      expect(mock.history[0].query).toMatchObject({ with_interaction_dates: true })
    })
  })

  describe('createOrganization', () => {
    it('sends POST with name and domain', async () => {
      mock.onPost(`${ BASE }/organizations`).reply({ id: 3003, name: 'Acme' })

      await service.createOrganization('Acme', 'acme.com')

      expect(mock.history[0].body).toEqual({ name: 'Acme', domain: 'acme.com' })
    })

    it('includes person_ids when provided', async () => {
      mock.onPost(`${ BASE }/organizations`).reply({ id: 3003 })

      await service.createOrganization('Acme', 'acme.com', '100,200')

      expect(mock.history[0].body).toMatchObject({ person_ids: [100, 200] })
    })
  })

  describe('updateOrganization', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ BASE }/organizations/3003`).reply({ id: 3003 })

      await service.updateOrganization('3003', 'New Name', 'new.com')

      expect(mock.history[0].body).toMatchObject({ name: 'New Name', domain: 'new.com' })
    })
  })

  describe('deleteOrganization', () => {
    it('sends DELETE to /organizations/{id}', async () => {
      mock.onDelete(`${ BASE }/organizations/3003`).reply({ success: true })

      const result = await service.deleteOrganization('3003')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Opportunities ──

  describe('getOpportunities', () => {
    it('sends GET with search and pagination', async () => {
      mock.onGet(`${ BASE }/opportunities`).reply({ opportunities: [] })

      await service.getOpportunities('deal', 10, 'tok')

      expect(mock.history[0].query).toMatchObject({ term: 'deal', page_size: 10, page_token: 'tok' })
    })
  })

  describe('getOpportunity', () => {
    it('sends GET to /opportunities/{id}', async () => {
      const opp = { id: 4004, name: 'Series A' }
      mock.onGet(`${ BASE }/opportunities/4004`).reply(opp)

      const result = await service.getOpportunity('4004')

      expect(result).toEqual(opp)
    })
  })

  describe('createOpportunity', () => {
    it('sends POST with name and list_id as number', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 4004 })

      await service.createOpportunity('Series A', '123')

      expect(mock.history[0].body).toEqual({ name: 'Series A', list_id: 123 })
    })

    it('includes person_ids and organization_ids when provided', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 4004 })

      await service.createOpportunity('Series A', '123', ['100'], ['200'])

      expect(mock.history[0].body).toMatchObject({
        person_ids: [100],
        organization_ids: [200],
      })
    })
  })

  describe('updateOpportunity', () => {
    it('sends PUT with updated name', async () => {
      mock.onPut(`${ BASE }/opportunities/4004`).reply({ id: 4004 })

      await service.updateOpportunity('4004', 'Series B')

      expect(mock.history[0].body).toMatchObject({ name: 'Series B' })
    })
  })

  describe('deleteOpportunity', () => {
    it('sends DELETE to /opportunities/{id}', async () => {
      mock.onDelete(`${ BASE }/opportunities/4004`).reply({ success: true })

      const result = await service.deleteOpportunity('4004')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Fields & Field Values ──

  describe('getFields', () => {
    it('sends GET with no filters', async () => {
      mock.onGet(`${ BASE }/fields`).reply([{ id: 789, name: 'Status' }])

      const result = await service.getFields()

      expect(result).toEqual([{ id: 789, name: 'Status' }])
    })

    it('resolves entity type label to numeric value', async () => {
      mock.onGet(`${ BASE }/fields`).reply([])

      await service.getFields('123', 'Person', 'Number')

      expect(mock.history[0].query).toMatchObject({
        list_id: '123',
        entity_type: 0,
        value_type: 3,
      })
    })

    it('resolves Organization entity type', async () => {
      mock.onGet(`${ BASE }/fields`).reply([])

      await service.getFields(undefined, 'Organization')

      expect(mock.history[0].query).toMatchObject({ entity_type: 1 })
    })

    it('resolves Opportunity entity type', async () => {
      mock.onGet(`${ BASE }/fields`).reply([])

      await service.getFields(undefined, 'Opportunity')

      expect(mock.history[0].query).toMatchObject({ entity_type: 8 })
    })

    it('passes through unknown entity type values', async () => {
      mock.onGet(`${ BASE }/fields`).reply([])

      await service.getFields(undefined, '99')

      expect(mock.history[0].query).toMatchObject({ entity_type: '99' })
    })
  })

  describe('getFieldValues', () => {
    it('sends GET with person_id', async () => {
      mock.onGet(`${ BASE }/field-values`).reply([{ id: 5005 }])

      await service.getFieldValues('2002')

      expect(mock.history[0].query).toMatchObject({ person_id: '2002' })
    })

    it('sends GET with organization_id', async () => {
      mock.onGet(`${ BASE }/field-values`).reply([])

      await service.getFieldValues(undefined, '3003')

      expect(mock.history[0].query).toMatchObject({ organization_id: '3003' })
    })
  })

  describe('createFieldValue', () => {
    it('sends POST with numeric coercion for value', async () => {
      mock.onPost(`${ BASE }/field-values`).reply({ id: 5005 })

      await service.createFieldValue('789', '2002', '42')

      expect(mock.history[0].body).toEqual({
        field_id: 789,
        entity_id: 2002,
        value: 42,
      })
    })

    it('keeps string value for non-numeric values', async () => {
      mock.onPost(`${ BASE }/field-values`).reply({ id: 5005 })

      await service.createFieldValue('789', '2002', 'Lead')

      expect(mock.history[0].body).toMatchObject({ value: 'Lead' })
    })

    it('includes list_entry_id when provided', async () => {
      mock.onPost(`${ BASE }/field-values`).reply({ id: 5005 })

      await service.createFieldValue('789', '2002', 'Lead', '1001')

      expect(mock.history[0].body).toMatchObject({ list_entry_id: 1001 })
    })
  })

  describe('updateFieldValue', () => {
    it('sends PUT with coerced value', async () => {
      mock.onPut(`${ BASE }/field-values/5005`).reply({ id: 5005, value: 99 })

      await service.updateFieldValue('5005', '99')

      expect(mock.history[0].body).toEqual({ value: 99 })
    })

    it('sends PUT with string value', async () => {
      mock.onPut(`${ BASE }/field-values/5005`).reply({ id: 5005 })

      await service.updateFieldValue('5005', 'Qualified')

      expect(mock.history[0].body).toEqual({ value: 'Qualified' })
    })
  })

  describe('deleteFieldValue', () => {
    it('sends DELETE to /field-values/{id}', async () => {
      mock.onDelete(`${ BASE }/field-values/5005`).reply({ success: true })

      const result = await service.deleteFieldValue('5005')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Notes ──

  describe('getNotes', () => {
    it('sends GET with entity and pagination filters', async () => {
      mock.onGet(`${ BASE }/notes`).reply({ notes: [], next_page_token: null })

      await service.getNotes('2002', undefined, undefined, 10, 'tok')

      expect(mock.history[0].query).toMatchObject({
        person_id: '2002',
        page_size: 10,
        page_token: 'tok',
      })
    })
  })

  describe('createNote', () => {
    it('sends POST with content and association ids', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 6006, content: 'Hello' })

      await service.createNote('Hello', ['2002'], ['3003'], ['4004'])

      expect(mock.history[0].body).toEqual({
        content: 'Hello',
        person_ids: [2002],
        organization_ids: [3003],
        opportunity_ids: [4004],
      })
    })

    it('sends POST with content only', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 6006 })

      await service.createNote('Hello')

      expect(mock.history[0].body).toEqual({ content: 'Hello' })
    })
  })

  // ── Interactions ──

  describe('getInteractions', () => {
    it('sends GET with type resolved to numeric value', async () => {
      mock.onGet(`${ BASE }/interactions`).reply({ emails: [] })

      await service.getInteractions('Email', '2024-01-01', '2024-12-31', '2002')

      expect(mock.history[0].query).toMatchObject({
        type: 3,
        start_time: '2024-01-01',
        end_time: '2024-12-31',
        person_id: '2002',
      })
    })

    it('resolves Meeting type to 0', async () => {
      mock.onGet(`${ BASE }/interactions`).reply({ meetings: [] })

      await service.getInteractions('Meeting')

      expect(mock.history[0].query).toMatchObject({ type: 0 })
    })

    it('resolves Call type to 1', async () => {
      mock.onGet(`${ BASE }/interactions`).reply({})

      await service.getInteractions('Call')

      expect(mock.history[0].query).toMatchObject({ type: 1 })
    })

    it('resolves Chat Message type to 2', async () => {
      mock.onGet(`${ BASE }/interactions`).reply({})

      await service.getInteractions('Chat Message')

      expect(mock.history[0].query).toMatchObject({ type: 2 })
    })
  })

  // ── Triggers ──

  describe('onAffinityEvent', () => {
    it('shapes event data from webhook payload', () => {
      const payload = { type: 'person.created', sent_at: '2024-01-15', body: { id: 1 } }

      const result = service.onAffinityEvent('SHAPE_EVENT', payload)

      expect(result).toEqual([{
        name: 'onAffinityEvent',
        data: { type: 'person.created', sentAt: '2024-01-15', body: { id: 1 } },
      }])
    })

    it('filters triggers matching event type', () => {
      const payload = {
        eventData: { type: 'person.created' },
        triggers: [
          { id: 'a', data: { event: 'person.created' } },
          { id: 'b', data: { event: 'organization.created' } },
        ],
      }

      const result = service.onAffinityEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['a'] })
    })

    it('returns empty ids when no triggers match', () => {
      const payload = {
        eventData: { type: 'person.deleted' },
        triggers: [
          { id: 'a', data: { event: 'person.created' } },
        ],
      }

      const result = service.onAffinityEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('subscribes webhooks for each event', async () => {
      mock.onPost(`${ BASE }/webhook/subscribe`).reply({ id: 'wh-1' })

      const invocation = {
        callbackUrl: 'https://flowrunner.com/callback',
        connectionId: 'conn-1',
        events: [
          { id: 'trigger-1', triggerData: { event: 'person.created' } },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        webhook_url: 'https://flowrunner.com/callback?connectionId=conn-1',
        subscriptions: ['person.created'],
      })
      expect(result).toEqual({
        webhookData: {
          webhooks: [{ triggerId: 'trigger-1', webhookId: 'wh-1', event: 'person.created' }],
        },
        connectionId: 'conn-1',
      })
    })

    it('appends connectionId with & when URL already has query params', async () => {
      mock.onPost(`${ BASE }/webhook/subscribe`).reply({ id: 'wh-2' })

      const invocation = {
        callbackUrl: 'https://flowrunner.com/callback?foo=bar',
        connectionId: 'conn-2',
        events: [{ id: 't1', triggerData: { event: 'note.created' } }],
      }

      await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history[0].body.webhook_url).toBe('https://flowrunner.com/callback?foo=bar&connectionId=conn-2')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns handshake when body is missing', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('resolves events from webhook body', async () => {
      const invocation = {
        body: { type: 'person.created', sent_at: '2024-01-15', body: { id: 1 } },
        queryParams: { connectionId: 'conn-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toEqual([{
        name: 'onAffinityEvent',
        data: { type: 'person.created', sentAt: '2024-01-15', body: { id: 1 } },
      }])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named event method', async () => {
      const invocation = {
        eventName: 'onAffinityEvent',
        eventData: { type: 'person.created' },
        triggers: [{ id: 'a', data: { event: 'person.created' } }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['a'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all registered webhooks', async () => {
      mock.onDelete(`${ BASE }/webhook/wh-1`).reply({})
      mock.onDelete(`${ BASE }/webhook/wh-2`).reply({})

      const invocation = {
        webhookData: {
          webhooks: [{ webhookId: 'wh-1' }, { webhookId: 'wh-2' }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips webhooks without webhookId', async () => {
      const invocation = {
        webhookData: {
          webhooks: [{ webhookId: null }, { webhookId: undefined }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })

    it('continues deleting when one fails', async () => {
      mock.onDelete(`${ BASE }/webhook/wh-1`).replyWithError({ message: 'Not found' })
      mock.onDelete(`${ BASE }/webhook/wh-2`).reply({})

      const invocation = {
        webhookData: {
          webhooks: [{ webhookId: 'wh-1' }, { webhookId: 'wh-2' }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })
  })

  // ── Dictionaries ──

  describe('getListsDictionary', () => {
    it('returns items with label, value, and note', async () => {
      mock.onGet(`${ BASE }/lists`).reply([
        { id: 1, name: 'Deal Flow', type: 8 },
        { id: 2, name: 'People', type: 0 },
      ])

      const result = await service.getListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Deal Flow', value: '1', note: 'Opportunity list' },
        { label: 'People', value: '2', note: 'Person list' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term case-insensitively', async () => {
      mock.onGet(`${ BASE }/lists`).reply([
        { id: 1, name: 'Deal Flow', type: 8 },
        { id: 2, name: 'People', type: 0 },
      ])

      const result = await service.getListsDictionary({ search: 'deal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Deal Flow')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(`${ BASE }/lists`).reply([{ id: 1, name: 'Test', type: 1 }])

      const result = await service.getListsDictionary({ search: '' })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns field items with value type labels', async () => {
      mock.onGet(`${ BASE }/fields`).reply([
        { id: 789, name: 'Status', value_type: 7 },
        { id: 790, name: 'Revenue', value_type: 3 },
      ])

      const result = await service.getFieldsDictionary({})

      expect(result.items).toEqual([
        { label: 'Status', value: '789', note: 'Ranked Dropdown' },
        { label: 'Revenue', value: '790', note: 'Number' },
      ])
    })

    it('passes listId from criteria to getFields', async () => {
      mock.onGet(`${ BASE }/fields`).reply([])

      await service.getFieldsDictionary({ criteria: { listId: '123' } })

      expect(mock.history[0].query).toMatchObject({ list_id: '123' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/fields`).reply([
        { id: 1, name: 'Status', value_type: 7 },
        { id: 2, name: 'Revenue', value_type: 3 },
      ])

      const result = await service.getFieldsDictionary({ search: 'rev' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Revenue')
    })
  })
})
