'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-freshservice-api-key'
const DOMAIN = 'acme'
const BASE = `https://${ DOMAIN }.freshservice.com/api/v2`
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:X`).toString('base64') }`

describe('Freshservice Service', () => {
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'domain', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Tickets ──

  describe('createTicket', () => {
    it('sends POST with required fields and defaults', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 42, subject: 'Test', status: 2, priority: 1, source: 2 })

      const result = await service.createTicket('Test', '<p>Body</p>', 'user@example.com')

      expect(result).toEqual({ id: 42, subject: 'Test', status: 2, priority: 1, source: 2 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER, 'Content-Type': 'application/json' })
      expect(mock.history[0].body).toMatchObject({
        subject: 'Test',
        description: '<p>Body</p>',
        email: 'user@example.com',
        priority: 1,
        status: 2,
        source: 2,
      })
    })

    it('resolves friendly labels to numeric values', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 43 })

      await service.createTicket('Test', 'Body', 'u@e.com', undefined, 'Urgent', 'Pending', 'Phone', 'High', 'Medium')

      expect(mock.history[0].body).toMatchObject({
        priority: 4,
        status: 3,
        source: 3,
        urgency: 3,
        impact: 2,
      })
    })

    it('converts groupId and responderId to numbers', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 44 })

      await service.createTicket('Test', 'Body', 'u@e.com', undefined, undefined, undefined, undefined, undefined, undefined, '12345', '67890')

      expect(mock.history[0].body).toMatchObject({
        group_id: 12345,
        responder_id: 67890,
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 45 })

      await service.createTicket(
        'Test', 'Body', 'u@e.com', 999, 'Low', 'Open', 'Email', 'Low', 'Low',
        '111', '222', 'Hardware', 50, ['tag1'], ['cc@e.com'], { cf_field: 'val' }
      )

      expect(mock.history[0].body).toMatchObject({
        requester_id: 999,
        category: 'Hardware',
        department_id: 50,
        tags: ['tag1'],
        cc_emails: ['cc@e.com'],
        custom_fields: { cf_field: 'val' },
      })
    })

    it('omits undefined/null/empty optional fields via clean()', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 46 })

      await service.createTicket('Test', 'Body', 'u@e.com')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('requester_id')
      expect(body).not.toHaveProperty('group_id')
      expect(body).not.toHaveProperty('responder_id')
      expect(body).not.toHaveProperty('category')
      expect(body).not.toHaveProperty('tags')
    })
  })

  describe('getTicket', () => {
    it('sends GET with ticket ID', async () => {
      mock.onGet(`${ BASE }/tickets/42`).reply({ id: 42, subject: 'Test' })

      const result = await service.getTicket(42)

      expect(result).toEqual({ id: 42, subject: 'Test' })
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('includes conversations when requested', async () => {
      mock.onGet(`${ BASE }/tickets/42`).reply({ id: 42 })

      await service.getTicket(42, true)

      expect(mock.history[0].query).toMatchObject({ include: 'conversations' })
    })

    it('omits include param when conversations not requested', async () => {
      mock.onGet(`${ BASE }/tickets/42`).reply({ id: 42 })

      await service.getTicket(42, false)

      expect(mock.history[0].query).not.toHaveProperty('include')
    })
  })

  describe('listTickets', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.listTickets()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('resolves filter and order labels', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.listTickets('New & My Open', undefined, 'Due By', 'Ascending', 2, 50)

      expect(mock.history[0].query).toMatchObject({
        filter: 'new_and_my_open',
        order_by: 'due_by',
        order_type: 'asc',
        page: 2,
        per_page: 50,
      })
    })

    it('passes updated_since when provided', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.listTickets(undefined, '2026-07-01T00:00:00Z')

      expect(mock.history[0].query).toMatchObject({ updated_since: '2026-07-01T00:00:00Z' })
    })
  })

  describe('updateTicket', () => {
    it('sends PUT with provided fields only', async () => {
      mock.onPut(`${ BASE }/tickets/42`).reply({ id: 42, status: 4 })

      const result = await service.updateTicket(42, undefined, undefined, 'High', 'Resolved')

      expect(result).toEqual({ id: 42, status: 4 })
      expect(mock.history[0].body).toMatchObject({ priority: 3, status: 4 })
      expect(mock.history[0].body).not.toHaveProperty('subject')
    })

    it('converts groupId and responderId to numbers', async () => {
      mock.onPut(`${ BASE }/tickets/42`).reply({ id: 42 })

      await service.updateTicket(42, undefined, undefined, undefined, undefined, undefined, undefined, '111', '222')

      expect(mock.history[0].body).toMatchObject({ group_id: 111, responder_id: 222 })
    })
  })

  describe('deleteTicket', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/tickets/42`).reply({})

      const result = await service.deleteTicket(42)

      expect(result).toEqual({ deleted: true, ticketId: 42 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('restoreTicket', () => {
    it('sends PUT to restore endpoint and returns confirmation', async () => {
      mock.onPut(`${ BASE }/tickets/42/restore`).reply({})

      const result = await service.restoreTicket(42)

      expect(result).toEqual({ restored: true, ticketId: 42 })
    })
  })

  describe('replyToTicket', () => {
    it('sends POST with body and optional cc/bcc', async () => {
      mock.onPost(`${ BASE }/tickets/42/reply`).reply({ id: 100, ticket_id: 42 })

      const result = await service.replyToTicket(42, '<p>Reply</p>', ['cc@e.com'], ['bcc@e.com'])

      expect(result).toEqual({ id: 100, ticket_id: 42 })
      expect(mock.history[0].body).toEqual({
        body: '<p>Reply</p>',
        cc_emails: ['cc@e.com'],
        bcc_emails: ['bcc@e.com'],
      })
    })

    it('omits cc/bcc when not provided', async () => {
      mock.onPost(`${ BASE }/tickets/42/reply`).reply({ id: 101 })

      await service.replyToTicket(42, 'Reply text')

      expect(mock.history[0].body).toEqual({ body: 'Reply text' })
    })
  })

  describe('addNote', () => {
    it('sends POST with private default true', async () => {
      mock.onPost(`${ BASE }/tickets/42/notes`).reply({ id: 200 })

      await service.addNote(42, 'Note text')

      expect(mock.history[0].body).toEqual({ body: 'Note text', private: true })
    })

    it('sets private to false when specified', async () => {
      mock.onPost(`${ BASE }/tickets/42/notes`).reply({ id: 201 })

      await service.addNote(42, 'Public note', false)

      expect(mock.history[0].body).toEqual({ body: 'Public note', private: false })
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/tickets/42/conversations`).reply([])

      await service.listConversations(42)

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('uses custom pagination', async () => {
      mock.onGet(`${ BASE }/tickets/42/conversations`).reply([])

      await service.listConversations(42, 3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })
  })

  // ── Changes ──

  describe('createChange', () => {
    it('sends POST with required fields and defaults', async () => {
      mock.onPost(`${ BASE }/changes`).reply({ id: 15 })

      const result = await service.createChange('Upgrade DB', '<p>Details</p>')

      expect(result).toEqual({ id: 15 })
      expect(mock.history[0].body).toMatchObject({
        subject: 'Upgrade DB',
        description: '<p>Details</p>',
        priority: 1,
        status: 1,
      })
    })

    it('resolves change-specific enums', async () => {
      mock.onPost(`${ BASE }/changes`).reply({ id: 16 })

      await service.createChange('Test', 'Desc', undefined, undefined, undefined, 'Urgent', 'Awaiting Approval', 'Emergency', 'Very High', 'High')

      expect(mock.history[0].body).toMatchObject({
        priority: 4,
        status: 3,
        change_type: 4,
        risk: 4,
        impact: 3,
      })
    })

    it('converts agentId and groupId to numbers', async () => {
      mock.onPost(`${ BASE }/changes`).reply({ id: 17 })

      await service.createChange('Test', 'Desc', undefined, '111', '222')

      expect(mock.history[0].body).toMatchObject({ agent_id: 111, group_id: 222 })
    })
  })

  describe('getChange', () => {
    it('sends GET with change ID', async () => {
      mock.onGet(`${ BASE }/changes/15`).reply({ id: 15, subject: 'Upgrade' })

      const result = await service.getChange(15)

      expect(result).toEqual({ id: 15, subject: 'Upgrade' })
    })
  })

  describe('listChanges', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/changes`).reply([])

      await service.listChanges()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes updated_since filter', async () => {
      mock.onGet(`${ BASE }/changes`).reply([])

      await service.listChanges('2026-07-01T00:00:00Z', 2, 50)

      expect(mock.history[0].query).toMatchObject({
        updated_since: '2026-07-01T00:00:00Z',
        page: 2,
        per_page: 50,
      })
    })
  })

  describe('updateChange', () => {
    it('sends PUT with provided fields', async () => {
      mock.onPut(`${ BASE }/changes/15`).reply({ id: 15 })

      await service.updateChange(15, 'New Subject', undefined, 'Medium', 'Planning', 'High', 'Medium', '111', '222')

      expect(mock.history[0].body).toMatchObject({
        subject: 'New Subject',
        priority: 2,
        status: 2,
        risk: 3,
        impact: 2,
        agent_id: 111,
        group_id: 222,
      })
    })
  })

  describe('deleteChange', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/changes/15`).reply({})

      const result = await service.deleteChange(15)

      expect(result).toEqual({ deleted: true, changeId: 15 })
    })
  })

  // ── Problems ──

  describe('createProblem', () => {
    it('sends POST with required fields and defaults', async () => {
      mock.onPost(`${ BASE }/problems`).reply({ id: 8 })

      const result = await service.createProblem('VPN drops', '<p>Details</p>')

      expect(result).toEqual({ id: 8 })
      expect(mock.history[0].body).toMatchObject({
        subject: 'VPN drops',
        description: '<p>Details</p>',
        priority: 1,
        status: 1,
      })
    })

    it('resolves problem-specific status enums', async () => {
      mock.onPost(`${ BASE }/problems`).reply({ id: 9 })

      await service.createProblem('Test', 'Desc', undefined, undefined, undefined, 'High', 'Change Requested', 'Medium')

      expect(mock.history[0].body).toMatchObject({
        priority: 3,
        status: 2,
        impact: 2,
      })
    })
  })

  describe('getProblem', () => {
    it('sends GET with problem ID', async () => {
      mock.onGet(`${ BASE }/problems/8`).reply({ id: 8, subject: 'VPN' })

      const result = await service.getProblem(8)

      expect(result).toEqual({ id: 8, subject: 'VPN' })
    })
  })

  describe('listProblems', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/problems`).reply([])

      await service.listProblems()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })
  })

  describe('updateProblem', () => {
    it('sends PUT with provided fields', async () => {
      mock.onPut(`${ BASE }/problems/8`).reply({ id: 8 })

      await service.updateProblem(8, 'Updated', undefined, 'Urgent', 'Closed', 'High', '111', '222')

      expect(mock.history[0].body).toMatchObject({
        subject: 'Updated',
        priority: 4,
        status: 3,
        impact: 3,
        agent_id: 111,
        group_id: 222,
      })
    })
  })

  describe('deleteProblem', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/problems/8`).reply({})

      const result = await service.deleteProblem(8)

      expect(result).toEqual({ deleted: true, problemId: 8 })
    })
  })

  // ── Releases ──

  describe('createRelease', () => {
    it('sends POST with required fields and defaults', async () => {
      mock.onPost(`${ BASE }/releases`).reply({ id: 5 })

      const result = await service.createRelease('Q3 rollout', '<p>Details</p>')

      expect(result).toEqual({ id: 5 })
      expect(mock.history[0].body).toMatchObject({
        subject: 'Q3 rollout',
        description: '<p>Details</p>',
        priority: 1,
        status: 1,
      })
    })

    it('resolves release-specific enums', async () => {
      mock.onPost(`${ BASE }/releases`).reply({ id: 6 })

      await service.createRelease('Test', 'Desc', undefined, undefined, 'Urgent', 'In Progress', 'Emergency')

      expect(mock.history[0].body).toMatchObject({
        priority: 4,
        status: 3,
        release_type: 4,
      })
    })
  })

  describe('getRelease', () => {
    it('sends GET with release ID', async () => {
      mock.onGet(`${ BASE }/releases/5`).reply({ id: 5, subject: 'Q3' })

      const result = await service.getRelease(5)

      expect(result).toEqual({ id: 5, subject: 'Q3' })
    })
  })

  describe('listReleases', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/releases`).reply([])

      await service.listReleases()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })
  })

  // ── Assets ──

  describe('createAsset', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/assets`).reply({ id: 101, name: 'Laptop-042' })

      const result = await service.createAsset('Laptop-042', 1000123456)

      expect(result).toEqual({ id: 101, name: 'Laptop-042' })
      expect(mock.history[0].body).toMatchObject({
        name: 'Laptop-042',
        asset_type_id: 1000123456,
      })
    })

    it('resolves impact label and passes type_fields', async () => {
      mock.onPost(`${ BASE }/assets`).reply({ id: 102 })

      await service.createAsset('Laptop', 123, 'A laptop', 'TAG-1', 'High', { serial: 'SN1' })

      expect(mock.history[0].body).toMatchObject({
        impact: 'high',
        asset_tag: 'TAG-1',
        description: 'A laptop',
        type_fields: { serial: 'SN1' },
      })
    })
  })

  describe('getAsset', () => {
    it('sends GET with display ID', async () => {
      mock.onGet(`${ BASE }/assets/42`).reply({ id: 101, display_id: 42 })

      const result = await service.getAsset(42)

      expect(result).toEqual({ id: 101, display_id: 42 })
    })

    it('includes type_fields when requested', async () => {
      mock.onGet(`${ BASE }/assets/42`).reply({ id: 101 })

      await service.getAsset(42, true)

      expect(mock.history[0].query).toMatchObject({ include: 'type_fields' })
    })
  })

  describe('listAssets', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/assets`).reply([])

      await service.listAssets()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('wraps filter in quotes', async () => {
      mock.onGet(`${ BASE }/assets`).reply([])

      await service.listAssets('asset_type_id:123')

      expect(mock.history[0].query).toMatchObject({ filter_query: '"asset_type_id:123"' })
    })

    it('strips surrounding quotes from filter before wrapping', async () => {
      mock.onGet(`${ BASE }/assets`).reply([])

      await service.listAssets('"asset_type_id:123"')

      expect(mock.history[0].query).toMatchObject({ filter_query: '"asset_type_id:123"' })
    })
  })

  describe('updateAsset', () => {
    it('sends PUT with provided fields', async () => {
      mock.onPut(`${ BASE }/assets/42`).reply({ id: 101 })

      await service.updateAsset(42, 'New Name', 'New desc', 'TAG-2', 'Medium')

      expect(mock.history[0].body).toMatchObject({
        name: 'New Name',
        description: 'New desc',
        asset_tag: 'TAG-2',
        impact: 'medium',
      })
    })
  })

  describe('deleteAsset', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/assets/42`).reply({})

      const result = await service.deleteAsset(42)

      expect(result).toEqual({ deleted: true, displayId: 42 })
    })
  })

  // ── Agents ──

  describe('listAgents', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      await service.listAgents()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes email filter', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      await service.listAgents('john@co.com', 2, 10)

      expect(mock.history[0].query).toMatchObject({ email: 'john@co.com', page: 2, per_page: 10 })
    })
  })

  describe('getAgent', () => {
    it('sends GET with agent ID', async () => {
      mock.onGet(`${ BASE }/agents/654321`).reply({ id: 654321, first_name: 'John' })

      const result = await service.getAgent(654321)

      expect(result).toEqual({ id: 654321, first_name: 'John' })
    })
  })

  describe('getCurrentAgent', () => {
    it('sends GET to /agents/me', async () => {
      mock.onGet(`${ BASE }/agents/me`).reply({ id: 654321 })

      const result = await service.getCurrentAgent()

      expect(result).toEqual({ id: 654321 })
    })
  })

  // ── Requesters ──

  describe('createRequester', () => {
    it('sends POST with required and optional fields', async () => {
      mock.onPost(`${ BASE }/requesters`).reply({ id: 123456, first_name: 'Jane' })

      const result = await service.createRequester('Jane', 'Doe', 'jane@e.com', 'Analyst', '+1555', '+1666', [1, 2], { cf: 'val' })

      expect(result).toEqual({ id: 123456, first_name: 'Jane' })
      expect(mock.history[0].body).toMatchObject({
        first_name: 'Jane',
        last_name: 'Doe',
        primary_email: 'jane@e.com',
        job_title: 'Analyst',
        work_phone_number: '+1555',
        mobile_phone_number: '+1666',
        department_ids: [1, 2],
        custom_fields: { cf: 'val' },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/requesters`).reply({ id: 123457 })

      await service.createRequester('Jane')

      const body = mock.history[0].body

      expect(body).toMatchObject({ first_name: 'Jane' })
      expect(body).not.toHaveProperty('last_name')
      expect(body).not.toHaveProperty('primary_email')
    })
  })

  describe('getRequester', () => {
    it('sends GET with requester ID', async () => {
      mock.onGet(`${ BASE }/requesters/123456`).reply({ id: 123456 })

      const result = await service.getRequester(123456)

      expect(result).toEqual({ id: 123456 })
    })
  })

  describe('listRequesters', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/requesters`).reply([])

      await service.listRequesters()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes email filter', async () => {
      mock.onGet(`${ BASE }/requesters`).reply([])

      await service.listRequesters('jane@e.com')

      expect(mock.history[0].query).toMatchObject({ email: 'jane@e.com' })
    })
  })

  describe('updateRequester', () => {
    it('sends PUT with provided fields', async () => {
      mock.onPut(`${ BASE }/requesters/123456`).reply({ id: 123456 })

      await service.updateRequester(123456, 'Jane', 'Smith', 'jane.smith@e.com', 'Senior', '+1777', '+1888', { cf: 'v2' })

      expect(mock.history[0].body).toMatchObject({
        first_name: 'Jane',
        last_name: 'Smith',
        primary_email: 'jane.smith@e.com',
        job_title: 'Senior',
        work_phone_number: '+1777',
        mobile_phone_number: '+1888',
        custom_fields: { cf: 'v2' },
      })
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${ BASE }/groups`).reply([])

      await service.listGroups()

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })
  })

  // ── Dictionaries ──

  describe('getAgentsDictionary', () => {
    it('returns formatted items from agents list', async () => {
      mock.onGet(`${ BASE }/agents`).reply([
        { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@co.com' },
        { id: 2, first_name: 'Jane', last_name: 'Smith', email: 'jane@co.com' },
      ])

      const result = await service.getAgentsDictionary({})

      expect(result.items).toEqual([
        { label: 'John Doe', value: '1', note: 'john@co.com' },
        { label: 'Jane Smith', value: '2', note: 'jane@co.com' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters agents by search text', async () => {
      mock.onGet(`${ BASE }/agents`).reply([
        { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@co.com' },
        { id: 2, first_name: 'Jane', last_name: 'Smith', email: 'jane@co.com' },
      ])

      const result = await service.getAgentsDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('returns cursor when page is full', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1, first_name: `Agent${ i }`, last_name: '', email: `a${ i }@co.com`,
      }))

      mock.onGet(`${ BASE }/agents`).reply(fullPage)

      const result = await service.getAgentsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      const result = await service.getAgentsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns formatted items from groups list', async () => {
      mock.onGet(`${ BASE }/groups`).reply([
        { id: 10, name: 'Network Team', description: 'Network issues' },
        { id: 20, name: 'Desktop Support', description: null },
      ])

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Network Team', value: '10', note: 'Network issues' },
        { label: 'Desktop Support', value: '20' },
      ])
    })

    it('filters groups by search text', async () => {
      mock.onGet(`${ BASE }/groups`).reply([
        { id: 10, name: 'Network Team' },
        { id: 20, name: 'Desktop Support' },
      ])

      const result = await service.getGroupsDictionary({ search: 'network' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('10')
    })
  })

  // ── Trigger ──

  describe('handleTriggerPollingForEvent', () => {
    it('establishes baseline on first run (no state)', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([
        { id: 1, created_at: '2026-07-14T10:00:00Z' },
        { id: 2, created_at: '2026-07-14T09:00:00Z' },
      ])

      const result = await service.handleTriggerPollingForEvent(null)

      expect(result.events).toEqual([])
      expect(result.state.lastSeenCreatedAt).toBe('2026-07-14T10:00:00Z')
    })

    it('emits new tickets on subsequent runs', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([
        { id: 3, created_at: '2026-07-14T12:00:00Z' },
        { id: 2, created_at: '2026-07-14T11:00:00Z' },
        { id: 1, created_at: '2026-07-14T10:00:00Z' },
      ])

      const result = await service.handleTriggerPollingForEvent({
        lastSeenCreatedAt: '2026-07-14T10:00:00Z',
      })

      expect(result.events).toHaveLength(2)
      expect(result.events[0].id).toBe(2)
      expect(result.events[1].id).toBe(3)
      expect(result.state.lastSeenCreatedAt).toBe('2026-07-14T12:00:00Z')
    })

    it('emits nothing when no new tickets', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([
        { id: 1, created_at: '2026-07-14T10:00:00Z' },
      ])

      const result = await service.handleTriggerPollingForEvent({
        lastSeenCreatedAt: '2026-07-14T10:00:00Z',
      })

      expect(result.events).toEqual([])
      expect(result.state.lastSeenCreatedAt).toBe('2026-07-14T10:00:00Z')
    })

    it('requests tickets ordered by created_at desc with per_page 100', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.handleTriggerPollingForEvent(null)

      expect(mock.history[0].query).toMatchObject({
        order_by: 'created_at',
        order_type: 'desc',
        per_page: 100,
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with descriptive message on API error', async () => {
      mock.onGet(`${ BASE }/tickets/999`).replyWithError({
        message: 'Not Found',
        body: { description: 'Ticket not found', errors: [] },
      })

      await expect(service.getTicket(999)).rejects.toThrow('Freshservice API error: Ticket not found')
    })

    it('includes field-level error details', async () => {
      mock.onPost(`${ BASE }/tickets`).replyWithError({
        message: 'Validation failed',
        body: {
          description: 'Validation failed',
          errors: [
            { field: 'email', message: 'is invalid', code: 'invalid_value' },
          ],
        },
      })

      await expect(service.createTicket('Test', 'Body', 'bad')).rejects.toThrow(
        'Freshservice API error: Validation failed (email: is invalid [invalid_value])'
      )
    })

    it('handles rate limit errors with retry-after', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { description: 'Rate limit hit' },
        response: { headers: { 'retry-after': '30' } },
      })

      await expect(service.listTickets()).rejects.toThrow('retry after 30 seconds')
    })
  })
})
