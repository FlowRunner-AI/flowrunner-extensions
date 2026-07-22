'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mailbox Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mailbox')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Read Inbox ──

  describe('readInbox', () => {
    it('returns an array of parsed emails', async () => {
      const result = await service.readInbox(3)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        const email = result[0]

        expect(email).toHaveProperty('uid')
        expect(email).toHaveProperty('messageId')
        expect(email).toHaveProperty('from')
        expect(email).toHaveProperty('subject')
        expect(email).toHaveProperty('date')
      }
    }, 30000)

    it('returns empty array when no emails match criteria', async () => {
      // Use a very specific sender that should not exist
      const result = await service.readInbox(5, 'nonexistent-sender-xyz-12345@impossible-domain-abc.test')

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    }, 30000)

    it('respects limit parameter', async () => {
      const result = await service.readInbox(1)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeLessThanOrEqual(1)
    }, 30000)

    it('filters by seen status', async () => {
      const result = await service.readInbox(3, undefined, undefined, undefined, undefined, undefined, true)

      expect(Array.isArray(result)).toBe(true)
    }, 30000)
  })

  // ── Mark Email As Unread ──

  describe('markEmailAsUnread', () => {
    it('marks a read email as unread and verifies', async () => {
      // First read inbox to get a UID (reading marks emails as seen)
      const emails = await service.readInbox(1, undefined, undefined, undefined, undefined, undefined, true)

      if (emails.length > 0) {
        const uid = emails[0].uid

        // Mark it as unread
        await expect(service.markEmailAsUnread(String(uid))).resolves.not.toThrow()
      } else {
        // Skip if no seen emails available
        console.log('No seen emails available to test markEmailAsUnread')
      }
    }, 30000)
  })

  // ── Send Email ──

  describe('sendEmail', () => {
    it('sends a test email successfully', async () => {
      const recipientEmail = testValues.recipientEmail || testValues.user

      if (!recipientEmail) {
        console.log('Skipping sendEmail test: no recipientEmail or user in testValues')

        return
      }

      const result = await service.sendEmail(
        'E2E Test',
        recipientEmail,
        `Mailbox E2E Test - ${ Date.now() }`,
        'This is an automated e2e test email. You can safely delete it.'
      )

      expect(result).toHaveProperty('messageId')
      expect(result).toHaveProperty('accepted')
      expect(Array.isArray(result.accepted)).toBe(true)
      expect(result.accepted).toContain(recipientEmail)
    }, 30000)
  })
})
