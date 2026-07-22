'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://blog.example.com'
const USERNAME = 'admin'
const APP_PASSWORD = 'abcd efgh ijkl mnop'
const BASE = `${ SITE_URL }/wp-json/wp/v2`
const BASIC = `Basic ${ Buffer.from(`${ USERNAME }:abcdefghijklmnop`).toString('base64') }`

describe('WordPress Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      siteUrl: `${ SITE_URL }//`,
      username: USERNAME,
      appPassword: APP_PASSWORD,
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

  const lastCall = () => mock.history[mock.history.length - 1]

  // ── Registration & configuration ──

  describe('service registration', () => {
    it('registers the site URL and credential config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'siteUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'appPassword', required: true, shared: false }),
        ])
      )
    })

    it('normalizes the site URL and builds the REST base', () => {
      expect(service.siteUrl).toBe(SITE_URL)
      expect(service.baseUrl).toBe(BASE)
    })

    it('strips whitespace from the application password when building Basic auth', () => {
      expect(service.auth).toBe(Buffer.from(`${ USERNAME }:abcdefghijklmnop`).toString('base64'))
    })

    it.each([
      ['siteUrl', { username: USERNAME, appPassword: APP_PASSWORD }, 'Site URL must be configured'],
      ['username', { siteUrl: SITE_URL, appPassword: APP_PASSWORD }, 'Username must be configured'],
      ['appPassword', { siteUrl: SITE_URL, username: USERNAME }, 'Application Password must be configured'],
    ])('throws when %s is missing', (_name, config, message) => {
      jest.resetModules()

      const badSandbox = createSandbox(config)

      expect(() => require('../src/index.js')).toThrow(message)

      badSandbox.cleanup()

      jest.resetModules()
      sandbox = createSandbox({ siteUrl: `${ SITE_URL }//`, username: USERNAME, appPassword: APP_PASSWORD })
      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  describe('authentication', () => {
    it('sends Basic auth and JSON headers on writes', async () => {
      mock.onPost(`${ BASE }/posts`).reply({ id: 1 })

      await service.createPost('Hello')

      expect(lastCall().headers).toMatchObject({
        'Authorization': BASIC,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })

    it('omits the JSON content type when there is no body', async () => {
      mock.onGet(`${ BASE }/posts`).reply([])

      await service.listPosts()

      expect(lastCall().headers['Content-Type']).toBeUndefined()
    })
  })

  // ── Posts ──

  describe('listPosts', () => {
    it('sends no query params by default', async () => {
      mock.onGet(`${ BASE }/posts`).reply([])

      const result = await service.listPosts()

      expect(result).toEqual([])
      expect(lastCall().query).toEqual({})
    })

    it('maps status, order-by, and order labels', async () => {
      mock.onGet(`${ BASE }/posts`).reply([{ id: 1 }])

      await service.listPosts('Pending Review', 'news', 2, 5, 'Last Modified', 'Ascending', 3, 9, 12, '2024-01-01T00:00:00', '2024-12-31T00:00:00')

      expect(lastCall().query).toEqual({
        status: 'pending',
        search: 'news',
        page: 2,
        per_page: 5,
        orderby: 'modified',
        order: 'asc',
        author: 3,
        categories: 9,
        tags: 12,
        after: '2024-01-01T00:00:00',
        before: '2024-12-31T00:00:00',
      })
    })

    it('passes unmapped choice values through', async () => {
      mock.onGet(`${ BASE }/posts`).reply([])

      await service.listPosts('publish', undefined, undefined, undefined, 'date', 'desc')

      expect(lastCall().query).toEqual({ status: 'publish', orderby: 'date', order: 'desc' })
    })
  })

  describe('getPost', () => {
    it('requests a post by id', async () => {
      mock.onGet(`${ BASE }/posts/42`).reply({ id: 42 })

      const result = await service.getPost(42)

      expect(result).toEqual({ id: 42 })
      expect(lastCall().query).toEqual({})
    })

    it('passes a post password', async () => {
      mock.onGet(`${ BASE }/posts/42`).reply({ id: 42 })

      await service.getPost(42, 'secret')

      expect(lastCall().query).toEqual({ password: 'secret' })
    })

    it('throws when the post id is missing', async () => {
      await expect(service.getPost()).rejects.toThrow('Post ID is required.')
    })
  })

  describe('createPost', () => {
    it('sends only the provided fields', async () => {
      mock.onPost(`${ BASE }/posts`).reply({ id: 42 })

      await service.createPost('Hello World')

      expect(lastCall().method).toBe('post')
      expect(lastCall().body).toEqual({ title: 'Hello World' })
    })

    it('maps status and comment status labels', async () => {
      mock.onPost(`${ BASE }/posts`).reply({ id: 43 })

      await service.createPost(
        'Hello',
        '<p>Body</p>',
        'Draft',
        'hello',
        'Excerpt',
        3,
        7,
        [9],
        [12],
        'Closed',
        '2024-05-01T10:00:00',
        true
      )

      expect(lastCall().body).toEqual({
        title: 'Hello',
        content: '<p>Body</p>',
        status: 'draft',
        slug: 'hello',
        excerpt: 'Excerpt',
        author: 3,
        featured_media: 7,
        categories: [9],
        tags: [12],
        comment_status: 'closed',
        date: '2024-05-01T10:00:00',
        sticky: true,
      })
    })

    it('throws when the title is missing', async () => {
      await expect(service.createPost()).rejects.toThrow('Title is required.')
    })
  })

  describe('updatePost', () => {
    it('posts the changed fields to the post endpoint', async () => {
      mock.onPost(`${ BASE }/posts/42`).reply({ id: 42 })

      await service.updatePost(42, undefined, 'New body', 'Published', undefined, '', undefined, undefined, undefined, undefined, 'Open')

      expect(lastCall().url).toBe(`${ BASE }/posts/42`)
      expect(lastCall().body).toEqual({ content: 'New body', status: 'publish', comment_status: 'open' })
    })

    it('throws when the post id is missing', async () => {
      await expect(service.updatePost()).rejects.toThrow('Post ID is required.')
    })
  })

  describe('deletePost', () => {
    it('trashes by default', async () => {
      mock.onDelete(`${ BASE }/posts/42`).reply({ deleted: true })

      await service.deletePost(42)

      expect(lastCall().query).toEqual({})
    })

    it('permanently deletes when forced', async () => {
      mock.onDelete(`${ BASE }/posts/42`).reply({ deleted: true })

      await service.deletePost(42, true)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the post id is missing', async () => {
      await expect(service.deletePost()).rejects.toThrow('Post ID is required.')
    })
  })

  // ── Pages ──

  describe('pages', () => {
    it('lists pages with mapped choices', async () => {
      mock.onGet(`${ BASE }/pages`).reply([])

      await service.listPages('Private', 'about', 5, 1, 10, 'Menu Order', 'Descending')

      expect(lastCall().query).toEqual({
        status: 'private',
        search: 'about',
        parent: 5,
        page: 1,
        per_page: 10,
        orderby: 'menu_order',
        order: 'desc',
      })
    })

    it('gets a page with its password', async () => {
      mock.onGet(`${ BASE }/pages/5`).reply({ id: 5 })

      await service.getPage(5, 'secret')

      expect(lastCall().query).toEqual({ password: 'secret' })
    })

    it('throws when the page id is missing on get', async () => {
      await expect(service.getPage()).rejects.toThrow('Page ID is required.')
    })

    it('creates a page', async () => {
      mock.onPost(`${ BASE }/pages`).reply({ id: 5 })

      await service.createPage('About', '<p>Hi</p>', 'Published', 'about', 2, 3, 'full-width.php', 1, 7)

      expect(lastCall().body).toEqual({
        title: 'About',
        content: '<p>Hi</p>',
        status: 'publish',
        slug: 'about',
        parent: 2,
        menu_order: 3,
        template: 'full-width.php',
        author: 1,
        featured_media: 7,
      })
    })

    it('throws when the page title is missing', async () => {
      await expect(service.createPage()).rejects.toThrow('Title is required.')
    })

    it('updates a page', async () => {
      mock.onPost(`${ BASE }/pages/5`).reply({ id: 5 })

      await service.updatePage(5, 'About Us')

      expect(lastCall().body).toEqual({ title: 'About Us' })
    })

    it('throws when the page id is missing on update', async () => {
      await expect(service.updatePage()).rejects.toThrow('Page ID is required.')
    })

    it('deletes a page permanently', async () => {
      mock.onDelete(`${ BASE }/pages/5`).reply({ deleted: true })

      await service.deletePage(5, true)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the page id is missing on delete', async () => {
      await expect(service.deletePage()).rejects.toThrow('Page ID is required.')
    })
  })

  // ── Categories ──

  describe('categories', () => {
    it('lists categories with mapped ordering', async () => {
      mock.onGet(`${ BASE }/categories`).reply([])

      await service.listCategories('news', 0, true, 1, 50, 'Post Count', 'Descending')

      expect(lastCall().query).toEqual({
        search: 'news',
        parent: 0,
        hide_empty: true,
        page: 1,
        per_page: 50,
        orderby: 'count',
        order: 'desc',
      })
    })

    it('gets a category', async () => {
      mock.onGet(`${ BASE }/categories/9`).reply({ id: 9 })

      await service.getCategory(9)

      expect(lastCall().url).toBe(`${ BASE }/categories/9`)
    })

    it('throws when the category id is missing on get', async () => {
      await expect(service.getCategory()).rejects.toThrow('Category ID is required.')
    })

    it('creates a category', async () => {
      mock.onPost(`${ BASE }/categories`).reply({ id: 9 })

      await service.createCategory('News', 'news', 'All news', 2)

      expect(lastCall().body).toEqual({ name: 'News', slug: 'news', description: 'All news', parent: 2 })
    })

    it('throws when the category name is missing', async () => {
      await expect(service.createCategory()).rejects.toThrow('Name is required.')
    })

    it('updates a category', async () => {
      mock.onPost(`${ BASE }/categories/9`).reply({ id: 9 })

      await service.updateCategory(9, 'Newsroom')

      expect(lastCall().body).toEqual({ name: 'Newsroom' })
    })

    it('throws when the category id is missing on update', async () => {
      await expect(service.updateCategory()).rejects.toThrow('Category ID is required.')
    })

    it('force-deletes a category', async () => {
      mock.onDelete(`${ BASE }/categories/9`).reply({ deleted: true })

      await service.deleteCategory(9)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the category id is missing on delete', async () => {
      await expect(service.deleteCategory()).rejects.toThrow('Category ID is required.')
    })
  })

  // ── Tags ──

  describe('tags', () => {
    it('lists tags with mapped ordering', async () => {
      mock.onGet(`${ BASE }/tags`).reply([])

      await service.listTags('js', false, 1, 20, 'Name', 'Ascending')

      expect(lastCall().query).toEqual({
        search: 'js',
        hide_empty: false,
        page: 1,
        per_page: 20,
        orderby: 'name',
        order: 'asc',
      })
    })

    it('gets a tag', async () => {
      mock.onGet(`${ BASE }/tags/12`).reply({ id: 12 })

      await service.getTag(12)

      expect(lastCall().url).toBe(`${ BASE }/tags/12`)
    })

    it('throws when the tag id is missing on get', async () => {
      await expect(service.getTag()).rejects.toThrow('Tag ID is required.')
    })

    it('creates a tag', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ id: 12 })

      await service.createTag('JavaScript', 'javascript', 'JS posts')

      expect(lastCall().body).toEqual({ name: 'JavaScript', slug: 'javascript', description: 'JS posts' })
    })

    it('throws when the tag name is missing', async () => {
      await expect(service.createTag()).rejects.toThrow('Name is required.')
    })

    it('updates a tag', async () => {
      mock.onPost(`${ BASE }/tags/12`).reply({ id: 12 })

      await service.updateTag(12, 'JS')

      expect(lastCall().body).toEqual({ name: 'JS' })
    })

    it('throws when the tag id is missing on update', async () => {
      await expect(service.updateTag()).rejects.toThrow('Tag ID is required.')
    })

    it('force-deletes a tag', async () => {
      mock.onDelete(`${ BASE }/tags/12`).reply({ deleted: true })

      await service.deleteTag(12)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the tag id is missing on delete', async () => {
      await expect(service.deleteTag()).rejects.toThrow('Tag ID is required.')
    })
  })

  // ── Users ──

  describe('users', () => {
    it('lists users with the edit context and joined roles', async () => {
      mock.onGet(`${ BASE }/users`).reply([])

      await service.listUsers('ada', ['author', 'editor'], true, 1, 10, 'Registration Date', 'Descending')

      expect(lastCall().query).toEqual({
        search: 'ada',
        roles: 'author,editor',
        has_published_posts: true,
        page: 1,
        per_page: 10,
        orderby: 'registered_date',
        order: 'desc',
        context: 'edit',
      })
    })

    it('omits roles when the array is empty', async () => {
      mock.onGet(`${ BASE }/users`).reply([])

      await service.listUsers(undefined, [])

      expect(lastCall().query).toEqual({ context: 'edit' })
    })

    it('gets a user', async () => {
      mock.onGet(`${ BASE }/users/3`).reply({ id: 3 })

      await service.getUser(3)

      expect(lastCall().query).toEqual({ context: 'edit' })
    })

    it('throws when the user id is missing on get', async () => {
      await expect(service.getUser()).rejects.toThrow('User ID is required.')
    })

    it('gets the current user', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 1, name: 'admin' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 1, name: 'admin' })
      expect(lastCall().query).toEqual({ context: 'edit' })
    })

    it('creates a user', async () => {
      mock.onPost(`${ BASE }/users`).reply({ id: 4 })

      await service.createUser('ada', 'ada@example.com', 'secret', 'Ada L', 'Ada', 'Lovelace', ['author'], 'https://ada.dev', 'Bio')

      expect(lastCall().body).toEqual({
        username: 'ada',
        email: 'ada@example.com',
        password: 'secret',
        name: 'Ada L',
        first_name: 'Ada',
        last_name: 'Lovelace',
        roles: ['author'],
        url: 'https://ada.dev',
        description: 'Bio',
      })
    })

    it.each([
      [[], 'Username is required.'],
      [['ada'], 'Email is required.'],
      [['ada', 'ada@example.com'], 'Password is required.'],
    ])('validates required user fields (%#)', async (args, message) => {
      await expect(service.createUser(...args)).rejects.toThrow(message)
    })

    it('updates a user', async () => {
      mock.onPost(`${ BASE }/users/4`).reply({ id: 4 })

      await service.updateUser(4, undefined, undefined, 'Ada Lovelace')

      expect(lastCall().body).toEqual({ name: 'Ada Lovelace' })
    })

    it('throws when the user id is missing on update', async () => {
      await expect(service.updateUser()).rejects.toThrow('User ID is required.')
    })

    it('deletes a user with content reassignment', async () => {
      mock.onDelete(`${ BASE }/users/4`).reply({ deleted: true })

      await service.deleteUser(4, 1)

      expect(lastCall().query).toEqual({ force: true, reassign: 1 })
    })

    it('throws when the reassign target is missing', async () => {
      await expect(service.deleteUser(4)).rejects.toThrow('Reassign-To User ID is required')
    })

    it('throws when the user id is missing on delete', async () => {
      await expect(service.deleteUser()).rejects.toThrow('User ID is required.')
    })
  })

  // ── Media ──

  describe('media', () => {
    it('lists media with mapped media type', async () => {
      mock.onGet(`${ BASE }/media`).reply([])

      await service.listMedia('logo', 'Image', 'image/png', 42, 1, 10, 'Title', 'Ascending')

      expect(lastCall().query).toEqual({
        search: 'logo',
        media_type: 'image',
        mime_type: 'image/png',
        parent: 42,
        page: 1,
        per_page: 10,
        orderby: 'title',
        order: 'asc',
      })
    })

    it('gets a media item', async () => {
      mock.onGet(`${ BASE }/media/7`).reply({ id: 7 })

      await service.getMedia(7)

      expect(lastCall().url).toBe(`${ BASE }/media/7`)
    })

    it('throws when the media id is missing on get', async () => {
      await expect(service.getMedia()).rejects.toThrow('Media ID is required.')
    })

    it('updates a media item', async () => {
      mock.onPost(`${ BASE }/media/7`).reply({ id: 7 })

      await service.updateMedia(7, 'Logo', 'Company logo', 'Caption', 'Description', 42)

      expect(lastCall().body).toEqual({
        title: 'Logo',
        alt_text: 'Company logo',
        caption: 'Caption',
        description: 'Description',
        post: 42,
      })
    })

    it('throws when the media id is missing on update', async () => {
      await expect(service.updateMedia()).rejects.toThrow('Media ID is required.')
    })

    it('force-deletes a media item', async () => {
      mock.onDelete(`${ BASE }/media/7`).reply({ deleted: true })

      await service.deleteMedia(7)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the media id is missing on delete', async () => {
      await expect(service.deleteMedia()).rejects.toThrow('Media ID is required.')
    })
  })

  describe('uploadMediaFromUrl', () => {
    const SOURCE = 'https://cdn.example.com/assets/logo.png'

    it('downloads the source file and uploads it as multipart form data', async () => {
      mock.onGet(SOURCE).reply({
        body: Buffer.from('binary-data'),
        headers: { 'content-type': 'image/png' },
      })

      mock.onPost(`${ BASE }/media`).reply({ id: 7, source_url: 'https://blog.example.com/logo.png' })

      const result = await service.uploadMediaFromUrl(SOURCE, undefined, 'Logo', 'Alt', 'Caption', 42)

      expect(result).toEqual({ id: 7, source_url: 'https://blog.example.com/logo.png' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].unwrapBody).toBe(false)

      const upload = mock.history[1]

      expect(upload.method).toBe('post')

      expect(upload.headers).toMatchObject({
        'Content-Disposition': 'attachment; filename="logo.png"',
        'Content-Type': 'multipart/form-data',
      })

      expect(upload.formData._fields).toEqual([
        { name: 'file', value: expect.any(Buffer), filename: { filename: 'logo.png', contentType: 'image/png' } },
        { name: 'title', value: 'Logo', filename: undefined },
        { name: 'alt_text', value: 'Alt', filename: undefined },
        { name: 'caption', value: 'Caption', filename: undefined },
        { name: 'post', value: '42', filename: undefined },
      ])
    })

    it('honours an explicit filename and defaults the content type', async () => {
      mock.onGet(SOURCE).reply({ body: Buffer.from('x'), headers: {} })
      mock.onPost(`${ BASE }/media`).reply({ id: 8 })

      await service.uploadMediaFromUrl(SOURCE, 'custom.png')

      expect(mock.history[1].headers['Content-Disposition']).toBe('attachment; filename="custom.png"')

      expect(mock.history[1].formData._fields[0].filename).toEqual({
        filename: 'custom.png',
        contentType: 'application/octet-stream',
      })
    })

    it('falls back to upload.bin when the URL has no filename', async () => {
      const bare = 'https://cdn.example.com/assets/'

      mock.onGet(bare).reply({ body: Buffer.from('x'), headers: {} })
      mock.onPost(`${ BASE }/media`).reply({ id: 9 })

      await service.uploadMediaFromUrl(bare)

      expect(mock.history[1].headers['Content-Disposition']).toBe('attachment; filename="upload.bin"')
    })

    it('falls back to upload.bin when the URL is unparsable', async () => {
      mock.onGet('not-a-url').reply({ body: Buffer.from('x'), headers: {} })
      mock.onPost(`${ BASE }/media`).reply({ id: 10 })

      await service.uploadMediaFromUrl('not-a-url')

      expect(mock.history[1].headers['Content-Disposition']).toBe('attachment; filename="upload.bin"')
    })

    it('throws when the source URL is missing', async () => {
      await expect(service.uploadMediaFromUrl()).rejects.toThrow('Source URL is required.')
    })

    it('reports a download failure', async () => {
      mock.onGet(SOURCE).replyWithError({ message: 'ENOTFOUND' })

      await expect(service.uploadMediaFromUrl(SOURCE)).rejects.toThrow(
        'Failed to download source file from URL: ENOTFOUND'
      )
    })
  })

  // ── Comments ──

  describe('comments', () => {
    it('lists comments with mapped choices', async () => {
      mock.onGet(`${ BASE }/comments`).reply([])

      await service.listComments(42, 0, 'Pending', 'great', 1, 10, 'Date (GMT)', 'Descending')

      expect(lastCall().query).toEqual({
        post: 42,
        parent: 0,
        status: 'hold',
        search: 'great',
        page: 1,
        per_page: 10,
        orderby: 'date_gmt',
        order: 'desc',
      })
    })

    it('gets a comment', async () => {
      mock.onGet(`${ BASE }/comments/17`).reply({ id: 17 })

      await service.getComment(17)

      expect(lastCall().url).toBe(`${ BASE }/comments/17`)
    })

    it('throws when the comment id is missing on get', async () => {
      await expect(service.getComment()).rejects.toThrow('Comment ID is required.')
    })

    it('creates a comment', async () => {
      mock.onPost(`${ BASE }/comments`).reply({ id: 17 })

      await service.createComment(42, 'Nice post', 3, 'Ada', 'ada@example.com', 'https://ada.dev', 0, 'Approved')

      expect(lastCall().body).toEqual({
        post: 42,
        content: 'Nice post',
        author: 3,
        author_name: 'Ada',
        author_email: 'ada@example.com',
        author_url: 'https://ada.dev',
        parent: 0,
        status: 'approve',
      })
    })

    it('throws when the comment post id is missing', async () => {
      await expect(service.createComment()).rejects.toThrow('Post ID is required.')
    })

    it('throws when the comment content is missing', async () => {
      await expect(service.createComment(42)).rejects.toThrow('Content is required.')
    })

    it('updates a comment', async () => {
      mock.onPost(`${ BASE }/comments/17`).reply({ id: 17 })

      await service.updateComment(17, 'Edited', 'Spam')

      expect(lastCall().body).toEqual({ content: 'Edited', status: 'spam' })
    })

    it('throws when the comment id is missing on update', async () => {
      await expect(service.updateComment()).rejects.toThrow('Comment ID is required.')
    })

    it('deletes a comment permanently', async () => {
      mock.onDelete(`${ BASE }/comments/17`).reply({ deleted: true })

      await service.deleteComment(17, true)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('trashes a comment by default', async () => {
      mock.onDelete(`${ BASE }/comments/17`).reply({ deleted: true })

      await service.deleteComment(17)

      expect(lastCall().query).toEqual({})
    })

    it('throws when the comment id is missing on delete', async () => {
      await expect(service.deleteComment()).rejects.toThrow('Comment ID is required.')
    })
  })

  // ── Search, settings, taxonomies, types ──

  describe('searchSite', () => {
    it('maps the content type label', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchSite('flow', 'Post Format', 'post', 1, 10)

      expect(lastCall().query).toEqual({
        search: 'flow',
        type: 'post-format',
        subtype: 'post',
        page: 1,
        per_page: 10,
      })
    })

    it('throws when the query is missing', async () => {
      await expect(service.searchSite()).rejects.toThrow('Query is required.')
    })
  })

  describe('settings', () => {
    it('reads the site settings', async () => {
      mock.onGet(`${ BASE }/settings`).reply({ title: 'My Blog' })

      const result = await service.getSettings()

      expect(result).toEqual({ title: 'My Blog' })
    })

    it('updates the site settings with mapped choices', async () => {
      mock.onPost(`${ BASE }/settings`).reply({ title: 'New Title' })

      await service.updateSettings(
        'New Title', 'Tagline', 'admin@example.com', 'UTC', 'F j, Y', 'H:i', 1, 'en_US', 9, 20, 'Open', 'Closed'
      )

      expect(lastCall().body).toEqual({
        title: 'New Title',
        description: 'Tagline',
        email: 'admin@example.com',
        timezone: 'UTC',
        date_format: 'F j, Y',
        time_format: 'H:i',
        start_of_week: 1,
        language: 'en_US',
        default_category: 9,
        posts_per_page: 20,
        default_comment_status: 'open',
        default_ping_status: 'closed',
      })
    })
  })

  describe('listTaxonomies', () => {
    it('filters by post type', async () => {
      mock.onGet(`${ BASE }/taxonomies`).reply({})

      await service.listTaxonomies('post')

      expect(lastCall().query).toEqual({ type: 'post' })
    })
  })

  describe('listPostTypes', () => {
    it('reads the registered post types', async () => {
      mock.onGet(`${ BASE }/types`).reply({ post: { slug: 'post' } })

      const result = await service.listPostTypes()

      expect(result).toEqual({ post: { slug: 'post' } })
    })
  })

  // ── Post meta ──

  describe('getPostMeta', () => {
    it('reads meta from a post in edit context', async () => {
      mock.onGet(`${ BASE }/posts/42`).reply({ id: 42, meta: { featured: 'yes' } })

      const result = await service.getPostMeta('post', 42)

      expect(result).toEqual({ featured: 'yes' })
      expect(lastCall().query).toEqual({ context: 'edit' })
    })

    it('reads meta from a page', async () => {
      mock.onGet(`${ BASE }/pages/5`).reply({ id: 5, meta: {} })

      await service.getPostMeta('page', 5)

      expect(lastCall().url).toBe(`${ BASE }/pages/5`)
    })

    it('returns an empty object when the response has no meta', async () => {
      mock.onGet(`${ BASE }/posts/42`).reply({ id: 42 })

      const result = await service.getPostMeta('post', 42)

      expect(result).toEqual({})
    })

    it('throws when the post id is missing', async () => {
      await expect(service.getPostMeta('post')).rejects.toThrow('Post ID is required.')
    })
  })

  describe('updatePostMeta', () => {
    it('writes the meta object and returns the saved meta', async () => {
      mock.onPost(`${ BASE }/posts/42`).reply({ id: 42, meta: { featured: 'yes' } })

      const result = await service.updatePostMeta('post', 42, { featured: 'yes' })

      expect(result).toEqual({ featured: 'yes' })
      expect(lastCall().body).toEqual({ meta: { featured: 'yes' } })
    })

    it('throws when meta is not a plain object', async () => {
      await expect(service.updatePostMeta('post', 42, ['a'])).rejects.toThrow(
        'Meta must be an object of key/value pairs.'
      )
    })

    it('throws when meta is empty', async () => {
      await expect(service.updatePostMeta('post', 42, {})).rejects.toThrow('Provide at least one meta key to update.')
    })

    it('throws when the post id is missing', async () => {
      await expect(service.updatePostMeta('post', null, { a: 1 })).rejects.toThrow('Post ID is required.')
    })
  })

  // ── Custom post types ──

  describe('custom post types', () => {
    it('lists custom posts', async () => {
      mock.onGet(`${ BASE }/portfolio`).reply([])

      await service.listCustomPosts('portfolio', 'publish', 'work', 1, 10, 'date', 'desc')

      expect(lastCall().query).toEqual({
        status: 'publish',
        search: 'work',
        page: 1,
        per_page: 10,
        orderby: 'date',
        order: 'desc',
      })
    })

    it('throws when the REST base is missing on list', async () => {
      await expect(service.listCustomPosts()).rejects.toThrow('Post Type (REST base) is required.')
    })

    it('gets a custom post', async () => {
      mock.onGet(`${ BASE }/portfolio/101`).reply({ id: 101 })

      await service.getCustomPost('portfolio', 101)

      expect(lastCall().url).toBe(`${ BASE }/portfolio/101`)
    })

    it('throws when the custom post id is missing', async () => {
      await expect(service.getCustomPost('portfolio')).rejects.toThrow('Post ID is required.')
    })

    it('creates a custom post', async () => {
      mock.onPost(`${ BASE }/portfolio`).reply({ id: 101 })

      await service.createCustomPost('portfolio', 'Case Study', '<p>Body</p>', 'draft', 'case-study', 'Excerpt', { client: 'Acme' })

      expect(lastCall().body).toEqual({
        title: 'Case Study',
        content: '<p>Body</p>',
        status: 'draft',
        slug: 'case-study',
        excerpt: 'Excerpt',
        meta: { client: 'Acme' },
      })
    })

    it('throws when the custom post title is missing', async () => {
      await expect(service.createCustomPost('portfolio')).rejects.toThrow('Title is required.')
    })

    it('updates a custom post', async () => {
      mock.onPost(`${ BASE }/portfolio/101`).reply({ id: 101 })

      await service.updateCustomPost('portfolio', 101, 'New Title')

      expect(lastCall().body).toEqual({ title: 'New Title' })
    })

    it('throws when the REST base is missing on update', async () => {
      await expect(service.updateCustomPost()).rejects.toThrow('Post Type (REST base) is required.')
    })

    it('deletes a custom post permanently', async () => {
      mock.onDelete(`${ BASE }/portfolio/101`).reply({ deleted: true })

      await service.deleteCustomPost('portfolio', 101, true)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the custom post id is missing on delete', async () => {
      await expect(service.deleteCustomPost('portfolio')).rejects.toThrow('Post ID is required.')
    })
  })

  // ── Custom taxonomy terms ──

  describe('custom taxonomy terms', () => {
    it('lists terms', async () => {
      mock.onGet(`${ BASE }/genre`).reply([])

      await service.listTaxonomyTerms('genre', 'rock', 0, true, 1, 20, 'name', 'asc')

      expect(lastCall().query).toEqual({
        search: 'rock',
        parent: 0,
        hide_empty: true,
        page: 1,
        per_page: 20,
        orderby: 'name',
        order: 'asc',
      })
    })

    it('throws when the taxonomy is missing on list', async () => {
      await expect(service.listTaxonomyTerms()).rejects.toThrow('Taxonomy (REST base) is required.')
    })

    it('creates a term', async () => {
      mock.onPost(`${ BASE }/genre`).reply({ id: 55 })

      await service.createTaxonomyTerm('genre', 'Rock', 'rock', 'Rock music', 2, { icon: 'guitar' })

      expect(lastCall().body).toEqual({
        name: 'Rock',
        slug: 'rock',
        description: 'Rock music',
        parent: 2,
        meta: { icon: 'guitar' },
      })
    })

    it('throws when the term name is missing', async () => {
      await expect(service.createTaxonomyTerm('genre')).rejects.toThrow('Name is required.')
    })

    it('updates a term', async () => {
      mock.onPost(`${ BASE }/genre/55`).reply({ id: 55 })

      await service.updateTaxonomyTerm('genre', 55, 'Rock & Roll')

      expect(lastCall().body).toEqual({ name: 'Rock & Roll' })
    })

    it('throws when the term id is missing on update', async () => {
      await expect(service.updateTaxonomyTerm('genre')).rejects.toThrow('Term ID is required.')
    })

    it('force-deletes a term', async () => {
      mock.onDelete(`${ BASE }/genre/55`).reply({ deleted: true })

      await service.deleteTaxonomyTerm('genre', 55)

      expect(lastCall().query).toEqual({ force: true })
    })

    it('throws when the term id is missing on delete', async () => {
      await expect(service.deleteTaxonomyTerm('genre')).rejects.toThrow('Term ID is required.')
    })
  })

  // ── Dictionaries ──

  describe('getCategoriesDictionary', () => {
    it('maps categories and returns no cursor for a short page', async () => {
      mock.onGet(`${ BASE }/categories`).reply([{ id: 9, name: 'News', slug: 'news' }])

      const result = await service.getCategoriesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'News', value: '9', note: 'Slug: news' }],
        cursor: null,
      })

      expect(lastCall().query).toEqual({ page: 1, per_page: 100, orderby: 'name', order: 'asc' })
    })

    it('advances the cursor on a full page and passes the search term', async () => {
      mock.onGet(`${ BASE }/categories`).reply(
        Array.from({ length: 100 }, (_, i) => ({ id: i, name: `C${ i }`, slug: `c${ i }` }))
      )

      const result = await service.getCategoriesDictionary({ search: 'c', cursor: '2' })

      expect(result.cursor).toBe('3')
      expect(lastCall().query).toMatchObject({ search: 'c', page: 2 })
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(`${ BASE }/categories`).reply(null)

      const result = await service.getCategoriesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTagsDictionary', () => {
    it('maps tags to label/value/note', async () => {
      mock.onGet(`${ BASE }/tags`).reply([{ id: 12, name: 'JS', slug: 'js' }])

      const result = await service.getTagsDictionary({})

      expect(result).toEqual({ items: [{ label: 'JS', value: '12', note: 'Slug: js' }], cursor: null })
    })

    it('advances the cursor on a full page', async () => {
      mock.onGet(`${ BASE }/tags`).reply(Array.from({ length: 100 }, (_, i) => ({ id: i, name: `T${ i }`, slug: `t${ i }` })))

      const result = await service.getTagsDictionary({ cursor: '1' })

      expect(result.cursor).toBe('2')
    })
  })

  describe('getAuthorsDictionary', () => {
    it('prefers the display name, then the username, then the id', async () => {
      mock.onGet(`${ BASE }/users`).reply([
        { id: 1, name: 'Ada', slug: 'ada' },
        { id: 2, username: 'grace' },
        { id: 3 },
      ])

      const result = await service.getAuthorsDictionary({})

      expect(result.items).toEqual([
        { label: 'Ada', value: '1', note: 'Slug: ada' },
        { label: 'grace', value: '2', note: 'ID: 2' },
        { label: 'User 3', value: '3', note: 'ID: 3' },
      ])

      expect(lastCall().query).toMatchObject({ context: 'edit', per_page: 100 })
    })
  })

  describe('getPostTypesDictionary', () => {
    it('maps registered types with a REST base', async () => {
      mock.onGet(`${ BASE }/types`).reply({
        post: { name: 'Posts', slug: 'post', rest_base: 'posts' },
        block: { name: 'Blocks', slug: 'wp_block' },
      })

      const result = await service.getPostTypesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Posts', value: 'posts', note: 'Slug: post' }],
        cursor: null,
      })
    })

    it('filters by search term against name and slug', async () => {
      mock.onGet(`${ BASE }/types`).reply({
        post: { name: 'Posts', slug: 'post', rest_base: 'posts' },
        page: { name: 'Pages', slug: 'page', rest_base: 'pages' },
      })

      const result = await service.getPostTypesDictionary({ search: 'PAGE' })

      expect(result.items).toEqual([{ label: 'Pages', value: 'pages', note: 'Slug: page' }])
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(`${ BASE }/types`).reply(null)

      const result = await service.getPostTypesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTaxonomiesDictionary', () => {
    it('maps taxonomies with a REST base', async () => {
      mock.onGet(`${ BASE }/taxonomies`).reply({
        category: { name: 'Categories', slug: 'category', rest_base: 'categories' },
        hidden: { name: 'Hidden', slug: 'hidden' },
      })

      const result = await service.getTaxonomiesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Categories', value: 'categories', note: 'Slug: category' }],
        cursor: null,
      })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/taxonomies`).reply({
        category: { name: 'Categories', slug: 'category', rest_base: 'categories' },
        post_tag: { name: 'Tags', slug: 'post_tag', rest_base: 'tags' },
      })

      const result = await service.getTaxonomiesDictionary({ search: 'tag' })

      expect(result.items).toEqual([{ label: 'Tags', value: 'tags', note: 'Slug: post_tag' }])
    })
  })

  // ── Polling triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${ BASE }/posts`).reply([{ id: 10 }])

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewPublishedPost',
        learningMode: true,
        triggerData: {},
      })

      expect(result.events).toEqual([{ id: 10 }])
    })
  })

  describe('onNewPublishedPost', () => {
    it('returns the newest post as a sample in learning mode', async () => {
      mock.onGet(`${ BASE }/posts`).reply([{ id: 10 }, { id: 9 }])

      const result = await service.onNewPublishedPost({ learningMode: true, triggerData: {} })

      expect(result).toEqual({ events: [{ id: 10 }], state: { lastSeenId: 10 } })
      expect(lastCall().query).toMatchObject({ status: 'publish', per_page: 100, page: 1, orderby: 'id', order: 'desc' })
    })

    it('returns no sample in learning mode when the site has no posts', async () => {
      mock.onGet(`${ BASE }/posts`).reply([])

      const result = await service.onNewPublishedPost({ learningMode: true })

      expect(result).toEqual({ events: [], state: { lastSeenId: 0 } })
    })

    it('seeds the watermark without replaying the backlog on the first cycle', async () => {
      mock.onGet(`${ BASE }/posts`).reply([{ id: 10 }, { id: 9 }])

      const result = await service.onNewPublishedPost({ triggerData: {} })

      expect(result).toEqual({ events: [], state: { lastSeenId: 10 } })
    })

    it('emits only posts above the watermark, oldest first', async () => {
      mock.onGet(`${ BASE }/posts`).reply([{ id: 12 }, { id: 11 }, { id: 10 }])

      const result = await service.onNewPublishedPost({ state: { lastSeenId: 10 }, triggerData: {} })

      expect(result).toEqual({ events: [{ id: 11 }, { id: 12 }], state: { lastSeenId: 12 } })
    })

    it('walks additional pages when the first page is entirely new', async () => {
      const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: 200 - i }))

      mock.onGet(`${ BASE }/posts`).replyWith(call => (call.query.page === 1 ? pageOne : [{ id: 100 }, { id: 5 }]))

      const result = await service.onNewPublishedPost({ state: { lastSeenId: 50 }, triggerData: {} })

      expect(mock.history).toHaveLength(2)
      expect(result.events).toHaveLength(101)
      expect(result.events[0]).toEqual({ id: 100 })
      expect(result.state).toEqual({ lastSeenId: 200 })
    })

    it('filters by category when the trigger is configured with one', async () => {
      mock.onGet(`${ BASE }/posts`).reply([])

      await service.onNewPublishedPost({ triggerData: { categoryId: 9 } })

      expect(lastCall().query).toMatchObject({ categories: 9 })
    })
  })

  describe('onNewComment', () => {
    it('returns the newest comment as a sample in learning mode', async () => {
      mock.onGet(`${ BASE }/comments`).reply([{ id: 20 }])

      const result = await service.onNewComment({ learningMode: true, triggerData: {} })

      expect(result).toEqual({ events: [{ id: 20 }], state: { lastSeenId: 20 } })
    })

    it('returns no sample in learning mode when there are no comments', async () => {
      mock.onGet(`${ BASE }/comments`).reply([])

      const result = await service.onNewComment({ learningMode: true })

      expect(result).toEqual({ events: [], state: { lastSeenId: 0 } })
    })

    it('seeds the watermark on the first cycle', async () => {
      mock.onGet(`${ BASE }/comments`).reply([{ id: 20 }])

      const result = await service.onNewComment({ triggerData: {} })

      expect(result).toEqual({ events: [], state: { lastSeenId: 20 } })
    })

    it('emits only comments above the watermark, oldest first', async () => {
      mock.onGet(`${ BASE }/comments`).reply([{ id: 22 }, { id: 21 }, { id: 20 }])

      const result = await service.onNewComment({ state: { lastSeenId: 20 }, triggerData: {} })

      expect(result).toEqual({ events: [{ id: 21 }, { id: 22 }], state: { lastSeenId: 22 } })
    })

    it('walks additional pages during a burst', async () => {
      const pageOne = Array.from({ length: 100 }, (_, i) => ({ id: 300 - i }))

      mock.onGet(`${ BASE }/comments`).replyWith(call => (call.query.page === 1 ? pageOne : [{ id: 200 }, { id: 1 }]))

      const result = await service.onNewComment({ state: { lastSeenId: 100 }, triggerData: {} })

      expect(result.events).toHaveLength(101)
      expect(result.state).toEqual({ lastSeenId: 300 })
    })

    it('scopes the poll to a post and status when configured', async () => {
      mock.onGet(`${ BASE }/comments`).reply([])

      await service.onNewComment({ triggerData: { postId: 42, status: 'hold' } })

      expect(lastCall().query).toMatchObject({ post: 42, status: 'hold' })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('prefixes an authentication hint on 401', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Incorrect password.', code: 'incorrect_password' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow(
        'Check the WordPress username and Application Password, or reconnect the account. (Incorrect password. (code: incorrect_password))'
      )
    })

    it('prefixes a not-found hint using the status inside the error body', async () => {
      mock.onGet(`${ BASE }/posts/999`).replyWithError({
        body: { message: 'Invalid post ID.', code: 'rest_post_invalid_id', data: { status: 404 } },
      })

      await expect(service.getPost(999)).rejects.toThrow('The requested WordPress resource was not found')
    })

    it('prefixes a rate-limit hint on 429', async () => {
      mock.onGet(`${ BASE }/posts`).replyWithError({ message: 'Too Many Requests', status: 429 })

      await expect(service.listPosts()).rejects.toThrow('WordPress is rate-limiting requests')
    })

    it('falls back to a generic message for an unmapped status', async () => {
      mock.onPost(`${ BASE }/posts`).replyWithError({ message: 'socket hang up', status: 500 })

      await expect(service.createPost('Hi')).rejects.toThrow('WordPress API request failed: socket hang up')
    })
  })
})
