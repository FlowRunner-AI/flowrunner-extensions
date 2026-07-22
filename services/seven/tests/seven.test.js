'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://gateway.seven.io/api'

const AUTH_HEADERS = {
  'X-Api-Key': API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
}

describe('seven Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('reads the api key from config', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Messaging ──

  describe('sendSms', () => {
    it('posts the message with the auth headers and json flag', async () => {
      mock.onPost(`${ BASE }/sms`).reply({ success: '100', balance: 10 })

      const result = await service.sendSms('491710000000', 'Hello World')

      expect(result).toEqual({ success: '100', balance: 10 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/sms`)
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)

      expect(mock.history[0].body).toEqual({
        to: '491710000000',
        text: 'Hello World',
        json: 1,
      })
    })

    it('maps the optional flags and fields', async () => {
      mock.onPost(`${ BASE }/sms`).reply({ success: '100' })

      await service.sendSms('491710000000', 'Hi', 'seven', true, true, '2026-01-01 10:00:00', 'ref-1', 'label-1')

      expect(mock.history[0].body).toEqual({
        to: '491710000000',
        text: 'Hi',
        from: 'seven',
        flash: 1,
        unicode: 1,
        delay: '2026-01-01 10:00:00',
        foreign_id: 'ref-1',
        label: 'label-1',
        json: 1,
      })
    })

    it('omits falsy toggles and empty values from the body', async () => {
      mock.onPost(`${ BASE }/sms`).reply({ success: '100' })

      await service.sendSms('491710000000', 'Hi', '', false, false, '', null, undefined)

      expect(mock.history[0].body).toEqual({ to: '491710000000', text: 'Hi', json: 1 })
    })

    it('throws a descriptive error for a non-100 gateway status code', async () => {
      mock.onPost(`${ BASE }/sms`).reply({ success: '500' })

      await expect(service.sendSms('491710000000', 'Hi')).rejects.toThrow(
        /code 500 - Insufficient account credit\./
      )
    })

    it('throws for an unknown numeric gateway status code', async () => {
      mock.onPost(`${ BASE }/sms`).reply({ success: '999' })

      await expect(service.sendSms('491710000000', 'Hi')).rejects.toThrow(
        /code 999 - Unknown status code\./
      )
    })

    it('surfaces the API error body message on an HTTP failure', async () => {
      mock.onPost(`${ BASE }/sms`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid recipient' },
      })

      await expect(service.sendSms('bad', 'Hi')).rejects.toThrow('seven API error: Invalid recipient')
    })

    it('falls back to body.error then error.message', async () => {
      mock.onPost(`${ BASE }/sms`).replyWithError({ message: 'Boom', body: { error: 'nope' } })
      await expect(service.sendSms('x', 'y')).rejects.toThrow('seven API error: nope')

      mock.reset()

      mock.onPost(`${ BASE }/sms`).replyWithError({ message: 'Network down' })
      await expect(service.sendSms('x', 'y')).rejects.toThrow('seven API error: Network down')
    })
  })

  describe('getSmsStatus', () => {
    it('requests the status endpoint with the message id', async () => {
      mock.onGet(`${ BASE }/status`).reply({ success: '100', report: { id: '1', status: 'DELIVERED' } })

      const result = await service.getSmsStatus('77229318510')

      expect(result.report.status).toBe('DELIVERED')
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/status`)
      expect(mock.history[0].query).toEqual({ msg_id: '77229318510', json: 1 })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('drops an empty message id from the query', async () => {
      mock.onGet(`${ BASE }/status`).reply({ success: '100' })

      await service.getSmsStatus('')

      expect(mock.history[0].query).toEqual({ json: 1 })
    })
  })

  // ── Lookup ──

  describe('numberLookup', () => {
    it.each([
      ['Format', 'format'],
      ['Carrier Name (CNAM)', 'cnam'],
      ['Portability (MNP)', 'mnp'],
      ['HLR (Live Status)', 'hlr'],
    ])('maps the %s label to the %s endpoint', async (label, slug) => {
      mock.onGet(`${ BASE }/lookup/${ slug }`).reply({ success: '100' })

      await service.numberLookup(label, '491710000000')

      expect(mock.history[0].url).toBe(`${ BASE }/lookup/${ slug }`)
      expect(mock.history[0].query).toEqual({ number: '491710000000', json: 1 })
    })

    it('passes an unmapped lookup type through unchanged', async () => {
      mock.onGet(`${ BASE }/lookup/hlr`).reply({ success: '100' })

      await service.numberLookup('hlr', '491710000000')

      expect(mock.history[0].url).toBe(`${ BASE }/lookup/hlr`)
    })

    it('builds an undefined path segment when no type is given', async () => {
      mock.onGet(`${ BASE }/lookup/undefined`).reply({ success: '100' })

      await service.numberLookup(null, '491710000000')

      expect(mock.history[0].url).toBe(`${ BASE }/lookup/undefined`)
    })
  })

  // ── Voice ──

  describe('sendVoiceCall', () => {
    it('posts the call payload', async () => {
      mock.onPost(`${ BASE }/voice`).reply({ success: '100', id: '88123456' })

      const result = await service.sendVoiceCall('491710000000', 'Hello there')

      expect(result.id).toBe('88123456')
      expect(mock.history[0].url).toBe(`${ BASE }/voice`)
      expect(mock.history[0].body).toEqual({ to: '491710000000', text: 'Hello there', json: 1 })
    })

    it('includes the caller id and xml flag when enabled', async () => {
      mock.onPost(`${ BASE }/voice`).reply({ success: '100' })

      await service.sendVoiceCall('491710000000', '<Response/>', '4915100000', true)

      expect(mock.history[0].body).toEqual({
        to: '491710000000',
        text: '<Response/>',
        from: '4915100000',
        xml: 1,
        json: 1,
      })
    })
  })

  // ── Account ──

  describe('getBalance', () => {
    it('requests the balance endpoint', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ amount: 593.994, currency: 'EUR' })

      const result = await service.getBalance()

      expect(result).toEqual({ amount: 593.994, currency: 'EUR' })
      expect(mock.history[0].url).toBe(`${ BASE }/balance`)
      expect(mock.history[0].query).toEqual({ json: 1 })
    })
  })

  describe('getPricing', () => {
    it('lower-cases the country code', async () => {
      mock.onGet(`${ BASE }/pricing`).reply({ countCountries: 1 })

      await service.getPricing('DE')

      expect(mock.history[0].query).toEqual({ country: 'de', format: 'json' })
    })

    it('omits the country when not provided', async () => {
      mock.onGet(`${ BASE }/pricing`).reply({ countCountries: 200 })

      await service.getPricing()

      expect(mock.history[0].query).toEqual({ format: 'json' })
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('requests the contacts read action', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([{ id: '12345', nick: 'Jane Doe' }])

      const result = await service.listContacts()

      expect(result).toEqual([{ id: '12345', nick: 'Jane Doe' }])
      expect(mock.history[0].query).toEqual({ action: 'read', json: 1 })
    })

    it('returns array payloads untouched by the status check', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await expect(service.listContacts()).resolves.toEqual([])
    })
  })

  describe('createContact', () => {
    it('posts the create action with all fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ return: '152522', id: '152522' })

      const result = await service.createContact('Jane Doe', '491710000000', 'jane@example.com')

      expect(result).toEqual({ return: '152522', id: '152522' })

      expect(mock.history[0].body).toEqual({
        action: 'create',
        nick: 'Jane Doe',
        mobile: '491710000000',
        email: 'jane@example.com',
        json: 1,
      })
    })

    it('omits optional contact fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: '1' })

      await service.createContact('Jane Doe')

      expect(mock.history[0].body).toEqual({ action: 'create', nick: 'Jane Doe', json: 1 })
    })
  })

  // ── Response envelope handling ──

  describe('gateway status handling', () => {
    it('passes through non-object responses', async () => {
      mock.onGet(`${ BASE }/balance`).reply('OK')

      await expect(service.getBalance()).resolves.toBe('OK')
    })

    it('passes through responses without a status field', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ amount: 1 })

      await expect(service.getBalance()).resolves.toEqual({ amount: 1 })
    })

    it('ignores a boolean success flag', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ success: true, amount: 1 })

      await expect(service.getBalance()).resolves.toEqual({ success: true, amount: 1 })
    })

    it('reads the code field when success is absent', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ code: '900' })

      await expect(service.getBalance()).rejects.toThrow(
        /code 900 - Authentication failed\. Check your API key\./
      )
    })

    it('accepts code 100 as success', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ code: 100, amount: 5 })

      await expect(service.getBalance()).resolves.toEqual({ code: 100, amount: 5 })
    })

    it('treats a null status field as success', async () => {
      mock.onGet(`${ BASE }/balance`).reply({ success: null, amount: 5 })

      await expect(service.getBalance()).resolves.toEqual({ success: null, amount: 5 })
    })
  })
})
