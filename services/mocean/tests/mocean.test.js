'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const BASE = 'https://rest.moceanapi.com/rest/2'

describe('Mocean Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiSecret',
          displayName: 'API Secret',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── SMS ──

  describe('sendSms', () => {
    it('sends correct POST request with auth params and message fields', async () => {
      mock.onPost(`${BASE}/sms`).reply({
        messages: [{ status: 0, receiver: '60123456789', msgid: 'msg-001' }],
      })

      const result = await service.sendSms('MyApp', '60123456789', 'Hello world')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${BASE}/sms`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
        'mocean-from': 'MyApp',
        'mocean-to': '60123456789',
        'mocean-text': 'Hello world',
      })
      expect(result).toEqual({
        messages: [{ status: 0, receiver: '60123456789', msgid: 'msg-001' }],
      })
    })

    it('throws on API error status in messages array', async () => {
      mock.onPost(`${BASE}/sms`).reply({
        messages: [{ status: 1, err_msg: 'Authorization failed' }],
      })

      await expect(service.sendSms('MyApp', '60123456789', 'Hi'))
        .rejects.toThrow('Mocean API error (status 1): Authorization failed')
    })

    it('throws on top-level API error status', async () => {
      mock.onPost(`${BASE}/sms`).reply({
        status: 1,
        err_msg: 'Invalid credentials',
      })

      await expect(service.sendSms('MyApp', '60123456789', 'Hi'))
        .rejects.toThrow('Mocean API error (status 1): Invalid credentials')
    })

    it('throws on HTTP request failure', async () => {
      mock.onPost(`${BASE}/sms`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.sendSms('MyApp', '60123456789', 'Hi'))
        .rejects.toThrow('Mocean API error: Network Error')
    })

    it('extracts error message from error.body.err_msg', async () => {
      mock.onPost(`${BASE}/sms`).replyWithError({
        message: 'Request failed',
        body: { err_msg: 'Insufficient balance' },
      })

      await expect(service.sendSms('MyApp', '60123456789', 'Hi'))
        .rejects.toThrow('Mocean API error: Insufficient balance')
    })

    it('extracts error message from error.body.messages array', async () => {
      mock.onPost(`${BASE}/sms`).replyWithError({
        message: 'Request failed',
        body: { messages: [{ err_msg: 'Invalid recipient' }] },
      })

      await expect(service.sendSms('MyApp', '60123456789', 'Hi'))
        .rejects.toThrow('Mocean API error: Invalid recipient')
    })
  })

  // ── Verify ──

  describe('sendVerificationCode', () => {
    it('sends correct POST request with required params', async () => {
      mock.onPost(`${BASE}/verify/req/sms`).reply({
        reqid: 'req-001',
        status: 0,
        to: '60123456789',
        is_number_reachable: 'unknown',
      })

      const result = await service.sendVerificationCode('60123456789', 'MyBrand')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/verify/req/sms`)
      expect(mock.history[0].body).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
        'mocean-to': '60123456789',
        'mocean-brand': 'MyBrand',
      })
      // Optional params should be cleaned (removed) when undefined
      expect(mock.history[0].body).not.toHaveProperty('mocean-from')
      expect(mock.history[0].body).not.toHaveProperty('mocean-code-length')
      expect(mock.history[0].body).not.toHaveProperty('mocean-pin-validity')
      expect(result).toMatchObject({ reqid: 'req-001', status: 0 })
    })

    it('includes optional params when provided', async () => {
      mock.onPost(`${BASE}/verify/req/sms`).reply({
        reqid: 'req-002',
        status: 0,
        to: '60123456789',
      })

      await service.sendVerificationCode('60123456789', 'MyBrand', 'MySender', 6, 600)

      expect(mock.history[0].body).toMatchObject({
        'mocean-from': 'MySender',
        'mocean-code-length': 6,
        'mocean-pin-validity': 600,
      })
    })

    it('throws on error status in response', async () => {
      mock.onPost(`${BASE}/verify/req/sms`).reply({
        status: 1,
        err_msg: 'Invalid number',
      })

      await expect(service.sendVerificationCode('bad', 'MyBrand'))
        .rejects.toThrow('Mocean API error (status 1): Invalid number')
    })
  })

  describe('checkVerificationCode', () => {
    it('sends correct POST request with reqid and code', async () => {
      mock.onPost(`${BASE}/verify/check`).reply({
        reqid: 'req-001',
        status: 0,
      })

      const result = await service.checkVerificationCode('req-001', '1234')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/verify/check`)
      expect(mock.history[0].body).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
        'mocean-reqid': 'req-001',
        'mocean-code': '1234',
      })
      expect(result).toEqual({ reqid: 'req-001', status: 0 })
    })

    it('throws on wrong code (non-zero status)', async () => {
      mock.onPost(`${BASE}/verify/check`).reply({
        reqid: 'req-001',
        status: 2,
        err_msg: 'Invalid code',
      })

      await expect(service.checkVerificationCode('req-001', '0000'))
        .rejects.toThrow('Mocean API error (status 2): Invalid code')
    })
  })

  describe('resendVerificationCode', () => {
    it('sends correct POST request with reqid', async () => {
      mock.onPost(`${BASE}/verify/resend/sms`).reply({
        reqid: 'req-001',
        status: 0,
        to: '60123456789',
        is_number_reachable: 'unknown',
        resend_number: '2',
      })

      const result = await service.resendVerificationCode('req-001')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/verify/resend/sms`)
      expect(mock.history[0].body).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
        'mocean-reqid': 'req-001',
      })
      expect(result).toMatchObject({ reqid: 'req-001', status: 0, resend_number: '2' })
    })

    it('throws on error status', async () => {
      mock.onPost(`${BASE}/verify/resend/sms`).reply({
        status: 1,
        err_msg: 'Request not found',
      })

      await expect(service.resendVerificationCode('bad-req'))
        .rejects.toThrow('Mocean API error (status 1): Request not found')
    })
  })

  // ── Number Lookup ──

  describe('numberLookup', () => {
    it('sends correct POST request with phone number', async () => {
      mock.onPost(`${BASE}/nl`).reply({
        status: 0,
        msgid: 'nl-001',
        to: '60123456789',
        current_carrier: { country: 'MY', name: 'U Mobile', network_code: 50218 },
        original_carrier: { country: 'MY', name: 'Maxis Mobile', network_code: 50212 },
        ported: 'ported',
      })

      const result = await service.numberLookup('60123456789')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/nl`)
      expect(mock.history[0].body).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
        'mocean-to': '60123456789',
      })
      expect(result).toMatchObject({
        status: 0,
        to: '60123456789',
        ported: 'ported',
      })
      expect(result.current_carrier).toHaveProperty('name', 'U Mobile')
      expect(result.original_carrier).toHaveProperty('name', 'Maxis Mobile')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/nl`).replyWithError({
        message: 'Forbidden',
      })

      await expect(service.numberLookup('bad-number'))
        .rejects.toThrow('Mocean API error: Forbidden')
    })
  })

  // ── Account ──

  describe('getBalance', () => {
    it('sends correct GET request with auth params in query', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({
        status: 0,
        balance: '1234.50',
      })

      const result = await service.getBalance()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/account/balance`)
      expect(mock.history[0].query).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
      })
      expect(result).toEqual({ status: 0, balance: '1234.50' })
    })

    it('does not set Content-Type or send body for GET requests', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({ status: 0, balance: '0.00' })

      await service.getBalance()

      expect(mock.history[0].headers).not.toHaveProperty('Content-Type')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/account/balance`).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.getBalance()).rejects.toThrow('Mocean API error: Unauthorized')
    })
  })

  describe('getPricing', () => {
    it('sends correct GET request without country code filter', async () => {
      mock.onGet(`${BASE}/account/pricing`).reply({
        status: 0,
        pricing: [
          { country: 'MY', country_name: 'Malaysia', price: '0.05' },
          { country: 'US', country_name: 'United States', price: '0.01' },
        ],
      })

      const result = await service.getPricing()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/account/pricing`)
      expect(mock.history[0].query).toMatchObject({
        'mocean-api-key': API_KEY,
        'mocean-api-secret': API_SECRET,
        'mocean-resp-format': 'json',
      })
      // countryCode is undefined, so it should be cleaned out
      expect(mock.history[0].query).not.toHaveProperty('mocean-country-code')
      expect(result.pricing).toHaveLength(2)
    })

    it('includes country code filter when provided', async () => {
      mock.onGet(`${BASE}/account/pricing`).reply({
        status: 0,
        pricing: [{ country: 'MY', country_name: 'Malaysia', price: '0.05' }],
      })

      const result = await service.getPricing('MY')

      expect(mock.history[0].query).toMatchObject({
        'mocean-country-code': 'MY',
      })
      expect(result.pricing).toHaveLength(1)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/account/pricing`).replyWithError({
        message: 'Server Error',
      })

      await expect(service.getPricing()).rejects.toThrow('Mocean API error: Server Error')
    })
  })

  // ── #assertOk edge cases ──

  describe('response assertion edge cases', () => {
    it('passes through response with status 0 (success)', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({ status: 0, balance: '100' })

      const result = await service.getBalance()

      expect(result).toEqual({ status: 0, balance: '100' })
    })

    it('passes through response without status field', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({ balance: '100' })

      const result = await service.getBalance()

      expect(result).toEqual({ balance: '100' })
    })

    it('throws when response has non-zero status', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({
        status: 2,
        err_msg: 'Some error',
      })

      await expect(service.getBalance())
        .rejects.toThrow('Mocean API error (status 2): Some error')
    })

    it('throws with "Unknown error" when err_msg is missing', async () => {
      mock.onGet(`${BASE}/account/balance`).reply({
        status: 3,
      })

      await expect(service.getBalance())
        .rejects.toThrow('Mocean API error (status 3): Unknown error')
    })

    it('finds error in messages array even when top-level status is 0', async () => {
      mock.onPost(`${BASE}/sms`).reply({
        messages: [
          { status: 0, receiver: '111', msgid: 'ok' },
          { status: 5, err_msg: 'Bad number' },
        ],
      })

      await expect(service.sendSms('MyApp', '111,222', 'Hi'))
        .rejects.toThrow('Mocean API error (status 5): Bad number')
    })
  })
})
