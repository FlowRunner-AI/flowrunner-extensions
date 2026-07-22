'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-tally-api-key'
const BASE = 'https://api.tally.so'

describe('Tally Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiKey',
            required: true,
            shared: false,
            type: 'STRING',
          }),
        ])
      )
    })
  })

  // ── Helper: verify auth headers ──

  function expectAuthHeaders(callRecord) {
    expect(callRecord.headers).toMatchObject({
      'Authorization': `Bearer ${ API_KEY }`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    })
  }

  // ── Forms ──

  describe('listForms', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: [], total: 0, hasMore: false })

      const result = await service.listForms()

      expect(result).toEqual({ items: [], total: 0, hasMore: false })
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders(mock.history[0])
    })

    it('passes page and limit as query params', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: [{ id: 'f1' }], total: 1, hasMore: false })

      await service.listForms(2, 10)

      expect(mock.history[0].query).toMatchObject({ page: 2, limit: 10 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/forms`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
      })

      await expect(service.listForms()).rejects.toThrow('Tally API error: Invalid API key')
    })
  })

  describe('getForm', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/forms/abc123`).reply({ id: 'abc123', name: 'My Form' })

      const result = await service.getForm('abc123')

      expect(result).toEqual({ id: 'abc123', name: 'My Form' })
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders(mock.history[0])
    })

    it('throws on error', async () => {
      mock.onGet(`${ BASE }/forms/bad`).replyWithError({ message: 'Not found' })

      await expect(service.getForm('bad')).rejects.toThrow('Tally API error: Not found')
    })
  })

  describe('createForm', () => {
    const blocks = [{ uuid: 'u1', type: 'FORM_TITLE', groupUuid: 'g1', groupType: 'TEXT', payload: { title: 'Test' } }]

    it('sends POST with resolved status and blocks', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new1', name: 'Test', status: 'PUBLISHED' })

      const result = await service.createForm('Published', blocks)

      expect(result).toEqual({ id: 'new1', name: 'Test', status: 'PUBLISHED' })
      expect(mock.history[0].body).toEqual({
        status: 'PUBLISHED',
        blocks,
      })
    })

    it('resolves Draft status correctly', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new2', status: 'DRAFT' })

      await service.createForm('Draft', blocks)

      expect(mock.history[0].body.status).toBe('DRAFT')
    })

    it('resolves Blank status correctly', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new3', status: 'BLANK' })

      await service.createForm('Blank', blocks)

      expect(mock.history[0].body.status).toBe('BLANK')
    })

    it('passes through unknown status values unchanged', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new4', status: 'PUBLISHED' })

      await service.createForm('PUBLISHED', blocks)

      expect(mock.history[0].body.status).toBe('PUBLISHED')
    })

    it('includes workspaceId when provided', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new5' })

      await service.createForm('Published', blocks, 'ws1')

      expect(mock.history[0].body).toMatchObject({ workspaceId: 'ws1' })
    })

    it('omits workspaceId when not provided', async () => {
      mock.onPost(`${ BASE }/forms`).reply({ id: 'new6' })

      await service.createForm('Published', blocks)

      expect(mock.history[0].body).not.toHaveProperty('workspaceId')
    })
  })

  describe('updateForm', () => {
    it('sends PATCH with name and resolved status', async () => {
      mock.onPatch(`${ BASE }/forms/f1`).reply({ id: 'f1', name: 'Updated', status: 'DRAFT' })

      const result = await service.updateForm('f1', 'Updated', 'Draft')

      expect(result).toEqual({ id: 'f1', name: 'Updated', status: 'DRAFT' })
      expect(mock.history[0].body).toEqual({ name: 'Updated', status: 'DRAFT' })
    })

    it('omits empty optional fields via clean()', async () => {
      mock.onPatch(`${ BASE }/forms/f2`).reply({ id: 'f2' })

      await service.updateForm('f2')

      // Both name and status are undefined, clean() removes them
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteForm', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/forms/f1`).reply({})

      const result = await service.deleteForm('f1')

      expect(result).toEqual({ deleted: true, formId: 'f1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Questions ──

  describe('listFormQuestions', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/forms/f1/questions`).reply({
        questions: [{ id: 'q1', type: 'INPUT_EMAIL', title: 'Email?' }],
        hasResponses: true,
      })

      const result = await service.listFormQuestions('f1')

      expect(result.questions).toHaveLength(1)
      expect(result.questions[0].id).toBe('q1')
    })
  })

  // ── Submissions ──

  describe('listSubmissions', () => {
    it('sends GET with all query params', async () => {
      mock.onGet(`${ BASE }/forms/f1/submissions`).reply({
        submissions: [],
        page: 1,
        limit: 50,
        hasMore: false,
      })

      await service.listSubmissions('f1', 'Completed', '2026-01-01', '2026-12-31', 'sub_prev', 2, 25)

      expect(mock.history[0].query).toMatchObject({
        filter: 'completed',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        afterId: 'sub_prev',
        page: 2,
        limit: 25,
      })
    })

    it('resolves All filter', async () => {
      mock.onGet(`${ BASE }/forms/f1/submissions`).reply({ submissions: [] })

      await service.listSubmissions('f1', 'All')

      expect(mock.history[0].query).toMatchObject({ filter: 'all' })
    })

    it('resolves Partial filter', async () => {
      mock.onGet(`${ BASE }/forms/f1/submissions`).reply({ submissions: [] })

      await service.listSubmissions('f1', 'Partial')

      expect(mock.history[0].query).toMatchObject({ filter: 'partial' })
    })

    it('passes unknown filter values through unchanged', async () => {
      mock.onGet(`${ BASE }/forms/f1/submissions`).reply({ submissions: [] })

      await service.listSubmissions('f1', 'completed')

      expect(mock.history[0].query).toMatchObject({ filter: 'completed' })
    })
  })

  describe('getSubmission', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/forms/f1/submissions/sub1`).reply({
        submission: { id: 'sub1', isCompleted: true },
        questions: [],
      })

      const result = await service.getSubmission('f1', 'sub1')

      expect(result.submission.id).toBe('sub1')
    })
  })

  describe('deleteSubmission', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/forms/f1/submissions/sub1`).reply({})

      const result = await service.deleteSubmission('f1', 'sub1')

      expect(result).toEqual({ deleted: true, formId: 'f1', submissionId: 'sub1' })
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('sends GET with page and limit', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ webhooks: [], page: 1, limit: 25, hasMore: false })

      const result = await service.listWebhooks(1, 25)

      expect(result.webhooks).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, limit: 25 })
    })
  })

  describe('createWebhook', () => {
    it('sends POST with formId, url, and eventTypes', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh1', url: 'https://hook.test', isEnabled: true })

      const result = await service.createWebhook('f1', 'https://hook.test')

      expect(result.id).toBe('wh1')
      expect(mock.history[0].body).toEqual({
        formId: 'f1',
        url: 'https://hook.test',
        eventTypes: ['FORM_RESPONSE'],
      })
    })

    it('includes signingSecret and httpHeaders when provided', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh2' })

      const headers = [{ name: 'X-Key', value: 'secret' }]
      await service.createWebhook('f1', 'https://hook.test', 'my-secret', headers)

      expect(mock.history[0].body).toMatchObject({
        signingSecret: 'my-secret',
        httpHeaders: headers,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh3' })

      await service.createWebhook('f1', 'https://hook.test')

      expect(mock.history[0].body).not.toHaveProperty('signingSecret')
      expect(mock.history[0].body).not.toHaveProperty('httpHeaders')
    })
  })

  describe('updateWebhook', () => {
    it('sends PATCH with full configuration', async () => {
      mock.onPatch(`${ BASE }/webhooks/wh1`).reply({})

      const result = await service.updateWebhook('wh1', 'f1', 'https://hook.test', true, 'secret', [{ name: 'X-Key', value: 'v' }])

      expect(result).toEqual({ updated: true, webhookId: 'wh1' })
      expect(mock.history[0].body).toEqual({
        formId: 'f1',
        url: 'https://hook.test',
        eventTypes: ['FORM_RESPONSE'],
        isEnabled: true,
        signingSecret: 'secret',
        httpHeaders: [{ name: 'X-Key', value: 'v' }],
      })
    })

    it('defaults isEnabled to true when not provided', async () => {
      mock.onPatch(`${ BASE }/webhooks/wh2`).reply({})

      await service.updateWebhook('wh2', 'f1', 'https://hook.test')

      expect(mock.history[0].body.isEnabled).toBe(true)
    })

    it('sets isEnabled to false when explicitly false', async () => {
      mock.onPatch(`${ BASE }/webhooks/wh3`).reply({})

      await service.updateWebhook('wh3', 'f1', 'https://hook.test', false)

      expect(mock.history[0].body.isEnabled).toBe(false)
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh1`).reply({})

      const result = await service.deleteWebhook('wh1')

      expect(result).toEqual({ deleted: true, webhookId: 'wh1' })
    })
  })

  // ── Account ──

  describe('getCurrentUser', () => {
    it('sends GET to /users/me', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 'usr_1', email: 'jane@example.com', subscriptionPlan: 'PRO' })

      const result = await service.getCurrentUser()

      expect(result).toMatchObject({ id: 'usr_1', email: 'jane@example.com' })
      expectAuthHeaders(mock.history[0])
    })
  })

  describe('listWorkspaces', () => {
    it('sends GET with page query param', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply({ items: [{ id: 'ws1', name: 'Marketing' }], hasMore: false })

      const result = await service.listWorkspaces(1)

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  // ── Dictionary ──

  describe('getFormsDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        items: [{ id: 'f1', name: 'Feedback', status: 'PUBLISHED', numberOfSubmissions: 42 }],
        hasMore: false,
      })

      const result = await service.getFormsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Feedback', value: 'f1', note: 'published - 42 submissions' }],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        items: [
          { id: 'f1', name: 'Alpha Form' },
          { id: 'f2', name: 'Beta Form' },
        ],
        hasMore: false,
      })

      const result = await service.getFormsDictionary({ search: 'ALPHA' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        items: [{ id: 'f1', name: 'A' }],
        hasMore: false,
      })

      const result = await service.getFormsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty items', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: [], hasMore: false })

      const result = await service.getFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null items in response', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: null, hasMore: false })

      const result = await service.getFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns cursor when hasMore is true', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: [{ id: 'f1', name: 'A' }], hasMore: true })

      const result = await service.getFormsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${ BASE }/forms`).reply({ items: [{ id: 'f3', name: 'C' }], hasMore: false })

      await service.getFormsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3, limit: 100 })
    })

    it('falls back to Form {id} label when name is missing', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        items: [{ id: 'f1', name: null }],
        hasMore: false,
      })

      const result = await service.getFormsDictionary({})

      expect(result.items[0].label).toBe('Form f1')
    })

    it('handles forms with no status or numberOfSubmissions', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        items: [{ id: 'f1', name: 'Test' }],
        hasMore: false,
      })

      const result = await service.getFormsDictionary({})

      expect(result.items[0].note).toBe('')
    })
  })

  // ── Trigger: onNewSubmission ──

  describe('onNewSubmission', () => {
    it('shapes event data with SHAPE_EVENT call type', () => {
      const rawEvent = {
        eventId: 'ev1',
        eventType: 'FORM_RESPONSE',
        data: {
          responseId: 'r1',
          submissionId: 's1',
          formId: 'f1',
          formName: 'Test',
          fields: [
            { key: 'q1', label: 'Email', type: 'INPUT_EMAIL', value: 'a@b.com' },
            { key: 'q2', label: 'Name', type: 'INPUT_TEXT', value: 'Jane' },
          ],
        },
      }

      const result = service.onNewSubmission('SHAPE_EVENT', rawEvent)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('onNewSubmission')
      expect(result[0].data).toMatchObject({
        responseId: 'r1',
        formId: 'f1',
        values: { Email: 'a@b.com', Name: 'Jane' },
      })
    })

    it('handles empty fields array', () => {
      const rawEvent = { data: { responseId: 'r1', fields: [] } }

      const result = service.onNewSubmission('SHAPE_EVENT', rawEvent)

      expect(result[0].data.values).toEqual({})
    })

    it('handles missing data in raw event', () => {
      const result = service.onNewSubmission('SHAPE_EVENT', {})

      expect(result[0].data.values).toEqual({})
    })

    it('handles null raw event', () => {
      const result = service.onNewSubmission('SHAPE_EVENT', null)

      expect(result[0].data.values).toEqual({})
    })

    it('skips fields with null/undefined label', () => {
      const rawEvent = {
        data: {
          fields: [
            { key: 'q1', label: null, value: 'x' },
            { key: 'q2', label: undefined, value: 'y' },
            { key: 'q3', label: 'Valid', value: 'z' },
          ],
        },
      }

      const result = service.onNewSubmission('SHAPE_EVENT', rawEvent)

      expect(result[0].data.values).toEqual({ Valid: 'z' })
    })

    it('filters triggers by formId with FILTER_TRIGGER call type', () => {
      const payload = {
        eventData: { formId: 'f1' },
        triggers: [
          { id: 't1', data: { formId: 'f1' } },
          { id: 't2', data: { formId: 'f2' } },
          { id: 't3', data: { formId: 'f1' } },
        ],
      }

      const result = service.onNewSubmission('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('returns empty ids when no triggers match', () => {
      const payload = {
        eventData: { formId: 'f999' },
        triggers: [{ id: 't1', data: { formId: 'f1' } }],
      }

      const result = service.onNewSubmission('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })

    it('handles missing triggers array', () => {
      const payload = { eventData: { formId: 'f1' } }

      const result = service.onNewSubmission('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })

    it('uses payload.data as fallback for eventData', () => {
      const payload = {
        data: { formId: 'f1' },
        triggers: [{ id: 't1', data: { formId: 'f1' } }],
      }

      const result = service.onNewSubmission('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  // ── Trigger: system methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for each trigger event', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh_created' })

      const invocation = {
        callbackUrl: 'https://flow.test/callback',
        connectionId: 'conn1',
        events: [
          { id: 'trigger1', triggerData: { formId: 'f1' } },
          { id: 'trigger2', triggerData: { formId: 'f2' } },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body).toEqual({
        formId: 'f1',
        url: 'https://flow.test/callback?connectionId=conn1',
        eventTypes: ['FORM_RESPONSE'],
      })
      expect(result.webhookData.webhooks).toHaveLength(2)
      expect(result.connectionId).toBe('conn1')
    })

    it('appends connectionId with & when callbackUrl has query params', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh1' })

      const invocation = {
        callbackUrl: 'https://flow.test/callback?existing=1',
        connectionId: 'conn2',
        events: [{ id: 't1', triggerData: { formId: 'f1' } }],
      }

      await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history[0].body.url).toBe('https://flow.test/callback?existing=1&connectionId=conn2')
    })

    it('handles empty events array', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flow.test/callback',
        connectionId: 'conn3',
        events: [],
      })

      expect(result.webhookData.webhooks).toEqual([])
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves FORM_RESPONSE event', async () => {
      const invocation = {
        queryParams: { connectionId: 'conn1' },
        body: {
          eventId: 'ev1',
          eventType: 'FORM_RESPONSE',
          data: {
            responseId: 'r1',
            formId: 'f1',
            fields: [{ key: 'q1', label: 'Email', type: 'INPUT_EMAIL', value: 'a@b.com' }],
          },
        },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onNewSubmission')
      expect(result.events[0].data.values).toEqual({ Email: 'a@b.com' })
    })

    it('returns handshake when body is missing', async () => {
      const result = await service.handleTriggerResolveEvents({ queryParams: {} })

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns handshake when invocation is null', async () => {
      const result = await service.handleTriggerResolveEvents(null)

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns empty events for non-FORM_RESPONSE eventType', async () => {
      const invocation = {
        queryParams: { connectionId: 'conn1' },
        body: { eventType: 'FORM_DELETED', data: {} },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([])
    })

    it('processes event without eventType if data is present', async () => {
      const invocation = {
        queryParams: { connectionId: 'conn1' },
        body: {
          data: { responseId: 'r1', formId: 'f1', fields: [] },
        },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toHaveLength(1)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named trigger method', async () => {
      const invocation = {
        eventName: 'onNewSubmission',
        eventData: { formId: 'f1' },
        triggers: [{ id: 't1', data: { formId: 'f1' } }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all webhooks from webhookData', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh1`).reply({})
      mock.onDelete(`${ BASE }/webhooks/wh2`).reply({})

      const invocation = {
        webhookData: {
          webhooks: [
            { triggerId: 't1', webhookId: 'wh1', formId: 'f1' },
            { triggerId: 't2', webhookId: 'wh2', formId: 'f2' },
          ],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips webhooks without webhookId', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh1`).reply({})

      const invocation = {
        webhookData: {
          webhooks: [
            { triggerId: 't1', webhookId: null },
            { triggerId: 't2', webhookId: 'wh1' },
          ],
        },
      }

      await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(1)
    })

    it('handles empty webhookData', async () => {
      const result = await service.handleTriggerDeleteWebhook({ webhookData: {} })

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })

    it('continues on delete failure', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh1`).replyWithError({ message: 'Not found' })
      mock.onDelete(`${ BASE }/webhooks/wh2`).reply({})

      const invocation = {
        webhookData: {
          webhooks: [
            { triggerId: 't1', webhookId: 'wh1' },
            { triggerId: 't2', webhookId: 'wh2' },
          ],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(2)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('uses error.body.error when message is missing', async () => {
      mock.onGet(`${ BASE }/forms`).replyWithError({
        message: 'HTTP Error',
        body: { error: 'rate_limited' },
      })

      await expect(service.listForms()).rejects.toThrow('Tally API error: rate_limited')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${ BASE }/forms`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listForms()).rejects.toThrow('Tally API error: Network timeout')
    })
  })
})
