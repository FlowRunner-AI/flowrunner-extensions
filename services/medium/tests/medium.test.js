'use strict'

const { createSandbox } = require('../../../service-sandbox')

const TOKEN = 'test-integration-token'
const BASE = 'https://api.medium.com/v1'

describe('Medium Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ integrationToken: TOKEN })
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
          name: 'integrationToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── User ──

  describe('getCurrentUser', () => {
    it('sends GET to /me with correct auth headers', async () => {
      const userData = {
        id: '5303d74c64f66366f00cb9b2a94f3251bf5',
        username: 'majelbstoat',
        name: 'Jamie Talbot',
        url: 'https://medium.com/@majelbstoat',
        imageUrl: 'https://images.medium.com/0*fkfQiTzT7TlUGGyI.png',
      }

      mock.onGet(`${BASE}/me`).reply({ data: userData })

      const result = await service.getCurrentUser()

      expect(result).toEqual(userData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { errors: [{ message: 'Token was invalid.' }] },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Medium API error')
    })
  })

  // ── Posts ──

  describe('createPost', () => {
    const authorId = 'user-123'
    const postResponse = {
      data: {
        id: 'e6f36a',
        title: 'Test Post',
        authorId: 'user-123',
        url: 'https://medium.com/@test/test-post-e6f36a',
        publishStatus: 'public',
        license: 'all-rights-reserved',
      },
    }

    it('sends POST with required params only', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      const result = await service.createPost(authorId, 'Test Post', 'HTML', '<h1>Hello</h1>')

      expect(result).toEqual(postResponse.data)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        title: 'Test Post',
        contentFormat: 'html',
        content: '<h1>Hello</h1>',
      })
    })

    it('sends POST with all optional params', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      await service.createPost(
        authorId,
        'Test Post',
        'Markdown',
        '# Hello',
        ['tag1', 'tag2'],
        'https://example.com/original',
        'Draft',
        'CC 4.0 BY',
        true,
      )

      expect(mock.history[0].body).toEqual({
        title: 'Test Post',
        contentFormat: 'markdown',
        content: '# Hello',
        tags: ['tag1', 'tag2'],
        canonicalUrl: 'https://example.com/original',
        publishStatus: 'draft',
        license: 'cc-40-by',
        notifyFollowers: true,
      })
    })

    it('omits tags when empty array', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      await service.createPost(authorId, 'Test', 'HTML', '<p>body</p>', [])

      expect(mock.history[0].body).not.toHaveProperty('tags')
    })

    it('omits notifyFollowers when not boolean', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      await service.createPost(authorId, 'Test', 'HTML', '<p>body</p>', undefined, undefined, undefined, undefined, undefined)

      expect(mock.history[0].body).not.toHaveProperty('notifyFollowers')
    })

    it('resolves Unlisted publish status', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      await service.createPost(authorId, 'Test', 'HTML', '<p>body</p>', undefined, undefined, 'Unlisted')

      expect(mock.history[0].body).toMatchObject({ publishStatus: 'unlisted' })
    })

    it('resolves all license values correctly', async () => {
      const licenseMap = {
        'All Rights Reserved': 'all-rights-reserved',
        'CC 4.0 BY-SA': 'cc-40-by-sa',
        'CC 4.0 BY-ND': 'cc-40-by-nd',
        'CC 4.0 BY-NC': 'cc-40-by-nc',
        'CC 4.0 BY-NC-ND': 'cc-40-by-nc-nd',
        'CC 4.0 BY-NC-SA': 'cc-40-by-nc-sa',
        'CC 4.0 Zero': 'cc-40-zero',
        'Public Domain': 'public-domain',
      }

      for (const [label, apiValue] of Object.entries(licenseMap)) {
        mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

        await service.createPost(authorId, 'Test', 'HTML', '<p>x</p>', undefined, undefined, undefined, label)

        expect(mock.history[mock.history.length - 1].body.license).toBe(apiValue)
      }
    })

    it('sets notifyFollowers to false when explicitly false', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).reply(postResponse)

      await service.createPost(authorId, 'Test', 'HTML', '<p>body</p>', undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ notifyFollowers: false })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/users/${authorId}/posts`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { errors: [{ message: 'User does not have publishing access.' }] },
      })

      await expect(
        service.createPost(authorId, 'Test', 'HTML', '<p>body</p>')
      ).rejects.toThrow('Medium API error')
    })
  })

  describe('createPostUnderPublication', () => {
    const pubId = 'pub-456'
    const postResponse = {
      data: {
        id: 'post-789',
        title: 'Pub Post',
        publicationId: 'pub-456',
        publishStatus: 'public',
      },
    }

    it('sends POST to publication endpoint with correct body', async () => {
      mock.onPost(`${BASE}/publications/${pubId}/posts`).reply(postResponse)

      const result = await service.createPostUnderPublication(pubId, 'Pub Post', 'HTML', '<p>Content</p>')

      expect(result).toEqual(postResponse.data)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/publications/${pubId}/posts`)
      expect(mock.history[0].body).toEqual({
        title: 'Pub Post',
        contentFormat: 'html',
        content: '<p>Content</p>',
      })
    })

    it('sends POST with all optional params', async () => {
      mock.onPost(`${BASE}/publications/${pubId}/posts`).reply(postResponse)

      await service.createPostUnderPublication(
        pubId, 'Pub Post', 'Markdown', '# Content',
        ['tag1'], 'https://example.com', 'Draft', 'CC 4.0 BY-NC', true,
      )

      expect(mock.history[0].body).toEqual({
        title: 'Pub Post',
        contentFormat: 'markdown',
        content: '# Content',
        tags: ['tag1'],
        canonicalUrl: 'https://example.com',
        publishStatus: 'draft',
        license: 'cc-40-by-nc',
        notifyFollowers: true,
      })
    })
  })

  // ── Publications ──

  describe('listUserPublications', () => {
    const userId = 'user-123'

    it('sends GET with correct URL and returns unwrapped data', async () => {
      const publications = [
        { id: 'pub-1', name: 'Test Pub', description: 'A test publication' },
      ]

      mock.onGet(`${BASE}/users/${userId}/publications`).reply({ data: publications })

      const result = await service.listUserPublications(userId)

      expect(result).toEqual(publications)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/users/${userId}/publications`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${TOKEN}`,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.listUserPublications(userId)).rejects.toThrow('Medium API error')
    })
  })

  describe('listPublicationContributors', () => {
    const pubId = 'pub-456'

    it('sends GET to contributors endpoint', async () => {
      const contributors = [
        { publicationId: 'pub-456', userId: 'user-1', role: 'editor' },
        { publicationId: 'pub-456', userId: 'user-2', role: 'writer' },
      ]

      mock.onGet(`${BASE}/publications/${pubId}/contributors`).reply({ data: contributors })

      const result = await service.listPublicationContributors(pubId)

      expect(result).toEqual(contributors)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/publications/${pubId}/contributors`)
    })
  })

  // ── Images ──

  describe('uploadImage', () => {
    const imageUrl = 'https://example.com/photos/test-image.png'
    const imageBytes = Buffer.from('fake-image-data')

    it('fetches image and uploads via FormData', async () => {
      mock.onGet(imageUrl).reply(imageBytes)
      mock.onPost(`${BASE}/images`).reply({ data: { url: 'https://cdn-images-1.medium.com/uploaded.png', md5: 'abc123' } })

      const result = await service.uploadImage(imageUrl)

      expect(result).toEqual({ url: 'https://cdn-images-1.medium.com/uploaded.png', md5: 'abc123' })
      expect(mock.history).toHaveLength(2)

      // First call: fetch image
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(imageUrl)
      expect(mock.history[0].encoding).toBeNull()

      // Second call: upload to Medium
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${BASE}/images`)
      expect(mock.history[1].formData).toBeDefined()
      expect(mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/json',
      })
    })

    it('uses provided filename', async () => {
      mock.onGet(imageUrl).reply(imageBytes)
      mock.onPost(`${BASE}/images`).reply({ data: { url: 'https://cdn.medium.com/custom.png', md5: 'def456' } })

      await service.uploadImage(imageUrl, 'custom-name.png')

      expect(mock.history[1].formData).toBeDefined()
    })

    it('derives filename from URL when not provided', async () => {
      const urlWithParams = 'https://example.com/path/my-photo.jpg?token=abc'

      mock.onGet(urlWithParams).reply(imageBytes)
      mock.onPost(`${BASE}/images`).reply({ data: { url: 'https://cdn.medium.com/up.jpg', md5: 'ghi789' } })

      await service.uploadImage(urlWithParams)

      expect(mock.history).toHaveLength(2)
    })

    it('throws when image fetch fails', async () => {
      mock.onGet(imageUrl).replyWithError({ message: 'Not Found' })

      await expect(service.uploadImage(imageUrl)).rejects.toThrow('could not fetch image from URL')
    })

    it('throws when upload fails', async () => {
      mock.onGet(imageUrl).reply(imageBytes)
      mock.onPost(`${BASE}/images`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { errors: [{ message: 'Unsupported image type' }] },
      })

      await expect(service.uploadImage(imageUrl)).rejects.toThrow('Medium API error')
    })
  })

  // ── Dictionary ──

  describe('getPublicationsDictionary', () => {
    const userId = 'user-123'
    const publications = [
      { id: 'pub-1', name: 'About Medium', description: 'What is this thing?' },
      { id: 'pub-2', name: 'Tech Blog', description: 'Technology articles' },
      { id: 'pub-3', name: 'Creative Writing' },
    ]

    it('returns empty items when no userId in criteria', async () => {
      const result = await service.getPublicationsDictionary({ search: '', criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getPublicationsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns all publications mapped to dictionary format', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).reply({ data: publications })

      const result = await service.getPublicationsDictionary({ criteria: { userId } })

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'About Medium', value: 'pub-1', note: 'What is this thing?' })
      expect(result.items[1]).toEqual({ label: 'Tech Blog', value: 'pub-2', note: 'Technology articles' })
      expect(result.items[2]).toEqual({ label: 'Creative Writing', value: 'pub-3', note: undefined })
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).reply({ data: publications })

      const result = await service.getPublicationsDictionary({ search: 'tech', criteria: { userId } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Tech Blog')
    })

    it('filters by search in description', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).reply({ data: publications })

      const result = await service.getPublicationsDictionary({ search: 'thing', criteria: { userId } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('About Medium')
    })

    it('returns empty items when search matches nothing', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).reply({ data: publications })

      const result = await service.getPublicationsDictionary({ search: 'nonexistent', criteria: { userId } })

      expect(result.items).toHaveLength(0)
      expect(result.cursor).toBeNull()
    })

    it('uses id as label when name is missing', async () => {
      mock.onGet(`${BASE}/users/${userId}/publications`).reply({
        data: [{ id: 'pub-no-name' }],
      })

      const result = await service.getPublicationsDictionary({ criteria: { userId } })

      expect(result.items[0].label).toBe('pub-no-name')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats error with multiple error messages', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: {
          errors: [
            { message: 'Invalid token' },
            { message: 'Token expired' },
          ],
        },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Invalid token; Token expired')
    })

    it('uses body.message when errors array is missing', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Internal server error' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Internal server error')
    })

    it('includes status code in error message', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { errors: [{ message: 'Token was invalid.' }] },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Medium API error (401)')
    })

    it('falls back to error.message when body is empty', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Network Error')
    })
  })
})
