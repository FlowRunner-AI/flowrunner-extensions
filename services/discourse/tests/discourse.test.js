'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://forum.example.com'
const API_KEY = 'test-api-key'
const API_USERNAME = 'system'
// The service strips trailing slashes from the site URL, so the base equals SITE_URL.
const BASE = SITE_URL

describe('Discourse Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      siteUrl: `${ SITE_URL }/`, // trailing slash on purpose — should be stripped
      apiKey: API_KEY,
      apiUsername: API_USERNAME,
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'siteUrl',
          displayName: 'Site URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiUsername',
          displayName: 'API Username',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('strips a trailing slash from the site URL', async () => {
      mock.onGet(`${ BASE }/latest.json`).reply({ topic_list: { topics: [] } })

      await service.listLatestTopics()

      // If the slash was not stripped, the URL would be `${SITE_URL}//latest.json`.
      expect(mock.history[0].url).toBe(`${ BASE }/latest.json`)
    })

    it('sends the Api-Key and Api-Username headers on requests', async () => {
      mock.onGet(`${ BASE }/latest.json`).reply({ topic_list: { topics: [] } })

      await service.listLatestTopics()

      expect(mock.history[0].headers).toMatchObject({
        'Api-Key': API_KEY,
        'Api-Username': API_USERNAME,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Topics & Posts ──

  describe('createTopic', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 301, topic_id: 142 })

      const result = await service.createTopic('My Title', 'Hello world')

      expect(result).toEqual({ id: 301, topic_id: 142 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/posts.json`)
      expect(mock.history[0].body).toEqual({ title: 'My Title', raw: 'Hello world' })
    })

    it('includes the category when provided', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 302, topic_id: 143 })

      await service.createTopic('My Title', 'Hello world', 5)

      expect(mock.history[0].body).toEqual({
        title: 'My Title',
        raw: 'Hello world',
        category: 5,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/posts.json`).replyWithError({
        status: 422,
        body: { errors: ['Title is too short', 'Body is too short'] },
      })

      await expect(service.createTopic('x', 'y')).rejects.toThrow(
        'Discourse API error (422): Title is too short; Body is too short'
      )
    })
  })

  describe('createPost', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 302, post_number: 2 })

      const result = await service.createPost(142, 'Great point!')

      expect(result).toEqual({ id: 302, post_number: 2 })
      expect(mock.history[0].body).toEqual({ topic_id: 142, raw: 'Great point!' })
    })

    it('includes reply_to_post_number when provided', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 303, post_number: 3 })

      await service.createPost(142, 'Threaded reply', 1)

      expect(mock.history[0].body).toEqual({
        topic_id: 142,
        raw: 'Threaded reply',
        reply_to_post_number: 1,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/posts.json`).replyWithError({
        status: 403,
        body: { error: 'You are not permitted to view the requested resource.' },
      })

      await expect(service.createPost(142, 'x')).rejects.toThrow(
        'Discourse API error (403): You are not permitted to view the requested resource.'
      )
    })
  })

  describe('getTopic', () => {
    it('sends GET to the topic endpoint', async () => {
      mock.onGet(`${ BASE }/t/142.json`).reply({ id: 142, title: 'Welcome' })

      const result = await service.getTopic(142)

      expect(result).toEqual({ id: 142, title: 'Welcome' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/t/142.json`)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('url-encodes the topic id', async () => {
      mock.onGet(`${ BASE }/t/a%2Fb.json`).reply({ id: 'a/b' })

      await service.getTopic('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/t/a%2Fb.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/t/999.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.getTopic(999)).rejects.toThrow('Discourse API error (404): Not Found')
    })
  })

  describe('getPost', () => {
    it('sends GET to the post endpoint', async () => {
      mock.onGet(`${ BASE }/posts/301.json`).reply({ id: 301, raw: 'Hello world' })

      const result = await service.getPost(301)

      expect(result).toEqual({ id: 301, raw: 'Hello world' })
      expect(mock.history[0].url).toBe(`${ BASE }/posts/301.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/posts/999.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.getPost(999)).rejects.toThrow('Discourse API error (404): Not Found')
    })
  })

  describe('updatePost', () => {
    it('sends PUT with raw wrapped in a post object', async () => {
      mock.onPut(`${ BASE }/posts/301.json`).reply({ post: { id: 301, version: 2 } })

      const result = await service.updatePost(301, 'Updated content')

      expect(result).toEqual({ post: { id: 301, version: 2 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/posts/301.json`)
      expect(mock.history[0].body).toEqual({ post: { raw: 'Updated content' } })
    })

    it('includes the edit reason when provided', async () => {
      mock.onPut(`${ BASE }/posts/301.json`).reply({ post: { id: 301, version: 3 } })

      await service.updatePost(301, 'Updated content', 'Fixed typo')

      expect(mock.history[0].body).toEqual({
        post: { raw: 'Updated content', edit_reason: 'Fixed typo' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/posts/301.json`).replyWithError({ status: 422, body: { errors: ['Body is too short'] } })

      await expect(service.updatePost(301, 'x')).rejects.toThrow(
        'Discourse API error (422): Body is too short'
      )
    })
  })

  describe('deletePost', () => {
    it('sends DELETE and defaults to a success object on empty body', async () => {
      mock.onDelete(`${ BASE }/posts/301.json`).reply(undefined)

      const result = await service.deletePost(301)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/posts/301.json`)
    })

    it('returns the API body when one is provided', async () => {
      mock.onDelete(`${ BASE }/posts/301.json`).reply({ deleted: true })

      const result = await service.deletePost(301)

      expect(result).toEqual({ deleted: true })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/posts/301.json`).replyWithError({ status: 403, body: { error: 'Forbidden' } })

      await expect(service.deletePost(301)).rejects.toThrow('Discourse API error (403): Forbidden')
    })
  })

  describe('deleteTopic', () => {
    it('sends DELETE to the topic endpoint and defaults to success', async () => {
      mock.onDelete(`${ BASE }/t/142.json`).reply(undefined)

      const result = await service.deleteTopic(142)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/t/142.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/t/999.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.deleteTopic(999)).rejects.toThrow('Discourse API error (404): Not Found')
    })
  })

  describe('listLatestTopics', () => {
    it('sends GET with no page query when omitted', async () => {
      mock.onGet(`${ BASE }/latest.json`).reply({ topic_list: { topics: [] } })

      await service.listLatestTopics()

      expect(mock.history[0].url).toBe(`${ BASE }/latest.json`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the page query when provided', async () => {
      mock.onGet(`${ BASE }/latest.json`).reply({ topic_list: { topics: [] } })

      await service.listLatestTopics(2)

      expect(mock.history[0].query).toEqual({ page: 2 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/latest.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.listLatestTopics()).rejects.toThrow(
        'Discourse API error (500): Server Error'
      )
    })
  })

  describe('listTopTopics', () => {
    it('sends GET with no period query when omitted', async () => {
      mock.onGet(`${ BASE }/top.json`).reply({ topic_list: { topics: [] } })

      await service.listTopTopics()

      expect(mock.history[0].url).toBe(`${ BASE }/top.json`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps a friendly period label to the API value', async () => {
      mock.onGet(`${ BASE }/top.json`).reply({ topic_list: { topics: [] } })

      await service.listTopTopics('Monthly')

      expect(mock.history[0].query).toEqual({ period: 'monthly' })
    })

    it('maps All Time to all', async () => {
      mock.onGet(`${ BASE }/top.json`).reply({ topic_list: { topics: [] } })

      await service.listTopTopics('All Time')

      expect(mock.history[0].query).toEqual({ period: 'all' })
    })

    it('passes an unmapped period value through unchanged', async () => {
      mock.onGet(`${ BASE }/top.json`).reply({ topic_list: { topics: [] } })

      await service.listTopTopics('weekly')

      expect(mock.history[0].query).toEqual({ period: 'weekly' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/top.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.listTopTopics('Daily')).rejects.toThrow(
        'Discourse API error (500): Server Error'
      )
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('sends GET with no query when subcategories not requested', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply({ category_list: { categories: [] } })

      await service.listCategories()

      expect(mock.history[0].url).toBe(`${ BASE }/categories.json`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes include_subcategories when requested', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply({ category_list: { categories: [] } })

      await service.listCategories(true)

      expect(mock.history[0].query).toEqual({ include_subcategories: true })
    })

    it('omits include_subcategories when explicitly false', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply({ category_list: { categories: [] } })

      await service.listCategories(false)

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/categories.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.listCategories()).rejects.toThrow(
        'Discourse API error (500): Server Error'
      )
    })
  })

  describe('getCategoryTopics', () => {
    it('sends GET to the /c/{slug}/{id} endpoint', async () => {
      mock.onGet(`${ BASE }/c/general/5.json`).reply({ topic_list: { topics: [] } })

      await service.getCategoryTopics('general', 5)

      expect(mock.history[0].url).toBe(`${ BASE }/c/general/5.json`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the page query when provided', async () => {
      mock.onGet(`${ BASE }/c/general/5.json`).reply({ topic_list: { topics: [] } })

      await service.getCategoryTopics('general', 5, 3)

      expect(mock.history[0].query).toEqual({ page: 3 })
    })

    it('url-encodes the slug and id', async () => {
      mock.onGet(`${ BASE }/c/dev%2Fops/7.json`).reply({ topic_list: { topics: [] } })

      await service.getCategoryTopics('dev/ops', 7)

      expect(mock.history[0].url).toBe(`${ BASE }/c/dev%2Fops/7.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/c/general/5.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.getCategoryTopics('general', 5)).rejects.toThrow(
        'Discourse API error (404): Not Found'
      )
    })
  })

  // ── Search ──

  describe('search', () => {
    it('sends GET with the query term', async () => {
      mock.onGet(`${ BASE }/search.json`).reply({ posts: [], topics: [], users: [] })

      const result = await service.search('welcome')

      expect(result).toEqual({ posts: [], topics: [], users: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/search.json`)
      expect(mock.history[0].query).toEqual({ q: 'welcome' })
    })

    it('includes the page query when provided', async () => {
      mock.onGet(`${ BASE }/search.json`).reply({ posts: [] })

      await service.search('welcome @alice', 2)

      expect(mock.history[0].query).toEqual({ q: 'welcome @alice', page: 2 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/search.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.search('welcome')).rejects.toThrow(
        'Discourse API error (500): Server Error'
      )
    })
  })

  // ── Users ──

  describe('getUser', () => {
    it('sends GET to the user endpoint', async () => {
      mock.onGet(`${ BASE }/users/alice.json`).reply({ user: { id: 42, username: 'alice' } })

      const result = await service.getUser('alice')

      expect(result).toEqual({ user: { id: 42, username: 'alice' } })
      expect(mock.history[0].url).toBe(`${ BASE }/users/alice.json`)
    })

    it('url-encodes the username', async () => {
      mock.onGet(`${ BASE }/users/a%20b.json`).reply({ user: { username: 'a b' } })

      await service.getUser('a b')

      expect(mock.history[0].url).toBe(`${ BASE }/users/a%20b.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/ghost.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.getUser('ghost')).rejects.toThrow('Discourse API error (404): Not Found')
    })
  })

  describe('createUser', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ success: true, user_id: 42 })

      const result = await service.createUser('Alice Doe', 'alice@example.com', 'alice', 'secret-pw')

      expect(result).toEqual({ success: true, user_id: 42 })
      expect(mock.history[0].url).toBe(`${ BASE }/users.json`)
      expect(mock.history[0].body).toEqual({
        name: 'Alice Doe',
        email: 'alice@example.com',
        username: 'alice',
        password: 'secret-pw',
      })
    })

    it('includes active and approved when enabled', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ success: true, user_id: 43 })

      await service.createUser('Bob Roe', 'bob@example.com', 'bob', 'secret-pw', true, true)

      expect(mock.history[0].body).toEqual({
        name: 'Bob Roe',
        email: 'bob@example.com',
        username: 'bob',
        password: 'secret-pw',
        active: true,
        approved: true,
      })
    })

    it('omits active and approved when falsy', async () => {
      mock.onPost(`${ BASE }/users.json`).reply({ success: true, user_id: 44 })

      await service.createUser('Cara', 'cara@example.com', 'cara', 'secret-pw', false, false)

      expect(mock.history[0].body).toEqual({
        name: 'Cara',
        email: 'cara@example.com',
        username: 'cara',
        password: 'secret-pw',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/users.json`).replyWithError({
        status: 422,
        body: { errors: ['Username must be unique'] },
      })

      await expect(
        service.createUser('Alice', 'alice@example.com', 'alice', 'pw')
      ).rejects.toThrow('Discourse API error (422): Username must be unique')
    })
  })

  describe('getUserByExternalId', () => {
    it('sends GET to the by-external endpoint', async () => {
      mock.onGet(`${ BASE }/u/by-external/ext-1001.json`).reply({ user: { id: 42, external_id: 'ext-1001' } })

      const result = await service.getUserByExternalId('ext-1001')

      expect(result).toEqual({ user: { id: 42, external_id: 'ext-1001' } })
      expect(mock.history[0].url).toBe(`${ BASE }/u/by-external/ext-1001.json`)
    })

    it('url-encodes the external id', async () => {
      mock.onGet(`${ BASE }/u/by-external/ext%2F1.json`).reply({ user: { external_id: 'ext/1' } })

      await service.getUserByExternalId('ext/1')

      expect(mock.history[0].url).toBe(`${ BASE }/u/by-external/ext%2F1.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/u/by-external/ghost.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.getUserByExternalId('ghost')).rejects.toThrow(
        'Discourse API error (404): Not Found'
      )
    })
  })

  describe('listUserActions', () => {
    it('sends GET with only the username when no filters', async () => {
      mock.onGet(`${ BASE }/user_actions.json`).reply({ user_actions: [] })

      await service.listUserActions('alice')

      expect(mock.history[0].url).toBe(`${ BASE }/user_actions.json`)
      expect(mock.history[0].query).toEqual({ username: 'alice' })
    })

    it('maps a friendly filter label to the API value and includes offset', async () => {
      mock.onGet(`${ BASE }/user_actions.json`).reply({ user_actions: [] })

      await service.listUserActions('alice', 'Topics Created', 20)

      expect(mock.history[0].query).toEqual({
        username: 'alice',
        filter: '4',
        offset: 20,
      })
    })

    it('maps the combined Posts filter to a comma list', async () => {
      mock.onGet(`${ BASE }/user_actions.json`).reply({ user_actions: [] })

      await service.listUserActions('alice', 'Posts')

      expect(mock.history[0].query).toEqual({ username: 'alice', filter: '4,5' })
    })

    it('passes an unmapped filter value through unchanged', async () => {
      mock.onGet(`${ BASE }/user_actions.json`).reply({ user_actions: [] })

      await service.listUserActions('alice', '15')

      expect(mock.history[0].query).toEqual({ username: 'alice', filter: '15' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/user_actions.json`).replyWithError({ status: 404, message: 'Not Found' })

      await expect(service.listUserActions('ghost')).rejects.toThrow(
        'Discourse API error (404): Not Found'
      )
    })
  })

  describe('suspendUser', () => {
    it('sends PUT to the admin suspend endpoint', async () => {
      mock.onPut(`${ BASE }/admin/users/42/suspend.json`).reply({ suspension: { suspended: true } })

      const result = await service.suspendUser(42, '2026-12-31T00:00:00Z', 'Spam')

      expect(result).toEqual({ suspension: { suspended: true } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/admin/users/42/suspend.json`)
      expect(mock.history[0].body).toEqual({
        suspend_until: '2026-12-31T00:00:00Z',
        reason: 'Spam',
      })
    })

    it('url-encodes the user id', async () => {
      mock.onPut(`${ BASE }/admin/users/a%2Fb/suspend.json`).reply({ suspension: {} })

      await service.suspendUser('a/b', '2026-12-31T00:00:00Z', 'Spam')

      expect(mock.history[0].url).toBe(`${ BASE }/admin/users/a%2Fb/suspend.json`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/admin/users/42/suspend.json`).replyWithError({ status: 403, body: { error: 'Forbidden' } })

      await expect(service.suspendUser(42, '2026-12-31T00:00:00Z', 'Spam')).rejects.toThrow(
        'Discourse API error (403): Forbidden'
      )
    })
  })

  // ── Private Messages ──

  describe('sendPrivateMessage', () => {
    it('joins an array of recipients into a comma-separated list', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 303, topic_id: 143 })

      const result = await service.sendPrivateMessage('Hello', 'Hi there', ['alice', 'bob'])

      expect(result).toEqual({ id: 303, topic_id: 143 })
      expect(mock.history[0].url).toBe(`${ BASE }/posts.json`)
      expect(mock.history[0].body).toEqual({
        title: 'Hello',
        raw: 'Hi there',
        target_recipients: 'alice,bob',
        archetype: 'private_message',
      })
    })

    it('accepts a string of recipients as-is', async () => {
      mock.onPost(`${ BASE }/posts.json`).reply({ id: 304 })

      await service.sendPrivateMessage('Hello', 'Hi', 'alice,bob')

      expect(mock.history[0].body).toEqual({
        title: 'Hello',
        raw: 'Hi',
        target_recipients: 'alice,bob',
        archetype: 'private_message',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/posts.json`).replyWithError({
        status: 422,
        body: { errors: ['Recipient not found'] },
      })

      await expect(service.sendPrivateMessage('Hello', 'Hi', ['ghost'])).rejects.toThrow(
        'Discourse API error (422): Recipient not found'
      )
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET to the tags endpoint', async () => {
      mock.onGet(`${ BASE }/tags.json`).reply({ tags: [{ id: 'intro', text: 'intro', count: 12 }] })

      const result = await service.listTags()

      expect(result).toEqual({ tags: [{ id: 'intro', text: 'intro', count: 12 }] })
      expect(mock.history[0].url).toBe(`${ BASE }/tags.json`)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/tags.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.listTags()).rejects.toThrow('Discourse API error (500): Server Error')
    })
  })

  // ── Dictionary Methods ──

  describe('getCategoriesDictionary', () => {
    const categoriesResponse = {
      category_list: {
        categories: [
          { id: 5, name: 'General', slug: 'general', topic_count: 124 },
          { id: 6, name: 'Support', slug: 'support', topic_count: 45 },
          { id: 7, name: 'Announcements', slug: 'announcements' },
        ],
      },
    }

    it('maps categories to items and hits the categories endpoint', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply(categoriesResponse)

      const result = await service.getCategoriesDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/categories.json`)
      expect(result).toEqual({
        items: [
          { label: 'General', value: '5', note: 'Slug: general - 124 topics' },
          { label: 'Support', value: '6', note: 'Slug: support - 45 topics' },
          { label: 'Announcements', value: '7', note: 'Slug: announcements' },
        ],
        cursor: null,
      })
    })

    it('filters categories by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply(categoriesResponse)

      const result = await service.getCategoriesDictionary({ search: 'gen' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('5')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply(categoriesResponse)

      const result = await service.getCategoriesDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('returns empty items when the response has no categories', async () => {
      mock.onGet(`${ BASE }/categories.json`).reply({})

      const result = await service.getCategoriesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/categories.json`).replyWithError({ status: 500, message: 'Server Error' })

      await expect(service.getCategoriesDictionary({})).rejects.toThrow(
        'Discourse API error (500): Server Error'
      )
    })
  })
})
