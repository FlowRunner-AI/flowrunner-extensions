'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.pushbullet.com/v2'

const AUTH_HEADERS = {
  'Access-Token': ACCESS_TOKEN,
  'Content-Type': 'application/json',
}

describe('Pushbullet Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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

      expect(configItems.map(item => item.name)).toEqual(['accessToken'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'accessToken',
            displayName: 'Access Token',
            type: 'STRING',
            required: true,
            shared: false,
          }),
        ])
      )

      expect(configItems[0].hint).toEqual(expect.any(String))
    })

    it('stores the access token on the instance', () => {
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })
  })

  // ── Pushes ──

  describe('pushNote', () => {
    it('sends a note push with only the required fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'p1', type: 'note' })

      const result = await service.pushNote('Title', 'Body')

      expect(result).toEqual({ iden: 'p1', type: 'note' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/pushes`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({ type: 'note', title: 'Title', body: 'Body' })
    })

    it('includes all targeting fields when provided', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'p2' })

      await service.pushNote('T', 'B', 'dev1', 'user@example.com', 'my-channel')

      expect(mock.history[0].body).toEqual({
        type: 'note',
        title: 'T',
        body: 'B',
        device_iden: 'dev1',
        email: 'user@example.com',
        channel_tag: 'my-channel',
      })
    })

    it('strips empty and null targeting fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'p3' })

      await service.pushNote('T', undefined, '', null)

      expect(mock.history[0].body).toEqual({ type: 'note', title: 'T' })
    })

    it('throws a descriptive error when the API responds with an error payload', async () => {
      mock.onPost(`${ BASE }/pushes`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: { message: 'The param device_iden is invalid', type: 'invalid_request' } },
      })

      await expect(service.pushNote('T')).rejects.toThrow(
        'Pushbullet API error [400] (invalid_request): The param device_iden is invalid'
      )
    })

    it('falls back to the transport error message when no body is present', async () => {
      mock.onPost(`${ BASE }/pushes`).replyWithError({ message: 'Network timeout' })

      await expect(service.pushNote('T')).rejects.toThrow('Pushbullet API error: Network timeout')
    })

    it('falls back to body.message when there is no error object', async () => {
      mock.onPost(`${ BASE }/pushes`).replyWithError({
        message: 'ignored',
        statusCode: 500,
        body: { message: 'Internal failure' },
      })

      await expect(service.pushNote('T')).rejects.toThrow('Pushbullet API error [500]: Internal failure')
    })
  })

  describe('pushLink', () => {
    it('sends a link push with the required fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'l1', type: 'link' })

      const result = await service.pushLink('Docs', 'https://example.com')

      expect(result).toEqual({ iden: 'l1', type: 'link' })
      expect(mock.history[0].body).toEqual({ type: 'link', title: 'Docs', url: 'https://example.com' })
    })

    it('sends optional body and targeting fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'l2' })

      await service.pushLink('Docs', 'https://example.com', 'Read this', 'dev1', 'u@e.com', 'tag')

      expect(mock.history[0].body).toEqual({
        type: 'link',
        title: 'Docs',
        url: 'https://example.com',
        body: 'Read this',
        device_iden: 'dev1',
        email: 'u@e.com',
        channel_tag: 'tag',
      })
    })
  })

  describe('pushFileFromUrl', () => {
    it('sends a file push with the required fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'f1', type: 'file' })

      const result = await service.pushFileFromUrl(
        'https://cdn.example.com/report.pdf',
        'report.pdf',
        'application/pdf'
      )

      expect(result).toEqual({ iden: 'f1', type: 'file' })

      expect(mock.history[0].body).toEqual({
        type: 'file',
        file_url: 'https://cdn.example.com/report.pdf',
        file_name: 'report.pdf',
        file_type: 'application/pdf',
      })
    })

    it('sends optional body and targeting fields', async () => {
      mock.onPost(`${ BASE }/pushes`).reply({ iden: 'f2' })

      await service.pushFileFromUrl('u', 'n', 't', 'note', 'dev1', 'u@e.com', 'tag')

      expect(mock.history[0].body).toEqual({
        type: 'file',
        file_url: 'u',
        file_name: 'n',
        file_type: 't',
        body: 'note',
        device_iden: 'dev1',
        email: 'u@e.com',
        channel_tag: 'tag',
      })
    })
  })

  describe('listPushes', () => {
    it('applies the default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({ pushes: [], cursor: null })

      const result = await service.listPushes()

      expect(result).toEqual({ pushes: [], cursor: null })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ limit: 50 })
    })

    it('passes modified_after, active and cursor', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({ pushes: [{ iden: 'p1' }], cursor: 'next' })

      const result = await service.listPushes(1720000000, true, 10, 'abc')

      expect(result.cursor).toBe('next')

      expect(mock.history[0].query).toEqual({
        modified_after: 1720000000,
        active: 'true',
        limit: 10,
        cursor: 'abc',
      })
    })

    it('omits the active flag when it is not exactly true', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({ pushes: [] })

      await service.listPushes(undefined, false)

      expect(mock.history[0].query).toEqual({ limit: 50 })
    })
  })

  describe('getPush', () => {
    it('returns the matching push from the list', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({ pushes: [{ iden: 'a' }, { iden: 'b' }] })

      const result = await service.getPush('b')

      expect(result).toEqual({ iden: 'b' })
      expect(mock.history[0].query).toEqual({ limit: 500 })
    })

    it('returns null when no push matches', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({ pushes: [{ iden: 'a' }] })

      await expect(service.getPush('zzz')).resolves.toBeNull()
    })

    it('returns null when the response has no pushes', async () => {
      mock.onGet(`${ BASE }/pushes`).reply({})

      await expect(service.getPush('a')).resolves.toBeNull()
    })
  })

  describe('dismissPush', () => {
    it('posts dismissed=true to the push resource', async () => {
      mock.onPost(`${ BASE }/pushes/p1`).reply({ iden: 'p1', dismissed: true })

      const result = await service.dismissPush('p1')

      expect(result).toEqual({ iden: 'p1', dismissed: true })
      expect(mock.history[0].url).toBe(`${ BASE }/pushes/p1`)
      expect(mock.history[0].body).toEqual({ dismissed: true })
    })
  })

  describe('deletePush', () => {
    it('sends a DELETE to the push resource', async () => {
      mock.onDelete(`${ BASE }/pushes/p1`).reply({})

      const result = await service.deletePush('p1')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws when the push does not exist', async () => {
      mock.onDelete(`${ BASE }/pushes/missing`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: { message: 'Object not found' } },
      })

      await expect(service.deletePush('missing')).rejects.toThrow(
        'Pushbullet API error [404]: Object not found'
      )
    })
  })

  describe('deleteAllPushes', () => {
    it('sends a DELETE to the pushes collection', async () => {
      mock.onDelete(`${ BASE }/pushes`).reply({})

      const result = await service.deleteAllPushes()

      expect(result).toEqual({})
      expect(mock.history[0].url).toBe(`${ BASE }/pushes`)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Devices ──

  describe('listDevices', () => {
    it('returns the devices payload', async () => {
      mock.onGet(`${ BASE }/devices`).reply({ devices: [{ iden: 'd1', nickname: 'Pixel' }] })

      const result = await service.listDevices()

      expect(result.devices).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/devices`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  describe('createDevice', () => {
    it('maps the icon label to its API value', async () => {
      mock.onPost(`${ BASE }/devices`).reply({ iden: 'd1' })

      await service.createDevice('Server Alerts', 'Desktop', 'FlowRunner', 'Acme')

      expect(mock.history[0].body).toEqual({
        nickname: 'Server Alerts',
        icon: 'desktop',
        model: 'FlowRunner',
        manufacturer: 'Acme',
      })
    })

    it('defaults the icon to system when not provided', async () => {
      mock.onPost(`${ BASE }/devices`).reply({ iden: 'd2' })

      await service.createDevice('Alerts')

      expect(mock.history[0].body).toEqual({ nickname: 'Alerts', icon: 'system' })
    })

    it('passes through an unknown icon value untouched', async () => {
      mock.onPost(`${ BASE }/devices`).reply({ iden: 'd3' })

      await service.createDevice('Alerts', 'custom-icon')

      expect(mock.history[0].body).toMatchObject({ icon: 'custom-icon' })
    })
  })

  describe('deleteDevice', () => {
    it('sends a DELETE to the device resource', async () => {
      mock.onDelete(`${ BASE }/devices/d1`).reply({})

      const result = await service.deleteDevice('d1')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Chats & account ──

  describe('listChats', () => {
    it('returns the chats payload', async () => {
      mock.onGet(`${ BASE }/chats`).reply({ chats: [{ iden: 'c1' }] })

      const result = await service.listChats()

      expect(result.chats).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/chats`)
    })
  })

  describe('getUserInfo', () => {
    it('returns the authenticated user profile', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ iden: 'u1', email: 'me@example.com' })

      const result = await service.getUserInfo()

      expect(result).toEqual({ iden: 'u1', email: 'me@example.com' })
    })

    it('throws when the token is invalid', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { message: 'Access token is missing or invalid', type: 'invalid_request' } },
      })

      await expect(service.getUserInfo()).rejects.toThrow('Pushbullet API error [401] (invalid_request)')
    })
  })

  // ── SMS ──

  describe('sendSms', () => {
    it('sends the SMS payload wrapped in data', async () => {
      mock.onPost(`${ BASE }/texts`).reply({ iden: 't1' })

      const result = await service.sendSms('d1', ['+15551234567'], 'Hello')

      expect(result).toEqual({ iden: 't1' })
      expect(mock.history[0].url).toBe(`${ BASE }/texts`)

      expect(mock.history[0].body).toEqual({
        data: {
          target_device_iden: 'd1',
          addresses: ['+15551234567'],
          message: 'Hello',
          status: 'queued',
        },
      })
    })

    it('wraps a single string address into an array', async () => {
      mock.onPost(`${ BASE }/texts`).reply({ iden: 't2' })

      await service.sendSms('d1', '+15551234567', 'Hi')

      expect(mock.history[0].body.data.addresses).toEqual(['+15551234567'])
    })

    it('drops a falsy single address', async () => {
      mock.onPost(`${ BASE }/texts`).reply({ iden: 't3' })

      await service.sendSms('d1', null, 'Hi')

      expect(mock.history[0].body.data.addresses).toEqual([])
    })
  })

  // ── Dictionaries ──

  describe('getDevicesDictionary', () => {
    it('maps devices to dictionary items with type and SMS notes', async () => {
      mock.onGet(`${ BASE }/devices`).reply({
        devices: [
          { iden: 'd1', nickname: 'Pixel 8', type: 'android', has_sms: true },
          { iden: 'd2', model: 'Chrome', type: 'chrome', has_sms: false },
        ],
      })

      const result = await service.getDevicesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Pixel 8', value: 'd1', note: 'android - SMS' },
          { label: 'Chrome', value: 'd2', note: 'chrome' },
        ],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/devices`).reply({ devices: [{ iden: 'd1', nickname: 'Pixel' }] })

      const result = await service.getDevicesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('filters out inactive devices', async () => {
      mock.onGet(`${ BASE }/devices`).reply({
        devices: [
          { iden: 'd1', nickname: 'Live', active: true },
          { iden: 'd2', nickname: 'Dead', active: false },
        ],
      })

      const result = await service.getDevicesDictionary({})

      expect(result.items.map(item => item.value)).toEqual(['d1'])
    })

    it('filters by case-insensitive search across nickname and model', async () => {
      mock.onGet(`${ BASE }/devices`).reply({
        devices: [
          { iden: 'd1', nickname: 'Pixel 8', model: 'Pixel' },
          { iden: 'd2', nickname: 'Desk', model: 'MacBook Pro' },
        ],
      })

      const result = await service.getDevicesDictionary({ search: '  MACBOOK ' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('d2')
    })

    it('falls back to the iden as the label and omits an empty note', async () => {
      mock.onGet(`${ BASE }/devices`).reply({ devices: [{ iden: 'd9' }] })

      const result = await service.getDevicesDictionary({})

      expect(result.items[0]).toEqual({ label: 'd9', value: 'd9', note: undefined })
    })

    it('returns an empty list when there are no devices', async () => {
      mock.onGet(`${ BASE }/devices`).reply({})

      const result = await service.getDevicesDictionary({ search: 'anything' })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
