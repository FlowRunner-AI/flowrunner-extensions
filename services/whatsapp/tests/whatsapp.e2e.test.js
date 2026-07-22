'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('WhatsApp Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('whatsapp')
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

  // ── Business profile ──

  describe('getBusinessProfile', () => {
    it('returns the business profile of the configured phone number', async () => {
      const result = await service.getBusinessProfile()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Templates dictionary ──

  describe('getTemplatesDictionary', () => {
    it('returns a dictionary shape', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('accepts a search term', async () => {
      const result = await service.getTemplatesDictionary({ search: 'zzz-no-such-template' })

      expect(result.items).toEqual([])
    })
  })

  // ── Messaging ──

  describe('sendTextMessage', () => {
    it('sends a text message to the test recipient', async () => {
      const { recipientPhone } = testValues

      if (!recipientPhone) {
        console.log('Skipping sendTextMessage: testValues.recipientPhone not set')

        return
      }

      const result = await service.sendTextMessage(
        recipientPhone,
        `FlowRunner e2e text message ${ Date.now() }`
      )

      expect(result).toHaveProperty('messaging_product', 'whatsapp')
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.messages[0]).toHaveProperty('id')
    })

    it('rejects an invalid phone number', async () => {
      await expect(service.sendTextMessage('123', 'Hello')).rejects.toThrow(
        'Invalid phone number format. Please include country code.'
      )
    })

    it('rejects empty message text', async () => {
      const { recipientPhone } = testValues

      if (!recipientPhone) {
        console.log('Skipping empty text validation: testValues.recipientPhone not set')

        return
      }

      await expect(service.sendTextMessage(recipientPhone, '')).rejects.toThrow(
        'Message text cannot be empty'
      )
    })
  })

  describe('sendImageMessage', () => {
    it('sends an image message to the test recipient', async () => {
      const { recipientPhone, imageUrl } = testValues

      if (!recipientPhone || !imageUrl) {
        console.log('Skipping sendImageMessage: testValues.recipientPhone or testValues.imageUrl not set')

        return
      }

      const result = await service.sendImageMessage(recipientPhone, imageUrl, 'FlowRunner e2e image')

      expect(result).toHaveProperty('messaging_product', 'whatsapp')
      expect(result.messages[0]).toHaveProperty('id')
    })

    it('rejects an invalid image URL', async () => {
      const { recipientPhone } = testValues

      if (!recipientPhone) {
        console.log('Skipping invalid image URL validation: testValues.recipientPhone not set')

        return
      }

      await expect(service.sendImageMessage(recipientPhone, 'not-a-url')).rejects.toThrow(
        'Invalid URL format'
      )
    })
  })

  describe('sendDocument', () => {
    it('sends a document to the test recipient', async () => {
      const { recipientPhone, documentUrl } = testValues

      if (!recipientPhone || !documentUrl) {
        console.log('Skipping sendDocument: testValues.recipientPhone or testValues.documentUrl not set')

        return
      }

      const result = await service.sendDocument(
        recipientPhone,
        documentUrl,
        'flowrunner-e2e.pdf',
        'FlowRunner e2e document'
      )

      expect(result).toHaveProperty('messaging_product', 'whatsapp')
      expect(result.messages[0]).toHaveProperty('id')
    })
  })

  describe('sendLocation', () => {
    it('sends a location to the test recipient', async () => {
      const { recipientPhone } = testValues

      if (!recipientPhone) {
        console.log('Skipping sendLocation: testValues.recipientPhone not set')

        return
      }

      const result = await service.sendLocation(
        recipientPhone,
        37.4224,
        -122.0841,
        'Googleplex',
        '1600 Amphitheatre Parkway'
      )

      expect(result).toHaveProperty('messaging_product', 'whatsapp')
      expect(result.messages[0]).toHaveProperty('id')
    })

    it('rejects out-of-range coordinates', async () => {
      const { recipientPhone } = testValues

      if (!recipientPhone) {
        console.log('Skipping coordinate validation: testValues.recipientPhone not set')

        return
      }

      await expect(service.sendLocation(recipientPhone, 120, 0)).rejects.toThrow(
        'Latitude must be a number between -90 and 90'
      )
    })
  })

  describe('sendTemplateMessage', () => {
    it('sends an approved template to the test recipient', async () => {
      const { recipientPhone, templateName, templateLanguage } = testValues

      if (!recipientPhone || !templateName) {
        console.log('Skipping sendTemplateMessage: testValues.recipientPhone or testValues.templateName not set')

        return
      }

      const result = await service.sendTemplateMessage(
        recipientPhone,
        templateName,
        templateLanguage || 'en_US'
      )

      expect(result).toHaveProperty('messaging_product', 'whatsapp')
      expect(result.messages[0]).toHaveProperty('id')
    })
  })

  describe('markMessageAsRead', () => {
    it('marks a received message as read', async () => {
      const { inboundMessageId } = testValues

      if (!inboundMessageId) {
        console.log('Skipping markMessageAsRead: testValues.inboundMessageId not set')

        return
      }

      const result = await service.markMessageAsRead(inboundMessageId)

      expect(result).toHaveProperty('success')
    })

    it('requires a message id', async () => {
      await expect(service.markMessageAsRead('')).rejects.toThrow('Message ID is required')
    })
  })
})
