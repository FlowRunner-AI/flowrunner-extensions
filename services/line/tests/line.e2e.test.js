'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('LINE Service (e2e)', () => {
  let sandbox
  let service
  let userId

  beforeAll(() => {
    sandbox = createE2ESandbox('line')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    userId = sandbox.getTestValues().userId

    if (!userId) {
      console.log('Missing testValues.userId in e2e-config.json for line')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getBotInfo', () => {
    it('returns bot info with expected shape', async () => {
      const result = await service.getBotInfo()

      expect(result).toHaveProperty('userId')
      expect(result).toHaveProperty('basicId')
      expect(result).toHaveProperty('displayName')
      expect(result).toHaveProperty('chatMode')
      expect(result).toHaveProperty('markAsReadMode')
    })
  })

  // ── Profile ──

  describe('getProfile', () => {
    it('returns user profile with expected shape', async () => {
      const result = await service.getProfile(userId)

      expect(result).toHaveProperty('userId', userId)
      expect(result).toHaveProperty('displayName')
    })
  })

  // ── Insights ──

  describe('getMessageQuota', () => {
    it('returns message quota with expected shape', async () => {
      const result = await service.getMessageQuota()

      expect(result).toHaveProperty('type')
    })
  })

  describe('getMessageConsumption', () => {
    it('returns message consumption with expected shape', async () => {
      const result = await service.getMessageConsumption()

      expect(result).toHaveProperty('totalUsage')
      expect(typeof result.totalUsage).toBe('number')
    })
  })

  describe('getSentMessageCount', () => {
    it('returns sent message count for a recent date', async () => {
      // Use yesterday's date in yyyyMMdd format (UTC+9 / JST for LINE)
      const now = new Date()
      now.setDate(now.getDate() - 1)
      const date = now.toISOString().slice(0, 10).replace(/-/g, '')

      const result = await service.getSentMessageCount(date)

      expect(result).toHaveProperty('status')
      expect(['ready', 'unready', 'unavailable_for_privacy', 'out_of_service']).toContain(result.status)
    })
  })

  // ── Messaging ──

  describe('pushMessage + text', () => {
    it('sends a push text message to the test user', async () => {
      const result = await service.pushMessage(userId, 'E2E test message from FlowRunner')

      expect(result).toHaveProperty('sentMessages')
      expect(Array.isArray(result.sentMessages)).toBe(true)
      expect(result.sentMessages.length).toBeGreaterThanOrEqual(1)
      expect(result.sentMessages[0]).toHaveProperty('id')
    })
  })

  describe('pushMessage + raw messages array', () => {
    it('sends a push message with raw messages array', async () => {
      const messages = [
        { type: 'text', text: 'E2E raw message test' },
      ]

      const result = await service.pushMessage(userId, undefined, messages)

      expect(result).toHaveProperty('sentMessages')
      expect(result.sentMessages.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Rich Menu ──

  describe('listRichMenus', () => {
    it('returns rich menus list with expected shape', async () => {
      const result = await service.listRichMenus()

      expect(result).toHaveProperty('richmenus')
      expect(Array.isArray(result.richmenus)).toBe(true)
    })
  })
})
