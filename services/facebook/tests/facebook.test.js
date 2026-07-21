'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://graph.facebook.com/v25.0'

describe('Facebook Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accessToken', required: true, shared: false }),
          expect.objectContaining({ name: 'apiVersion', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Pages ──

  describe('listMyPages', () => {
    const url = `${BASE}/me/accounts`

    it('sends correct request with defaults', async () => {
      const mockResponse = { data: [{ id: '123', name: 'Test Page' }], paging: {} }
      mock.onGet(url).reply(mockResponse)

      const result = await service.listMyPages()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ACCESS_TOKEN}` })
      expect(mock.history[0].query).toMatchObject({
        fields: 'id,name,category,access_token,tasks',
        limit: 25,
      })
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.listMyPages(10, 'cursor123')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'cursor123' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid token', type: 'OAuthException', code: 190 } },
      })

      await expect(service.listMyPages()).rejects.toThrow('Facebook API error')
    })
  })

  describe('getPage', () => {
    const pageId = '123456'
    const url = `${BASE}/${pageId}`

    it('sends correct request with default fields', async () => {
      const mockResponse = { id: pageId, name: 'Test Page' }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getPage(pageId)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        fields: 'name,about,fan_count,category,link,website,verification_status',
      })
    })

    it('passes custom fields', async () => {
      mock.onGet(url).reply({ id: pageId })

      await service.getPage(pageId, 'name,fan_count')

      expect(mock.history[0].query).toMatchObject({ fields: 'name,fan_count' })
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-xyz'
      mock.onGet(url).reply({ id: pageId })

      await service.getPage(pageId, undefined, pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  // ── Posts ──

  describe('createPagePost', () => {
    const pageId = '123456'
    const url = `${BASE}/${pageId}/feed`

    it('sends POST with message', async () => {
      mock.onPost(url).reply({ id: '123456_789' })

      const result = await service.createPagePost(pageId, 'Hello world')

      expect(result).toEqual({ id: '123456_789' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ message: 'Hello world' })
    })

    it('includes link when provided', async () => {
      mock.onPost(url).reply({ id: '123456_790' })

      await service.createPagePost(pageId, 'Check this', 'https://example.com')

      expect(mock.history[0].body).toEqual({ message: 'Check this', link: 'https://example.com' })
    })

    it('includes published and scheduled_publish_time', async () => {
      mock.onPost(url).reply({ id: '123456_791' })

      await service.createPagePost(pageId, 'Scheduled', undefined, false, 1700000000)

      expect(mock.history[0].body).toEqual({
        message: 'Scheduled',
        published: false,
        scheduled_publish_time: 1700000000,
      })
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-abc'
      mock.onPost(url).reply({ id: '123456_792' })

      await service.createPagePost(pageId, 'Test', undefined, undefined, undefined, pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Missing message or link', type: 'OAuthException', code: 100 } },
      })

      await expect(service.createPagePost(pageId)).rejects.toThrow('Facebook API error')
    })
  })

  describe('getPost', () => {
    const postId = '123456_789'
    const url = `${BASE}/${postId}`

    it('sends correct request with default fields', async () => {
      const mockResponse = { id: postId, message: 'Hello' }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getPost(postId)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        fields: 'message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
      })
    })

    it('passes custom fields', async () => {
      mock.onGet(url).reply({ id: postId })

      await service.getPost(postId, 'message,shares')

      expect(mock.history[0].query).toMatchObject({ fields: 'message,shares' })
    })
  })

  describe('listPagePosts', () => {
    const pageId = '123456'
    const url = `${BASE}/${pageId}/posts`

    it('sends correct request with defaults', async () => {
      mock.onGet(url).reply({ data: [], paging: {} })

      await service.listPagePosts(pageId)

      expect(mock.history[0].query).toMatchObject({
        fields: 'id,message,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
        limit: 25,
      })
    })

    it('passes custom limit, after cursor, and fields', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.listPagePosts(pageId, 5, 'cursor_abc', 'id,message')

      expect(mock.history[0].query).toMatchObject({
        fields: 'id,message',
        limit: 5,
        after: 'cursor_abc',
      })
    })
  })

  describe('updatePost', () => {
    const postId = '123456_789'
    const url = `${BASE}/${postId}`

    it('sends POST with updated message', async () => {
      mock.onPost(url).reply({ success: true })

      const result = await service.updatePost(postId, 'Updated text')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ message: 'Updated text' })
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-upd'
      mock.onPost(url).reply({ success: true })

      await service.updatePost(postId, 'Msg', pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  describe('deletePost', () => {
    const postId = '123456_789'
    const url = `${BASE}/${postId}`

    it('sends DELETE request', async () => {
      mock.onDelete(url).reply({ success: true })

      const result = await service.deletePost(postId)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-del'
      mock.onDelete(url).reply({ success: true })

      await service.deletePost(postId, pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  // ── Photos ──

  describe('uploadPhoto', () => {
    const pageId = '123456'
    const url = `${BASE}/${pageId}/photos`

    it('sends POST with image URL when no file provided', async () => {
      mock.onPost(url).reply({ id: '5566778899', post_id: '123456_5566778899' })

      const result = await service.uploadPhoto(pageId, 'https://example.com/photo.jpg')

      expect(result).toEqual({ id: '5566778899', post_id: '123456_5566778899' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ url: 'https://example.com/photo.jpg' })
    })

    it('includes message and published with URL upload', async () => {
      mock.onPost(url).reply({ id: '5566778899' })

      await service.uploadPhoto(pageId, 'https://example.com/photo.jpg', undefined, 'Caption!', false)

      expect(mock.history[0].body).toEqual({
        url: 'https://example.com/photo.jpg',
        message: 'Caption!',
        published: false,
      })
    })

    it('uploads via multipart when fileUrl is provided', async () => {
      const fileUrl = 'https://files.flowrunner.io/photo.jpg'
      const fileBytes = Buffer.from('fake-image-bytes')

      // First call: GET the file bytes
      mock.onGet(fileUrl).reply(fileBytes)
      // Second call: POST multipart form
      mock.onPost(url).reply({ id: '5566778899', post_id: '123456_5566778899' })

      const result = await service.uploadPhoto(pageId, undefined, fileUrl, 'My photo', true)

      expect(result).toEqual({ id: '5566778899', post_id: '123456_5566778899' })
      expect(mock.history).toHaveLength(2)

      // Verify the file download used setEncoding(null)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()

      // Verify the upload used formData
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].formData).toBeDefined()
      expect(mock.history[1].formData._fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'source' }),
          expect.objectContaining({ name: 'message', value: 'My photo' }),
          expect.objectContaining({ name: 'published', value: 'true' }),
        ])
      )
    })

    it('omits message and published from formData when not provided', async () => {
      const fileUrl = 'https://files.flowrunner.io/image.png'
      mock.onGet(fileUrl).reply(Buffer.from('bytes'))
      mock.onPost(url).reply({ id: '999' })

      await service.uploadPhoto(pageId, undefined, fileUrl)

      const fields = mock.history[1].formData._fields
      expect(fields).toHaveLength(1)
      expect(fields[0].name).toBe('source')
    })

    it('uses page access token for multipart upload', async () => {
      const fileUrl = 'https://files.flowrunner.io/image.png'
      const pageToken = 'page-token-photo'
      mock.onGet(fileUrl).reply(Buffer.from('bytes'))
      mock.onPost(url).reply({ id: '999' })

      await service.uploadPhoto(pageId, undefined, fileUrl, undefined, undefined, pageToken)

      expect(mock.history[1].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  // ── Comments ──

  describe('getComments', () => {
    const objectId = '123456_789'
    const url = `${BASE}/${objectId}/comments`

    it('sends correct request with defaults', async () => {
      const mockResponse = { data: [{ id: 'c1', message: 'Nice!' }] }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getComments(objectId)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        fields: 'id,message,created_time,from,like_count',
        limit: 25,
      })
    })

    it('resolves order dropdown value', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getComments(objectId, 'Ranked', 10)

      expect(mock.history[0].query).toMatchObject({ order: 'ranked', limit: 10 })
    })

    it('resolves Reverse Chronological order', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getComments(objectId, 'Reverse Chronological')

      expect(mock.history[0].query).toMatchObject({ order: 'reverse_chronological' })
    })

    it('passes through unmapped order values', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getComments(objectId, 'chronological')

      expect(mock.history[0].query).toMatchObject({ order: 'chronological' })
    })

    it('passes after cursor', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getComments(objectId, undefined, undefined, 'cursor_xyz')

      expect(mock.history[0].query).toMatchObject({ after: 'cursor_xyz' })
    })
  })

  describe('createComment', () => {
    const objectId = '123456_789'
    const url = `${BASE}/${objectId}/comments`

    it('sends POST with message', async () => {
      mock.onPost(url).reply({ id: '123456_789_c1' })

      const result = await service.createComment(objectId, 'Great post!')

      expect(result).toEqual({ id: '123456_789_c1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ message: 'Great post!' })
    })
  })

  describe('deleteComment', () => {
    const commentId = '123456_789_c1'
    const url = `${BASE}/${commentId}`

    it('sends DELETE request', async () => {
      mock.onDelete(url).reply({ success: true })

      const result = await service.deleteComment(commentId)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Likes ──

  describe('likeObject', () => {
    const objectId = '123456_789'
    const url = `${BASE}/${objectId}/likes`

    it('sends POST request', async () => {
      mock.onPost(url).reply({ success: true })

      const result = await service.likeObject(objectId)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ACCESS_TOKEN}` })
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-like'
      mock.onPost(url).reply({ success: true })

      await service.likeObject(objectId, pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  // ── Insights ──

  describe('getPageInsights', () => {
    const pageId = '123456'
    const url = `${BASE}/${pageId}/insights`

    it('sends correct request with array metrics and period', async () => {
      const mockResponse = { data: [{ name: 'page_impressions' }] }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getPageInsights(pageId, ['page_impressions', 'page_fans'], 'Day')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        metric: 'page_impressions,page_fans',
        period: 'day',
      })
    })

    it('handles string metrics (not array)', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getPageInsights(pageId, 'page_impressions', 'Week')

      expect(mock.history[0].query).toMatchObject({
        metric: 'page_impressions',
        period: 'week',
      })
    })

    it('resolves 28 Days period', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getPageInsights(pageId, 'page_fans', '28 Days')

      expect(mock.history[0].query).toMatchObject({ period: 'days_28' })
    })

    it('includes since and until when provided', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getPageInsights(pageId, 'page_impressions', 'Day', 1700000000, 1700100000)

      expect(mock.history[0].query).toMatchObject({ since: 1700000000, until: 1700100000 })
    })
  })

  describe('getPostInsights', () => {
    const postId = '123456_789'
    const url = `${BASE}/${postId}/insights`

    it('sends correct request with array metrics', async () => {
      mock.onGet(url).reply({ data: [{ name: 'post_impressions' }] })

      const result = await service.getPostInsights(postId, ['post_impressions', 'post_clicks'])

      expect(result).toEqual({ data: [{ name: 'post_impressions' }] })
      expect(mock.history[0].query).toMatchObject({ metric: 'post_impressions,post_clicks' })
    })

    it('handles string metrics', async () => {
      mock.onGet(url).reply({ data: [] })

      await service.getPostInsights(postId, 'post_engaged_users')

      expect(mock.history[0].query).toMatchObject({ metric: 'post_engaged_users' })
    })

    it('uses page access token when provided', async () => {
      const pageToken = 'page-token-insights'
      mock.onGet(url).reply({ data: [] })

      await service.getPostInsights(postId, 'post_impressions', pageToken)

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${pageToken}` })
    })
  })

  // ── Miscellaneous ──

  describe('getObject', () => {
    const objectId = '123456'
    const url = `${BASE}/${objectId}`

    it('sends correct request without fields', async () => {
      mock.onGet(url).reply({ id: objectId, name: 'Test' })

      const result = await service.getObject(objectId)

      expect(result).toEqual({ id: objectId, name: 'Test' })
      expect(mock.history[0].method).toBe('get')
    })

    it('passes custom fields', async () => {
      mock.onGet(url).reply({ id: objectId })

      await service.getObject(objectId, 'name,category')

      expect(mock.history[0].query).toMatchObject({ fields: 'name,category' })
    })
  })

  // ── Dictionary ──

  describe('getPagesDictionary', () => {
    const url = `${BASE}/me/accounts`

    it('returns items in dictionary format', async () => {
      mock.onGet(url).reply({
        data: [
          { id: '111', name: 'Acme Store', category: 'Retail' },
          { id: '222', name: 'Tech Blog', category: 'Blog' },
        ],
        paging: { cursors: { after: 'next_cursor' } },
      })

      const result = await service.getPagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Acme Store', value: '111', note: 'Retail' },
          { label: 'Tech Blog', value: '222', note: 'Blog' },
        ],
        cursor: 'next_cursor',
      })
      expect(mock.history[0].query).toMatchObject({ fields: 'id,name,category', limit: 100 })
    })

    it('filters items by search term', async () => {
      mock.onGet(url).reply({
        data: [
          { id: '111', name: 'Acme Store', category: 'Retail' },
          { id: '222', name: 'Tech Blog', category: 'Blog' },
        ],
        paging: {},
      })

      const result = await service.getPagesDictionary({ search: 'tech' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('222')
    })

    it('passes cursor to API', async () => {
      mock.onGet(url).reply({ data: [], paging: {} })

      await service.getPagesDictionary({ cursor: 'abc123' })

      expect(mock.history[0].query).toMatchObject({ after: 'abc123' })
    })

    it('handles empty payload', async () => {
      mock.onGet(url).reply({ data: [], paging: {} })

      const result = await service.getPagesDictionary()

      expect(result.items).toEqual([])
    })

    it('uses page id as label when name is missing', async () => {
      mock.onGet(url).reply({
        data: [{ id: '333' }],
        paging: {},
      })

      const result = await service.getPagesDictionary({})

      expect(result.items[0].label).toBe('333')
    })
  })

  // ── Error formatting ──

  describe('error handling', () => {
    it('includes type, code, and fbtrace_id in error message', async () => {
      mock.onGet(`${BASE}/me/accounts`).replyWithError({
        message: 'Request failed',
        body: {
          error: {
            message: 'Invalid OAuth token',
            type: 'OAuthException',
            code: 190,
            fbtrace_id: 'AbCdEf123',
          },
        },
      })

      await expect(service.listMyPages()).rejects.toThrow(
        'Facebook API error: Invalid OAuth token | type=OAuthException | code=190 | fbtrace_id=AbCdEf123'
      )
    })

    it('falls back to error.message when no FB error body', async () => {
      mock.onGet(`${BASE}/me/accounts`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listMyPages()).rejects.toThrow('Facebook API error: Network timeout')
    })
  })
})
