'use strict'

const { createSandbox } = require('../../../service-sandbox')

// A syntactically valid admin key: 'id:secret' where secret is hex, so the
// service can HMAC-sign a real JWT (Buffer.from(secret, 'hex')) without mocking crypto.
const ADMIN_KEY = '6612abcdef0123456789abcd:' + 'a'.repeat(64)
const CONTENT_KEY = 'c0ffee1234567890abcdef00'
const SITE_URL = 'https://blog.example.com'
const ADMIN = `${ SITE_URL }/ghost/api/admin`
const CONTENT = `${ SITE_URL }/ghost/api/content`

describe('Ghost Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      // Trailing slash included on purpose to exercise the normalizer.
      apiUrl: `${ SITE_URL }/`,
      adminApiKey: ADMIN_KEY,
      contentApiKey: CONTENT_KEY,
    })
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

  // A Ghost-shaped error the service's #toError knows how to unwrap.
  const ghostError = (message, context) => ({
    message,
    body: { errors: [{ message, context }] },
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiUrl',
          displayName: 'Site URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'adminApiKey',
          displayName: 'Admin API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'contentApiKey',
          displayName: 'Content API Key',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('strips a trailing slash from the site URL when building base URLs', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts()

      // Would be a double slash if the trailing slash were not stripped.
      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/`)
    })

    it('signs admin requests with a "Ghost <jwt>" Authorization header', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts()

      const auth = mock.history[0].headers['Authorization']
      expect(auth).toMatch(/^Ghost /)
      // JWT is three base64url segments separated by dots.
      const jwt = auth.slice('Ghost '.length)
      expect(jwt.split('.')).toHaveLength(3)
    })

    it('sends the negotiated Accept-Version header on admin requests', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts()

      expect(mock.history[0].headers).toMatchObject({
        'Accept-Version': 'v5.0',
        'Content-Type': 'application/json',
      })
    })

    it('does not sign content requests with a JWT but passes the content key on the query', async () => {
      mock.onGet(`${ CONTENT }/posts/`).reply({ posts: [], meta: {} })

      await service.getPublishedPosts()

      expect(mock.history[0].headers['Authorization']).toBeUndefined()
      expect(mock.history[0].headers).toMatchObject({ 'Accept-Version': 'v5.0' })
      expect(mock.history[0].query).toMatchObject({ key: CONTENT_KEY })
    })
  })

  // ===========================================================================
  //  POSTS
  // ===========================================================================

  describe('createPost', () => {
    it('sends with required title only, defaulting status to draft', async () => {
      mock.onPost(`${ ADMIN }/posts/`).reply({ posts: [{ id: '1', title: 'Hello' }] })

      const result = await service.createPost('Hello')

      expect(result).toEqual({ posts: [{ id: '1', title: 'Hello' }] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/`)
      expect(mock.history[0].body).toEqual({ posts: [{ title: 'Hello', status: 'draft' }] })
      // No html => no source=html conversion query.
      expect(mock.history[0].query).toEqual({})
    })

    it('adds source=html query and maps status/tags/authors when provided', async () => {
      mock.onPost(`${ ADMIN }/posts/`).reply({ posts: [{ id: '2' }] })

      await service.createPost(
        'Full Post',
        '<p>Body</p>',
        'Published',
        'news, updates',
        'jane@example.com, joe@example.com',
        'https://img.example.com/f.png',
        'A summary',
        undefined,
        '2030-01-01T00:00:00.000Z'
      )

      expect(mock.history[0].query).toEqual({ source: 'html' })
      expect(mock.history[0].body).toEqual({
        posts: [
          {
            title: 'Full Post',
            html: '<p>Body</p>',
            status: 'published',
            tags: [{ name: 'news' }, { name: 'updates' }],
            authors: [{ email: 'jane@example.com' }, { email: 'joe@example.com' }],
            feature_image: 'https://img.example.com/f.png',
            excerpt: 'A summary',
            published_at: '2030-01-01T00:00:00.000Z',
          },
        ],
      })
    })

    it('accepts tags/authors as arrays', async () => {
      mock.onPost(`${ ADMIN }/posts/`).reply({ posts: [{ id: '3' }] })

      await service.createPost('Arr', undefined, undefined, ['a', 'b'], ['x@y.com'])

      expect(mock.history[0].body.posts[0].tags).toEqual([{ name: 'a' }, { name: 'b' }])
      expect(mock.history[0].body.posts[0].authors).toEqual([{ email: 'x@y.com' }])
    })

    it('sends lexical body without the source=html query', async () => {
      mock.onPost(`${ ADMIN }/posts/`).reply({ posts: [{ id: '4' }] })

      await service.createPost('Lex', undefined, undefined, undefined, undefined, undefined, undefined, '{"root":{}}')

      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body.posts[0].lexical).toBe('{"root":{}}')
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPost(`${ ADMIN }/posts/`).replyWithError(ghostError('Validation error', 'Title is required'))

      await expect(service.createPost('X')).rejects.toThrow(
        'Ghost API error: Validation error — Title is required'
      )
    })
  })

  describe('getPost', () => {
    it('fetches by id without relations by default', async () => {
      mock.onGet(`${ ADMIN }/posts/abc/`).reply({ posts: [{ id: 'abc' }] })

      const result = await service.getPost('abc')

      expect(result).toEqual({ posts: [{ id: 'abc' }] })
      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/abc/`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes tags,authors when relations requested', async () => {
      mock.onGet(`${ ADMIN }/posts/abc/`).reply({ posts: [{ id: 'abc' }] })

      await service.getPost('abc', true)

      expect(mock.history[0].query).toEqual({ include: 'tags,authors' })
    })

    it('url-encodes the post id', async () => {
      mock.onGet(`${ ADMIN }/posts/a%2Fb/`).reply({ posts: [] })

      await service.getPost('a/b')

      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/a%2Fb/`)
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/posts/missing/`).replyWithError(ghostError('Resource not found'))

      await expect(service.getPost('missing')).rejects.toThrow('Ghost API error: Resource not found')
    })
  })

  describe('getPostBySlug', () => {
    it('fetches by slug and includes relations when requested', async () => {
      mock.onGet(`${ ADMIN }/posts/slug/hello-world/`).reply({ posts: [{ slug: 'hello-world' }] })

      await service.getPostBySlug('hello-world', true)

      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/slug/hello-world/`)
      expect(mock.history[0].query).toEqual({ include: 'tags,authors' })
    })

    it('omits the include query when relations are not requested', async () => {
      mock.onGet(`${ ADMIN }/posts/slug/hello-world/`).reply({ posts: [] })

      await service.getPostBySlug('hello-world')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/posts/slug/x/`).replyWithError(ghostError('Not found'))

      await expect(service.getPostBySlug('x')).rejects.toThrow('Ghost API error: Not found')
    })
  })

  describe('listPosts', () => {
    it('sends an empty query with no arguments', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the order label, and passes filter/limit/page/include', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts('status:published', 'Title A-Z', 25, 2, true)

      expect(mock.history[0].query).toEqual({
        filter: 'status:published',
        order: 'title asc',
        limit: 25,
        page: 2,
        include: 'tags,authors',
      })
    })

    it('passes an unknown order value through unchanged', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: {} })

      await service.listPosts(undefined, 'custom_field desc')

      expect(mock.history[0].query).toEqual({ order: 'custom_field desc' })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/posts/`).replyWithError(ghostError('Boom'))

      await expect(service.listPosts()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('updatePost', () => {
    it('auto-fetches updated_at then PUTs the changed fields', async () => {
      mock.onGet(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1', updated_at: '2026-01-01T00:00:00.000Z' }] })
      mock.onPut(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1', title: 'New' }] })

      const result = await service.updatePost('p1', 'New')

      expect(result).toEqual({ posts: [{ id: 'p1', title: 'New' }] })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].body).toEqual({
        posts: [{ updated_at: '2026-01-01T00:00:00.000Z', title: 'New' }],
      })
      // No html => no source=html conversion query.
      expect(mock.history[1].query).toEqual({})
    })

    it('uses a supplied updated_at without an extra GET and adds source=html for html', async () => {
      mock.onPut(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1' }] })

      await service.updatePost('p1', undefined, '<p>New</p>', 'Draft', 'a,b', 'img', 'ex', '2026-02-02T00:00:00.000Z')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toEqual({ source: 'html' })
      expect(mock.history[0].body).toEqual({
        posts: [
          {
            updated_at: '2026-02-02T00:00:00.000Z',
            html: '<p>New</p>',
            status: 'draft',
            tags: [{ name: 'a' }, { name: 'b' }],
            feature_image: 'img',
            excerpt: 'ex',
          },
        ],
      })
    })

    it('throws when updated_at cannot be resolved from the fetched post', async () => {
      mock.onGet(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1' }] })

      await expect(service.updatePost('p1', 'New')).rejects.toThrow(
        'Ghost API error: Could not determine the post\'s current updated_at for collision detection.'
      )
    })

    it('throws a wrapped Ghost error when the PUT fails', async () => {
      mock.onPut(`${ ADMIN }/posts/p1/`).replyWithError(ghostError('Saving failed', 'Conflict'))

      await expect(service.updatePost('p1', 'New', undefined, undefined, undefined, undefined, undefined, '2026-01-01T00:00:00.000Z'))
        .rejects.toThrow('Ghost API error: Saving failed — Conflict')
    })
  })

  describe('publishPost', () => {
    it('fetches updated_at then PUTs status=published', async () => {
      mock.onGet(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1', updated_at: '2026-03-03T00:00:00.000Z' }] })
      mock.onPut(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1', status: 'published' }] })

      const result = await service.publishPost('p1')

      expect(result).toEqual({ posts: [{ id: 'p1', status: 'published' }] })
      expect(mock.history[1].body).toEqual({
        posts: [{ status: 'published', updated_at: '2026-03-03T00:00:00.000Z' }],
      })
    })

    it('throws when the post is missing or has no updated_at', async () => {
      mock.onGet(`${ ADMIN }/posts/p1/`).reply({ posts: [{ id: 'p1' }] })

      await expect(service.publishPost('p1')).rejects.toThrow(
        'Ghost API error: Post not found or missing updated_at.'
      )
    })
  })

  describe('deletePost', () => {
    it('sends delete and returns a confirmation object', async () => {
      mock.onDelete(`${ ADMIN }/posts/p1/`).reply(undefined)

      const result = await service.deletePost('p1')

      expect(result).toEqual({ deleted: true, id: 'p1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ ADMIN }/posts/p1/`)
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onDelete(`${ ADMIN }/posts/p1/`).replyWithError(ghostError('Boom'))

      await expect(service.deletePost('p1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  PAGES
  // ===========================================================================

  describe('createPage', () => {
    it('sends with required title only, defaulting status to draft', async () => {
      mock.onPost(`${ ADMIN }/pages/`).reply({ pages: [{ id: 'pg1' }] })

      await service.createPage('About')

      expect(mock.history[0].url).toBe(`${ ADMIN }/pages/`)
      expect(mock.history[0].body).toEqual({ pages: [{ title: 'About', status: 'draft' }] })
      expect(mock.history[0].query).toEqual({})
    })

    it('adds source=html and maps all optional fields', async () => {
      mock.onPost(`${ ADMIN }/pages/`).reply({ pages: [{ id: 'pg2' }] })

      await service.createPage('About', '<p>Hi</p>', 'Published', 'https://img/x.png', 'Summary')

      expect(mock.history[0].query).toEqual({ source: 'html' })
      expect(mock.history[0].body).toEqual({
        pages: [
          {
            title: 'About',
            html: '<p>Hi</p>',
            status: 'published',
            feature_image: 'https://img/x.png',
            excerpt: 'Summary',
          },
        ],
      })
    })

    it('supports lexical content', async () => {
      mock.onPost(`${ ADMIN }/pages/`).reply({ pages: [{ id: 'pg3' }] })

      await service.createPage('Lex', undefined, undefined, undefined, undefined, '{"root":{}}')

      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body.pages[0].lexical).toBe('{"root":{}}')
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPost(`${ ADMIN }/pages/`).replyWithError(ghostError('Boom'))

      await expect(service.createPage('X')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('getPage', () => {
    it('fetches a page by id', async () => {
      mock.onGet(`${ ADMIN }/pages/pg1/`).reply({ pages: [{ id: 'pg1' }] })

      const result = await service.getPage('pg1')

      expect(result).toEqual({ pages: [{ id: 'pg1' }] })
      expect(mock.history[0].url).toBe(`${ ADMIN }/pages/pg1/`)
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/pages/pg1/`).replyWithError(ghostError('Boom'))

      await expect(service.getPage('pg1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('listPages', () => {
    it('sends an empty query with no arguments', async () => {
      mock.onGet(`${ ADMIN }/pages/`).reply({ pages: [], meta: {} })

      await service.listPages()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes filter/limit/page', async () => {
      mock.onGet(`${ ADMIN }/pages/`).reply({ pages: [], meta: {} })

      await service.listPages('status:published', 10, 3)

      expect(mock.history[0].query).toEqual({ filter: 'status:published', limit: 10, page: 3 })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/pages/`).replyWithError(ghostError('Boom'))

      await expect(service.listPages()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('updatePage', () => {
    it('auto-fetches updated_at then PUTs the changed fields', async () => {
      mock.onGet(`${ ADMIN }/pages/pg1/`).reply({ pages: [{ id: 'pg1', updated_at: '2026-01-01T00:00:00.000Z' }] })
      mock.onPut(`${ ADMIN }/pages/pg1/`).reply({ pages: [{ id: 'pg1', title: 'New' }] })

      await service.updatePage('pg1', 'New')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].body).toEqual({
        pages: [{ updated_at: '2026-01-01T00:00:00.000Z', title: 'New' }],
      })
    })

    it('uses a supplied updated_at and adds source=html for html', async () => {
      mock.onPut(`${ ADMIN }/pages/pg1/`).reply({ pages: [{ id: 'pg1' }] })

      await service.updatePage('pg1', undefined, '<p>Hi</p>', 'Draft', '2026-02-02T00:00:00.000Z')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toEqual({ source: 'html' })
      expect(mock.history[0].body).toEqual({
        pages: [{ updated_at: '2026-02-02T00:00:00.000Z', html: '<p>Hi</p>', status: 'draft' }],
      })
    })

    it('throws when updated_at cannot be resolved', async () => {
      mock.onGet(`${ ADMIN }/pages/pg1/`).reply({ pages: [{ id: 'pg1' }] })

      await expect(service.updatePage('pg1', 'New')).rejects.toThrow(
        'Ghost API error: Could not determine the page\'s current updated_at for collision detection.'
      )
    })

    it('throws a wrapped Ghost error when the PUT fails', async () => {
      mock.onPut(`${ ADMIN }/pages/pg1/`).replyWithError(ghostError('Boom'))

      await expect(service.updatePage('pg1', 'New', undefined, undefined, '2026-01-01T00:00:00.000Z'))
        .rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('deletePage', () => {
    it('sends delete and returns a confirmation object', async () => {
      mock.onDelete(`${ ADMIN }/pages/pg1/`).reply(undefined)

      const result = await service.deletePage('pg1')

      expect(result).toEqual({ deleted: true, id: 'pg1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onDelete(`${ ADMIN }/pages/pg1/`).replyWithError(ghostError('Boom'))

      await expect(service.deletePage('pg1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  CONTENT API
  // ===========================================================================

  describe('getPublishedPosts', () => {
    it('sends only the content key with no arguments', async () => {
      mock.onGet(`${ CONTENT }/posts/`).reply({ posts: [], meta: {} })

      await service.getPublishedPosts()

      expect(mock.history[0].url).toBe(`${ CONTENT }/posts/`)
      expect(mock.history[0].query).toEqual({ key: CONTENT_KEY })
    })

    it('passes filter/limit/page/include alongside the key', async () => {
      mock.onGet(`${ CONTENT }/posts/`).reply({ posts: [], meta: {} })

      await service.getPublishedPosts('featured:true', 20, 2, true)

      expect(mock.history[0].query).toEqual({
        key: CONTENT_KEY,
        filter: 'featured:true',
        limit: 20,
        page: 2,
        include: 'tags,authors',
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ CONTENT }/posts/`).replyWithError(ghostError('Unauthorized'))

      await expect(service.getPublishedPosts()).rejects.toThrow('Ghost API error: Unauthorized')
    })
  })

  describe('getPublishedPost', () => {
    it('fetches a published post by id with the key', async () => {
      mock.onGet(`${ CONTENT }/posts/abc/`).reply({ posts: [{ id: 'abc' }] })

      await service.getPublishedPost('abc', true)

      expect(mock.history[0].url).toBe(`${ CONTENT }/posts/abc/`)
      expect(mock.history[0].query).toEqual({ key: CONTENT_KEY, include: 'tags,authors' })
    })

    it('omits include when relations not requested', async () => {
      mock.onGet(`${ CONTENT }/posts/abc/`).reply({ posts: [] })

      await service.getPublishedPost('abc')

      expect(mock.history[0].query).toEqual({ key: CONTENT_KEY })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ CONTENT }/posts/abc/`).replyWithError(ghostError('Not found'))

      await expect(service.getPublishedPost('abc')).rejects.toThrow('Ghost API error: Not found')
    })
  })

  describe('getPublishedPostBySlug', () => {
    it('fetches a published post by slug with the key', async () => {
      mock.onGet(`${ CONTENT }/posts/slug/hello/`).reply({ posts: [{ slug: 'hello' }] })

      await service.getPublishedPostBySlug('hello')

      expect(mock.history[0].url).toBe(`${ CONTENT }/posts/slug/hello/`)
      expect(mock.history[0].query).toEqual({ key: CONTENT_KEY })
    })

    it('includes relations when requested', async () => {
      mock.onGet(`${ CONTENT }/posts/slug/hello/`).reply({ posts: [] })

      await service.getPublishedPostBySlug('hello', true)

      expect(mock.history[0].query).toEqual({ key: CONTENT_KEY, include: 'tags,authors' })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ CONTENT }/posts/slug/hello/`).replyWithError(ghostError('Boom'))

      await expect(service.getPublishedPostBySlug('hello')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('content API without a content key', () => {
    let noKeySandbox
    let noKeyService
    let primaryGlobal

    beforeAll(() => {
      // Stand up a separate sandbox with no content key. This swaps the global
      // Flowrunner, so capture the primary one first and restore it afterwards.
      primaryGlobal = global.Flowrunner
      noKeySandbox = createSandbox({ apiUrl: SITE_URL, adminApiKey: ADMIN_KEY })
      // The service module is cached from the first require, so its addService()
      // call won't re-run against the new sandbox. isolateModules gives a fresh
      // module registry so the require re-registers against the no-key sandbox.
      jest.isolateModules(() => {
        require('../src/index.js')
      })
      noKeyService = noKeySandbox.getService()
    })

    afterAll(() => {
      noKeySandbox.cleanup()
      // Restore the primary sandbox's global for the remaining suites.
      global.Flowrunner = primaryGlobal
    })

    it('throws when the content key is missing', async () => {
      await expect(noKeyService.getPublishedPosts()).rejects.toThrow(
        'Ghost API error: Content API Key is required to read published content.'
      )
    })
  })

  // ===========================================================================
  //  TAGS
  // ===========================================================================

  describe('listTags', () => {
    it('sends an empty query with no arguments', async () => {
      mock.onGet(`${ ADMIN }/tags/`).reply({ tags: [], meta: {} })

      await service.listTags()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes filter/limit/page', async () => {
      mock.onGet(`${ ADMIN }/tags/`).reply({ tags: [], meta: {} })

      await service.listTags('visibility:public', 5, 2)

      expect(mock.history[0].query).toEqual({ filter: 'visibility:public', limit: 5, page: 2 })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/tags/`).replyWithError(ghostError('Boom'))

      await expect(service.listTags()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('createTag', () => {
    it('sends with name only', async () => {
      mock.onPost(`${ ADMIN }/tags/`).reply({ tags: [{ id: 't1', name: 'News' }] })

      const result = await service.createTag('News')

      expect(result).toEqual({ tags: [{ id: 't1', name: 'News' }] })
      expect(mock.history[0].body).toEqual({ tags: [{ name: 'News' }] })
    })

    it('includes slug and description', async () => {
      mock.onPost(`${ ADMIN }/tags/`).reply({ tags: [{ id: 't2' }] })

      await service.createTag('News', 'news', 'Company news')

      expect(mock.history[0].body).toEqual({
        tags: [{ name: 'News', slug: 'news', description: 'Company news' }],
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPost(`${ ADMIN }/tags/`).replyWithError(ghostError('Boom'))

      await expect(service.createTag('News')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('getTag', () => {
    it('fetches a tag by id', async () => {
      mock.onGet(`${ ADMIN }/tags/t1/`).reply({ tags: [{ id: 't1' }] })

      const result = await service.getTag('t1')

      expect(result).toEqual({ tags: [{ id: 't1' }] })
      expect(mock.history[0].url).toBe(`${ ADMIN }/tags/t1/`)
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/tags/t1/`).replyWithError(ghostError('Boom'))

      await expect(service.getTag('t1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('updateTag', () => {
    it('sends put with only provided fields', async () => {
      mock.onPut(`${ ADMIN }/tags/t1/`).reply({ tags: [{ id: 't1' }] })

      await service.updateTag('t1', 'Breaking News')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ tags: [{ name: 'Breaking News' }] })
    })

    it('includes all fields when provided', async () => {
      mock.onPut(`${ ADMIN }/tags/t1/`).reply({ tags: [{ id: 't1' }] })

      await service.updateTag('t1', 'Breaking', 'breaking', 'Desc')

      expect(mock.history[0].body).toEqual({
        tags: [{ name: 'Breaking', slug: 'breaking', description: 'Desc' }],
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPut(`${ ADMIN }/tags/t1/`).replyWithError(ghostError('Boom'))

      await expect(service.updateTag('t1', 'X')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('deleteTag', () => {
    it('sends delete and returns a confirmation object', async () => {
      mock.onDelete(`${ ADMIN }/tags/t1/`).reply(undefined)

      const result = await service.deleteTag('t1')

      expect(result).toEqual({ deleted: true, id: 't1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onDelete(`${ ADMIN }/tags/t1/`).replyWithError(ghostError('Boom'))

      await expect(service.deleteTag('t1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  MEMBERS
  // ===========================================================================

  describe('listMembers', () => {
    it('sends an empty query with no arguments', async () => {
      mock.onGet(`${ ADMIN }/members/`).reply({ members: [], meta: {} })

      await service.listMembers()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes filter/limit/page', async () => {
      mock.onGet(`${ ADMIN }/members/`).reply({ members: [], meta: {} })

      await service.listMembers('status:paid', 10, 1)

      expect(mock.history[0].query).toEqual({ filter: 'status:paid', limit: 10, page: 1 })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/members/`).replyWithError(ghostError('Boom'))

      await expect(service.listMembers()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('createMember', () => {
    it('sends with email only', async () => {
      mock.onPost(`${ ADMIN }/members/`).reply({ members: [{ id: 'm1' }] })

      await service.createMember('jane@example.com')

      expect(mock.history[0].body).toEqual({ members: [{ email: 'jane@example.com' }] })
    })

    it('maps labels to references and includes name/note', async () => {
      mock.onPost(`${ ADMIN }/members/`).reply({ members: [{ id: 'm2' }] })

      await service.createMember('jane@example.com', 'Jane Doe', 'vip, gold', 'A note')

      expect(mock.history[0].body).toEqual({
        members: [
          {
            email: 'jane@example.com',
            name: 'Jane Doe',
            note: 'A note',
            labels: [{ name: 'vip' }, { name: 'gold' }],
          },
        ],
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPost(`${ ADMIN }/members/`).replyWithError(ghostError('Boom'))

      await expect(service.createMember('x@y.com')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('getMember', () => {
    it('fetches a member by id', async () => {
      mock.onGet(`${ ADMIN }/members/m1/`).reply({ members: [{ id: 'm1' }] })

      const result = await service.getMember('m1')

      expect(result).toEqual({ members: [{ id: 'm1' }] })
      expect(mock.history[0].url).toBe(`${ ADMIN }/members/m1/`)
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/members/m1/`).replyWithError(ghostError('Boom'))

      await expect(service.getMember('m1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('updateMember', () => {
    it('sends put with only provided fields', async () => {
      mock.onPut(`${ ADMIN }/members/m1/`).reply({ members: [{ id: 'm1' }] })

      await service.updateMember('m1', undefined, 'Jane Smith')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ members: [{ name: 'Jane Smith' }] })
    })

    it('includes email/labels/note when provided', async () => {
      mock.onPut(`${ ADMIN }/members/m1/`).reply({ members: [{ id: 'm1' }] })

      await service.updateMember('m1', 'new@example.com', 'Jane', 'vip', 'note')

      expect(mock.history[0].body).toEqual({
        members: [
          { email: 'new@example.com', name: 'Jane', note: 'note', labels: [{ name: 'vip' }] },
        ],
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onPut(`${ ADMIN }/members/m1/`).replyWithError(ghostError('Boom'))

      await expect(service.updateMember('m1', 'x@y.com')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('deleteMember', () => {
    it('sends delete and returns a confirmation object', async () => {
      mock.onDelete(`${ ADMIN }/members/m1/`).reply(undefined)

      const result = await service.deleteMember('m1')

      expect(result).toEqual({ deleted: true, id: 'm1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onDelete(`${ ADMIN }/members/m1/`).replyWithError(ghostError('Boom'))

      await expect(service.deleteMember('m1')).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  TIERS & NEWSLETTERS
  // ===========================================================================

  describe('listTiers', () => {
    it('always includes pricing/benefits in the query', async () => {
      mock.onGet(`${ ADMIN }/tiers/`).reply({ tiers: [], meta: {} })

      await service.listTiers()

      expect(mock.history[0].url).toBe(`${ ADMIN }/tiers/`)
      expect(mock.history[0].query).toEqual({ include: 'monthly_price,yearly_price,benefits' })
    })

    it('passes limit/page alongside the include', async () => {
      mock.onGet(`${ ADMIN }/tiers/`).reply({ tiers: [], meta: {} })

      await service.listTiers(10, 2)

      expect(mock.history[0].query).toEqual({
        limit: 10,
        page: 2,
        include: 'monthly_price,yearly_price,benefits',
      })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/tiers/`).replyWithError(ghostError('Boom'))

      await expect(service.listTiers()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('listNewsletters', () => {
    it('sends an empty query with no arguments', async () => {
      mock.onGet(`${ ADMIN }/newsletters/`).reply({ newsletters: [], meta: {} })

      await service.listNewsletters()

      expect(mock.history[0].url).toBe(`${ ADMIN }/newsletters/`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes limit/page', async () => {
      mock.onGet(`${ ADMIN }/newsletters/`).reply({ newsletters: [], meta: {} })

      await service.listNewsletters(5, 3)

      expect(mock.history[0].query).toEqual({ limit: 5, page: 3 })
    })

    it('throws a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/newsletters/`).replyWithError(ghostError('Boom'))

      await expect(service.listNewsletters()).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  IMAGES
  // ===========================================================================

  describe('uploadImage', () => {
    it('downloads the source image then multipart-uploads it', async () => {
      mock.onGet('https://src.example.com/pic.png').reply(Buffer.from('PNGDATA'))
      mock.onPost(`${ ADMIN }/images/upload/`).reply({
        images: [{ url: `${ SITE_URL }/content/images/2026/07/pic.png`, ref: null }],
      })

      const result = await service.uploadImage('https://src.example.com/pic.png', 'pic.png')

      expect(result).toEqual({
        images: [{ url: `${ SITE_URL }/content/images/2026/07/pic.png`, ref: null }],
      })

      // First call: binary download with null encoding.
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://src.example.com/pic.png')
      expect(mock.history[0].encoding).toBeNull()

      // Second call: signed multipart POST to the upload endpoint.
      const upload = mock.history[1]
      expect(upload.method).toBe('post')
      expect(upload.url).toBe(`${ ADMIN }/images/upload/`)
      expect(upload.headers['Authorization']).toMatch(/^Ghost /)
      expect(upload.headers).toMatchObject({ 'Accept-Version': 'v5.0' })
      expect(upload.formData).toBeDefined()

      const fields = upload.formData._fields
      const fileField = fields.find(f => f.name === 'file')
      const purposeField = fields.find(f => f.name === 'purpose')
      expect(Buffer.isBuffer(fileField.value)).toBe(true)
      expect(fileField.filename).toMatchObject({ filename: 'pic.png', contentType: 'image/png' })
      expect(purposeField.value).toBe('image')
    })

    it('generates a default file name and octet-stream content type when name omitted', async () => {
      mock.onGet('https://src.example.com/blob').reply(Buffer.from('DATA'))
      mock.onPost(`${ ADMIN }/images/upload/`).reply({ images: [{ url: 'x' }] })

      await service.uploadImage('https://src.example.com/blob')

      const fields = mock.history[1].formData._fields
      const fileField = fields.find(f => f.name === 'file')
      expect(fileField.filename.filename).toMatch(/^image_\d+$/)
      expect(fileField.filename.contentType).toBe('application/octet-stream')
    })

    it('infers content type from a jpg extension', async () => {
      mock.onGet('https://src.example.com/a.jpg').reply(Buffer.from('J'))
      mock.onPost(`${ ADMIN }/images/upload/`).reply({ images: [] })

      await service.uploadImage('https://src.example.com/a.jpg', 'a.jpg')

      const fileField = mock.history[1].formData._fields.find(f => f.name === 'file')
      expect(fileField.filename.contentType).toBe('image/jpeg')
    })

    it('throws a wrapped Ghost error when the upload fails', async () => {
      mock.onGet('https://src.example.com/pic.png').reply(Buffer.from('P'))
      mock.onPost(`${ ADMIN }/images/upload/`).replyWithError(ghostError('Upload failed'))

      await expect(service.uploadImage('https://src.example.com/pic.png', 'pic.png')).rejects.toThrow(
        'Ghost API error: Upload failed'
      )
    })
  })

  // ===========================================================================
  //  DICTIONARIES
  // ===========================================================================

  describe('getPostsDictionary', () => {
    it('maps posts to items and requests page 1 by default', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({
        posts: [
          { id: 'p1', title: 'Hello World', status: 'published' },
          { id: 'p2', slug: 'draft-slug', status: 'draft' },
        ],
        meta: { pagination: { next: 2 } },
      })

      const result = await service.getPostsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1, order: 'updated_at desc' })
      expect(result.items).toEqual([
        { label: 'Hello World', value: 'p1', note: 'published' },
        { label: 'draft-slug', value: 'p2', note: 'draft' },
      ])
      expect(result.cursor).toBe('2')
    })

    it('uses the cursor as the page and builds a title filter from search', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [], meta: { pagination: {} } })

      const result = await service.getPostsDictionary({ search: "Jane's post", cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3, filter: "title:~'Janes post'" })
      // No next page => cursor undefined.
      expect(result.cursor).toBeUndefined()
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ ADMIN }/posts/`).reply({ posts: [] })

      const result = await service.getPostsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('propagates a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/posts/`).replyWithError(ghostError('Boom'))

      await expect(service.getPostsDictionary({})).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('getTagsDictionary', () => {
    it('maps tags to items with slug notes', async () => {
      mock.onGet(`${ ADMIN }/tags/`).reply({
        tags: [
          { id: 't1', name: 'News', slug: 'news' },
          { id: 't2', slug: 'events' },
        ],
        meta: { pagination: { next: 2 } },
      })

      const result = await service.getTagsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
      expect(result.items).toEqual([
        { label: 'News', value: 't1', note: 'news' },
        { label: 'events', value: 't2', note: 'events' },
      ])
      expect(result.cursor).toBe('2')
    })

    it('builds a name filter from search and uses the cursor as page', async () => {
      mock.onGet(`${ ADMIN }/tags/`).reply({ tags: [], meta: { pagination: {} } })

      await service.getTagsDictionary({ search: 'ne', cursor: '4' })

      expect(mock.history[0].query).toMatchObject({ page: 4, filter: "name:~'ne'" })
    })

    it('propagates a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/tags/`).replyWithError(ghostError('Boom'))

      await expect(service.getTagsDictionary({})).rejects.toThrow('Ghost API error: Boom')
    })
  })

  describe('getAuthorsDictionary', () => {
    it('maps users with an email to items and filters out those without', async () => {
      mock.onGet(`${ ADMIN }/users/`).reply({
        users: [
          { id: 'u1', name: 'Jane Doe', email: 'jane@example.com', roles: [{ name: 'Editor' }] },
          { id: 'u2', email: 'noname@example.com', slug: 'noname' },
          { id: 'u3', name: 'No Email' },
        ],
        meta: { pagination: { next: 2 } },
      })

      const result = await service.getAuthorsDictionary({})

      expect(mock.history[0].url).toBe(`${ ADMIN }/users/`)
      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1, include: 'roles' })
      expect(result.items).toEqual([
        { label: 'Jane Doe', value: 'jane@example.com', note: 'Editor' },
        { label: 'noname@example.com', value: 'noname@example.com', note: 'noname' },
      ])
      expect(result.cursor).toBe('2')
    })

    it('builds a name filter from search and uses the cursor as page', async () => {
      mock.onGet(`${ ADMIN }/users/`).reply({ users: [], meta: { pagination: {} } })

      await service.getAuthorsDictionary({ search: 'jane', cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2, filter: "name:~'jane'" })
    })

    it('propagates a wrapped Ghost error on API failure', async () => {
      mock.onGet(`${ ADMIN }/users/`).replyWithError(ghostError('Boom'))

      await expect(service.getAuthorsDictionary({})).rejects.toThrow('Ghost API error: Boom')
    })
  })

  // ===========================================================================
  //  ERROR NORMALIZATION EDGE CASES
  // ===========================================================================

  describe('error normalization', () => {
    it('falls back to error.body.message when there is no errors[] envelope', async () => {
      mock.onGet(`${ ADMIN }/tags/t1/`).replyWithError({
        message: 'ignored top-level',
        body: { message: 'Body level message' },
      })

      await expect(service.getTag('t1')).rejects.toThrow('Ghost API error: Body level message')
    })

    it('falls back to the top-level message when no body is present', async () => {
      mock.onGet(`${ ADMIN }/tags/t1/`).replyWithError({ message: 'Network down' })

      await expect(service.getTag('t1')).rejects.toThrow('Ghost API error: Network down')
    })
  })
})
