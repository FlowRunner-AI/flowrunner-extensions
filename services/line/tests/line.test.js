'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CHANNEL_ACCESS_TOKEN = 'test-channel-access-token'
const BASE = 'https://api.line.me/v2/bot'
const DATA_BASE = 'https://api-data.line.me/v2/bot'

describe('LINE Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ channelAccessToken: CHANNEL_ACCESS_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'channelAccessToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Messaging ──

  describe('pushMessage', () => {
    it('sends correct request with text message', async () => {
      mock.onPost(`${ BASE }/message/push`).reply({ sentMessages: [{ id: '1' }] })

      const result = await service.pushMessage('U1234', 'Hello')

      expect(result).toEqual({ sentMessages: [{ id: '1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ CHANNEL_ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        to: 'U1234',
        messages: [{ type: 'text', text: 'Hello' }],
      })
    })

    it('sends raw messages array when provided', async () => {
      mock.onPost(`${ BASE }/message/push`).reply({ sentMessages: [{ id: '2' }] })

      const rawMessages = [{ type: 'image', originalContentUrl: 'https://example.com/img.jpg', previewImageUrl: 'https://example.com/img_s.jpg' }]
      await service.pushMessage('U1234', 'ignored text', rawMessages)

      expect(mock.history[0].body).toEqual({
        to: 'U1234',
        messages: rawMessages,
      })
    })

    it('throws when neither text nor messages provided', async () => {
      await expect(service.pushMessage('U1234')).rejects.toThrow(
        'LINE API error: provide a Message text or a non-empty Messages array.'
      )
    })

    it('throws when text is empty and messages is empty array', async () => {
      await expect(service.pushMessage('U1234', '', [])).rejects.toThrow(
        'LINE API error: provide a Message text or a non-empty Messages array.'
      )
    })

    it('throws on API error with details', async () => {
      mock.onPost(`${ BASE }/message/push`).replyWithError({
        message: 'Bad Request',
        body: {
          message: 'The request body has 1 error(s)',
          details: [{ property: 'messages[0].text', message: 'May not be empty' }],
        },
      })

      await expect(service.pushMessage('U1234', 'x')).rejects.toThrow(
        'LINE API error: The request body has 1 error(s) (messages[0].text: May not be empty)'
      )
    })

    it('throws on API error without details', async () => {
      mock.onPost(`${ BASE }/message/push`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Authentication failed' },
      })

      await expect(service.pushMessage('U1234', 'x')).rejects.toThrow(
        'LINE API error: Authentication failed'
      )
    })

    it('throws with fallback message when error body is empty', async () => {
      mock.onPost(`${ BASE }/message/push`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.pushMessage('U1234', 'x')).rejects.toThrow(
        'LINE API error: Network Error'
      )
    })
  })

  describe('replyMessage', () => {
    it('sends correct request with text message', async () => {
      mock.onPost(`${ BASE }/message/reply`).reply({ sentMessages: [{ id: '3' }] })

      const result = await service.replyMessage('reply-token-abc', 'Thanks!')

      expect(result).toEqual({ sentMessages: [{ id: '3' }] })
      expect(mock.history[0].body).toEqual({
        replyToken: 'reply-token-abc',
        messages: [{ type: 'text', text: 'Thanks!' }],
      })
    })

    it('sends raw messages array when provided', async () => {
      mock.onPost(`${ BASE }/message/reply`).reply({ sentMessages: [{ id: '4' }] })

      const rawMessages = [{ type: 'sticker', packageId: '1', stickerId: '1' }]
      await service.replyMessage('reply-token-abc', undefined, rawMessages)

      expect(mock.history[0].body).toEqual({
        replyToken: 'reply-token-abc',
        messages: rawMessages,
      })
    })
  })

  describe('multicastMessage', () => {
    it('sends correct request with text message', async () => {
      mock.onPost(`${ BASE }/message/multicast`).reply({})

      const result = await service.multicastMessage(['U1', 'U2'], 'Hello all')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({
        to: ['U1', 'U2'],
        messages: [{ type: 'text', text: 'Hello all' }],
      })
    })

    it('returns response body when non-empty', async () => {
      mock.onPost(`${ BASE }/message/multicast`).reply({ sentMessages: [{ id: '5' }] })

      const result = await service.multicastMessage(['U1'], 'Hi')

      expect(result).toEqual({ sentMessages: [{ id: '5' }] })
    })

    it('normalizes null response to status object', async () => {
      mock.onPost(`${ BASE }/message/multicast`).reply(null)

      const result = await service.multicastMessage(['U1'], 'Hi')

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when to is empty array', async () => {
      await expect(service.multicastMessage([], 'Hi')).rejects.toThrow(
        'LINE API error: provide at least one user ID in To.'
      )
    })

    it('throws when to is not an array', async () => {
      await expect(service.multicastMessage('U1', 'Hi')).rejects.toThrow(
        'LINE API error: provide at least one user ID in To.'
      )
    })

    it('throws when recipients exceed 500', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `U${ i }`)

      await expect(service.multicastMessage(ids, 'Hi')).rejects.toThrow(
        'LINE API error: multicast supports at most 500 recipients per call (received 501).'
      )
    })

    it('sends raw messages array when provided', async () => {
      mock.onPost(`${ BASE }/message/multicast`).reply({})

      const rawMessages = [{ type: 'text', text: 'Custom' }]
      await service.multicastMessage(['U1'], undefined, rawMessages)

      expect(mock.history[0].body).toEqual({
        to: ['U1'],
        messages: rawMessages,
      })
    })
  })

  describe('broadcastMessage', () => {
    it('sends correct request with text message', async () => {
      mock.onPost(`${ BASE }/message/broadcast`).reply({})

      const result = await service.broadcastMessage('Announcement!')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({
        messages: [{ type: 'text', text: 'Announcement!' }],
      })
    })

    it('sends raw messages array when provided', async () => {
      mock.onPost(`${ BASE }/message/broadcast`).reply({})

      const rawMessages = [{ type: 'flex', altText: 'flex', contents: {} }]
      await service.broadcastMessage(undefined, rawMessages)

      expect(mock.history[0].body).toEqual({
        messages: rawMessages,
      })
    })

    it('returns response body when non-empty', async () => {
      mock.onPost(`${ BASE }/message/broadcast`).reply({ requestId: 'abc' })

      const result = await service.broadcastMessage('Hi')

      expect(result).toEqual({ requestId: 'abc' })
    })
  })

  describe('narrowcastMessage', () => {
    it('sends correct request with text and recipient filter', async () => {
      mock.onPost(`${ BASE }/message/narrowcast`).reply({})

      const recipient = { type: 'audience', audienceGroupId: 12345 }
      const result = await service.narrowcastMessage('Targeted msg', undefined, recipient)

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({
        messages: [{ type: 'text', text: 'Targeted msg' }],
        recipient,
      })
    })

    it('includes filter and limit when provided', async () => {
      mock.onPost(`${ BASE }/message/narrowcast`).reply({})

      const recipient = { type: 'audience', audienceGroupId: 12345 }
      const filter = { demographic: { type: 'gender', oneOf: ['male'] } }
      await service.narrowcastMessage('Hi', undefined, recipient, filter, 100)

      expect(mock.history[0].body).toEqual({
        messages: [{ type: 'text', text: 'Hi' }],
        recipient,
        filter,
        limit: { max: 100 },
      })
    })

    it('omits limit when max is not provided', async () => {
      mock.onPost(`${ BASE }/message/narrowcast`).reply({})

      await service.narrowcastMessage('Hi', undefined, undefined, undefined, undefined)

      expect(mock.history[0].body).toEqual({
        messages: [{ type: 'text', text: 'Hi' }],
      })
    })

    it('sends raw messages array when provided', async () => {
      mock.onPost(`${ BASE }/message/narrowcast`).reply({})

      const rawMessages = [{ type: 'text', text: 'Custom' }]
      await service.narrowcastMessage(undefined, rawMessages)

      expect(mock.history[0].body).toEqual({
        messages: rawMessages,
      })
    })
  })

  // ── Content ──

  describe('getMessageContent', () => {
    const MOCK_FILE_URL = 'https://files.flowrunner.io/flow/line_content_msg123'

    beforeEach(() => {
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: MOCK_FILE_URL }),
        },
      }
    })

    it('downloads content, uploads to file storage, and returns metadata', async () => {
      const binaryData = Buffer.from('fake-image-data')
      mock.onGet(`${ DATA_BASE }/message/msg123/content`).reply(binaryData)

      const result = await service.getMessageContent('msg123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBeNull()
      expect(result).toEqual({
        messageId: 'msg123',
        sizeBytes: binaryData.length,
        url: MOCK_FILE_URL,
      })
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'line_content_msg123',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('handles string body by converting to buffer', async () => {
      mock.onGet(`${ DATA_BASE }/message/msg456/content`).reply('string-data')

      const result = await service.getMessageContent('msg456')

      expect(result.messageId).toBe('msg456')
      expect(result.sizeBytes).toBe(Buffer.from('string-data').length)
      expect(result).toHaveProperty('url')
    })

    it('passes custom fileOptions when provided', async () => {
      mock.onGet(`${ DATA_BASE }/message/msg789/content`).reply(Buffer.from('data'))

      await service.getMessageContent('msg789', { scope: 'APP' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'line_content_msg789',
          scope: 'APP',
        })
      )
    })
  })

  // ── Profile ──

  describe('getProfile', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/profile/U1234`).reply({
        userId: 'U1234',
        displayName: 'Test User',
        pictureUrl: 'https://example.com/pic.jpg',
        statusMessage: 'Hello',
        language: 'en',
      })

      const result = await service.getProfile('U1234')

      expect(result).toEqual({
        userId: 'U1234',
        displayName: 'Test User',
        pictureUrl: 'https://example.com/pic.jpg',
        statusMessage: 'Hello',
        language: 'en',
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/profile/bad-id`).replyWithError({
        message: 'Not Found',
        body: { message: 'User not found' },
      })

      await expect(service.getProfile('bad-id')).rejects.toThrow('LINE API error: User not found')
    })
  })

  describe('getGroupMemberProfile', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/group/C1234/member/U5678`).reply({
        userId: 'U5678',
        displayName: 'Group Member',
        pictureUrl: 'https://example.com/pic.jpg',
      })

      const result = await service.getGroupMemberProfile('C1234', 'U5678')

      expect(result).toEqual({
        userId: 'U5678',
        displayName: 'Group Member',
        pictureUrl: 'https://example.com/pic.jpg',
      })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getGroupSummary', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/group/C1234/summary`).reply({
        groupId: 'C1234',
        groupName: 'Test Group',
        pictureUrl: 'https://example.com/group.jpg',
      })

      const result = await service.getGroupSummary('C1234')

      expect(result).toEqual({
        groupId: 'C1234',
        groupName: 'Test Group',
        pictureUrl: 'https://example.com/group.jpg',
      })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Insights ──

  describe('getMessageQuota', () => {
    it('sends correct request and returns quota', async () => {
      mock.onGet(`${ BASE }/message/quota`).reply({ type: 'limited', value: 1000 })

      const result = await service.getMessageQuota()

      expect(result).toEqual({ type: 'limited', value: 1000 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ CHANNEL_ACCESS_TOKEN }`,
      })
    })
  })

  describe('getMessageConsumption', () => {
    it('sends correct request and returns consumption', async () => {
      mock.onGet(`${ BASE }/message/quota/consumption`).reply({ totalUsage: 500 })

      const result = await service.getMessageConsumption()

      expect(result).toEqual({ totalUsage: 500 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getSentMessageCount', () => {
    it('sends correct request with yyyyMMdd date', async () => {
      mock.onGet(`${ BASE }/message/delivery/push`).reply({ status: 'ready', success: 100 })

      const result = await service.getSentMessageCount('20260713')

      expect(result).toEqual({ status: 'ready', success: 100 })
      expect(mock.history[0].query).toMatchObject({ date: '20260713' })
    })

    it('normalizes ISO date to yyyyMMdd format', async () => {
      mock.onGet(`${ BASE }/message/delivery/push`).reply({ status: 'ready', success: 50 })

      await service.getSentMessageCount('2026-07-13')

      expect(mock.history[0].query).toMatchObject({ date: '20260713' })
    })

    it('strips non-digit characters from date', async () => {
      mock.onGet(`${ BASE }/message/delivery/push`).reply({ status: 'ready', success: 0 })

      await service.getSentMessageCount('2026/07/13')

      expect(mock.history[0].query).toMatchObject({ date: '20260713' })
    })
  })

  // ── Rich Menu ──

  describe('listRichMenus', () => {
    it('sends correct request and returns rich menus', async () => {
      const menus = { richmenus: [{ richMenuId: 'rm-1', name: 'Menu A' }] }
      mock.onGet(`${ BASE }/richmenu/list`).reply(menus)

      const result = await service.listRichMenus()

      expect(result).toEqual(menus)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getRichMenu', () => {
    it('sends correct request with menu ID', async () => {
      const menu = { richMenuId: 'rm-1', name: 'Menu A', chatBarText: 'Tap here' }
      mock.onGet(`${ BASE }/richmenu/rm-1`).reply(menu)

      const result = await service.getRichMenu('rm-1')

      expect(result).toEqual(menu)
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Account ──

  describe('getBotInfo', () => {
    it('sends correct request and returns bot info', async () => {
      const botInfo = {
        userId: 'Ub9952f8',
        basicId: '@216nmvn',
        displayName: 'Test Bot',
        chatMode: 'chat',
        markAsReadMode: 'manual',
      }
      mock.onGet(`${ BASE }/info`).reply(botInfo)

      const result = await service.getBotInfo()

      expect(result).toEqual(botInfo)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ CHANNEL_ACCESS_TOKEN }`,
      })
    })
  })
})
