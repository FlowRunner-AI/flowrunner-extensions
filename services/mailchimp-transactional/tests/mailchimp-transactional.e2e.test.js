'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mailchimp Transactional Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mailchimp-transactional')
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

  // ── Account Management ──

  describe('ping', () => {
    it('returns PONG! to verify API connection', async () => {
      const result = await service.ping()

      expect(result).toBe('PONG!')
    })
  })

  describe('getUserInfo', () => {
    it('returns user info with expected shape', async () => {
      const result = await service.getUserInfo()

      expect(result).toHaveProperty('username')
      expect(result).toHaveProperty('reputation')
      expect(result).toHaveProperty('hourly_quota')
      expect(result).toHaveProperty('stats')
    })
  })

  // ── Analytics ──

  describe('getTagsList', () => {
    it('returns an array of tags', async () => {
      const result = await service.getTagsList()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Rejection Management ──

  describe('addRejection + getRejectionsList', () => {
    const rejectionEmail = `e2e-reject-${ Date.now() }@example.com`

    it('adds an email to the rejection denylist', async () => {
      const result = await service.addRejection(rejectionEmail, 'E2E test rejection')

      expect(result).toHaveProperty('email', rejectionEmail)
      expect(result).toHaveProperty('added', true)
    })

    it('lists rejections and finds the added email', async () => {
      const result = await service.getRejectionsList(rejectionEmail)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toHaveProperty('email', rejectionEmail)
    })
  })

  describe('getRejectionsList', () => {
    it('returns an array of rejections', async () => {
      const result = await service.getRejectionsList()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Template Management ──

  describe('addTemplate + getTemplatesList', () => {
    const templateName = `E2E Template ${ Date.now() }`

    it('adds a new template', async () => {
      const result = await service.addTemplate(
        templateName,
        undefined,
        undefined,
        'E2E Test Subject',
        '<h1>Hello {{NAME}}</h1>',
        'Hello {{NAME}}',
        false,
        ['e2e-test']
      )

      expect(result).toHaveProperty('slug')
      expect(result).toHaveProperty('name', templateName)
    })

    it('lists templates and finds the created one', async () => {
      const result = await service.getTemplatesList('e2e-test')

      expect(Array.isArray(result)).toBe(true)
      const found = result.find(t => t.name === templateName)
      expect(found).toBeDefined()
    })
  })

  describe('getTemplatesList', () => {
    it('returns an array of templates', async () => {
      const result = await service.getTemplatesList()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Email Sending ──

  describe('sendMessage', () => {
    const canSend = () => Boolean(testValues.senderEmail && testValues.recipientEmail)

    it('sends a transactional message when sender and recipient are configured', async () => {
      if (!canSend()) {
        console.log('Skipping sendMessage: set testValues.senderEmail and testValues.recipientEmail')
        return
      }

      const result = await service.sendMessage(
        `E2E Test ${ Date.now() }`,
        testValues.senderEmail,
        'E2E Sender',
        [{ email: testValues.recipientEmail, type: 'to' }],
        '<p>This is an automated e2e test email from Mailchimp Transactional.</p>',
        'This is an automated e2e test email.'
      )

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toHaveProperty('email')
      expect(result[0]).toHaveProperty('status')
      expect(result[0]).toHaveProperty('_id')
    })
  })

  describe('sendWithTemplate', () => {
    const canSend = () => Boolean(
      testValues.senderEmail && testValues.recipientEmail && testValues.templateSlug
    )

    it('sends a templated message when sender, recipient, and template slug are configured', async () => {
      if (!canSend()) {
        console.log(
          'Skipping sendWithTemplate: set testValues.senderEmail, testValues.recipientEmail, and testValues.templateSlug'
        )
        return
      }

      const result = await service.sendWithTemplate(
        testValues.templateSlug,
        [{ name: 'main', content: 'E2E test content' }],
        `E2E Template Test ${ Date.now() }`,
        testValues.senderEmail,
        'E2E Sender',
        [{ email: testValues.recipientEmail, type: 'to' }]
      )

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toHaveProperty('status')
    })
  })

  // ── Message Tracking ──

  describe('getMessageInfo', () => {
    const canQuery = () => Boolean(testValues.messageId)

    it('returns message info when a messageId is configured', async () => {
      if (!canQuery()) {
        console.log('Skipping getMessageInfo: set testValues.messageId')
        return
      }

      const result = await service.getMessageInfo(testValues.messageId)

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('state')
      expect(result).toHaveProperty('sender')
    })
  })
})
