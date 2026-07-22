'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Postmark Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('postmark')
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

  // ── Message streams ──

  describe('listMessageStreams', () => {
    it('lists the server message streams', async () => {
      const result = await service.listMessageStreams()

      expect(result).toHaveProperty('MessageStreams')
      expect(Array.isArray(result.MessageStreams)).toBe(true)
    })

    it('filters by stream type', async () => {
      const result = await service.listMessageStreams('Transactional')

      expect(result).toHaveProperty('MessageStreams')
    })

    it('returns a message streams dictionary', async () => {
      const result = await service.getMessageStreamsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Templates ──

  describe('templates', () => {
    it('lists templates', async () => {
      const result = await service.listTemplates(5, 0)

      expect(result).toHaveProperty('TotalCount')
      expect(Array.isArray(result.Templates)).toBe(true)
    })

    it('returns a templates dictionary', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('retrieves a template when one exists', async () => {
      const list = await service.listTemplates(1, 0, 'Standard')
      const template = (list.Templates || [])[0]

      if (!template) {
        console.log('Skipping getTemplate: the server has no standard templates')

        return
      }

      const result = await service.getTemplate(String(template.TemplateId))

      expect(result).toHaveProperty('TemplateId', template.TemplateId)
      expect(result).toHaveProperty('Subject')
    })
  })

  // ── Email sending ──

  describe('email sending', () => {
    it('sends a plain email', async () => {
      const { fromEmail, toEmail } = testValues

      if (!fromEmail || !toEmail) {
        console.log('Skipping sendEmail: testValues.fromEmail or testValues.toEmail not set')

        return
      }

      const result = await service.sendEmail(
        fromEmail,
        toEmail,
        `FlowRunner e2e ${ SUFFIX }`,
        `<p>FlowRunner e2e run ${ SUFFIX }</p>`,
        `FlowRunner e2e run ${ SUFFIX }`,
        undefined,
        undefined,
        undefined,
        'flowrunner-e2e',
        false,
        'None',
        undefined,
        { run: String(SUFFIX) }
      )

      expect(result).toHaveProperty('MessageID')
      expect(result).toHaveProperty('ErrorCode', 0)
    })

    it('sends an email with a template', async () => {
      const { fromEmail, toEmail, templateAlias, templateId } = testValues

      if (!fromEmail || !toEmail || (!templateAlias && !templateId)) {
        console.log('Skipping sendEmailWithTemplate: testValues.fromEmail/toEmail and templateAlias or templateId not set')

        return
      }

      const result = await service.sendEmailWithTemplate(
        fromEmail,
        toEmail,
        templateId,
        templateAlias,
        testValues.templateModel || {}
      )

      expect(result).toHaveProperty('MessageID')
    })

    it('sends a batch of emails', async () => {
      const { fromEmail, toEmail } = testValues

      if (!fromEmail || !toEmail) {
        console.log('Skipping sendBatchEmails: testValues.fromEmail or testValues.toEmail not set')

        return
      }

      const result = await service.sendBatchEmails([
        {
          From: fromEmail,
          To: toEmail,
          Subject: `FlowRunner e2e batch ${ SUFFIX }`,
          TextBody: `FlowRunner e2e batch run ${ SUFFIX }`,
          MessageStream: 'outbound',
        },
      ])

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('ErrorCode')
    })

    it('rejects an email without a body', async () => {
      await expect(service.sendEmail('a@example.com', 'b@example.com', 'Subject'))
        .rejects.toThrow('provide at least one of HTML Body or Text Body')
    })

    it('rejects a template send without an id or alias', async () => {
      await expect(service.sendEmailWithTemplate('a@example.com', 'b@example.com'))
        .rejects.toThrow('provide either Template ID or Template Alias')
    })

    it('rejects an empty batch', async () => {
      await expect(service.sendBatchEmails([])).rejects.toThrow('Messages must be a non-empty array')
    })
  })

  // ── Outbound messages ──

  describe('outbound messages', () => {
    it('searches outbound messages', async () => {
      const result = await service.searchOutboundMessages(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5, 0
      )

      expect(result).toHaveProperty('TotalCount')
      expect(Array.isArray(result.Messages)).toBe(true)
    })

    it('retrieves message details when a message exists', async () => {
      const search = await service.searchOutboundMessages(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1, 0
      )

      const message = (search.Messages || [])[0]

      if (!message) {
        console.log('Skipping getMessageDetails: the server has no outbound messages')

        return
      }

      const result = await service.getMessageDetails(message.MessageID)

      expect(result).toHaveProperty('MessageID', message.MessageID)
      expect(result).toHaveProperty('MessageEvents')
    })
  })

  // ── Statistics ──

  describe('statistics', () => {
    it('returns the outbound overview', async () => {
      const result = await service.getOutboundOverview()

      expect(result).toHaveProperty('Sent')
    })

    it('returns the delivery stats', async () => {
      const result = await service.getDeliveryStats()

      expect(result).toHaveProperty('InactiveMails')
      expect(Array.isArray(result.Bounces)).toBe(true)
    })
  })

  // ── Bounces ──

  describe('bounces', () => {
    it('searches bounces', async () => {
      const result = await service.searchBounces(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5, 0
      )

      expect(result).toHaveProperty('TotalCount')
      expect(Array.isArray(result.Bounces)).toBe(true)
    })

    it('retrieves a bounce when one exists', async () => {
      const search = await service.searchBounces(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1, 0
      )

      const bounce = (search.Bounces || [])[0]

      if (!bounce) {
        console.log('Skipping getBounce: the server has no bounces')

        return
      }

      const result = await service.getBounce(String(bounce.ID))

      expect(result).toHaveProperty('ID', bounce.ID)
    })

    it('activates a bounce when one is reactivatable and enabled', async () => {
      if (!testValues.activatableBounceId) {
        console.log('Skipping activateBounce: testValues.activatableBounceId not set')

        return
      }

      const result = await service.activateBounce(String(testValues.activatableBounceId))

      expect(result).toHaveProperty('Bounce')
    })
  })

  // ── Suppressions ──

  describe('suppressions', () => {
    const stream = 'outbound'

    it('lists suppressions for the outbound stream', async () => {
      const result = await service.listSuppressions(stream)

      expect(result).toHaveProperty('Suppressions')
      expect(Array.isArray(result.Suppressions)).toBe(true)
    })

    it('creates and deletes a manual suppression', async () => {
      const email = testValues.suppressionEmail || `flowrunner-e2e-${ SUFFIX }@example.com`

      const created = await service.createSuppression(stream, [email])

      expect(created).toHaveProperty('Suppressions')
      expect(created.Suppressions[0]).toHaveProperty('EmailAddress', email)

      const deleted = await service.deleteSuppression(stream, [email])

      expect(deleted).toHaveProperty('Suppressions')
      expect(deleted.Suppressions[0]).toHaveProperty('EmailAddress', email)
    })

    it('rejects an empty suppression list', async () => {
      await expect(service.createSuppression(stream, []))
        .rejects.toThrow('Email Addresses must be a non-empty array')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for a missing template', async () => {
      await expect(service.getTemplate('flowrunner-missing-template'))
        .rejects.toThrow('Postmark API error')
    })
  })
})
