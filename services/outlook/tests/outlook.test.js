'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0/me'

const AUTH_HEADER = { Authorization: `Bearer ${ACCESS_TOKEN}` }

describe('Outlook Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(2)
      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', displayName: 'Client ID', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', displayName: 'Client Secret', required: true, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes from config', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toContain('Mail.Send')
      expect(service.scopes).toContain('offline_access')
    })
  })

  // ── OAuth (SYSTEM methods) ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with required params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize?`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent('Mail.ReadWrite'))
      expect(url).toContain(encodeURIComponent('offline_access'))
    })

    it('makes no HTTP calls', async () => {
      await service.getOAuth2ConnectionURL()

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('refreshToken', () => {
    it('exchanges the refresh token and maps the response', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws when the token endpoint fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow('invalid_grant')
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for tokens and loads the user profile', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'cb-access-token',
        refresh_token: 'cb-refresh-token',
        expires_in: 7200,
      })

      const userData = { id: 'user-1', mail: 'john@company.com', displayName: 'John Smith' }

      mock.onGet(API_BASE).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'cb-access-token',
        refreshToken: 'cb-refresh-token',
        expirationInSeconds: 7200,
        connectionIdentityName: 'john@company.com (John Smith)',
        overwrite: true,
        userData,
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(
        `redirect_uri=${encodeURIComponent('https://redirect.example.com/callback')}`
      )
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(API_BASE)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer cb-access-token',
        'Content-Type': 'application/json',
      })
    })

    it('uses only the mail address when displayName is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 1 })
      mock.onGet(API_BASE).reply({ mail: 'solo@company.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x/cb' })

      expect(result.connectionIdentityName).toBe('solo@company.com')
    })

    it('falls back to a default identity name when the profile request fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', refresh_token: 'r', expires_in: 1 })
      mock.onGet(API_BASE).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x/cb' })

      expect(result.connectionIdentityName).toBe('Microsoft Connection')
      expect(result.userData).toEqual({})
    })

    it('throws when the token exchange fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_request' })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'https://x/cb' })).rejects.toThrow(
        'invalid_request'
      )
    })
  })

  // ── Dictionaries ──

  describe('getMessageDictionary', () => {
    it('maps messages to dictionary items', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({
        value: [
          { id: 'm1', subject: 'Team Meeting' },
          { id: 'm2', subject: 'Invoice' },
        ],
      })

      const result = await service.getMessageDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Team Meeting', note: 'ID: m1', value: 'm1' },
          { label: 'Invoice', note: 'ID: m2', value: 'm2' },
        ],
      })

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({ $top: 10, $select: 'subject' })
    })

    it('filters results case-insensitively by search', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({
        value: [
          { id: 'm1', subject: 'Team Meeting' },
          { id: 'm2', subject: 'Invoice' },
        ],
      })

      const result = await service.getMessageDictionary({ search: 'TEAM' })

      expect(result.items).toEqual([{ label: 'Team Meeting', note: 'ID: m1', value: 'm1' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({ value: [{ id: 'm1', subject: 'A' }] })

      const result = await service.getMessageDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('uses the cursor as the request URL and returns the next link', async () => {
      const cursor = `${API_BASE}/messages?$skip=10`

      mock.onGet(cursor).reply({
        value: [{ id: 'm3', subject: 'Next Page' }],
        '@odata.nextLink': `${API_BASE}/messages?$skip=20`,
      })

      const result = await service.getMessageDictionary({ cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(result.cursor).toBe(`${API_BASE}/messages?$skip=20`)
      expect(result.items).toHaveLength(1)
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/messages`).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(service.getMessageDictionary({})).rejects.toThrow('Forbidden')
    })
  })

  describe('getMessageConversationIdDictionary', () => {
    it('maps conversation ids to dictionary items', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({
        value: [{ conversationId: 'c1', subject: 'Project Discussion' }],
      })

      const result = await service.getMessageConversationIdDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Project Discussion', note: 'ID: c1', value: 'c1' }],
      })

      expect(mock.history[0].query).toEqual({ $top: 10, $select: 'subject,conversationId' })
    })

    it('filters by search and supports the cursor', async () => {
      const cursor = `${API_BASE}/messages?$skip=10`

      mock.onGet(cursor).reply({
        value: [
          { conversationId: 'c1', subject: 'Alpha' },
          { conversationId: 'c2', subject: 'Beta' },
        ],
      })

      const result = await service.getMessageConversationIdDictionary({ search: 'bet', cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(result.items).toEqual([{ label: 'Beta', note: 'ID: c2', value: 'c2' }])
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/messages`).replyWithError({ message: 'Server Error' })

      await expect(service.getMessageConversationIdDictionary({})).rejects.toThrow('Server Error')
    })
  })

  describe('getDraftMessageIdDictionary', () => {
    it('requests only drafts and maps them', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({ value: [{ id: 'd1', subject: 'Draft Email' }] })

      const result = await service.getDraftMessageIdDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Draft Email', note: 'ID: d1', value: 'd1' }],
      })

      expect(mock.history[0].query).toEqual({
        $top: 10,
        $select: 'subject',
        filter: 'isDraft eq true',
      })
    })

    it('filters by search', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({
        value: [
          { id: 'd1', subject: 'Draft Email' },
          { id: 'd2', subject: 'Something Else' },
        ],
      })

      const result = await service.getDraftMessageIdDictionary({ search: 'draft' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('d1')
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/messages`).replyWithError({ message: 'Bad Request' })

      await expect(service.getDraftMessageIdDictionary(null)).rejects.toThrow('Bad Request')
    })
  })

  describe('getUnreadMessageDictionary', () => {
    it('requests only unread messages and maps them', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({ value: [{ id: 'u1', subject: 'Important Update' }] })

      const result = await service.getUnreadMessageDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Important Update', note: 'ID: u1', value: 'u1' }],
      })

      expect(mock.history[0].query).toEqual({
        $top: 10,
        $select: 'subject',
        filter: 'isRead eq false',
      })
    })

    it('filters by search and returns an empty list when nothing matches', async () => {
      mock.onGet(`${API_BASE}/messages`).reply({ value: [{ id: 'u1', subject: 'Important Update' }] })

      const result = await service.getUnreadMessageDictionary({ search: 'nomatch' })

      expect(result.items).toEqual([])
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/messages`).replyWithError({ message: 'Throttled' })

      await expect(service.getUnreadMessageDictionary({})).rejects.toThrow('Throttled')
    })
  })

  describe('getEventIdDictionary', () => {
    it('maps calendar events to dictionary items', async () => {
      mock.onGet(`${API_BASE}/calendar/events`).reply({
        value: [{ id: 'e1', subject: 'Team Meeting' }],
      })

      const result = await service.getEventIdDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [{ label: 'Team Meeting', note: 'ID: e1', value: 'e1' }],
      })

      expect(mock.history[0].url).toBe(`${API_BASE}/calendar/events`)
      expect(mock.history[0].query).toEqual({ $top: 10, $select: 'subject' })
    })

    it('filters by search', async () => {
      mock.onGet(`${API_BASE}/calendar/events`).reply({
        value: [
          { id: 'e1', subject: 'Team Meeting' },
          { id: 'e2', subject: 'Standup' },
        ],
      })

      const result = await service.getEventIdDictionary({ search: 'stand' })

      expect(result.items).toEqual([{ label: 'Standup', note: 'ID: e2', value: 'e2' }])
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/calendar/events`).replyWithError({ message: 'Not Found' })

      await expect(service.getEventIdDictionary({})).rejects.toThrow('Not Found')
    })
  })

  describe('getContactIdDictionary', () => {
    it('maps contacts to dictionary items', async () => {
      mock.onGet(`${API_BASE}/contacts`).reply({
        value: [{ id: 'ct1', givenName: 'John', surname: 'Smith' }],
        '@odata.nextLink': `${API_BASE}/contacts?$skip=10`,
      })

      const result = await service.getContactIdDictionary({})

      expect(result).toEqual({
        cursor: `${API_BASE}/contacts?$skip=10`,
        items: [{ label: 'John Smith', note: 'Name: John Smith', value: 'ct1' }],
      })

      expect(mock.history[0].query).toEqual({ $top: 10, $select: 'givenName,surname' })
    })

    it('filters by given name or surname', async () => {
      mock.onGet(`${API_BASE}/contacts`).reply({
        value: [
          { id: 'ct1', givenName: 'John', surname: 'Smith' },
          { id: 'ct2', givenName: 'Jane', surname: 'Doe' },
        ],
      })

      const result = await service.getContactIdDictionary({ search: 'doe' })

      expect(result.items).toEqual([{ label: 'Jane Doe', note: 'Name: Jane Doe', value: 'ct2' }])
    })

    it('throws when the API fails', async () => {
      mock.onGet(`${API_BASE}/contacts`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getContactIdDictionary({})).rejects.toThrow('Unauthorized')
    })
  })

  // ── User Information ──

  describe('getUserProfile', () => {
    it('requests the profile endpoint with the OAuth token', async () => {
      const profile = { id: 'u1', displayName: 'John Smith', mail: 'john@company.com' }

      mock.onGet(API_BASE).reply(profile)

      const result = await service.getUserProfile()

      expect(result).toEqual(profile)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(API_BASE)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('throws when the API fails', async () => {
      mock.onGet(API_BASE).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getUserProfile()).rejects.toThrow('Unauthorized')
    })
  })

  // ── Email Management ──

  describe('getMessagesList', () => {
    it('applies the default page size when no filters are supplied', async () => {
      mock.onGet().reply({ value: [] })

      const result = await service.getMessagesList()

      expect(mock.history[0].url).toBe(`${API_BASE}/messages?$top=10`)
      expect(result.value).toEqual([])
    })

    it('caps maxResults at 30', async () => {
      mock.onGet().reply({ value: [] })

      await service.getMessagesList(100)

      expect(mock.history[0].url).toBe(`${API_BASE}/messages?$top=30`)
    })

    it('builds filter and search query params', async () => {
      mock.onGet().reply({ value: [] })

      await service.getMessagesList(
        5,
        'jane@company.com',
        'Report',
        '2024-12-01T00:00:00Z',
        '2024-12-31T00:00:00Z',
        true
      )

      const url = decodeURIComponent(mock.history[0].url)

      expect(url).toContain("from/emailAddress/address eq 'jane@company.com'")
      expect(url).toContain('isRead eq false')
      expect(url).toContain('receivedDateTime ge 2024-12-01T00:00:00.000Z')
      expect(url).toContain('receivedDateTime le 2024-12-31T00:00:00.000Z')
      expect(url).toContain('$search="subject:Report"')
      expect(url).toContain('$top=5')
    })

    it('uses "isRead eq true" when loadUnread is false', async () => {
      mock.onGet().reply({ value: [] })

      await service.getMessagesList(10, null, null, null, null, false)

      expect(mock.history[0].url).toContain('isRead eq true')
    })

    it('uses nextLink verbatim and ignores other parameters', async () => {
      const nextLink = `${API_BASE}/messages?$skip=10`

      mock.onGet(nextLink).reply({ value: [] })

      await service.getMessagesList(5, 'jane@company.com', 'Report', null, null, true, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
    })

    it('flattens toRecipients to email address objects', async () => {
      mock.onGet().reply({
        '@odata.nextLink': `${API_BASE}/messages?$skip=10`,
        value: [
          {
            id: 'm1',
            subject: 'Team Meeting',
            toRecipients: [{ emailAddress: { name: 'Jane', address: 'jane@company.com' } }],
          },
        ],
      })

      const result = await service.getMessagesList(1)

      expect(result['@odata.nextLink']).toBe(`${API_BASE}/messages?$skip=10`)
      expect(result.value[0].toRecipients).toEqual([{ name: 'Jane', address: 'jane@company.com' }])
    })

    it('returns an empty value array when the response has no messages', async () => {
      mock.onGet().reply({ '@odata.context': 'ctx' })

      const result = await service.getMessagesList()

      expect(result.value).toEqual([])
    })

    it('throws when the API fails', async () => {
      mock.onGet().replyWithError({ message: 'Mailbox not found' })

      await expect(service.getMessagesList()).rejects.toThrow('Mailbox not found')
    })
  })

  describe('sendMessage', () => {
    it('sends a minimal message', async () => {
      mock.onPost(`${API_BASE}/sendMail`).reply({ id: 'sent-1' })

      const result = await service.sendMessage('to@company.com', null, 'Hello', 'HTML', '<p>Hi</p>')

      expect(result).toEqual({ id: 'sent-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/sendMail`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].body).toEqual({
        message: {
          subject: 'Hello',
          body: { contentType: 'HTML', content: '<p>Hi</p>' },
          toRecipients: [{ emailAddress: { address: 'to@company.com' } }],
        },
      })
    })

    it('includes cc, bcc and sender when provided', async () => {
      mock.onPost(`${API_BASE}/sendMail`).reply({ id: 'sent-2' })

      await service.sendMessage(
        'to@company.com',
        'shared@company.com',
        'Hello',
        'Text',
        'Hi',
        'cc@company.com',
        'bcc@company.com'
      )

      expect(mock.history[0].body.message).toMatchObject({
        ccRecipients: [{ emailAddress: { address: 'cc@company.com' } }],
        bccRecipients: [{ emailAddress: { address: 'bcc@company.com' } }],
        sender: { emailAddress: { address: 'shared@company.com' } },
      })
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/sendMail`).replyWithError({ message: 'Invalid recipient' })

      await expect(service.sendMessage('bad', null, 's', 'Text', 'b')).rejects.toThrow('Invalid recipient')
    })
  })

  describe('replyToMessage', () => {
    it('posts a reply to the message', async () => {
      mock.onPost(`${API_BASE}/messages/m1/reply`).reply({ id: 'r1' })

      const result = await service.replyToMessage('m1', 'HTML', '<p>Thanks</p>')

      expect(result).toEqual({ id: 'r1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        message: { body: { contentType: 'HTML', content: '<p>Thanks</p>' } },
      })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.replyToMessage(null, 'HTML', 'x')).rejects.toThrow('Message ID is required parameter')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/messages/m1/reply`).replyWithError({ message: 'Message not found' })

      await expect(service.replyToMessage('m1', 'Text', 'x')).rejects.toThrow('Message not found')
    })
  })

  describe('createDraftEmail', () => {
    it('creates a draft addressed to a recipient', async () => {
      mock.onPost(`${API_BASE}/messages`).reply({ id: 'd1', isDraft: true })

      const result = await service.createDraftEmail('to@company.com', null, 'Subject', 'HTML', '<p>Body</p>')

      expect(result).toEqual({ id: 'd1', isDraft: true })
      expect(mock.history[0].body).toEqual({
        subject: 'Subject',
        body: { contentType: 'HTML', content: '<p>Body</p>' },
        toRecipients: [{ emailAddress: { address: 'to@company.com' } }],
      })
    })

    it('prefers conversationId over the recipient', async () => {
      mock.onPost(`${API_BASE}/messages`).reply({ id: 'd2' })

      await service.createDraftEmail('to@company.com', null, 'Subject', 'Text', 'Body', null, null, 'conv-1')

      expect(mock.history[0].body.conversationId).toBe('conv-1')
      expect(mock.history[0].body.toRecipients).toBeUndefined()
    })

    it('maps cc/bcc arrays and the from address', async () => {
      mock.onPost(`${API_BASE}/messages`).reply({ id: 'd3' })

      await service.createDraftEmail(
        'to@company.com',
        'shared@company.com',
        'Subject',
        'Text',
        'Body',
        ['cc1@company.com', 'cc2@company.com'],
        ['bcc@company.com']
      )

      expect(mock.history[0].body).toMatchObject({
        ccRecipients: [
          { emailAddress: { address: 'cc1@company.com' } },
          { emailAddress: { address: 'cc2@company.com' } },
        ],
        bccRecipients: [{ emailAddress: { address: 'bcc@company.com' } }],
        from: { emailAddress: { address: 'shared@company.com' } },
      })
    })

    it('omits recipients when neither "to" nor conversationId is provided', async () => {
      mock.onPost(`${API_BASE}/messages`).reply({ id: 'd4' })

      await service.createDraftEmail(null, null, 'Subject', 'Text', 'Body')

      expect(mock.history[0].body).toEqual({
        subject: 'Subject',
        body: { contentType: 'Text', content: 'Body' },
      })
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/messages`).replyWithError({ message: 'Draft rejected' })

      await expect(service.createDraftEmail('to@company.com', null, 's', 'Text', 'b')).rejects.toThrow(
        'Draft rejected'
      )
    })
  })

  describe('sendDraftEmail', () => {
    it('posts to the draft send endpoint', async () => {
      mock.onPost(`${API_BASE}/messages/d1/send`).reply({ id: 'd1' })

      const result = await service.sendDraftEmail('d1')

      expect(result).toEqual({ id: 'd1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws when draftId is missing', async () => {
      await expect(service.sendDraftEmail()).rejects.toThrow("The 'draftId' parameter is required.")
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/messages/d1/send`).replyWithError({ message: 'Draft not found' })

      await expect(service.sendDraftEmail('d1')).rejects.toThrow('Draft not found')
    })
  })

  describe('markEmailAsUnread', () => {
    it('patches the message with isRead false', async () => {
      mock.onPatch(`${API_BASE}/messages/m1`).reply({ id: 'm1', isRead: false })

      const result = await service.markEmailAsUnread('m1')

      expect(result).toEqual({ id: 'm1', isRead: false })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ isRead: false })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.markEmailAsUnread('')).rejects.toThrow('Parameter "Message ID" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the API fails', async () => {
      mock.onPatch(`${API_BASE}/messages/m1`).replyWithError({ message: 'Message not found' })

      await expect(service.markEmailAsUnread('m1')).rejects.toThrow('Message not found')
    })
  })

  // ── Calendar Management ──

  describe('createEvent', () => {
    it('creates an event with required fields only', async () => {
      mock.onPost(`${API_BASE}/events`).reply({ id: 'e1' })

      const result = await service.createEvent(
        'Team Meeting',
        '2024-12-15T10:00:00',
        '2024-12-15T11:00:00',
        'America/New_York'
      )

      expect(result).toEqual({ id: 'e1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/events`)
      expect(mock.history[0].body).toEqual({
        subject: 'Team Meeting',
        start: { dateTime: '2024-12-15T10:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2024-12-15T11:00:00', timeZone: 'America/New_York' },
        body: { contentType: 'HTML', content: undefined },
      })
    })

    it('includes location, description and attendees when provided', async () => {
      mock.onPost(`${API_BASE}/events`).reply({ id: 'e2' })

      await service.createEvent(
        'Team Meeting',
        '2024-12-15T10:00:00',
        '2024-12-15T11:00:00',
        'America/New_York',
        'Conference Room A',
        'Weekly sync',
        ['jane@company.com']
      )

      expect(mock.history[0].body).toMatchObject({
        location: { displayName: 'Conference Room A' },
        body: { contentType: 'HTML', content: 'Weekly sync' },
        attendees: [{ emailAddress: { address: 'jane@company.com' }, type: 'required' }],
      })
    })

    it('ignores a non-array attendees value', async () => {
      mock.onPost(`${API_BASE}/events`).reply({ id: 'e3' })

      await service.createEvent('S', 'start', 'end', 'UTC', null, null, 'jane@company.com')

      expect(mock.history[0].body.attendees).toBeUndefined()
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/events`).replyWithError({ message: 'Invalid time zone' })

      await expect(service.createEvent('S', 'start', 'end', 'Bad/Zone')).rejects.toThrow('Invalid time zone')
    })
  })

  describe('deleteEvent', () => {
    it('sends a DELETE request for the event', async () => {
      mock.onDelete(`${API_BASE}/events/e1`).reply({ message: 'Event deleted successfully' })

      const result = await service.deleteEvent('e1')

      expect(result).toEqual({ message: 'Event deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/events/e1`)
    })

    it('throws when eventId is missing', async () => {
      await expect(service.deleteEvent()).rejects.toThrow('Parameter "Event ID" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the API fails', async () => {
      mock.onDelete(`${API_BASE}/events/e1`).replyWithError({ message: 'Event not found' })

      await expect(service.deleteEvent('e1')).rejects.toThrow('Event not found')
    })
  })

  describe('updateCalendarEvent', () => {
    it('patches only the provided fields', async () => {
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      const result = await service.updateCalendarEvent('e1', 'Updated Subject')

      expect(result).toEqual({ id: 'e1' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ subject: 'Updated Subject' })
    })

    it('patches subject, body, times and attendees', async () => {
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      await service.updateCalendarEvent(
        'e1',
        'Updated Subject',
        '<p>New body</p>',
        '2024-12-15T10:00:00',
        '2024-12-15T11:00:00',
        'America/New_York',
        ['jane@company.com']
      )

      expect(mock.history[0].body).toEqual({
        subject: 'Updated Subject',
        body: { contentType: 'HTML', content: '<p>New body</p>' },
        start: { dateTime: '2024-12-15T10:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2024-12-15T11:00:00', timeZone: 'America/New_York' },
        attendees: [{ emailAddress: { address: 'jane@company.com' }, type: 'required' }],
      })
    })

    it('skips start/end when the time zone is missing', async () => {
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      await service.updateCalendarEvent('e1', null, null, '2024-12-15T10:00:00', '2024-12-15T11:00:00')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws when eventId is missing', async () => {
      await expect(service.updateCalendarEvent(null, 'Subject')).rejects.toThrow('Parameter "Event ID" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the API fails', async () => {
      mock.onPatch(`${API_BASE}/events/e1`).replyWithError({ message: 'Event not found' })

      await expect(service.updateCalendarEvent('e1', 'Subject')).rejects.toThrow('Event not found')
    })
  })

  describe('addAttendeesToCalendarEvent', () => {
    it('merges new attendees with the existing ones', async () => {
      mock.onGet(`${API_BASE}/events/e1`).reply({
        id: 'e1',
        attendees: [{ emailAddress: { address: 'john@company.com' }, type: 'required' }],
      })
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      const result = await service.addAttendeesToCalendarEvent('e1', ['jane@company.com'])

      expect(result).toEqual({ id: 'e1' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('patch')
      expect(mock.history[1].body).toEqual({
        attendees: [
          { emailAddress: { address: 'john@company.com' }, type: 'required' },
          { emailAddress: { address: 'jane@company.com' }, type: 'required' },
        ],
      })
    })

    it('accepts a single attendee as a string', async () => {
      mock.onGet(`${API_BASE}/events/e1`).reply({ id: 'e1' })
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      await service.addAttendeesToCalendarEvent('e1', 'jane@company.com')

      expect(mock.history[1].body).toEqual({
        attendees: [{ emailAddress: { address: 'jane@company.com' }, type: 'required' }],
      })
    })

    it('does not duplicate attendees that are already on the event', async () => {
      mock.onGet(`${API_BASE}/events/e1`).reply({
        id: 'e1',
        attendees: [{ emailAddress: { address: 'jane@company.com' }, type: 'required' }],
      })
      mock.onPatch(`${API_BASE}/events/e1`).reply({ id: 'e1' })

      await service.addAttendeesToCalendarEvent('e1', ['jane@company.com'])

      expect(mock.history[1].body.attendees).toHaveLength(1)
    })

    it('throws when eventId is missing', async () => {
      await expect(service.addAttendeesToCalendarEvent(null, ['jane@company.com'])).rejects.toThrow(
        'Parameter "Event ID" is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when attendees is missing', async () => {
      await expect(service.addAttendeesToCalendarEvent('e1')).rejects.toThrow(
        'Parameter "Attendees" is required and cannot be empty'
      )
    })

    it('throws when attendees is an empty array', async () => {
      await expect(service.addAttendeesToCalendarEvent('e1', [])).rejects.toThrow(
        'Parameter "Attendees" is required and cannot be empty'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when fetching the event fails', async () => {
      mock.onGet(`${API_BASE}/events/e1`).replyWithError({ message: 'Event not found' })

      await expect(service.addAttendeesToCalendarEvent('e1', ['jane@company.com'])).rejects.toThrow('Event not found')
    })
  })

  // ── Contact Management ──

  describe('createContact', () => {
    it('creates a contact with the first name only', async () => {
      mock.onPost(`${API_BASE}/contacts`).reply({ id: 'ct1' })

      const result = await service.createContact('John')

      expect(result).toEqual({ id: 'ct1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/contacts`)
      expect(mock.history[0].body).toEqual({ givenName: 'John' })
    })

    it('creates a contact with all fields', async () => {
      mock.onPost(`${API_BASE}/contacts`).reply({ id: 'ct2' })

      await service.createContact(
        'John',
        'Smith',
        'Q',
        ['john@company.com', 'js@company.com'],
        '555-123-4567',
        'Acme Corp',
        'Team lead'
      )

      expect(mock.history[0].body).toEqual({
        givenName: 'John',
        surname: 'Smith',
        middleName: 'Q',
        mobilePhone: '555-123-4567',
        companyName: 'Acme Corp',
        personalNotes: 'Team lead',
        emailAddresses: [{ address: 'john@company.com' }, { address: 'js@company.com' }],
      })
    })

    it('wraps a single email string into an array', async () => {
      mock.onPost(`${API_BASE}/contacts`).reply({ id: 'ct3' })

      await service.createContact('John', null, null, 'john@company.com')

      expect(mock.history[0].body.emailAddresses).toEqual([{ address: 'john@company.com' }])
    })

    it('throws when the API fails', async () => {
      mock.onPost(`${API_BASE}/contacts`).replyWithError({ message: 'Invalid contact' })

      await expect(service.createContact('John')).rejects.toThrow('Invalid contact')
    })
  })

  describe('updateContact', () => {
    it('patches the contact with the provided fields', async () => {
      mock.onPatch(`${API_BASE}/contacts/ct1`).reply({ id: 'ct1' })

      const result = await service.updateContact('ct1', 'John', 'Smith')

      expect(result).toEqual({ id: 'ct1' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${API_BASE}/contacts/ct1`)
      expect(mock.history[0].body).toEqual({ givenName: 'John', surname: 'Smith' })
    })

    it('maps emails and remaining fields', async () => {
      mock.onPatch(`${API_BASE}/contacts/ct1`).reply({ id: 'ct1' })

      await service.updateContact(
        'ct1',
        null,
        null,
        null,
        'john@company.com',
        '555-000',
        'Updated Corp',
        'Updated notes'
      )

      expect(mock.history[0].body).toEqual({
        mobilePhone: '555-000',
        companyName: 'Updated Corp',
        personalNotes: 'Updated notes',
        emailAddresses: [{ address: 'john@company.com' }],
      })
    })

    it('throws when the API fails', async () => {
      mock.onPatch(`${API_BASE}/contacts/ct1`).replyWithError({ message: 'Contact not found' })

      await expect(service.updateContact('ct1', 'John')).rejects.toThrow('Contact not found')
    })
  })

  // ── Shared request behavior ──

  describe('authorization headers', () => {
    it('sends the OAuth access token on every API request', async () => {
      mock.onGet(API_BASE).reply({ id: 'u1' })
      mock.onPost(`${API_BASE}/sendMail`).reply({ id: 's1' })
      mock.onDelete(`${API_BASE}/events/e1`).reply({})

      await service.getUserProfile()
      await service.sendMessage('to@company.com', null, 's', 'Text', 'b')
      await service.deleteEvent('e1')

      expect(mock.history).toHaveLength(3)
      mock.history.forEach(call => {
        expect(call.headers).toMatchObject(AUTH_HEADER)
      })
    })
  })
})
