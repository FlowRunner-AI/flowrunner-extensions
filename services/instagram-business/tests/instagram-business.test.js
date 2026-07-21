'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const API_BASE = 'https://graph.facebook.com/v25.0'
const WWW_BASE = 'https://www.facebook.com/v25.0'

const IG_USER_ID = '17841400000000000'

const PAGES_RESPONSE = {
  data: [
    {
      id                        : '111222333',
      name                      : 'Acme Store',
      instagram_business_account: {
        id                 : IG_USER_ID,
        username           : 'acme',
        profile_picture_url: 'https://scontent.cdninstagram.com/v/pfp.jpg',
      },
    },
    {
      id                        : '444555666',
      name                      : 'Test Page',
      instagram_business_account: {
        id                 : '17841400000000001',
        username           : 'testpage',
        profile_picture_url: 'https://scontent.cdninstagram.com/v/pfp2.jpg',
      },
    },
  ],
}

const PAGES_NO_IG_RESPONSE = {
  data: [
    { id: '111222333', name: 'Page Without IG' },
  ],
}

describe('Instagram for Business Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    service._igUserIdCache = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ]),
      )
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a correctly formed URL with client_id and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${ WWW_BASE }/dialog/oauth/`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('instagram_basic')
      expect(url).toContain('instagram_content_publish')
      expect(url).toContain('instagram_manage_comments')
      expect(url).toContain('instagram_manage_insights')
      expect(url).toContain('pages_show_list')
      expect(url).toContain('business_management')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches profile', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token : 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in   : 3600,
      })
      mock.onGet(`${ API_BASE }/me?fields=id,name`).reply({
        id  : '12345',
        name: 'Test User',
      })

      const result = await service.executeCallback({
        code       : 'auth-code-123',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token                 : 'new-access-token',
        refreshToken          : 'new-refresh-token',
        overwrite             : true,
        expirationInSeconds   : 3600,
        connectionIdentityName: 'Test User',
      })

      expect(mock.history).toHaveLength(2)

      const tokenCall = mock.history[0]
      expect(tokenCall.method).toBe('post')
      expect(tokenCall.body).toContain('grant_type=authorization_code')
      expect(tokenCall.body).toContain(`client_id=${ CLIENT_ID }`)
      expect(tokenCall.body).toContain(`client_secret=${ CLIENT_SECRET }`)
      expect(tokenCall.body).toContain('code=auth-code-123')
      expect(tokenCall.body).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback')
    })

    it('uses fallback name when profile.name is missing', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token : 'tok',
        refresh_token: 'ref',
        expires_in   : 7200,
      })
      mock.onGet(`${ API_BASE }/me?fields=id,name`)
        .reply({ id: '12345', name: 'Test User' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x.com/cb' })

      expect(result.connectionIdentityName).toBe('Test User')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).replyWithError({
        message: 'Invalid code',
      })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://x.com/cb' }),
      ).rejects.toThrow()
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token : 'refreshed-token',
        refresh_token: 'new-refresh',
        expires_in   : 5184000,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token              : 'refreshed-token',
        refreshToken       : 'new-refresh',
        expirationInSeconds: 5184000,
      })

      const call = mock.history[0]
      expect(call.body).toContain('grant_type=refresh_token')
      expect(call.body).toContain('refresh_token=old-refresh-token')
      expect(call.body).toContain(`client_id=${ CLIENT_ID }`)
      expect(call.body).toContain(`client_secret=${ CLIENT_SECRET }`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).replyWithError({
        message: 'Invalid refresh token',
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Publishing ──

  describe('publishPhoto', () => {
    it('creates container and publishes immediately', async () => {
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'container-1' })
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'published-1' })
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.publishPhoto('https://example.com/photo.jpg', 'Test caption', 'loc-123', [{
        username: 'user1',
        x       : 0.5,
        y       : 0.5,
      }])

      expect(result).toEqual({ id: 'published-1' })

      const createCall = mock.history.find(c => c.method === 'post' && c.url.includes('/media') && !c.url.includes('/media_publish'))
      const body = JSON.parse(createCall.body)
      expect(body).toMatchObject({
        image_url  : 'https://example.com/photo.jpg',
        caption    : 'Test caption',
        location_id: 'loc-123',
        user_tags  : [{ username: 'user1', x: 0.5, y: 0.5 }],
      })

      const publishCall = mock.history.find(c => c.url.includes('/media_publish'))
      expect(JSON.parse(publishCall.body)).toMatchObject({ creation_id: 'container-1' })
    })

    it('uses provided igUserId and omits optional fields', async () => {
      mock.onPost(`${ API_BASE }/custom-ig-id/media`).reply({ id: 'c-2' })
      mock.onPost(`${ API_BASE }/custom-ig-id/media_publish`).reply({ id: 'p-2' })

      await service.publishPhoto('https://example.com/photo.jpg', undefined, undefined, undefined, 'custom-ig-id')

      const createCall = mock.history[0]
      const body = JSON.parse(createCall.body)
      expect(body.image_url).toBe('https://example.com/photo.jpg')
      expect(body).not.toHaveProperty('caption')
      expect(body).not.toHaveProperty('location_id')
      expect(body).not.toHaveProperty('user_tags')
    })
  })

  describe('publishReel', () => {
    it('creates container, polls until finished, and publishes', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'reel-container' })
      mock.onGet(`${ API_BASE }/reel-container`).reply({ status_code: 'FINISHED' })
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'reel-published' })

      const result = await service.publishReel('https://example.com/video.mp4', 'Reel caption', 'https://example.com/cover.jpg', 5000, true)

      expect(result).toEqual({ id: 'reel-published' })

      const createCall = mock.history.find(c => c.method === 'post' && c.url.endsWith('/media'))
      const body = JSON.parse(createCall.body)
      expect(body).toMatchObject({
        media_type   : 'REELS',
        video_url    : 'https://example.com/video.mp4',
        caption      : 'Reel caption',
        cover_url    : 'https://example.com/cover.jpg',
        thumb_offset : 5000,
        share_to_feed: true,
      })
    })

    it('throws when container processing fails', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'reel-fail' })
      mock.onGet(`${ API_BASE }/reel-fail`).reply({ status_code: 'ERROR', status: 'Codec unsupported' })

      await expect(
        service.publishReel('https://example.com/bad.mp4'),
      ).rejects.toThrow(/processing failed/)
    })
  })

  describe('publishStory', () => {
    it('publishes an image story immediately (no polling)', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'story-img-c' })
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'story-img-p' })

      const result = await service.publishStory('https://example.com/story.jpg')

      expect(result).toEqual({ id: 'story-img-p' })

      const createCall = mock.history.find(c => c.method === 'post' && c.url.endsWith('/media'))
      const body = JSON.parse(createCall.body)
      expect(body).toMatchObject({
        media_type: 'STORIES',
        image_url : 'https://example.com/story.jpg',
      })
      expect(body).not.toHaveProperty('video_url')

      // No polling call should have been made for an image story
      const pollingCalls = mock.history.filter(c => c.method === 'get' && c.url.includes('story-img-c'))
      expect(pollingCalls).toHaveLength(0)
    })

    it('publishes a video story with polling', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'story-vid-c' })
      mock.onGet(`${ API_BASE }/story-vid-c`).reply({ status_code: 'FINISHED' })
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'story-vid-p' })

      const result = await service.publishStory(undefined, 'https://example.com/story.mp4')

      expect(result).toEqual({ id: 'story-vid-p' })

      const pollingCalls = mock.history.filter(c => c.method === 'get' && c.url.includes('story-vid-c'))
      expect(pollingCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('throws when neither image nor video is provided', async () => {
      await expect(service.publishStory()).rejects.toThrow(/provide either an Image URL or a Video URL/)
    })
  })

  describe('publishCarousel', () => {
    it('creates child containers, parent, polls, and publishes', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      // Two image children
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'child-1' })

      // Parent container poll
      mock.onGet(`${ API_BASE }/child-1`).reply({ status_code: 'FINISHED' })

      // Publish
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'carousel-pub' })

      const items = [
        { image_url: 'https://example.com/img1.jpg' },
        { image_url: 'https://example.com/img2.jpg' },
      ]

      const result = await service.publishCarousel(items, 'Carousel caption')

      expect(result).toEqual({ id: 'carousel-pub' })

      // Should have 3 POST calls to /media (child1, child2, parent) + 1 POST to /media_publish
      const mediaPosts = mock.history.filter(c => c.method === 'post' && c.url.endsWith('/media'))
      expect(mediaPosts).toHaveLength(3)

      // First child should have is_carousel_item
      const firstChild = JSON.parse(mediaPosts[0].body)
      expect(firstChild.is_carousel_item).toBe(true)
      expect(firstChild.image_url).toBe('https://example.com/img1.jpg')

      // Parent should have media_type CAROUSEL and children array
      const parent = JSON.parse(mediaPosts[2].body)
      expect(parent.media_type).toBe('CAROUSEL')
      expect(parent.children).toEqual(['child-1', 'child-1'])
      expect(parent.caption).toBe('Carousel caption')
    })

    it('polls video children before proceeding', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ id: 'vid-child' })
      mock.onGet(`${ API_BASE }/vid-child`).reply({ status_code: 'FINISHED' })
      mock.onPost(`${ API_BASE }/${ IG_USER_ID }/media_publish`).reply({ id: 'carousel-pub-2' })

      const items = [
        { video_url: 'https://example.com/vid.mp4' },
        { image_url: 'https://example.com/img.jpg' },
      ]

      const result = await service.publishCarousel(items)
      expect(result).toEqual({ id: 'carousel-pub-2' })

      // Video child should have media_type VIDEO
      const childPost = mock.history.find(c => c.method === 'post' && c.url.endsWith('/media'))
      const body = JSON.parse(childPost.body)
      expect(body.media_type).toBe('VIDEO')
      expect(body.is_carousel_item).toBe(true)
    })

    it('throws when fewer than 2 items are provided', async () => {
      await expect(service.publishCarousel([{ image_url: 'a' }])).rejects.toThrow(/between 2 and 10/)
    })

    it('throws when more than 10 items are provided', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({ image_url: `https://example.com/${ i }.jpg` }))
      await expect(service.publishCarousel(items)).rejects.toThrow(/between 2 and 10/)
    })

    it('throws when items is not an array', async () => {
      await expect(service.publishCarousel('not-array')).rejects.toThrow(/between 2 and 10/)
    })
  })

  describe('getContainerStatus', () => {
    it('sends correct request and returns status', async () => {
      mock.onGet(`${ API_BASE }/container-123`).reply({
        status_code: 'FINISHED',
        status     : 'Ready to publish.',
        id         : 'container-123',
      })

      const result = await service.getContainerStatus('container-123')

      expect(result).toMatchObject({ status_code: 'FINISHED' })
      expect(mock.history[0].query).toMatchObject({ fields: 'status_code,status' })
    })
  })

  describe('getPublishingLimit', () => {
    it('sends correct request and returns limit data', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/content_publishing_limit`).reply({
        data: [{ config: { quota_total: 50, quota_duration: 86400 }, quota_usage: 7 }],
      })

      const result = await service.getPublishingLimit()

      expect(result.data[0].config.quota_total).toBe(50)
      expect(result.data[0].quota_usage).toBe(7)

      const limitCall = mock.history.find(c => c.url.includes('content_publishing_limit'))
      expect(limitCall.query).toMatchObject({ fields: 'config,quota_usage' })
    })
  })

  // ── Media ──

  describe('listMedia', () => {
    it('sends correct request with default limit', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({
        data  : [{ id: 'media-1', caption: 'Test' }],
        paging: { cursors: { after: 'cursor-abc' } },
      })

      const result = await service.listMedia()

      expect(result.data).toHaveLength(1)
      const call = mock.history.find(c => c.url.includes(`${ IG_USER_ID }/media`))
      expect(call.query.limit).toBe(25)
      expect(call.query.fields).toContain('id,caption,media_type')
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ data: [] })

      await service.listMedia(10, 'cursor-xyz')

      const call = mock.history.find(c => c.url.includes(`${ IG_USER_ID }/media`))
      expect(call.query.limit).toBe(10)
      expect(call.query.after).toBe('cursor-xyz')
    })
  })

  describe('getMedia', () => {
    it('sends correct request with default fields', async () => {
      mock.onGet(`${ API_BASE }/media-123`).reply({
        id        : 'media-123',
        caption   : 'Test',
        media_type: 'IMAGE',
      })

      const result = await service.getMedia('media-123')

      expect(result.id).toBe('media-123')
      expect(mock.history[0].query.fields).toContain('id,caption,media_type')
      expect(mock.history[0].query.fields).toContain('children{media_url,media_type,thumbnail_url}')
    })

    it('uses custom fields when provided', async () => {
      mock.onGet(`${ API_BASE }/media-456`).reply({ id: 'media-456' })

      await service.getMedia('media-456', 'id,caption')

      expect(mock.history[0].query.fields).toBe('id,caption')
    })
  })

  describe('getMediaChildren', () => {
    it('sends correct request and returns children', async () => {
      mock.onGet(`${ API_BASE }/media-789/children`).reply({
        data: [
          { id: 'child-1', media_type: 'IMAGE' },
          { id: 'child-2', media_type: 'VIDEO' },
        ],
      })

      const result = await service.getMediaChildren('media-789')

      expect(result.data).toHaveLength(2)
      expect(mock.history[0].query.fields).toContain('id,media_type,media_url')
    })
  })

  // ── Comments ──

  describe('listComments', () => {
    it('sends correct request with default limit', async () => {
      mock.onGet(`${ API_BASE }/media-1/comments`).reply({
        data  : [{ id: 'comment-1', text: 'Great!' }],
        paging: { cursors: { after: 'c-cursor' } },
      })

      const result = await service.listComments('media-1')

      expect(result.data).toHaveLength(1)
      const call = mock.history[0]
      expect(call.query.limit).toBe(25)
      expect(call.query.fields).toContain('id,text,username,timestamp')
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/media-1/comments`).reply({ data: [] })

      await service.listComments('media-1', 5, 'page2')

      expect(mock.history[0].query.limit).toBe(5)
      expect(mock.history[0].query.after).toBe('page2')
    })
  })

  describe('getComment', () => {
    it('sends correct request and returns comment', async () => {
      mock.onGet(`${ API_BASE }/comment-1`).reply({
        id      : 'comment-1',
        text    : 'Love this!',
        username: 'jane',
        hidden  : false,
      })

      const result = await service.getComment('comment-1')

      expect(result.text).toBe('Love this!')
      expect(mock.history[0].query.fields).toContain('id,text,username,timestamp,like_count,hidden')
    })
  })

  describe('createComment', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/media-1/comments`).reply({ id: 'new-comment' })

      const result = await service.createComment('media-1', 'Nice post!')

      expect(result).toEqual({ id: 'new-comment' })
      expect(JSON.parse(mock.history[0].body)).toEqual({ message: 'Nice post!' })
    })
  })

  describe('replyToComment', () => {
    it('sends POST to replies endpoint', async () => {
      mock.onPost(`${ API_BASE }/comment-1/replies`).reply({ id: 'reply-1' })

      const result = await service.replyToComment('comment-1', 'Thanks!')

      expect(result).toEqual({ id: 'reply-1' })
      expect(JSON.parse(mock.history[0].body)).toEqual({ message: 'Thanks!' })
    })
  })

  describe('hideComment', () => {
    it('sends POST with hide=true', async () => {
      mock.onPost(`${ API_BASE }/comment-1`).reply({ success: true })

      const result = await service.hideComment('comment-1', true)

      expect(result).toEqual({ success: true })
      expect(JSON.parse(mock.history[0].body)).toEqual({ hide: true })
    })

    it('sends POST with hide=false', async () => {
      mock.onPost(`${ API_BASE }/comment-1`).reply({ success: true })

      await service.hideComment('comment-1', false)

      expect(JSON.parse(mock.history[0].body)).toEqual({ hide: false })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${ API_BASE }/comment-1`).reply({ success: true })

      const result = await service.deleteComment('comment-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Insights ──

  describe('getAccountInsights', () => {
    it('sends correct request with total_value metrics', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/insights`).reply({
        data: [{ name: 'reach', period: 'day', total_value: { value: 5230 } }],
      })

      const result = await service.getAccountInsights(['Reach', 'Likes'], 'Day')

      expect(result.data).toHaveLength(1)
      const call = mock.history.find(c => c.url.includes('/insights'))
      expect(call.query.metric).toBe('reach,likes')
      expect(call.query.period).toBe('day')
      expect(call.query.metric_type).toBe('total_value')
    })

    it('does not send metric_type when mixing total_value and time-series metrics', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/insights`).reply({ data: [] })

      await service.getAccountInsights(['Reach', 'Follower Count'], 'Week')

      const call = mock.history.find(c => c.url.includes('/insights'))
      expect(call.query.metric).toBe('reach,follower_count')
      expect(call.query.period).toBe('week')
      // metric_type should be undefined (cleaned out)
      expect(call.query.metric_type).toBeUndefined()
    })

    it('resolves 28 Days period correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/insights`).reply({ data: [] })

      await service.getAccountInsights(['Profile Views'], '28 Days')

      const call = mock.history.find(c => c.url.includes('/insights'))
      expect(call.query.period).toBe('days_28')
    })

    it('passes since and until parameters', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/insights`).reply({ data: [] })

      await service.getAccountInsights(['Reach'], 'Day', '1719792000', '1719878400')

      const call = mock.history.find(c => c.url.includes('/insights'))
      expect(call.query.since).toBe('1719792000')
      expect(call.query.until).toBe('1719878400')
    })
  })

  describe('getMediaInsights', () => {
    it('sends correct request with resolved metrics', async () => {
      mock.onGet(`${ API_BASE }/media-1/insights`).reply({
        data: [{ name: 'reach', period: 'lifetime', values: [{ value: 4820 }] }],
      })

      const result = await service.getMediaInsights('media-1', ['Reach', 'Likes', 'Total Interactions'])

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].query.metric).toBe('reach,likes,total_interactions')
    })
  })

  // ── Account ──

  describe('getAccountInfo', () => {
    it('sends correct request and returns account info', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }`).reply({
        id             : IG_USER_ID,
        username       : 'acme',
        followers_count: 10432,
      })

      const result = await service.getAccountInfo()

      expect(result.username).toBe('acme')
      const call = mock.history.find(c => c.url === `${ API_BASE }/${ IG_USER_ID }`)
      expect(call.query.fields).toContain('id,username,name,biography')
    })
  })

  describe('listConnectedAccounts', () => {
    it('returns formatted accounts list', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.listConnectedAccounts()

      expect(result.accounts).toHaveLength(2)
      expect(result.accounts[0]).toEqual({
        page_id            : '111222333',
        page_name          : 'Acme Store',
        ig_user_id         : IG_USER_ID,
        username           : 'acme',
        profile_picture_url: 'https://scontent.cdninstagram.com/v/pfp.jpg',
      })
    })
  })

  describe('getTaggedMedia', () => {
    it('sends correct request with default limit', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/tags`).reply({
        data: [{ id: 'tag-1', caption: 'Tagged!' }],
      })

      const result = await service.getTaggedMedia()

      expect(result.data).toHaveLength(1)
      const call = mock.history.find(c => c.url.includes('/tags'))
      expect(call.query.limit).toBe(25)
      expect(call.query.fields).toContain('id,caption,media_type')
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/tags`).reply({ data: [] })

      await service.getTaggedMedia(10, 'tag-cursor')

      const call = mock.history.find(c => c.url.includes('/tags'))
      expect(call.query.limit).toBe(10)
      expect(call.query.after).toBe('tag-cursor')
    })
  })

  // ── Hashtags ──

  describe('searchHashtag', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/ig_hashtag_search`).reply({
        data: [{ id: '17843826142012701' }],
      })

      const result = await service.searchHashtag('travel')

      expect(result.data[0].id).toBe('17843826142012701')
      const call = mock.history.find(c => c.url.includes('ig_hashtag_search'))
      expect(call.query).toMatchObject({ user_id: IG_USER_ID, q: 'travel' })
    })
  })

  describe('getHashtagTopMedia', () => {
    it('sends correct request with default limit', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/hashtag-1/top_media`).reply({
        data: [{ id: 'top-1', caption: 'Top post' }],
      })

      const result = await service.getHashtagTopMedia('hashtag-1')

      expect(result.data).toHaveLength(1)
      const call = mock.history.find(c => c.url.includes('/top_media'))
      expect(call.query.user_id).toBe(IG_USER_ID)
      expect(call.query.limit).toBe(25)
      expect(call.query.fields).toContain('id,caption,media_type')
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/hashtag-1/top_media`).reply({ data: [] })

      await service.getHashtagTopMedia('hashtag-1', 10, 'next-page')

      const call = mock.history.find(c => c.url.includes('/top_media'))
      expect(call.query.limit).toBe(10)
      expect(call.query.after).toBe('next-page')
    })
  })

  describe('getHashtagRecentMedia', () => {
    it('sends correct request with default limit', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/hashtag-1/recent_media`).reply({
        data: [{ id: 'recent-1' }],
      })

      const result = await service.getHashtagRecentMedia('hashtag-1')

      expect(result.data).toHaveLength(1)
      const call = mock.history.find(c => c.url.includes('/recent_media'))
      expect(call.query.user_id).toBe(IG_USER_ID)
      expect(call.query.limit).toBe(25)
    })
  })

  // ── Dictionaries ──

  describe('getConnectedAccountsDictionary', () => {
    it('returns formatted items from connected accounts', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.getConnectedAccountsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Acme Store',
        value: IG_USER_ID,
        note : '@acme',
      })
    })

    it('filters by search term matching page name', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.getConnectedAccountsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(IG_USER_ID)
    })

    it('filters by search term matching username', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.getConnectedAccountsDictionary({ search: 'testpage' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('17841400000000001')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.getConnectedAccountsDictionary({ search: '' })

      expect(result.items).toHaveLength(2)
    })

    it('handles null payload', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      const result = await service.getConnectedAccountsDictionary(null)

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getRecentMediaDictionary', () => {
    it('returns formatted media items', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({
        data  : [
          { id: 'media-1', caption: 'Sunset photo', media_type: 'IMAGE', timestamp: '2026-07-01T12:00:00+0000' },
          { id: 'media-2', caption: '', media_type: 'VIDEO', timestamp: '2026-07-02T12:00:00+0000' },
        ],
        paging: { cursors: { after: 'next-cursor' } },
      })

      const result = await service.getRecentMediaDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Sunset photo',
        value: 'media-1',
        note : 'IMAGE',
      })
      // Empty caption falls back to media_type + date
      expect(result.items[1].label).toBe('VIDEO · 2026-07-02')
      expect(result.cursor).toBe('next-cursor')
    })

    it('filters by search term in caption', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({
        data: [
          { id: 'media-1', caption: 'Sunset photo', media_type: 'IMAGE' },
          { id: 'media-2', caption: 'Beach day', media_type: 'IMAGE' },
        ],
      })

      const result = await service.getRecentMediaDictionary({ search: 'sunset' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('media-1')
    })

    it('passes cursor and criteria igUserId', async () => {
      mock.onGet(`${ API_BASE }/custom-ig/media`).reply({ data: [] })

      const result = await service.getRecentMediaDictionary({
        cursor  : 'page-2',
        criteria: { igUserId: 'custom-ig' },
      })

      expect(result.items).toHaveLength(0)
      const call = mock.history[0]
      expect(call.query.after).toBe('page-2')
      expect(call.query.limit).toBe(50)
    })

    it('handles null payload', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ data: [] })

      const result = await service.getRecentMediaDictionary(null)

      expect(result.items).toHaveLength(0)
    })
  })

  // ── IG User ID Resolution ──

  describe('IG user ID resolution', () => {
    it('throws when no IG account is linked to any page', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_NO_IG_RESPONSE)

      await expect(service.getAccountInfo()).rejects.toThrow(/no Instagram Business/)
    })

    it('caches the resolved IG user ID across calls', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }`).reply({ id: IG_USER_ID, username: 'acme' })
      mock.onGet(`${ API_BASE }/${ IG_USER_ID }/media`).reply({ data: [] })

      await service.getAccountInfo()
      await service.listMedia()

      // /me/accounts should only have been called once (second call uses cache)
      const accountCalls = mock.history.filter(c => c.url.includes('/me/accounts'))
      expect(accountCalls).toHaveLength(1)
    })
  })

  // ── Error Handling ──

  describe('API error handling', () => {
    it('formats Facebook API error with all fields', async () => {
      mock.onGet(`${ API_BASE }/media-bad`).replyWithError({
        message: 'Bad Request',
        body   : {
          error: {
            message      : 'Invalid media id',
            type         : 'OAuthException',
            code         : 100,
            error_subcode: 33,
            fbtrace_id   : 'AbcDef123',
          },
        },
      })

      await expect(service.getMedia('media-bad')).rejects.toThrow(/Invalid media id/)
      await expect(service.getMedia('media-bad')).rejects.toThrow(/type=OAuthException/)
    })

    it('includes auth header on all API requests', async () => {
      mock.onGet(`${ API_BASE }/media-check`).reply({ id: 'media-check' })

      await service.getMedia('media-check')

      expect(mock.history[0].headers).toMatchObject({
        Authorization : `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })
})
