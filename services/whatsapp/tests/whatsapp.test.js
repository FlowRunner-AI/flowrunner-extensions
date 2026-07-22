'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const PHONE_NUMBER_ID = '111222333444'
const BUSINESS_ID = '999888777'
const VERIFY_TOKEN = 'test-verify-token'

const API_BASE_URL = 'https://graph.facebook.com/v21.0'
const MESSAGES_URL = `${ API_BASE_URL }/${ PHONE_NUMBER_ID }/messages`
const PROFILE_URL = `${ API_BASE_URL }/${ PHONE_NUMBER_ID }/whatsapp_business_profile`
const TEMPLATES_URL = `${ API_BASE_URL }/${ BUSINESS_ID }/message_templates`

const SEND_RESULT = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '+1234567890', wa_id: '1234567890' }],
  messages: [{ id: 'wamid.ABC123' }],
}

describe('WhatsApp Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      accessToken: ACCESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      businessId: BUSINESS_ID,
      webhookVerifyToken: VERIFY_TOKEN,
    })

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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'accessToken',
        'phoneNumberId',
        'businessId',
        'webhookVerifyToken',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accessToken', required: true, type: 'STRING' }),
          expect.objectContaining({ name: 'phoneNumberId', required: true, type: 'STRING' }),
          expect.objectContaining({ name: 'businessId', required: false, type: 'STRING' }),
          expect.objectContaining({ name: 'webhookVerifyToken', required: false, type: 'STRING' }),
        ])
      )
    })

    it('stores the configuration on the instance', () => {
      expect(service.accessToken).toBe(ACCESS_TOKEN)
      expect(service.phoneNumberId).toBe(PHONE_NUMBER_ID)
      expect(service.businessId).toBe(BUSINESS_ID)
      expect(service.webhookVerifyToken).toBe(VERIFY_TOKEN)
    })
  })

  // ── Text messages ──

  describe('sendTextMessage', () => {
    it('sends a text message with authorization headers and a normalized phone number', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      const result = await service.sendTextMessage('+1 (234) 567-890', 'Hello there')

      expect(result).toEqual(SEND_RESULT)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(MESSAGES_URL)

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'text',
        text: { body: 'Hello there', preview_url: false },
      })
    })

    it('enables URL previews when requested', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendTextMessage('1234567890', 'https://example.com', true)

      expect(mock.history[0].body.text.preview_url).toBe(true)
    })

    it('rejects a phone number shorter than 10 digits', async () => {
      await expect(service.sendTextMessage('12345', 'Hi')).rejects.toThrow(
        'Invalid phone number format. Please include country code.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('rejects empty message text', async () => {
      await expect(service.sendTextMessage('1234567890', '   ')).rejects.toThrow(
        'Message text cannot be empty'
      )
    })

    it('rejects missing message text', async () => {
      await expect(service.sendTextMessage('1234567890')).rejects.toThrow(
        'Message text cannot be empty'
      )
    })

    it('rejects message text longer than 4096 characters', async () => {
      await expect(service.sendTextMessage('1234567890', 'a'.repeat(4097))).rejects.toThrow(
        'Message text cannot exceed 4096 characters'
      )
    })

    it('wraps API failures in a WhatsApp API error', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'Invalid OAuth access token' })

      await expect(service.sendTextMessage('1234567890', 'Hi')).rejects.toThrow(
        'WhatsApp API request failed: Invalid OAuth access token'
      )
    })
  })

  // ── Image messages ──

  describe('sendImageMessage', () => {
    it('sends an image message without a caption', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      const result = await service.sendImageMessage('1234567890', 'https://example.com/pic.png')

      expect(result).toEqual(SEND_RESULT)

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'image',
        image: { link: 'https://example.com/pic.png' },
      })
    })

    it('includes the caption when provided', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendImageMessage('1234567890', 'https://example.com/pic.png', 'Look at this')

      expect(mock.history[0].body.image).toEqual({
        link: 'https://example.com/pic.png',
        caption: 'Look at this',
      })
    })

    it('omits a blank caption', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendImageMessage('1234567890', 'https://example.com/pic.png', '   ')

      expect(mock.history[0].body.image).not.toHaveProperty('caption')
    })

    it('rejects an invalid image URL', async () => {
      await expect(service.sendImageMessage('1234567890', 'not-a-url')).rejects.toThrow(
        'Invalid URL format'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('rejects a caption longer than 1024 characters', async () => {
      await expect(
        service.sendImageMessage('1234567890', 'https://example.com/pic.png', 'a'.repeat(1025))
      ).rejects.toThrow('Caption cannot exceed 1024 characters')
    })

    it('wraps API failures', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'Media download failed' })

      await expect(
        service.sendImageMessage('1234567890', 'https://example.com/pic.png')
      ).rejects.toThrow('WhatsApp API request failed: Media download failed')
    })
  })

  // ── Documents ──

  describe('sendDocument', () => {
    it('sends a document with only the link', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      const result = await service.sendDocument('1234567890', 'https://example.com/report.pdf')

      expect(result).toEqual(SEND_RESULT)

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'document',
        document: { link: 'https://example.com/report.pdf' },
      })
    })

    it('includes the filename and caption when provided', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendDocument(
        '1234567890',
        'https://example.com/report.pdf',
        'report.pdf',
        'Q1 report'
      )

      expect(mock.history[0].body.document).toEqual({
        link: 'https://example.com/report.pdf',
        filename: 'report.pdf',
        caption: 'Q1 report',
      })
    })

    it('omits blank filename and caption values', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendDocument('1234567890', 'https://example.com/report.pdf', '  ', '  ')

      expect(mock.history[0].body.document).toEqual({ link: 'https://example.com/report.pdf' })
    })

    it('rejects an invalid document URL', async () => {
      await expect(service.sendDocument('1234567890', 'ht!tp:/bad')).rejects.toThrow(
        'Invalid URL format'
      )
    })

    it('rejects a caption longer than 1024 characters', async () => {
      await expect(
        service.sendDocument('1234567890', 'https://example.com/a.pdf', 'a.pdf', 'a'.repeat(1025))
      ).rejects.toThrow('Caption cannot exceed 1024 characters')
    })

    it('wraps API failures', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'File too large' })

      await expect(
        service.sendDocument('1234567890', 'https://example.com/a.pdf')
      ).rejects.toThrow('WhatsApp API request failed: File too large')
    })
  })

  // ── Templates ──

  describe('sendTemplateMessage', () => {
    it('sends a template message without variables', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      const result = await service.sendTemplateMessage('1234567890', 'welcome_message', 'en_US')

      expect(result).toEqual(SEND_RESULT)

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'template',
        template: {
          name: 'welcome_message',
          language: { code: 'en_US' },
        },
      })
    })

    it('maps template variables into a body component', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendTemplateMessage('1234567890', 'order_confirmation', 'en', ['Ada', 42])

      expect(mock.history[0].body.template.components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ada' },
            { type: 'text', text: '42' },
          ],
        },
      ])
    })

    it('omits components for an empty variable array', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendTemplateMessage('1234567890', 'welcome_message', 'en', [])

      expect(mock.history[0].body.template).not.toHaveProperty('components')
    })

    it('requires a template name', async () => {
      await expect(service.sendTemplateMessage('1234567890', '  ', 'en')).rejects.toThrow(
        'Template name is required'
      )
    })

    it('requires a language code', async () => {
      await expect(
        service.sendTemplateMessage('1234567890', 'welcome_message', '  ')
      ).rejects.toThrow('Language code is required')
    })

    it('wraps API failures', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'Template not found' })

      await expect(
        service.sendTemplateMessage('1234567890', 'missing', 'en')
      ).rejects.toThrow('WhatsApp API request failed: Template not found')
    })
  })

  // ── Location ──

  describe('sendLocation', () => {
    it('sends coordinates only', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      const result = await service.sendLocation('1234567890', 37.4224, -122.0841)

      expect(result).toEqual(SEND_RESULT)

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        to: '1234567890',
        type: 'location',
        location: { latitude: 37.4224, longitude: -122.0841 },
      })
    })

    it('includes the name and address when provided', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendLocation('1234567890', 1, 2, 'Office', '1 Main St')

      expect(mock.history[0].body.location).toEqual({
        latitude: 1,
        longitude: 2,
        name: 'Office',
        address: '1 Main St',
      })
    })

    it('omits blank name and address values', async () => {
      mock.onPost(MESSAGES_URL).reply(SEND_RESULT)

      await service.sendLocation('1234567890', 1, 2, '  ', '  ')

      expect(mock.history[0].body.location).toEqual({ latitude: 1, longitude: 2 })
    })

    it('rejects a non-numeric latitude', async () => {
      await expect(service.sendLocation('1234567890', '37.4', 2)).rejects.toThrow(
        'Latitude must be a number between -90 and 90'
      )
    })

    it('rejects an out-of-range latitude', async () => {
      await expect(service.sendLocation('1234567890', 91, 2)).rejects.toThrow(
        'Latitude must be a number between -90 and 90'
      )
    })

    it('rejects an out-of-range longitude', async () => {
      await expect(service.sendLocation('1234567890', 10, 181)).rejects.toThrow(
        'Longitude must be a number between -180 and 180'
      )
    })

    it('wraps API failures', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'Recipient unavailable' })

      await expect(service.sendLocation('1234567890', 1, 2)).rejects.toThrow(
        'WhatsApp API request failed: Recipient unavailable'
      )
    })
  })

  // ── Read receipts ──

  describe('markMessageAsRead', () => {
    it('sends a read status update', async () => {
      mock.onPost(MESSAGES_URL).reply({ success: true })

      const result = await service.markMessageAsRead('wamid.ABC123')

      expect(result).toEqual({ success: true })

      expect(mock.history[0].body).toEqual({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.ABC123',
      })
    })

    it('requires a message id', async () => {
      await expect(service.markMessageAsRead('  ')).rejects.toThrow('Message ID is required')
      await expect(service.markMessageAsRead()).rejects.toThrow('Message ID is required')

      expect(mock.history).toHaveLength(0)
    })

    it('wraps API failures', async () => {
      mock.onPost(MESSAGES_URL).replyWithError({ message: 'Message not found' })

      await expect(service.markMessageAsRead('wamid.MISSING')).rejects.toThrow(
        'WhatsApp API request failed: Message not found'
      )
    })
  })

  // ── Business profile ──

  describe('getBusinessProfile', () => {
    it('requests the profile with the expected field list', async () => {
      const profile = { data: [{ about: 'Business description' }] }

      mock.onGet(PROFILE_URL).reply(profile)

      const result = await service.getBusinessProfile()

      expect(result).toEqual(profile)
      expect(mock.history[0].method).toBe('get')

      expect(mock.history[0].query).toEqual({
        fields: 'about,address,description,email,profile_picture_url,websites,vertical',
      })
    })

    it('wraps API failures', async () => {
      mock.onGet(PROFILE_URL).replyWithError({ message: 'Permission denied' })

      await expect(service.getBusinessProfile()).rejects.toThrow(
        'WhatsApp API request failed: Permission denied'
      )
    })
  })

  // ── Dictionaries ──

  describe('getTemplatesDictionary', () => {
    it('returns only approved templates with humanized labels', async () => {
      mock.onGet(TEMPLATES_URL).reply({
        data: [
          { name: 'welcome_message', status: 'APPROVED' },
          { name: 'order_confirmation', status: 'APPROVED' },
          { name: 'pending_template', status: 'PENDING' },
        ],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Welcome Message', value: 'welcome_message', note: 'Status: APPROVED' },
          { label: 'Order Confirmation', value: 'order_confirmation', note: 'Status: APPROVED' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ fields: 'name,status,language', limit: 100 })
    })

    it('handles a null payload', async () => {
      mock.onGet(TEMPLATES_URL).reply({ data: [{ name: 'welcome_message', status: 'APPROVED' }] })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('filters templates by a case-insensitive search term', async () => {
      mock.onGet(TEMPLATES_URL).reply({
        data: [
          { name: 'welcome_message', status: 'APPROVED' },
          { name: 'order_confirmation', status: 'APPROVED' },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: 'ORDER' })

      expect(result.items).toEqual([
        { label: 'Order Confirmation', value: 'order_confirmation', note: 'Status: APPROVED' },
      ])
    })

    it('ignores a blank search term', async () => {
      mock.onGet(TEMPLATES_URL).reply({
        data: [
          { name: 'welcome_message', status: 'APPROVED' },
          { name: 'order_confirmation', status: 'APPROVED' },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: '   ' })

      expect(result.items).toHaveLength(2)
    })

    it('handles a response without a data array', async () => {
      mock.onGet(TEMPLATES_URL).reply({})

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns an empty list instead of throwing on API failure', async () => {
      mock.onGet(TEMPLATES_URL).replyWithError({ message: 'Rate limited' })

      const result = await service.getTemplatesDictionary({ search: 'a' })

      expect(result).toEqual({ items: [], cursor: null })
    })

  })
})

describe('WhatsApp Service without a business id', () => {
  let sandbox
  let service

  beforeAll(() => {
    jest.resetModules()

    sandbox = createSandbox({
      accessToken: ACCESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('returns an empty templates dictionary without calling the API', async () => {
    const result = await service.getTemplatesDictionary({})

    expect(result).toEqual({ items: [], cursor: null })
    expect(sandbox.getRequestMock().history).toHaveLength(0)
  })
})
