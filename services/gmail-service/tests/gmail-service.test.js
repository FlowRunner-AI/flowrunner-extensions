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
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }],
      })

      const result = await service.getLabelsDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getMessageLabelsDictionary', () => {
    it('returns label IDs for a message', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply({
        payload: {},
      })

      const result = await service.getAttachmentsDictionary({
        search: null,
        criteria: { messageId: 'msg-1' },
      })

      expect(result.items).toEqual([])
    })

    it('filters attachments by search', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
        nextPageToken: 'page2',
      })

      // Each message will be fetched individually via getMessage
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Hello world' }))
      mock.onGet(`${ API_BASE }/users/me/messages/msg-2`).reply(makeRawMessage('msg-2', { snippet: 'Test message' }))

      const result = await service.getMessagesDictionary({ search: null, cursor: null })

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ value: 'msg-1' })
    })

    it('handles empty messages list', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: null,
        nextPageToken: null,
      })

      const result = await service.getMessagesDictionary({ search: null, cursor: null })

      expect(result.items).toEqual([])
    })
  })

  describe('getDraftsDictionary', () => {
    it('returns drafts with pagination', async () => {
      mock.onGet(`${ API_BASE }/users/me/drafts`).reply({
        drafts: [{ id: 'draft-1' }],
        nextPageToken: 'page2',
      })

      // getDraft fetches each draft individually
      mock.onGet(`${ API_BASE }/users/me/drafts/draft-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/drafts`).reply({
        drafts: null,
        nextPageToken: null,
      })

      const result = await service.getDraftsDictionary({ search: null, cursor: null })

      expect(result.items).toEqual([])
    })
  })

  describe('getThreadsDictionary', () => {
    it('returns threads with pagination', async () => {
      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-123`).reply(makeRawMessage('msg-123', { snippet: 'Hello' }))

      const result = await service.getMessage('msg-123')

      expect(result).toHaveProperty('id', 'msg-123')
      expect(result).toHaveProperty('snippet')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ API_BASE }/users/me/messages/msg-123`)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ OAUTH_TOKEN }`,
      })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.getMessage('')).rejects.toThrow('"Message ID" is a required argument')
    })
  })

  describe('getMessagesList', () => {
    it('returns messages without content by default', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      await service.getMessagesList(null, true, null, null, false, false)

      expect(mock.history[0].query.q).toBe('is:unread')
    })

    it('clamps maxResults to 30', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, 100, null, false, false)

      expect(mock.history[0].query.maxResults).toBe(30)
    })

    it('defaults maxResults to 10', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, null, null, false, false)

      expect(mock.history[0].query.maxResults).toBe(10)
    })

    it('fetches full content when includeContent is true', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Full content' }))

      const result = await service.getMessagesList(null, false, 1, null, false, true)

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('id', 'msg-1')
      // Should have made 2 requests: list + detail
      expect(mock.history).toHaveLength(2)
    })

    it('includes spam and trash when specified', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [],
      })

      await service.getMessagesList(null, false, null, null, true, false)

      expect(mock.history[0].query.includeSpamTrash).toBe(true)
    })

    it('resolves label IDs when labels provided', async () => {
      // First call: getLabels for ensureExistedLabelIdsList
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [
          { id: 'Label_1', name: 'Work' },
          { id: 'Label_2', name: 'Personal' },
        ],
      })

      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
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

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({
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
        null // attachments
      )

      expect(result).toMatchObject({
        id: 'sent-msg-1',
        threadId: 'thread-1',
        labelIds: ['SENT'],
      })

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))

      expect(sendRequest.body).toHaveProperty('raw')

      expect(sendRequest.headers).toMatchObject({
        Authorization: `Bearer ${ OAUTH_TOKEN }`,
      })
    })

    it('includes threadId and thread headers when replying', async () => {
      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@gmail.com',
      })

      mock.onGet(`${ API_BASE }/users/me/threads/thread-1`).reply({
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

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({
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

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [
          { id: 'Label_1', name: 'Work' },
          { id: 'Label_2', name: 'Personal' },
        ],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'Label_1'],
      })

      const result = await service.addLabelToMessage('msg-1', ['Work'])

      expect(result).toEqual({ labelIds: ['INBOX', 'Label_1'] })

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.addLabelIds).toEqual(['Label_1'])
    })

    it('creates new labels when they do not exist', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'Label_1', name: 'Work' }],
      })

      // createLabel POST
      mock.onPost(`${ API_BASE }/users/me/labels`).reply({
        id: 'Label_New',
        name: 'NewLabel',
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'Label_New'],
      })

      const result = await service.addLabelToMessage('msg-1', ['NewLabel'])

      expect(result).toHaveProperty('labelIds')
    })

    it('accepts a string label (converts to array)', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'UNREAD', name: 'Unread' },
        ],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'UNREAD', name: 'Unread' }],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX'],
      })

      await service.markMessageAsRead('msg-1')

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.removeLabelIds).toEqual(['UNREAD'])
    })
  })

  describe('markMessageAsUnread', () => {
    it('adds UNREAD label to message', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'UNREAD', name: 'Unread' }],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/modify`).reply({
        labelIds: ['INBOX', 'UNREAD'],
      })

      await service.markMessageAsUnread('msg-1')

      const modifyRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/modify'))

      expect(modifyRequest.body.addLabelIds).toEqual(['UNREAD'])
    })
  })

  describe('createLabel', () => {
    it('creates a label with all options', async () => {
      mock.onPost(`${ API_BASE }/users/me/labels`).reply({
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
      mock.onPost(`${ API_BASE }/users/me/labels`).reply({
        id: 'Label_Simple',
        name: 'Simple',
      })

      await service.createLabel('Simple', null, null, null, null)

      expect(mock.history[0].body).toEqual({ name: 'Simple' })
    })

    it('omits color when only backgroundColor is provided', async () => {
      mock.onPost(`${ API_BASE }/users/me/labels`).reply({
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
      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/trash`).reply({})
      mock.onPost(`${ API_BASE }/users/me/messages/msg-2/trash`).reply({})

      const result = await service.deleteMessages(['msg-1', 'msg-2'], false)

      expect(result).toEqual({ successCount: 2, failsCount: 0 })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ API_BASE }/users/me/messages/msg-1/trash`)
    })

    it('permanently deletes messages when flag is true', async () => {
      mock.onDelete(`${ API_BASE }/users/me/messages/msg-1`).reply({})

      const result = await service.deleteMessages(['msg-1'], true)

      expect(result).toEqual({ successCount: 1, failsCount: 0 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ API_BASE }/users/me/messages/msg-1`)
    })

    it('accepts a string messageId (converts to array)', async () => {
      mock.onPost(`${ API_BASE }/users/me/messages/msg-1/trash`).reply({})

      const result = await service.deleteMessages('msg-1', false)

      expect(result).toEqual({ successCount: 1, failsCount: 0 })
    })

    it('throws when more than 15 messages', async () => {
      const ids = Array.from({ length: 16 }, (_, i) => `msg-${ i }`)

      await expect(service.deleteMessages(ids, false))
        .rejects.toThrow('The number of messages to delete must not exceed 15.')
    })
  })

  describe('getAttachment', () => {
    it('fetches an attachment by message and attachment ID', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 12345,
        data: 'base64data',
      })

      const result = await service.getAttachment('msg-1', 'att-1')

      expect(result).toEqual({ size: 12345, data: 'base64data' })

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ OAUTH_TOKEN }`,
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1/attachments/att-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1/attachments/att-1`).reply({
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
      mock.onDelete(`${ API_BASE }/users/me/drafts/draft-1`).reply({})

      await service.deleteDraft('draft-1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ API_BASE }/users/me/drafts/draft-1`)
    })

    it('throws when draftId is missing', async () => {
      await expect(service.deleteDraft('')).rejects.toThrow('"Draft ID" is a required argument')
    })
  })

  describe('sendDraft', () => {
    it('sends a draft and returns formatted result', async () => {
      mock.onPost(`${ API_BASE }/users/me/drafts/send`).reply({
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

      mock.onPost(`${ API_BASE }/users/me/drafts`).reply({
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

      mock.onPost(`${ API_BASE }/users/me/drafts`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/drafts`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/drafts`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/msg-1`).reply(makeRawMessage('msg-1', { snippet: 'Latest email' }))

      const result = await service.onNewEmail({
        learningMode: true,
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toHaveProperty('id', 'msg-1')
      expect(result.state).toBeNull()
    })

    it('initializes state on first run', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-new' }, { id: 'msg-old' }],
      })

      // Second call: getMessage for the new message
      mock.onGet(`${ API_BASE }/users/me/messages/msg-new`).reply(makeRawMessage('msg-new', { snippet: 'New message' }))

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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-att-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/msg-att-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'msg-att-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/msg-att-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
        threads: [
          { id: 'thread-new', snippet: 'New thread' },
          { id: 'thread-1', snippet: 'Existing' },
        ],
        nextPageToken: null,
      })

      const result = await service.onNewThread({
        learningMode: false,
        state: { threadsIds: ['thread-1'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ id: 'thread-new' })
      expect(result.state.threadsIds).toEqual(['thread-new', 'thread-1'])
    })

    // Regression guard: the guard key, the read key and both write keys must agree, otherwise
    // every poll re-seeds and the trigger never emits. `threadsIds` alone must be enough.
    it('emits on the poll after seeding, without needing a second state key', async () => {
      const reply = () => mock.onGet(`${ API_BASE }/users/me/threads`).reply({
        threads: [{ id: 'thread-1' }, { id: 'thread-2' }],
        nextPageToken: null,
      })

      reply()
      const seeded = await service.onNewThread({ learningMode: false, state: undefined })

      expect(seeded.events).toEqual([])
      expect(seeded.state.threadsIds).toEqual(['thread-1', 'thread-2'])

      mock.reset()

      mock.onGet(`${ API_BASE }/users/me/threads`).reply({
        threads: [{ id: 'thread-3' }, { id: 'thread-1' }, { id: 'thread-2' }],
        nextPageToken: null,
      })

      const fired = await service.onNewThread({ learningMode: false, state: seeded.state })

      expect(fired.events).toHaveLength(1)
      expect(fired.events[0]).toMatchObject({ id: 'thread-3' })
    })
  })

  describe('onEmailStarred', () => {
    it('returns starred message in learning mode', async () => {
      // getMessagesList will call labels for ensureExistedLabelIdsList + messages list + getMessage
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'starred-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/starred-1`).reply({
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
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'starred-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/starred-1`).reply({
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

    it('detects newly starred messages on subsequent runs', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'starred-new' }, { id: 'starred-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/starred-new`).reply(makeRawMessage('starred-new'))
      mock.onGet(`${ API_BASE }/users/me/messages/starred-1`).reply(makeRawMessage('starred-1'))

      const result = await service.onEmailStarred({
        learningMode: false,
        state: { messagesIds: ['starred-1'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toHaveProperty('id', 'starred-new')
      expect(result.state.messagesIds).toEqual(['starred-new', 'starred-1'])
    })

    // Regression guard: the guard key, the read key and both write keys must agree, otherwise
    // every poll re-seeds and the trigger never emits. `messagesIds` alone must be enough.
    it('emits on the poll after seeding, without needing a second state key', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({ messages: [{ id: 'starred-1' }] })
      mock.onGet(`${ API_BASE }/users/me/messages/starred-1`).reply(makeRawMessage('starred-1'))

      const seeded = await service.onEmailStarred({ learningMode: false, state: undefined })

      expect(seeded.events).toEqual([])
      expect(seeded.state.messagesIds).toEqual(['starred-1'])

      mock.reset()

      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'starred-2' }, { id: 'starred-1' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/starred-2`).reply(makeRawMessage('starred-2'))
      mock.onGet(`${ API_BASE }/users/me/messages/starred-1`).reply(makeRawMessage('starred-1'))

      const fired = await service.onEmailStarred({ learningMode: false, state: seeded.state })

      expect(fired.events).toHaveLength(1)
      expect(fired.events[0]).toHaveProperty('id', 'starred-2')
    })
  })

  describe('onNewLabel', () => {
    it('returns the first label in learning mode', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'SENT', name: 'Sent' }],
      })

      const result = await service.onNewLabel({ learningMode: true })

      expect(result.events).toEqual([{ id: 'INBOX', name: 'Inbox' }])
      expect(result.state).toBeNull()
    })

    it('detects new labels on subsequent runs', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [
          { id: 'INBOX', name: 'Inbox' },
          { id: 'Label_New', name: 'Fresh' },
        ],
      })

      const result = await service.onNewLabel({
        learningMode: false,
        state: { labelsList: ['INBOX'] },
      })

      expect(result.events).toEqual([{ id: 'Label_New', name: 'Fresh' }])
      expect(result.state.labelsList).toEqual(['INBOX', 'Label_New'])
    })

    // Regression guard: the state key the guard checks, the key it reads and the key it writes
    // must all agree. Seeding one key while checking another re-seeds on every poll (the trigger
    // never emits); dereferencing the missing key throws outright.
    it.each([
      ['no state at all', undefined],
      ['empty state', {}],
      ['state seeded under the wrong key', { labels: [{ id: 'INBOX' }] }],
    ])('seeds state without emitting when there is %s', async (_label, state) => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'INBOX', name: 'Inbox' }, { id: 'SENT', name: 'Sent' }],
      })

      const result = await service.onNewLabel({ learningMode: false, state })

      expect(result.events).toEqual([])
      expect(result.state.labelsList).toEqual(['INBOX', 'SENT'])
    })

    it('does not re-emit across a seed → quiet → new-label → quiet poll sequence', async () => {
      const reply = labels => mock.onGet(`${ API_BASE }/users/me/labels`).reply({ labels })
      const poll = state => service.onNewLabel({ learningMode: false, state })

      reply([{ id: 'INBOX' }, { id: 'SENT' }])
      const seeded = await poll(undefined)
      expect(seeded.events).toEqual([])

      mock.reset()
      reply([{ id: 'INBOX' }, { id: 'SENT' }])
      const quiet = await poll(seeded.state)
      expect(quiet.events).toEqual([])

      mock.reset()
      reply([{ id: 'INBOX' }, { id: 'SENT' }, { id: 'WORK' }])
      const fired = await poll(quiet.state)
      expect(fired.events).toEqual([{ id: 'WORK' }])

      mock.reset()
      reply([{ id: 'INBOX' }, { id: 'SENT' }, { id: 'WORK' }])
      const quietAgain = await poll(fired.state)
      expect(quietAgain.events).toEqual([])
    })
  })

  // ── Additional coverage: error propagation, attachments, remaining trigger branches ──

  describe('#apiRequest error handling', () => {
    it('logs and rethrows transport errors', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getLabelsDictionary({})).rejects.toThrow('Unauthorized')
    })
  })

  describe('ensureExistedLabelIdsList', () => {
    it('returns undefined when no labels are given', async () => {
      await expect(service.ensureExistedLabelIdsList(null)).resolves.toBeUndefined()
      expect(mock.history).toHaveLength(0)
    })

    it('throws when labels is neither a string nor an array', async () => {
      await expect(service.ensureExistedLabelIdsList(12345))
        .rejects.toThrow('The Label(s) argument must be a string or a list of strings')
    })

    it('drops tokens that cannot be resolved to label IDs', async () => {
      mock.onGet(`${ API_BASE }/users/me/labels`).reply({
        labels: [{ id: 'Label_1', name: 'Work' }],
      })

      const result = await service.ensureExistedLabelIdsList(['Work', 'Missing'])

      expect(result).toEqual(['Label_1'])
    })
  })

  describe('sendMessage attachments and thread edge cases', () => {
    it('downloads and attaches valid attachment URLs', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })

      mock.onGet('https://files.example.com/report.pdf').reply({
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('PDF-CONTENT'),
      })

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({ id: 'sent-att' })

      const result = await service.sendMessage(
        'recipient@example.com',
        'With attachment',
        'plain',
        'See attached',
        'Sender',
        null,
        null,
        null,
        'https://files.example.com/report.pdf'
      )

      expect(result).toMatchObject({ id: 'sent-att' })

      const downloadRequest = mock.history.find(h => h.url === 'https://files.example.com/report.pdf')

      expect(downloadRequest.encoding).toBeNull()
      expect(downloadRequest.unwrapBody).toBe(false)

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))
      const raw = Buffer.from(sendRequest.body.raw, 'base64').toString('utf-8')

      expect(raw).toContain('filename="report.pdf"')
      expect(raw).toContain('Content-Type: application/pdf')
    })

    it('skips attachments when no URL is valid', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })
      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({ id: 'sent-no-att' })

      await service.sendMessage(
        'recipient@example.com',
        'No attachment',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        null,
        'not-a-url'
      )

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))
      const raw = Buffer.from(sendRequest.body.raw, 'base64').toString('utf-8')

      expect(raw).not.toContain('Content-Disposition: attachment')
    })

    it('swallows thread lookup failures and still sends', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })
      mock.onGet(`${ API_BASE }/users/me/threads/thread-x`).replyWithError({ message: 'Thread not found' })
      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({ id: 'sent-anyway' })

      const result = await service.sendMessage(
        'recipient@example.com',
        'Re: x',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        'thread-x',
        null
      )

      expect(result).toMatchObject({ id: 'sent-anyway' })

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))

      expect(sendRequest.body.threadId).toBe('thread-x')
    })

    it('does not rebuild the message when the thread has no Message-ID header', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })

      mock.onGet(`${ API_BASE }/users/me/threads/thread-y`).reply({
        messages: [{ payload: { headers: [{ name: 'Subject', value: 'No message id' }] } }],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({ id: 'sent-plain-thread' })

      await service.sendMessage(
        'recipient@example.com',
        'Re: y',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        'thread-y',
        null
      )

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))
      const raw = Buffer.from(sendRequest.body.raw, 'base64').toString('utf-8')

      expect(raw).not.toContain('In-Reply-To:')
    })

    it('builds In-Reply-To and References from the latest thread message', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })

      mock.onGet(`${ API_BASE }/users/me/threads/thread-z`).reply({
        messages: [
          {
            payload: {
              headers: [
                { name: 'Message-ID', value: '<a@gmail.com>' },
                { name: 'References', value: '<older@gmail.com>' },
              ],
            },
          },
        ],
      })

      mock.onPost(`${ API_BASE }/users/me/messages/send`).reply({ id: 'sent-thread-headers' })

      await service.sendMessage(
        'recipient@example.com',
        'Re: z',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        'thread-z',
        null
      )

      const sendRequest = mock.history.find(h => h.method === 'post' && h.url.includes('/send'))
      const raw = Buffer.from(sendRequest.body.raw, 'base64').toString('utf-8')

      expect(raw).toContain('In-Reply-To: <a@gmail.com>')
      expect(raw).toContain('References: <older@gmail.com> <a@gmail.com>')
    })
  })

  describe('createDraft attachments', () => {
    it('downloads and attaches valid attachment URLs', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })

      mock.onGet('https://files.example.com/notes.txt').reply({
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('NOTES'),
      })

      mock.onPost(`${ API_BASE }/users/me/drafts`).reply({
        id: 'draft-att',
        message: { id: 'msg-att', threadId: 'thread-att', labelIds: ['DRAFT'] },
      })

      const result = await service.createDraft(
        'recipient@example.com',
        'Draft with attachment',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        null,
        ['https://files.example.com/notes.txt']
      )

      expect(result).toMatchObject({ id: 'draft-att' })

      const draftRequest = mock.history.find(h => h.method === 'post' && h.url.endsWith('/drafts'))
      const raw = Buffer.from(draftRequest.body.message.raw, 'base64').toString('utf-8')

      expect(raw).toContain('filename="notes.txt"')
    })

    it('skips attachments when none of the URLs are valid', async () => {
      mock.onGet(USER_INFO_URL).reply({ name: 'Test User', email: 'test@gmail.com' })

      mock.onPost(`${ API_BASE }/users/me/drafts`).reply({
        id: 'draft-no-att',
        message: { id: 'msg', threadId: 'thread', labelIds: ['DRAFT'] },
      })

      await service.createDraft(
        'recipient@example.com',
        'Draft',
        'plain',
        'Body',
        'Sender',
        null,
        null,
        null,
        ['nope']
      )

      const draftRequest = mock.history.find(h => h.method === 'post' && h.url.endsWith('/drafts'))
      const raw = Buffer.from(draftRequest.body.message.raw, 'base64').toString('utf-8')

      expect(raw).not.toContain('Content-Disposition: attachment')
    })
  })

  describe('saveAttachment error handling', () => {
    it('logs and rethrows when the upload fails', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 10,
        data: 'SGVsbG8',
      })

      // NOTE: the unit sandbox provides no Files API, so it is stubbed here.
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockRejectedValue(new Error('upload failed')),
        },
      }

      await expect(service.saveAttachment('msg-1', 'att-1', 'doc.pdf', null))
        .rejects.toThrow('upload failed')
    })

    it('normalizes base64url attachment data before uploading', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages/msg-1/attachments/att-1`).reply({
        size: 10,
        data: '-_-_',
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/x.bin' }),
        },
      }

      await service.saveAttachment('msg-1', 'att-1', 'x.bin', null)

      const [buffer] = service.flowrunner.Files.uploadFile.mock.calls[0]

      expect(buffer).toEqual(Buffer.from('+/+/', 'base64'))
    })
  })

  describe('onNewAttachment subsequent runs', () => {
    it('returns new attachment messages and updates state', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'att-new' }, { id: 'att-old' }],
      })

      mock.onGet(`${ API_BASE }/users/me/messages/att-new`).reply(makeRawMessage('att-new'))

      const result = await service.onNewAttachment({
        learningMode: false,
        state: { initialized: true, latestMessageId: 'att-old' },
        triggerData: { query: 'invoice', labels: null, includeSpamTrash: false },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toHaveProperty('id', 'att-new')
      expect(result.state).toEqual({ latestMessageId: 'att-new' })

      const listRequest = mock.history[0]

      expect(listRequest.query.q).toBe('has:attachment invoice')
    })

    it('returns no events when nothing changed', async () => {
      mock.onGet(`${ API_BASE }/users/me/messages`).reply({
        messages: [{ id: 'att-old' }],
      })

      const result = await service.onNewAttachment({
        learningMode: false,
        state: { initialized: true, latestMessageId: 'att-old' },
        triggerData: { query: null, labels: null, includeSpamTrash: false },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ latestMessageId: 'att-old' })
    })
  })
})

// ═════════════════════════════ Helper modules (direct) ═════════════════════════════

describe('email-parser (direct)', () => {
  const EmailParser = require('../src/email-parser')

  const parser = new EmailParser()

  const b64 = str => Buffer.from(str, 'utf-8').toString('base64')

  function rawEmail(payload, overrides = {}) {
    return {
      id: 'm1',
      threadId: 't1',
      snippet: 'snippet',
      labelIds: ['INBOX'],
      internalDate: '1704067200000',
      ...overrides,
      payload: {
        headers: [
          { name: 'Subject', value: 'Subject line' },
          { name: 'From', value: 'Sender Name <Sender@Example.com>' },
          { name: 'To', value: 'a@example.com' },
          { name: 'Cc', value: 'cc@example.com' },
          { name: 'Bcc', value: 'bcc@example.com' },
        ],
        ...payload,
      },
    }
  }

  describe('parseMessage', () => {
    it('rejects when the raw email is missing', async () => {
      await expect(parser.parseMessage(null)).rejects.toThrow('email required')
    })

    it('rejects when the payload is missing', async () => {
      await expect(parser.parseMessage({ id: 'x' })).rejects.toThrow('email payload required')
    })

    it('rejects when payload headers are missing', async () => {
      await expect(parser.parseMessage({ id: 'x', payload: {} })).rejects.toThrow('email headers required')
    })

    it('rejects when internalDate is not a valid date', async () => {
      await expect(
        parser.parseMessage({ id: 'x', internalDate: 'nope', payload: { headers: [] } })
      ).rejects.toThrow('email missing date')
    })

    it('maps the parsed email onto the service shape', async () => {
      const result = await parser.parseMessage(rawEmail({ mimeType: 'text/plain', body: { data: b64('Body text') } }))

      expect(result).toMatchObject({
        id: 'm1',
        threadId: 't1',
        subject: 'Subject line',
        fromAddress: 'sender@example.com',
        fromName: 'Sender Name',
        labelIds: ['INBOX'],
        message: 'Body text',
      })

      expect(result.to[0].address).toBe('a@example.com')
      expect(result.cc[0].address).toBe('cc@example.com')
      expect(result.bcc[0].address).toBe('bcc@example.com')
      expect(result.rawEmailData).toBeDefined()
      expect(result.date).toBeInstanceOf(Date)
    })

    it('falls back to the sender address when the From header has no display name', async () => {
      const raw = rawEmail({ mimeType: 'text/plain', body: { data: b64('x') } })

      raw.payload.headers[1] = { name: 'From', value: 'nobody@example.com' }

      const result = await parser.parseMessage(raw)

      expect(result.fromName).toBe('nobody@example.com')
      expect(result.fromAddress).toBe('nobody@example.com')
    })

    it('recurses into nested multipart parts the library does not handle', async () => {
      const raw = rawEmail({
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            body: { size: 0 },
            parts: [
              { mimeType: 'text/plain', body: { data: b64('plain version') } },
              { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
            ],
          },
        ],
      })

      const result = await parser.parseMessage(raw)

      expect(result.message).toBe('<p>html version</p>')
    })

    it('exposes attachments collected by the parser', async () => {
      const raw = rawEmail({
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('hi') } },
          {
            filename: 'file.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'att-1', size: 42 },
          },
        ],
      })

      const result = await parser.parseMessage(raw)

      expect(result.attachments).toEqual([
        { filename: 'file.pdf', mimetype: 'application/pdf', id: 'att-1', size: 42 },
      ])
    })
  })

  describe('extractMessageContent', () => {
    it('decodes a base64 body on the payload itself', () => {
      expect(parser.extractMessageContent({ body: { data: b64('direct body') } })).toBe('direct body')
    })

    it('walks parts when the payload has no direct body', () => {
      const content = parser.extractMessageContent({
        parts: [{ mimeType: 'text/plain', body: { data: b64('from parts') } }],
      })

      expect(content).toBe('from parts')
    })

    it('returns null for an empty payload', () => {
      expect(parser.extractMessageContent({})).toBeNull()
      expect(parser.extractMessageContent({ body: {} })).toBeNull()
    })
  })

  describe('searchPartsForContent', () => {
    it('prefers text/html over text/plain', () => {
      const content = parser.searchPartsForContent([
        { mimeType: 'text/plain', body: { data: b64('plain') } },
        { mimeType: 'text/html', body: { data: b64('<b>html</b>') } },
      ])

      expect(content).toBe('<b>html</b>')
    })

    it('falls back to the first text/plain part', () => {
      const content = parser.searchPartsForContent([
        { mimeType: 'text/plain', body: { data: b64('first plain') } },
        { mimeType: 'text/plain', body: { data: b64('second plain') } },
      ])

      expect(content).toBe('first plain')
    })

    it('descends into nested parts', () => {
      const content = parser.searchPartsForContent([
        { mimeType: 'application/pdf', body: { attachmentId: 'a1' } },
        {
          mimeType: 'multipart/related',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [{ mimeType: 'text/html', body: { data: b64('<i>deep</i>') } }],
            },
          ],
        },
      ])

      expect(content).toBe('<i>deep</i>')
    })

    it('keeps scanning when a nested branch yields nothing', () => {
      const content = parser.searchPartsForContent([
        { mimeType: 'multipart/related', parts: [{ mimeType: 'image/png', body: { attachmentId: 'i1' } }] },
        { mimeType: 'text/plain', body: { data: b64('after empty branch') } },
      ])

      expect(content).toBe('after empty branch')
    })

    it('ignores text parts with no body data', () => {
      expect(parser.searchPartsForContent([{ mimeType: 'text/plain', body: {} }])).toBeNull()
      expect(parser.searchPartsForContent([{ mimeType: 'text/html' }])).toBeNull()
    })

    it('returns null for an empty part list', () => {
      expect(parser.searchPartsForContent([])).toBeNull()
    })
  })

  describe('parseThread', () => {
    it('parses every message in a thread', async () => {
      const thread = {
        id: 'thread-1',
        historyId: '123',
        messages: [
          rawEmail({ mimeType: 'text/plain', body: { data: b64('one') } }, { id: 'm1' }),
          rawEmail({ mimeType: 'text/plain', body: { data: b64('two') } }, { id: 'm2' }),
        ],
      }

      const result = await parser.parseThread(thread)

      expect(result.id).toBe('thread-1')
      expect(result.historyId).toBe('123')
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].message).toBe('one')
      expect(result.messages[1].message).toBe('two')
    })

    it('rejects when one of the thread messages is malformed', async () => {
      await expect(
        parser.parseThread({ id: 't', historyId: '1', messages: [{ id: 'broken' }] })
      ).rejects.toThrow('email payload required')
    })
  })

  describe('createEmailMessage', () => {
    function decode(raw) {
      return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    }

    it('builds a minimal plain-text message', () => {
      const raw = parser.createEmailMessage({
        to: 'to@example.com',
        subject: 'Hello',
        bodyType: 'plain',
        bodyContent: 'Body',
        from: 'Sender',
        myEmail: 'me@example.com',
      })

      const message = decode(raw)

      expect(message).toContain('From: Sender <me@example.com>')
      expect(message).toContain('To: to@example.com')
      expect(message).toContain('Subject: Hello')
      expect(message).toContain('Content-Type: text/plain; charset=UTF-8')
      expect(message).toContain(Buffer.from('Body').toString('base64'))
      expect(message).not.toContain('Cc:')
      expect(message).not.toContain('Bcc:')
      expect(message).not.toContain('In-Reply-To:')
      expect(message).not.toContain('References:')
    })

    it('uses text/html when bodyType is html', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          bodyType: 'html',
          bodyContent: '<p>hi</p>',
          from: 'Sender',
          myEmail: 'me@example.com',
        })
      )

      expect(message).toContain('Content-Type: text/html; charset=UTF-8')
    })

    it('encodes an empty body when bodyContent is missing', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          from: 'Sender',
          myEmail: 'me@example.com',
        })
      )

      expect(message).toContain('Content-Transfer-Encoding: base64\r\n\r\n\r\n')
    })

    it('includes cc, bcc, in-reply-to and references headers', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          bodyType: 'plain',
          bodyContent: 'B',
          from: 'Sender',
          myEmail: 'me@example.com',
          cc: ['cc1@example.com', 'cc2@example.com'],
          bcc: ['bcc@example.com'],
          inReplyTo: '<orig@example.com>',
          references: '<older@example.com> <orig@example.com>',
        })
      )

      expect(message).toContain('Cc: cc1@example.com, cc2@example.com')
      expect(message).toContain('Bcc: bcc@example.com')
      expect(message).toContain('In-Reply-To: <orig@example.com>')
      expect(message).toContain('References: <older@example.com> <orig@example.com>')
    })

    it('skips empty cc and bcc arrays', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          bodyContent: 'B',
          from: 'Sender',
          myEmail: 'me@example.com',
          cc: [],
          bcc: [],
        })
      )

      expect(message).not.toContain('Cc:')
      expect(message).not.toContain('Bcc:')
    })

    it('appends attachment parts with their content type', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          bodyContent: 'B',
          from: 'Sender',
          myEmail: 'me@example.com',
          attachments: [
            { fileName: 'a.pdf', contentType: 'application/pdf', size: 10, file: 'QUJD' },
            { fileName: 'b.bin', size: 20, file: 'REVG' },
          ],
        })
      )

      expect(message).toContain('Content-Type: application/pdf; name="a.pdf"')
      expect(message).toContain('Content-Disposition: attachment; filename="a.pdf"; size=10')
      expect(message).toContain('QUJD')
      // Falls back to a generic content type when none is supplied
      expect(message).toContain('Content-Type: application/octet-stream; name="b.bin"')
      expect(message).toContain('REVG')
      expect(message.trim().endsWith('--boundary--')).toBe(true)
    })

    it('ignores an empty attachments array', () => {
      const message = decode(
        parser.createEmailMessage({
          to: 'to@example.com',
          subject: 'S',
          bodyContent: 'B',
          from: 'Sender',
          myEmail: 'me@example.com',
          attachments: [],
        })
      )

      expect(message).not.toContain('Content-Disposition: attachment')
    })
  })

  describe('convertToBase64URLString', () => {
    it('produces URL-safe base64 without padding', () => {
      const encoded = parser.convertToBase64URLString('??>?>?')

      expect(encoded).not.toMatch(/[+/=]/)

      expect(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
        .toBe('??>?>?')
    })
  })
})

describe('utils (direct)', () => {
  const {
    getRandomLabelColor,
    constructIdentityName,
    getIdentityImageURL,
    getValidAttachments,
    createSearchParams,
    searchFilter,
    assert,
  } = require('../src/utils')

  describe('getRandomLabelColor', () => {
    it('returns a deterministic color pair for a given name', () => {
      const first = getRandomLabelColor('Work')
      const second = getRandomLabelColor('Work')

      expect(first).toEqual(second)
      expect(first.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
      expect(first.textColor).toMatch(/^#[0-9a-f]{6}$/)
    })

    it('handles an empty name', () => {
      expect(getRandomLabelColor('')).toEqual({ backgroundColor: '#e7e7e7', textColor: '#464646' })
    })

    it('produces different colors for different names', () => {
      const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
      const colors = new Set(names.map(name => getRandomLabelColor(name).backgroundColor))

      expect(colors.size).toBeGreaterThan(1)
    })
  })

  describe('constructIdentityName', () => {
    it('combines the name and email', () => {
      expect(constructIdentityName({ name: 'Jane', email: 'jane@example.com' }))
        .toBe('Jane (jane@example.com)')
    })

    it('still returns a string when fields are missing', () => {
      expect(constructIdentityName({})).toBe('undefined (undefined)')
    })
  })

  describe('getIdentityImageURL', () => {
    it('returns the picture when present', () => {
      expect(getIdentityImageURL({ picture: 'https://x/y.png' })).toBe('https://x/y.png')
    })

    it('returns null when there is no picture', () => {
      expect(getIdentityImageURL({})).toBeNull()
    })
  })

  describe('assert', () => {
    it('does nothing for truthy conditions', () => {
      expect(() => assert('value', 'Thing')).not.toThrow()
    })

    it('throws a named error for falsy conditions', () => {
      expect(() => assert('', 'Thing')).toThrow('"Thing" is a required argument')
      expect(() => assert(undefined, 'Other')).toThrow('"Other" is a required argument')
    })
  })

  describe('createSearchParams', () => {
    it('returns an empty object when nothing is provided', () => {
      expect(createSearchParams({})).toEqual({})
    })

    it('maps every supported parameter', () => {
      expect(
        createSearchParams({
          query: 'invoice',
          maxResults: 5,
          labelIds: ['INBOX'],
          nextPageToken: 'token',
          includeSpamTrash: true,
        })
      ).toEqual({
        q: 'invoice',
        maxResults: 5,
        labelIds: ['INBOX'],
        pageToken: 'token',
        includeSpamTrash: true,
      })
    })

    it('nulls out labelIds that are not an array', () => {
      expect(createSearchParams({ labelIds: 'INBOX' })).toEqual({ labelIds: null })
    })

    it('appends is:unread to an existing query and trims it', () => {
      expect(createSearchParams({ query: 'invoice', loadUnread: true }).q).toBe('invoice is:unread')
      expect(createSearchParams({ loadUnread: true }).q).toBe('is:unread')
    })

    it('trims a plain query', () => {
      expect(createSearchParams({ query: '  spaced  ' }).q).toBe('spaced')
    })
  })

  describe('searchFilter', () => {
    it('matches plain strings case-insensitively', () => {
      expect(searchFilter(['INBOX', 'SENT', 'SPAM'], [], 'sp')).toEqual(['SPAM'])
    })

    it('matches object properties', () => {
      const list = [{ name: 'Work' }, { name: 'Personal' }]

      expect(searchFilter(list, ['name'], 'work')).toEqual([{ name: 'Work' }])
    })

    it('matches nested dot-path properties', () => {
      const list = [{ message: { snippet: 'Invoice ready' } }, { message: { snippet: 'Meeting' } }]

      expect(searchFilter(list, ['message.snippet'], 'invoice')).toHaveLength(1)
    })

    it('skips items whose property path is missing', () => {
      expect(searchFilter([{ other: 'x' }, {}], ['name'], 'x')).toEqual([])
    })

    it('coerces non-string values before matching', () => {
      expect(searchFilter([{ size: 12345 }], ['size'], '234')).toHaveLength(1)
    })

    it('returns everything for an empty search string', () => {
      expect(searchFilter(['A', 'B'], [], '')).toEqual(['A', 'B'])
    })
  })

  describe('getValidAttachments', () => {
    let originalFlowrunner

    beforeAll(() => {
      originalFlowrunner = global.Flowrunner
    })

    afterAll(() => {
      if (originalFlowrunner === undefined) {
        delete global.Flowrunner
      } else {
        global.Flowrunner = originalFlowrunner
      }
    })

    function stubDownload(responses) {
      global.Flowrunner = {
        Request: {
          get(url) {
            const chain = {
              unwrapBody: () => chain,
              setEncoding: () => chain,
              then: (resolve, reject) => {
                const response = responses[url]

                if (response instanceof Error) {
                  return reject ? reject(response) : Promise.reject(response)
                }

                return resolve ? resolve(response) : Promise.resolve(response)
              },
              catch: reject => chain.then(undefined, reject),
            }

            return chain
          },
        },
      }
    }

    it('returns an empty list when no URL is valid', async () => {
      await expect(getValidAttachments('not-a-url')).resolves.toEqual([])
      await expect(getValidAttachments(['nope', ''])).resolves.toEqual([])
    })

    it('downloads a single URL passed as a string', async () => {
      stubDownload({
        'https://files.example.com/a.pdf': {
          headers: { 'content-type': 'application/pdf' },
          body: Buffer.from('CONTENT'),
        },
      })

      const result = await getValidAttachments('https://files.example.com/a.pdf')

      expect(result).toEqual([
        {
          url: 'https://files.example.com/a.pdf',
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          file: Buffer.from('CONTENT').toString('base64'),
          size: Buffer.byteLength(Buffer.from('CONTENT').toString('base64'), 'utf8'),
        },
      ])
    })

    it('filters out invalid URLs from a mixed list', async () => {
      stubDownload({
        'https://files.example.com/a.pdf': {
          headers: { 'content-type': 'application/pdf' },
          body: Buffer.from('A'),
        },
      })

      const result = await getValidAttachments(['broken', 'https://files.example.com/a.pdf'])

      expect(result).toHaveLength(1)
    })

    it('falls back to "noname" when the URL has no file segment', async () => {
      stubDownload({
        'https://files.example.com/': {
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('X'),
        },
      })

      const [file] = await getValidAttachments('https://files.example.com/')

      expect(file.fileName).toBe('noname')
    })

    it('propagates download errors', async () => {
      stubDownload({ 'https://files.example.com/a.pdf': new Error('404 Not Found') })

      await expect(getValidAttachments('https://files.example.com/a.pdf'))
        .rejects.toThrow('404 Not Found')
    })

    it('throws when the combined attachment size exceeds 25MB', async () => {
      const big = Buffer.alloc(10 * 1024 * 1024, 0x61)

      stubDownload({
        'https://files.example.com/one.bin': { headers: { 'content-type': 'application/octet-stream' }, body: big },
        'https://files.example.com/two.bin': { headers: { 'content-type': 'application/octet-stream' }, body: big },
      })

      await expect(
        getValidAttachments(['https://files.example.com/one.bin', 'https://files.example.com/two.bin'])
      ).rejects.toThrow('The total size of attachments exceeds 25MB.')
    })
  })
})

describe('logger (direct)', () => {
  const { logger } = require('../src/logger')

  let spy

  beforeEach(() => {
    // jest.setup.js already silences console.log with a mock, so clear whatever
    // earlier suites logged before asserting on this suite's own calls.
    spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    spy.mockClear()
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('prefixes each level with the service tag', () => {
    logger.info('a')
    logger.debug('b')
    logger.error('c')
    logger.warn('d')

    expect(spy.mock.calls).toEqual([
      ['[Gmail Service] info:', 'a'],
      ['[Gmail Service] debug:', 'b'],
      ['[Gmail Service] error:', 'c'],
      ['[Gmail Service] warn:', 'd'],
    ])
  })
})

describe('constants (direct)', () => {
  const { MimeType, MAX_TOTAL_ATTACHMENTS_SIZE, DEFAULT_SCOPE_LIST, DEFAULT_SCOPE_STRING } = require('../src/constants')

  it('exposes the mime types used when composing emails', () => {
    expect(MimeType).toEqual({ TEXT: 'text/plain', HTML: 'text/html' })
  })

  it('caps attachments at 25MB', () => {
    expect(MAX_TOTAL_ATTACHMENTS_SIZE).toBe(25 * 1024 * 1024)
  })

  it('joins the default scopes with spaces', () => {
    expect(DEFAULT_SCOPE_STRING).toBe(DEFAULT_SCOPE_LIST.join(' '))
    expect(DEFAULT_SCOPE_LIST).toContain('https://www.googleapis.com/auth/gmail.send')
  })
})
