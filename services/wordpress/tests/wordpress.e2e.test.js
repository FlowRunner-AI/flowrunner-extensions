'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('WordPress Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('wordpress')
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

  // ── Connection ──

  describe('getCurrentUser', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('slug')
    })
  })

  // ── Post lifecycle ──

  describe('post lifecycle', () => {
    let postId
    let commentId

    it('creates a draft post', async () => {
      const result = await service.createPost(
        `FlowRunner E2E Post ${ SUFFIX }`,
        '<p>Created by e2e tests.</p>',
        'Draft',
        `flowrunner-e2e-${ SUFFIX }`,
        'E2E excerpt'
      )

      expect(result).toHaveProperty('id')
      postId = result.id
    })

    it('gets the created post', async () => {
      const result = await service.getPost(postId)

      expect(result).toHaveProperty('id', postId)
    })

    it('lists posts', async () => {
      const result = await service.listPosts('Draft', undefined, 1, 5, 'Date', 'Descending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates and publishes the post', async () => {
      const result = await service.updatePost(postId, `FlowRunner E2E Post ${ SUFFIX } (updated)`, undefined, 'Published')

      expect(result).toHaveProperty('id', postId)
      expect(result).toHaveProperty('status', 'publish')
    })

    it('reads the post meta', async () => {
      const result = await service.getPostMeta('post', postId)

      expect(typeof result).toBe('object')
    })

    it('finds the post through site search', async () => {
      const result = await service.searchSite(`FlowRunner E2E Post ${ SUFFIX }`, 'Post', undefined, 1, 10)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a comment on the post', async () => {
      const result = await service.createComment(
        postId,
        'E2E comment',
        undefined,
        'FlowRunner Tester',
        `fr-e2e-${ SUFFIX }@example.com`,
        undefined,
        undefined,
        'Approved'
      )

      expect(result).toHaveProperty('id')
      commentId = result.id
    })

    it('gets the comment', async () => {
      const result = await service.getComment(commentId)

      expect(result).toHaveProperty('id', commentId)
    })

    it('lists comments for the post', async () => {
      const result = await service.listComments(postId, undefined, undefined, undefined, 1, 10, 'Date', 'Descending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the comment', async () => {
      const result = await service.updateComment(commentId, 'E2E comment (edited)')

      expect(result).toHaveProperty('id', commentId)
    })

    it('deletes the comment', async () => {
      await expect(service.deleteComment(commentId, true)).resolves.toBeDefined()
    })

    it('deletes the post', async () => {
      await expect(service.deletePost(postId, true)).resolves.toBeDefined()
    })
  })

  // ── Page lifecycle ──

  describe('page lifecycle', () => {
    let pageId

    it('creates a draft page', async () => {
      const result = await service.createPage(
        `FlowRunner E2E Page ${ SUFFIX }`,
        '<p>Created by e2e tests.</p>',
        'Draft',
        `flowrunner-e2e-page-${ SUFFIX }`
      )

      expect(result).toHaveProperty('id')
      pageId = result.id
    })

    it('gets the page', async () => {
      const result = await service.getPage(pageId)

      expect(result).toHaveProperty('id', pageId)
    })

    it('lists pages', async () => {
      const result = await service.listPages('Draft', undefined, undefined, 1, 5, 'Date', 'Descending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the page', async () => {
      const result = await service.updatePage(pageId, `FlowRunner E2E Page ${ SUFFIX } (updated)`)

      expect(result).toHaveProperty('id', pageId)
    })

    it('deletes the page', async () => {
      await expect(service.deletePage(pageId, true)).resolves.toBeDefined()
    })
  })

  // ── Category lifecycle ──

  describe('category lifecycle', () => {
    let categoryId

    it('creates a category', async () => {
      const result = await service.createCategory(`FR E2E Cat ${ SUFFIX }`, `fr-e2e-cat-${ SUFFIX }`, 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      categoryId = result.id
    })

    it('gets the category', async () => {
      const result = await service.getCategory(categoryId)

      expect(result).toHaveProperty('id', categoryId)
    })

    it('lists categories', async () => {
      const result = await service.listCategories(`FR E2E Cat ${ SUFFIX }`, undefined, false, 1, 10, 'Name', 'Ascending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the category', async () => {
      const result = await service.updateCategory(categoryId, `FR E2E Cat ${ SUFFIX } upd`)

      expect(result).toHaveProperty('id', categoryId)
    })

    it('lists categories through the dictionary', async () => {
      const result = await service.getCategoriesDictionary({ search: 'FR E2E Cat' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the category', async () => {
      await expect(service.deleteCategory(categoryId)).resolves.toBeDefined()
    })
  })

  // ── Tag lifecycle ──

  describe('tag lifecycle', () => {
    let tagId

    it('creates a tag', async () => {
      const result = await service.createTag(`FR E2E Tag ${ SUFFIX }`, `fr-e2e-tag-${ SUFFIX }`, 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      tagId = result.id
    })

    it('gets the tag', async () => {
      const result = await service.getTag(tagId)

      expect(result).toHaveProperty('id', tagId)
    })

    it('lists tags', async () => {
      const result = await service.listTags(`FR E2E Tag ${ SUFFIX }`, false, 1, 10, 'Name', 'Ascending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the tag', async () => {
      const result = await service.updateTag(tagId, `FR E2E Tag ${ SUFFIX } upd`)

      expect(result).toHaveProperty('id', tagId)
    })

    it('lists tags through the dictionary', async () => {
      const result = await service.getTagsDictionary({ search: 'FR E2E Tag' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the tag', async () => {
      await expect(service.deleteTag(tagId)).resolves.toBeDefined()
    })
  })

  // ── Users ──

  describe('users', () => {
    it('lists users', async () => {
      const result = await service.listUsers(undefined, undefined, undefined, 1, 10, 'ID', 'Ascending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets a user by id', async () => {
      const me = await service.getCurrentUser()
      const result = await service.getUser(me.id)

      expect(result).toHaveProperty('id', me.id)
    })

    it('lists authors through the dictionary', async () => {
      const result = await service.getAuthorsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('rejects a delete without a reassignment target', async () => {
      await expect(service.deleteUser(1)).rejects.toThrow('Reassign-To User ID is required')
    })
  })

  // ── Media ──

  describe('media', () => {
    it('lists media', async () => {
      const result = await service.listMedia(undefined, undefined, undefined, undefined, 1, 5, 'Date', 'Descending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('uploads, updates, and deletes a media item from a URL', async () => {
      const { mediaSourceUrl } = testValues

      if (!mediaSourceUrl) {
        console.log('Skipping media upload: testValues.mediaSourceUrl not set')

        return
      }

      const uploaded = await service.uploadMediaFromUrl(mediaSourceUrl, undefined, `FR E2E Media ${ SUFFIX }`, 'Alt text')

      expect(uploaded).toHaveProperty('id')

      const fetched = await service.getMedia(uploaded.id)

      expect(fetched).toHaveProperty('id', uploaded.id)

      const updated = await service.updateMedia(uploaded.id, `FR E2E Media ${ SUFFIX } upd`, 'New alt')

      expect(updated).toHaveProperty('id', uploaded.id)

      await expect(service.deleteMedia(uploaded.id)).resolves.toBeDefined()
    })
  })

  // ── Site metadata ──

  describe('site metadata', () => {
    it('reads the site settings', async () => {
      const result = await service.getSettings()

      expect(result).toHaveProperty('title')
    })

    it('lists taxonomies', async () => {
      const result = await service.listTaxonomies()

      expect(typeof result).toBe('object')
    })

    it('lists post types', async () => {
      const result = await service.listPostTypes()

      expect(typeof result).toBe('object')
    })

    it('lists post types through the dictionary', async () => {
      const result = await service.getPostTypesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('lists taxonomies through the dictionary', async () => {
      const result = await service.getTaxonomiesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Custom post types & taxonomies ──

  describe('custom content', () => {
    it('lists custom posts for testValues.customPostRestBase', async () => {
      const { customPostRestBase } = testValues

      if (!customPostRestBase) {
        console.log('Skipping listCustomPosts: testValues.customPostRestBase not set')

        return
      }

      const result = await service.listCustomPosts(customPostRestBase, undefined, undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists custom taxonomy terms for testValues.customTaxonomyRestBase', async () => {
      const { customTaxonomyRestBase } = testValues

      if (!customTaxonomyRestBase) {
        console.log('Skipping listTaxonomyTerms: testValues.customTaxonomyRestBase not set')

        return
      }

      const result = await service.listTaxonomyTerms(customTaxonomyRestBase, undefined, undefined, false, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Polling triggers ──

  describe('polling triggers', () => {
    it('returns a sample published post in learning mode', async () => {
      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewPublishedPost',
        learningMode: true,
        triggerData: {},
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
      expect(Array.isArray(result.events)).toBe(true)
    })

    it('seeds the published-post watermark without replaying the backlog', async () => {
      const result = await service.onNewPublishedPost({ triggerData: {} })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('lastSeenId')
    })

    it('returns a sample comment in learning mode', async () => {
      const result = await service.onNewComment({ learningMode: true, triggerData: {} })

      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toHaveProperty('lastSeenId')
    })

    it('seeds the comment watermark without replaying the backlog', async () => {
      const result = await service.onNewComment({ triggerData: {} })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('lastSeenId')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('surfaces a not-found hint for an unknown post', async () => {
      await expect(service.getPost(99999999)).rejects.toThrow(/not found/i)
    })
  })
})
