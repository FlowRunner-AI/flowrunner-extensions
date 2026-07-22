'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SUBDOMAIN = 'acme'
const EMAIL = 'agent@acme.com'
const API_TOKEN = 'test-api-token'
const BASE = `https://${ SUBDOMAIN }.zendesk.com/api/v2`

const AUTH_HEADER = `Basic ${ Buffer.from(`${ EMAIL }/token:${ API_TOKEN }`).toString('base64') }`

describe('Zendesk Service', () => {
  let sandbox
  let service
  let mock
  let mainRuntime

  beforeAll(() => {
    sandbox = createSandbox({ subdomain: SUBDOMAIN, email: EMAIL, apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    mainRuntime = global.Flowrunner
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['subdomain', 'email', 'apiToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'subdomain', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'email', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiToken', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('builds the base URL from a bare subdomain', () => {
      expect(service.baseUrl).toBe(BASE)
    })
  })

  describe('subdomain normalization', () => {
    // Registers the service in an isolated module registry so a fresh instance is
    // built from the given config, then restores the shared sandbox global.
    function baseUrlFor(config) {
      const localSandbox = createSandbox(config)

      try {
        jest.isolateModules(() => {
          require('../src/index.js')
        })

        return localSandbox.getService().baseUrl
      } finally {
        localSandbox.cleanup()
        global.Flowrunner = mainRuntime
      }
    }

    it.each([
      ['acme'],
      ['acme.zendesk.com'],
      ['https://acme.zendesk.com'],
      ['http://acme.zendesk.com/agent/tickets/1'],
      ['  acme  '],
    ])('normalizes "%s" to the API base URL', input => {
      expect(baseUrlFor({ subdomain: input, email: EMAIL, apiToken: API_TOKEN })).toBe(BASE)
    })

    it('tolerates a missing config object', () => {
      expect(baseUrlFor(undefined)).toBe('https://.zendesk.com/api/v2')
    })
  })

  // ── Tickets ──

  describe('createTicket', () => {
    it('sends the full ticket payload with mapped choices', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 35436 } })

      const result = await service.createTicket(
        'Printer on fire',
        'It is on fire.',
        '<p>It is on fire.</p>',
        false,
        'Urgent',
        'Incident',
        'Open',
        'jane@example.com',
        'Jane Doe',
        '235323',
        '98738',
        ['printer', 'urgent'],
        [{ id: 360001234567, value: 'gold' }]
      )

      expect(result).toEqual({ id: 35436 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/tickets.json`)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toEqual({
        ticket: {
          subject: 'Printer on fire',
          comment: { body: 'It is on fire.', html_body: '<p>It is on fire.</p>', public: false },
          priority: 'urgent',
          type: 'incident',
          status: 'open',
          assignee_id: 235323,
          group_id: 98738,
          tags: ['printer', 'urgent'],
          custom_fields: [{ id: 360001234567, value: 'gold' }],
          requester: { email: 'jane@example.com', name: 'Jane Doe' },
        },
      })
    })

    it('omits optional fields when only the required ones are supplied', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 1 } })

      await service.createTicket('Subject', 'Body')

      expect(mock.history[0].body).toEqual({
        ticket: { subject: 'Subject', comment: { body: 'Body' } },
      })
    })

    it('accepts a comma-separated tags string', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 1 } })

      await service.createTicket('Subject', 'Body', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'billing, vip')

      expect(mock.history[0].body.ticket.tags).toEqual(['billing', 'vip'])
    })

    it('drops an empty custom fields array and empty tag lists', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 1 } })

      await service.createTicket('Subject', 'Body', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [], [])

      expect(mock.history[0].body.ticket.tags).toBeUndefined()
      expect(mock.history[0].body.ticket.custom_fields).toBeUndefined()
    })

    it('passes unmapped choice values through unchanged', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 1 } })

      await service.createTicket('Subject', 'Body', undefined, undefined, 'urgent', 'incident', 'solved')

      expect(mock.history[0].body.ticket).toMatchObject({
        priority: 'urgent',
        type: 'incident',
        status: 'solved',
      })
    })

    it('adds a requester without a name', async () => {
      mock.onPost(`${ BASE }/tickets.json`).reply({ ticket: { id: 1 } })

      await service.createTicket('Subject', 'Body', undefined, undefined, undefined, undefined, undefined, 'jane@example.com')

      expect(mock.history[0].body.ticket.requester).toEqual({ email: 'jane@example.com' })
    })
  })

  describe('getTicket', () => {
    it('sends GET and unwraps the ticket', async () => {
      mock.onGet(`${ BASE }/tickets/35436.json`).reply({ ticket: { id: 35436, subject: 'Printer' } })

      const result = await service.getTicket(35436)

      expect(result).toEqual({ id: 35436, subject: 'Printer' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('listTickets', () => {
    it('applies mapped sort defaults and a default page size', async () => {
      mock.onGet(`${ BASE }/tickets.json`).reply({ tickets: [{ id: 1 }], count: 1 })

      const result = await service.listTickets('Created At', 'Descending')

      expect(result).toEqual({ tickets: [{ id: 1 }], count: 1, nextPage: null })

      expect(mock.history[0].query).toEqual({
        sort_by: 'created_at',
        sort_order: 'desc',
        per_page: 100,
      })
    })

    it('passes custom paging and extracts the next page cursor', async () => {
      mock.onGet(`${ BASE }/tickets.json`).reply({
        tickets: [],
        count: 101,
        next_page: `${ BASE }/tickets.json?page=2&per_page=50`,
      })

      const result = await service.listTickets('Updated At', 'Ascending', 50, 1)

      expect(result.nextPage).toBe('2')

      expect(mock.history[0].query).toEqual({
        sort_by: 'updated_at',
        sort_order: 'asc',
        per_page: 50,
        page: 1,
      })
    })

    it('defaults to an empty ticket list and a null cursor', async () => {
      mock.onGet(`${ BASE }/tickets.json`).reply({})

      const result = await service.listTickets()

      expect(result).toEqual({ tickets: [], count: undefined, nextPage: null })
      expect(mock.history[0].query).toEqual({ per_page: 100 })
    })

    it('returns a null cursor when next_page has no page parameter', async () => {
      mock.onGet(`${ BASE }/tickets.json`).reply({ tickets: [], next_page: 'https://acme.zendesk.com/next' })

      const result = await service.listTickets()

      expect(result.nextPage).toBeNull()
    })
  })

  describe('updateTicket', () => {
    it('sends PUT with only the provided fields', async () => {
      mock.onPut(`${ BASE }/tickets/35436.json`).reply({ ticket: { id: 35436, status: 'solved' } })

      const result = await service.updateTicket(35436, undefined, 'Solved')

      expect(result).toEqual({ id: 35436, status: 'solved' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ ticket: { status: 'solved' } })
    })

    it('sends every field when provided', async () => {
      mock.onPut(`${ BASE }/tickets/35436.json`).reply({ ticket: { id: 35436 } })

      await service.updateTicket(35436, 'New subject', 'Pending', 'High', 'Task', '235323', '98738', ['a', 'b'])

      expect(mock.history[0].body).toEqual({
        ticket: {
          subject: 'New subject',
          status: 'pending',
          priority: 'high',
          type: 'task',
          assignee_id: 235323,
          group_id: 98738,
          tags: ['a', 'b'],
        },
      })
    })
  })

  describe('addCommentToTicket', () => {
    it('defaults the comment to public and includes the status', async () => {
      mock.onPut(`${ BASE }/tickets/35436.json`).reply({ ticket: { id: 35436 } })

      const result = await service.addCommentToTicket(35436, 'On it')

      expect(result).toEqual({ id: 35436 })
      expect(mock.history[0].body).toEqual({ ticket: { comment: { body: 'On it', public: true } } })
    })

    it('supports private notes, HTML bodies and a status change', async () => {
      mock.onPut(`${ BASE }/tickets/35436.json`).reply({ ticket: { id: 35436 } })

      await service.addCommentToTicket(35436, 'internal', '<b>internal</b>', false, 'Solved')

      expect(mock.history[0].body).toEqual({
        ticket: {
          comment: { body: 'internal', html_body: '<b>internal</b>', public: false },
          status: 'solved',
        },
      })
    })
  })

  describe('deleteTicket', () => {
    it('sends DELETE and returns a confirmation', async () => {
      mock.onDelete(`${ BASE }/tickets/35436.json`).reply({})

      const result = await service.deleteTicket('35436')

      expect(result).toEqual({ deleted: true, ticketId: 35436 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/tickets/35436.json`)
    })
  })

  describe('searchTickets', () => {
    it('prefixes the query with type:ticket', async () => {
      mock.onGet(`${ BASE }/search.json`).reply({ results: [{ id: 1 }], count: 1 })

      const result = await service.searchTickets('printer status:open')

      expect(result).toEqual({ results: [{ id: 1 }], count: 1, nextPage: null })
      expect(mock.history[0].query).toEqual({ query: 'type:ticket printer status:open', per_page: 100 })
    })

    it('does not duplicate an existing type:ticket filter', async () => {
      mock.onGet(`${ BASE }/search.json`).reply({ results: [] })

      await service.searchTickets('type:ticket printer')

      expect(mock.history[0].query.query).toBe('type:ticket printer')
    })

    it('maps sort options and paging', async () => {
      mock.onGet(`${ BASE }/search.json`).reply({ results: [], count: 0, next_page: '?page=3' })

      const result = await service.searchTickets('printer', 'Ticket Type', 'Ascending', 25, 2)

      expect(result.nextPage).toBe('3')

      expect(mock.history[0].query).toEqual({
        query: 'type:ticket printer',
        sort_by: 'ticket_type',
        sort_order: 'asc',
        per_page: 25,
        page: 2,
      })
    })
  })

  describe('listTicketComments', () => {
    it('sends default paging and normalizes the response', async () => {
      mock.onGet(`${ BASE }/tickets/35436/comments.json`).reply({ comments: [{ id: 1274 }], count: 1 })

      const result = await service.listTicketComments(35436)

      expect(result).toEqual({ comments: [{ id: 1274 }], count: 1, nextPage: null })
      expect(mock.history[0].query).toEqual({ per_page: 100 })
    })

    it('passes custom paging', async () => {
      mock.onGet(`${ BASE }/tickets/35436/comments.json`).reply({})

      const result = await service.listTicketComments(35436, 10, 2)

      expect(result.comments).toEqual([])
      expect(mock.history[0].query).toEqual({ per_page: 10, page: 2 })
    })
  })

  // ── Users ──

  describe('createUser', () => {
    it('maps the role label and sends all fields', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ user: { id: 20978392 } })

      const result = await service.createUser('Jane Doe', 'jane@example.com', 'End User', '+14155550100', '57542')

      expect(result).toEqual({ id: 20978392 })

      expect(mock.history[0].body).toEqual({
        user: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'end-user',
          phone: '+14155550100',
          organization_id: 57542,
        },
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ user: { id: 1 } })

      await service.createUser('Jane Doe', 'jane@example.com')

      expect(mock.history[0].body).toEqual({ user: { name: 'Jane Doe', email: 'jane@example.com' } })
    })

    it('maps the Agent and Admin roles', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ user: { id: 1 } })

      await service.createUser('A', 'a@example.com', 'Agent')
      await service.createUser('B', 'b@example.com', 'Admin')

      expect(mock.history[0].body.user.role).toBe('agent')
      expect(mock.history[1].body.user.role).toBe('admin')
    })
  })

  describe('getUser', () => {
    it('sends GET and unwraps the user', async () => {
      mock.onGet(`${ BASE }/users/20978392.json`).reply({ user: { id: 20978392 } })

      const result = await service.getUser(20978392)

      expect(result).toEqual({ id: 20978392 })
    })
  })

  describe('searchUsers', () => {
    it('sends the query with a default page size', async () => {
      mock.onGet(`${ BASE }/users/search.json`).reply({ users: [{ id: 1 }], count: 1 })

      const result = await service.searchUsers('jane@example.com')

      expect(result).toEqual({ users: [{ id: 1 }], count: 1, nextPage: null })
      expect(mock.history[0].query).toEqual({ query: 'jane@example.com', per_page: 100 })
    })

    it('passes custom paging and defaults an empty result set', async () => {
      mock.onGet(`${ BASE }/users/search.json`).reply({})

      const result = await service.searchUsers('jane', 20, 3)

      expect(result.users).toEqual([])
      expect(mock.history[0].query).toEqual({ query: 'jane', per_page: 20, page: 3 })
    })
  })

  describe('updateUser', () => {
    it('sends PUT with only the provided fields', async () => {
      mock.onPut(`${ BASE }/users/20978392.json`).reply({ user: { id: 20978392, name: 'Jane Smith' } })

      const result = await service.updateUser(20978392, 'Jane Smith')

      expect(result).toEqual({ id: 20978392, name: 'Jane Smith' })
      expect(mock.history[0].body).toEqual({ user: { name: 'Jane Smith' } })
    })

    it('sends all fields when provided', async () => {
      mock.onPut(`${ BASE }/users/20978392.json`).reply({ user: { id: 1 } })

      await service.updateUser(20978392, 'Jane', 'jane@example.com', 'Admin', '+1415', 57542)

      expect(mock.history[0].body).toEqual({
        user: {
          name: 'Jane',
          email: 'jane@example.com',
          role: 'admin',
          phone: '+1415',
          organization_id: 57542,
        },
      })
    })
  })

  describe('listAgents', () => {
    it('filters by the agent role with a default page size', async () => {
      mock.onGet(`${ BASE }/users.json`).reply({ users: [{ id: 235323 }], count: 1 })

      const result = await service.listAgents()

      expect(result).toEqual({ users: [{ id: 235323 }], count: 1, nextPage: null })
      expect(mock.history[0].query).toEqual({ role: 'agent', per_page: 100 })
    })

    it('passes custom paging', async () => {
      mock.onGet(`${ BASE }/users.json`).reply({ users: [] })

      await service.listAgents(10, 2)

      expect(mock.history[0].query).toEqual({ role: 'agent', per_page: 10, page: 2 })
    })
  })

  // ── Organizations ──

  describe('createOrganization', () => {
    it('sends all organization fields', async () => {
      mock.onPost(`${ BASE }/organizations.json`).reply({ organization: { id: 57542 } })

      const result = await service.createOrganization('Acme Inc', ['acme.com'], '123 Main St', 'Enterprise', ['vip'])

      expect(result).toEqual({ id: 57542 })

      expect(mock.history[0].body).toEqual({
        organization: {
          name: 'Acme Inc',
          domain_names: ['acme.com'],
          details: '123 Main St',
          notes: 'Enterprise',
          tags: ['vip'],
        },
      })
    })

    it('accepts comma-separated domain names and omits optional fields', async () => {
      mock.onPost(`${ BASE }/organizations.json`).reply({ organization: { id: 1 } })

      await service.createOrganization('Acme Inc', 'acme.com, acme.org')

      expect(mock.history[0].body).toEqual({
        organization: { name: 'Acme Inc', domain_names: ['acme.com', 'acme.org'] },
      })
    })
  })

  describe('listOrganizations', () => {
    it('sends default paging and normalizes the response', async () => {
      mock.onGet(`${ BASE }/organizations.json`).reply({ organizations: [{ id: 57542 }], count: 1 })

      const result = await service.listOrganizations()

      expect(result).toEqual({ organizations: [{ id: 57542 }], count: 1, nextPage: null })
      expect(mock.history[0].query).toEqual({ per_page: 100 })
    })

    it('passes custom paging and defaults an empty list', async () => {
      mock.onGet(`${ BASE }/organizations.json`).reply({})

      const result = await service.listOrganizations(5, 2)

      expect(result.organizations).toEqual([])
      expect(mock.history[0].query).toEqual({ per_page: 5, page: 2 })
    })
  })

  describe('getOrganization', () => {
    it('sends GET and unwraps the organization', async () => {
      mock.onGet(`${ BASE }/organizations/57542.json`).reply({ organization: { id: 57542 } })

      const result = await service.getOrganization(57542)

      expect(result).toEqual({ id: 57542 })
    })
  })

  // ── Trigger — event shaping & filtering ──

  describe('onTicketEvent', () => {
    const inbound = {
      event: 'created',
      ticketId: '35436',
      subject: 'Printer on fire',
      status: 'Open',
      priority: 'Urgent',
      type: 'Incident',
      requesterEmail: 'jane@example.com',
      requesterName: 'Jane Doe',
      assigneeEmail: 'alex@acme.com',
      ticketUrl: 'https://acme.zendesk.com/agent/tickets/35436',
      extra: 'ignored',
    }

    it('shapes an inbound webhook body into a trigger event', () => {
      const events = service.onTicketEvent('SHAPE_EVENT', inbound)

      expect(events).toHaveLength(1)
      expect(events[0].name).toBe('onTicketEvent')

      expect(events[0].data).toEqual({
        event: 'created',
        ticketId: '35436',
        subject: 'Printer on fire',
        status: 'Open',
        priority: 'Urgent',
        type: 'Incident',
        requesterEmail: 'jane@example.com',
        requesterName: 'Jane Doe',
        assigneeEmail: 'alex@acme.com',
        ticketUrl: 'https://acme.zendesk.com/agent/tickets/35436',
      })
    })

    it('selects only triggers whose configured event matches', () => {
      const result = service.onTicketEvent('FILTER_TRIGGER', {
        eventData: { event: 'created' },
        triggers: [
          { id: 't1', data: { event: 'Ticket Created' } },
          { id: 't2', data: { event: 'Ticket Updated' } },
        ],
      })

      expect(result).toEqual({ ids: ['t1'] })
    })

    it('falls back to payload.data and an empty trigger list', () => {
      expect(service.onTicketEvent('FILTER_TRIGGER', {
        data: { event: 'updated' },
        triggers: [{ id: 't2', data: { event: 'Ticket Updated' } }],
      })).toEqual({ ids: ['t2'] })

      expect(service.onTicketEvent('FILTER_TRIGGER', {})).toEqual({ ids: [] })
    })

    it('returns undefined for an unknown call type', () => {
      expect(service.onTicketEvent('UNKNOWN', {})).toBeUndefined()
    })
  })

  // ── Trigger — SYSTEM handlers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a webhook and a business-rule trigger per event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-1' } })
      mock.onPost(`${ BASE }/triggers.json`).reply({ trigger: { id: 'zt-1' } })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.io/cb',
        connectionId: 'conn-1',
        events: [{ id: 'ev-1', triggerData: { event: 'Ticket Created' } }],
      })

      expect(result).toEqual({
        webhookData: {
          webhooks: [{ triggerId: 'ev-1', webhookId: 'wh-1', zendeskTriggerId: 'zt-1', event: 'Ticket Created' }],
        },
        connectionId: 'conn-1',
      })

      expect(mock.history).toHaveLength(2)

      expect(mock.history[0].body.webhook).toMatchObject({
        name: 'FlowRunner Ticket Created (ev-1)',
        endpoint: 'https://hooks.flowrunner.io/cb?connectionId=conn-1',
        http_method: 'POST',
        request_format: 'json',
        status: 'active',
        subscriptions: ['conditional_ticket_events'],
      })

      const trigger = mock.history[1].body.trigger

      expect(trigger.title).toBe('FlowRunner Ticket Created (ev-1)')
      expect(trigger.active).toBe(true)
      expect(trigger.conditions.all).toEqual([{ field: 'update_type', operator: 'is', value: 'Create' }])
      expect(trigger.actions[0].field).toBe('notification_webhook')
      expect(trigger.actions[0].value[0]).toBe('wh-1')

      expect(JSON.parse(trigger.actions[0].value[1])).toEqual({
        event: 'created',
        ticketId: '{{ticket.id}}',
        subject: '{{ticket.title}}',
        status: '{{ticket.status}}',
        priority: '{{ticket.priority}}',
        type: '{{ticket.ticket_type}}',
        requesterEmail: '{{ticket.requester.email}}',
        requesterName: '{{ticket.requester.name}}',
        assigneeEmail: '{{ticket.assignee.email}}',
        ticketUrl: '{{ticket.link}}',
      })
    })

    it('appends the connection id with & when the callback URL already has a query', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-1' } })
      mock.onPost(`${ BASE }/triggers.json`).reply({ trigger: { id: 'zt-1' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.io/cb?a=1',
        connectionId: 'conn-2',
        events: [{ id: 'ev-2', triggerData: { event: 'Ticket Updated' } }],
      })

      expect(mock.history[0].body.webhook.endpoint).toBe('https://hooks.flowrunner.io/cb?a=1&connectionId=conn-2')
      expect(mock.history[1].body.trigger.conditions.all[0].value).toBe('Change')
    })

    it('returns an empty webhook list when no events are supplied', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.io/cb',
        connectionId: 'conn-3',
      })

      expect(result).toEqual({ webhookData: { webhooks: [] }, connectionId: 'conn-3' })
      expect(mock.history).toHaveLength(0)
    })

    it('rolls back the webhook when creating the business-rule trigger fails', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ webhook: { id: 'wh-9' } })
      mock.onPost(`${ BASE }/triggers.json`).replyWithError({ message: 'Unprocessable', status: 422 })
      mock.onDelete(`${ BASE }/webhooks/wh-9`).reply({})

      await expect(service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.io/cb',
        connectionId: 'conn-4',
        events: [{ id: 'ev-4', triggerData: { event: 'Ticket Created' } }],
      })).rejects.toThrow('Zendesk API error')

      expect(mock.history.map(call => `${ call.method } ${ call.url }`)).toEqual([
        `post ${ BASE }/webhooks`,
        `post ${ BASE }/triggers.json`,
        `delete ${ BASE }/webhooks/wh-9`,
      ])
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves an inbound delivery into shaped events', async () => {
      const result = await service.handleTriggerResolveEvents({
        queryParams: { connectionId: 'conn-1' },
        body: { event: 'updated', ticketId: '35436', subject: 'Printer' },
      })

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].data).toMatchObject({ event: 'updated', ticketId: '35436', subject: 'Printer' })
    })

    it('treats a body without a ticket id as a handshake', async () => {
      await expect(service.handleTriggerResolveEvents({ body: { ping: true } }))
        .resolves.toEqual({ handshake: true, responseToExternalService: { ping: true } })

      await expect(service.handleTriggerResolveEvents({}))
        .resolves.toEqual({ handshake: true, responseToExternalService: {} })

      await expect(service.handleTriggerResolveEvents(undefined))
        .resolves.toEqual({ handshake: true, responseToExternalService: {} })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named trigger method in filter mode', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onTicketEvent',
        eventData: { event: 'created' },
        triggers: [{ id: 't1', data: { event: 'Ticket Created' } }],
      })

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes the business-rule trigger before the webhook', async () => {
      mock.onDelete(`${ BASE }/triggers/zt-1.json`).reply({})
      mock.onDelete(`${ BASE }/webhooks/wh-1`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh-1', zendeskTriggerId: 'zt-1' }] },
      })

      expect(result).toEqual({ webhookData: {} })

      expect(mock.history.map(call => call.url)).toEqual([
        `${ BASE }/triggers/zt-1.json`,
        `${ BASE }/webhooks/wh-1`,
      ])
    })

    it('swallows cleanup failures', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh-2`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh-2' }] },
      })).resolves.toEqual({ webhookData: {} })
    })

    it('handles missing webhook data', async () => {
      await expect(service.handleTriggerDeleteWebhook({})).resolves.toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Dictionaries ──

  describe('getAgentsDictionary', () => {
    const URL = `${ BASE }/users.json?role[]=agent&role[]=admin`

    it('maps agents to dictionary items', async () => {
      mock.onGet(URL).reply({
        users: [
          { id: 235323, name: 'Alex Agent', email: 'alex@acme.com' },
          { id: 1, name: 'No Email', role: 'admin' },
        ],
      })

      const result = await service.getAgentsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alex Agent', value: '235323', note: 'alex@acme.com' },
          { label: 'No Email', value: '1', note: 'admin' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ per_page: 100 })
    })

    it('filters by case-insensitive search on name or email', async () => {
      mock.onGet(URL).reply({
        users: [
          { id: 1, name: 'Alex Agent', email: 'alex@acme.com' },
          { id: 2, name: 'Bob', email: 'bob@acme.com' },
        ],
      })

      const byName = await service.getAgentsDictionary({ search: 'ALEX' })

      expect(byName.items).toHaveLength(1)
      expect(byName.items[0].value).toBe('1')

      mock.onGet(URL).reply({
        users: [
          { id: 1, name: 'Alex Agent', email: 'alex@acme.com' },
          { id: 2, name: 'Bob', email: 'bob@acme.com' },
        ],
      })

      const byEmail = await service.getAgentsDictionary({ search: 'bob@' })

      expect(byEmail.items).toHaveLength(1)
      expect(byEmail.items[0].value).toBe('2')
    })

    it('handles a null payload and a missing users array', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getAgentsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses the cursor as the page number and returns the next page cursor', async () => {
      mock.onGet(URL).reply({ users: [], next_page: `${ URL }&page=4` })

      const result = await service.getAgentsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toEqual({ per_page: 100, page: 3 })
      expect(result.cursor).toBe('4')
    })
  })

  describe('getGroupsDictionary', () => {
    it('maps groups to dictionary items', async () => {
      mock.onGet(`${ BASE }/groups.json`).reply({ groups: [{ id: 98738, name: 'Support' }] })

      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Support', value: '98738', note: 'Group ID: 98738' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ per_page: 100 })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/groups.json`).reply({
        groups: [{ id: 1, name: 'Support' }, { id: 2, name: 'Billing' }],
      })

      const result = await service.getGroupsDictionary({ search: 'bill' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('handles a null payload and a missing groups array', async () => {
      mock.onGet(`${ BASE }/groups.json`).reply({})

      const result = await service.getGroupsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes the cursor as a page number', async () => {
      mock.onGet(`${ BASE }/groups.json`).reply({ groups: [] })

      await service.getGroupsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toEqual({ per_page: 100, page: 2 })
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('adds a hint for known statuses and surfaces the API message', async () => {
      mock.onGet(`${ BASE }/tickets/1.json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: 'Couldn\'t authenticate you' },
      })

      await expect(service.getTicket(1)).rejects.toThrow(
        /Zendesk API error: Authentication failed .*\(Couldn't authenticate you\)/
      )
    })

    it('joins a structured error object and appends details', async () => {
      mock.onPost(`${ BASE }/users.json`).replyWithError({
        message: 'Unprocessable',
        status: 422,
        body: {
          error: { title: 'RecordInvalid', message: 'Record validation errors' },
          details: { email: ['is already taken'] },
        },
      })

      await expect(service.createUser('Jane', 'jane@example.com')).rejects.toThrow(
        /RecordInvalid: Record validation errors.*Details: \{"email":\["is already taken"\]\}/
      )
    })

    it('falls back to the description field', async () => {
      mock.onGet(`${ BASE }/organizations/1.json`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { description: 'Organization not found' },
      })

      await expect(service.getOrganization(1)).rejects.toThrow('Organization not found')
    })

    it('falls back to the transport error message with no hint for unknown statuses', async () => {
      mock.onGet(`${ BASE }/groups.json`).replyWithError({ message: 'Network timeout', status: 500 })

      await expect(service.getGroupsDictionary({})).rejects.toThrow('Zendesk API error: Network timeout')
    })
  })
})
