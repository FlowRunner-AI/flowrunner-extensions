'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MailerSend Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mailer-send')
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

  // ── Dictionary Methods ──

  describe('getSendersDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getSendersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters senders by search term', async () => {
      const all = await service.getSendersDictionary({})

      if (all.items.length === 0) {
        console.log('Skipping search filter test: no senders available')
        return
      }

      const firstLabel = all.items[0].label
      const searchTerm = firstLabel.split(' ')[0]
      const filtered = await service.getSendersDictionary({ search: searchTerm })

      expect(filtered).toHaveProperty('items')
      expect(Array.isArray(filtered.items)).toBe(true)
      expect(filtered.items.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getTemplatesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Send Email ──

  describe('sendEmail', () => {
    it('sends a plain text email to the test recipient', async () => {
      if (!testValues.recipientEmail) {
        console.log('Skipping sendEmail: set testValues.recipientEmail')
        return
      }

      const result = await service.sendEmail(
        undefined,
        undefined,
        testValues.recipientEmail,
        `MailerSend E2E Test - ${Date.now()}`,
        undefined,
        'This is an automated e2e test email from the MailerSend service tests.'
      )

      expect(result).toHaveProperty('statusCode')
      expect(result.statusCode).toBe(202)
    })

    it('sends an HTML email to the test recipient', async () => {
      if (!testValues.recipientEmail) {
        console.log('Skipping sendEmail HTML: set testValues.recipientEmail')
        return
      }

      const result = await service.sendEmail(
        undefined,
        'E2E Test Recipient',
        testValues.recipientEmail,
        `MailerSend E2E HTML Test - ${Date.now()}`,
        '<p>This is an <strong>automated e2e test</strong> email.</p>',
        'This is an automated e2e test email.'
      )

      expect(result).toHaveProperty('statusCode')
      expect(result.statusCode).toBe(202)
    })
  })

  // ── Send Email with CC/BCC ──

  describe('sendEmailWithCcAndBcc', () => {
    it('sends an email with multiple recipients', async () => {
      if (!testValues.recipientEmail) {
        console.log('Skipping sendEmailWithCcAndBcc: set testValues.recipientEmail')
        return
      }

      const result = await service.sendEmailWithCcAndBcc(
        undefined,
        [testValues.recipientEmail],
        undefined,
        undefined,
        `MailerSend E2E CC/BCC Test - ${Date.now()}`,
        undefined,
        'This is an automated e2e test email with CC/BCC support.'
      )

      expect(result).toHaveProperty('statusCode')
      expect(result.statusCode).toBe(202)
    })
  })

  // ── Send Email with Template ──

  describe('sendEmailWithTemplate', () => {
    it('sends an email using a template when templates are available', async () => {
      if (!testValues.recipientEmail) {
        console.log('Skipping sendEmailWithTemplate: set testValues.recipientEmail')
        return
      }

      const templates = await service.getTemplatesDictionary({})

      if (templates.items.length === 0) {
        console.log('Skipping sendEmailWithTemplate: no templates available in the account')
        return
      }

      const templateId = templates.items[0].value

      const result = await service.sendEmailWithTemplate(
        undefined,
        [testValues.recipientEmail],
        templateId,
        `MailerSend E2E Template Test - ${Date.now()}`
      )

      expect(result).toHaveProperty('statusCode')
      expect(result.statusCode).toBe(202)
    })
  })
})
