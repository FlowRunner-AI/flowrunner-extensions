'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const AUTH_BASE = 'https://auth.atlassian.com'
const API_BASE = 'https://api.atlassian.com'
const CLOUD_ID = 'test-cloud-id-12345'
const SITE_BASE = `${ API_BASE }/ex/confluence/${ CLOUD_ID }`
const ACCESSIBLE_RESOURCES_URL = `${ API_BASE }/oauth/token/accessible-resources`

const SITE_RESOURCE = {
  id: CLOUD_ID,
  name: 'Test Site',
  url: 'https://test-site.atlassian.net',
  scopes: ['read:confluence-content.all'],
  avatarUrl: 'https://test-site.atlassian.net/avatar.png',
}

describe('Confluence Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    // Reset cached baseUrl so each test can set up accessible-resources independently
    service.baseUrl = undefined
    service.cloudId = undefined
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Helper to set up the accessible-resources mock that #getBaseUrl needs
  function mockSiteResolution() {
    mock.onGet(ACCESSIBLE_RESOURCES_URL).reply([SITE_RESOURCE])
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${ AUTH_BASE }/authorize`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('audience=api.atlassian.com')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and returns connection data', async () => {
      mock.onPost(`${ AUTH_BASE }/oauth/token`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(ACCESSIBLE_RESOURCES_URL).reply([SITE_RESOURCE])

      mock.onGet(`${ API_BASE }/ex/confluence/${ CLOUD_ID }/wiki/rest/api/user/current`).reply({
        displayName: 'John Smith',
        publicName: 'jsmith',
        profilePicture: { path: '/wiki/aa-avatar/123' },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result).toMatchObject({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        overwrite: true,
      })
      expect(result.connectionIdentityName).toContain('John Smith')
      expect(result.connectionIdentityName).toContain('Test Site')
      expect(result.connectionIdentityImageURL).toContain('https://test-site.atlassian.net/wiki/aa-avatar/123')

      // Verify token request body
      const tokenCall = mock.history.find(c => c.url === `${ AUTH_BASE }/oauth/token`)

      expect(tokenCall.body).toMatchObject({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'auth-code',
        redirect_uri: 'https://flowrunner.com/callback',
      })
    })

    it('falls back to site name when user fetch fails', async () => {
      mock.onPost(`${ AUTH_BASE }/oauth/token`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(ACCESSIBLE_RESOURCES_URL).reply([SITE_RESOURCE])

      mock.onGet(`${ API_BASE }/ex/confluence/${ CLOUD_ID }/wiki/rest/api/user/current`)
        .replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Test Site')
      expect(result.connectionIdentityImageURL).toBe('https://test-site.atlassian.net/avatar.png')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(`${ AUTH_BASE }/oauth/token`).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
      })

      expect(mock.history[0].body).toMatchObject({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: 'old-refresh-token',
      })
    })

    it('preserves original refresh token when new one is not returned', async () => {
      mock.onPost(`${ AUTH_BASE }/oauth/token`).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('original-refresh-token')

      expect(result.refreshToken).toBe('original-refresh-token')
    })
  })

  // ── Spaces ──

  describe('listSpaces', () => {
    it('sends correct request with defaults', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({
        results: [{ id: '1', key: 'DOCS', name: 'Docs' }],
        _links: { next: '/wiki/api/v2/spaces?cursor=abc123' },
      })

      const result = await service.listSpaces()

      expect(result.results).toHaveLength(1)
      expect(result.nextCursor).toBe('abc123')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces`)

      expect(apiCall.headers).toMatchObject({
        'Authorization': `Bearer ${ OAUTH_TOKEN }`,
      })
    })

    it('passes type, status, sort, limit, and cursor', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({ results: [] })

      await service.listSpaces('Global', 'Current', 'Name (A-Z)', 10, 'cursor123')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces`)

      expect(apiCall.query).toMatchObject({
        type: 'global',
        status: 'current',
        sort: 'name',
        limit: 10,
        cursor: 'cursor123',
      })
    })

    it('returns empty results and null cursor when no data', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({ results: [] })

      const result = await service.listSpaces()

      expect(result).toEqual({ results: [], nextCursor: null })
    })
  })

  describe('getSpace', () => {
    it('fetches a space by ID', async () => {
      mockSiteResolution()
      const spaceData = { id: '67890', key: 'DOCS', name: 'Documentation' }

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/67890`).reply(spaceData)

      const result = await service.getSpace('67890')

      expect(result).toEqual(spaceData)
    })

    it('passes description-format query parameter', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/67890`).reply({ id: '67890' })

      await service.getSpace('67890', 'Plain')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces/67890`)

      expect(apiCall.query).toMatchObject({ 'description-format': 'plain' })
    })
  })

  // ── Pages ──

  describe('listPages', () => {
    it('sends correct request with all filters', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ results: [] })

      await service.listPages('67890', 'Current', 'My Title', 'Title (A-Z)', 50, 'cur1')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages`)

      expect(apiCall.query).toMatchObject({
        'space-id': '67890',
        status: 'current',
        title: 'My Title',
        sort: 'title',
        limit: 50,
        cursor: 'cur1',
      })
    })

    it('omits optional filters when not provided', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ results: [] })

      await service.listPages()

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages`)

      expect(apiCall.query).toEqual({})
    })
  })

  describe('getPage', () => {
    it('fetches a page with default body format', async () => {
      mockSiteResolution()
      const pageData = { id: '12345', title: 'Test Page' }

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply(pageData)

      const result = await service.getPage('12345')

      expect(result).toEqual(pageData)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'storage' })
    })

    it('passes custom body format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({ id: '12345' })

      await service.getPage('12345', 'Atlas Doc Format')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'atlas_doc_format' })
    })
  })

  describe('getPagesInSpace', () => {
    it('sends request to space-specific pages endpoint', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/67890/pages`).reply({ results: [{ id: '1' }] })

      const result = await service.getPagesInSpace('67890')

      expect(result.results).toHaveLength(1)
    })

    it('passes status, sort, limit, and cursor', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/67890/pages`).reply({ results: [] })

      await service.getPagesInSpace('67890', 'Archived', 'Created (Newest First)', 10, 'cur1')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces/67890/pages`)

      expect(apiCall.query).toMatchObject({
        status: 'archived',
        sort: '-created-date',
        limit: 10,
        cursor: 'cur1',
      })
    })
  })

  describe('getChildPages', () => {
    it('fetches child pages of a parent page', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/children`).reply({
        results: [{ id: '22222', title: 'Child Page' }],
      })

      const result = await service.getChildPages('12345')

      expect(result.results).toHaveLength(1)
      expect(result.results[0].title).toBe('Child Page')
    })

    it('passes limit and cursor', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/children`).reply({ results: [] })

      await service.getChildPages('12345', 5, 'cur2')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/children`)

      expect(apiCall.query).toMatchObject({ limit: 5, cursor: 'cur2' })
    })
  })

  describe('createPage', () => {
    it('sends POST with correct body for a published page', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ id: '33333', title: 'New Page' })

      const result = await service.createPage('67890', 'New Page', '<p>Hello</p>', '12345', 'Current')

      expect(result).toMatchObject({ id: '33333', title: 'New Page' })

      const apiCall = mock.history.find(c => c.method === 'post' && c.url === `${ SITE_BASE }/wiki/api/v2/pages`)

      expect(apiCall.body).toEqual({
        spaceId: '67890',
        status: 'current',
        title: 'New Page',
        parentId: '12345',
        body: { representation: 'storage', value: '<p>Hello</p>' },
      })
    })

    it('omits parentId and body when not provided', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ id: '33334' })

      await service.createPage('67890', 'Blank Page')

      const apiCall = mock.history.find(c => c.method === 'post' && c.url === `${ SITE_BASE }/wiki/api/v2/pages`)

      expect(apiCall.body).toEqual({
        spaceId: '67890',
        status: 'current',
        title: 'Blank Page',
      })
      expect(apiCall.body.parentId).toBeUndefined()
      expect(apiCall.body.body).toBeUndefined()
    })

    it('creates a draft page', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ id: '33335', status: 'draft' })

      await service.createPage('67890', 'Draft', '<p>Draft</p>', null, 'Draft')

      const apiCall = mock.history.find(c => c.method === 'post' && c.url === `${ SITE_BASE }/wiki/api/v2/pages`)

      expect(apiCall.body.status).toBe('draft')
    })
  })

  describe('updatePage', () => {
    it('fetches current page, merges changes, and increments version', async () => {
      mockSiteResolution()

      // First call: fetch current page
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({
        id: '12345',
        title: 'Old Title',
        status: 'current',
        body: { storage: { value: '<p>Old content</p>' } },
        version: { number: 3 },
      })

      // Second call: update page
      mock.onPut(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({
        id: '12345',
        title: 'New Title',
        version: { number: 4 },
      })

      const result = await service.updatePage('12345', 'New Title', '<p>New content</p>', 'Current', 'Updated via test')

      expect(result).toMatchObject({ id: '12345', title: 'New Title' })

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({
        id: '12345',
        status: 'current',
        title: 'New Title',
        body: { representation: 'storage', value: '<p>New content</p>' },
        version: { number: 4, message: 'Updated via test' },
      })
    })

    it('preserves current title and body when not provided', async () => {
      mockSiteResolution()

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({
        id: '12345',
        title: 'Existing Title',
        status: 'current',
        body: { storage: { value: '<p>Existing</p>' } },
        version: { number: 2 },
      })

      mock.onPut(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({ id: '12345' })

      await service.updatePage('12345')

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body.title).toBe('Existing Title')
      expect(putCall.body.body.value).toBe('<p>Existing</p>')
      expect(putCall.body.version.number).toBe(3)
      expect(putCall.body.version.message).toBe('')
    })
  })

  describe('deletePage', () => {
    it('deletes a page and returns success', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({})

      const result = await service.deletePage('12345')

      expect(result).toEqual({ success: true })
    })

    it('passes draft query parameter', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({})

      await service.deletePage('12345', true, false)

      const apiCall = mock.history.find(c => c.method === 'delete')

      expect(apiCall.query).toMatchObject({ draft: 'true' })
    })

    it('passes purge query parameter', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/pages/12345`).reply({})

      await service.deletePage('12345', false, true)

      const apiCall = mock.history.find(c => c.method === 'delete')

      expect(apiCall.query).toMatchObject({ purge: 'true' })
    })
  })

  // ── Blog Posts ──

  describe('listBlogPosts', () => {
    it('sends correct request with all filters', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/blogposts`).reply({ results: [] })

      await service.listBlogPosts('67890', 'Current', 'Title (Z-A)', 20, 'cur1')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/blogposts`)

      expect(apiCall.query).toMatchObject({
        'space-id': '67890',
        status: 'current',
        sort: '-title',
        limit: 20,
        cursor: 'cur1',
      })
    })

    it('omits filters when not provided', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/blogposts`).reply({ results: [] })

      await service.listBlogPosts()

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/blogposts`)

      expect(apiCall.query).toEqual({})
    })
  })

  describe('getBlogPost', () => {
    it('fetches a blog post with default body format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/blogposts/55555`).reply({ id: '55555', title: 'Blog' })

      const result = await service.getBlogPost('55555')

      expect(result).toMatchObject({ id: '55555' })

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/blogposts/55555`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'storage' })
    })

    it('passes View body format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/blogposts/55555`).reply({ id: '55555' })

      await service.getBlogPost('55555', 'View')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/blogposts/55555`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'view' })
    })
  })

  describe('createBlogPost', () => {
    it('sends POST with correct body', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/blogposts`).reply({ id: '55556', title: 'New Blog' })

      const result = await service.createBlogPost('67890', 'New Blog', '<p>Content</p>', 'Draft')

      expect(result).toMatchObject({ id: '55556' })

      const apiCall = mock.history.find(c => c.method === 'post' && c.url === `${ SITE_BASE }/wiki/api/v2/blogposts`)

      expect(apiCall.body).toEqual({
        spaceId: '67890',
        status: 'draft',
        title: 'New Blog',
        body: { representation: 'storage', value: '<p>Content</p>' },
      })
    })
  })

  // ── Comments ──

  describe('listFooterComments', () => {
    it('sends correct request with body format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/footer-comments`).reply({ results: [{ id: '98765' }] })

      const result = await service.listFooterComments('12345', 'View', 10, 'cur1')

      expect(result.results).toHaveLength(1)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/footer-comments`)

      expect(apiCall.query).toMatchObject({
        'body-format': 'view',
        limit: 10,
        cursor: 'cur1',
      })
    })

    it('uses storage as default body format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/footer-comments`).reply({ results: [] })

      await service.listFooterComments('12345')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/footer-comments`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'storage' })
    })
  })

  describe('createFooterComment', () => {
    it('creates a top-level comment on a page', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/footer-comments`).reply({ id: '98766' })

      await service.createFooterComment('12345', '<p>Nice</p>', 'Storage')

      const apiCall = mock.history.find(c => c.method === 'post')

      expect(apiCall.body).toEqual({
        pageId: '12345',
        body: { representation: 'storage', value: '<p>Nice</p>' },
      })
    })

    it('creates a threaded reply when parentCommentId is provided', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/api/v2/footer-comments`).reply({ id: '98767' })

      await service.createFooterComment('12345', '<p>Reply</p>', 'Wiki', '98765')

      const apiCall = mock.history.find(c => c.method === 'post')

      expect(apiCall.body).toEqual({
        parentCommentId: '98765',
        body: { representation: 'wiki', value: '<p>Reply</p>' },
      })
      // pageId should NOT be in the body when parentCommentId is present
      expect(apiCall.body.pageId).toBeUndefined()
    })
  })

  describe('getComment', () => {
    it('fetches a comment by ID with default format', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/footer-comments/98765`).reply({ id: '98765' })

      const result = await service.getComment('98765')

      expect(result).toMatchObject({ id: '98765' })

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/footer-comments/98765`)

      expect(apiCall.query).toMatchObject({ 'body-format': 'storage' })
    })
  })

  describe('deleteComment', () => {
    it('deletes a comment and returns success', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/footer-comments/98765`).reply({})

      const result = await service.deleteComment('98765')

      expect(result).toEqual({ success: true })
    })
  })

  describe('listInlineComments', () => {
    it('sends correct request', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/inline-comments`).reply({ results: [{ id: '87654' }] })

      const result = await service.listInlineComments('12345', 'View', 5, 'cur1')

      expect(result.results).toHaveLength(1)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/inline-comments`)

      expect(apiCall.query).toMatchObject({
        'body-format': 'view',
        limit: 5,
        cursor: 'cur1',
      })
    })
  })

  // ── Attachments ──

  describe('listPageAttachments', () => {
    it('sends correct request with filename filter', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/attachments`).reply({
        results: [{ id: 'att111', title: 'diagram.png' }],
      })

      const result = await service.listPageAttachments('12345', 'diagram.png', 10)

      expect(result.results).toHaveLength(1)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/attachments`)

      expect(apiCall.query).toMatchObject({ filename: 'diagram.png', limit: 10 })
    })

    it('omits optional filters', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/attachments`).reply({ results: [] })

      await service.listPageAttachments('12345')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/attachments`)

      expect(apiCall.query).toEqual({})
    })
  })

  describe('getAttachment', () => {
    it('fetches attachment metadata', async () => {
      mockSiteResolution()
      const attachmentData = { id: 'att111', title: 'diagram.png', mediaType: 'image/png' }

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/attachments/att111`).reply(attachmentData)

      const result = await service.getAttachment('att111')

      expect(result).toEqual(attachmentData)
    })
  })

  describe('uploadAttachment', () => {
    it('uploads a file as an attachment', async () => {
      mockSiteResolution()

      // Mock the file download
      mock.onGet('https://storage.flowrunner.com/files/report.pdf').reply(Buffer.from('file-content'))

      // Mock the upload endpoint
      mock.onPost(`${ SITE_BASE }/wiki/rest/api/content/12345/child/attachment`).reply({
        results: [{ id: 'att222', title: 'report.pdf' }],
        size: 1,
      })

      const result = await service.uploadAttachment('12345', 'https://storage.flowrunner.com/files/report.pdf', 'report.pdf', 'Test upload')

      expect(result).toMatchObject({ size: 1 })

      const uploadCall = mock.history.find(c => c.method === 'post' && c.url.includes('child/attachment'))

      expect(uploadCall.headers).toMatchObject({
        'Authorization': `Bearer ${ OAUTH_TOKEN }`,
        'X-Atlassian-Token': 'nocheck',
      })
      expect(uploadCall.formData).toBeDefined()
    })

    it('derives filename from URL when not provided', async () => {
      mockSiteResolution()

      mock.onGet('https://storage.flowrunner.com/files/my-doc.pdf').reply(Buffer.from('data'))
      mock.onPost(`${ SITE_BASE }/wiki/rest/api/content/12345/child/attachment`).reply({
        results: [{ id: 'att223' }],
        size: 1,
      })

      await service.uploadAttachment('12345', 'https://storage.flowrunner.com/files/my-doc.pdf')

      // Just verify it completes without error
      const uploadCall = mock.history.find(c => c.method === 'post' && c.url.includes('child/attachment'))

      expect(uploadCall).toBeDefined()
    })
  })

  describe('downloadAttachment', () => {
    it('downloads attachment and saves to file storage', async () => {
      mockSiteResolution()

      // Mock metadata fetch
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/attachments/att111`).reply({
        id: 'att111',
        title: 'diagram.png',
        mediaType: 'image/png',
        fileSize: 34567,
        downloadLink: '/download/attachments/12345/diagram.png?version=1',
      })

      // Mock file download
      mock.onGet(`${ SITE_BASE }/wiki/download/attachments/12345/diagram.png?version=1`).reply(Buffer.from('image-data'))

      // Mock Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.flowrunner.com/files/diagram.png' }),
        },
      }

      const result = await service.downloadAttachment('att111')

      expect(result).toMatchObject({
        fileName: 'diagram.png',
        mediaType: 'image/png',
        sizeBytes: 34567,
        downloadUrl: 'https://storage.flowrunner.com/files/diagram.png',
      })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'diagram.png',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('throws when attachment has no download link', async () => {
      mockSiteResolution()

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/attachments/att999`).reply({
        id: 'att999',
        title: 'broken.txt',
      })

      await expect(service.downloadAttachment('att999')).rejects.toThrow('no download link')
    })

    it('uses _links.download as fallback', async () => {
      mockSiteResolution()

      mock.onGet(`${ SITE_BASE }/wiki/api/v2/attachments/att222`).reply({
        id: 'att222',
        title: 'file.txt',
        mediaType: 'text/plain',
        fileSize: 100,
        _links: { download: '/download/attachments/12345/file.txt' },
      })

      mock.onGet(`${ SITE_BASE }/wiki/download/attachments/12345/file.txt`).reply(Buffer.from('text'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.flowrunner.com/files/file.txt' }),
        },
      }

      const result = await service.downloadAttachment('att222')

      expect(result.downloadUrl).toBe('https://storage.flowrunner.com/files/file.txt')
    })
  })

  describe('deleteAttachment', () => {
    it('deletes an attachment and returns success', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/attachments/att111`).reply({})

      const result = await service.deleteAttachment('att111')

      expect(result).toEqual({ success: true })
    })

    it('passes purge query parameter', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/api/v2/attachments/att111`).reply({})

      await service.deleteAttachment('att111', true)

      const apiCall = mock.history.find(c => c.method === 'delete')

      expect(apiCall.query).toMatchObject({ purge: 'true' })
    })
  })

  // ── Labels ──

  describe('getPageLabels', () => {
    it('fetches labels for a page with prefix filter', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/labels`).reply({
        results: [{ id: '456', name: 'documentation', prefix: 'global' }],
      })

      const result = await service.getPageLabels('12345', 'Global', 10)

      expect(result.results).toHaveLength(1)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/labels`)

      expect(apiCall.query).toMatchObject({ prefix: 'global', limit: 10 })
    })

    it('omits optional filters', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages/12345/labels`).reply({ results: [] })

      await service.getPageLabels('12345')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/pages/12345/labels`)

      expect(apiCall.query).toEqual({})
    })
  })

  describe('addLabelsToPage', () => {
    it('sends POST with label array', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/rest/api/content/12345/label`).reply({
        results: [{ prefix: 'global', name: 'docs' }, { prefix: 'global', name: 'api' }],
      })

      const result = await service.addLabelsToPage('12345', ['docs', 'api'])

      const apiCall = mock.history.find(c => c.method === 'post' && c.url.includes('/label'))

      expect(apiCall.body).toEqual([
        { prefix: 'global', name: 'docs' },
        { prefix: 'global', name: 'api' },
      ])
      expect(result.results).toHaveLength(2)
    })

    it('handles a single label string', async () => {
      mockSiteResolution()
      mock.onPost(`${ SITE_BASE }/wiki/rest/api/content/12345/label`).reply({ results: [] })

      await service.addLabelsToPage('12345', 'docs')

      const apiCall = mock.history.find(c => c.method === 'post' && c.url.includes('/label'))

      expect(apiCall.body).toEqual([{ prefix: 'global', name: 'docs' }])
    })

    it('throws when labels is empty', async () => {
      await expect(service.addLabelsToPage('12345', [])).rejects.toThrow('at least one label')
    })
  })

  describe('removeLabelFromPage', () => {
    it('sends DELETE for a label', async () => {
      mockSiteResolution()
      mock.onDelete(`${ SITE_BASE }/wiki/rest/api/content/12345/label/documentation`).reply({})

      const result = await service.removeLabelFromPage('12345', 'documentation')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Search ──

  describe('searchContent', () => {
    it('passes raw CQL query', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/rest/api/search`).reply({ results: [], totalSize: 0 })

      await service.searchContent('type = page AND text ~ "release"', null, null, null, 10, 0)

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/rest/api/search`)

      expect(apiCall.query).toMatchObject({
        cql: 'type = page AND text ~ "release"',
        limit: 10,
        start: 0,
      })
    })

    it('builds CQL from convenience filters', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/rest/api/search`).reply({ results: [] })

      await service.searchContent(null, 'release notes', 'DOCS', 'Page')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/rest/api/search`)

      expect(apiCall.query.cql).toBe('text ~ "release notes" AND space = "DOCS" AND type = page')
    })

    it('builds CQL with only text filter', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/rest/api/search`).reply({ results: [] })

      await service.searchContent(null, 'hello')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/rest/api/search`)

      expect(apiCall.query.cql).toBe('text ~ "hello"')
    })

    it('throws when no CQL and no convenience filters provided', async () => {
      await expect(service.searchContent()).rejects.toThrow('CQL query or at least one convenience filter')
    })

    it('escapes special characters in CQL text', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/rest/api/search`).reply({ results: [] })

      await service.searchContent(null, 'test "quoted" value')

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/rest/api/search`)

      expect(apiCall.query.cql).toBe('text ~ "test \\"quoted\\" value"')
    })
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('returns the current user profile', async () => {
      mockSiteResolution()
      const userData = { accountId: '5b10ac8d', displayName: 'John Smith' }

      mock.onGet(`${ SITE_BASE }/wiki/rest/api/user/current`).reply(userData)

      const result = await service.getCurrentUser()

      expect(result).toEqual(userData)
    })
  })

  // ── Dictionaries ──

  describe('getSpacesDictionary', () => {
    it('returns formatted space items', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({
        results: [
          { id: '1', key: 'DOCS', name: 'Documentation', type: 'global' },
          { id: '2', key: 'TEAM', name: 'Team Space', type: 'personal' },
        ],
        _links: { next: '/wiki/api/v2/spaces?cursor=next123' },
      })

      const result = await service.getSpacesDictionary({})

      expect(result.items).toEqual([
        { label: 'Documentation (DOCS)', value: '1', note: 'Type: global' },
        { label: 'Team Space (TEAM)', value: '2', note: 'Type: personal' },
      ])
      expect(result.cursor).toBe('next123')
    })

    it('filters by search term', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({
        results: [
          { id: '1', key: 'DOCS', name: 'Documentation', type: 'global' },
          { id: '2', key: 'TEAM', name: 'Team Space', type: 'personal' },
        ],
      })

      const result = await service.getSpacesDictionary({ search: 'doc' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('Documentation')
    })

    it('sends sort and limit query params', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces`).reply({ results: [] })

      await service.getSpacesDictionary({ cursor: 'cur1' })

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces`)

      expect(apiCall.query).toMatchObject({ limit: 50, sort: 'name', cursor: 'cur1' })
    })
  })

  describe('getPagesDictionary', () => {
    it('returns formatted page items', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages`).reply({
        results: [
          { id: '12345', title: 'Release Notes', status: 'current' },
        ],
      })

      const result = await service.getPagesDictionary({})

      expect(result.items).toEqual([
        { label: 'Release Notes', value: '12345', note: 'Status: current' },
      ])
    })

    it('uses space-specific endpoint when spaceId criteria is provided', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/67890/pages`).reply({ results: [] })

      await service.getPagesDictionary({ criteria: { spaceId: '67890' } })

      const apiCall = mock.history.find(c => c.url === `${ SITE_BASE }/wiki/api/v2/spaces/67890/pages`)

      expect(apiCall).toBeDefined()
      expect(apiCall.query).toMatchObject({ limit: 50, sort: '-modified-date' })
    })

    it('filters by search term', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages`).reply({
        results: [
          { id: '1', title: 'Release Notes', status: 'current' },
          { id: '2', title: 'Architecture', status: 'current' },
        ],
      })

      const result = await service.getPagesDictionary({ search: 'release' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Release Notes')
    })

    it('handles null payload', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/pages`).reply({ results: [] })

      const result = await service.getPagesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws formatted error from v2 error response', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/999`).replyWithError({
        message: 'Not Found',
        body: { errors: [{ title: 'Space not found', detail: 'No space with ID 999' }] },
      })

      await expect(service.getSpace('999')).rejects.toThrow('Confluence API error: Space not found')
    })

    it('throws formatted error from v1 error response', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/rest/api/user/current`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Authentication required' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Confluence API error: Authentication required')
    })

    it('throws generic error when no body available', async () => {
      mockSiteResolution()
      mock.onGet(`${ SITE_BASE }/wiki/api/v2/spaces/888`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getSpace('888')).rejects.toThrow('Confluence API error: Network error')
    })

    it('throws when site resolution fails', async () => {
      mock.onGet(ACCESSIBLE_RESOURCES_URL).replyWithError({ message: 'Token expired' })

      await expect(service.listSpaces()).rejects.toThrow('could not resolve the Confluence Cloud site')
    })

    it('throws when no accessible Confluence site found', async () => {
      mock.onGet(ACCESSIBLE_RESOURCES_URL).reply([])

      await expect(service.listSpaces()).rejects.toThrow('No accessible Confluence Cloud site found')
    })
  })
})
