'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Discourse Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('discourse')
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

  // ── Topics & Posts (read-only shape) ──

  describe('listLatestTopics', () => {
    it('returns a topic_list with an array of topics', async () => {
      const response = await service.listLatestTopics()

      expect(response).toHaveProperty('topic_list')
      expect(Array.isArray(response.topic_list.topics)).toBe(true)
    })
  })

  describe('listTopTopics', () => {
    it('returns a topic_list for the monthly period', async () => {
      const response = await service.listTopTopics('Monthly')

      expect(response).toHaveProperty('topic_list')
      expect(Array.isArray(response.topic_list.topics)).toBe(true)
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('returns a category_list with an array of categories', async () => {
      const response = await service.listCategories()

      expect(response).toHaveProperty('category_list')
      expect(Array.isArray(response.category_list.categories)).toBe(true)
    })
  })

  describe('getCategoriesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCategoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getCategoryTopics', () => {
    // Requires a real category slug + id. Derive one from getCategoriesDictionary
    // + listCategories, or fall back to testValues.categorySlug / categoryId.
    it('returns a topic_list scoped to a category', async () => {
      let slug = testValues.categorySlug
      let categoryId = testValues.categoryId

      if (!slug || !categoryId) {
        const cats = await service.listCategories()
        const first = cats?.category_list?.categories?.[0]

        if (!first) {
          console.log('Skipping getCategoryTopics: no categories on the forum')
          return
        }

        slug = first.slug
        categoryId = first.id
      }

      const response = await service.getCategoryTopics(slug, categoryId)

      expect(response).toHaveProperty('topic_list')
      expect(Array.isArray(response.topic_list.topics)).toBe(true)
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns a tags array', async () => {
      const response = await service.listTags()

      expect(response).toHaveProperty('tags')
      expect(Array.isArray(response.tags)).toBe(true)
    })
  })

  // ── Search ──

  describe('search', () => {
    it('returns a grouped_search_result', async () => {
      const response = await service.search('welcome')

      expect(response).toHaveProperty('grouped_search_result')
    })
  })

  // ── Topic + Post lifecycle (self-cleaning) ──

  describe('createTopic + getTopic + createPost + getPost + updatePost + deletePost + deleteTopic', () => {
    let topicId
    let firstPostId
    let replyPostId

    it('creates a topic', async () => {
      const response = await service.createTopic(
        `E2E Topic ${ suffix }`,
        `This is an automated e2e test topic created at ${ new Date().toISOString() }. It has enough body text to satisfy the minimum post length requirement.`,
        testValues.categoryId
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('topic_id')
      topicId = response.topic_id
      firstPostId = response.id
    })

    it('retrieves the created topic', async () => {
      const response = await service.getTopic(topicId)

      expect(response).toHaveProperty('id', topicId)
      expect(response).toHaveProperty('post_stream')
    })

    it('retrieves the first post', async () => {
      const response = await service.getPost(firstPostId)

      expect(response).toHaveProperty('id', firstPostId)
      expect(response).toHaveProperty('topic_id', topicId)
    })

    it('creates a reply post', async () => {
      const response = await service.createPost(
        topicId,
        `This is an automated e2e reply created at ${ new Date().toISOString() }, long enough to pass validation.`
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('post_number')
      replyPostId = response.id
    })

    it('updates the reply post', async () => {
      const response = await service.updatePost(
        replyPostId,
        `This automated e2e reply was edited at ${ new Date().toISOString() }, still long enough to pass validation.`,
        'e2e edit'
      )

      expect(response).toHaveProperty('post')
      expect(response.post).toHaveProperty('id', replyPostId)
    })

    it('deletes the reply post', async () => {
      const response = await service.deletePost(replyPostId)

      expect(response).toBeDefined()
    })

    it('deletes the topic', async () => {
      const response = await service.deleteTopic(topicId)

      expect(response).toBeDefined()
    })

    afterAll(async () => {
      // Best-effort cleanup in case an assertion failed mid-lifecycle.
      if (topicId) {
        try {
          await service.deleteTopic(topicId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Users ──

  describe('getUser', () => {
    // Uses testValues.username, falling back to the API username (apiUsername config).
    it('returns a user profile with an id', async () => {
      const username = testValues.username || 'system'

      const response = await service.getUser(username)

      expect(response).toHaveProperty('user')
      expect(response.user).toHaveProperty('id')
    })
  })

  describe('listUserActions', () => {
    it('returns a user_actions array', async () => {
      const username = testValues.username || 'system'

      const response = await service.listUserActions(username)

      expect(response).toHaveProperty('user_actions')
      expect(Array.isArray(response.user_actions)).toBe(true)
    })
  })

  describe('getUserByExternalId', () => {
    // Only runs when the developer supplies an external_id (requires SSO / DiscourseConnect).
    it('returns a user profile for a configured external id', async () => {
      if (!testValues.externalId) {
        console.log('Skipping getUserByExternalId: set testValues.externalId (requires SSO/DiscourseConnect)')
        return
      }

      const response = await service.getUserByExternalId(testValues.externalId)

      expect(response).toHaveProperty('user')
      expect(response.user).toHaveProperty('id')
    })
  })

  // ── Private Messages ──

  describe('sendPrivateMessage', () => {
    // Sends a real PM, so it only runs when a recipient username is configured.
    it('sends a private message to a configured recipient', async () => {
      if (!testValues.pmRecipient) {
        console.log('Skipping sendPrivateMessage: set testValues.pmRecipient to a valid username')
        return
      }

      const response = await service.sendPrivateMessage(
        `E2E PM ${ suffix }`,
        `Automated e2e private message sent at ${ new Date().toISOString() }, long enough to pass validation.`,
        [testValues.pmRecipient]
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('topic_id')

      // Best-effort cleanup: remove the PM topic we just created.
      if (response.topic_id) {
        try {
          await service.deleteTopic(response.topic_id)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Users (destructive / admin — opt-in only) ──

  describe('createUser', () => {
    // Creating a user is hard to undo via the public API, so this only runs when
    // the developer explicitly opts in via testValues.allowUserCreation.
    it('creates a user when opted in', async () => {
      if (!testValues.allowUserCreation) {
        console.log('Skipping createUser: set testValues.allowUserCreation=true to run (creates a real account)')
        return
      }

      const response = await service.createUser(
        `E2E User ${ suffix }`,
        `e2e-user-${ suffix }@example.com`,
        `e2e_user_${ suffix }`,
        `E2ePassw0rd-${ suffix }`,
        true,
        true
      )

      expect(response).toHaveProperty('success')
    })
  })

  describe('suspendUser', () => {
    // Suspending a user is a destructive admin action, so it only runs when the
    // developer supplies a safe, disposable user id via testValues.suspendUserId.
    it('suspends a configured user', async () => {
      if (!testValues.suspendUserId) {
        console.log('Skipping suspendUser: set testValues.suspendUserId to a disposable numeric user id')
        return
      }

      const response = await service.suspendUser(
        testValues.suspendUserId,
        '2026-12-31T00:00:00Z',
        `E2E suspension ${ suffix }`
      )

      expect(response).toHaveProperty('suspension')
    })
  })
})
