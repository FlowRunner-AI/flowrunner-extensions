'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const FROM_EMAIL = 'default@example.com'
const FROM_NAME = 'Default Sender'

describe('MailerSend Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, fromEmail: FROM_EMAIL, fromName: FROM_NAME })
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

  // ── Helper to mock SDK methods ──

  function mockSdk(path, mockFn) {
    const parts = path.split('.')
    let target = service.mailerSend

    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]]
    }

    return jest.spyOn(target, parts[parts.length - 1]).mockImplementation(mockFn)
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true }),
          expect.objectContaining({ name: 'fromEmail', required: false }),
          expect.objectContaining({ name: 'fromName', required: false }),
        ])
      )
    })
  })

  // ── Dictionary Methods ──

  describe('getSendersDictionary', () => {
    it('maps senders to dictionary items', async () => {
      mockSdk('email.identity.list', () =>
        Promise.resolve({
          body: {
            data: [
              { id: 'id1', name: 'Alice', email: 'alice@example.com' },
              { id: 'id2', name: 'Bob', email: 'bob@example.com' },
            ],
          },
        })
      )

      const result = await service.getSendersDictionary({})

      expect(result.items).toEqual([
        { label: 'Alice (alice@example.com)', note: 'ID: id1', value: 'id1' },
        { label: 'Bob (bob@example.com)', note: 'ID: id2', value: 'id2' },
      ])
    })

    it('filters senders by search term', async () => {
      mockSdk('email.identity.list', () =>
        Promise.resolve({
          body: {
            data: [
              { id: 'id1', name: 'Alice', email: 'alice@example.com' },
              { id: 'id2', name: 'Bob', email: 'bob@example.com' },
            ],
          },
        })
      )

      const result = await service.getSendersDictionary({ search: 'bob' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('id2')
    })

    it('returns all senders when search is empty', async () => {
      mockSdk('email.identity.list', () =>
        Promise.resolve({
          body: {
            data: [{ id: 'id1', name: 'Alice', email: 'alice@example.com' }],
          },
        })
      )

      const result = await service.getSendersDictionary({ search: '' })

      expect(result.items).toHaveLength(1)
    })

    it('throws unauthenticated error on 401', async () => {
      mockSdk('email.identity.list', () => {
        const err = new Error('Unauthorized')

        err.statusCode = 401
        err.body = { message: 'Unauthenticated.' }

        return Promise.reject(err)
      })

      await expect(service.getSendersDictionary({})).rejects.toThrow(
        'Please check the API key, the server is rejecting the one you provided.'
      )
    })

    it('throws API error message on non-401 errors', async () => {
      mockSdk('email.identity.list', () => {
        const err = new Error('Server Error')

        err.statusCode = 500
        err.body = { message: 'Internal server error' }

        return Promise.reject(err)
      })

      await expect(service.getSendersDictionary({})).rejects.toThrow('Internal server error')
    })
  })

  describe('getTemplatesDictionary', () => {
    it('maps templates to dictionary items', async () => {
      mockSdk('email.template.list', () =>
        Promise.resolve({
          body: {
            data: [
              { id: 'tpl1', name: 'Welcome Email' },
              { id: 'tpl2', name: 'Reset Password' },
            ],
          },
        })
      )

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome Email', note: 'ID: tpl1', value: 'tpl1' },
        { label: 'Reset Password', note: 'ID: tpl2', value: 'tpl2' },
      ])
    })

    it('shows [empty] label for templates without a name', async () => {
      mockSdk('email.template.list', () =>
        Promise.resolve({
          body: {
            data: [{ id: 'tpl1', name: '' }],
          },
        })
      )

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].label).toBe('[empty]')
    })

    it('filters templates by search term', async () => {
      mockSdk('email.template.list', () =>
        Promise.resolve({
          body: {
            data: [
              { id: 'tpl1', name: 'Welcome Email' },
              { id: 'tpl2', name: 'Reset Password' },
            ],
          },
        })
      )

      const result = await service.getTemplatesDictionary({ search: 'reset' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tpl2')
    })

    it('throws unauthenticated error on 401', async () => {
      mockSdk('email.template.list', () => {
        const err = new Error('Unauthorized')

        err.statusCode = 401
        err.body = { message: 'Unauthenticated.' }

        return Promise.reject(err)
      })

      await expect(service.getTemplatesDictionary({})).rejects.toThrow(
        'Please check the API key, the server is rejecting the one you provided.'
      )
    })
  })

  // ── Send Email ──

  describe('sendEmail', () => {
    it('sends email with default sender (no senderId)', async () => {
      const sendResponse = { statusCode: 202, headers: {}, body: '' }

      mockSdk('email.send', params => {
        expect(params.from).toEqual({ email: FROM_EMAIL, name: FROM_NAME })
        expect(params.to).toEqual([{ email: 'to@example.com', name: null }])
        expect(params.subject).toBe('Hello')

        return Promise.resolve(sendResponse)
      })

      const result = await service.sendEmail(
        undefined, undefined, 'to@example.com', 'Hello', '<p>Hi</p>', 'Hi'
      )

      expect(result).toEqual(sendResponse)
    })

    it('sends email with sender identity when senderId is provided', async () => {
      mockSdk('email.identity.single', id => {
        expect(id).toBe('sender-id-1')

        return Promise.resolve({
          body: { data: { email: 'sender@example.com', name: 'Custom Sender' } },
        })
      })

      const sendResponse = { statusCode: 202, headers: {}, body: '' }

      mockSdk('email.send', params => {
        expect(params.from).toEqual({ email: 'sender@example.com', name: 'Custom Sender' })

        return Promise.resolve(sendResponse)
      })

      const result = await service.sendEmail(
        'sender-id-1', undefined, 'to@example.com', 'Hello'
      )

      expect(result).toEqual(sendResponse)
    })

    it('sends email with toName when provided', async () => {
      mockSdk('email.send', params => {
        expect(params.to).toEqual([{ email: 'to@example.com', name: 'John Doe' }])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmail(undefined, 'John Doe', 'to@example.com', 'Hello')
    })

    it('sends email with html and text content', async () => {
      mockSdk('email.send', params => {
        expect(params.html).toBe('<p>Hello</p>')
        expect(params.text).toBe('Hello')

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmail(
        undefined, undefined, 'to@example.com', 'Subject', '<p>Hello</p>', 'Hello'
      )
    })

    it('sends email with attachments by fetching base64 content', async () => {
      mock.onGet('https://example.com/file.pdf').reply('base64encodedcontent')

      mockSdk('email.send', params => {
        expect(params.attachments).toHaveLength(1)

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmail(
        undefined, undefined, 'to@example.com', 'Subject',
        '<p>Hi</p>', undefined, ['https://example.com/file.pdf']
      )

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBe('base64')
    })

    it('throws error when attachment URL fails', async () => {
      mock.onGet('https://example.com/file.pdf').replyWithError({ message: 'Not found' })

      await expect(
        service.sendEmail(
          undefined, undefined, 'to@example.com', 'Subject',
          '<p>Hi</p>', undefined, ['https://example.com/file.pdf']
        )
      ).rejects.toThrow('Failed to get the file from https://example.com/file.pdf')
    })

    it('throws wrapped error on SDK send failure', async () => {
      const error = {
        body: {
          message: 'Validation Error',
          errors: { to: ['The to field is required.'] },
        },
      }

      mockSdk('email.send', () => Promise.reject(error))

      await expect(
        service.sendEmail(undefined, undefined, 'to@example.com', 'Hello')
      ).rejects.toThrow('MailerSend API error: Validation Error')
    })

    it('throws wrapped error with multiple error details', async () => {
      const error = {
        body: {
          message: 'Validation Error',
          errors: {
            to: ['The to field is required.'],
            subject: ['The subject field is required.'],
          },
        },
      }

      mockSdk('email.send', () => Promise.reject(error))

      await expect(
        service.sendEmail(undefined, undefined, 'to@example.com', 'Hello')
      ).rejects.toThrow('MailerSend API error: Validation Error:')
    })
  })

  // ── Send Email with CC/BCC ──

  describe('sendEmailWithCcAndBcc', () => {
    it('sends email with required params only', async () => {
      const sendResponse = { statusCode: 202 }

      mockSdk('email.send', params => {
        expect(params.to).toEqual([{ email: 'to@example.com' }])
        expect(params.subject).toBe('Hello')
        expect(params.cc).toBeUndefined()
        expect(params.bcc).toBeUndefined()

        return Promise.resolve(sendResponse)
      })

      const result = await service.sendEmailWithCcAndBcc(
        undefined, ['to@example.com'], undefined, undefined, 'Hello'
      )

      expect(result).toEqual(sendResponse)
    })

    it('includes CC recipients', async () => {
      mockSdk('email.send', params => {
        expect(params.cc).toEqual([{ email: 'cc@example.com' }])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        undefined, ['to@example.com'], ['cc@example.com'], undefined, 'Hello'
      )
    })

    it('includes BCC recipients', async () => {
      mockSdk('email.send', params => {
        expect(params.bcc).toEqual([{ email: 'bcc@example.com' }])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        undefined, ['to@example.com'], undefined, ['bcc@example.com'], 'Hello'
      )
    })

    it('parses string recipients into objects', async () => {
      mockSdk('email.send', params => {
        expect(params.to).toEqual([{ email: 'to@example.com' }])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        undefined, 'to@example.com', undefined, undefined, 'Hello'
      )
    })

    it('passes object recipients as-is', async () => {
      mockSdk('email.send', params => {
        expect(params.to).toEqual([{ email: 'to@example.com', name: 'John' }])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        undefined, [{ email: 'to@example.com', name: 'John' }], undefined, undefined, 'Hello'
      )
    })

    it('sends with attachments', async () => {
      mock.onGet('https://example.com/doc.pdf').reply('base64data')

      mockSdk('email.send', params => {
        expect(params.attachments).toHaveLength(1)

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        undefined, ['to@example.com'], undefined, undefined, 'Hello',
        '<p>body</p>', undefined, ['https://example.com/doc.pdf']
      )
    })

    it('uses sender identity when senderId is provided', async () => {
      mockSdk('email.identity.single', () =>
        Promise.resolve({
          body: { data: { email: 'custom@example.com', name: 'Custom' } },
        })
      )

      mockSdk('email.send', params => {
        expect(params.from).toEqual({ email: 'custom@example.com', name: 'Custom' })

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithCcAndBcc(
        'sender-id', ['to@example.com'], undefined, undefined, 'Hello'
      )
    })

    it('throws wrapped error on SDK failure', async () => {
      mockSdk('email.send', () =>
        Promise.reject({
          body: { message: 'Bad Request', errors: { to: ['Invalid'] } },
        })
      )

      await expect(
        service.sendEmailWithCcAndBcc(undefined, ['to@example.com'], undefined, undefined, 'Hello')
      ).rejects.toThrow('MailerSend API error: Bad Request')
    })
  })

  // ── Send Email with Template ──

  describe('sendEmailWithTemplate', () => {
    it('sends email with template and required params', async () => {
      const sendResponse = { statusCode: 202 }

      mockSdk('email.send', params => {
        expect(params.template_id).toBe('tpl-123')
        expect(params.subject).toBe('Hello')
        expect(params.to).toEqual([{ email: 'to@example.com' }])
        expect(params.settings).toEqual({
          track_clicks: false,
          track_opens: false,
          track_content: false,
        })

        return Promise.resolve(sendResponse)
      })

      const result = await service.sendEmailWithTemplate(
        undefined, ['to@example.com'], 'tpl-123', 'Hello'
      )

      expect(result).toEqual(sendResponse)
    })

    it('includes personalization as array', async () => {
      mockSdk('email.send', params => {
        expect(params.personalization).toEqual([
          { email: 'to@example.com', data: { name: 'John' } },
        ])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithTemplate(
        undefined, ['to@example.com'], 'tpl-123', 'Hello',
        [{ email: 'to@example.com', data: { name: 'John' } }]
      )
    })

    it('wraps single personalization object into array', async () => {
      mockSdk('email.send', params => {
        expect(params.personalization).toEqual([
          { email: 'to@example.com', data: { name: 'Jane' } },
        ])

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithTemplate(
        undefined, ['to@example.com'], 'tpl-123', 'Hello',
        { email: 'to@example.com', data: { name: 'Jane' } }
      )
    })

    it('sets tracking options when provided', async () => {
      mockSdk('email.send', params => {
        expect(params.settings).toEqual({
          track_clicks: true,
          track_opens: true,
          track_content: true,
        })

        return Promise.resolve({ statusCode: 202 })
      })

      await service.sendEmailWithTemplate(
        undefined, ['to@example.com'], 'tpl-123', 'Hello',
        undefined, true, true, true
      )
    })

    it('throws wrapped error on SDK failure', async () => {
      mockSdk('email.send', () =>
        Promise.reject({
          body: { message: 'Template not found', errors: { template_id: ['Invalid'] } },
        })
      )

      await expect(
        service.sendEmailWithTemplate(undefined, ['to@example.com'], 'tpl-123', 'Hello')
      ).rejects.toThrow('MailerSend API error: Template not found')
    })
  })

  // ── Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a webhook with mapped events', async () => {
      mockSdk('email.domain.list', () =>
        Promise.resolve({
          body: { data: [{ id: 'domain-1', name: 'example.com' }] },
        })
      )

      mockSdk('email.webhook.create', () =>
        Promise.resolve({
          body: { data: { id: 'webhook-1', url: 'https://callback.example.com' } },
        })
      )

      const invocation = {
        events: [{ name: 'onEmailSent' }, { name: 'onEmailDelivered' }],
        callbackUrl: 'https://callback.example.com',
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(result).toEqual({
        webhookData: { id: 'webhook-1', url: 'https://callback.example.com' },
        eventScopeId: 'domain-1',
      })
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves a known event type to shaped events', async () => {
      const invocation = {
        body: {
          type: 'activity.sent',
          domain_id: 'domain-1',
          data: { message_id: 'msg-1' },
        },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result).toEqual({
        eventScopeId: 'domain-1',
        events: [{ name: 'onEmailSent', data: { message_id: 'msg-1' } }],
      })
    })

    it('returns null for unknown event type', async () => {
      const invocation = {
        body: { type: 'unknown.event', domain_id: 'domain-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result).toBeNull()
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('activates all triggers for unfiltered events (onEmailSent)', async () => {
      const invocation = {
        eventName: 'onEmailSent',
        triggers: [{ id: 't1' }, { id: 't2' }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1', 't2'] })
    })

    it('filters triggers by recipientEmail for onEmailOpened', async () => {
      const invocation = {
        eventName: 'onEmailOpened',
        triggers: [
          { id: 't1', data: { recipientEmail: 'alice@example.com' } },
          { id: 't2', data: { recipientEmail: 'bob@example.com' } },
        ],
        eventData: {
          email: { recipient: { email: 'alice@example.com' } },
        },
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes the webhook and returns empty object', async () => {
      mockSdk('email.webhook.delete', id => {
        expect(id).toBe('webhook-1')

        return Promise.resolve()
      })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { id: 'webhook-1' },
      })

      expect(result).toEqual({})
    })
  })

  // ── Trigger Event Methods ──

  describe('trigger event methods - SHAPE_EVENT', () => {
    const eventMethods = [
      'onEmailSent',
      'onEmailDelivered',
      'onEmailSoftBounced',
      'onEmailNotDelivered',
      'onEmailOpened',
      'onEmailOpenedFirst',
      'onLinkClicked',
      'onLinkClickedFirst',
      'onRecipientUnsubscribed',
      'onSpamComplaint',
    ]

    it.each(eventMethods)('%s shapes event correctly', methodName => {
      const payload = { data: { message_id: 'msg-1', email: 'test@example.com' } }
      const result = service[methodName]('SHAPE_EVENT', payload)

      expect(result).toEqual([{ name: methodName, data: payload.data }])
    })
  })

  describe('trigger event methods - FILTER_TRIGGER (no recipient filter)', () => {
    const unfilteredMethods = [
      'onEmailSent',
      'onEmailDelivered',
      'onEmailSoftBounced',
      'onEmailNotDelivered',
    ]

    it.each(unfilteredMethods)('%s activates all triggers', methodName => {
      const payload = {
        triggers: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      }

      const result = service[methodName]('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't2', 't3'] })
    })
  })

  describe('trigger event methods - FILTER_TRIGGER (recipient filter)', () => {
    const filteredMethods = [
      'onEmailOpened',
      'onEmailOpenedFirst',
      'onLinkClicked',
      'onLinkClickedFirst',
      'onRecipientUnsubscribed',
      'onSpamComplaint',
    ]

    it.each(filteredMethods)('%s filters triggers by recipientEmail', methodName => {
      const payload = {
        triggers: [
          { id: 't1', data: { recipientEmail: 'match@example.com' } },
          { id: 't2', data: { recipientEmail: 'other@example.com' } },
          { id: 't3', data: { recipientEmail: 'match@example.com' } },
        ],
        eventData: {
          email: { recipient: { email: 'match@example.com' } },
        },
      }

      const result = service[methodName]('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it.each(filteredMethods)('%s returns empty array when no triggers match', methodName => {
      const payload = {
        triggers: [
          { id: 't1', data: { recipientEmail: 'other@example.com' } },
        ],
        eventData: {
          email: { recipient: { email: 'match@example.com' } },
        },
      }

      const result = service[methodName]('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })
})
