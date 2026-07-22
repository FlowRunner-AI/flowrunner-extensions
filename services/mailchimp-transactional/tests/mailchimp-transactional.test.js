'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-mandrill-api-key'
const BASE = 'https://mandrillapp.com/api/1.0'

describe('Mailchimp Transactional Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ mandrillApiKey: API_KEY })
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
          name: 'mandrillApiKey',
          displayName: 'Mandrill API Key',
          required: true,
        }),
      ])
    })
  })

  // ── Account Management ──

  describe('ping', () => {
    it('sends POST to users/ping.json with api key in body', async () => {
      mock.onPost(`${ BASE }/users/ping.json`).reply('PONG!')

      const result = await service.ping()

      expect(result).toBe('PONG!')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/users/ping.json`).replyWithError({ message: 'Invalid API key' })

      await expect(service.ping()).rejects.toThrow()
    })
  })

  describe('getUserInfo', () => {
    it('sends POST to users/info.json and returns user info', async () => {
      const mockResponse = {
        username: 'testuser',
        created_at: '2020-01-01 00:00:00',
        public_id: 'abc123',
        reputation: 95,
        hourly_quota: 5000,
        backlog: 0,
        stats: { today: { sent: 10 } },
      }

      mock.onPost(`${ BASE }/users/info.json`).reply(mockResponse)

      const result = await service.getUserInfo()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/users/info.json`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getUserInfo()).rejects.toThrow()
    })
  })

  // ── Email Sending ──

  describe('sendMessage', () => {
    it('sends POST with required params only and includes api key', async () => {
      const mockResponse = [{ email: 'to@example.com', status: 'sent', _id: 'msg_1' }]
      mock.onPost(`${ BASE }/messages/send.json`).reply(mockResponse)

      const result = await service.sendMessage(
        'Test Subject',
        'from@example.com',
        'From Name',
        [{ email: 'to@example.com', name: 'To Name', type: 'to' }]
      )

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      const body = JSON.parse(mock.history[0].body)
      expect(body.key).toBe(API_KEY)
      expect(body.message).toMatchObject({
        subject: 'Test Subject',
        from_email: 'from@example.com',
        from_name: 'From Name',
        to: [{ email: 'to@example.com', name: 'To Name', type: 'to' }],
      })
    })

    it('includes optional message fields when provided', async () => {
      mock.onPost(`${ BASE }/messages/send.json`).reply([])

      await service.sendMessage(
        'Subject',
        'from@example.com',
        'From',
        [{ email: 'to@example.com' }],
        '<p>HTML</p>',      // html
        'Plain text',       // text
        { 'Reply-To': 'r@example.com' }, // headers
        true,               // important
        true,               // track_opens
        false,              // track_clicks
        undefined,          // auto_text
        undefined,          // auto_html
        undefined,          // inline_css
        undefined,          // url_strip_qs
        undefined,          // preserve_recipients
        undefined,          // view_content_link
        'bcc@example.com',  // bcc_address
        undefined,          // tracking_domain
        undefined,          // signing_domain
        undefined,          // return_path_domain
        true,               // merge
        'handlebars',       // merge_language
        [{ name: 'FNAME', content: 'John' }], // global_merge_vars
        undefined,          // merge_vars
        ['welcome', 'test'] // tags
      )

      const body = JSON.parse(mock.history[0].body)
      expect(body.message).toMatchObject({
        subject: 'Subject',
        from_email: 'from@example.com',
        from_name: 'From',
        html: '<p>HTML</p>',
        text: 'Plain text',
        headers: { 'Reply-To': 'r@example.com' },
        important: true,
        track_opens: true,
        track_clicks: false,
        bcc_address: 'bcc@example.com',
        merge: true,
        merge_language: 'handlebars',
        global_merge_vars: [{ name: 'FNAME', content: 'John' }],
        tags: ['welcome', 'test'],
      })
    })

    it('omits undefined optional fields from message via clean()', async () => {
      mock.onPost(`${ BASE }/messages/send.json`).reply([])

      await service.sendMessage(
        'Subject',
        'from@example.com',
        'From',
        [{ email: 'to@example.com' }]
      )

      const body = JSON.parse(mock.history[0].body)
      expect(body.message).not.toHaveProperty('html')
      expect(body.message).not.toHaveProperty('text')
      expect(body.message).not.toHaveProperty('headers')
      expect(body.message).not.toHaveProperty('important')
      expect(body.message).not.toHaveProperty('bcc_address')
      expect(body.message).not.toHaveProperty('tags')
    })

    it('includes top-level async, ip_pool, send_at when provided', async () => {
      mock.onPost(`${ BASE }/messages/send.json`).reply([])

      await service.sendMessage(
        'Subject',
        'from@example.com',
        'From',
        [{ email: 'to@example.com' }],
        undefined, undefined, undefined, undefined, undefined, undefined, // html, text, headers, important, track_opens, track_clicks
        undefined, undefined, undefined, undefined, undefined, undefined, // auto_text, auto_html, inline_css, url_strip_qs, preserve_recipients, view_content_link
        undefined, undefined, undefined, undefined,                       // bcc_address, tracking_domain, signing_domain, return_path_domain
        undefined, undefined, undefined, undefined,                       // merge, merge_language, global_merge_vars, merge_vars
        undefined, undefined, undefined, undefined,                       // tags, subaccount, google_analytics_domains, google_analytics_campaign
        undefined, undefined, undefined, undefined,                       // metadata, recipient_metadata, attachments, images
        true,                       // async
        'dedicated-pool',           // ip_pool
        '2025-06-01 12:00:00'       // send_at
      )

      const body = JSON.parse(mock.history[0].body)
      expect(body.async).toBe(true)
      expect(body.ip_pool).toBe('dedicated-pool')
      expect(body.send_at).toBe('2025-06-01 12:00:00')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/messages/send.json`).replyWithError({ message: 'Bad Request' })

      await expect(
        service.sendMessage('Sub', 'from@x.com', 'F', [{ email: 'to@x.com' }])
      ).rejects.toThrow()
    })
  })

  describe('sendWithTemplate', () => {
    it('sends POST to messages/send-template.json with template name and content', async () => {
      const mockResponse = [{ email: 'to@example.com', status: 'sent', _id: 'msg_2' }]
      mock.onPost(`${ BASE }/messages/send-template.json`).reply(mockResponse)

      const result = await service.sendWithTemplate(
        'welcome-email',
        [{ name: 'main', content: 'Hello World' }],
        'Welcome',
        'from@example.com',
        'From Name',
        [{ email: 'to@example.com' }]
      )

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)

      const body = JSON.parse(mock.history[0].body)
      expect(body.key).toBe(API_KEY)
      expect(body.template_name).toBe('welcome-email')
      expect(body.template_content).toEqual([{ name: 'main', content: 'Hello World' }])
      expect(body.message).toMatchObject({
        subject: 'Welcome',
        from_email: 'from@example.com',
        from_name: 'From Name',
        to: [{ email: 'to@example.com' }],
      })
    })

    it('includes optional message fields and top-level params', async () => {
      mock.onPost(`${ BASE }/messages/send-template.json`).reply([])

      await service.sendWithTemplate(
        'tmpl-slug',
        [{ name: 'body', content: 'Content' }],
        'Subject',
        'from@example.com',
        'From',
        [{ email: 'to@example.com' }],
        '<p>Custom HTML</p>', // html
        'Custom text',        // text
        undefined,            // headers
        undefined,            // important
        true,                 // track_opens
        undefined,            // track_clicks
        undefined, undefined, undefined, undefined, undefined, undefined, // auto_text, auto_html, inline_css, url_strip_qs, preserve_recipients, view_content_link
        undefined, undefined, undefined, undefined,                       // bcc_address, tracking_domain, signing_domain, return_path_domain
        undefined, undefined, undefined, undefined,                       // merge, merge_language, global_merge_vars, merge_vars
        undefined, undefined, undefined, undefined,                       // tags, subaccount, google_analytics_domains, google_analytics_campaign
        undefined, undefined, undefined, undefined,                       // metadata, recipient_metadata, attachments, images
        true,                 // async
        'pool-1',             // ip_pool
        '2025-07-01 00:00:00' // send_at
      )

      const body = JSON.parse(mock.history[0].body)
      expect(body.message).toMatchObject({
        html: '<p>Custom HTML</p>',
        text: 'Custom text',
        track_opens: true,
      })
      expect(body.async).toBe(true)
      expect(body.ip_pool).toBe('pool-1')
      expect(body.send_at).toBe('2025-07-01 00:00:00')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/messages/send-template.json`).replyWithError({ message: 'Template not found' })

      await expect(
        service.sendWithTemplate('bad-tmpl', [], 'Sub', 'from@x.com', 'F', [{ email: 'to@x.com' }])
      ).rejects.toThrow()
    })
  })

  // ── Template Management ──

  describe('getTemplatesList', () => {
    it('sends POST to templates/list.json and returns templates', async () => {
      const mockResponse = [
        { slug: 'tmpl-1', name: 'Welcome', labels: ['onboarding'] },
        { slug: 'tmpl-2', name: 'Reset Password', labels: [] },
      ]

      mock.onPost(`${ BASE }/templates/list.json`).reply(mockResponse)

      const result = await service.getTemplatesList()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)

      const body = JSON.parse(mock.history[0].body)
      expect(body.key).toBe(API_KEY)
    })

    it('includes label filter when provided', async () => {
      mock.onPost(`${ BASE }/templates/list.json`).reply([])

      await service.getTemplatesList('onboarding')

      const body = JSON.parse(mock.history[0].body)
      expect(body.label).toBe('onboarding')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/templates/list.json`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getTemplatesList()).rejects.toThrow()
    })
  })

  describe('addTemplate', () => {
    it('sends POST to templates/add.json with required name', async () => {
      const mockResponse = { slug: 'new-tmpl', name: 'New Template', labels: [] }
      mock.onPost(`${ BASE }/templates/add.json`).reply(mockResponse)

      const result = await service.addTemplate('New Template')

      expect(result).toEqual(mockResponse)

      const body = JSON.parse(mock.history[0].body)
      expect(body.key).toBe(API_KEY)
      expect(body.name).toBe('New Template')
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/templates/add.json`).reply({ slug: 'tmpl' })

      await service.addTemplate(
        'My Template',
        'from@example.com',
        'From Name',
        'Default Subject',
        '<h1>Hello</h1>',
        'Hello plain text',
        true,
        ['marketing', 'promo']
      )

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({
        key: API_KEY,
        name: 'My Template',
        from_email: 'from@example.com',
        from_name: 'From Name',
        subject: 'Default Subject',
        code: '<h1>Hello</h1>',
        text: 'Hello plain text',
        publish: true,
        labels: ['marketing', 'promo'],
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/templates/add.json`).replyWithError({ message: 'Duplicate name' })

      await expect(service.addTemplate('Dup')).rejects.toThrow()
    })
  })

  // ── Analytics ──

  describe('getTagsList', () => {
    it('sends POST to tags/list.json and returns tags', async () => {
      const mockResponse = [
        { tag: 'welcome', reputation: 95, sent: 100 },
        { tag: 'promo', reputation: 80, sent: 50 },
      ]

      mock.onPost(`${ BASE }/tags/list.json`).reply(mockResponse)

      const result = await service.getTagsList()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/tags/list.json`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getTagsList()).rejects.toThrow()
    })
  })

  // ── Message Tracking ──

  describe('getMessageInfo', () => {
    it('sends POST to messages/info.json with message id', async () => {
      const mockResponse = {
        _id: 'msg_abc123',
        sender: 'from@example.com',
        subject: 'Test',
        email: 'to@example.com',
        state: 'sent',
        opens: 2,
        clicks: 1,
      }

      mock.onPost(`${ BASE }/messages/info.json`).reply(mockResponse)

      const result = await service.getMessageInfo('msg_abc123')

      expect(result).toEqual(mockResponse)

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY, id: 'msg_abc123' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/messages/info.json`).replyWithError({ message: 'Message not found' })

      await expect(service.getMessageInfo('bad_id')).rejects.toThrow()
    })
  })

  // ── Rejection Management ──

  describe('getRejectionsList', () => {
    it('sends POST to rejects/list.json with no filters', async () => {
      const mockResponse = [
        { email: 'bad@example.com', reason: 'hard-bounce', expired: false },
      ]

      mock.onPost(`${ BASE }/rejects/list.json`).reply(mockResponse)

      const result = await service.getRejectionsList()

      expect(result).toEqual(mockResponse)

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY })
    })

    it('includes filter params when provided', async () => {
      mock.onPost(`${ BASE }/rejects/list.json`).reply([])

      await service.getRejectionsList('test@example.com', true, 'sub-1')

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({
        key: API_KEY,
        email: 'test@example.com',
        include_expired: true,
        subaccount: 'sub-1',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/rejects/list.json`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getRejectionsList()).rejects.toThrow()
    })
  })

  describe('addRejection', () => {
    it('sends POST to rejects/add.json with email', async () => {
      const mockResponse = { email: 'blocked@example.com', added: true }
      mock.onPost(`${ BASE }/rejects/add.json`).reply(mockResponse)

      const result = await service.addRejection('blocked@example.com')

      expect(result).toEqual(mockResponse)

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({ key: API_KEY, email: 'blocked@example.com' })
    })

    it('includes comment and subaccount when provided', async () => {
      mock.onPost(`${ BASE }/rejects/add.json`).reply({ email: 'x@x.com', added: true })

      await service.addRejection('x@x.com', 'Spam sender', 'sub-1')

      const body = JSON.parse(mock.history[0].body)
      expect(body).toMatchObject({
        key: API_KEY,
        email: 'x@x.com',
        comment: 'Spam sender',
        subaccount: 'sub-1',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/rejects/add.json`).replyWithError({ message: 'Bad Request' })

      await expect(service.addRejection('bad')).rejects.toThrow()
    })
  })
})
