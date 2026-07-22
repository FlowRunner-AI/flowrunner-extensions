'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://acme.zulipchat.com'
const EMAIL = 'bot@acme.com'
const API_KEY = 'test-api-key'
const BASE = `${ SITE_URL }/api/v1`

const AUTH_HEADER = `Basic ${ Buffer.from(`${ EMAIL }:${ API_KEY }`).toString('base64') }`

describe('Zulip Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ siteUrl: `${ SITE_URL }/`, email: EMAIL, apiKey: API_KEY })
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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['siteUrl', 'email', 'apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'siteUrl', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'email', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('strips trailing slashes from the site URL and builds the basic auth header', () => {
      expect(service.siteUrl).toBe(SITE_URL)
      expect(service.baseUrl).toBe(BASE)
      expect(service.authHeader).toBe(AUTH_HEADER)
    })
  })

  // ── Messages ──

  describe('sendMessage', () => {
    it('sends a stream message with a topic', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 42, result: 'success' })

      const result = await service.sendMessage('Stream', 'general', 'announcements', 'Hello')

      expect(result).toEqual({ id: 42, result: 'success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(mock.history[0].body).toEqual({
        type: 'stream',
        to: 'general',
        topic: 'announcements',
        content: 'Hello',
      })
    })

    it('parses a JSON recipient array for direct messages and drops the topic', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 43, result: 'success' })

      await service.sendMessage('Direct', '["user@example.com", "other@example.com"]', 'ignored', 'Hi')

      expect(mock.history[0].body).toEqual({
        type: 'direct',
        to: '["user@example.com","other@example.com"]',
        content: 'Hi',
      })
    })

    it('keeps a plain string recipient for direct messages', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 44, result: 'success' })

      await service.sendMessage('Direct', 'user@example.com', undefined, 'Hi')

      expect(mock.history[0].body).toEqual({ type: 'direct', to: 'user@example.com', content: 'Hi' })
    })

    it('serializes an array recipient list', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 45, result: 'success' })

      await service.sendMessage('Direct', [9, 10], undefined, 'Hi')

      expect(mock.history[0].body.to).toBe('[9,10]')
    })

    it('passes unmapped type values through unchanged', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 46, result: 'success' })

      await service.sendMessage('stream', 'general', 'topic', 'Hello')

      expect(mock.history[0].body.type).toBe('stream')
      expect(mock.history[0].body.topic).toBe('topic')
    })

    it('throws a descriptive error for a malformed recipient array', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ result: 'success' })

      await expect(service.sendMessage('Direct', '[not json', undefined, 'Hi'))
        .rejects.toThrow(/Zulip API error: Recipients must be a valid JSON array/)

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getMessages', () => {
    it('applies anchor and paging defaults', async () => {
      mock.onGet(`${ BASE }/messages`).reply({ result: 'success', messages: [] })

      const result = await service.getMessages()

      expect(result).toEqual({ result: 'success', messages: [] })
      expect(mock.history[0].query).toEqual({ anchor: 'newest', num_before: 50, num_after: 0 })
    })

    it('serializes the narrow filter and honors explicit zeros', async () => {
      mock.onGet(`${ BASE }/messages`).reply({ result: 'success', messages: [] })

      await service.getMessages('42', 0, 10, [{ operator: 'stream', operand: 'general' }])

      expect(mock.history[0].query).toEqual({
        anchor: '42',
        num_before: 0,
        num_after: 10,
        narrow: '[{"operator":"stream","operand":"general"}]',
      })
    })

    it('drops an empty narrow array', async () => {
      mock.onGet(`${ BASE }/messages`).reply({ result: 'success', messages: [] })

      await service.getMessages('oldest', 5, 5, [])

      expect(mock.history[0].query).toEqual({ anchor: 'oldest', num_before: 5, num_after: 5 })
    })
  })

  describe('updateMessage', () => {
    it('sends PATCH with the fields provided', async () => {
      mock.onPatch(`${ BASE }/messages/42`).reply({ result: 'success', msg: '' })

      const result = await service.updateMessage(42, 'New content', 'new-topic')

      expect(result).toEqual({ result: 'success', msg: '' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/messages/42`)
      expect(mock.history[0].body).toEqual({ content: 'New content', topic: 'new-topic' })
    })

    it('drops empty fields', async () => {
      mock.onPatch(`${ BASE }/messages/42`).reply({ result: 'success' })

      await service.updateMessage(42, 'Only content', '')

      expect(mock.history[0].body).toEqual({ content: 'Only content' })
    })
  })

  describe('deleteMessage', () => {
    it('sends DELETE to the message URL', async () => {
      mock.onDelete(`${ BASE }/messages/42`).reply({ result: 'success' })

      const result = await service.deleteMessage(42)

      expect(result).toEqual({ result: 'success' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('addReaction', () => {
    it('posts the emoji name', async () => {
      mock.onPost(`${ BASE }/messages/42/reactions`).reply({ result: 'success' })

      await service.addReaction(42, 'thumbs_up')

      expect(mock.history[0].body).toEqual({ emoji_name: 'thumbs_up' })
    })
  })

  describe('removeReaction', () => {
    it('sends DELETE with the emoji name', async () => {
      mock.onDelete(`${ BASE }/messages/42/reactions`).reply({ result: 'success' })

      await service.removeReaction(42, 'heart')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({ emoji_name: 'heart' })
    })
  })

  describe('getMessageReadReceipts', () => {
    it('sends GET to the read receipts URL', async () => {
      mock.onGet(`${ BASE }/messages/42/read_receipts`).reply({ result: 'success', user_ids: [9, 10] })

      const result = await service.getMessageReadReceipts(42)

      expect(result).toEqual({ result: 'success', user_ids: [9, 10] })
    })
  })

  // ── Upload ──

  describe('uploadFile', () => {
    const SOURCE_URL = 'https://cdn.example.com/files/report.pdf?v=2'

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads the source, uploads to Zulip and stores a FlowRunner copy', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/report.pdf' })

      service.flowrunner = { Files: { uploadFile } }

      mock.onGet(SOURCE_URL).reply(Buffer.from('pdf-bytes'))

      mock.onPost(`${ BASE }/user_uploads`).reply({
        result: 'success',
        url: '/user_uploads/1/ab/report.pdf',
        filename: 'report.pdf',
      })

      const result = await service.uploadFile(SOURCE_URL)

      expect(result).toEqual({
        zulipUrl: '/user_uploads/1/ab/report.pdf',
        zulipHost: SITE_URL,
        url: 'https://files.flowrunner.io/report.pdf',
        filename: 'report.pdf',
        result: 'success',
      })

      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].headers).toMatchObject({ Authorization: AUTH_HEADER })

      expect(mock.history[1].formData._fields).toEqual([
        { name: 'filename', value: expect.any(Buffer), filename: 'report.pdf' },
      ])

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'report.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
    })

    it('uses the provided file name, file options and the legacy uri field', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/custom.pdf' })

      service.flowrunner = { Files: { uploadFile } }

      mock.onGet(SOURCE_URL).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ BASE }/user_uploads`).reply({ uri: '/user_uploads/legacy.pdf' })

      const result = await service.uploadFile(SOURCE_URL, 'custom.pdf', { scope: 'APP' })

      expect(result.zulipUrl).toBe('/user_uploads/legacy.pdf')
      expect(result.filename).toBe('custom.pdf')
      expect(result.result).toBe('success')

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'custom.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })
    })

    it('throws when Zulip rejects the upload', async () => {
      service.flowrunner = { Files: { uploadFile: jest.fn() } }

      mock.onGet(SOURCE_URL).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ BASE }/user_uploads`).reply({ result: 'error', msg: 'File too large' })

      await expect(service.uploadFile(SOURCE_URL)).rejects.toThrow('Zulip API error: File too large')
    })

    it('wraps a source download failure', async () => {
      mock.onGet(SOURCE_URL).replyWithError({ message: 'ENOTFOUND' })

      await expect(service.uploadFile(SOURCE_URL)).rejects.toThrow('Zulip API error: ENOTFOUND')
    })
  })

  // ── Streams ──

  describe('getStreams', () => {
    it('defaults both include flags to true', async () => {
      mock.onGet(`${ BASE }/streams`).reply({ result: 'success', streams: [] })

      const result = await service.getStreams()

      expect(result).toEqual({ result: 'success', streams: [] })
      expect(mock.history[0].query).toEqual({ include_public: true, include_subscribed: true })
    })

    it('passes explicit false flags', async () => {
      mock.onGet(`${ BASE }/streams`).reply({ result: 'success', streams: [] })

      await service.getStreams(false, false)

      expect(mock.history[0].query).toEqual({ include_public: false, include_subscribed: false })
    })
  })

  describe('getStreamId', () => {
    it('sends the stream name as a query param', async () => {
      mock.onGet(`${ BASE }/get_stream_id`).reply({ result: 'success', stream_id: 1 })

      const result = await service.getStreamId('general')

      expect(result).toEqual({ result: 'success', stream_id: 1 })
      expect(mock.history[0].query).toEqual({ stream: 'general' })
    })
  })

  describe('getStreamTopics', () => {
    it('sends GET to the topics URL for the stream id', async () => {
      mock.onGet(`${ BASE }/users/me/1/topics`).reply({ result: 'success', topics: [] })

      const result = await service.getStreamTopics(1)

      expect(result).toEqual({ result: 'success', topics: [] })
    })
  })

  describe('subscribeToStreams', () => {
    it('serializes the subscription list', async () => {
      mock.onPost(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.subscribeToStreams(['general', 'random'])

      expect(mock.history[0].body).toEqual({ subscriptions: '[{"name":"general"},{"name":"random"}]' })
    })

    it('applies the description to every subscription', async () => {
      mock.onPost(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.subscribeToStreams(['general'], 'Everyone')

      expect(JSON.parse(mock.history[0].body.subscriptions)).toEqual([{ name: 'general', description: 'Everyone' }])
    })

    it('handles a missing stream list', async () => {
      mock.onPost(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.subscribeToStreams()

      expect(mock.history[0].body).toEqual({ subscriptions: '[]' })
    })
  })

  describe('createStream', () => {
    it('creates a public stream without a description', async () => {
      mock.onPost(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.createStream('new-stream')

      expect(mock.history[0].body).toEqual({ subscriptions: '[{"name":"new-stream"}]' })
    })

    it('creates a private stream with a description', async () => {
      mock.onPost(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.createStream('secret', 'Hush', true)

      expect(mock.history[0].body).toEqual({
        subscriptions: '[{"name":"secret","description":"Hush"}]',
        invite_only: true,
      })
    })
  })

  describe('unsubscribeFromStreams', () => {
    it('sends DELETE with the serialized stream names', async () => {
      mock.onDelete(`${ BASE }/users/me/subscriptions`).reply({ result: 'success', removed: ['general'] })

      const result = await service.unsubscribeFromStreams(['general'])

      expect(result).toEqual({ result: 'success', removed: ['general'] })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({ subscriptions: '["general"]' })
    })

    it('handles a missing stream list', async () => {
      mock.onDelete(`${ BASE }/users/me/subscriptions`).reply({ result: 'success' })

      await service.unsubscribeFromStreams()

      expect(mock.history[0].body).toEqual({ subscriptions: '[]' })
    })
  })

  // ── Users ──

  describe('getUsers', () => {
    it('omits the custom fields flag when not provided', async () => {
      mock.onGet(`${ BASE }/users`).reply({ result: 'success', members: [] })

      const result = await service.getUsers()

      expect(result).toEqual({ result: 'success', members: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('sends the custom fields flag when provided', async () => {
      mock.onGet(`${ BASE }/users`).reply({ result: 'success', members: [] })

      await service.getUsers(true)

      expect(mock.history[0].query).toEqual({ include_custom_profile_fields: true })
    })
  })

  describe('getUser', () => {
    it('sends GET to the user URL', async () => {
      mock.onGet(`${ BASE }/users/9`).reply({ result: 'success', user: { user_id: 9 } })

      const result = await service.getUser(9)

      expect(result).toEqual({ result: 'success', user: { user_id: 9 } })
    })
  })

  describe('getOwnUser', () => {
    it('sends GET to /users/me', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ result: 'success', user_id: 9, is_bot: true })

      const result = await service.getOwnUser()

      expect(result).toMatchObject({ result: 'success', user_id: 9 })
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })
  })

  describe('createUser', () => {
    it('posts the new user fields', async () => {
      mock.onPost(`${ BASE }/users`).reply({ result: 'success', user_id: 25 })

      const result = await service.createUser('new@acme.com', 'secret', 'New User')

      expect(result).toEqual({ result: 'success', user_id: 25 })

      expect(mock.history[0].body).toEqual({
        email: 'new@acme.com',
        password: 'secret',
        full_name: 'New User',
      })
    })
  })

  describe('updateUser', () => {
    it('maps the role label to its numeric value', async () => {
      mock.onPatch(`${ BASE }/users/9`).reply({ result: 'success' })

      await service.updateUser(9, 'Renamed', 'Administrator')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ full_name: 'Renamed', role: 200 })
    })

    it('maps every role label', async () => {
      mock.onPatch(`${ BASE }/users/9`).reply({ result: 'success' })

      const cases = [['Owner', 100], ['Moderator', 300], ['Member', 400], ['Guest', 600]]

      for (const [label] of cases) {
        await service.updateUser(9, undefined, label)
      }

      cases.forEach(([, expected], index) => {
        expect(mock.history[index].body).toEqual({ role: expected })
      })
    })

    it('sends only the name when no role is given', async () => {
      mock.onPatch(`${ BASE }/users/9`).reply({ result: 'success' })

      await service.updateUser(9, 'Renamed')

      expect(mock.history[0].body).toEqual({ full_name: 'Renamed' })
    })
  })

  describe('deactivateUser', () => {
    it('sends DELETE to the user URL', async () => {
      mock.onDelete(`${ BASE }/users/9`).reply({ result: 'success' })

      const result = await service.deactivateUser(9)

      expect(result).toEqual({ result: 'success' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Events ──

  describe('registerEventQueue', () => {
    it('serializes the event type list', async () => {
      mock.onPost(`${ BASE }/register`).reply({ result: 'success', queue_id: '1:0' })

      const result = await service.registerEventQueue(['message', 'reaction'])

      expect(result).toEqual({ result: 'success', queue_id: '1:0' })
      expect(mock.history[0].body).toEqual({ event_types: '["message","reaction"]' })
    })

    it('omits the event types when the list is empty or missing', async () => {
      mock.onPost(`${ BASE }/register`).reply({ result: 'success' })

      await service.registerEventQueue([])
      await service.registerEventQueue()

      expect(mock.history[0].body).toEqual({})
      expect(mock.history[1].body).toEqual({})
    })
  })

  // ── Dictionary ──

  describe('getStreamsDictionary', () => {
    it('maps streams to label/value/note', async () => {
      mock.onGet(`${ BASE }/streams`).reply({
        result: 'success',
        streams: [{ stream_id: 1, name: 'general' }, { stream_id: 2, name: 'random' }],
      })

      const result = await service.getStreamsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'general', value: 'general', note: 'ID: 1' },
          { label: 'random', value: 'random', note: 'ID: 2' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/streams`).reply({
        result: 'success',
        streams: [{ stream_id: 1, name: 'general' }, { stream_id: 2, name: 'random' }],
      })

      const result = await service.getStreamsDictionary({ search: 'RAND' })

      expect(result.items).toEqual([{ label: 'random', value: 'random', note: 'ID: 2' }])
    })

    it('handles a null payload and a missing streams array', async () => {
      mock.onGet(`${ BASE }/streams`).reply({ result: 'success' })

      const result = await service.getStreamsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws on an API-level error response including the code', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ result: 'error', msg: 'Invalid API key', code: 'UNAUTHORIZED' })

      await expect(service.getOwnUser()).rejects.toThrow('Zulip API error: Invalid API key (UNAUTHORIZED)')
    })

    it('falls back to a generic message when the error response has no msg', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ result: 'error' })

      await expect(service.getOwnUser()).rejects.toThrow('Zulip API error: Unknown error')
    })

    it('surfaces the transport error body message with the status', async () => {
      mock.onPost(`${ BASE }/messages`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { msg: 'Stream does not exist' },
      })

      await expect(service.sendMessage('Stream', 'nope', 'topic', 'Hi'))
        .rejects.toThrow('Zulip API error: Stream does not exist (status 400)')
    })

    it('falls back to the transport error message without a status', async () => {
      mock.onGet(`${ BASE }/streams`).replyWithError({ message: 'Network timeout' })

      await expect(service.getStreams()).rejects.toThrow('Zulip API error: Network timeout')
    })

    it('handles an empty response body', async () => {
      mock.onGet(`${ BASE }/users/me`).reply(undefined)

      await expect(service.getOwnUser()).resolves.toBeUndefined()
    })
  })
})
