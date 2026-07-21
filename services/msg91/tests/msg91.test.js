'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_KEY = 'test-auth-key-123'
const BASE = 'https://control.msg91.com/api/v5'

describe('MSG91 Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ authKey: AUTH_KEY })
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
          name: 'authKey',
          displayName: 'Auth Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the authkey header on requests', async () => {
      mock.onGet(`${BASE}/otp/verify`).reply({ type: 'success', message: 'OTP verified success' })

      await service.verifyOtp('919812345678', '1234')

      expect(mock.history[0].headers).toMatchObject({
        authkey: AUTH_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      })
    })
  })

  // ── Send SMS ──

  describe('sendSms', () => {
    const url = `${BASE}/flow/`

    it('sends correct POST with required params', async () => {
      mock.onPost(url).reply({ type: 'success', message: '3456abcd1234ef567890' })

      const recipients = [{ mobiles: '919812345678', name: 'Alex', otp: '1234' }]
      const result = await service.sendSms('tpl-123', recipients)

      expect(result).toEqual({ type: 'success', message: '3456abcd1234ef567890' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        template_id: 'tpl-123',
        flow_id: 'tpl-123',
        recipients: [{ mobiles: '919812345678', name: 'Alex', otp: '1234' }],
      })
    })

    it('wraps a single recipient object into an array', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      const singleRecipient = { mobiles: '919812345678' }
      await service.sendSms('tpl-123', singleRecipient)

      expect(mock.history[0].body.recipients).toEqual([{ mobiles: '919812345678' }])
    })

    it('includes optional sender and shortUrl when provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendSms('tpl-123', [{ mobiles: '919812345678' }], 'MYSNDR', true)

      expect(mock.history[0].body).toMatchObject({
        template_id: 'tpl-123',
        flow_id: 'tpl-123',
        sender: 'MYSNDR',
        short_url: '1',
        recipients: [{ mobiles: '919812345678' }],
      })
    })

    it('omits sender and short_url when not provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendSms('tpl-123', [{ mobiles: '919812345678' }])

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('sender')
      expect(body).not.toHaveProperty('short_url')
    })

    it('omits short_url when shortUrl is false', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendSms('tpl-123', [{ mobiles: '919812345678' }], undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('short_url')
    })

    it('throws on API error response', async () => {
      mock.onPost(url).reply({ type: 'error', message: 'Invalid template' })

      await expect(service.sendSms('bad-tpl', [{ mobiles: '919812345678' }]))
        .rejects.toThrow('MSG91 API error: Invalid template')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(url).replyWithError({ message: 'Unauthorized', body: { message: 'Invalid auth key' } })

      await expect(service.sendSms('tpl-123', [{ mobiles: '919812345678' }]))
        .rejects.toThrow('MSG91 API error:')
    })
  })

  // ── Send OTP ──

  describe('sendOtp', () => {
    const url = `${BASE}/otp`

    it('sends correct POST with required params only', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'req-id-123' })

      const result = await service.sendOtp('919812345678', 'otp-tpl-1')

      expect(result).toEqual({ type: 'success', message: 'req-id-123' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({
        template_id: 'otp-tpl-1',
        mobile: '919812345678',
      })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendOtp('919812345678', 'otp-tpl-1', '9999', 4, 10, 'MYSNDR')

      expect(mock.history[0].query).toMatchObject({
        template_id: 'otp-tpl-1',
        mobile: '919812345678',
        otp: '9999',
        otp_length: 4,
        otp_expiry: 10,
        sender: 'MYSNDR',
      })
    })

    it('omits optional params when not provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendOtp('919812345678', 'otp-tpl-1')

      const query = mock.history[0].query

      expect(query).not.toHaveProperty('otp')
      expect(query).not.toHaveProperty('otp_length')
      expect(query).not.toHaveProperty('otp_expiry')
      expect(query).not.toHaveProperty('sender')
    })

    it('throws on API error response', async () => {
      mock.onPost(url).reply({ type: 'error', message: 'Invalid mobile' })

      await expect(service.sendOtp('invalid', 'otp-tpl-1'))
        .rejects.toThrow('MSG91 API error: Invalid mobile')
    })
  })

  // ── Verify OTP ──

  describe('verifyOtp', () => {
    const url = `${BASE}/otp/verify`

    it('sends correct GET with required params', async () => {
      mock.onGet(url).reply({ type: 'success', message: 'OTP verified success' })

      const result = await service.verifyOtp('919812345678', '1234')

      expect(result).toEqual({ type: 'success', message: 'OTP verified success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        mobile: '919812345678',
        otp: '1234',
      })
    })

    it('throws on verification failure', async () => {
      mock.onGet(url).reply({ type: 'error', message: 'OTP not matched' })

      await expect(service.verifyOtp('919812345678', '0000'))
        .rejects.toThrow('MSG91 API error: OTP not matched')
    })
  })

  // ── Resend OTP ──

  describe('resendOtp', () => {
    const url = `${BASE}/otp/retry`

    it('sends correct GET with default retry type (text)', async () => {
      mock.onGet(url).reply({ type: 'success', message: 'OTP sent successfully' })

      const result = await service.resendOtp('919812345678')

      expect(result).toEqual({ type: 'success', message: 'OTP sent successfully' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        mobile: '919812345678',
        retrytype: 'text',
      })
    })

    it('resolves Text retry type', async () => {
      mock.onGet(url).reply({ type: 'success', message: 'ok' })

      await service.resendOtp('919812345678', 'Text')

      expect(mock.history[0].query).toMatchObject({ retrytype: 'text' })
    })

    it('resolves Voice retry type', async () => {
      mock.onGet(url).reply({ type: 'success', message: 'ok' })

      await service.resendOtp('919812345678', 'Voice')

      expect(mock.history[0].query).toMatchObject({ retrytype: 'voice' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).reply({ type: 'error', message: 'Mobile not found' })

      await expect(service.resendOtp('919812345678'))
        .rejects.toThrow('MSG91 API error: Mobile not found')
    })
  })

  // ── Send WhatsApp Message ──

  describe('sendWhatsappMessage', () => {
    const url = `${BASE}/whatsapp/whatsapp-outbound-message/bulk/`

    it('sends correct POST with required params and no body parameters', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'messages queued' })

      const result = await service.sendWhatsappMessage(
        '919812345678', '919887654321', 'welcome_template'
      )

      expect(result).toEqual({ type: 'success', message: 'messages queued' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        integrated_number: '919812345678',
        content_type: 'template',
        payload: {
          to: '919887654321',
          type: 'template',
          template: {
            name: 'welcome_template',
            language: {
              code: 'en',
              policy: 'deterministic',
            },
            components: [],
          },
        },
      })
    })

    it('includes body parameters as template components', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendWhatsappMessage(
        '919812345678', '919887654321', 'order_template', 'en_US', ['Alex', 'ORD-123']
      )

      const body = mock.history[0].body

      expect(body.payload.template.language.code).toBe('en_US')
      expect(body.payload.template.components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Alex' },
            { type: 'text', text: 'ORD-123' },
          ],
        },
      ])
    })

    it('converts numeric body parameters to strings', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendWhatsappMessage(
        '919812345678', '919887654321', 'num_template', 'en', [42, 100]
      )

      expect(mock.history[0].body.payload.template.components[0].parameters).toEqual([
        { type: 'text', text: '42' },
        { type: 'text', text: '100' },
      ])
    })

    it('uses default language code "en" when not provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendWhatsappMessage(
        '919812345678', '919887654321', 'my_template', undefined, []
      )

      expect(mock.history[0].body.payload.template.language.code).toBe('en')
    })

    it('sends empty components when bodyParameters is empty array', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendWhatsappMessage(
        '919812345678', '919887654321', 'simple_template', 'en', []
      )

      expect(mock.history[0].body.payload.template.components).toEqual([])
    })

    it('throws on API error', async () => {
      mock.onPost(url).reply({ type: 'error', message: 'Template not approved' })

      await expect(service.sendWhatsappMessage(
        '919812345678', '919887654321', 'bad_template'
      )).rejects.toThrow('MSG91 API error: Template not approved')
    })
  })

  // ── Send Email ──

  describe('sendEmail', () => {
    const url = `${BASE}/email/send`

    it('sends correct POST with required params only', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'Mail sent successfully' })

      const result = await service.sendEmail(
        'recipient@example.com', 'sender@mail.example.com', 'mail.example.com', 'email-tpl-1'
      )

      expect(result).toEqual({ type: 'success', message: 'Mail sent successfully' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        recipients: [
          { to: [{ email: 'recipient@example.com' }] },
        ],
        from: { email: 'sender@mail.example.com' },
        domain: 'mail.example.com',
        template_id: 'email-tpl-1',
      })
    })

    it('includes toName when provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendEmail(
        'recipient@example.com', 'sender@mail.example.com', 'mail.example.com',
        'email-tpl-1', 'Alex Doe'
      )

      expect(mock.history[0].body.recipients[0].to[0]).toEqual({
        email: 'recipient@example.com',
        name: 'Alex Doe',
      })
    })

    it('includes variables when provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      const variables = { name: 'Alex', link: 'https://example.com' }

      await service.sendEmail(
        'recipient@example.com', 'sender@mail.example.com', 'mail.example.com',
        'email-tpl-1', undefined, variables
      )

      expect(mock.history[0].body.recipients[0]).toMatchObject({
        variables: { name: 'Alex', link: 'https://example.com' },
      })
    })

    it('omits variables when empty object is provided', async () => {
      mock.onPost(url).reply({ type: 'success', message: 'ok' })

      await service.sendEmail(
        'recipient@example.com', 'sender@mail.example.com', 'mail.example.com',
        'email-tpl-1', undefined, {}
      )

      expect(mock.history[0].body.recipients[0]).not.toHaveProperty('variables')
    })

    it('throws on API error', async () => {
      mock.onPost(url).reply({ type: 'error', message: 'Domain not verified' })

      await expect(service.sendEmail(
        'recipient@example.com', 'sender@mail.example.com', 'unverified.com', 'email-tpl-1'
      )).rejects.toThrow('MSG91 API error: Domain not verified')
    })
  })

  // ── Get Balance ──

  describe('getBalance', () => {
    const url = 'https://control.msg91.com/api/balance.php'

    it('sends correct GET with default route (Transactional = 4)', async () => {
      mock.onGet(url).reply({ type: 'success', balance: '1250.50' })

      const result = await service.getBalance()

      expect(result).toEqual({ type: 'success', balance: '1250.50' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        authkey: AUTH_KEY,
        type: '4',
      })
    })

    it('resolves Transactional route to type 4', async () => {
      mock.onGet(url).reply({ type: 'success', balance: '500' })

      await service.getBalance('Transactional')

      expect(mock.history[0].query).toMatchObject({ type: '4' })
    })

    it('resolves Promotional route to type 1', async () => {
      mock.onGet(url).reply({ type: 'success', balance: '200' })

      await service.getBalance('Promotional')

      expect(mock.history[0].query).toMatchObject({ type: '1' })
    })

    it('includes authkey in query params', async () => {
      mock.onGet(url).reply({ type: 'success', balance: '100' })

      await service.getBalance()

      expect(mock.history[0].query).toMatchObject({ authkey: AUTH_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(url).reply({ type: 'error', message: 'Authentication failed' })

      await expect(service.getBalance())
        .rejects.toThrow('MSG91 API error: Authentication failed')
    })
  })
})
