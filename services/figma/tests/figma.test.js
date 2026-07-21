'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-figma-token'
const BASE = 'https://api.figma.com/v1'
const BASE_V2 = 'https://api.figma.com/v2'

describe('Figma Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
          name: 'accessToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Files ──

  describe('getFile', () => {
    it('sends correct request with required params only', async () => {
      const responseData = { name: 'My File', document: {}, components: {}, styles: {} }
      mock.onGet(`${BASE}/files/abc123`).reply(responseData)

      const result = await service.getFile(null, null, 'abc123')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'X-Figma-Token': ACCESS_TOKEN })
    })

    it('extracts file key from a full Figma URL', async () => {
      mock.onGet(`${BASE}/files/XyZ789`).reply({ name: 'File' })

      await service.getFile(null, null, 'https://www.figma.com/design/XyZ789/My-File')

      expect(mock.history[0].url).toBe(`${BASE}/files/XyZ789`)
    })

    it('passes optional parameters', async () => {
      mock.onGet(`${BASE}/files/abc123`).reply({ name: 'File' })

      await service.getFile(null, null, 'abc123', 'v1', 2, ['1:23', '4:56'], true)

      expect(mock.history[0].query).toMatchObject({
        version: 'v1',
        depth: 2,
        ids: '1:23,4:56',
        geometry: 'paths',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onGet(`${BASE}/files/abc123`).reply({ name: 'File' })

      await service.getFile(null, null, 'abc123')

      const query = mock.history[0].query
      expect(query.version).toBeUndefined()
      expect(query.depth).toBeUndefined()
      expect(query.ids).toBeUndefined()
      expect(query.geometry).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/files/bad`).replyWithError({
        message: 'Not Found',
        body: { err: 'File not found' },
      })

      await expect(service.getFile(null, null, 'bad')).rejects.toThrow('Figma API error')
    })
  })

  describe('getFileNodes', () => {
    it('sends correct request', async () => {
      const responseData = { name: 'File', nodes: {} }
      mock.onGet(`${BASE}/files/abc123/nodes`).reply(responseData)

      const result = await service.getFileNodes('abc123', ['1:23', '4:56'], 'v2', 3)

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        ids: '1:23,4:56',
        version: 'v2',
        depth: 3,
      })
    })

    it('extracts file key from URL', async () => {
      mock.onGet(`${BASE}/files/KEY1/nodes`).reply({ name: 'File', nodes: {} })

      await service.getFileNodes('https://www.figma.com/file/KEY1/Title')

      expect(mock.history[0].url).toBe(`${BASE}/files/KEY1/nodes`)
    })
  })

  describe('getFileMetadata', () => {
    it('sends correct request', async () => {
      const responseData = { file: { name: 'My File' } }
      mock.onGet(`${BASE}/files/abc123/meta`).reply(responseData)

      const result = await service.getFileMetadata('abc123')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'X-Figma-Token': ACCESS_TOKEN })
    })
  })

  describe('getFileVersions', () => {
    it('sends correct request', async () => {
      const responseData = { versions: [{ id: '123' }], pagination: {} }
      mock.onGet(`${BASE}/files/abc123/versions`).reply(responseData)

      const result = await service.getFileVersions('abc123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/files/abc123/versions`)
    })
  })

  // ── Images ──

  describe('exportImage', () => {
    it('sends correct request with defaults', async () => {
      const responseData = { err: null, images: { '1:23': 'https://s3.figma.com/img.png' } }
      mock.onGet(`${BASE}/images/abc123`).reply(responseData)

      const result = await service.exportImage('abc123', ['1:23'])

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        ids: '1:23',
        format: 'png',
      })
    })

    it('resolves format choice correctly', async () => {
      mock.onGet(`${BASE}/images/abc123`).reply({ err: null, images: {} })

      await service.exportImage('abc123', ['1:23'], 'SVG')

      expect(mock.history[0].query).toMatchObject({ format: 'svg' })
    })

    it('passes scale parameter', async () => {
      mock.onGet(`${BASE}/images/abc123`).reply({ err: null, images: {} })

      await service.exportImage('abc123', ['1:23'], 'PNG', 2)

      expect(mock.history[0].query).toMatchObject({ scale: 2, format: 'png' })
    })

    it('returns response directly when saveToStorage is false', async () => {
      const responseData = { err: null, images: { '1:23': 'https://s3.figma.com/img.png' } }
      mock.onGet(`${BASE}/images/abc123`).reply(responseData)

      const result = await service.exportImage('abc123', ['1:23'], 'PNG', 1, false)

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getImageFills', () => {
    it('sends correct request', async () => {
      const responseData = { error: false, meta: { images: { ref1: 'https://url' } } }
      mock.onGet(`${BASE}/files/abc123/images`).reply(responseData)

      const result = await service.getImageFills('abc123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/files/abc123/images`)
    })
  })

  // ── Comments ──

  describe('getComments', () => {
    it('sends correct request without markdown', async () => {
      const responseData = { comments: [{ id: '1', message: 'Hello' }] }
      mock.onGet(`${BASE}/files/abc123/comments`).reply(responseData)

      const result = await service.getComments('abc123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query.as_md).toBeUndefined()
    })

    it('sends as_md when asMarkdown is true', async () => {
      mock.onGet(`${BASE}/files/abc123/comments`).reply({ comments: [] })

      await service.getComments('abc123', true)

      expect(mock.history[0].query).toMatchObject({ as_md: true })
    })
  })

  describe('postComment', () => {
    it('sends message-only comment', async () => {
      const responseData = { id: '456', message: 'Nice!' }
      mock.onPost(`${BASE}/files/abc123/comments`).reply(responseData)

      const result = await service.postComment('abc123', 'Nice!')

      expect(result).toEqual(responseData)
      expect(mock.history[0].body).toEqual({ message: 'Nice!' })
    })

    it('sends reply to existing comment', async () => {
      mock.onPost(`${BASE}/files/abc123/comments`).reply({ id: '457' })

      await service.postComment('abc123', 'Reply text', 'c123')

      expect(mock.history[0].body).toEqual({
        message: 'Reply text',
        comment_id: 'c123',
      })
    })

    it('sends comment pinned to a node', async () => {
      mock.onPost(`${BASE}/files/abc123/comments`).reply({ id: '458' })

      await service.postComment('abc123', 'Pin me', undefined, '1:23', 10, 20)

      expect(mock.history[0].body).toEqual({
        message: 'Pin me',
        client_meta: { node_id: '1:23', node_offset: { x: 10, y: 20 } },
      })
    })

    it('sends comment pinned to absolute canvas position', async () => {
      mock.onPost(`${BASE}/files/abc123/comments`).reply({ id: '459' })

      await service.postComment('abc123', 'Canvas pin', undefined, undefined, 100, 200)

      expect(mock.history[0].body).toEqual({
        message: 'Canvas pin',
        client_meta: { x: 100, y: 200 },
      })
    })

    it('defaults node_offset to 0,0 when node is set but no x,y', async () => {
      mock.onPost(`${BASE}/files/abc123/comments`).reply({ id: '460' })

      await service.postComment('abc123', 'Node only', undefined, '2:34')

      expect(mock.history[0].body).toEqual({
        message: 'Node only',
        client_meta: { node_id: '2:34', node_offset: { x: 0, y: 0 } },
      })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE request with correct URL', async () => {
      mock.onDelete(`${BASE}/comments/c456`).reply({ status: 200 })

      const result = await service.deleteComment('c456')

      expect(result).toEqual({ status: 200 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/comments/c456`)
    })
  })

  describe('getCommentReactions', () => {
    it('sends correct request', async () => {
      const responseData = { reactions: [{ emoji: ':eyes:' }] }
      mock.onGet(`${BASE}/comments/c789/reactions`).reply(responseData)

      const result = await service.getCommentReactions('c789')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/comments/c789/reactions`)
    })
  })

  describe('addCommentReaction', () => {
    it('sends POST with emoji body', async () => {
      mock.onPost(`${BASE}/comments/c789/reactions`).reply({ status: 200 })

      const result = await service.addCommentReaction('c789', ':thumbsup:')

      expect(result).toEqual({ status: 200 })
      expect(mock.history[0].body).toEqual({ emoji: ':thumbsup:' })
    })
  })

  // ── Projects & Teams ──

  describe('getTeamProjects', () => {
    it('sends correct request with raw team ID', async () => {
      const responseData = { name: 'My Team', projects: [{ id: '789', name: 'Web' }] }
      mock.onGet(`${BASE}/teams/12345/projects`).reply(responseData)

      const result = await service.getTeamProjects('12345')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/teams/12345/projects`)
    })

    it('extracts team ID from URL', async () => {
      mock.onGet(`${BASE}/teams/67890/projects`).reply({ name: 'Team', projects: [] })

      await service.getTeamProjects('https://www.figma.com/files/team/67890/My-Team')

      expect(mock.history[0].url).toBe(`${BASE}/teams/67890/projects`)
    })
  })

  describe('getProjectFiles', () => {
    it('sends correct request', async () => {
      const responseData = { name: 'Project', files: [{ key: 'abc', name: 'File1' }] }
      mock.onGet(`${BASE}/projects/789/files`).reply(responseData)

      const result = await service.getProjectFiles(null, '789')

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${BASE}/projects/789/files`)
    })

    it('passes branch_data when branchData is true', async () => {
      mock.onGet(`${BASE}/projects/789/files`).reply({ name: 'P', files: [] })

      await service.getProjectFiles(null, '789', true)

      expect(mock.history[0].query).toMatchObject({ branch_data: true })
    })

    it('omits branch_data when branchData is false', async () => {
      mock.onGet(`${BASE}/projects/789/files`).reply({ name: 'P', files: [] })

      await service.getProjectFiles(null, '789', false)

      expect(mock.history[0].query.branch_data).toBeUndefined()
    })
  })

  // ── Components & Styles ──

  describe('getTeamComponents', () => {
    it('sends correct request with defaults', async () => {
      const responseData = { meta: { components: [] } }
      mock.onGet(`${BASE}/teams/12345/components`).reply(responseData)

      const result = await service.getTeamComponents('12345')

      expect(result).toEqual(responseData)
    })

    it('passes pagination parameters', async () => {
      mock.onGet(`${BASE}/teams/12345/components`).reply({ meta: { components: [] } })

      await service.getTeamComponents('12345', 50, 'cursor_abc')

      expect(mock.history[0].query).toMatchObject({
        page_size: 50,
        after: 'cursor_abc',
      })
    })
  })

  describe('getFileComponents', () => {
    it('sends correct request', async () => {
      const responseData = { meta: { components: [{ key: 'k1', name: 'Button' }] } }
      mock.onGet(`${BASE}/files/abc123/components`).reply(responseData)

      const result = await service.getFileComponents('abc123')

      expect(result).toEqual(responseData)
    })
  })

  describe('getComponent', () => {
    it('sends correct request', async () => {
      const responseData = { meta: { key: 'comp1', name: 'Button' } }
      mock.onGet(`${BASE}/components/comp1`).reply(responseData)

      const result = await service.getComponent('comp1')

      expect(result).toEqual(responseData)
    })
  })

  describe('getTeamComponentSets', () => {
    it('sends correct request with pagination', async () => {
      const responseData = { meta: { component_sets: [] } }
      mock.onGet(`${BASE}/teams/12345/component_sets`).reply(responseData)

      const result = await service.getTeamComponentSets('12345', 10, 'cur1')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({ page_size: 10, after: 'cur1' })
    })
  })

  describe('getTeamStyles', () => {
    it('sends correct request with pagination', async () => {
      const responseData = { meta: { styles: [] } }
      mock.onGet(`${BASE}/teams/12345/styles`).reply(responseData)

      const result = await service.getTeamStyles('12345', 20, 'cur2')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({ page_size: 20, after: 'cur2' })
    })
  })

  describe('getFileStyles', () => {
    it('sends correct request', async () => {
      const responseData = { meta: { styles: [{ key: 's1', name: 'Primary' }] } }
      mock.onGet(`${BASE}/files/abc123/styles`).reply(responseData)

      const result = await service.getFileStyles('abc123')

      expect(result).toEqual(responseData)
    })
  })

  // ── User ──

  describe('getMe', () => {
    it('sends correct request and returns user data', async () => {
      const responseData = { id: '12345', email: 'jane@example.com', handle: 'Jane' }
      mock.onGet(`${BASE}/me`).reply(responseData)

      const result = await service.getMe()

      expect(result).toEqual(responseData)
      expect(mock.history[0].headers).toMatchObject({ 'X-Figma-Token': ACCESS_TOKEN })
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('sends correct request with default context (team)', async () => {
      const responseData = { webhooks: [{ id: 'whk_1' }] }
      mock.onGet(`${BASE_V2}/webhooks`).reply(responseData)

      const result = await service.listWebhooks(undefined, '12345')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({ context: 'team', context_id: '12345' })
    })

    it('resolves Project context', async () => {
      mock.onGet(`${BASE_V2}/webhooks`).reply({ webhooks: [] })

      await service.listWebhooks('Project', 'proj_1')

      expect(mock.history[0].query).toMatchObject({ context: 'project', context_id: 'proj_1' })
    })

    it('resolves File context and extracts file key from URL', async () => {
      mock.onGet(`${BASE_V2}/webhooks`).reply({ webhooks: [] })

      await service.listWebhooks('File', 'https://www.figma.com/design/XYZ123/Title')

      expect(mock.history[0].query).toMatchObject({ context: 'file', context_id: 'XYZ123' })
    })

    it('extracts team ID from URL for team context', async () => {
      mock.onGet(`${BASE_V2}/webhooks`).reply({ webhooks: [] })

      await service.listWebhooks('Team', 'https://www.figma.com/files/team/99999/My-Team')

      expect(mock.history[0].query).toMatchObject({ context: 'team', context_id: '99999' })
    })
  })

  describe('createWebhook', () => {
    it('sends correct POST body', async () => {
      const responseData = { id: 'whk_2', event_type: 'FILE_UPDATE', status: 'ACTIVE' }
      mock.onPost(`${BASE_V2}/webhooks`).reply(responseData)

      const result = await service.createWebhook(
        'FILE_UPDATE', 'Team', '12345', 'https://example.com/hook', 'secret123', 'My hook'
      )

      expect(result).toEqual(responseData)
      expect(mock.history[0].body).toEqual({
        event_type: 'FILE_UPDATE',
        context: 'team',
        context_id: '12345',
        endpoint: 'https://example.com/hook',
        passcode: 'secret123',
        description: 'My hook',
      })
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${BASE_V2}/webhooks`).reply({ id: 'whk_3' })

      await service.createWebhook('FILE_COMMENT', 'File', 'abc123', 'https://example.com/hook', 'pass')

      expect(mock.history[0].body).toEqual({
        event_type: 'FILE_COMMENT',
        context: 'file',
        context_id: 'abc123',
        endpoint: 'https://example.com/hook',
        passcode: 'pass',
      })
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE_V2}/webhooks/whk_1`).reply({ id: 'whk_1' })

      const result = await service.deleteWebhook('whk_1')

      expect(result).toEqual({ id: 'whk_1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Dictionaries ──

  describe('getTeamProjectsDictionary', () => {
    it('returns empty items when no teamId in criteria', async () => {
      const result = await service.getTeamProjectsDictionary({ search: '', criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns projects formatted as dictionary items', async () => {
      mock.onGet(`${BASE}/teams/12345/projects`).reply({
        name: 'Team',
        projects: [
          { id: 100, name: 'Alpha' },
          { id: 200, name: 'Beta' },
        ],
      })

      const result = await service.getTeamProjectsDictionary({
        criteria: { teamId: '12345' },
      })

      expect(result.items).toEqual([
        { label: 'Alpha', value: '100', note: 'Project' },
        { label: 'Beta', value: '200', note: 'Project' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters projects by search term', async () => {
      mock.onGet(`${BASE}/teams/12345/projects`).reply({
        name: 'Team',
        projects: [
          { id: 100, name: 'Alpha' },
          { id: 200, name: 'Beta' },
        ],
      })

      const result = await service.getTeamProjectsDictionary({
        search: 'alph',
        criteria: { teamId: '12345' },
      })

      expect(result.items).toEqual([
        { label: 'Alpha', value: '100', note: 'Project' },
      ])
    })
  })

  describe('getProjectFilesDictionary', () => {
    it('returns empty items when no projectId in criteria', async () => {
      const result = await service.getProjectFilesDictionary({ search: '', criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns files formatted as dictionary items', async () => {
      mock.onGet(`${BASE}/projects/789/files`).reply({
        name: 'Project',
        files: [
          { key: 'abc', name: 'Landing Page', last_modified: '2024-01-15T10:30:00Z' },
          { key: 'def', name: 'Dashboard' },
        ],
      })

      const result = await service.getProjectFilesDictionary({
        criteria: { projectId: '789' },
      })

      expect(result.items).toEqual([
        { label: 'Landing Page', value: 'abc', note: 'Modified 2024-01-15' },
        { label: 'Dashboard', value: 'def', note: undefined },
      ])
    })

    it('filters files by search term', async () => {
      mock.onGet(`${BASE}/projects/789/files`).reply({
        name: 'Project',
        files: [
          { key: 'abc', name: 'Landing Page', last_modified: '2024-01-15T10:30:00Z' },
          { key: 'def', name: 'Dashboard', last_modified: '2024-02-01T00:00:00Z' },
        ],
      })

      const result = await service.getProjectFilesDictionary({
        search: 'dash',
        criteria: { projectId: '789' },
      })

      expect(result.items).toEqual([
        { label: 'Dashboard', value: 'def', note: 'Modified 2024-02-01' },
      ])
    })
  })
})
