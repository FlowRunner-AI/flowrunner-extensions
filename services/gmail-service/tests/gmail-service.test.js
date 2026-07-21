'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const API_BASE = 'https://gmail.googleapis.com/gmail/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

/**
 * Build a raw Gmail API message response that satisfies parse-gmail-email.
 * The library requires: payload.headers, internalDate (numeric ms string).
 */
function makeRawMessage(id, overrides = {}) {
  return {
    id,
    snippet: overrides.snippet || 'Test snippet',
    threadId: overrides.threadId || 'thread-1',
    labelIds: overrides.labelIds || ['INBOX'],
    internalDate: '1704067200000', // 2024-01-01T00:00:00Z
    payload: {
      headers: [
        { name: 'Subject', value: overrides.subject || 'Test Subject' },
        { name: 'From', value: overrides.from || 'sender@example.com' },
        { name: 'To', value: overrides.to || 'recipient@example.com' },
        { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
      ],
      mimeType: 'text/plain',
      body: { data: '' },
    },
    ...overrides,
  }
}

describe('Gmail Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result).toMatchObject({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        overwrite: true,
      })
      expect(result.connectionIdentityName).toContain('Test User')
      expect(result.connectionIdentityName).toContain('test@gmail.com')
      expect(result.connectionIdentityImageURL).toBe('https://example.com/photo.jpg')
      expect(result.userData).toMatchObject({ name: 'Test User', email: 'test@gmail.com' })

      // First call is the token exchange POST
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })
  })

  // ── Dictionary Methods ──

  describe('getLabelsDictionary', () => {
    it('returns all labels when no search provided', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'SENT', name: 'Sent' },
        ],
      })

      const result = await service.getLabelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Inbox', note: 'ID: INBOX', value: 'INBOX' },
        { label: 'Sent', note: 'ID: SENT', value: 'SENT' },
      ])
    })

    it('filters labels by search string', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'SENT', name: 'Sent' },
          { id: 'SPAM', name: 'Spam' },
        ],
      })

      const result = await service.getLabelsDictionary({ search: 'sent' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('SENT')
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }],
      })

      const result = await service.getLabelsDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getMessageLabelsDictionary', () => {
    it('returns label IDs for a message', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply({
        labelIds: ['INBOX', 'IMPORTANT', 'UNREAD'],
      })

      const result = await service.getMessageLabelsDictionary({
        search: null,
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'INBOX', note: 'ID: INBOX', value: 'INBOX' })
    })

    it('filters label IDs by search', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply({
        labelIds: ['INBOX', 'IMPORTANT', 'UNREAD'],
      })

      const result = await service.getMessageLabelsDictionary({
        search: 'unread',
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('UNREAD')
    })

    it('throws when messageId is missing', async () => {
      await expect(
        service.getMessageLabelsDictionary({ search: null, criteria: { messageId: '' } })
      ).rejects.toThrow('"Message ID" is a required argument')
    })
  })

  describe('getAttachmentsDictionary', () => {
    it('returns attachments for a message', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply({
        payload: {
          parts: [
            { filename: 'report.pdf', body: { attachmentId: 'att-1' } },
            { filename: 'image.png', body: { attachmentId: 'att-2' } },
            { filename: '', body: {} }, // not an attachment
          ],
        },
      })

      const result = await service.getAttachmentsDictionary({
        search: null,
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'report.pdf', note: 'ID: att-1', value: 'att-1' })
    })

    it('returns empty items when message has no parts', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply({
        payload: {},
      })

      const result = await service.getAttachmentsDictionary({
        search: null,
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toEqual([])
    })

    it('filters attachments by search', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply({
        payload: {
          parts: [
            { filename: 'report.pdf', body: { attachmentId: 'att-1' } },
            { filename: 'image.png', body: { attachmentId: 'att-2' } },
          ],
        },
      })

      const result = await service.getAttachmentsDictionary({
        search: 'report',
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('att-1')
    })
  })

  describe('getMessagesDictionary', () => {
    it('returns messages with pagination', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
        nextPageToken: 'page2',
      })

      // Each message will be fetched individually via getMessage
      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Hello world' }))
      mock.onGet(`${API_BASE}/users/me/messages/msg-2`).reply(makeRawMessage('msg-2', { snippet: 'Test message' }))

      const result = await service.getMessagesDictionary({ search: null, cursor: null })

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ value: 'msg-1' })
    })

    it('handles empty messages list', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: null,
        nextPageToken: null,
      })

      const result = await service.getMessagesDictionary({ search: null, cursor: null })

      expect(result.items).toEqual([])
    })
  })

  describe('getDraftsDictionary', () => {
    it('returns drafts with pagination', async () => {
      mock.onGet(`${API_BASE}/users/me/drafts`).reply({
        drafts: [{ id: 'draft-1' }],
        nextPageToken: 'page2',
      })

      // getDraft fetches each draft individually
      mock.onGet(`${API_BASE}/users/me/drafts/draft-1`).reply({
        id: 'draft-1',
        message: { snippet: 'Draft content' },
      })

      const result = await service.getDraftsDictionary({ search: null, cursor: null })

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: 'Draft content',
        value: 'draft-1',
      })
    })

    it('handles empty drafts list', async () => {
      mock.onGet(`${API_BASE}/users/me/drafts`).reply({
        drafts: null,
        nextPageToken: null,
      })

      const result = await service.getDraftsDictionary({ search: null, cursor: null })

      expect(result.items).toEqual([])
    })
  })

  describe('getThreadsDictionary', () => {
    it('returns threads with pagination', async () => {
      mock.onGet(`${API_BASE}/users/me/threads`).reply({
        threads: [
          { id: 'thread-1', snippet: 'Thread one' },
          { id: 'thread-2', snippet: 'Thread two' },
        ],
        nextPageToken: 'next-page',
      })

      const result = await service.getThreadsDictionary({ search: null, cursor: null })

      expect(result.cursor).toBe('next-page')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Thread one',
        note: 'ID: thread-1',
        value: 'thread-1',
      })
    })

    it('filters threads by search', async () => {
      mock.onGet(`${API_BASE}/users/me/threads`).reply({
        threads: [
          { id: 'thread-1', snippet: 'Meeting notes' },
          { id: 'thread-2', snippet: 'Invoice details' },
        ],
        nextPageToken: null,
      })

      const result = await service.getThreadsDictionary({ search: 'invoice' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('thread-2')
    })
  })

  // ── Action Methods ──

  describe('getMessage', () => {
    it('fetches and parses a message by ID', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-123`).reply(makeRawMessage('msg-123', { snippet: 'Hello' }))

      const result = await service.getMessage('msg-123')

      expect(result).toHaveProperty('id', 'msg-123')
      expect(result).toHaveProperty('snippet')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${API_BASE}/users/me/messages/msg-123`)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${OAUTH_TOKEN}`,
      })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.getMessage('')).rejects.toThrow('"Message ID" is a required argument')
    })
  })

  describe('getMessagesList', () => {
    it('returns messages without content by default', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
      })

      // ensureExistedLabelIdsList needs labels API when labels provided
      const result = await service.getMessagesList('test query', false, 5, null, false, false)

      expect(result).toEqual([{ id: 'msg-1' }, { id: 'msg-2' }])
      expect(mock.history[0].query).toMatchObject({
        q: 'test query',
        maxResults: 5,
      })
    })

    it('loads unread messages when loadUnread is true', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      await service.getMessagesList(null, true, null, null, false, false)

      expect(mock.history[0].query.q).toBe('is:unread')
    })

    it('clamps maxResults to 30', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, 100, null, false, false)

      expect(mock.history[0].query.maxResults).toBe(30)
    })

    it('defaults maxResults to 10', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, null, null, false, false)

      expect(mock.history[0].query.maxResults).toBe(10)
    })

    it('fetches full content when includeContent is true', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Full content' }))

      const result = await service.getMessagesList(null, false, 1, null, false, true)

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('id', 'msg-1')
      // Should have made 2 requests: list + detail
      expect(mock.history).toHaveLength(2)
    })

    it('includes spam and trash when specified', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, null, null, true, false)

      expect(mock.history[0].query.includeSpamTrash).toBe(true)
    })

    it('resolves label IDs when labels provided', async () => {
      // First call: getLabels for ensureExistedLabelIdsList
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [
          { id: 'Label_1', name: 'Work' },
          { id: 'Label_2', name: 'Personal' },
        ],
      })

      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      await service.getMessagesList(null, false, null, ['Work'], false, false)

      // The messages request should have labelIds
      const messagesRequest = mock.history.find(h => h.url.includes('/messages') && !h.url.includes('/labels'))

      expect(messagesRequest.query.labelIds).toEqual(['Label_1'])
    })
  })

  describe('sendMessage', () => {
    it('sends a basic email', async () => {
      // getCurrentAccountInfo is called (possibly twice)
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onPost(`${API_BASE}/users/me/messages/send`).reply({
        id: 'sent-msg-1',
        threadId: 'thread-1',
        labelIds: ['SENT'],
      })

      const result = await service.sendMessage(
        'recipient@example.com',
        'Test Subject',
        'plain',
        'Hello World',
        null, // from - will be fetched
        null, // cc
        null, // bcc
        null, // threadId
        null  // attachments
      )

      expect(result).toMatchObject({
        id: 'sent-msg-1',
        threadId: 'thread-1',
        labelIds: ['SENT'],
      })

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))

      expect(sendRequest.body).toHaveProperty('raw')
      expect(sendRequest.headers).toMatchObject({
        Authorization: `Bearer ${OAUTH_TOKEN}`,
      })
    })

    it('includes threadId and thread headers when replying', async () => {
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onGet(`${API_BASE}/users/me/threads/thread-1`).reply({
        messages: [
          {
            payload: {
              headers: [
                { name: 'Message-ID', value: '<original-msg-id@gmail.com>' },
                { name: 'References', value: '<older-ref@gmail.com>' },
              ],
            },
          },
        ],
      })

      mock.onPost(`${API_BASE}/users/me/messages/send`).reply({
        id: 'reply-msg-1',
        threadId: 'thread-1',
        labelIds: ['SENT'],
      })

      const result = await service.sendMessage(
        'recipient@example.com',
        'Re: Test',
        'plain',
        'Reply body',
        'Sender Name',
        null,
        null,
        'thread-1',
        null
      )

      expect(result).toHaveProperty('id', 'reply-msg-1')

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))

      expect(sendRequest.body.threadId).toBe('thread-1')
    })

    it('sends with explicit from address', async () => {
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onPost(`${API_BASE}/users/me/messages/send`).reply({
        id: 'sent-msg-2',
        threadId: 'thread-2',
        labelIds: ['SENT'],
      })

      await service.sendMessage(
        'recipient@example.com',
        'Subject',
        'html',
        '<p>Hello</p>',
        'Custom Sender',
        ['cc@example.com'],
        ['bcc@example.com'],
        null,
        null
      )

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))

      expect(sendRequest.body).toHaveProperty('raw')
    })
  })

  describe('addLabelToMessage', () => {
    it('adds existing labels to a message', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [
          { id: 'Label_1', name: 'Work' },
          { id: 'Label_2', name: 'Personal' },
        ],
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'Label_1'],
      })

      const result = await service.addLabelToMessage('msg-1', ['Work'])

      expect(result).toEqual({ labelIds: ['INBOX', 'Label_1'] })

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.addLabelIds).toEqual(['Label_1'])
    })

    it('creates new labels when they do not exist', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'Label_1', name: 'Work' }],
      })

      // createLabel POST
      mock.onPost(`${API_BASE}/users/me/labels`).reply({
        id: 'Label_New',
        name: 'NewLabel',
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'Label_New'],
      })

      const result = await service.addLabelToMessage('msg-1', ['NewLabel'])

      expect(result).toHaveProperty('labelIds')
    })

    it('accepts a string label (converts to array)', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }],
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX'],
      })

      const result = await service.addLabelToMessage('msg-1', 'INBOX')

      expect(result).toEqual({ labelIds: ['INBOX'] })
    })

    it('throws when labels is not string or array', async () => {
      await expect(
        service.addLabelToMessage('msg-1', 12345)
      ).rejects.toThrow('The Label(s) argument must be a string or a list of strings')
    })

    it('throws when messageId is missing', async () => {
      await expect(
        service.addLabelToMessage('', ['Work'])
      ).rejects.toThrow('"Message ID" is a required argument')
    })
  })

  describe('removeLabelFromMessage', () => {
    it('removes labels from a message', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'UNREAD', name: 'Unread' },
        ],
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX'],
      })

      const result = await service.removeLabelFromMessage('msg-1', ['UNREAD'])

      expect(result).toEqual({ labelIds: ['INBOX'] })

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.removeLabelIds).toEqual(['UNREAD'])
    })

    it('throws when messageId is missing', async () => {
      await expect(
        service.removeLabelFromMessage('', ['UNREAD'])
      ).rejects.toThrow('"Message ID" is a required argument')
    })
  })

  describe('markMessageAsRead', () => {
    it('removes UNREAD label from message', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'UNREAD', name: 'Unread' }],
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX'],
      })

      await service.markMessageAsRead('msg-1')

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.removeLabelIds).toEqual(['UNREAD'])
    })
  })

  describe('markMessageAsUnread', () => {
    it('adds UNREAD label to message', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'UNREAD', name: 'Unread' }],
      })

      mock.onPost(`${API_BASE}/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'UNREAD'],
      })

      await service.markMessageAsUnread('msg-1')

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.addLabelIds).toEqual(['UNREAD'])
    })
  })

  describe('createLabel', () => {
    it('creates a label with all options', async () => {
      mock.onPost(`${API_BASE}/users/me/labels`).reply({
        id: 'Label_New',
        name: 'TestLabel',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
      })

      const result = await service.createLabel(
        'TestLabel', 'labelShow', 'show', '#ff0000', '#ffffff'
      )

      expect(result).toMatchObject({
        id: 'Label_New',
        name: 'TestLabel',
      })

      expect(mock.history[0].body).toEqual({
        name: 'TestLabel',
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color: { backgroundColor: '#ff0000', textColor: '#ffffff' },
      })
    })

    it('creates a label with only name', async () => {
      mock.onPost(`${API_BASE}/users/me/labels`).reply({
        id: 'Label_Simple',
        name: 'Simple',
      })

      await service.createLabel('Simple', null, null, null, null)

      expect(mock.history[0].body).toEqual({ name: 'Simple' })
    })

    it('omits color when only backgroundColor is provided', async () => {
      mock.onPost(`${API_BASE}/users/me/labels`).reply({
        id: 'Label_NoColor',
        name: 'NoColor',
      })

      await service.createLabel('NoColor', null, null, '#ff0000', null)

      expect(mock.history[0].body).toEqual({ name: 'NoColor' })
      expect(mock.history[0].body.color).toBeUndefined()
    })
  })

  describe('deleteMessages', () => {
    it('trashes messages by default', async () => {
      mock.onPost(`${API_BASE}/users/me/messages/msg-1/trash`).reply({})
      mock.onPost(`${API_BASE}/users/me/messages/msg-2/trash`).reply({})

      const result = await service.deleteMessages(['msg-1', 'msg-2'], false)

      expect(result).toEqual({ successCount: 2, failsCount: 0 })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${API_BASE}/users/me/messages/msg-1/trash`)
    })

    it('permanently deletes messages when flag is true', async () => {
      mock.onDelete(`${API_BASE}/users/me/messages/msg-1`).reply({})

      const result = await service.deleteMessages(['msg-1'], true)

      expect(result).toEqual({ successCount: 1, failsCount: 0 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/users/me/messages/msg-1`)
    })

    it('accepts a string messageId (converts to array)', async () => {
      mock.onPost(`${API_BASE}/users/me/messages/msg-1/trash`).reply({})

      const result = await service.deleteMessages('msg-1', false)

      expect(result).toEqual({ successCount: 1, failsCount: 0 })
    })

    it('throws when more than 15 messages', async () => {
      const ids = Array.from({ length: 16 }, (_, i) => `msg-${i}`)

      await expect(service.deleteMessages(ids, false))
        .rejects.toThrow('The number of messages to delete must not exceed 15.')
    })
  })

  describe('getAttachment', () => {
    it('fetches an attachment by message and attachment ID', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 12345,
        data: 'base64data',
      })

      const result = await service.getAttachment('msg-1', 'att-1')

      expect(result).toEqual({ size: 12345, data: 'base64data' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${OAUTH_TOKEN}`,
      })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.getAttachment('', 'att-1'))
        .rejects.toThrow('"Message ID" is a required argument')
    })

    it('throws when attachmentId is missing', async () => {
      await expect(service.getAttachment('msg-1', ''))
        .rejects.toThrow('"Attachment ID" is a required argument')
    })
  })

  describe('saveAttachment', () => {
    it('saves attachment to Flowrunner Files', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 100,
        data: 'SGVsbG8gV29ybGQ', // base64url for "Hello World" (roughly)
      })

      // Mock flowrunner.Files
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({
            url: 'https://files.example.com/attachments/doc.pdf',
          }),
        },
      }

      const result = await service.saveAttachment('msg-1', 'att-1', 'doc.pdf', null)

      expect(result).toEqual({ fileUrl: 'https://files.example.com/attachments/doc.pdf' })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'doc.pdf',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('uses custom fileOptions when provided', async () => {
      mock.onGet(`${API_BASE}/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 100,
        data: 'SGVsbG8',
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({
            url: 'https://files.example.com/attachments/doc.pdf',
          }),
        },
      }

      await service.saveAttachment('msg-1', 'att-1', 'doc.pdf', { scope: 'APP' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'APP' })
      )
    })

    it('throws when fileName is missing', async () => {
      await expect(service.saveAttachment('msg-1', 'att-1', '', null))
        .rejects.toThrow('"File Name" is a required argument')
    })
  })

  describe('deleteDraft', () => {
    it('deletes a draft by ID', async () => {
      mock.onDelete(`${API_BASE}/users/me/drafts/draft-1`).reply({})

      await service.deleteDraft('draft-1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/users/me/drafts/draft-1`)
    })

    it('throws when draftId is missing', async () => {
      await expect(service.deleteDraft('')).rejects.toThrow('"Draft ID" is a required argument')
    })
  })

  describe('sendDraft', () => {
    it('sends a draft and returns formatted result', async () => {
      mock.onPost(`${API_BASE}/users/me/drafts/send`).reply({
        id: 'sent-msg-1',
        threadId: 'thread-1',
        labelIds: ['SENT', 'UNREAD'],
      })

      const result = await service.sendDraft('draft-1')

      expect(result).toEqual({
        messageId: 'sent-msg-1',
        messageThreadId: 'thread-1',
        messageLabelIds: ['SENT', 'UNREAD'],
      })
      expect(mock.history[0].body).toEqual({ id: 'draft-1' })
    })
  })

  describe('createDraft', () => {
    it('creates a draft with required fields', async () => {
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onPost(`${API_BASE}/users/me/drafts`).reply({
        id: 'draft-new',
        message: {
          id: 'msg-new',
          threadId: 'thread-new',
          labelIds: ['DRAFT'],
        },
      })

      const result = await service.createDraft(
        'recipient@example.com',
        'Draft Subject',
        'plain',
        'Draft body',
        null, null, null, null, null
      )

      expect(result).toEqual({
        id: 'draft-new',
        messageId: 'msg-new',
        messageThreadId: 'thread-new',
        messageLabelIds: ['DRAFT'],
      })

      const draftRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/drafts'))

      expect(draftRequest.body.message).toHaveProperty('raw')
    })

    it('includes threadId when provided', async () => {
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onPost(`${API_BASE}/users/me/drafts`).reply({
        id: 'draft-new',
        message: {
          id: 'msg-new',
          threadId: 'thread-1',
          labelIds: ['DRAFT'],
        },
      })

      await service.createDraft(
        'recipient@example.com',
        'Draft Subject',
        'html',
        '<p>Draft</p>',
        'Sender',
        null, null,
        'thread-1',
        null
      )

      const draftRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/drafts'))

      expect(draftRequest.body.message.threadId).toBe('thread-1')
    })
  })

  describe('getDraftsList', () => {
    it('returns a list of drafts', async () => {
      mock.onGet(`${API_BASE}/users/me/drafts`).reply({
        drafts: [
          { id: 'draft-1', message: { id: 'msg-1', threadId: 'thread-1' } },
          { id: 'draft-2', message: { id: 'msg-2', threadId: 'thread-2' } },
        ],
      })

      const result = await service.getDraftsList(null, null, false)

      expect(result).toEqual([
        { id: 'draft-1', messageThreadId: 'thread-1', messageMessageId: 'msg-1' },
        { id: 'draft-2', messageThreadId: 'thread-2', messageMessageId: 'msg-2' },
      ])
    })

    it('passes query and includeSpamTrash params', async () => {
      mock.onGet(`${API_BASE}/users/me/drafts`).reply({
        drafts: [],
      })

      await service.getDraftsList('invoice', null, true)

      expect(mock.history[0].query).toMatchObject({
        q: 'invoice',
        includeSpamTrash: true,
      })
    })
  })

  // ── Trigger Methods ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct event handler', async () => {
      mock.onGet(`${API_BASE}/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }],
      })

      const invocation = {
        eventName: 'onNewLabel',
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  describe('onNewEmail', () => {
    it('returns latest message in learning mode', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Latest email' }))

      const result = await service.onNewEmail({
        learningMode: true,
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toHaveProperty('id', 'msg-1')
      expect(result.state).toBeNull()
    })

    it('initializes state on first run', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-latest' }],
      })

      const result = await service.onNewEmail({
        learningMode: false,
        state: null,
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({
        initialized: true,
        latestMessageId: 'msg-latest',
      })
    })

    it('detects new messages on subsequent runs', async () => {
      // First call: getMessagesList without content
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-new' }, { id: 'msg-old' }],
      })

      // Second call: getMessage for the new message
      mock.onGet(`${API_BASE}/users/me/messages/msg-new`).reply(makeRawMessage('msg-new', { snippet: 'New message' }))

      const result = await service.onNewEmail({
        learningMode: false,
        state: { initialized: true, latestMessageId: 'msg-old' },
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toHaveProperty('id', 'msg-new')
      expect(result.state.latestMessageId).toBe('msg-new')
    })
  })

  describe('onNewAttachment', () => {
    it('returns latest attachment message in learning mode', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-att-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/msg-att-1`).reply({
        id: 'msg-att-1',
        snippet: 'Has attachment',
        internalDate: new Date('2024-01-01T00:00:00.000Z').valueOf(),
        payload: {
          headers: [
            { name: 'Subject', value: 'File' },
            { name: 'From', value: 'a@b.com' },
            { name: 'To', value: 'c@d.com' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: '' },
        },
      })

      const result = await service.onNewAttachment({
        learningMode: true,
        triggerData: { query: '', labels: null, includeSpamTrash: false },
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('initializes state on first run', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'msg-att-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/msg-att-1`).reply({
        id: 'msg-att-1',
        snippet: 'Attachment message',
        internalDate: new Date('2024-01-01T00:00:00.000Z').valueOf(),
        payload: {
          headers: [
            { name: 'Subject', value: 'File' },
            { name: 'From', value: 'a@b.com' },
            { name: 'To', value: 'c@d.com' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: '' },
        },
      })

      const result = await service.onNewAttachment({
        learningMode: false,
        state: null,
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({
        initialized: true,
        latestMessageId: 'msg-att-1',
      })
    })
  })

  describe('onNewThread', () => {
    it('returns latest thread in learning mode', async () => {
      mock.onGet(`${API_BASE}/users/me/threads`).reply({
        threads: [
          { id: 'thread-1', snippet: 'Thread one' },
        ],
        nextPageToken: null,
      })

      const result = await service.onNewThread({ learningMode: true })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ id: 'thread-1' })
      expect(result.state).toBeNull()
    })

    it('initializes state on first run', async () => {
      mock.onGet(`${API_BASE}/users/me/threads`).reply({
        threads: [
          { id: 'thread-1', snippet: 'Thread one' },
          { id: 'thread-2', snippet: 'Thread two' },
        ],
        nextPageToken: null,
      })

      const result = await service.onNewThread({
        learningMode: false,
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.threadsIds).toEqual(['thread-1', 'thread-2'])
    })

    it('detects new threads on subsequent runs', async () => {
      mock.onGet(`${API_BASE}/users/me/threads`).reply({
        threads: [
          { id: 'thread-new', snippet: 'New thread' },
          { id: 'thread-1', snippet: 'Existing' },
        ],
        nextPageToken: null,
      })

      const result = await service.onNewThread({
        learningMode: false,
        state: { threads: true, threadsIds: ['thread-1'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ id: 'thread-new' })
    })
  })

  describe('onEmailStarred', () => {
    it('returns starred message in learning mode', async () => {
      // getMessagesList will call labels for ensureExistedLabelIdsList + messages list + getMessage
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'starred-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/starred-1`).reply({
        id: 'starred-1',
        snippet: 'Starred email',
        internalDate: new Date('2024-01-01T00:00:00.000Z').valueOf(),
        payload: {
          headers: [
            { name: 'Subject', value: 'Starred' },
            { name: 'From', value: 'a@b.com' },
            { name: 'To', value: 'c@d.com' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: '' },
        },
      })

      const result = await service.onEmailStarred({ learningMode: true })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('initializes state on first run', async () => {
      mock.onGet(`${API_BASE}/users/me/messages`).reply({
        messages: [{ id: 'starred-1' }],
      })

      mock.onGet(`${API_BASE}/users/me/messages/starred-1`).reply({
        id: 'starred-1',
        snippet: 'Starred',
        internalDate: new Date('2024-01-01T00:00:00.000Z').valueOf(),
        payload: {
          headers: [
            { name: 'Subject', value: 'S' },
            { name: 'From', value: 'a@b.com' },
            { name: 'To', value: 'c@d.com' },
            { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: '' },
        },
      })

      const result = await service.onEmailStarred({
        learningMode: false,
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.messagesIds).toEqual(['starred-1'])
    })
  })
})
