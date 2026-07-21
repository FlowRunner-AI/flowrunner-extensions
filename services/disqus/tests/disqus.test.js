'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://disqus.com/api/3.0'

// Every Disqus response is wrapped in { code, response }; the service unwraps it
// and returns the inner `response`. code 0 means success.
const ok = (response) => ({ code: 0, response })

describe('Disqus Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, accessToken: ACCESS_TOKEN })
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
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accessToken',
          displayName: 'Access Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Auth mechanism ──

  describe('authentication (query params)', () => {
    it('appends api_key and access_token to the query string on GET', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).reply(ok({ id: 'myforum' }))

      await service.getForumDetails('myforum')

      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        access_token: ACCESS_TOKEN,
        forum: 'myforum',
      })
      // Auth must NOT be in headers or body.
      expect(mock.history[0].headers).not.toHaveProperty('api_key')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('appends api_key and access_token to the query string on POST (payload stays in body)', async () => {
      mock.onPost(`${ BASE }/posts/approve.json`).reply(ok([{ id: '1' }]))

      await service.approvePost('1')

      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        access_token: ACCESS_TOKEN,
      })
      expect(mock.history[0].body).toEqual({ post: '1' })
      // The urlencoded content-type header is set for POSTs.
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
    })
  })

  // ── Response unwrapping & errors ──

  describe('response handling', () => {
    it('unwraps the inner `response` field on success', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).reply(ok({ id: 'myforum', name: 'My Forum' }))

      const result = await service.getForumDetails('myforum')

      expect(result).toEqual({ id: 'myforum', name: 'My Forum' })
    })

    it('throws a Disqus API error when code is non-zero', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).reply({ code: 2, response: 'Invalid API key' })

      await expect(service.getForumDetails('myforum')).rejects.toThrow(
        'Disqus API error (code 2): Invalid API key'
      )
    })

    it('uses "Unknown error" when the error response is not a string', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).reply({ code: 5, response: { foo: 'bar' } })

      await expect(service.getForumDetails('myforum')).rejects.toThrow(
        'Disqus API error (code 5): Unknown error'
      )
    })

    it('surfaces HTTP errors with status and body.response message', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { response: 'You must provide a forum' },
      })

      await expect(service.getForumDetails('bad')).rejects.toThrow(
        'Disqus API error (400): You must provide a forum'
      )
    })

    it('falls back to error.message when no structured body is present', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).replyWithError({
        message: 'Network down',
      })

      await expect(service.getForumDetails('bad')).rejects.toThrow(
        'Disqus API error: Network down'
      )
    })
  })

  // ── Forums ──

  describe('getForumDetails', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/forums/details.json`).reply(ok({ id: 'myforum' }))

      const result = await service.getForumDetails('myforum')

      expect(result).toEqual({ id: 'myforum' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({ forum: 'myforum' })
    })
  })

  describe('listForumCategories', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${ BASE }/forums/listCategories.json`).reply(ok([]))

      await service.listForumCategories('myforum')

      // limit and cursor are undefined → stripped by clean()
      expect(mock.history[0].query).toMatchObject({ forum: 'myforum' })
      expect(mock.history[0].query).not.toHaveProperty('limit')
      expect(mock.history[0].query).not.toHaveProperty('cursor')
    })

    it('includes limit and cursor when provided', async () => {
      mock.onGet(`${ BASE }/forums/listCategories.json`).reply(ok([]))

      await service.listForumCategories('myforum', 50, '1:0:0')

      expect(mock.history[0].query).toMatchObject({
        forum: 'myforum',
        limit: 50,
        cursor: '1:0:0',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/forums/listCategories.json`).replyWithError({ message: 'boom', status: 500 })

      await expect(service.listForumCategories('myforum')).rejects.toThrow('Disqus API error')
    })
  })

  describe('listForumThreads', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${ BASE }/forums/listThreads.json`).reply(ok([]))

      await service.listForumThreads('myforum')

      expect(mock.history[0].query).toMatchObject({ forum: 'myforum' })
      expect(mock.history[0].query).not.toHaveProperty('limit')
    })

    it('includes limit and cursor when provided', async () => {
      mock.onGet(`${ BASE }/forums/listThreads.json`).reply(ok([{ id: '55555' }]))

      await service.listForumThreads('myforum', 25, 'next-cursor')

      expect(mock.history[0].query).toMatchObject({
        forum: 'myforum',
        limit: 25,
        cursor: 'next-cursor',
      })
    })
  })

  describe('listForumPosts', () => {
    it('defaults include to "approved" when not provided', async () => {
      mock.onGet(`${ BASE }/forums/listPosts.json`).reply(ok([]))

      await service.listForumPosts('myforum')

      expect(mock.history[0].query).toMatchObject({ forum: 'myforum', include: 'approved' })
    })

    it('maps the Include choice label to the API value', async () => {
      mock.onGet(`${ BASE }/forums/listPosts.json`).reply(ok([]))

      await service.listForumPosts('myforum', 'Spam', 10, 'c1')

      expect(mock.history[0].query).toMatchObject({
        forum: 'myforum',
        include: 'spam',
        limit: 10,
        cursor: 'c1',
      })
    })

    it('passes through an already-lowercased include value unchanged', async () => {
      mock.onGet(`${ BASE }/forums/listPosts.json`).reply(ok([]))

      await service.listForumPosts('myforum', 'flagged')

      expect(mock.history[0].query).toMatchObject({ include: 'flagged' })
    })
  })

  // ── Threads ──

  describe('getThreadDetails', () => {
    it('looks up by thread id when no link is given', async () => {
      mock.onGet(`${ BASE }/threads/details.json`).reply(ok({ id: '55555' }))

      await service.getThreadDetails('55555')

      expect(mock.history[0].query).toMatchObject({ thread: '55555' })
      expect(mock.history[0].query).not.toHaveProperty('thread:link')
    })

    it('looks up by forum + link when link is given', async () => {
      mock.onGet(`${ BASE }/threads/details.json`).reply(ok({ id: '55555' }))

      await service.getThreadDetails(undefined, 'myforum', 'https://example.com/welcome')

      expect(mock.history[0].query).toMatchObject({
        forum: 'myforum',
        'thread:link': 'https://example.com/welcome',
      })
      expect(mock.history[0].query).not.toHaveProperty('thread')
    })
  })

  describe('listThreadPosts', () => {
    it('defaults include to "approved"', async () => {
      mock.onGet(`${ BASE }/threads/listPosts.json`).reply(ok([]))

      await service.listThreadPosts('55555')

      expect(mock.history[0].query).toMatchObject({ thread: '55555', include: 'approved' })
    })

    it('maps include label and passes pagination', async () => {
      mock.onGet(`${ BASE }/threads/listPosts.json`).reply(ok([]))

      await service.listThreadPosts('55555', 'Unapproved', 5, 'cur')

      expect(mock.history[0].query).toMatchObject({
        thread: '55555',
        include: 'unapproved',
        limit: 5,
        cursor: 'cur',
      })
    })
  })

  describe('createThread', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/threads/create.json`).reply(ok({ id: '88888' }))

      const result = await service.createThread('myforum', 'My title')

      expect(result).toEqual({ id: '88888' })
      // optional fields undefined → stripped by clean()
      expect(mock.history[0].body).toEqual({ forum: 'myforum', title: 'My title' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/threads/create.json`).reply(ok({ id: '88889' }))

      await service.createThread(
        'myforum',
        'My title',
        'https://example.com/launch',
        'launch-2016',
        'new-product-launch',
        '98765',
        'Opening message'
      )

      expect(mock.history[0].body).toEqual({
        forum: 'myforum',
        title: 'My title',
        url: 'https://example.com/launch',
        identifier: 'launch-2016',
        slug: 'new-product-launch',
        category: '98765',
        message: 'Opening message',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/threads/create.json`).reply({ code: 4, response: 'You must provide a forum' })

      await expect(service.createThread('', 'title')).rejects.toThrow(
        'Disqus API error (code 4): You must provide a forum'
      )
    })
  })

  describe('closeThread', () => {
    it('sends POST with thread id in body', async () => {
      mock.onPost(`${ BASE }/threads/close.json`).reply(ok([{ id: '55555' }]))

      const result = await service.closeThread('55555')

      expect(result).toEqual([{ id: '55555' }])
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ thread: '55555' })
    })
  })

  describe('openThread', () => {
    it('sends POST with thread id in body', async () => {
      mock.onPost(`${ BASE }/threads/open.json`).reply(ok([{ id: '55555' }]))

      const result = await service.openThread('55555')

      expect(result).toEqual([{ id: '55555' }])
      expect(mock.history[0].body).toEqual({ thread: '55555' })
    })
  })

  // ── Posts ──

  describe('getPost', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/posts/details.json`).reply(ok({ id: '3000001' }))

      const result = await service.getPost('3000001')

      expect(result).toEqual({ id: '3000001' })
      expect(mock.history[0].query).toMatchObject({ post: '3000001' })
    })
  })

  describe('listPosts', () => {
    it('defaults include to "approved"', async () => {
      mock.onGet(`${ BASE }/posts/list.json`).reply(ok([]))

      await service.listPosts('myforum')

      expect(mock.history[0].query).toMatchObject({ forum: 'myforum', include: 'approved' })
    })

    it('maps include label and passes pagination', async () => {
      mock.onGet(`${ BASE }/posts/list.json`).reply(ok([]))

      await service.listPosts('myforum', 'Highlighted', 15, 'c9')

      expect(mock.history[0].query).toMatchObject({
        forum: 'myforum',
        include: 'highlighted',
        limit: 15,
        cursor: 'c9',
      })
    })
  })

  describe('createPost', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/posts/create.json`).reply(ok({ id: '3000010' }))

      const result = await service.createPost('55555', 'Hello there')

      expect(result).toEqual({ id: '3000010' })
      expect(mock.history[0].body).toEqual({ thread: '55555', message: 'Hello there' })
    })

    it('includes all optional params and maps the state choice', async () => {
      mock.onPost(`${ BASE }/posts/create.json`).reply(ok({ id: '3000011' }))

      await service.createPost(
        '55555',
        'Reply body',
        '3000001',
        'Anon Name',
        'anon@example.com',
        'Approved'
      )

      expect(mock.history[0].body).toEqual({
        thread: '55555',
        message: 'Reply body',
        parent: '3000001',
        author_name: 'Anon Name',
        author_email: 'anon@example.com',
        state: 'approved',
      })
    })

    it('omits state when not provided', async () => {
      mock.onPost(`${ BASE }/posts/create.json`).reply(ok({ id: '3000012' }))

      await service.createPost('55555', 'No state')

      expect(mock.history[0].body).not.toHaveProperty('state')
    })
  })

  describe('approvePost', () => {
    it('sends POST with post id in body', async () => {
      mock.onPost(`${ BASE }/posts/approve.json`).reply(ok([{ id: '3000002' }]))

      const result = await service.approvePost('3000002')

      expect(result).toEqual([{ id: '3000002' }])
      expect(mock.history[0].body).toEqual({ post: '3000002' })
    })
  })

  describe('removePost', () => {
    it('sends POST with post id in body', async () => {
      mock.onPost(`${ BASE }/posts/remove.json`).reply(ok([{ id: '3000002' }]))

      const result = await service.removePost('3000002')

      expect(result).toEqual([{ id: '3000002' }])
      expect(mock.history[0].body).toEqual({ post: '3000002' })
    })
  })

  describe('markPostAsSpam', () => {
    it('sends POST with post id in body', async () => {
      mock.onPost(`${ BASE }/posts/spam.json`).reply(ok([{ id: '3000002' }]))

      const result = await service.markPostAsSpam('3000002')

      expect(result).toEqual([{ id: '3000002' }])
      expect(mock.history[0].body).toEqual({ post: '3000002' })
    })
  })

  describe('highlightPost', () => {
    it('sends POST with post id in body', async () => {
      mock.onPost(`${ BASE }/posts/highlight.json`).reply(ok({ id: '3000002', isHighlighted: true }))

      const result = await service.highlightPost('3000002')

      expect(result).toEqual({ id: '3000002', isHighlighted: true })
      expect(mock.history[0].body).toEqual({ post: '3000002' })
    })
  })

  // ── Users ──

  describe('getUserDetails', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/users/details.json`).reply(ok({ id: '12345', username: 'jane' }))

      const result = await service.getUserDetails('12345')

      expect(result).toEqual({ id: '12345', username: 'jane' })
      expect(mock.history[0].query).toMatchObject({ user: '12345' })
    })
  })

  describe('listUserPosts', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${ BASE }/users/listPosts.json`).reply(ok([]))

      await service.listUserPosts('12345')

      expect(mock.history[0].query).toMatchObject({ user: '12345' })
      expect(mock.history[0].query).not.toHaveProperty('limit')
    })

    it('includes limit and cursor when provided', async () => {
      mock.onGet(`${ BASE }/users/listPosts.json`).reply(ok([{ id: '3000001' }]))

      await service.listUserPosts('12345', 10, 'c2')

      expect(mock.history[0].query).toMatchObject({ user: '12345', limit: 10, cursor: 'c2' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/users/listPosts.json`).replyWithError({ message: 'nope', status: 403 })

      await expect(service.listUserPosts('12345')).rejects.toThrow('Disqus API error (403)')
    })
  })
})
