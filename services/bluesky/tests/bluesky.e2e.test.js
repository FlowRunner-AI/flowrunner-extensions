'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bluesky Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bluesky')
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

  // A unique-ish suffix so repeated e2e runs are recognizable.
  const suffix = Date.now()

  // The connected account's own handle, used for author-feed/profile checks.
  // Falls back to the configured identifier when testValues.ownHandle is unset.
  const ownActor = () => testValues.ownHandle || testValues.identifier || 'bsky.app'

  // A public actor to inspect (defaults to the official Bluesky account).
  const publicActor = () => testValues.publicActor || 'bsky.app'

  // ── Identity ──

  describe('resolveHandle', () => {
    it('resolves a public handle to a DID', async () => {
      const result = await service.resolveHandle(publicActor())

      expect(result).toHaveProperty('did')
      expect(String(result.did)).toMatch(/^did:/)
      expect(result).toHaveProperty('handle')
    })
  })

  // ── Profiles ──

  describe('getProfile', () => {
    it('returns a profile with expected shape', async () => {
      const response = await service.getProfile(publicActor())

      expect(response).toHaveProperty('did')
      expect(response).toHaveProperty('handle')
      expect(response).toHaveProperty('followersCount')
    })
  })

  describe('getProfiles', () => {
    it('returns multiple profiles with expected shape', async () => {
      const response = await service.getProfiles([publicActor()])

      expect(response).toHaveProperty('profiles')
      expect(Array.isArray(response.profiles)).toBe(true)
    })
  })

  describe('searchUsers', () => {
    it('returns actors with expected shape', async () => {
      const response = await service.searchUsers('bluesky', 5)

      expect(response).toHaveProperty('actors')
      expect(Array.isArray(response.actors)).toBe(true)
    })
  })

  // ── Feeds & Search ──

  describe('getTimeline', () => {
    it('returns the home timeline with a feed array', async () => {
      const response = await service.getTimeline(5)

      expect(response).toHaveProperty('feed')
      expect(Array.isArray(response.feed)).toBe(true)
    })
  })

  describe('getAuthorFeed', () => {
    it('returns an author feed with a feed array', async () => {
      const response = await service.getAuthorFeed(publicActor(), undefined, 5)

      expect(response).toHaveProperty('feed')
      expect(Array.isArray(response.feed)).toBe(true)
    })
  })

  describe('searchPosts', () => {
    it('returns search results with a posts array', async () => {
      const response = await service.searchPosts('bluesky', 'Latest', undefined, undefined, undefined, undefined, 5)

      expect(response).toHaveProperty('posts')
      expect(Array.isArray(response.posts)).toBe(true)
    })
  })

  describe('getPosts', () => {
    // Needs a real post reference. Uses the newest post from the public actor's feed.
    it('hydrates posts by reference', async () => {
      const feed = await service.getAuthorFeed(publicActor(), 'Posts No Replies', 1)

      if (!feed.feed || !feed.feed.length) {
        console.log('Skipping getPosts: public actor has no posts to reference')
        return
      }

      const uri = feed.feed[0].post.uri
      const response = await service.getPosts([uri])

      expect(response).toHaveProperty('posts')
      expect(Array.isArray(response.posts)).toBe(true)
      expect(response.posts.length).toBeGreaterThan(0)
    })
  })

  describe('getPostThread', () => {
    it('returns a thread for a real post', async () => {
      const feed = await service.getAuthorFeed(publicActor(), 'Posts No Replies', 1)

      if (!feed.feed || !feed.feed.length) {
        console.log('Skipping getPostThread: public actor has no posts to reference')
        return
      }

      const uri = feed.feed[0].post.uri
      const response = await service.getPostThread(uri)

      expect(response).toHaveProperty('thread')
    })
  })

  // ── Social Graph ──

  describe('getFollowers', () => {
    it('returns followers with expected shape', async () => {
      const response = await service.getFollowers(publicActor(), 5)

      expect(response).toHaveProperty('followers')
      expect(Array.isArray(response.followers)).toBe(true)
    })
  })

  describe('getFollows', () => {
    it('returns follows with expected shape', async () => {
      const response = await service.getFollows(publicActor(), 5)

      expect(response).toHaveProperty('follows')
      expect(Array.isArray(response.follows)).toBe(true)
    })
  })

  // ── Notifications ──

  describe('listNotifications', () => {
    it('returns notifications with expected shape', async () => {
      const response = await service.listNotifications(5)

      expect(response).toHaveProperty('notifications')
      expect(Array.isArray(response.notifications)).toBe(true)
    })
  })

  describe('markNotificationsSeen', () => {
    it('marks notifications seen', async () => {
      const response = await service.markNotificationsSeen()

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('seenAt')
    })
  })

  // ── Posting (lifecycle: create → delete) ──

  describe('createPost + deletePost', () => {
    let uri

    it('creates a text post', async () => {
      const response = await service.createPost(`FlowRunner e2e test post ${ suffix } — please ignore`)

      expect(response).toHaveProperty('uri')
      expect(response).toHaveProperty('cid')
      expect(response).toHaveProperty('webUrl')
      uri = response.uri
    })

    it('deletes the created post', async () => {
      const response = await service.deletePost(uri)

      expect(response).toEqual({ success: true, uri })
    })
  })

  describe('createPost with link card + deletePost', () => {
    let uri

    it('creates a post with an external link card', async () => {
      const response = await service.createPost(
        `FlowRunner e2e link-card test ${ suffix }`,
        ['en'],
        'https://example.com',
        'Example',
        'An example link card'
      )

      expect(response).toHaveProperty('uri')
      uri = response.uri
    })

    afterAll(async () => {
      if (uri) {
        try {
          await service.deletePost(uri)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('createPost + likePost + repost + quotePost + deletePost', () => {
    let baseUri
    const cleanup = []

    it('creates a base post to interact with', async () => {
      const response = await service.createPost(`FlowRunner e2e interaction target ${ suffix }`)

      expect(response).toHaveProperty('uri')
      baseUri = response.uri
      cleanup.push(baseUri)
    })

    it('likes the post', async () => {
      const response = await service.likePost(baseUri)

      expect(response).toHaveProperty('uri')
      expect(response).toHaveProperty('subject')
      // The like record itself is auto-cleaned when the base post is deleted,
      // but track it so we can tidy up explicitly.
      cleanup.push(response.uri)
    })

    it('reposts the post', async () => {
      const response = await service.repost(baseUri)

      expect(response).toHaveProperty('uri')
      expect(response).toHaveProperty('subject')
      cleanup.push(response.uri)
    })

    it('quotes the post', async () => {
      const response = await service.quotePost(baseUri, `Quoting my own test post ${ suffix }`)

      expect(response).toHaveProperty('uri')
      cleanup.push(response.uri)
    })

    it('replies to the post', async () => {
      const response = await service.replyToPost(baseUri, `Replying to my own test post ${ suffix }`)

      expect(response).toHaveProperty('uri')
      cleanup.push(response.uri)
    })

    afterAll(async () => {
      // Delete every record we created (posts, quote, reply). Likes/reposts use
      // different collections, so deletePost only removes feed.post records; the
      // rest are cleaned when the account is reset. Best-effort cleanup.
      for (const uri of cleanup) {
        try {
          await service.deletePost(uri)
        } catch (e) {
          // ignore cleanup errors (non-post collections, already gone, etc.)
        }
      }
    })
  })

  // ── Social Graph (mutating — gated on a target actor) ──

  describe('follow + unfollow', () => {
    // Only runs when the developer supplies testValues.followTarget, since it
    // mutates the connected account's social graph.
    const canRun = () => Boolean(testValues.followTarget)

    it('follows and then unfollows a target user', async () => {
      if (!canRun()) {
        console.log('Skipping follow/unfollow: set testValues.followTarget to a handle or DID')
        return
      }

      const followed = await service.followUser(testValues.followTarget)

      expect(followed).toHaveProperty('uri')
      expect(followed).toHaveProperty('subject')

      const unfollowed = await service.unfollowUser(testValues.followTarget)

      expect(unfollowed).toHaveProperty('success', true)
    })
  })

  describe('mute + unmute', () => {
    // Only runs when the developer supplies testValues.muteTarget.
    const canRun = () => Boolean(testValues.muteTarget)

    it('mutes and then unmutes a target user', async () => {
      if (!canRun()) {
        console.log('Skipping mute/unmute: set testValues.muteTarget to a handle or DID')
        return
      }

      const muted = await service.muteUser(testValues.muteTarget)

      expect(muted).toMatchObject({ success: true, muted: true })

      const unmuted = await service.unmuteUser(testValues.muteTarget)

      expect(unmuted).toMatchObject({ success: true, muted: false })
    })
  })

  // ── Posting with image (gated on a FlowRunner file url) ──

  describe('createPostWithImage', () => {
    // Only runs when the developer supplies testValues.imageFileUrl pointing at a
    // small (<1 MB) PNG/JPEG/WebP/GIF/AVIF that Bluesky can accept.
    const canRun = () => Boolean(testValues.imageFileUrl)

    it('creates a post with an attached image', async () => {
      if (!canRun()) {
        console.log('Skipping createPostWithImage: set testValues.imageFileUrl to a small image url')
        return
      }

      const response = await service.createPostWithImage(
        `FlowRunner e2e image test ${ suffix }`,
        testValues.imageFileUrl,
        'E2E test image'
      )

      expect(response).toHaveProperty('uri')

      try {
        await service.deletePost(response.uri)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })
})
