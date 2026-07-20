'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BOT_TOKEN = 'test-bot-token-123'
const BASE = `https://api.telegram.org/bot${ BOT_TOKEN }`

describe('Telegram Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ botToken: BOT_TOKEN })
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
          name: 'botToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Messaging ──

  describe('sendMessage', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendMessage`).reply({ message_id: 1 })

      const result = await service.sendMessage('123', 'Hello')

      expect(result).toEqual({ message_id: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        text: 'Hello',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendMessage`).reply({ message_id: 2 })

      await service.sendMessage('123', 'Hello', 'Markdown', true, true, 99)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        text: 'Hello',
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        disable_notification: true,
        reply_to_message_id: 99,
      })
    })

    it('throws on API error with structured body', async () => {
      mock.onPost(`${ BASE }/sendMessage`).replyWithError({
        message: 'Bad Request',
        body: { error_code: 400, description: 'Chat not found' },
      })

      await expect(service.sendMessage('bad', 'text')).rejects.toThrow('Telegram Error: [400] Chat not found')
    })

    it('throws original error when error.body is not an object', async () => {
      mock.onPost(`${ BASE }/sendMessage`).replyWithError({
        message: 'Network Error',
        body: 'not an object',
      })

      await expect(service.sendMessage('bad', 'text')).rejects.toThrow('Network Error')
    })
  })

  describe('sendPhoto', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendPhoto`).reply({ message_id: 3 })

      const result = await service.sendPhoto('123', 'https://example.com/photo.jpg')

      expect(result).toEqual({ message_id: 3 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        photo: 'https://example.com/photo.jpg',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendPhoto`).reply({ message_id: 4 })

      await service.sendPhoto('123', 'https://example.com/photo.jpg', 'A caption', 'HTML', true, 10)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        photo: 'https://example.com/photo.jpg',
        caption: 'A caption',
        parse_mode: 'HTML',
        disable_notification: true,
        reply_to_message_id: 10,
      })
    })
  })

  describe('sendDocument', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendDocument`).reply({ message_id: 5 })

      const result = await service.sendDocument('123', 'https://example.com/file.pdf')

      expect(result).toEqual({ message_id: 5 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        document: 'https://example.com/file.pdf',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendDocument`).reply({ message_id: 6 })

      await service.sendDocument('123', 'https://example.com/file.pdf', 'Doc caption', 'MarkdownV2', true, 20)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        document: 'https://example.com/file.pdf',
        caption: 'Doc caption',
        parse_mode: 'MarkdownV2',
        disable_notification: true,
        reply_to_message_id: 20,
      })
    })
  })

  describe('sendAudio', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendAudio`).reply({ message_id: 7 })

      const result = await service.sendAudio('123', 'https://example.com/audio.mp3')

      expect(result).toEqual({ message_id: 7 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        audio: 'https://example.com/audio.mp3',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendAudio`).reply({ message_id: 8 })

      await service.sendAudio('123', 'https://example.com/audio.mp3', 'Listen', 'HTML', 180, 'Artist', 'Song', true, 30)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        audio: 'https://example.com/audio.mp3',
        caption: 'Listen',
        parse_mode: 'HTML',
        duration: 180,
        performer: 'Artist',
        title: 'Song',
        disable_notification: true,
        reply_to_message_id: 30,
      })
    })
  })

  describe('sendSticker', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendSticker`).reply({ message_id: 9 })

      const result = await service.sendSticker('123', 'sticker-file-id')

      expect(result).toEqual({ message_id: 9 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        sticker: 'sticker-file-id',
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendSticker`).reply({ message_id: 10 })

      await service.sendSticker('123', 'sticker-file-id', '😊', true, 40)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        sticker: 'sticker-file-id',
        emoji: '😊',
        disable_notification: true,
        reply_to_message_id: 40,
      })
    })
  })

  describe('sendLocation', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/sendLocation`).reply({ message_id: 11 })

      const result = await service.sendLocation('123', 40.7128, -74.006)

      expect(result).toEqual({ message_id: 11 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        latitude: 40.7128,
        longitude: -74.006,
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/sendLocation`).reply({ message_id: 12 })

      await service.sendLocation('123', 40.7128, -74.006, 100, 300, 90, 500, true, 50)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        latitude: 40.7128,
        longitude: -74.006,
        horizontal_accuracy: 100,
        live_period: 300,
        heading: 90,
        proximity_alert_radius: 500,
        disable_notification: true,
        reply_to_message_id: 50,
      })
    })
  })

  describe('editMessageText', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/editMessageText`).reply({ message_id: 13 })

      const result = await service.editMessageText('123', 456, 'Updated text')

      expect(result).toEqual({ message_id: 13 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        message_id: 456,
        text: 'Updated text',
      })
    })

    it('includes optional params when provided', async () => {
      mock.onPost(`${ BASE }/editMessageText`).reply({ message_id: 14 })

      await service.editMessageText('123', 456, 'Updated', 'HTML', true)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        message_id: 456,
        text: 'Updated',
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
    })

    it('includes disable_web_page_preview when explicitly false', async () => {
      mock.onPost(`${ BASE }/editMessageText`).reply({ message_id: 15 })

      await service.editMessageText('123', 456, 'Text', undefined, false)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        message_id: 456,
        text: 'Text',
        disable_web_page_preview: false,
      })
    })
  })

  describe('deleteMessage', () => {
    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/deleteMessage`).reply({ ok: true, result: true })

      const result = await service.deleteMessage('123', 456)

      expect(result).toEqual({ ok: true, result: true })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        message_id: 456,
      })
    })
  })

  describe('forwardMessage', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/forwardMessage`).reply({ message_id: 16 })

      const result = await service.forwardMessage('123', '456', 789)

      expect(result).toEqual({ message_id: 16 })
      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        from_chat_id: '456',
        message_id: 789,
      })
    })

    it('includes disableNotification when provided', async () => {
      mock.onPost(`${ BASE }/forwardMessage`).reply({ message_id: 17 })

      await service.forwardMessage('123', '456', 789, true)

      expect(mock.history[0].body).toEqual({
        chat_id: '123',
        from_chat_id: '456',
        message_id: 789,
        disable_notification: true,
      })
    })
  })

  // ── Chat Management ──

  describe('getChat', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/getChat`).reply({ id: -100123, title: 'Test', type: 'supergroup' })

      const result = await service.getChat('-100123')

      expect(result).toEqual({ id: -100123, title: 'Test', type: 'supergroup' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ chat_id: '-100123' })
    })
  })

  describe('getChatMember', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/getChatMember`).reply({ user: { id: 999 }, status: 'member' })

      const result = await service.getChatMember('-100123', '999')

      expect(result).toEqual({ user: { id: 999 }, status: 'member' })
      expect(mock.history[0].query).toMatchObject({ chat_id: '-100123', user_id: '999' })
    })
  })

  // ── Bot Management ──

  describe('getMe', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/getMe`).reply({ id: 123, is_bot: true, first_name: 'TestBot' })

      const result = await service.getMe()

      expect(result).toEqual({ id: 123, is_bot: true, first_name: 'TestBot' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getUpdates', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({ ok: true, result: [] })

      const result = await service.getUpdates()

      expect(result).toEqual({ ok: true, result: [] })
      expect(mock.history[0].query).toMatchObject({ limit: 100, timeout: 0 })
    })

    it('passes custom parameters', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({ ok: true, result: [] })

      await service.getUpdates(10, 50, 30)

      expect(mock.history[0].query).toMatchObject({ offset: 10, limit: 50, timeout: 30 })
    })

  })

  describe('getWebhookInfo', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/getWebhookInfo`).reply({ ok: true, result: { url: '', pending_update_count: 0 } })

      const result = await service.getWebhookInfo()

      expect(result).toEqual({ ok: true, result: { url: '', pending_update_count: 0 } })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── File Management ──

  describe('getFile', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/getFile`).reply({ file_id: 'abc', file_path: 'photos/file.jpg' })

      const result = await service.getFile('abc')

      expect(result).toEqual({ file_id: 'abc', file_path: 'photos/file.jpg' })
      expect(mock.history[0].query).toMatchObject({ file_id: 'abc' })
    })
  })

  // ── Dictionary ──

  describe('getChatsDictionary', () => {
    const updatesResponse = {
      result: [
        {
          update_id: 1,
          message: {
            chat: { id: -100, title: 'Group A', type: 'supergroup' },
          },
        },
        {
          update_id: 2,
          message: {
            chat: { id: 200, first_name: 'John', last_name: 'Doe', username: 'johndoe', type: 'private' },
          },
        },
        {
          update_id: 3,
          message: {
            chat: { id: -300, title: 'Channel B', type: 'channel' },
          },
        },
      ],
    }

    it('returns all chats when no search is provided', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply(updatesResponse)

      const result = await service.getChatsDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBe(1)
      expect(result.items[0]).toMatchObject({ value: '-100', label: 'Group A (supergroup)' })
      expect(result.items[1]).toMatchObject({ value: '200', label: 'John Doe (private)' })
      expect(result.items[2]).toMatchObject({ value: '-300', label: 'Channel B (channel)' })
    })

    it('filters by search term for group chats', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply(updatesResponse)

      const result = await service.getChatsDictionary({ search: 'Group' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: '-100' })
    })

    it('filters by search term for private chats', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply(updatesResponse)

      const result = await service.getChatsDictionary({ search: 'john' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: '200' })
    })

    it('deduplicates chats by id', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({
        result: [
          { update_id: 1, message: { chat: { id: -100, title: 'Group', type: 'supergroup' } } },
          { update_id: 2, message: { chat: { id: -100, title: 'Group', type: 'supergroup' } } },
        ],
      })

      const result = await service.getChatsDictionary({})

      expect(result.items).toHaveLength(1)
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({ result: [] })

      const result = await service.getChatsDictionary(null)

      expect(result.items).toHaveLength(0)
      expect(result.cursor).toBe(1)
    })

    it('filters by chat id as search term', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({
        result: [
          {
            update_id: 1,
            message: {
              chat: { id: '-100', title: 'Group A', type: 'supergroup' },
            },
          },
          {
            update_id: 2,
            message: {
              chat: { id: '200', first_name: 'John', last_name: 'Doe', username: 'johndoe', type: 'private' },
            },
          },
        ],
      })

      const result = await service.getChatsDictionary({ search: '-100' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: '-100' })
    })

    it('includes member_count in note for group chats', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({
        result: [
          {
            update_id: 1,
            message: {
              chat: { id: -100, title: 'Big Group', type: 'supergroup', member_count: 42 },
            },
          },
        ],
      })

      const result = await service.getChatsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].note).toContain('Members: 42')
    })

    it('passes cursor as offset to getUpdates', async () => {
      mock.onGet(`${ BASE }/getUpdates`).reply({ result: [] })

      await service.getChatsDictionary({ cursor: 5 })

      expect(mock.history[0].query).toMatchObject({ offset: 5 })
    })
  })

  // ── Trigger System ──

  describe('onMessage', () => {
    it('shapes event correctly (SHAPE_EVENT)', async () => {
      const payload = {
        update_id: 123,
        message: { message_id: 1, chat: { id: 999 }, text: 'Hi' },
      }

      const result = await service.onMessage('SHAPE_EVENT', payload)

      expect(result).toEqual([
        { name: 'onMessage', data: payload },
      ])
    })

    it('filters triggers with matching chatId (FILTER_TRIGGER)', async () => {
      const payload = {
        triggers: [
          { id: 't1', data: { chatId: '999' } },
          { id: 't2', data: { chatId: '111' } },
          { id: 't3', data: {} },
        ],
        eventData: {
          message: { chat: { id: 999 } },
        },
      }

      const result = await service.onMessage('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('activates all triggers when chatId is not set', async () => {
      const payload = {
        triggers: [
          { id: 't1', data: {} },
          { id: 't2', data: {} },
        ],
        eventData: {
          message: { chat: { id: 999 } },
        },
      }

      const result = await service.onMessage('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't2'] })
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('sets webhook and returns webhook data', async () => {
      mock.onPost(`${ BASE }/setWebhook`).reply({ ok: true })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://example.com/webhook',
      })

      expect(mock.history[0].body).toEqual({ url: 'https://example.com/webhook' })
      expect(result).toHaveProperty('webhookData')
      expect(result.webhookData).toHaveProperty('webhookUrl', 'https://example.com/webhook')
      expect(result.webhookData).toHaveProperty('created')
    })

    it('throws on webhook set failure', async () => {
      mock.onPost(`${ BASE }/setWebhook`).replyWithError({
        message: 'Unauthorized',
        body: { error_code: 401, description: 'Unauthorized' },
      })

      await expect(
        service.handleTriggerUpsertWebhook({ callbackUrl: 'https://example.com/webhook' })
      ).rejects.toThrow()
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves message events', async () => {
      const invocation = {
        body: {
          update_id: 123,
          message: { message_id: 1, chat: { id: 999 }, text: 'Hi' },
        },
        queryParams: { connectionId: 'conn-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onMessage')
    })

    it('returns empty events when no message in body', async () => {
      const invocation = {
        body: { update_id: 124 },
        queryParams: { connectionId: 'conn-2' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-2')
      expect(result.events).toHaveLength(0)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the correct event method', async () => {
      const invocation = {
        eventName: 'onMessage',
        triggers: [
          { id: 't1', data: { chatId: '999' } },
        ],
        eventData: {
          message: { chat: { id: 999 } },
        },
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes webhook successfully', async () => {
      mock.onPost(`${ BASE }/deleteWebhook`).reply({ ok: true })

      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history[0].body).toEqual({ drop_pending_updates: false })
      expect(result).toEqual({})
    })

    it('throws on webhook delete failure', async () => {
      mock.onPost(`${ BASE }/deleteWebhook`).replyWithError({
        message: 'Server Error',
        body: { error_code: 500, description: 'Internal error' },
      })

      await expect(service.handleTriggerDeleteWebhook({})).rejects.toThrow()
    })
  })
})
