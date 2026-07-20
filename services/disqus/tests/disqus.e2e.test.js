'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Disqus Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('disqus')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Forums ──

  describe('getForumDetails', () => {
    it('returns forum details with expected shape', async () => {
      const response = await service.getForumDetails(testValues.forum)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name')
    })
  })

  describe('listForumCategories', () => {
    it('returns an array of categories', async () => {
      const response = await service.listForumCategories(testValues.forum, 25)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('listForumThreads', () => {
    it('returns an array of threads', async () => {
      const response = await service.listForumThreads(testValues.forum, 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('listForumPosts', () => {
    it('returns an array of posts (approved)', async () => {
      const response = await service.listForumPosts(testValues.forum, undefined, 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Posts ──

  describe('listPosts', () => {
    it('returns an array of posts for the forum', async () => {
      const response = await service.listPosts(testValues.forum, undefined, 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Threads ──

  describe('getThreadDetails', () => {
    // Requires a real thread id (or forum + link) supplied by the developer.
    const canRun = () => Boolean(testValues.thread || testValues.threadLink)

    it('returns thread details when a thread id or link is configured', async () => {
      if (!canRun()) {
        console.log('Skipping getThreadDetails: set testValues.thread or testValues.threadLink')
        return
      }

      const response = testValues.thread
        ? await service.getThreadDetails(testValues.thread)
        : await service.getThreadDetails(undefined, testValues.forum, testValues.threadLink)

      expect(response).toHaveProperty('id')
    })
  })

  describe('listThreadPosts', () => {
    const canRun = () => Boolean(testValues.thread)

    it('returns an array of posts for a thread when a thread id is configured', async () => {
      if (!canRun()) {
        console.log('Skipping listThreadPosts: set testValues.thread')
        return
      }

      const response = await service.listThreadPosts(testValues.thread, undefined, 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Users ──

  describe('getUserDetails', () => {
    const canRun = () => Boolean(testValues.user)

    it('returns user details when a user id is configured', async () => {
      if (!canRun()) {
        console.log('Skipping getUserDetails: set testValues.user')
        return
      }

      const response = await service.getUserDetails(testValues.user)

      expect(response).toHaveProperty('id')
    })
  })

  describe('listUserPosts', () => {
    const canRun = () => Boolean(testValues.user)

    it('returns an array of posts for the user when a user id is configured', async () => {
      if (!canRun()) {
        console.log('Skipping listUserPosts: set testValues.user')
        return
      }

      const response = await service.listUserPosts(testValues.user, 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Write lifecycle: thread + post + moderation ──
  // These mutate real Disqus data and require an access_token with moderation
  // permission on the forum. They only run when testValues.forum is set.

  describe('createThread + createPost + moderation + close/open', () => {
    const canRun = () => Boolean(testValues.forum)

    let threadId
    let postId

    it('creates a thread', async () => {
      if (!canRun()) {
        console.log('Skipping write lifecycle: set testValues.forum (and a moderation access_token)')
        return
      }

      const response = await service.createThread(
        testValues.forum,
        `E2E Thread ${ suffix }`,
        undefined,
        `e2e-thread-${ suffix }`
      )

      expect(response).toHaveProperty('id')
      threadId = response.id
    })

    it('creates a post on the thread', async () => {
      if (!canRun() || !threadId) {
        console.log('Skipping createPost: thread was not created')
        return
      }

      const response = await service.createPost(
        threadId,
        `E2E comment ${ suffix }`,
        undefined,
        'E2E Tester',
        testValues.authorEmail || `e2e-${ suffix }@example.com`
      )

      expect(response).toHaveProperty('id')
      postId = response.id
    })

    it('approves the created post', async () => {
      if (!postId) {
        console.log('Skipping approvePost: post was not created')
        return
      }

      const response = await service.approvePost(postId)

      expect(response).toBeDefined()
    })

    it('highlights the created post', async () => {
      if (!postId) {
        console.log('Skipping highlightPost: post was not created')
        return
      }

      const response = await service.highlightPost(postId)

      expect(response).toBeDefined()
    })

    it('removes the created post (cleanup)', async () => {
      if (!postId) {
        console.log('Skipping removePost: post was not created')
        return
      }

      const response = await service.removePost(postId)

      expect(response).toBeDefined()
    })

    it('closes the created thread', async () => {
      if (!threadId) {
        console.log('Skipping closeThread: thread was not created')
        return
      }

      const response = await service.closeThread(threadId)

      expect(response).toBeDefined()
    })

    it('reopens the created thread', async () => {
      if (!threadId) {
        console.log('Skipping openThread: thread was not created')
        return
      }

      const response = await service.openThread(threadId)

      expect(response).toBeDefined()
    })
  })

  // ── Spam moderation (isolated, own post) ──

  describe('markPostAsSpam', () => {
    const canRun = () => Boolean(testValues.forum)

    let spamThreadId
    let spamPostId

    it('creates a throwaway thread and post, then marks the post as spam', async () => {
      if (!canRun()) {
        console.log('Skipping markPostAsSpam: set testValues.forum (and a moderation access_token)')
        return
      }

      const thread = await service.createThread(
        testValues.forum,
        `E2E Spam Thread ${ suffix }`,
        undefined,
        `e2e-spam-thread-${ suffix }`
      )
      spamThreadId = thread.id

      const post = await service.createPost(
        spamThreadId,
        `E2E spam comment ${ suffix }`,
        undefined,
        'E2E Spammer',
        testValues.authorEmail || `e2e-spam-${ suffix }@example.com`
      )
      spamPostId = post.id

      const response = await service.markPostAsSpam(spamPostId)

      expect(response).toBeDefined()
    })

    afterAll(async () => {
      if (spamPostId) {
        try {
          await service.removePost(spamPostId)
        } catch (e) {
          // ignore cleanup errors
        }
      }

      if (spamThreadId) {
        try {
          await service.closeThread(spamThreadId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })
})
