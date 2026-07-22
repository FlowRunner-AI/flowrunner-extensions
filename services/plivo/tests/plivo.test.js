'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_ID = 'MATESTAUTHID000000'
const AUTH_TOKEN = 'test-auth-token'
const ACCOUNT_BASE = `https://api.plivo.com/v1/Account/${ AUTH_ID }`
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ AUTH_ID }:${ AUTH_TOKEN }`).toString('base64') }`

describe('Plivo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ authId: AUTH_ID, authToken: AUTH_TOKEN })
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
    it('registers the auth config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'authId',
          displayName: 'Auth ID',
          type: 'STRING',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'authToken',
          displayName: 'Auth Token',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Request plumbing ──

  describe('request plumbing', () => {
    it('sends basic auth and json content-type headers', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/`).reply({ account_type: 'standard' })

      await service.getAccountDetails()

      expect(mock.history[0].headers).toEqual({
        'Authorization': EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('wraps errors with the status and the API error field', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/`).replyWithError({
        message: 'Request failed',
        status: 401,
        body: { error: 'authentication failed' },
      })

      await expect(service.getAccountDetails()).rejects.toThrow(
        'Plivo API error [401]: authentication failed'
      )
    })

    it('falls back to body.message', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/`).replyWithError({
        message: 'Request failed',
        statusCode: 500,
        body: { message: 'server exploded' },
      })

      await expect(service.getAccountDetails()).rejects.toThrow(
        'Plivo API error [500]: server exploded'
      )
    })

    it('falls back to error.message and omits the status when unknown', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/`).replyWithError({ message: 'socket hang up' })

      await expect(service.getAccountDetails()).rejects.toThrow('Plivo API error: socket hang up')
    })
  })

  // ── Messages ──

  describe('sendSms', () => {
    it('sends an SMS with the default type', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/Message/`).reply({ message_uuid: ['uuid-1'] })

      const result = await service.sendSms('+12025550100', '+12025550101', 'hello')

      expect(result).toEqual({ message_uuid: ['uuid-1'] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ ACCOUNT_BASE }/Message/`)

      expect(mock.history[0].body).toEqual({
        src: '+12025550100',
        dst: '+12025550101',
        text: 'hello',
        type: 'sms',
      })
    })

    it('maps the MMS type and includes optional url and media', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/Message/`).reply({ message_uuid: ['uuid-2'] })

      await service.sendSms(
        '+12025550100',
        '+12025550101',
        'look',
        'MMS',
        'https://example.com/callback',
        ['https://example.com/a.png']
      )

      expect(mock.history[0].body).toEqual({
        src: '+12025550100',
        dst: '+12025550101',
        text: 'look',
        type: 'mms',
        url: 'https://example.com/callback',
        media_urls: ['https://example.com/a.png'],
      })
    })

    it('omits an empty media array and strips undefined fields', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/Message/`).reply({ message_uuid: ['uuid-3'] })

      await service.sendSms('+12025550100', '+12025550101', undefined, 'SMS', null, [])

      expect(mock.history[0].body).toEqual({
        src: '+12025550100',
        dst: '+12025550101',
        type: 'sms',
      })
    })
  })

  describe('getMessage', () => {
    it('fetches a single message', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Message/uuid-1/`).reply({ message_uuid: 'uuid-1' })

      await expect(service.getMessage('uuid-1')).resolves.toEqual({ message_uuid: 'uuid-1' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('listMessages', () => {
    it('passes the filters as query params', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Message/`).reply({ objects: [] })

      await service.listMessages('2024-01-01', 10, 20)

      expect(mock.history[0].query).toEqual({ message_time: '2024-01-01', limit: 10, offset: 20 })
    })

    it('strips undefined filters', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Message/`).reply({ objects: [] })

      await service.listMessages()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Calls ──

  describe('makeCall', () => {
    it('defaults the answer method to POST', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/Call/`).reply({ request_uuid: 'req-1' })

      const result = await service.makeCall('+12025550100', '+12025550101', 'https://example.com/answer')

      expect(result).toEqual({ request_uuid: 'req-1' })

      expect(mock.history[0].body).toEqual({
        from: '+12025550100',
        to: '+12025550101',
        answer_url: 'https://example.com/answer',
        answer_method: 'POST',
      })
    })

    it('honours an explicit GET answer method', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/Call/`).reply({ request_uuid: 'req-2' })

      await service.makeCall('+1', '+2', 'https://example.com/answer', 'GET')

      expect(mock.history[0].body.answer_method).toBe('GET')
    })
  })

  describe('getCall', () => {
    it('fetches a single call', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Call/call-1/`).reply({ call_uuid: 'call-1' })

      await expect(service.getCall('call-1')).resolves.toEqual({ call_uuid: 'call-1' })
    })
  })

  describe('listCalls', () => {
    it('maps the call direction label', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Call/`).reply({ objects: [] })

      await service.listCalls('Inbound', 5, 0)

      expect(mock.history[0].query).toEqual({ call_direction: 'inbound', limit: 5, offset: 0 })
    })

    it('passes through an unmapped direction and drops undefined values', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Call/`).reply({ objects: [] })

      await service.listCalls('outbound')

      expect(mock.history[0].query).toEqual({ call_direction: 'outbound' })
    })
  })

  describe('hangupCall', () => {
    it('deletes the call and returns a success payload', async () => {
      mock.onDelete(`${ ACCOUNT_BASE }/Call/call-1/`).reply('')

      await expect(service.hangupCall('call-1')).resolves.toEqual({
        success: true,
        call_uuid: 'call-1',
        message: 'Call hung up successfully',
      })

      expect(mock.history[0].method).toBe('delete')
    })

    it('propagates the API error', async () => {
      mock.onDelete(`${ ACCOUNT_BASE }/Call/call-1/`).replyWithError({
        message: 'Request failed',
        status: 404,
        body: { error: 'call not found' },
      })

      await expect(service.hangupCall('call-1')).rejects.toThrow('Plivo API error [404]: call not found')
    })
  })

  // ── Numbers ──

  describe('listNumbers', () => {
    it('maps the number type label', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({ objects: [] })

      await service.listNumbers('Toll-Free', 20, 0)

      expect(mock.history[0].query).toEqual({ type: 'tollfree', limit: 20, offset: 0 })
    })

    it('omits the type when not provided', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({ objects: [] })

      await service.listNumbers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getNumber', () => {
    it('fetches a rented number', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/12025550100/`).reply({ number: '12025550100' })

      await expect(service.getNumber('12025550100')).resolves.toEqual({ number: '12025550100' })
    })
  })

  describe('searchNumbers', () => {
    it('searches the phone number inventory', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/PhoneNumber/`).reply({ objects: [] })

      await service.searchNumbers('US', 'Mobile', 5, 10)

      expect(mock.history[0].query).toEqual({ country_iso: 'US', type: 'mobile', limit: 5, offset: 10 })
    })
  })

  describe('buyNumber', () => {
    it('buys a number without an application', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/PhoneNumber/12025550100/`).reply({ status: 'fulfilled' })

      await expect(service.buyNumber('12025550100')).resolves.toEqual({ status: 'fulfilled' })
      expect(mock.history[0].body).toEqual({})
    })

    it('attaches the application id when provided', async () => {
      mock.onPost(`${ ACCOUNT_BASE }/PhoneNumber/12025550100/`).reply({ status: 'fulfilled' })

      await service.buyNumber('12025550100', 'app-1')

      expect(mock.history[0].body).toEqual({ app_id: 'app-1' })
    })
  })

  // ── Powerpacks / Applications / Account ──

  describe('listPowerpacks', () => {
    it('lists the powerpacks', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Powerpack/`).reply({ objects: [] })

      await service.listPowerpacks(10, 0)

      expect(mock.history[0].query).toEqual({ limit: 10, offset: 0 })
    })
  })

  describe('listApplications', () => {
    it('lists the applications', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Application/`).reply({ objects: [] })

      await service.listApplications(10, 0)

      expect(mock.history[0].query).toEqual({ limit: 10, offset: 0 })
    })
  })

  describe('getAccountDetails', () => {
    it('fetches the account', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/`).reply({ name: 'Acme', cash_credits: '10.00' })

      await expect(service.getAccountDetails()).resolves.toEqual({ name: 'Acme', cash_credits: '10.00' })
    })
  })

  // ── Dictionaries ──

  describe('getNumbersDictionary', () => {
    it('maps numbers with capability notes and a next cursor', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({
        meta: { total_count: 45 },
        objects: [
          { number: '12025550100', alias: 'Support', number_type: 'local', sms_enabled: true, voice_enabled: true },
          { number: '12025550101', number_type: 'tollfree', sms_enabled: false, voice_enabled: false },
        ],
      })

      const result = await service.getNumbersDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 20, offset: 0 })

      expect(result).toEqual({
        cursor: '20',
        items: [
          {
            label: '12025550100 (Support)',
            value: '12025550100',
            note: 'Type: local, SMS/Voice enabled',
          },
          {
            label: '12025550101',
            value: '12025550101',
            note: 'Type: tollfree, no capabilities enabled',
          },
        ],
      })
    })

    it('uses the cursor as the offset and stops paging at the end', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({ meta: { total_count: 25 }, objects: [] })

      const result = await service.getNumbersDictionary({ cursor: '20' })

      expect(mock.history[0].query).toEqual({ limit: 20, offset: 20 })
      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('filters by number and alias', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({
        objects: [
          { number: '12025550100', alias: 'Support' },
          { number: '12025550101', alias: 'Sales' },
        ],
      })

      const result = await service.getNumbersDictionary({ search: 'sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('12025550101')
      expect(result.cursor).toBeNull()
    })

    it('handles a null payload and a missing objects list', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({})

      await expect(service.getNumbersDictionary(null)).resolves.toEqual({ cursor: null, items: [] })
    })

    it('handles a number without a type', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Number/`).reply({
        objects: [{ number: '12025550100', sms_enabled: true }],
      })

      const result = await service.getNumbersDictionary({})

      expect(result.items[0].note).toBe('Type: unknown, SMS enabled')
    })
  })

  describe('getApplicationsDictionary', () => {
    it('maps applications with the answer url note', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Application/`).reply({
        meta: { total_count: 2 },
        objects: [
          { app_id: 101, app_name: 'IVR', answer_url: 'https://example.com/answer' },
          { app_id: 102 },
        ],
      })

      const result = await service.getApplicationsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'IVR', value: '101', note: 'Answer URL: https://example.com/answer' },
          { label: 102, value: '102', note: 'No answer URL configured' },
        ],
      })
    })

    it('filters by app name and id', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Application/`).reply({
        objects: [{ app_id: 101, app_name: 'IVR' }, { app_id: 102, app_name: 'Voicemail' }],
      })

      const result = await service.getApplicationsDictionary({ search: 'voice' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('102')
    })

    it('returns a next cursor when more pages remain', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Application/`).reply({ meta: { total_count: 100 }, objects: [] })

      const result = await service.getApplicationsDictionary({ cursor: '20' })

      expect(mock.history[0].query).toEqual({ limit: 20, offset: 20 })
      expect(result.cursor).toBe('40')
    })

    it('handles a null payload and a missing objects list', async () => {
      mock.onGet(`${ ACCOUNT_BASE }/Application/`).reply({})

      await expect(service.getApplicationsDictionary(null)).resolves.toEqual({ cursor: null, items: [] })
    })
  })
})
