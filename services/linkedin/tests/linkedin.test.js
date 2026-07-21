'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const API_BASE = 'https://api.linkedin.com'
const OAUTH_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USER_INFO_URL = `${API_BASE}/v2/userinfo`
const LINKEDIN_VERSION = '202606'

const MOCK_USER_INFO = {
  sub: '782bbtaQ',
  name: 'Jane Doe',
  given_name: 'Jane',
  family_name: 'Doe',
  email: 'jane@example.com',
  email_verified: true,
  locale: 'en-US',
  picture: 'https://media.licdn.com/dms/image/abc/profile.jpg',
}

describe('LinkedIn Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('registers exactly two config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(2)
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://www.linkedin.com/oauth/v2/authorization')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=openid+profile+email+w_member_social+r_organization_social+w_organization_social+rw_organization_admin')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }

      mock.onPost(OAUTH_TOKEN_URL).reply(tokenResponse)
      mock.onGet(USER_INFO_URL).reply(MOCK_USER_INFO)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.overwrite).toBe(true)
      expect(result.connectionIdentityName).toBe('Jane Doe (jane@example.com)')
      expect(result.connectionIdentityImageURL).toBe('https://media.licdn.com/dms/image/abc/profile.jpg')
      expect(result.userData).toEqual(MOCK_USER_INFO)

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(OAUTH_TOKEN_URL)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)

      // Verify userinfo request uses the new token
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(USER_INFO_URL)
      expect(mock.history[1].headers).toMatchObject({ Authorization: 'Bearer new-access-token' })
    })

    it('falls back to default identity name when userinfo fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })
      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('LinkedIn Account')
      expect(result.connectionIdentityImageURL).toBe(null)
    })

    it('uses only name when email is missing', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({ access_token: 'token', expires_in: 3600 })
      mock.onGet(USER_INFO_URL).reply({ name: 'Jane Doe' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Jane Doe')
    })

    it('uses only email when name is missing', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({ access_token: 'token', expires_in: 3600 })
      mock.onGet(USER_INFO_URL).reply({ email: 'jane@example.com' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('jane@example.com')
    })
  })

  describe('refreshToken', () => {
    it('sends refresh token request and returns new tokens', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe('refreshed-token')
      expect(result.expirationInSeconds).toBe(7200)
      expect(result.refreshToken).toBe('new-refresh-token')

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('falls back to original refresh token when new one is not returned', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('original-refresh-token')

      expect(result.refreshToken).toBe('original-refresh-token')
    })

    it('throws descriptive error on invalid_grant', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token')).rejects.toThrow(
        'Refresh token expired or invalid'
      )
    })

    it('rethrows other errors', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({
        message: 'Server error',
      })

      await expect(service.refreshToken('token')).rejects.toThrow()
    })
  })

  // ── Profile ──

  describe('getMyProfile', () => {
    it('fetches user info from the userinfo endpoint', async () => {
      mock.onGet(USER_INFO_URL).reply(MOCK_USER_INFO)

      const result = await service.getMyProfile()

      expect(result).toEqual(MOCK_USER_INFO)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  // ── Posts ──

  describe('createPost', () => {
    it('creates a text post as the authenticated member', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: '782bbtaQ' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:123' })

      const result = await service.createPost('Hello LinkedIn!', undefined, 'Public')

      expect(result.success).toBe(true)
      expect(result.postUrn).toBe('urn:li:share:123')
      expect(result.author).toBe('urn:li:person:782bbtaQ')

      // Verify post request body
      const postCall = mock.history.find(c => c.method === 'post' && c.url.includes('/rest/posts'))

      expect(postCall.body).toMatchObject({
        author: 'urn:li:person:782bbtaQ',
        commentary: 'Hello LinkedIn!',
        visibility: 'PUBLIC',
        lifecycleState: 'PUBLISHED',
        distribution: expect.objectContaining({ feedDistribution: 'MAIN_FEED' }),
      })
      expect(postCall.body.content).toBeUndefined()

      // Verify rest headers
      expect(postCall.headers).toMatchObject({
        'LinkedIn-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      })
    })

    it('creates a post as a specified organization URN', async () => {
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:456' })

      await service.createPost('Org post', 'urn:li:organization:2414183')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.author).toBe('urn:li:organization:2414183')
    })

    it('treats bare numeric author as organization id', async () => {
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:789' })

      await service.createPost('Org post', '2414183')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.author).toBe('urn:li:organization:2414183')
    })

    it('attaches article content when articleUrl is provided', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:999' })

      await service.createPost(
        'Check this out',
        undefined,
        'Public',
        'https://example.com/article',
        'Article Title',
        'Article Description'
      )

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.content).toEqual({
        article: {
          source: 'https://example.com/article',
          title: 'Article Title',
          description: 'Article Description',
        },
      })
    })

    it('omits article content fields that are undefined', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:999' })

      await service.createPost(
        'Check this out',
        undefined,
        'Public',
        'https://example.com/article'
      )

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.content.article).toEqual({
        source: 'https://example.com/article',
      })
    })

    it('maps Connections visibility correctly', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:100' })

      await service.createPost('Private post', undefined, 'Connections')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.visibility).toBe('CONNECTIONS')
    })

    it('maps Logged-In Members visibility correctly', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:100' })

      await service.createPost('Semi-private post', undefined, 'Logged-In Members')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body.visibility).toBe('LOGGED_IN')
    })

    it('throws when commentary is missing', async () => {
      await expect(service.createPost('')).rejects.toThrow('"Commentary" is required')
      await expect(service.createPost(undefined)).rejects.toThrow('"Commentary" is required')
    })

    it('returns null postUrn when LinkedIn does not return an id', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/posts`).reply({})

      const result = await service.createPost('Test post')

      expect(result.postUrn).toBeNull()
      expect(result.message).toContain('x-restli-id response header')
    })
  })

  describe('createImagePost', () => {
    const IMAGE_URL = 'https://example.com/image.jpg'
    const UPLOAD_URL = 'https://www.linkedin.com/dms-uploads/upload123'
    const IMAGE_URN = 'urn:li:image:C4E10AQFoyyAjHPMQuQ'

    it('orchestrates initialize, upload, and post creation', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/images?action=initializeUpload`).reply({
        value: { uploadUrl: UPLOAD_URL, image: IMAGE_URN },
      })
      mock.onGet(IMAGE_URL).reply(Buffer.from('fake-image-bytes'))
      mock.onPut(UPLOAD_URL).reply({})
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:img123' })

      const result = await service.createImagePost(IMAGE_URL, 'Image post', 'Alt text')

      expect(result.success).toBe(true)
      expect(result.imageUrn).toBe(IMAGE_URN)
      expect(result.postUrn).toBe('urn:li:share:img123')

      // Verify init request
      const initCall = mock.history.find(
        c => c.method === 'post' && c.url.includes('initializeUpload')
      )

      expect(initCall.body).toEqual({
        initializeUploadRequest: { owner: 'urn:li:person:abc' },
      })

      // Verify upload request
      const uploadCall = mock.history.find(c => c.method === 'put' && c.url === UPLOAD_URL)

      expect(uploadCall).toBeDefined()
      expect(uploadCall.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })

      // Verify post body has media content
      const postCall = mock.history.find(
        c => c.method === 'post' && c.url.includes('/rest/posts')
      )

      expect(postCall.body.content).toEqual({
        media: { id: IMAGE_URN, altText: 'Alt text' },
      })
    })

    it('throws when imageUrl is missing', async () => {
      await expect(service.createImagePost('', 'text')).rejects.toThrow('"Image URL" is required')
    })

    it('throws when commentary is missing', async () => {
      await expect(service.createImagePost(IMAGE_URL, '')).rejects.toThrow(
        '"Commentary" is required'
      )
    })

    it('throws when LinkedIn does not return an upload URL', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/images?action=initializeUpload`).reply({ value: {} })

      await expect(service.createImagePost(IMAGE_URL, 'text')).rejects.toThrow(
        'LinkedIn did not return an upload URL'
      )
    })

    it('throws descriptive error when image upload fails', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/images?action=initializeUpload`).reply({
        value: { uploadUrl: UPLOAD_URL, image: IMAGE_URN },
      })
      mock.onGet(IMAGE_URL).reply(Buffer.from('fake-image-bytes'))
      mock.onPut(UPLOAD_URL).replyWithError({ message: 'Upload failed' })

      await expect(service.createImagePost(IMAGE_URL, 'text')).rejects.toThrow(
        'LinkedIn image upload failed'
      )
    })

    it('omits altText from media content when not provided', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/images?action=initializeUpload`).reply({
        value: { uploadUrl: UPLOAD_URL, image: IMAGE_URN },
      })
      mock.onGet(IMAGE_URL).reply(Buffer.from('bytes'))
      mock.onPut(UPLOAD_URL).reply({})
      mock.onPost(`${API_BASE}/rest/posts`).reply({ id: 'urn:li:share:img456' })

      await service.createImagePost(IMAGE_URL, 'No alt text', undefined, undefined, 'Public')

      const postCall = mock.history.find(
        c => c.method === 'post' && c.url.includes('/rest/posts')
      )

      expect(postCall.body.content.media).toEqual({ id: IMAGE_URN })
    })
  })

  describe('getPost', () => {
    it('fetches a post by URN with URL encoding', async () => {
      const postUrn = 'urn:li:share:6844785523593134080'
      const encodedUrn = encodeURIComponent(postUrn)
      const mockPost = {
        id: postUrn,
        author: 'urn:li:person:782bbtaQ',
        commentary: 'Sample text',
        visibility: 'PUBLIC',
      }

      mock.onGet(`${API_BASE}/rest/posts/${encodedUrn}`).reply(mockPost)

      const result = await service.getPost(postUrn)

      expect(result).toEqual(mockPost)
      expect(mock.history[0].headers).toMatchObject({
        'LinkedIn-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      })
    })

    it('passes through already-encoded URNs unchanged', async () => {
      const encodedUrn = 'urn%3Ali%3Ashare%3A123'

      mock.onGet(`${API_BASE}/rest/posts/${encodedUrn}`).reply({ id: 'test' })

      await service.getPost(encodedUrn)

      expect(mock.history[0].url).toBe(`${API_BASE}/rest/posts/${encodedUrn}`)
    })

    it('throws when postUrn is empty', async () => {
      await expect(service.getPost('')).rejects.toThrow('"Post URN" is required')
    })
  })

  describe('deletePost', () => {
    it('sends DELETE request with correct headers and returns success', async () => {
      const postUrn = 'urn:li:share:6844785523593134080'
      const encodedUrn = encodeURIComponent(postUrn)

      mock.onDelete(`${API_BASE}/rest/posts/${encodedUrn}`).reply({})

      const result = await service.deletePost(postUrn)

      expect(result).toEqual({
        success: true,
        message: 'Post deleted successfully.',
        postUrn,
      })

      expect(mock.history[0].headers).toMatchObject({
        'X-RestLi-Method': 'DELETE',
        'LinkedIn-Version': LINKEDIN_VERSION,
      })
    })
  })

  // ── Organizations ──

  describe('getMyOrganizations', () => {
    it('fetches organizations with default pagination', async () => {
      const mockResponse = {
        elements: [{ organizationalTarget: 'urn:li:organization:2414183', role: 'ADMINISTRATOR' }],
        paging: { start: 0, count: 20 },
      }

      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply(mockResponse)

      const result = await service.getMyOrganizations()

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({
        q: 'roleAssignee',
        start: 0,
        count: 20,
      })
    })

    it('passes custom start and count', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({ elements: [] })

      await service.getMyOrganizations(10, 5)

      expect(mock.history[0].query).toMatchObject({
        start: 10,
        count: 5,
      })
    })
  })

  describe('getOrganization', () => {
    it('fetches organization by numeric id', async () => {
      const mockOrg = { id: 2414183, localizedName: 'Devtestco' }

      mock.onGet(`${API_BASE}/v2/organizations/2414183`).reply(mockOrg)

      const result = await service.getOrganization('2414183')

      expect(result).toEqual(mockOrg)
    })

    it('extracts id from full URN', async () => {
      mock.onGet(`${API_BASE}/v2/organizations/2414183`).reply({ id: 2414183 })

      await service.getOrganization('urn:li:organization:2414183')

      expect(mock.history[0].url).toBe(`${API_BASE}/v2/organizations/2414183`)
    })

    it('throws when organization is missing', async () => {
      await expect(service.getOrganization('')).rejects.toThrow('"Organization" is required')
    })
  })

  // ── Social Actions ──

  describe('createComment', () => {
    const postUrn = 'urn:li:share:6844785523593134080'
    const encodedUrn = encodeURIComponent(postUrn)

    it('creates a comment as the authenticated member', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/socialActions/${encodedUrn}/comments`).reply({
        actor: 'urn:li:person:abc',
        message: { text: 'Great post!' },
      })

      const result = await service.createComment(postUrn, 'Great post!')

      expect(result.message).toEqual({ text: 'Great post!' })

      const commentCall = mock.history.find(c => c.method === 'post' && c.url.includes('comments'))

      expect(commentCall.body).toEqual({
        actor: 'urn:li:person:abc',
        message: { text: 'Great post!' },
      })
    })

    it('creates a comment as a specified actor', async () => {
      mock.onPost(`${API_BASE}/rest/socialActions/${encodedUrn}/comments`).reply({})

      await service.createComment(postUrn, 'Comment', 'urn:li:organization:2414183')

      const commentCall = mock.history.find(c => c.method === 'post')

      expect(commentCall.body.actor).toBe('urn:li:organization:2414183')
    })

    it('throws when postUrn is missing', async () => {
      await expect(service.createComment('', 'text')).rejects.toThrow('"Post URN" is required')
    })

    it('throws when message is missing', async () => {
      await expect(service.createComment(postUrn, '')).rejects.toThrow('"Message" is required')
    })
  })

  describe('getComments', () => {
    const postUrn = 'urn:li:share:6844785523593134080'
    const encodedUrn = encodeURIComponent(postUrn)

    it('fetches comments with default pagination', async () => {
      const mockResponse = { elements: [], paging: { start: 0, count: 10, total: 0 } }

      mock.onGet(`${API_BASE}/rest/socialActions/${encodedUrn}/comments`).reply(mockResponse)

      const result = await service.getComments(postUrn)

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].query).toMatchObject({ start: 0, count: 10 })
    })

    it('passes custom start and count', async () => {
      mock.onGet(`${API_BASE}/rest/socialActions/${encodedUrn}/comments`).reply({ elements: [] })

      await service.getComments(postUrn, 5, 25)

      expect(mock.history[0].query).toMatchObject({ start: 5, count: 25 })
    })

    it('throws when postUrn is missing', async () => {
      await expect(service.getComments('')).rejects.toThrow('"Post URN" is required')
    })
  })

  describe('likePost', () => {
    const postUrn = 'urn:li:share:6844785523593134080'
    const encodedUrn = encodeURIComponent(postUrn)

    it('likes a post as the authenticated member', async () => {
      mock.onGet(USER_INFO_URL).reply({ sub: 'abc' })
      mock.onPost(`${API_BASE}/rest/socialActions/${encodedUrn}/likes`).reply({
        actor: 'urn:li:person:abc',
      })

      const result = await service.likePost(postUrn)

      expect(result.actor).toBe('urn:li:person:abc')

      const likeCall = mock.history.find(c => c.method === 'post' && c.url.includes('likes'))

      expect(likeCall.body).toEqual({
        actor: 'urn:li:person:abc',
        object: postUrn,
      })
    })

    it('likes a post as a specified actor', async () => {
      mock.onPost(`${API_BASE}/rest/socialActions/${encodedUrn}/likes`).reply({})

      await service.likePost(postUrn, 'urn:li:organization:2414183')

      const likeCall = mock.history.find(c => c.method === 'post')

      expect(likeCall.body.actor).toBe('urn:li:organization:2414183')
    })

    it('throws when postUrn is missing', async () => {
      await expect(service.likePost('')).rejects.toThrow('"Post URN" is required')
    })
  })

  // ── Dictionary ──

  describe('getOrganizationsDictionary', () => {
    it('returns organizations with labels and URN values', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({
        elements: [
          { organizationalTarget: 'urn:li:organization:111', role: 'ADMINISTRATOR' },
        ],
      })
      mock.onGet(`${API_BASE}/v2/organizations/111`).reply({ localizedName: 'Acme Corp' })

      const result = await service.getOrganizationsDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Corp', value: 'urn:li:organization:111', note: 'ADMINISTRATOR' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters results by search term', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({
        elements: [
          { organizationalTarget: 'urn:li:organization:111', role: 'ADMINISTRATOR' },
          { organizationalTarget: 'urn:li:organization:222', role: 'ADMINISTRATOR' },
        ],
      })
      mock.onGet(`${API_BASE}/v2/organizations/111`).reply({ localizedName: 'Acme Corp' })
      mock.onGet(`${API_BASE}/v2/organizations/222`).reply({ localizedName: 'Beta Inc' })

      const result = await service.getOrganizationsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Acme Corp')
    })

    it('provides cursor when a full page of 20 elements is returned', async () => {
      const elements = Array.from({ length: 20 }, (_, i) => ({
        organizationalTarget: `urn:li:organization:${i}`,
        role: 'ADMINISTRATOR',
      }))

      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({ elements })
      mock.onAny().reply({ localizedName: 'Org' })

      const result = await service.getOrganizationsDictionary({})

      expect(result.cursor).toBe('20')
    })

    it('uses cursor as start index for pagination', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({ elements: [] })

      await service.getOrganizationsDictionary({ cursor: '40' })

      expect(mock.history[0].query).toMatchObject({ start: 40 })
    })

    it('falls back to URN when org name lookup fails', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({
        elements: [
          { organizationalTarget: 'urn:li:organization:999', role: 'ADMINISTRATOR' },
        ],
      })
      mock.onGet(`${API_BASE}/v2/organizations/999`).replyWithError({ message: 'Not found' })

      const result = await service.getOrganizationsDictionary({})

      expect(result.items[0].label).toBe('urn:li:organization:999')
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(`${API_BASE}/v2/organizationalEntityAcls`).reply({ elements: [] })

      const result = await service.getOrganizationsDictionary()

      expect(result.items).toEqual([])
    })
  })

  // ── Error handling ──

  describe('API error handling', () => {
    it('wraps API errors with LinkedIn-specific message', async () => {
      mock.onGet(USER_INFO_URL).replyWithError({
        message: 'Forbidden',
        body: { message: 'Access denied', serviceErrorCode: 100, status: 403 },
      })

      await expect(service.getMyProfile()).rejects.toThrow(
        /LinkedIn API error.*Access denied.*serviceErrorCode 100.*HTTP 403/
      )
    })
  })
})
