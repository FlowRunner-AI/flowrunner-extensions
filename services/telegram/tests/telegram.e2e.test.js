'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Telegram Service (e2e)', () => {
  let sandbox
  let service
  let chatId

  beforeAll(() => {
    sandbox = createE2ESandbox('telegram')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    chatId = sandbox.getTestValues().chatId

    if (!chatId) {
      console.log('Missing testValues.chatId in e2e-config.json for telegram')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Bot Management ──

  describe('getMe', () => {
    it('returns bot info with expected shape', async () => {
      const response = await service.getMe()

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('id')
      expect(response.result).toHaveProperty('is_bot', true)
      expect(response.result).toHaveProperty('first_name')
    })
  })

  describe('getWebhookInfo', () => {
    it('returns webhook info with expected shape', async () => {
      const response = await service.getWebhookInfo()

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('url')
      expect(response.result).toHaveProperty('pending_update_count')
    })
  })

  // ── Chat Management ──

  describe('getChat', () => {
    it('returns chat info for the test chat', async () => {
      const response = await service.getChat(chatId)

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('id')
      expect(response.result).toHaveProperty('type')
    })
  })

  // ── Messaging ──

  describe('sendMessage + editMessageText + deleteMessage', () => {
    let messageId

    it('sends a text message', async () => {
      const response = await service.sendMessage(chatId, 'E2E test message - will be deleted')

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('message_id')
      expect(response.result).toHaveProperty('chat')
      expect(response.result).toHaveProperty('text', 'E2E test message - will be deleted')
      messageId = response.result.message_id
    })

    it('edits the sent message', async () => {
      const response = await service.editMessageText(chatId, messageId, 'E2E test message - edited')

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('message_id', messageId)
      expect(response.result).toHaveProperty('text', 'E2E test message - edited')
    })

    it('deletes the sent message', async () => {
      const response = await service.deleteMessage(chatId, messageId)

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toBe(true)
    })
  })

  describe('sendMessage with parse mode', () => {
    let messageId

    it('sends a message with HTML parse mode', async () => {
      const response = await service.sendMessage(chatId, '<b>Bold</b> and <i>italic</i>', 'HTML')

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('message_id')
      messageId = response.result.message_id
    })

    afterAll(async () => {
      if (messageId) {
        await service.deleteMessage(chatId, messageId)
      }
    })
  })

  describe('sendLocation', () => {
    let messageId

    it('sends a location', async () => {
      const response = await service.sendLocation(chatId, 40.7128, -74.006)

      expect(response).toHaveProperty('ok', true)
      expect(response.result).toHaveProperty('message_id')
      expect(response.result).toHaveProperty('location')
      expect(response.result.location).toHaveProperty('latitude')
      expect(response.result.location).toHaveProperty('longitude')
      messageId = response.result.message_id
    })

    afterAll(async () => {
      if (messageId) {
        await service.deleteMessage(chatId, messageId)
      }
    })
  })

  // ── File Management ──

  describe('getUpdates', () => {
    it('returns updates with expected shape', async () => {
      const result = await service.getUpdates(undefined, 5, 0)

      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)
    })
  })

  // ── Dictionary ──

  describe('getChatsDictionary', () => {
    it('returns dictionary with items array and cursor', async () => {
      const result = await service.getChatsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
