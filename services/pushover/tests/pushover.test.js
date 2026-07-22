'use strict'

const { createSandbox } = require('../../../service-sandbox')

const APP_TOKEN = 'test-app-token'
const BASE = 'https://api.pushover.net/1'
const USER_KEY = 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG'

describe('Pushover Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ appToken: APP_TOKEN })
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
    it('registers the appToken config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'appToken',
          displayName: 'Application API Token',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Send Notification ──

  describe('sendNotification', () => {
    it('sends the minimal form-encoded body', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1, request: 'req-1' })

      const result = await service.sendNotification(USER_KEY, 'Hello')

      expect(result).toEqual({ status: 1, request: 'req-1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/messages.json`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })

      expect(mock.history[0].body).toEqual({
        token: APP_TOKEN,
        user: USER_KEY,
        message: 'Hello',
      })
    })

    it('maps priority and sound labels to API values', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1 })

      await service.sendNotification(USER_KEY, 'Hello', 'Title', 'High', 'Cash Register')

      expect(mock.history[0].body).toMatchObject({
        title: 'Title',
        priority: 1,
        sound: 'cashregister',
      })
    })

    it('passes through raw priority and sound values that are not labels', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1 })

      await service.sendNotification(USER_KEY, 'Hello', undefined, -1, 'customsound')

      expect(mock.history[0].body).toMatchObject({ priority: -1, sound: 'customsound' })
    })

    it('keeps Normal priority as numeric zero in the body', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1 })

      await service.sendNotification(USER_KEY, 'Hello', undefined, 'Normal')

      expect(mock.history[0].body).toMatchObject({ priority: 0 })
    })

    it('includes url, urlTitle, device, html, timestamp and ttl', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1 })

      await service.sendNotification(
        USER_KEY,
        'Hello',
        'Title',
        'Low',
        'Siren',
        'https://example.com',
        'Example',
        'iphone',
        true,
        1700000000,
        3600
      )

      expect(mock.history[0].body).toEqual({
        token: APP_TOKEN,
        user: USER_KEY,
        message: 'Hello',
        title: 'Title',
        priority: -1,
        sound: 'siren',
        url: 'https://example.com',
        url_title: 'Example',
        device: 'iphone',
        html: 1,
        timestamp: 1700000000,
        ttl: 3600,
      })
    })

    it('omits html when disabled', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1 })

      await service.sendNotification(USER_KEY, 'Hello', undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).not.toHaveProperty('html')
    })

    it('sends retry and expire for Emergency priority and drops ttl', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 1, receipt: 'rcpt-1' })

      await service.sendNotification(
        USER_KEY,
        'Hello',
        undefined,
        'Emergency',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        3600,
        60,
        600
      )

      expect(mock.history[0].body).toMatchObject({ priority: 2, retry: 60, expire: 600 })
      expect(mock.history[0].body).not.toHaveProperty('ttl')
    })

    it('throws when Emergency priority is missing retry', async () => {
      await expect(
        service.sendNotification(USER_KEY, 'Hello', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 600)
      ).rejects.toThrow('Emergency priority requires both Retry Interval and Expire After')

      expect(mock.history).toHaveLength(0)
    })

    it('throws when Emergency priority is missing expire', async () => {
      await expect(
        service.sendNotification(USER_KEY, 'Hello', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 60)
      ).rejects.toThrow('Emergency priority requires both Retry Interval and Expire After')
    })

    it('throws when retry is below the minimum', async () => {
      await expect(
        service.sendNotification(USER_KEY, 'Hello', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10, 600)
      ).rejects.toThrow('Retry Interval must be at least 30 seconds')
    })

    it('throws when expire exceeds the maximum', async () => {
      await expect(
        service.sendNotification(USER_KEY, 'Hello', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 60, 20000)
      ).rejects.toThrow('Expire After must be at most 10800 seconds')
    })

    it('throws when the API responds with status 0 and errors', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 0, errors: ['user identifier is invalid', 'message cannot be blank'] })

      await expect(service.sendNotification(USER_KEY, 'Hello')).rejects.toThrow(
        'Pushover API error: user identifier is invalid; message cannot be blank'
      )
    })

    it('throws a generic message when status is 0 without an errors array', async () => {
      mock.onPost(`${ BASE }/messages.json`).reply({ status: 0 })

      await expect(service.sendNotification(USER_KEY, 'Hello')).rejects.toThrow('Pushover API error: Unknown error')
    })

    it('wraps HTTP errors carrying an errors array', async () => {
      mock.onPost(`${ BASE }/messages.json`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { errors: ['application token is invalid'] },
      })

      await expect(service.sendNotification(USER_KEY, 'Hello')).rejects.toThrow('Pushover API error: application token is invalid')
    })

    it('falls back to body.message on HTTP errors', async () => {
      mock.onPost(`${ BASE }/messages.json`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'rate limited' },
      })

      await expect(service.sendNotification(USER_KEY, 'Hello')).rejects.toThrow('Pushover API error: rate limited')
    })

    it('falls back to error.message when no body is present', async () => {
      mock.onPost(`${ BASE }/messages.json`).replyWithError({ message: 'Network timeout' })

      await expect(service.sendNotification(USER_KEY, 'Hello')).rejects.toThrow('Pushover API error: Network timeout')
    })
  })

  // ── Validate ──

  describe('validateUser', () => {
    it('posts the user key', async () => {
      mock.onPost(`${ BASE }/users/validate.json`).reply({ status: 1, devices: ['iphone'] })

      const result = await service.validateUser(USER_KEY)

      expect(result).toMatchObject({ status: 1 })
      expect(mock.history[0].body).toEqual({ token: APP_TOKEN, user: USER_KEY })
    })

    it('includes the device when provided', async () => {
      mock.onPost(`${ BASE }/users/validate.json`).reply({ status: 1 })

      await service.validateUser(USER_KEY, 'iphone')

      expect(mock.history[0].body).toEqual({ token: APP_TOKEN, user: USER_KEY, device: 'iphone' })
    })

    it('throws when the user is invalid', async () => {
      mock.onPost(`${ BASE }/users/validate.json`).reply({ status: 0, errors: ['user key is invalid'] })

      await expect(service.validateUser('bad')).rejects.toThrow('Pushover API error: user key is invalid')
    })
  })

  // ── Receipts ──

  describe('getReceipt', () => {
    it('sends a GET with the token in the query string', async () => {
      mock.onGet(`${ BASE }/receipts/rcpt-1.json`).reply({ status: 1, acknowledged: 1 })

      const result = await service.getReceipt('rcpt-1')

      expect(result).toMatchObject({ acknowledged: 1 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ token: APP_TOKEN })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('url-encodes the receipt id', async () => {
      mock.onGet(`${ BASE }/receipts/a%2Fb.json`).reply({ status: 1 })

      await service.getReceipt('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/receipts/a%2Fb.json`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/receipts/rcpt-1.json`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getReceipt('rcpt-1')).rejects.toThrow('Pushover API error: Not Found')
    })
  })

  describe('cancelEmergencyRetry', () => {
    it('posts the token to the cancel endpoint', async () => {
      mock.onPost(`${ BASE }/receipts/rcpt-1/cancel.json`).reply({ status: 1, request: 'req-9' })

      const result = await service.cancelEmergencyRetry('rcpt-1')

      expect(result).toMatchObject({ status: 1 })
      expect(mock.history[0].body).toEqual({ token: APP_TOKEN })
    })

    it('throws when the receipt is unknown', async () => {
      mock.onPost(`${ BASE }/receipts/rcpt-1/cancel.json`).reply({ status: 0, errors: ['receipt not found'] })

      await expect(service.cancelEmergencyRetry('rcpt-1')).rejects.toThrow('Pushover API error: receipt not found')
    })
  })

  // ── Account ──

  describe('getSounds', () => {
    it('sends a GET with the token in the query string', async () => {
      mock.onGet(`${ BASE }/sounds.json`).reply({ status: 1, sounds: { pushover: 'Pushover (default)' } })

      const result = await service.getSounds()

      expect(result).toHaveProperty('sounds')
      expect(mock.history[0].query).toEqual({ token: APP_TOKEN })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/sounds.json`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getSounds()).rejects.toThrow('Pushover API error: Unauthorized')
    })
  })

  describe('getLimits', () => {
    it('sends a GET with the token in the query string', async () => {
      mock.onGet(`${ BASE }/apps/limits.json`).reply({ status: 1, limit: 10000, remaining: 7496 })

      const result = await service.getLimits()

      expect(result).toMatchObject({ limit: 10000, remaining: 7496 })
      expect(mock.history[0].url).toBe(`${ BASE }/apps/limits.json`)
      expect(mock.history[0].query).toEqual({ token: APP_TOKEN })
    })

    it('throws when the API reports status 0', async () => {
      mock.onGet(`${ BASE }/apps/limits.json`).reply({ status: 0, errors: ['application token is invalid'] })

      await expect(service.getLimits()).rejects.toThrow('Pushover API error: application token is invalid')
    })
  })
})
