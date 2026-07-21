'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Facebook Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('facebook')
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

  // ── Pages ──

  describe('listMyPages', () => {
    it('returns pages with expected shape', async () => {
      const result = await service.listMyPages(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('id')
        expect(result.data[0]).toHaveProperty('name')
        expect(result.data[0]).toHaveProperty('access_token')
      }
    })
  })

  describe('getPage', () => {
    it('returns page details', async () => {
      const pageId = testValues.pageId

      if (!pageId) {
        console.log('Skipping getPage: no pageId in testValues')
        return
      }

      const result = await service.getPage(pageId)

      expect(result).toHaveProperty('id', pageId)
      expect(result).toHaveProperty('name')
    })
  })

  // ── Posts lifecycle ──

  describe('post lifecycle (create, get, list, update, delete)', () => {
    let createdPostId

    it('creates a page post', async () => {
      const pageId = testValues.pageId
      const pageAccessToken = testValues.pageAccessToken

      if (!pageId) {
        console.log('Skipping createPagePost: no pageId in testValues')
        return
      }

      const result = await service.createPagePost(
        pageId,
        `FlowRunner e2e test post - ${new Date().toISOString()}`,
        undefined,
        undefined,
        undefined,
        pageAccessToken,
      )

      expect(result).toHaveProperty('id')
      createdPostId = result.id
    })

    it('gets the created post', async () => {
      if (!createdPostId) {
        console.log('Skipping getPost: no post was created')
        return
      }

      const result = await service.getPost(createdPostId, undefined, testValues.pageAccessToken)

      expect(result).toHaveProperty('id', createdPostId)
      expect(result).toHaveProperty('message')
    })

    it('lists page posts', async () => {
      const pageId = testValues.pageId

      if (!pageId) {
        console.log('Skipping listPagePosts: no pageId in testValues')
        return
      }

      const result = await service.listPagePosts(pageId, 5, undefined, undefined, testValues.pageAccessToken)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('updates the created post', async () => {
      if (!createdPostId) {
        console.log('Skipping updatePost: no post was created')
        return
      }

      const result = await service.updatePost(
        createdPostId,
        `FlowRunner e2e UPDATED - ${new Date().toISOString()}`,
        testValues.pageAccessToken,
      )

      expect(result).toHaveProperty('success', true)
    })

    it('deletes the created post', async () => {
      if (!createdPostId) {
        console.log('Skipping deletePost: no post was created')
        return
      }

      const result = await service.deletePost(createdPostId, testValues.pageAccessToken)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Comments lifecycle ──

  describe('comment lifecycle (create, list, delete)', () => {
    let testPostId
    let createdCommentId

    beforeAll(async () => {
      const pageId = testValues.pageId
      const pageAccessToken = testValues.pageAccessToken

      if (!pageId) {
        return
      }

      // Create a temporary post for comment testing
      const post = await service.createPagePost(
        pageId,
        `FlowRunner e2e comment test - ${new Date().toISOString()}`,
        undefined,
        undefined,
        undefined,
        pageAccessToken,
      )

      testPostId = post.id
    })

    afterAll(async () => {
      if (testPostId) {
        await service.deletePost(testPostId, testValues.pageAccessToken).catch(() => {})
      }
    })

    it('creates a comment on the post', async () => {
      if (!testPostId) {
        console.log('Skipping createComment: no test post was created')
        return
      }

      const result = await service.createComment(testPostId, 'E2E test comment', testValues.pageAccessToken)

      expect(result).toHaveProperty('id')
      createdCommentId = result.id
    })

    it('lists comments on the post', async () => {
      if (!testPostId) {
        console.log('Skipping getComments: no test post was created')
        return
      }

      const result = await service.getComments(testPostId, 'Chronological', 10, undefined, testValues.pageAccessToken)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the created comment', async () => {
      if (!createdCommentId) {
        console.log('Skipping deleteComment: no comment was created')
        return
      }

      const result = await service.deleteComment(createdCommentId, testValues.pageAccessToken)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Upload Photo (URL-based) ──

  describe('uploadPhoto (URL-based)', () => {
    let photoPostId

    it('uploads a photo from a public URL', async () => {
      const pageId = testValues.pageId
      const imageUrl = testValues.testImageUrl

      if (!pageId || !imageUrl) {
        console.log('Skipping uploadPhoto: no pageId or testImageUrl in testValues')
        return
      }

      const result = await service.uploadPhoto(
        pageId,
        imageUrl,
        undefined,
        `FlowRunner e2e photo test - ${new Date().toISOString()}`,
        undefined,
        testValues.pageAccessToken,
      )

      expect(result).toHaveProperty('id')

      if (result.post_id) {
        photoPostId = result.post_id
      }
    })

    afterAll(async () => {
      if (photoPostId) {
        await service.deletePost(photoPostId, testValues.pageAccessToken).catch(() => {})
      }
    })
  })

  // ── Like ──

  describe('likeObject', () => {
    it('likes a post', async () => {
      const objectId = testValues.testObjectIdForLike

      if (!objectId) {
        console.log('Skipping likeObject: no testObjectIdForLike in testValues')
        return
      }

      const result = await service.likeObject(objectId, testValues.pageAccessToken)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Dictionary ──

  describe('getPagesDictionary', () => {
    it('returns dictionary items in expected shape', async () => {
      const result = await service.getPagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Get Object (generic) ──

  describe('getObject', () => {
    it('fetches a page object by id', async () => {
      const pageId = testValues.pageId

      if (!pageId) {
        console.log('Skipping getObject: no pageId in testValues')
        return
      }

      const result = await service.getObject(pageId, 'id,name', testValues.pageAccessToken)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })
})
