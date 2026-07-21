'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://test-domain.atlassian.net'
const EMAIL = 'tester@example.com'
const API_TOKEN = 'test-api-token'
const BASE = `${SITE_URL}/rest/api/3`

const EXPECTED_AUTH = `Basic ${Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64')}`

describe('Jira Issues Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ siteUrl: SITE_URL, email: EMAIL, apiToken: API_TOKEN })
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
          name: 'siteUrl',
          displayName: 'Site URL',
          required: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'email',
          displayName: 'Email',
          required: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          type: 'STRING',
        }),
      ])
    })

    it('sends Basic auth header derived from email:apiToken', async () => {
      mock.onGet(`${BASE}/project/PROJ`).reply({ id: '10000', key: 'PROJ' })

      await service.getProject('PROJ')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': EXPECTED_AUTH,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Issues ──

  describe('createIssue', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10001', key: 'PROJ-1', self: `${SITE_URL}/rest/api/3/issue/10001` })

      const result = await service.createIssue('PROJ', 'Task', 'Test summary')

      expect(result).toEqual(expect.objectContaining({ id: '10001', key: 'PROJ-1' }))
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        fields: {
          project: { key: 'PROJ' },
          issuetype: { name: 'Task' },
          summary: 'Test summary',
        },
      })
    })

    it('includes description in ADF format when provided', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10002', key: 'PROJ-2' })

      await service.createIssue('PROJ', 'Bug', 'Bug title', 'Bug details')

      expect(mock.history[0].body.fields.description).toEqual({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bug details' }] }],
      })
    })

    it('includes priority when provided', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10003', key: 'PROJ-3' })

      await service.createIssue('PROJ', 'Task', 'Summary', undefined, 'High')

      expect(mock.history[0].body.fields.priority).toEqual({ name: 'High' })
      expect(mock.history[0].body.fields.description).toBeUndefined()
    })

    it('includes assignee and reporter when provided', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10004', key: 'PROJ-4' })

      await service.createIssue('PROJ', 'Task', 'Summary', undefined, undefined, 'acc-123', 'acc-456')

      expect(mock.history[0].body.fields.assignee).toEqual({ accountId: 'acc-123' })
      expect(mock.history[0].body.fields.reporter).toEqual({ accountId: 'acc-456' })
    })

    it('includes labels when provided', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10005', key: 'PROJ-5' })

      await service.createIssue('PROJ', 'Task', 'Summary', undefined, undefined, undefined, undefined, ['label1', 'label2'])

      expect(mock.history[0].body.fields.labels).toEqual(['label1', 'label2'])
    })

    it('merges additional fields into the request body', async () => {
      mock.onPost(`${BASE}/issue`).reply({ id: '10006', key: 'PROJ-6' })

      await service.createIssue('PROJ', 'Task', 'Summary', undefined, undefined, undefined, undefined, undefined, { customfield_10001: 'custom value' })

      expect(mock.history[0].body.fields.customfield_10001).toBe('custom value')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/issue`).replyWithError({ message: 'Bad Request' })

      await expect(service.createIssue('PROJ', 'Task', 'Summary')).rejects.toThrow()
    })
  })

  describe('getIssue', () => {
    it('sends GET with issue key and no query by default', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1`).reply({ id: '10001', key: 'PROJ-1', fields: { summary: 'Test' } })

      const result = await service.getIssue('PROJ-1')

      expect(result).toEqual(expect.objectContaining({ key: 'PROJ-1' }))
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes fields and expand query params when provided', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1`).reply({ id: '10001', key: 'PROJ-1' })

      await service.getIssue('PROJ-1', 'summary,status', 'changelog')

      expect(mock.history[0].query).toMatchObject({ fields: 'summary,status', expand: 'changelog' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/issue/INVALID`).replyWithError({ message: 'Not Found' })

      await expect(service.getIssue('INVALID')).rejects.toThrow()
    })
  })

  describe('updateIssue', () => {
    it('sends PUT with summary when provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      const result = await service.updateIssue('PROJ-1', 'Updated summary')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ fields: { summary: 'Updated summary' } })
    })

    it('sends description in ADF format when provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, 'New description')

      expect(mock.history[0].body.fields.description).toEqual({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New description' }] }],
      })
    })

    it('includes priority when provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, undefined, 'Low')

      expect(mock.history[0].body.fields.priority).toEqual({ name: 'Low' })
    })

    it('sets assignee to null when "null" string is provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, undefined, undefined, 'null')

      expect(mock.history[0].body.fields.assignee).toBeNull()
    })

    it('sets assignee by accountId when a real ID is provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, undefined, undefined, 'acc-123')

      expect(mock.history[0].body.fields.assignee).toEqual({ accountId: 'acc-123' })
    })

    it('includes labels when provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, undefined, undefined, undefined, ['bug', 'urgent'])

      expect(mock.history[0].body.fields.labels).toEqual(['bug', 'urgent'])
    })

    it('merges additional fields', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1', undefined, undefined, undefined, undefined, undefined, { customfield_10001: 'val' })

      expect(mock.history[0].body.fields.customfield_10001).toBe('val')
    })

    it('sends empty fields when nothing is provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1`).reply({})

      await service.updateIssue('PROJ-1')

      expect(mock.history[0].body).toEqual({ fields: {} })
    })
  })

  describe('deleteIssue', () => {
    it('sends DELETE for the issue', async () => {
      mock.onDelete(`${BASE}/issue/PROJ-1`).reply({})

      const result = await service.deleteIssue('PROJ-1')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('passes deleteSubtasks query param when true', async () => {
      mock.onDelete(`${BASE}/issue/PROJ-1`).reply({})

      await service.deleteIssue('PROJ-1', true)

      expect(mock.history[0].query).toMatchObject({ deleteSubtasks: 'true' })
    })

    it('does not pass deleteSubtasks when false', async () => {
      mock.onDelete(`${BASE}/issue/PROJ-1`).reply({})

      await service.deleteIssue('PROJ-1', false)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('searchIssues', () => {
    it('sends POST with JQL only (defaults)', async () => {
      mock.onPost(`${BASE}/search`).reply({ startAt: 0, maxResults: 50, total: 1, issues: [{ id: '10001' }] })

      const result = await service.searchIssues('project = PROJ')

      expect(result).toHaveProperty('issues')
      expect(mock.history[0].body).toEqual({ jql: 'project = PROJ' })
    })

    it('includes pagination params when provided', async () => {
      mock.onPost(`${BASE}/search`).reply({ startAt: 10, maxResults: 25, total: 100, issues: [] })

      await service.searchIssues('project = PROJ', 10, 25)

      expect(mock.history[0].body).toMatchObject({ jql: 'project = PROJ', startAt: 10, maxResults: 25 })
    })

    it('splits fields string into array', async () => {
      mock.onPost(`${BASE}/search`).reply({ issues: [] })

      await service.searchIssues('project = PROJ', undefined, undefined, 'summary, status, assignee')

      expect(mock.history[0].body.fields).toEqual(['summary', 'status', 'assignee'])
    })
  })

  // ── Comments ──

  describe('addComment', () => {
    it('sends POST with comment body in ADF format', async () => {
      mock.onPost(`${BASE}/issue/PROJ-1/comment`).reply({ id: '20001', body: {} })

      const result = await service.addComment('PROJ-1', 'Hello world')

      expect(result).toHaveProperty('id', '20001')
      expect(mock.history[0].body).toEqual({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
        },
      })
    })
  })

  describe('getComments', () => {
    it('sends GET with no query by default', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1/comment`).reply({ startAt: 0, maxResults: 50, total: 0, comments: [] })

      const result = await service.getComments('PROJ-1')

      expect(result).toHaveProperty('comments')
      expect(mock.history[0].query).toEqual({})
    })

    it('passes pagination params when provided', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1/comment`).reply({ comments: [] })

      await service.getComments('PROJ-1', 5, 10)

      expect(mock.history[0].query).toMatchObject({ startAt: 5, maxResults: 10 })
    })
  })

  describe('updateComment', () => {
    it('sends PUT with updated comment body in ADF format', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1/comment/20001`).reply({ id: '20001', body: {} })

      const result = await service.updateComment('PROJ-1', '20001', 'Updated text')

      expect(result).toHaveProperty('id', '20001')
      expect(mock.history[0].body).toEqual({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated text' }] }],
        },
      })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/issue/PROJ-1/comment/20001`).reply({})

      const result = await service.deleteComment('PROJ-1', '20001')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Transitions ──

  describe('transitionIssue', () => {
    it('sends POST with transition ID only', async () => {
      mock.onPost(`${BASE}/issue/PROJ-1/transitions`).reply({})

      const result = await service.transitionIssue('PROJ-1', '21')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ transition: { id: '21' } })
    })

    it('includes comment in update block when provided', async () => {
      mock.onPost(`${BASE}/issue/PROJ-1/transitions`).reply({})

      await service.transitionIssue('PROJ-1', '21', 'Moving to In Progress')

      expect(mock.history[0].body).toEqual({
        transition: { id: '21' },
        update: {
          comment: [
            {
              add: {
                body: {
                  type: 'doc',
                  version: 1,
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Moving to In Progress' }] }],
                },
              },
            },
          ],
        },
      })
    })
  })

  // ── Assign ──

  describe('assignIssue', () => {
    it('sends PUT with accountId when provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1/assignee`).reply({})

      const result = await service.assignIssue('PROJ-1', 'acc-123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ accountId: 'acc-123' })
    })

    it('sends null body to unassign when no accountId provided', async () => {
      mock.onPut(`${BASE}/issue/PROJ-1/assignee`).reply({})

      await service.assignIssue('PROJ-1')

      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Projects ──

  describe('getProject', () => {
    it('sends GET for the project key', async () => {
      mock.onGet(`${BASE}/project/PROJ`).reply({ id: '10000', key: 'PROJ', name: 'Project Name' })

      const result = await service.getProject('PROJ')

      expect(result).toEqual(expect.objectContaining({ key: 'PROJ', name: 'Project Name' }))
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('maps projects to dictionary items', async () => {
      mock.onGet(`${BASE}/project/search`).reply({
        values: [
          { id: '10000', key: 'PROJ', name: 'My Project' },
          { id: '10001', key: 'TEST', name: 'Test Project' },
        ],
      })

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([
        { label: 'My Project (PROJ)', value: 'PROJ', note: 'ID: 10000' },
        { label: 'Test Project (TEST)', value: 'TEST', note: 'ID: 10001' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ query: '' })
    })

    it('passes search term as query param', async () => {
      mock.onGet(`${BASE}/project/search`).reply({ values: [] })

      await service.getProjectsDictionary({ search: 'test' })

      expect(mock.history[0].query).toMatchObject({ query: 'test' })
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(`${BASE}/project/search`).reply({ values: [] })

      const result = await service.getProjectsDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getIssueTypesDictionary', () => {
    it('returns issue types filtered by project key from criteria', async () => {
      mock.onGet(`${BASE}/issue/createmeta/PROJ/issuetypes`).reply({
        values: [
          { id: '10001', name: 'Task' },
          { id: '10002', name: 'Bug' },
        ],
      })

      const result = await service.getIssueTypesDictionary({ criteria: { projectKey: 'PROJ' } })

      expect(result.items).toEqual([
        { label: 'Task', value: 'Task', note: 'ID: 10001' },
        { label: 'Bug', value: 'Bug', note: 'ID: 10002' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters items by search term', async () => {
      mock.onGet(`${BASE}/issue/createmeta/PROJ/issuetypes`).reply({
        values: [
          { id: '10001', name: 'Task' },
          { id: '10002', name: 'Bug' },
          { id: '10003', name: 'Story' },
        ],
      })

      const result = await service.getIssueTypesDictionary({ search: 'bug', criteria: { projectKey: 'PROJ' } })

      expect(result.items).toEqual([{ label: 'Bug', value: 'Bug', note: 'ID: 10002' }])
    })

    it('returns empty items when no projectKey in criteria', async () => {
      const result = await service.getIssueTypesDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when payload is empty', async () => {
      const result = await service.getIssueTypesDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles response with issueTypes key instead of values', async () => {
      mock.onGet(`${BASE}/issue/createmeta/PROJ/issuetypes`).reply({
        issueTypes: [{ id: '10001', name: 'Epic' }],
      })

      const result = await service.getIssueTypesDictionary({ criteria: { projectKey: 'PROJ' } })

      expect(result.items).toEqual([{ label: 'Epic', value: 'Epic', note: 'ID: 10001' }])
    })
  })

  describe('getPrioritiesDictionary', () => {
    it('maps priorities to dictionary items', async () => {
      mock.onGet(`${BASE}/priority`).reply([
        { id: '1', name: 'Highest' },
        { id: '2', name: 'High' },
        { id: '3', name: 'Medium' },
      ])

      const result = await service.getPrioritiesDictionary({})

      expect(result.items).toEqual([
        { label: 'Highest', value: 'Highest', note: 'ID: 1' },
        { label: 'High', value: 'High', note: 'ID: 2' },
        { label: 'Medium', value: 'Medium', note: 'ID: 3' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${BASE}/priority`).reply([
        { id: '1', name: 'Highest' },
        { id: '2', name: 'High' },
        { id: '3', name: 'Medium' },
      ])

      const result = await service.getPrioritiesDictionary({ search: 'high' })

      expect(result.items).toEqual([
        { label: 'Highest', value: 'Highest', note: 'ID: 1' },
        { label: 'High', value: 'High', note: 'ID: 2' },
      ])
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/priority`).reply([])

      const result = await service.getPrioritiesDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTransitionsDictionary', () => {
    it('maps transitions to dictionary items when issueIdOrKey is provided', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1/transitions`).reply({
        transitions: [
          { id: '11', name: 'To Do', to: { name: 'To Do' } },
          { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
        ],
      })

      const result = await service.getTransitionsDictionary({ criteria: { issueIdOrKey: 'PROJ-1' } })

      expect(result.items).toEqual([
        { label: 'To Do', value: '11', note: 'Transition to To Do status' },
        { label: 'In Progress', value: '21', note: 'Transition to In Progress status' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters transitions by search term', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1/transitions`).reply({
        transitions: [
          { id: '11', name: 'To Do', to: { name: 'To Do' } },
          { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
          { id: '31', name: 'Done', to: { name: 'Done' } },
        ],
      })

      const result = await service.getTransitionsDictionary({ search: 'done', criteria: { issueIdOrKey: 'PROJ-1' } })

      expect(result.items).toEqual([{ label: 'Done', value: '31', note: 'Transition to Done status' }])
    })

    it('returns empty items when no issueIdOrKey in criteria', async () => {
      const result = await service.getTransitionsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when payload is empty', async () => {
      const result = await service.getTransitionsDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles transition without "to" property', async () => {
      mock.onGet(`${BASE}/issue/PROJ-1/transitions`).reply({
        transitions: [{ id: '11', name: 'Backlog' }],
      })

      const result = await service.getTransitionsDictionary({ criteria: { issueIdOrKey: 'PROJ-1' } })

      expect(result.items).toEqual([{ label: 'Backlog', value: '11', note: 'Transition to Backlog status' }])
    })
  })
})
