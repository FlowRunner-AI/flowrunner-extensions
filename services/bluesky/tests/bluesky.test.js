'use strict'

const { createSandbox } = require('../../../service-sandbox')

const IDENTIFIER = 'alice.bsky.social'
const APP_PASSWORD = 'abcd-efgh-ijkl-mnop'
const BASE = 'https://bsky.social'
const XRPC = `${ BASE }/xrpc`

const DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
const ACCESS_JWT = 'test-access-jwt'
const HANDLE = 'alice.bsky.social'

const SESSION_URL = `${ XRPC }/com.atproto.server.createSession`

// A canonical session response used to prime authentication.
const SESSION_RESPONSE = { accessJwt: ACCESS_JWT, did: DID, handle: HANDLE }

// Strong-ref returned by getPosts, used by likes/reposts/quotes.
const SUBJECT = {
  uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q',
  cid: 'bafyreih5cmnnk73i6yyvhr2rfsyameozjmck2xir4jqmqvctcuh5emjdiq',
}

const POST_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kencmjqk7k2q'

describe('Bluesky Service', () => {
  let sandbox
  let service
  let mock

  // Registers the createSession handler so authenticated calls succeed.
  function mockSession() {
    mock.onPost(SESSION_URL).reply(SESSION_RESPONSE)
  }

  beforeAll(() => {
    sandbox = createSandbox({
      identifier: IDENTIFIER,
      appPassword: APP_PASSWORD,
      pdsUrl: BASE,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // The service caches the AT Protocol session on the shared instance;
    // clear it so each test controls its own auth flow deterministically.
    delete service._session
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'identifier',
          displayName: 'Identifier',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'appPassword',
          displayName: 'App Password',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'pdsUrl',
          displayName: 'PDS URL',
          required: true,
          shared: false,
          type: 'STRING',
          defaultValue: 'https://bsky.social',
        }),
      ])
    })
  })

  // ── Session & Auth ──

  describe('session handling', () => {
    it('creates a session with identifier + appPassword before authenticated calls', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [] })

      await service.getTimeline()

      const sessionCall = mock.history[0]

      expect(sessionCall.method).toBe('post')
      expect(sessionCall.url).toBe(SESSION_URL)
      expect(sessionCall.body).toEqual({ identifier: IDENTIFIER, password: APP_PASSWORD })
    })

    it('threads the bearer accessJwt into subsequent XRPC requests', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [] })

      await service.getTimeline()

      expect(mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_JWT }`,
        'Content-Type': 'application/json',
      })
    })

    it('caches the session so only one createSession call is made per invocation', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [] })
      mock.onGet(`${ XRPC }/app.bsky.notification.listNotifications`).reply({ notifications: [] })

      await service.getTimeline()
      await service.listNotifications()

      const sessionCalls = mock.history.filter(c => c.url === SESSION_URL)

      expect(sessionCalls).toHaveLength(1)
    })

    it('throws a sign-in error on 401 from createSession', async () => {
      mock.onPost(SESSION_URL).replyWithError({
        status: 401,
        body: { error: 'AuthenticationRequired', message: 'Invalid identifier or password' },
      })

      await expect(service.getTimeline()).rejects.toThrow('Bluesky sign-in failed')
    })

    it('throws a generic API error on non-auth createSession failures', async () => {
      mock.onPost(SESSION_URL).replyWithError({
        status: 500,
        body: { error: 'InternalServerError', message: 'boom' },
      })

      await expect(service.getTimeline()).rejects.toThrow('Bluesky API error: boom')
    })
  })

  // ── Posting ──

  describe('createPost', () => {
    it('creates a plain text post with required params only', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({
        uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlltlvus2u',
        cid: 'bafyreidfayvfuwqa2qskciwocboesuwsvvi5vgzqxjkcwon5h6trxrxlxq',
      })

      const result = await service.createPost('Hello world')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.method).toBe('post')
      expect(call.body.repo).toBe(DID)
      expect(call.body.collection).toBe('app.bsky.feed.post')
      expect(call.body.record).toMatchObject({
        $type: 'app.bsky.feed.post',
        text: 'Hello world',
      })
      expect(call.body.record).toHaveProperty('createdAt')
      expect(call.body.record).not.toHaveProperty('facets')
      expect(call.body.record).not.toHaveProperty('embed')
      expect(call.body.record).not.toHaveProperty('reply')
      expect(result).toHaveProperty('webUrl', 'https://bsky.app/profile/alice.bsky.social/post/3kenlltlvus2u')
    })

    it('builds a webUrl from handle and record key', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({
        uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3kenlltlvus2u',
        cid: 'bafycid',
      })

      const result = await service.createPost('Hello world')

      expect(result.webUrl).toBe('https://bsky.app/profile/alice.bsky.social/post/3kenlltlvus2u')
    })

    it('attaches an external link card with all card fields', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('See this', undefined, 'https://example.com', 'Title', 'Desc')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.embed).toEqual({
        $type: 'app.bsky.embed.external',
        external: { uri: 'https://example.com', title: 'Title', description: 'Desc' },
      })
    })

    it('defaults the link card title to the url and description to empty', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('See this', undefined, 'https://example.com')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.embed.external).toEqual({
        uri: 'https://example.com',
        title: 'https://example.com',
        description: '',
      })
    })

    it('sets langs when languages are provided', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('Hola', ['es', 'en'])

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.langs).toEqual(['es', 'en'])
    })

    it('detects a link facet in the text', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('Check https://example.com now')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.facets).toHaveLength(1)
      expect(call.body.record.facets[0].features[0]).toEqual({
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://example.com',
      })
    })

    it('detects a hashtag facet in the text', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('Hello #flowrunner')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.facets).toHaveLength(1)
      expect(call.body.record.facets[0].features[0]).toEqual({
        $type: 'app.bsky.richtext.facet#tag',
        tag: 'flowrunner',
      })
    })

    it('resolves a @mention facet to a DID', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/com.atproto.identity.resolveHandle`).reply({ did: DID })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('Hi @bob.bsky.social')

      const resolveCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)

      expect(resolveCall.query).toMatchObject({ handle: 'bob.bsky.social' })

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record.facets[0].features[0]).toEqual({
        $type: 'app.bsky.richtext.facet#mention',
        did: DID,
      })
    })

    it('omits facets when auto-formatting is disabled', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPost('Check https://example.com #tag', undefined, undefined, undefined, undefined, true)

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(call.body.record).not.toHaveProperty('facets')
    })

    it('throws when text is empty', async () => {
      mockSession()

      await expect(service.createPost('   ')).rejects.toThrow('Post text is required.')
    })

    it('throws when text exceeds the grapheme limit', async () => {
      mockSession()

      await expect(service.createPost('a'.repeat(301))).rejects.toThrow('the Bluesky limit is 300')
    })

    it('wraps createRecord API errors', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).replyWithError({
        body: { message: 'Rate limited' },
      })

      await expect(service.createPost('Hello')).rejects.toThrow('Bluesky API error: Rate limited')
    })
  })

  describe('createPostWithImage', () => {
    const IMAGE_URL = 'https://files.example.com/pic.png'

    it('downloads the image, uploads a blob and embeds it', async () => {
      mockSession()
      mock.onGet(IMAGE_URL).reply(Buffer.from('fake-image-bytes'))
      mock.onPost(`${ XRPC }/com.atproto.repo.uploadBlob`).reply({
        blob: { $type: 'blob', ref: { $link: 'bafblob' }, mimeType: 'image/png', size: 16 },
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPostWithImage('Look', IMAGE_URL, 'A picture')

      const downloadCall = mock.history.find(c => c.url === IMAGE_URL)

      expect(downloadCall.encoding).toBeNull()

      const uploadCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.uploadBlob`)

      expect(uploadCall.headers).toMatchObject({ 'Content-Type': 'image/png' })
      expect(Buffer.isBuffer(uploadCall.body)).toBe(true)

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.record.embed).toEqual({
        $type: 'app.bsky.embed.images',
        images: [{ image: { $type: 'blob', ref: { $link: 'bafblob' }, mimeType: 'image/png', size: 16 }, alt: 'A picture' }],
      })
    })

    it('defaults alt text to empty when not provided', async () => {
      mockSession()
      mock.onGet(IMAGE_URL).reply(Buffer.from('img'))
      mock.onPost(`${ XRPC }/com.atproto.repo.uploadBlob`).reply({ blob: { ref: 'r' } })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.createPostWithImage('Look', IMAGE_URL)

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.record.embed.images[0].alt).toBe('')
    })

    it('throws when no file url is provided', async () => {
      await expect(service.createPostWithImage('Look', '')).rejects.toThrow('An image file is required.')
    })

    it('throws when the image exceeds the 1 MB limit', async () => {
      mockSession()
      mock.onGet(IMAGE_URL).reply(Buffer.alloc(1000001))

      await expect(service.createPostWithImage('Look', IMAGE_URL)).rejects.toThrow('at most 1000000 bytes')
    })
  })

  describe('replyToPost', () => {
    it('resolves the thread and posts a reply referencing root and parent', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPostThread`).reply({
        thread: {
          post: {
            uri: POST_URI,
            cid: SUBJECT.cid,
            record: {},
          },
        },
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.replyToPost(POST_URI, 'Nice!')

      const threadCall = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getPostThread`)

      expect(threadCall.query).toMatchObject({ uri: POST_URI, depth: 0, parentHeight: 0 })

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      // With no existing reply on the parent, root === parent
      expect(recordCall.body.record.reply).toEqual({
        root: { uri: POST_URI, cid: SUBJECT.cid },
        parent: { uri: POST_URI, cid: SUBJECT.cid },
      })
    })

    it('preserves the original thread root when the parent is itself a reply', async () => {
      mockSession()
      const rootRef = { uri: 'at://did:plc:root/app.bsky.feed.post/rootkey', cid: 'rootcid' }

      mock.onGet(`${ XRPC }/app.bsky.feed.getPostThread`).reply({
        thread: {
          post: {
            uri: POST_URI,
            cid: SUBJECT.cid,
            record: { reply: { root: rootRef } },
          },
        },
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.replyToPost(POST_URI, 'Nice!')

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.record.reply.root).toEqual({ uri: rootRef.uri, cid: rootRef.cid })
      expect(recordCall.body.record.reply.parent).toEqual({ uri: POST_URI, cid: SUBJECT.cid })
    })

    it('throws when the parent post cannot be found', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPostThread`).reply({ thread: {} })

      await expect(service.replyToPost(POST_URI, 'Nice!')).rejects.toThrow('Parent post not found')
    })
  })

  describe('quotePost', () => {
    it('embeds the quoted post record', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPosts?uris=${ encodeURIComponent(POST_URI) }`).reply({
        posts: [{ uri: SUBJECT.uri, cid: SUBJECT.cid }],
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.post/r', cid: 'c' })

      await service.quotePost(POST_URI, 'Great read')

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.record.embed).toEqual({
        $type: 'app.bsky.embed.record',
        record: { uri: SUBJECT.uri, cid: SUBJECT.cid },
      })
    })

    it('throws when the quoted post is not found', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPosts?uris=${ encodeURIComponent(POST_URI) }`).reply({ posts: [] })

      await expect(service.quotePost(POST_URI, 'Great read')).rejects.toThrow('Post not found')
    })
  })

  describe('repost', () => {
    it('creates a repost record referencing the subject', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPosts?uris=${ encodeURIComponent(POST_URI) }`).reply({
        posts: [{ uri: SUBJECT.uri, cid: SUBJECT.cid }],
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.repost/r', cid: 'c' })

      const result = await service.repost(POST_URI)

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.collection).toBe('app.bsky.feed.repost')
      expect(recordCall.body.record).toMatchObject({
        $type: 'app.bsky.feed.repost',
        subject: { uri: SUBJECT.uri, cid: SUBJECT.cid },
      })
      expect(result.subject).toEqual({ uri: SUBJECT.uri, cid: SUBJECT.cid })
    })
  })

  describe('likePost', () => {
    it('creates a like record referencing the subject', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPosts?uris=${ encodeURIComponent(POST_URI) }`).reply({
        posts: [{ uri: SUBJECT.uri, cid: SUBJECT.cid }],
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.feed.like/r', cid: 'c' })

      const result = await service.likePost(POST_URI)

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.collection).toBe('app.bsky.feed.like')
      expect(recordCall.body.record).toMatchObject({
        $type: 'app.bsky.feed.like',
        subject: { uri: SUBJECT.uri, cid: SUBJECT.cid },
      })
      expect(result.subject).toEqual({ uri: SUBJECT.uri, cid: SUBJECT.cid })
    })
  })

  describe('deletePost', () => {
    it('deletes a post by its record key', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.deleteRecord`).reply({})

      const result = await service.deletePost(POST_URI)

      const deleteCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.deleteRecord`)

      expect(deleteCall.body).toEqual({
        repo: DID,
        collection: 'app.bsky.feed.post',
        rkey: '3kencmjqk7k2q',
      })
      expect(result).toEqual({ success: true, uri: POST_URI })
    })

    it('resolves a bsky.app URL to an at:// URI before deleting', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/com.atproto.identity.resolveHandle`).reply({ did: DID })
      mock.onPost(`${ XRPC }/com.atproto.repo.deleteRecord`).reply({})

      const result = await service.deletePost('https://bsky.app/profile/alice.bsky.social/post/3kabc')

      const resolveCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)

      expect(resolveCall.query).toMatchObject({ handle: 'alice.bsky.social' })

      const deleteCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.deleteRecord`)

      expect(deleteCall.body.rkey).toBe('3kabc')
      expect(result.uri).toBe(`at://${ DID }/app.bsky.feed.post/3kabc`)
    })

    it('throws on an unrecognized post reference', async () => {
      mockSession()

      await expect(service.deletePost('not-a-post')).rejects.toThrow('Unrecognized post reference')
    })
  })

  // ── Feeds & Search ──

  describe('getTimeline', () => {
    it('uses the default limit', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [], cursor: 'c1' })

      const result = await service.getTimeline()

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getTimeline`)

      expect(call.query).toMatchObject({ limit: 50 })
      expect(result).toEqual({ feed: [], cursor: 'c1' })
    })

    it('passes a custom limit and cursor', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [] })

      await service.getTimeline(10, 'cursor-123')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getTimeline`)

      expect(call.query).toMatchObject({ limit: 10, cursor: 'cursor-123' })
    })
  })

  describe('getAuthorFeed', () => {
    it('normalizes the actor and maps the filter choice', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getAuthorFeed`).reply({ feed: [] })

      await service.getAuthorFeed('@bob.bsky.social', 'Posts With Media', 20, 'cur')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getAuthorFeed`)

      expect(call.query).toMatchObject({
        actor: 'bob.bsky.social',
        filter: 'posts_with_media',
        limit: 20,
        cursor: 'cur',
      })
    })

    it('defaults the filter and limit', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getAuthorFeed`).reply({ feed: [] })

      await service.getAuthorFeed('bob.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getAuthorFeed`)

      expect(call.query).toMatchObject({ actor: 'bob.bsky.social', limit: 50 })
      // Unknown/empty filter resolves to undefined and is stripped by clean()
      expect(call.query).not.toHaveProperty('filter')
    })
  })

  describe('getPostThread', () => {
    it('parses the post reference and sends only the uri by default', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPostThread`).reply({ thread: {} })

      await service.getPostThread(POST_URI)

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getPostThread`)

      expect(call.query).toEqual({ uri: POST_URI })
    })

    it('passes depth and parentHeight when provided', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.getPostThread`).reply({ thread: {} })

      await service.getPostThread(POST_URI, 3, 10)

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.getPostThread`)

      expect(call.query).toMatchObject({ uri: POST_URI, depth: 3, parentHeight: 10 })
    })
  })

  describe('getPosts', () => {
    it('builds a repeated uris raw query for multiple posts', async () => {
      mockSession()
      const uri2 = 'at://did:plc:other/app.bsky.feed.post/xyz'
      const rawUrl = `${ XRPC }/app.bsky.feed.getPosts?uris=${ encodeURIComponent(POST_URI) }&uris=${ encodeURIComponent(uri2) }`

      mock.onGet(rawUrl).reply({ posts: [{ uri: POST_URI }, { uri: uri2 }] })

      const result = await service.getPosts([POST_URI, uri2])

      expect(result.posts).toHaveLength(2)
      const call = mock.history.find(c => c.url === rawUrl)

      expect(call).toBeDefined()
    })

    it('throws when no post references are given', async () => {
      await expect(service.getPosts([])).rejects.toThrow('At least one post reference is required.')
    })

    it('throws when more than 25 posts are requested', async () => {
      const many = Array.from({ length: 26 }, (_, i) => `at://x/app.bsky.feed.post/${ i }`)

      await expect(service.getPosts(many)).rejects.toThrow('at most 25 posts per call')
    })
  })

  describe('searchPosts', () => {
    it('sends required query with defaults', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.searchPosts`).reply({ posts: [] })

      await service.searchPosts('flowrunner')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.searchPosts`)

      expect(call.query).toMatchObject({ q: 'flowrunner', limit: 25 })
      expect(call.query).not.toHaveProperty('sort')
    })

    it('maps the sort choice and forwards all filters', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.feed.searchPosts`).reply({ posts: [] })

      await service.searchPosts('flowrunner', 'Top', '2026-07-01', '2026-07-15', '@bob.bsky.social', 'en', 40, 'cur')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.feed.searchPosts`)

      expect(call.query).toMatchObject({
        q: 'flowrunner',
        sort: 'top',
        since: '2026-07-01',
        until: '2026-07-15',
        author: 'bob.bsky.social',
        lang: 'en',
        limit: 40,
        cursor: 'cur',
      })
    })
  })

  // ── Profiles ──

  describe('getProfile', () => {
    it('fetches a profile with a normalized actor', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.actor.getProfile`).reply({ did: DID, handle: HANDLE })

      const result = await service.getProfile('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.actor.getProfile`)

      expect(call.query).toMatchObject({ actor: 'alice.bsky.social' })
      expect(result).toEqual({ did: DID, handle: HANDLE })
    })
  })

  describe('getProfiles', () => {
    it('builds a repeated actors raw query', async () => {
      mockSession()
      const rawUrl = `${ XRPC }/app.bsky.actor.getProfiles?actors=${ encodeURIComponent('alice.bsky.social') }&actors=${ encodeURIComponent('bob.bsky.social') }`

      mock.onGet(rawUrl).reply({ profiles: [{ did: DID }] })

      const result = await service.getProfiles(['@alice.bsky.social', 'bob.bsky.social'])

      expect(result).toHaveProperty('profiles')
      expect(mock.history.find(c => c.url === rawUrl)).toBeDefined()
    })

    it('throws when no actors are provided', async () => {
      await expect(service.getProfiles([])).rejects.toThrow('At least one user')
    })

    it('throws when more than 25 actors are requested', async () => {
      const many = Array.from({ length: 26 }, (_, i) => `user${ i }.bsky.social`)

      await expect(service.getProfiles(many)).rejects.toThrow('at most 25 users per call')
    })
  })

  describe('searchUsers', () => {
    it('sends the query with defaults', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.actor.searchActors`).reply({ actors: [] })

      await service.searchUsers('alice')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.actor.searchActors`)

      expect(call.query).toMatchObject({ q: 'alice', limit: 25 })
    })

    it('passes a custom limit and cursor', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.actor.searchActors`).reply({ actors: [] })

      await service.searchUsers('alice', 50, 'cur')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.actor.searchActors`)

      expect(call.query).toMatchObject({ q: 'alice', limit: 50, cursor: 'cur' })
    })
  })

  // ── Social Graph ──

  describe('followUser', () => {
    it('resolves the handle and creates a follow record', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/com.atproto.identity.resolveHandle`).reply({ did: DID })
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.graph.follow/r', cid: 'c' })

      const result = await service.followUser('@alice.bsky.social')

      const resolveCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)

      expect(resolveCall.query).toMatchObject({ handle: 'alice.bsky.social' })

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.collection).toBe('app.bsky.graph.follow')
      expect(recordCall.body.record).toMatchObject({ $type: 'app.bsky.graph.follow', subject: DID })
      expect(result.subject).toBe(DID)
    })

    it('passes a DID straight through without resolving', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/com.atproto.repo.createRecord`).reply({ uri: 'at://x/app.bsky.graph.follow/r', cid: 'c' })

      await service.followUser(DID)

      expect(mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)).toBeUndefined()

      const recordCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.createRecord`)

      expect(recordCall.body.record.subject).toBe(DID)
    })
  })

  describe('unfollowUser', () => {
    it('looks up the follow record and deletes it', async () => {
      mockSession()
      const followUri = 'at://did:plc:me/app.bsky.graph.follow/followkey'

      mock.onGet(`${ XRPC }/app.bsky.actor.getProfile`).reply({
        did: DID,
        handle: HANDLE,
        viewer: { following: followUri },
      })
      mock.onPost(`${ XRPC }/com.atproto.repo.deleteRecord`).reply({})

      const result = await service.unfollowUser('@alice.bsky.social')

      const deleteCall = mock.history.find(c => c.url === `${ XRPC }/com.atproto.repo.deleteRecord`)

      expect(deleteCall.body).toEqual({
        repo: DID,
        collection: 'app.bsky.graph.follow',
        rkey: 'followkey',
      })
      expect(result).toEqual({ success: true, unfollowed: DID, handle: HANDLE })
    })

    it('throws when the account is not following the user', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.actor.getProfile`).reply({ did: DID, handle: HANDLE, viewer: {} })

      await expect(service.unfollowUser('alice.bsky.social')).rejects.toThrow('is not following')
    })
  })

  describe('getFollowers', () => {
    it('sends the actor and default limit', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.graph.getFollowers`).reply({ followers: [] })

      await service.getFollowers('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.graph.getFollowers`)

      expect(call.query).toMatchObject({ actor: 'alice.bsky.social', limit: 50 })
    })

    it('passes a custom limit and cursor', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.graph.getFollowers`).reply({ followers: [] })

      await service.getFollowers('alice.bsky.social', 10, 'cur')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.graph.getFollowers`)

      expect(call.query).toMatchObject({ limit: 10, cursor: 'cur' })
    })
  })

  describe('getFollows', () => {
    it('sends the actor and default limit', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.graph.getFollows`).reply({ follows: [] })

      await service.getFollows('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.graph.getFollows`)

      expect(call.query).toMatchObject({ actor: 'alice.bsky.social', limit: 50 })
    })
  })

  describe('muteUser', () => {
    it('posts the normalized actor and reports muted', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/app.bsky.graph.muteActor`).reply({})

      const result = await service.muteUser('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.graph.muteActor`)

      expect(call.body).toEqual({ actor: 'alice.bsky.social' })
      expect(result).toEqual({ success: true, actor: 'alice.bsky.social', muted: true })
    })
  })

  describe('unmuteUser', () => {
    it('posts the normalized actor and reports unmuted', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/app.bsky.graph.unmuteActor`).reply({})

      const result = await service.unmuteUser('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.graph.unmuteActor`)

      expect(call.body).toEqual({ actor: 'alice.bsky.social' })
      expect(result).toEqual({ success: true, actor: 'alice.bsky.social', muted: false })
    })
  })

  // ── Notifications ──

  describe('listNotifications', () => {
    it('sends the default limit', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.notification.listNotifications`).reply({ notifications: [] })

      await service.listNotifications()

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.notification.listNotifications`)

      expect(call.query).toMatchObject({ limit: 50 })
    })

    it('passes a custom limit and cursor', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/app.bsky.notification.listNotifications`).reply({ notifications: [] })

      await service.listNotifications(20, 'cur')

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.notification.listNotifications`)

      expect(call.query).toMatchObject({ limit: 20, cursor: 'cur' })
    })
  })

  describe('markNotificationsSeen', () => {
    it('posts a seenAt timestamp and returns it', async () => {
      mockSession()
      mock.onPost(`${ XRPC }/app.bsky.notification.updateSeen`).reply({})

      const result = await service.markNotificationsSeen()

      const call = mock.history.find(c => c.url === `${ XRPC }/app.bsky.notification.updateSeen`)

      expect(call.body).toHaveProperty('seenAt')
      expect(result).toMatchObject({ success: true })
      expect(result.seenAt).toBe(call.body.seenAt)
    })
  })

  // ── Identity ──

  describe('resolveHandle', () => {
    it('resolves a handle to its DID', async () => {
      mockSession()
      mock.onGet(`${ XRPC }/com.atproto.identity.resolveHandle`).reply({ did: DID })

      const result = await service.resolveHandle('@alice.bsky.social')

      const call = mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)

      expect(call.query).toMatchObject({ handle: 'alice.bsky.social' })
      expect(result).toEqual({ did: DID, handle: 'alice.bsky.social' })
    })

    it('returns a DID unchanged without calling resolveHandle', async () => {
      mockSession()

      const result = await service.resolveHandle(DID)

      expect(mock.history.find(c => c.url === `${ XRPC }/com.atproto.identity.resolveHandle`)).toBeUndefined()
      expect(result).toEqual({ did: DID, handle: DID })
    })

    it('throws when the handle is empty', async () => {
      mockSession()

      await expect(service.resolveHandle('   ')).rejects.toThrow('An actor (handle or DID) is required.')
    })
  })

  // ── PDS URL handling ──

  describe('pdsUrl configuration', () => {
    it('uses the default bsky.social PDS when no pdsUrl is configured', async () => {
      const s2 = createSandbox({ identifier: IDENTIFIER, appPassword: APP_PASSWORD })

      jest.isolateModules(() => {
        require('../src/index.js')
      })

      const svc = s2.getService()
      const m2 = s2.getRequestMock()

      m2.onPost(`${ XRPC }/com.atproto.server.createSession`).reply(SESSION_RESPONSE)
      m2.onGet(`${ XRPC }/app.bsky.feed.getTimeline`).reply({ feed: [] })

      await svc.getTimeline()

      expect(m2.history[0].url).toBe(`${ XRPC }/com.atproto.server.createSession`)

      s2.cleanup()
    })

    it('strips trailing slashes from a custom pdsUrl', async () => {
      const s3 = createSandbox({
        identifier: IDENTIFIER,
        appPassword: APP_PASSWORD,
        pdsUrl: 'https://pds.example.com///',
      })

      jest.isolateModules(() => {
        require('../src/index.js')
      })

      const svc = s3.getService()
      const m3 = s3.getRequestMock()

      m3.onPost('https://pds.example.com/xrpc/com.atproto.server.createSession').reply(SESSION_RESPONSE)
      m3.onGet('https://pds.example.com/xrpc/app.bsky.feed.getTimeline').reply({ feed: [] })

      await svc.getTimeline()

      expect(m3.history[0].url).toBe('https://pds.example.com/xrpc/com.atproto.server.createSession')

      s3.cleanup()
    })
  })
})
