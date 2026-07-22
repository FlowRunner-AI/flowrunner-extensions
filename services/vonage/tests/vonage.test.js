'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const SMS_BASE = 'https://rest.nexmo.com'
const API_BASE = 'https://api.nexmo.com'

const BASIC_AUTH = `Basic ${ Buffer.from(`${ API_KEY }:${ API_SECRET }`).toString('base64') }`

describe('Vonage Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, apiSecret: API_SECRET })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'apiSecret', required: true, shared: false }),
        ])
      )
    })
  })

  // ── sendSms ──

  describe('sendSms', () => {
    it('sends correct POST request with required params', async () => {
      mock.onPost(`${ SMS_BASE }/sms/json`).reply({
        'message-count': '1',
        messages: [{ to: '447700900001', 'message-id': 'abc123', status: '0' }],
      })

      const result = await service.sendSms('447700900000', '447700900001', 'Hello')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].body).toMatchObject({
        api_key: API_KEY,
        api_secret: API_SECRET,
        from: '447700900000',
        to: '447700900001',
        text: 'Hello',
      })
      expect(mock.history[0].body.type).toBeUndefined()
      expect(mock.history[0].body['client-ref']).toBeUndefined()
      expect(result.messages[0].status).toBe('0')
    })

    it('sets type to unicode when unicode is true', async () => {
      mock.onPost(`${ SMS_BASE }/sms/json`).reply({
        'message-count': '1',
        messages: [{ status: '0' }],
      })

      await service.sendSms('Sender', '447700900001', 'Hello', true)

      expect(mock.history[0].body.type).toBe('unicode')
    })

    it('includes client-ref when provided', async () => {
      mock.onPost(`${ SMS_BASE }/sms/json`).reply({
        'message-count': '1',
        messages: [{ status: '0' }],
      })

      await service.sendSms('Sender', '447700900001', 'Hello', false, 'ref-123')

      expect(mock.history[0].body['client-ref']).toBe('ref-123')
    })

    it('throws on non-zero message status', async () => {
      mock.onPost(`${ SMS_BASE }/sms/json`).reply({
        'message-count': '1',
        messages: [{ status: '4', 'error-text': 'Invalid credentials' }],
      })

      await expect(service.sendSms('Sender', '447700900001', 'Hi'))
        .rejects.toThrow('Vonage SMS error (status 4): Invalid credentials')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${ SMS_BASE }/sms/json`).replyWithError({
        message: 'Server Error',
        body: { title: 'Internal Server Error' },
      })

      await expect(service.sendSms('Sender', '447700900001', 'Hi'))
        .rejects.toThrow('Vonage API error')
    })
  })

  // ── sendMessage ──

  describe('sendMessage', () => {
    it('sends correct POST with channel resolved to lowercase', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-123' })

      const result = await service.sendMessage('SMS', '447700900001', '447700900000', 'Hello')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: BASIC_AUTH,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toMatchObject({
        message_type: 'text',
        channel: 'sms',
        to: '447700900001',
        from: '447700900000',
        text: 'Hello',
      })
      expect(mock.history[0].body.client_ref).toBeUndefined()
      expect(result.message_uuid).toBe('uuid-123')
    })

    it('resolves WhatsApp channel', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-456' })

      await service.sendMessage('WhatsApp', '447700900001', '447700900000', 'Hi')

      expect(mock.history[0].body.channel).toBe('whatsapp')
    })

    it('resolves MMS channel', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-789' })

      await service.sendMessage('MMS', '447700900001', '447700900000', 'Hi')

      expect(mock.history[0].body.channel).toBe('mms')
    })

    it('resolves Messenger channel', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-abc' })

      await service.sendMessage('Messenger', 'page-id', 'fb-page-id', 'Hi')

      expect(mock.history[0].body.channel).toBe('messenger')
    })

    it('resolves Viber channel', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-def' })

      await service.sendMessage('Viber', '447700900001', 'viber-id', 'Hi')

      expect(mock.history[0].body.channel).toBe('viber')
    })

    it('includes client_ref when provided', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).reply({ message_uuid: 'uuid-xyz' })

      await service.sendMessage('SMS', '447700900001', '447700900000', 'Hi', 'my-ref')

      expect(mock.history[0].body.client_ref).toBe('my-ref')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/v1/messages`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid credentials' },
      })

      await expect(service.sendMessage('SMS', '447700900001', '447700900000', 'Hi'))
        .rejects.toThrow('Vonage API error: Invalid credentials')
    })
  })

  // ── startVerification ──

  describe('startVerification', () => {
    it('sends correct POST with required params', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).reply({ request_id: 'req-123' })

      const result = await service.startVerification('MyBrand', 'SMS', '447700900001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
      expect(mock.history[0].body).toMatchObject({
        brand: 'MyBrand',
        workflow: [{ channel: 'sms', to: '447700900001' }],
      })
      expect(mock.history[0].body.code_length).toBeUndefined()
      expect(mock.history[0].body.channel_timeout).toBeUndefined()
      expect(result.request_id).toBe('req-123')
    })

    it('resolves Voice channel', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).reply({ request_id: 'req-456' })

      await service.startVerification('MyBrand', 'Voice', '447700900001')

      expect(mock.history[0].body.workflow[0].channel).toBe('voice')
    })

    it('resolves Email channel', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).reply({ request_id: 'req-789' })

      await service.startVerification('MyBrand', 'Email', 'user@example.com')

      expect(mock.history[0].body.workflow[0]).toEqual({ channel: 'email', to: 'user@example.com' })
    })

    it('resolves WhatsApp channel', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).reply({ request_id: 'req-abc' })

      await service.startVerification('MyBrand', 'WhatsApp', '447700900001')

      expect(mock.history[0].body.workflow[0].channel).toBe('whatsapp')
    })

    it('includes optional code_length and channel_timeout', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).reply({ request_id: 'req-def' })

      await service.startVerification('MyBrand', 'SMS', '447700900001', 6, 120)

      expect(mock.history[0].body.code_length).toBe(6)
      expect(mock.history[0].body.channel_timeout).toBe(120)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/v2/verify`).replyWithError({
        message: 'Bad Request',
        body: { title: 'Conflict' },
      })

      await expect(service.startVerification('MyBrand', 'SMS', '447700900001'))
        .rejects.toThrow('Vonage API error: Conflict')
    })
  })

  // ── checkVerification ──

  describe('checkVerification', () => {
    it('sends correct POST with requestId and code', async () => {
      mock.onPost(`${ API_BASE }/v2/verify/req-123`).reply({ request_id: 'req-123', status: 'completed' })

      const result = await service.checkVerification('req-123', '1234')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
      expect(mock.history[0].body).toEqual({ code: '1234' })
      expect(result.status).toBe('completed')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/v2/verify/req-123`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Request not found' },
      })

      await expect(service.checkVerification('req-123', '0000'))
        .rejects.toThrow('Vonage API error: Request not found')
    })
  })

  // ── cancelVerification ──

  describe('cancelVerification', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${ API_BASE }/v2/verify/req-123`).reply({})

      const result = await service.cancelVerification('req-123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
      expect(result).toEqual({ success: true, request_id: 'req-123' })
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ API_BASE }/v2/verify/req-456`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Request not found or already completed' },
      })

      await expect(service.cancelVerification('req-456'))
        .rejects.toThrow('Vonage API error: Request not found or already completed')
    })
  })

  // ── numberInsightBasic ──

  describe('numberInsightBasic', () => {
    it('sends GET with correct query params', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).reply({
        status: 0,
        status_message: 'Success',
        international_format_number: '447700900000',
        country_code: 'GB',
      })

      const result = await service.numberInsightBasic('447700900000')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        api_secret: API_SECRET,
        number: '447700900000',
      })
      expect(mock.history[0].query.country).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.country_code).toBe('GB')
    })

    it('includes optional country parameter', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).reply({ status: 0 })

      await service.numberInsightBasic('07700900000', 'GB')

      expect(mock.history[0].query).toMatchObject({
        number: '07700900000',
        country: 'GB',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Unauthorized',
        body: { 'error-text': 'Invalid credentials' },
      })

      await expect(service.numberInsightBasic('447700900000'))
        .rejects.toThrow('Vonage API error: Invalid credentials')
    })
  })

  // ── numberInsightStandard ──

  describe('numberInsightStandard', () => {
    it('sends GET with correct query params', async () => {
      mock.onGet(`${ API_BASE }/ni/standard/json`).reply({
        status: 0,
        status_message: 'Success',
        international_format_number: '447700900000',
        current_carrier: { name: 'Telefonica UK Limited', network_type: 'mobile' },
      })

      const result = await service.numberInsightStandard('447700900000')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        api_secret: API_SECRET,
        number: '447700900000',
      })
      expect(result.current_carrier.network_type).toBe('mobile')
    })

    it('includes optional country parameter', async () => {
      mock.onGet(`${ API_BASE }/ni/standard/json`).reply({ status: 0 })

      await service.numberInsightStandard('07700900000', 'GB')

      expect(mock.history[0].query.country).toBe('GB')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/ni/standard/json`).replyWithError({
        message: 'Error',
        body: { title: 'Unauthorized' },
      })

      await expect(service.numberInsightStandard('447700900000'))
        .rejects.toThrow('Vonage API error: Unauthorized')
    })
  })

  // ── getBalance ──

  describe('getBalance', () => {
    it('sends GET with api_key and api_secret in query', async () => {
      mock.onGet(`${ SMS_BASE }/account/get-balance`).reply({ value: 18.995, autoReload: false })

      const result = await service.getBalance()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        api_secret: API_SECRET,
      })
      expect(result.value).toBe(18.995)
      expect(result.autoReload).toBe(false)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ SMS_BASE }/account/get-balance`).replyWithError({
        message: 'Forbidden',
        body: {},
      })

      await expect(service.getBalance()).rejects.toThrow('Vonage API error: Forbidden')
    })
  })

  // ── listOwnedNumbers ──

  describe('listOwnedNumbers', () => {
    it('sends GET with no optional params', async () => {
      mock.onGet(`${ SMS_BASE }/account/numbers`).reply({
        count: 1,
        numbers: [{ country: 'GB', msisdn: '447700900000' }],
      })

      const result = await service.listOwnedNumbers()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        api_key: API_KEY,
        api_secret: API_SECRET,
      })
      expect(mock.history[0].query.pattern).toBeUndefined()
      expect(mock.history[0].query.search_pattern).toBeUndefined()
      expect(result.count).toBe(1)
    })

    it('includes pattern and search_pattern when pattern is provided', async () => {
      mock.onGet(`${ SMS_BASE }/account/numbers`).reply({ count: 0, numbers: [] })

      await service.listOwnedNumbers('4477', 20, 2)

      expect(mock.history[0].query).toMatchObject({
        pattern: '4477',
        search_pattern: 1,
        size: 20,
        index: 2,
      })
    })

    it('includes size and index without pattern', async () => {
      mock.onGet(`${ SMS_BASE }/account/numbers`).reply({ count: 0, numbers: [] })

      await service.listOwnedNumbers(undefined, 50, 1)

      expect(mock.history[0].query.size).toBe(50)
      expect(mock.history[0].query.index).toBe(1)
      expect(mock.history[0].query.pattern).toBeUndefined()
      expect(mock.history[0].query.search_pattern).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${ SMS_BASE }/account/numbers`).replyWithError({
        message: 'Unauthorized',
        body: { 'error-text': 'Bad Credentials' },
      })

      await expect(service.listOwnedNumbers()).rejects.toThrow('Vonage API error: Bad Credentials')
    })
  })

  // ── Error formatting ──

  describe('error formatting', () => {
    it('uses detail from response body', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Specific detail message', title: 'Generic title' },
      })

      await expect(service.numberInsightBasic('123'))
        .rejects.toThrow('Vonage API error: Specific detail message')
    })

    it('falls back to title when detail is missing', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Bad Request',
        body: { title: 'Not Found' },
      })

      await expect(service.numberInsightBasic('123'))
        .rejects.toThrow('Vonage API error: Not Found')
    })

    it('falls back to error-text when detail and title are missing', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Bad Request',
        body: { 'error-text': 'Invalid number' },
      })

      await expect(service.numberInsightBasic('123'))
        .rejects.toThrow('Vonage API error: Invalid number')
    })

    it('falls back to error.message when body has no recognized fields', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Network timeout',
        body: {},
      })

      await expect(service.numberInsightBasic('123'))
        .rejects.toThrow('Vonage API error: Network timeout')
    })

    it('falls back to error.message when body is empty object', async () => {
      mock.onGet(`${ API_BASE }/ni/basic/json`).replyWithError({
        message: 'Request failed',
      })

      await expect(service.numberInsightBasic('123'))
        .rejects.toThrow('Vonage API error: Request failed')
    })
  })
})
