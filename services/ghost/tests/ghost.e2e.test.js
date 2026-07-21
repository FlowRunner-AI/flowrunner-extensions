'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Ghost Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ghost')
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

  // Unique-ish suffix so repeated e2e runs don't collide on slugs/names.
  const suffix = Date.now()

  // Content API reads require the optional Content API Key. The config is on the
  // sandbox, not testValues, so probe a cheap read once to decide whether to run
  // the Content API suites.
  const hasContentKey = () => Boolean(testValues.hasContentKey)

  // ===========================================================================
  //  POSTS
  // ===========================================================================

  describe('createPost + getPost + getPostBySlug + updatePost + publishPost + deletePost', () => {
    let postId
    let postSlug

    it('creates a draft post', async () => {
      const response = await service.createPost(
        `E2E Post ${ suffix }`,
        '<p>Created by the automated e2e test.</p>'
      )

      expect(response).toHaveProperty('posts')
      expect(Array.isArray(response.posts)).toBe(true)
      expect(response.posts[0]).toHaveProperty('id')
      postId = response.posts[0].id
      postSlug = response.posts[0].slug
      expect(response.posts[0].status).toBe('draft')
    })

    it('retrieves the created post by id', async () => {
      const response = await service.getPost(postId, true)

      expect(response.posts[0]).toHaveProperty('id', postId)
    })

    it('retrieves the created post by slug', async () => {
      const response = await service.getPostBySlug(postSlug)

      expect(response.posts[0]).toHaveProperty('id', postId)
    })

    it('updates the post (auto-fetching updated_at)', async () => {
      const response = await service.updatePost(postId, `E2E Post Updated ${ suffix }`)

      expect(response.posts[0]).toHaveProperty('title', `E2E Post Updated ${ suffix }`)
    })

    it('publishes the post', async () => {
      const response = await service.publishPost(postId)

      expect(response.posts[0]).toHaveProperty('status', 'published')
    })

    it('deletes the post', async () => {
      const response = await service.deletePost(postId)

      expect(response).toEqual({ deleted: true, id: postId })
    })
  })

  describe('listPosts', () => {
    it('returns posts plus pagination metadata', async () => {
      const response = await service.listPosts(undefined, 'Newest First', 5, 1)

      expect(response).toHaveProperty('posts')
      expect(Array.isArray(response.posts)).toBe(true)
      expect(response).toHaveProperty('meta')
    })
  })

  describe('getPostsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getPostsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ===========================================================================
  //  PAGES
  // ===========================================================================

  describe('createPage + getPage + updatePage + deletePage', () => {
    let pageId

    it('creates a draft page', async () => {
      const response = await service.createPage(
        `E2E Page ${ suffix }`,
        '<p>Created by the automated e2e test.</p>'
      )

      expect(response.pages[0]).toHaveProperty('id')
      pageId = response.pages[0].id
    })

    it('retrieves the created page', async () => {
      const response = await service.getPage(pageId)

      expect(response.pages[0]).toHaveProperty('id', pageId)
    })

    it('updates the page', async () => {
      const response = await service.updatePage(pageId, `E2E Page Updated ${ suffix }`)

      expect(response.pages[0]).toHaveProperty('title', `E2E Page Updated ${ suffix }`)
    })

    it('deletes the page', async () => {
      const response = await service.deletePage(pageId)

      expect(response).toEqual({ deleted: true, id: pageId })
    })
  })

  describe('listPages', () => {
    it('returns pages plus pagination metadata', async () => {
      const response = await service.listPages(undefined, 5, 1)

      expect(response).toHaveProperty('pages')
      expect(Array.isArray(response.pages)).toBe(true)
      expect(response).toHaveProperty('meta')
    })
  })

  // ===========================================================================
  //  TAGS
  // ===========================================================================

  describe('createTag + getTag + updateTag + deleteTag', () => {
    let tagId

    it('creates a tag', async () => {
      const response = await service.createTag(`E2E Tag ${ suffix }`, undefined, 'Created by e2e test')

      expect(response.tags[0]).toHaveProperty('id')
      tagId = response.tags[0].id
    })

    it('retrieves the created tag', async () => {
      const response = await service.getTag(tagId)

      expect(response.tags[0]).toHaveProperty('id', tagId)
    })

    it('updates the tag', async () => {
      const response = await service.updateTag(tagId, `E2E Tag Updated ${ suffix }`)

      expect(response.tags[0]).toHaveProperty('name', `E2E Tag Updated ${ suffix }`)
    })

    it('deletes the tag', async () => {
      const response = await service.deleteTag(tagId)

      expect(response).toEqual({ deleted: true, id: tagId })
    })
  })

  describe('listTags', () => {
    it('returns tags plus pagination metadata', async () => {
      const response = await service.listTags(undefined, 5, 1)

      expect(response).toHaveProperty('tags')
      expect(Array.isArray(response.tags)).toBe(true)
    })
  })

  describe('getTagsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ===========================================================================
  //  MEMBERS
  // ===========================================================================

  describe('createMember + getMember + updateMember + deleteMember', () => {
    let memberId

    it('creates a member', async () => {
      const email = `e2e-member-${ suffix }@example.com`
      const response = await service.createMember(email, 'E2E Member')

      expect(response.members[0]).toHaveProperty('id')
      memberId = response.members[0].id
    })

    it('retrieves the created member', async () => {
      const response = await service.getMember(memberId)

      expect(response.members[0]).toHaveProperty('id', memberId)
    })

    it('updates the member', async () => {
      const response = await service.updateMember(memberId, undefined, 'E2E Member Updated')

      expect(response.members[0]).toHaveProperty('name', 'E2E Member Updated')
    })

    it('deletes the member', async () => {
      const response = await service.deleteMember(memberId)

      expect(response).toEqual({ deleted: true, id: memberId })
    })
  })

  describe('listMembers', () => {
    it('returns members plus pagination metadata', async () => {
      const response = await service.listMembers(undefined, 5, 1)

      expect(response).toHaveProperty('members')
      expect(Array.isArray(response.members)).toBe(true)
    })
  })

  // ===========================================================================
  //  TIERS & NEWSLETTERS
  // ===========================================================================

  describe('listTiers', () => {
    it('returns tiers with expected shape', async () => {
      const response = await service.listTiers(5, 1)

      expect(response).toHaveProperty('tiers')
      expect(Array.isArray(response.tiers)).toBe(true)
    })
  })

  describe('listNewsletters', () => {
    it('returns newsletters with expected shape', async () => {
      const response = await service.listNewsletters(5, 1)

      expect(response).toHaveProperty('newsletters')
      expect(Array.isArray(response.newsletters)).toBe(true)
    })
  })

  // ===========================================================================
  //  AUTHORS DICTIONARY (staff users)
  // ===========================================================================

  describe('getAuthorsDictionary', () => {
    it('returns dictionary items array of staff users', async () => {
      const result = await service.getAuthorsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ===========================================================================
  //  IMAGES
  // ===========================================================================

  describe('uploadImage', () => {
    // Uploading needs a publicly reachable source image. The developer supplies
    // one via testValues.imageUrl; otherwise this is skipped.
    it('uploads an image and returns its hosted url when an image URL is configured', async () => {
      if (!testValues.imageUrl) {
        console.log('Skipping uploadImage: set testValues.imageUrl to a public image URL')
        return
      }

      const response = await service.uploadImage(testValues.imageUrl, `e2e-${ suffix }.png`)

      expect(response).toHaveProperty('images')
      expect(response.images[0]).toHaveProperty('url')
    })
  })

  // ===========================================================================
  //  CONTENT API (published reads — requires the optional Content API Key)
  // ===========================================================================

  describe('getPublishedPosts', () => {
    it('returns published posts when the Content API Key is configured', async () => {
      if (!hasContentKey()) {
        console.log('Skipping getPublishedPosts: set testValues.hasContentKey=true and configs.contentApiKey')
        return
      }

      const response = await service.getPublishedPosts(undefined, 5, 1)

      expect(response).toHaveProperty('posts')
      expect(Array.isArray(response.posts)).toBe(true)
    })
  })

  describe('getPublishedPost + getPublishedPostBySlug', () => {
    it('retrieves a single published post by id and slug when configured', async () => {
      if (!hasContentKey()) {
        console.log('Skipping published-post reads: set testValues.hasContentKey=true and configs.contentApiKey')
        return
      }

      const list = await service.getPublishedPosts(undefined, 1, 1)

      if (!list.posts || !list.posts.length) {
        console.log('Skipping published-post reads: no published posts on the site')
        return
      }

      const { id, slug } = list.posts[0]

      const byId = await service.getPublishedPost(id, true)
      expect(byId.posts[0]).toHaveProperty('id', id)

      const bySlug = await service.getPublishedPostBySlug(slug)
      expect(bySlug.posts[0]).toHaveProperty('id', id)
    })
  })
})
