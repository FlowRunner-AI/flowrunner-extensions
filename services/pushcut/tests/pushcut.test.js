'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.pushcut.io/v1'

describe('Pushcut Service', () => {
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
    it('registers the apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Notifications ──

  describe('sendNotification', () => {
    it('sends a POST with auth headers and an empty body by default', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).reply({ message: 'Notification request received.' })

      const result = await service.sendNotification('Reminder')

      expect(result).toEqual({ message: 'Notification request received.' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].headers).toMatchObject({
        'API-Key': API_KEY,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toEqual({})
    })

    it('url-encodes the notification name', async () => {
      mock.onPost(`${ BASE }/notifications/My%20Alert%2F1`).reply({ message: 'ok' })

      await service.sendNotification('My Alert/1')

      expect(mock.history[0].url).toBe(`${ BASE }/notifications/My%20Alert%2F1`)
    })

    it('includes all provided options in the body', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).reply({ message: 'ok' })

      await service.sendNotification(
        'Reminder',
        'Title',
        'Body text',
        'input value',
        'https://example.com',
        [{ name: 'Open', url: 'https://example.com', shortcut: undefined }],
        'lasers',
        'image-name',
        'base64data',
        ['iPhone', 'iPad'],
        true,
        'thread-1'
      )

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        text: 'Body text',
        input: 'input value',
        defaultAction: 'https://example.com',
        actions: [{ name: 'Open', url: 'https://example.com' }],
        sound: 'lasers',
        image: 'image-name',
        imageData: 'base64data',
        devices: ['iPhone', 'iPad'],
        isTimeSensitive: true,
        threadId: 'thread-1',
      })
    })

    it('omits empty actions and devices arrays', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).reply({ message: 'ok' })

      await service.sendNotification('Reminder', 'Title', undefined, undefined, undefined, [], undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ title: 'Title' })
    })

    it('omits empty-string values', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).reply({ message: 'ok' })

      await service.sendNotification('Reminder', '', 'text')

      expect(mock.history[0].body).toEqual({ text: 'text' })
    })

    it('throws when the notification name is missing', async () => {
      await expect(service.sendNotification()).rejects.toThrow('notificationName is required')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors with status and body error', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: 'Unknown notification' },
      })

      await expect(service.sendNotification('Reminder')).rejects.toThrow('Pushcut API error (400): Unknown notification')
    })

    it('falls back to body.message when body.error is absent', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).replyWithError({
        message: 'Bad Request',
        statusCode: 401,
        body: { message: 'Invalid API key' },
      })

      await expect(service.sendNotification('Reminder')).rejects.toThrow('Pushcut API error (401): Invalid API key')
    })

    it('falls back to error.message and omits status when neither is present', async () => {
      mock.onPost(`${ BASE }/notifications/Reminder`).replyWithError({ message: 'Network timeout' })

      await expect(service.sendNotification('Reminder')).rejects.toThrow('Pushcut API error: Network timeout')
    })
  })

  describe('listNotifications', () => {
    it('sends a GET and returns the list', async () => {
      mock.onGet(`${ BASE }/notifications`).reply([{ id: 'Reminder', title: 'Reminder' }])

      const result = await service.listNotifications()

      expect(result).toEqual([{ id: 'Reminder', title: 'Reminder' }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/notifications`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/notifications`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listNotifications()).rejects.toThrow('Pushcut API error (401): Unauthorized')
    })
  })

  // ── Execute ──

  describe('executeAction', () => {
    it('sends a shortcut execution', async () => {
      mock.onPost(`${ BASE }/execute`).reply({ message: 'Execute request received.' })

      const result = await service.executeAction('My Shortcut')

      expect(result).toEqual({ message: 'Execute request received.' })
      expect(mock.history[0].body).toEqual({ shortcut: 'My Shortcut' })
    })

    it('sends a homekit scene execution', async () => {
      mock.onPost(`${ BASE }/execute`).reply({ message: 'ok' })

      await service.executeAction(undefined, 'Good Night')

      expect(mock.history[0].body).toEqual({ homekit: 'Good Night' })
    })

    it('sends an automation execution with all options', async () => {
      mock.onPost(`${ BASE }/execute`).reply({ message: 'ok' })

      await service.executeAction(undefined, undefined, 'My Automation', 'input', '5m', 'id-1', ['iPhone'])

      expect(mock.history[0].body).toEqual({
        automation: 'My Automation',
        input: 'input',
        delay: '5m',
        identifier: 'id-1',
        devices: ['iPhone'],
      })
    })

    it('omits an empty devices array', async () => {
      mock.onPost(`${ BASE }/execute`).reply({ message: 'ok' })

      await service.executeAction('S', undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ shortcut: 'S' })
    })

    it('throws when no target is provided', async () => {
      await expect(service.executeAction()).rejects.toThrow('provide one of shortcut, homekit, or automation')
      expect(mock.history).toHaveLength(0)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/execute`).replyWithError({ message: 'Server Error', status: 500 })

      await expect(service.executeAction('S')).rejects.toThrow('Pushcut API error (500): Server Error')
    })
  })

  // ── Devices ──

  describe('listDevices', () => {
    it('sends a GET and returns the devices', async () => {
      mock.onGet(`${ BASE }/devices`).reply([{ id: 'iPhone', name: 'iPhone' }])

      const result = await service.listDevices()

      expect(result).toEqual([{ id: 'iPhone', name: 'iPhone' }])
      expect(mock.history[0].url).toBe(`${ BASE }/devices`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/devices`).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(service.listDevices()).rejects.toThrow('Pushcut API error (403): Forbidden')
    })
  })

  // ── Subscriptions ──

  describe('listSubscriptions', () => {
    it('sends a GET and returns the subscriptions', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply([{ id: 'abc123', actionName: 'My Action', url: 'https://example.com/hook' }])

      const result = await service.listSubscriptions()

      expect(result).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/subscriptions`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listSubscriptions()).rejects.toThrow('Pushcut API error (401): Unauthorized')
    })
  })

  describe('addSubscription', () => {
    it('sends a POST with actionName and url', async () => {
      mock.onPost(`${ BASE }/subscriptions`).reply({ id: 'abc123' })

      const result = await service.addSubscription('My Action', 'https://example.com/hook')

      expect(result).toEqual({ id: 'abc123' })
      expect(mock.history[0].body).toEqual({ actionName: 'My Action', url: 'https://example.com/hook' })
    })

    it('throws when actionName is missing', async () => {
      await expect(service.addSubscription(undefined, 'https://example.com/hook')).rejects.toThrow('actionName and url are required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when url is missing', async () => {
      await expect(service.addSubscription('My Action')).rejects.toThrow('actionName and url are required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/subscriptions`).replyWithError({ message: 'Conflict', status: 409 })

      await expect(service.addSubscription('A', 'https://example.com')).rejects.toThrow('Pushcut API error (409): Conflict')
    })
  })

  describe('removeSubscription', () => {
    it('sends a DELETE to the encoded subscription url', async () => {
      mock.onDelete(`${ BASE }/subscriptions/abc%2F123`).reply({ message: 'Subscription removed.' })

      const result = await service.removeSubscription('abc/123')

      expect(result).toEqual({ message: 'Subscription removed.' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws when subscriptionId is missing', async () => {
      await expect(service.removeSubscription()).rejects.toThrow('subscriptionId is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/subscriptions/abc123`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.removeSubscription('abc123')).rejects.toThrow('Pushcut API error (404): Not Found')
    })
  })

  // ── Dictionaries ──

  describe('getNotificationsDictionary', () => {
    it('maps notifications to dictionary items', async () => {
      mock.onGet(`${ BASE }/notifications`).reply([{ id: 'Reminder' }, { title: 'Backup Done' }])

      const result = await service.getNotificationsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Reminder', value: 'Reminder', note: 'Pushcut notification' },
          { label: 'Backup Done', value: 'Backup Done', note: 'Pushcut notification' },
        ],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/notifications`).reply([{ id: 'Reminder' }])

      const result = await service.getNotificationsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('filters case-insensitively by search', async () => {
      mock.onGet(`${ BASE }/notifications`).reply([{ id: 'Reminder' }, { id: 'Backup' }])

      const result = await service.getNotificationsDictionary({ search: 'BACK' })

      expect(result.items).toEqual([{ label: 'Backup', value: 'Backup', note: 'Pushcut notification' }])
    })

    it('skips entries without a name', async () => {
      mock.onGet(`${ BASE }/notifications`).reply([{ id: 'Reminder' }, { foo: 'bar' }])

      const result = await service.getNotificationsDictionary({})

      expect(result.items).toHaveLength(1)
    })

    it('returns an empty list for a non-array response', async () => {
      mock.onGet(`${ BASE }/notifications`).reply({ message: 'nope' })

      const result = await service.getNotificationsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/notifications`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getNotificationsDictionary({})).rejects.toThrow('Pushcut API error (401): Unauthorized')
    })
  })

  describe('getDevicesDictionary', () => {
    it('maps devices to dictionary items preferring the name', async () => {
      mock.onGet(`${ BASE }/devices`).reply([{ id: 'dev-1', name: 'iPhone' }, { id: 'iPad' }])

      const result = await service.getDevicesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'iPhone', value: 'iPhone', note: 'Pushcut device' },
          { label: 'iPad', value: 'iPad', note: 'Pushcut device' },
        ],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/devices`).reply([{ name: 'iPhone' }])

      const result = await service.getDevicesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('filters case-insensitively by search', async () => {
      mock.onGet(`${ BASE }/devices`).reply([{ name: 'iPhone' }, { name: 'MacBook' }])

      const result = await service.getDevicesDictionary({ search: 'macb' })

      expect(result.items).toEqual([{ label: 'MacBook', value: 'MacBook', note: 'Pushcut device' }])
    })

    it('skips entries without a name', async () => {
      mock.onGet(`${ BASE }/devices`).reply([{ name: 'iPhone' }, {}])

      const result = await service.getDevicesDictionary({})

      expect(result.items).toHaveLength(1)
    })

    it('returns an empty list for a non-array response', async () => {
      mock.onGet(`${ BASE }/devices`).reply(null)

      const result = await service.getDevicesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/devices`).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(service.getDevicesDictionary({})).rejects.toThrow('Pushcut API error (403): Forbidden')
    })
  })
})
