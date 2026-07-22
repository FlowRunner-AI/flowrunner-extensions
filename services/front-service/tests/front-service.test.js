'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-front-api-key'
const BASE = 'https://api2.frontapp.com'

describe('Front Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionaries ──

  describe('getInboxesDictionary', () => {
    it('returns mapped inboxes with no search', async () => {
      mock.onGet(`${BASE}/inboxes`).reply({
        _results: [
          { id: 'inb_1', name: 'Support', type: 'shared' },
          { id: 'inb_2', name: 'Sales', type: 'personal' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getInboxesDictionary({})

      expect(result.items).toEqual([
        { label: 'Support', value: 'inb_1', note: 'shared' },
        { label: 'Sales', value: 'inb_2', note: 'personal' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('filters inboxes by search term', async () => {
      mock.onGet(`${BASE}/inboxes`).reply({
        _results: [
          { id: 'inb_1', name: 'Support', type: 'shared' },
          { id: 'inb_2', name: 'Sales', type: 'personal' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getInboxesDictionary({ search: 'sup' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Support')
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/inboxes?page_token=abc123`

      mock.onGet(cursorUrl).reply({
        _results: [{ id: 'inb_3', name: 'Billing', type: 'shared' }],
        _pagination: { next: null },
      })

      const result = await service.getInboxesDictionary({ cursor: cursorUrl })

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].url).toBe(cursorUrl)
    })

    it('returns pagination cursor when available', async () => {
      const nextUrl = `${BASE}/inboxes?page_token=next123`

      mock.onGet(`${BASE}/inboxes`).reply({
        _results: [{ id: 'inb_1', name: 'Support', type: 'shared' }],
        _pagination: { next: nextUrl },
      })

      const result = await service.getInboxesDictionary({})

      expect(result.cursor).toBe(nextUrl)
    })
  })

  describe('getChannelsDictionary', () => {
    it('returns mapped channels', async () => {
      mock.onGet(`${BASE}/channels`).reply({
        _results: [
          { id: 'cha_1', name: 'Main Email', address: 'support@example.com', type: 'smtp' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getChannelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Main Email', value: 'cha_1', note: 'smtp' },
      ])
    })

    it('filters channels by address when name is empty', async () => {
      mock.onGet(`${BASE}/channels`).reply({
        _results: [
          { id: 'cha_1', name: '', address: 'support@example.com', type: 'smtp' },
          { id: 'cha_2', name: '', address: 'sales@other.com', type: 'smtp' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getChannelsDictionary({ search: 'support' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('cha_1')
    })

    it('uses address as label when name is falsy', async () => {
      mock.onGet(`${BASE}/channels`).reply({
        _results: [
          { id: 'cha_1', name: '', address: 'support@example.com', type: 'smtp' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getChannelsDictionary({})

      expect(result.items[0].label).toBe('support@example.com')
    })
  })

  describe('getTeammatesDictionary', () => {
    it('returns mapped teammates', async () => {
      mock.onGet(`${BASE}/teammates`).reply({
        _results: [
          { id: 'tea_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', username: 'jane' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTeammatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Doe', value: 'tea_1', note: 'jane@example.com' },
      ])
    })

    it('filters teammates by email', async () => {
      mock.onGet(`${BASE}/teammates`).reply({
        _results: [
          { id: 'tea_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
          { id: 'tea_2', first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTeammatesDictionary({ search: 'bob@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tea_2')
    })

    it('uses username as label when names are empty', async () => {
      mock.onGet(`${BASE}/teammates`).reply({
        _results: [
          { id: 'tea_1', first_name: '', last_name: '', email: '', username: 'jdoe' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTeammatesDictionary({})

      expect(result.items[0].label).toBe('jdoe')
    })
  })

  describe('getTagsDictionary', () => {
    it('returns mapped tags with highlight note', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _results: [
          { id: 'tag_1', name: 'VIP', highlight: 'red' },
          { id: 'tag_2', name: 'Bug' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 'tag_1', note: 'highlight:red' },
        { label: 'Bug', value: 'tag_2', note: 'tag' },
      ])
    })

    it('filters tags by name', async () => {
      mock.onGet(`${BASE}/tags`).reply({
        _results: [
          { id: 'tag_1', name: 'VIP', highlight: 'red' },
          { id: 'tag_2', name: 'Bug' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTagsDictionary({ search: 'vip' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('VIP')
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('sends correct query params with defaults', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listConversations()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('passes all filters to the API', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listConversations('subject:invoice', 'open', 'inb_1', 'tag_1', 'tea_1', 50)

      expect(mock.history[0].query).toMatchObject({
        q: 'subject:invoice',
        status: 'open',
        inbox_id: 'inb_1',
        tag_id: 'tag_1',
        assignee_id: 'tea_1',
        limit: 50,
      })
    })

    it('omits status when ALL is selected', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listConversations(undefined, 'ALL')

      expect(mock.history[0].query.status).toBeUndefined()
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/conversations?page_token=abc`

      mock.onGet(cursorUrl).reply({ _results: [], _pagination: { next: null } })

      await service.listConversations(undefined, undefined, undefined, undefined, undefined, undefined, cursorUrl)

      expect(mock.history[0].url).toBe(cursorUrl)
    })
  })

  describe('getConversation', () => {
    it('fetches conversation by ID', async () => {
      mock.onGet(`${BASE}/conversations/cnv_abc`).reply({
        id: 'cnv_abc',
        subject: 'Test',
        status: 'open',
      })

      const result = await service.getConversation('cnv_abc')

      expect(result).toEqual({ id: 'cnv_abc', subject: 'Test', status: 'open' })
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.getConversation()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('searchConversations', () => {
    it('sends encoded query in URL', async () => {
      const query = 'subject:refund is:open'
      const encodedQuery = encodeURIComponent(query)

      mock.onGet(`${BASE}/conversations/search/${encodedQuery}`).reply({
        _results: [{ id: 'cnv_1' }],
        _pagination: { next: null },
      })

      const result = await service.searchConversations(query, 10)

      expect(result._results).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })

    it('uses default limit when not provided', async () => {
      mock.onGet(`${BASE}/conversations/search/${encodeURIComponent('test')}`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.searchConversations('test')

      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('throws when query is missing', async () => {
      await expect(service.searchConversations()).rejects.toThrow('Search query is required')
    })
  })

  describe('updateConversation', () => {
    it('sends PATCH with status and assignee', async () => {
      mock.onPatch(`${BASE}/conversations/cnv_abc`).reply({})

      const result = await service.updateConversation('cnv_abc', 'archived', 'tea_1')

      expect(result).toEqual({ success: true, conversationId: 'cnv_abc' })
      expect(mock.history[0].body).toMatchObject({
        status: 'archived',
        assignee_id: 'tea_1',
      })
    })

    it('parses comma-separated tag IDs', async () => {
      mock.onPatch(`${BASE}/conversations/cnv_abc`).reply({})

      await service.updateConversation('cnv_abc', undefined, undefined, 'tag_1, tag_2, tag_3')

      expect(mock.history[0].body.tag_ids).toEqual(['tag_1', 'tag_2', 'tag_3'])
    })

    it('sends inbox_id when provided', async () => {
      mock.onPatch(`${BASE}/conversations/cnv_abc`).reply({})

      await service.updateConversation('cnv_abc', undefined, undefined, undefined, 'inb_1')

      expect(mock.history[0].body).toMatchObject({ inbox_id: 'inb_1' })
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.updateConversation()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('archiveConversation', () => {
    it('sends PATCH with archived status', async () => {
      mock.onPatch(`${BASE}/conversations/cnv_abc`).reply({})

      const result = await service.archiveConversation('cnv_abc')

      expect(result).toEqual({ success: true, conversationId: 'cnv_abc' })
      expect(mock.history[0].body).toEqual({ status: 'archived' })
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.archiveConversation()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('listConversationMessages', () => {
    it('fetches messages for a conversation', async () => {
      mock.onGet(`${BASE}/conversations/cnv_abc/messages`).reply({
        _results: [{ id: 'msg_1', body: 'Hello' }],
        _pagination: { next: null },
      })

      const result = await service.listConversationMessages('cnv_abc')

      expect(result._results).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('passes custom limit', async () => {
      mock.onGet(`${BASE}/conversations/cnv_abc/messages`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listConversationMessages('cnv_abc', 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/conversations/cnv_abc/messages?page_token=xyz`

      mock.onGet(cursorUrl).reply({ _results: [], _pagination: { next: null } })

      await service.listConversationMessages('cnv_abc', undefined, cursorUrl)

      expect(mock.history[0].url).toBe(cursorUrl)
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.listConversationMessages()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('sendMessage', () => {
    it('sends POST with JSON body when no attachments', async () => {
      mock.onPost(`${BASE}/channels/cha_1/messages`).reply({
        id: 'msg_new',
        type: 'email',
      })

      const result = await service.sendMessage('cha_1', 'alice@example.com', '<p>Hello</p>', 'Test Subject')

      expect(result).toMatchObject({ id: 'msg_new' })
      expect(mock.history[0].body).toMatchObject({
        to: ['alice@example.com'],
        body: '<p>Hello</p>',
        subject: 'Test Subject',
      })
    })

    it('parses multiple recipients', async () => {
      mock.onPost(`${BASE}/channels/cha_1/messages`).reply({ id: 'msg_new' })

      await service.sendMessage('cha_1', 'a@test.com, b@test.com', 'body')

      expect(mock.history[0].body.to).toEqual(['a@test.com', 'b@test.com'])
    })

    it('includes cc and bcc when provided', async () => {
      mock.onPost(`${BASE}/channels/cha_1/messages`).reply({ id: 'msg_new' })

      await service.sendMessage('cha_1', 'a@test.com', 'body', undefined, 'cc@test.com', 'bcc@test.com')

      expect(mock.history[0].body.cc).toEqual(['cc@test.com'])
      expect(mock.history[0].body.bcc).toEqual(['bcc@test.com'])
    })

    it('omits cc and bcc when not provided', async () => {
      mock.onPost(`${BASE}/channels/cha_1/messages`).reply({ id: 'msg_new' })

      await service.sendMessage('cha_1', 'a@test.com', 'body')

      expect(mock.history[0].body.cc).toBeUndefined()
      expect(mock.history[0].body.bcc).toBeUndefined()
    })

    it('uses FormData when attachments are provided', async () => {
      mock.onGet('https://files.example.com/doc.pdf').reply({
        body: Buffer.from('fake-pdf'),
        headers: { 'content-type': 'application/pdf' },
      })
      mock.onPost(`${BASE}/channels/cha_1/messages`).reply({ id: 'msg_new' })

      await service.sendMessage('cha_1', 'a@test.com', 'body', undefined, undefined, undefined, 'https://files.example.com/doc.pdf')

      // The attachment fetch is the first request, the POST is the second
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws when channelId is missing', async () => {
      await expect(service.sendMessage()).rejects.toThrow('Channel ID is required')
    })

    it('throws when to is missing', async () => {
      await expect(service.sendMessage('cha_1')).rejects.toThrow('Recipient (to) is required')
    })

    it('throws when body is missing', async () => {
      await expect(service.sendMessage('cha_1', 'a@test.com')).rejects.toThrow('Body is required')
    })
  })

  describe('replyToConversation', () => {
    it('sends POST with JSON body', async () => {
      mock.onPost(`${BASE}/conversations/cnv_abc/messages`).reply({ id: 'msg_reply' })

      const result = await service.replyToConversation('cnv_abc', '<p>Thanks</p>', 'Re: Test', 'cha_1')

      expect(result).toMatchObject({ id: 'msg_reply' })
      expect(mock.history[0].body).toMatchObject({
        body: '<p>Thanks</p>',
        subject: 'Re: Test',
        channel_id: 'cha_1',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/conversations/cnv_abc/messages`).reply({ id: 'msg_reply' })

      await service.replyToConversation('cnv_abc', 'Reply body')

      expect(mock.history[0].body).toEqual({ body: 'Reply body' })
    })

    it('uses FormData when attachments are provided', async () => {
      mock.onGet('https://files.example.com/img.png').reply({
        body: Buffer.from('fake-img'),
        headers: { 'content-type': 'image/png' },
      })
      mock.onPost(`${BASE}/conversations/cnv_abc/messages`).reply({ id: 'msg_reply' })

      await service.replyToConversation('cnv_abc', 'body', undefined, undefined, 'https://files.example.com/img.png')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.replyToConversation()).rejects.toThrow('Conversation ID is required')
    })

    it('throws when body is missing', async () => {
      await expect(service.replyToConversation('cnv_abc')).rejects.toThrow('Body is required')
    })
  })

  // ── Attachments ──

  describe('getAttachment', () => {
    it('downloads by attachment ID and uploads to Files', async () => {
      mock.onGet(`${BASE}/download/fil_123`).reply({
        body: Buffer.from('file-content'),
        headers: { 'content-type': 'application/pdf' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/attachment.pdf' }),
        },
      }

      const result = await service.getAttachment('fil_123', 'invoice.pdf')

      expect(result).toEqual({ url: 'https://storage.example.com/attachment.pdf' })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          filename: 'invoice.pdf',
          generateUrl: true,
          overwrite: true,
        })
      )
    })

    it('downloads by full Front URL', async () => {
      const downloadUrl = 'https://api2.frontapp.com/download/fil_456'

      mock.onGet(downloadUrl).reply({
        body: Buffer.from('file-content'),
        headers: { 'content-type': 'text/plain' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/fil_456.txt' }),
        },
      }

      const result = await service.getAttachment(downloadUrl)

      expect(result).toEqual({ url: 'https://storage.example.com/fil_456.txt' })
    })

    it('rejects non-HTTPS URLs', async () => {
      await expect(service.getAttachment('http://api2.frontapp.com/download/fil_456')).rejects.toThrow('Attachment URL must use HTTPS')
    })

    it('rejects non-Front URLs', async () => {
      await expect(service.getAttachment('https://evil.com/download/fil_456')).rejects.toThrow('Attachment URL must be a Front (frontapp.com) download link')
    })

    it('throws when attachment is missing', async () => {
      await expect(service.getAttachment()).rejects.toThrow('Attachment is required')
    })
  })

  // ── Comments ──

  describe('listComments', () => {
    it('fetches comments for a conversation', async () => {
      mock.onGet(`${BASE}/conversations/cnv_abc/comments`).reply({
        _results: [{ id: 'com_1', body: 'Note' }],
        _pagination: { next: null },
      })

      const result = await service.listComments('cnv_abc')

      expect(result._results).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('passes custom limit', async () => {
      mock.onGet(`${BASE}/conversations/cnv_abc/comments`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listComments('cnv_abc', 10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/conversations/cnv_abc/comments?page_token=xyz`

      mock.onGet(cursorUrl).reply({ _results: [], _pagination: { next: null } })

      await service.listComments('cnv_abc', undefined, cursorUrl)

      expect(mock.history[0].url).toBe(cursorUrl)
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.listComments()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('addComment', () => {
    it('sends POST with body and author', async () => {
      mock.onPost(`${BASE}/conversations/cnv_abc/comments`).reply({
        id: 'com_new',
        body: 'FYI',
      })

      const result = await service.addComment('cnv_abc', 'FYI', 'tea_1')

      expect(result).toMatchObject({ id: 'com_new', body: 'FYI' })
      expect(mock.history[0].body).toEqual({ body: 'FYI', author_id: 'tea_1' })
    })

    it('omits author_id when not provided', async () => {
      mock.onPost(`${BASE}/conversations/cnv_abc/comments`).reply({ id: 'com_new' })

      await service.addComment('cnv_abc', 'Note')

      expect(mock.history[0].body).toEqual({ body: 'Note' })
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.addComment()).rejects.toThrow('Conversation ID is required')
    })

    it('throws when body is missing', async () => {
      await expect(service.addComment('cnv_abc')).rejects.toThrow('Body is required')
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('fetches contacts with default limit', async () => {
      mock.onGet(`${BASE}/contacts`).reply({
        _results: [{ id: 'crd_1', name: 'Alice' }],
        _pagination: { next: null },
      })

      const result = await service.listContacts()

      expect(result._results).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('filters contacts by name locally', async () => {
      mock.onGet(`${BASE}/contacts`).reply({
        _results: [
          { id: 'crd_1', name: 'Alice' },
          { id: 'crd_2', name: 'Bob' },
        ],
        _pagination: { next: null },
      })

      const result = await service.listContacts('ali')

      expect(result._results).toHaveLength(1)
      expect(result._results[0].name).toBe('Alice')
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/contacts?page_token=abc`

      mock.onGet(cursorUrl).reply({ _results: [], _pagination: { next: null } })

      await service.listContacts(undefined, undefined, cursorUrl)

      expect(mock.history[0].url).toBe(cursorUrl)
    })
  })

  describe('getContact', () => {
    it('fetches contact by ID', async () => {
      mock.onGet(`${BASE}/contacts/crd_abc`).reply({
        id: 'crd_abc',
        name: 'Alice',
      })

      const result = await service.getContact('crd_abc')

      expect(result).toMatchObject({ id: 'crd_abc', name: 'Alice' })
    })

    it('throws when contactId is missing', async () => {
      await expect(service.getContact()).rejects.toThrow('Contact ID is required')
    })
  })

  describe('createContact', () => {
    it('sends POST with parsed handles', async () => {
      mock.onPost(`${BASE}/contacts`).reply({
        id: 'crd_new',
        name: 'Jane Doe',
      })

      const result = await service.createContact(
        'Jane Doe',
        'email:jane@example.com, phone:+15551234567',
        'VIP customer',
        'https://linkedin.com/in/jane'
      )

      expect(result).toMatchObject({ id: 'crd_new' })
      expect(mock.history[0].body).toMatchObject({
        name: 'Jane Doe',
        description: 'VIP customer',
        handles: [
          { source: 'email', handle: 'jane@example.com' },
          { source: 'phone', handle: '+15551234567' },
        ],
        links: ['https://linkedin.com/in/jane'],
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/contacts`).reply({ id: 'crd_new' })

      await service.createContact('Jane', 'email:jane@example.com')

      const body = mock.history[0].body

      expect(body.name).toBe('Jane')
      expect(body.handles).toHaveLength(1)
      expect(body.links).toBeUndefined()
      expect(body.description).toBeUndefined()
    })

    it('throws on invalid handle format', async () => {
      await expect(service.createContact('Jane', 'badhandle')).rejects.toThrow('Invalid handle entry')
    })

    it('throws when name is missing', async () => {
      await expect(service.createContact()).rejects.toThrow('Name is required')
    })

    it('throws when handles is missing', async () => {
      await expect(service.createContact('Jane')).rejects.toThrow('At least one handle is required')
    })
  })

  describe('updateContact', () => {
    it('sends PATCH with name and description', async () => {
      mock.onPatch(`${BASE}/contacts/crd_abc`).reply({})

      const result = await service.updateContact('crd_abc', 'New Name', 'New desc')

      expect(result).toEqual({ success: true, contactId: 'crd_abc' })
      expect(mock.history[0].body).toEqual({ name: 'New Name', description: 'New desc' })
    })

    it('omits undefined fields from body', async () => {
      mock.onPatch(`${BASE}/contacts/crd_abc`).reply({})

      await service.updateContact('crd_abc', 'Name Only')

      expect(mock.history[0].body).toEqual({ name: 'Name Only' })
    })

    it('throws when contactId is missing', async () => {
      await expect(service.updateContact()).rejects.toThrow('Contact ID is required')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('fetches accounts with default limit', async () => {
      mock.onGet(`${BASE}/accounts`).reply({
        _results: [{ id: 'act_1', name: 'Acme Inc' }],
        _pagination: { next: null },
      })

      const result = await service.listAccounts()

      expect(result._results).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('filters accounts by name locally', async () => {
      mock.onGet(`${BASE}/accounts`).reply({
        _results: [
          { id: 'act_1', name: 'Acme Inc' },
          { id: 'act_2', name: 'Globex Corp' },
        ],
        _pagination: { next: null },
      })

      const result = await service.listAccounts('acme')

      expect(result._results).toHaveLength(1)
      expect(result._results[0].name).toBe('Acme Inc')
    })

    it('uses cursor URL when provided', async () => {
      const cursorUrl = `${BASE}/accounts?page_token=abc`

      mock.onGet(cursorUrl).reply({ _results: [], _pagination: { next: null } })

      await service.listAccounts(undefined, undefined, cursorUrl)

      expect(mock.history[0].url).toBe(cursorUrl)
    })
  })

  describe('getAccount', () => {
    it('fetches account by ID', async () => {
      mock.onGet(`${BASE}/accounts/act_xyz`).reply({
        id: 'act_xyz',
        name: 'Acme Inc',
      })

      const result = await service.getAccount('act_xyz')

      expect(result).toMatchObject({ id: 'act_xyz', name: 'Acme Inc' })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.getAccount()).rejects.toThrow('Account ID is required')
    })
  })

  describe('createAccount', () => {
    it('sends POST with name, domains, description, externalId', async () => {
      mock.onPost(`${BASE}/accounts`).reply({
        id: 'act_new',
        name: 'Acme Inc',
      })

      const result = await service.createAccount('Acme Inc', 'acme.com, acme.co.uk', 'Key customer', 'ext_123')

      expect(result).toMatchObject({ id: 'act_new' })
      expect(mock.history[0].body).toMatchObject({
        name: 'Acme Inc',
        description: 'Key customer',
        external_id: 'ext_123',
        domains: [{ domain: 'acme.com' }, { domain: 'acme.co.uk' }],
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/accounts`).reply({ id: 'act_new' })

      await service.createAccount('Acme Inc')

      const body = mock.history[0].body

      expect(body.name).toBe('Acme Inc')
      expect(body.domains).toBeUndefined()
      expect(body.description).toBeUndefined()
      expect(body.external_id).toBeUndefined()
    })

    it('throws when name is missing', async () => {
      await expect(service.createAccount()).rejects.toThrow('Name is required')
    })
  })

  describe('updateAccount', () => {
    it('sends PATCH with name and domains', async () => {
      mock.onPatch(`${BASE}/accounts/act_xyz`).reply({})

      const result = await service.updateAccount('act_xyz', 'New Name', 'newdomain.com', 'New desc')

      expect(result).toEqual({ success: true, accountId: 'act_xyz' })
      expect(mock.history[0].body).toMatchObject({
        name: 'New Name',
        description: 'New desc',
        domains: [{ domain: 'newdomain.com' }],
      })
    })

    it('omits domains when not provided', async () => {
      mock.onPatch(`${BASE}/accounts/act_xyz`).reply({})

      await service.updateAccount('act_xyz', 'Name Only')

      expect(mock.history[0].body).toEqual({ name: 'Name Only' })
      expect(mock.history[0].body.domains).toBeUndefined()
    })

    it('throws when accountId is missing', async () => {
      await expect(service.updateAccount()).rejects.toThrow('Account ID is required')
    })
  })

  // ── Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the correct method by eventName', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  describe('onNewConversation', () => {
    it('returns events in learning mode', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [{ id: 'cnv_1', subject: 'Test' }],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('cnv_1')
      expect(result.state).toBeNull()
    })

    it('seeds state on first poll (no state)', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [{ id: 'cnv_1' }, { id: 'cnv_2' }],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        state: null,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(0)
      expect(result.state.ids).toEqual(['cnv_1', 'cnv_2'])
    })

    it('emits only new conversations on subsequent polls', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [{ id: 'cnv_1' }, { id: 'cnv_2' }, { id: 'cnv_3' }],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        state: { ids: ['cnv_1', 'cnv_2'] },
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('cnv_3')
      expect(result.state.ids).toContain('cnv_3')
    })

    it('passes inbox and tag filters', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: { inboxId: 'inb_1', tagId: 'tag_1' },
        learningMode: true,
      }

      await service.handleTriggerPollingForEvent(invocation)

      expect(mock.history[0].query).toMatchObject({
        inbox_id: 'inb_1',
        tag_id: 'tag_1',
      })
    })
  })

  describe('onNewInboundMessage', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)

    it('returns latest inbound message in learning mode', async () => {
      mock.onAny().replyWith((call) => {
        if (call.url.includes('/search/')) {
          return {
            _results: [{ id: 'cnv_1' }],
            _pagination: { next: null },
          }
        }

        if (call.url.includes('/messages')) {
          return {
            _results: [{
              id: 'msg_1',
              is_inbound: true,
              created_at: nowSeconds,
              recipients: [{ handle: 'alice@test.com', role: 'from' }],
              attachments: [],
            }],
            _pagination: { next: null },
          }
        }

        return { _results: [], _pagination: { next: null } }
      })

      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].conversation_id).toBe('cnv_1')
      expect(result.events[0].senderEmail).toBe('alice@test.com')
      expect(result.state).toBeNull()
    })

    it('seeds state on first poll with no events', async () => {
      mock.onAny().reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: {},
        state: null,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(0)
      expect(result.state).toHaveProperty('watermark')
      expect(result.state).toHaveProperty('ids')
    })

    it('emits new inbound messages on subsequent polls', async () => {
      const watermark = nowSeconds - 120

      mock.onAny().replyWith((call) => {
        if (call.url.includes('/search/')) {
          return {
            _results: [{ id: 'cnv_1' }],
            _pagination: { next: null },
          }
        }

        if (call.url.includes('/messages')) {
          return {
            _results: [
              { id: 'msg_old', is_inbound: true, created_at: watermark - 10, recipients: [], attachments: [] },
              { id: 'msg_new', is_inbound: true, created_at: nowSeconds - 10, recipients: [{ handle: 'bob@test.com', role: 'from' }], attachments: [] },
            ],
            _pagination: { next: null },
          }
        }

        return { _results: [], _pagination: { next: null } }
      })

      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: {},
        state: { watermark, ids: ['msg_old'] },
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('msg_new')
      expect(result.state.watermark).toBeGreaterThanOrEqual(nowSeconds - 10)
    })
  })

  describe('onNewComment', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)

    it('returns latest comment in learning mode', async () => {
      mock.onAny().replyWith((call) => {
        if (call.url.includes('/search/')) {
          return {
            _results: [{ id: 'cnv_1' }],
            _pagination: { next: null },
          }
        }

        if (call.url.includes('/comments')) {
          return {
            _results: [{
              id: 'com_1',
              body: 'Note',
              posted_at: nowSeconds,
            }],
            _pagination: { next: null },
          }
        }

        return { _results: [], _pagination: { next: null } }
      })

      const invocation = {
        eventName: 'onNewComment',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].conversation_id).toBe('cnv_1')
      expect(result.state).toBeNull()
    })

    it('seeds state on first poll', async () => {
      mock.onAny().reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewComment',
        triggerData: {},
        state: null,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(0)
      expect(result.state).toHaveProperty('watermark')
      expect(result.state).toHaveProperty('ids')
    })

    it('emits new comments on subsequent polls', async () => {
      const watermark = nowSeconds - 120

      mock.onAny().replyWith((call) => {
        if (call.url.includes('/search/')) {
          return {
            _results: [{ id: 'cnv_1' }],
            _pagination: { next: null },
          }
        }

        if (call.url.includes('/comments')) {
          return {
            _results: [
              { id: 'com_old', body: 'Old', posted_at: watermark - 10 },
              { id: 'com_new', body: 'New', posted_at: nowSeconds - 5 },
            ],
            _pagination: { next: null },
          }
        }

        return { _results: [], _pagination: { next: null } }
      })

      const invocation = {
        eventName: 'onNewComment',
        triggerData: {},
        state: { watermark, ids: ['com_old'] },
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('com_new')
      expect(result.state.watermark).toBeGreaterThanOrEqual(nowSeconds - 5)
    })

    it('passes inbox filter to search query', async () => {
      mock.onAny().reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewComment',
        triggerData: { inboxId: 'inb_1' },
        learningMode: true,
      }

      await service.handleTriggerPollingForEvent(invocation)

      // The search URL should contain the inbox filter
      expect(mock.history[0].url).toContain('inbox%3Ainb_1')
    })
  })

  // ── Additional coverage ──

  describe('getAttachment - extension inference', () => {
    it('appends extension from mime type when filename has no extension', async () => {
      mock.onGet(`${BASE}/download/fil_noext`).reply({
        body: Buffer.from('data'),
        headers: { 'content-type': 'image/png' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/file.png' }),
        },
      }

      await service.getAttachment('fil_noext', 'myimage')

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filename: 'myimage.png' })
      )
    })

    it('does not double-append extension when filename already has one', async () => {
      mock.onGet(`${BASE}/download/fil_ext`).reply({
        body: Buffer.from('data'),
        headers: { 'content-type': 'application/pdf' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/doc.pdf' }),
        },
      }

      await service.getAttachment('fil_ext', 'report.pdf')

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filename: 'report.pdf' })
      )
    })

    it('uses fileOptions scope when provided', async () => {
      mock.onGet(`${BASE}/download/fil_scope`).reply({
        body: Buffer.from('data'),
        headers: { 'content-type': 'text/plain' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/file.txt' }),
        },
      }

      await service.getAttachment('fil_scope', 'notes.txt', { scope: 'APP' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scope: 'APP' })
      )
    })

    it('rejects invalid URL format', async () => {
      await expect(service.getAttachment('https://not a valid url')).rejects.toThrow('Attachment URL is not a valid URL')
    })

    it('handles unknown mime type without appending extension', async () => {
      mock.onGet(`${BASE}/download/fil_unk`).reply({
        body: Buffer.from('data'),
        headers: { 'content-type': 'application/octet-stream' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/file' }),
        },
      }

      await service.getAttachment('fil_unk', 'binary')

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filename: 'binary' })
      )
    })

    it('derives filename from URL when not provided', async () => {
      mock.onGet(`${BASE}/download/fil_abc`).reply({
        body: Buffer.from('data'),
        headers: { 'content-type': 'application/pdf' },
      })

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/fil_abc' }),
        },
      }

      await service.getAttachment('fil_abc')

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filename: 'fil_abc.pdf' })
      )
    })
  })

  describe('getTeammatesDictionary - label fallbacks', () => {
    it('uses email as label when names and username are empty', async () => {
      mock.onGet(`${BASE}/teammates`).reply({
        _results: [
          { id: 'tea_1', first_name: '', last_name: '', email: 'solo@test.com', username: '' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTeammatesDictionary({})

      expect(result.items[0].label).toBe('solo@test.com')
    })

    it('filters teammates by username', async () => {
      mock.onGet(`${BASE}/teammates`).reply({
        _results: [
          { id: 'tea_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com', username: 'jdoe' },
          { id: 'tea_2', first_name: 'Bob', last_name: 'Smith', email: 'bob@test.com', username: 'bsmith' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getTeammatesDictionary({ search: 'jdoe' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tea_1')
    })
  })

  describe('getChannelsDictionary - default note', () => {
    it('uses "channel" as note when type is falsy', async () => {
      mock.onGet(`${BASE}/channels`).reply({
        _results: [
          { id: 'cha_1', name: 'Test', address: 'test@test.com' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getChannelsDictionary({})

      expect(result.items[0].note).toBe('channel')
    })
  })

  describe('getInboxesDictionary - default note', () => {
    it('uses "inbox" as note when type is falsy', async () => {
      mock.onGet(`${BASE}/inboxes`).reply({
        _results: [
          { id: 'inb_1', name: 'Test' },
        ],
        _pagination: { next: null },
      })

      const result = await service.getInboxesDictionary({})

      expect(result.items[0].note).toBe('inbox')
    })
  })

  describe('onNewInboundMessage - inbox filter', () => {
    it('includes inbox in search query when provided', async () => {
      mock.onAny().reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: { inboxId: 'inb_1' },
        learningMode: true,
      }

      await service.handleTriggerPollingForEvent(invocation)

      expect(mock.history[0].url).toContain('inbox%3Ainb_1')
    })
  })

  describe('onNewInboundMessage - attachment normalization', () => {
    it('normalizes attachments with metadata', async () => {
      const nowSec = Math.floor(Date.now() / 1000)

      mock.onAny().replyWith((call) => {
        if (call.url.includes('/search/')) {
          return {
            _results: [{ id: 'cnv_1' }],
            _pagination: { next: null },
          }
        }

        if (call.url.includes('/messages')) {
          return {
            _results: [{
              id: 'msg_att',
              is_inbound: true,
              created_at: nowSec,
              recipients: [{ handle: 'sender@test.com', role: 'from' }],
              attachments: [{
                id: 'fil_1',
                filename: 'doc.pdf',
                content_type: 'application/pdf',
                size: 1024,
                url: 'https://api2.frontapp.com/download/fil_1',
                metadata: { is_inline: true },
              }],
            }],
            _pagination: { next: null },
          }
        }

        return { _results: [], _pagination: { next: null } }
      })

      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events[0].attachments[0]).toEqual({
        id: 'fil_1',
        filename: 'doc.pdf',
        content_type: 'application/pdf',
        size: 1024,
        url: 'https://api2.frontapp.com/download/fil_1',
        is_inline: true,
      })
    })
  })

  describe('onNewConversation - empty results', () => {
    it('returns empty events in learning mode when no conversations', async () => {
      mock.onGet(`${BASE}/conversations`).reply({
        _results: [],
        _pagination: { next: null },
      })

      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result.events).toHaveLength(0)
      expect(result.state).toBeNull()
    })
  })

  describe('error handling - non-object error body', () => {
    it('JSON-stringifies non-string, non-_error error bodies', async () => {
      mock.onGet(`${BASE}/conversations/cnv_bad`).replyWithError({
        message: { code: 500, detail: 'Internal error' },
      })

      await expect(service.getConversation('cnv_bad')).rejects.toThrow('Front API error:')
    })
  })

  describe('listContacts - custom limit', () => {
    it('passes custom limit to API', async () => {
      mock.onGet(`${BASE}/contacts`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listContacts(undefined, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })
  })

  describe('listAccounts - custom limit', () => {
    it('passes custom limit to API', async () => {
      mock.onGet(`${BASE}/accounts`).reply({
        _results: [],
        _pagination: { next: null },
      })

      await service.listAccounts(undefined, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps Front API error with message from _error object', async () => {
      mock.onGet(`${BASE}/conversations/cnv_bad`).replyWithError({
        message: { _error: { message: 'Not found' } },
      })

      await expect(service.getConversation('cnv_bad')).rejects.toThrow('Front API error: Not found')
    })

    it('wraps string error messages', async () => {
      mock.onGet(`${BASE}/conversations/cnv_bad`).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.getConversation('cnv_bad')).rejects.toThrow('Front API error: Unauthorized')
    })

    it('wraps _error.title when message is missing', async () => {
      mock.onGet(`${BASE}/conversations/cnv_bad`).replyWithError({
        message: { _error: { title: 'Forbidden' } },
      })

      await expect(service.getConversation('cnv_bad')).rejects.toThrow('Front API error: Forbidden')
    })
  })
})
