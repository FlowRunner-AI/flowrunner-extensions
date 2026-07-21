'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://gotify.example.com'
const APP_TOKEN = 'test-app-token'
const CLIENT_TOKEN = 'test-client-token'
const BASE = SERVER_URL

// The service resolves the global `Flowrunner` at call time, and each sandbox
// clobbers that single global. To keep suites isolated, every top-level
// describe owns its sandbox in beforeAll and tears it down in afterAll, so a
// suite's global is always in place while (and only while) its tests run.

describe('Gotify Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      serverUrl: SERVER_URL,
      appToken: APP_TOKEN,
      clientToken: CLIENT_TOKEN,
    })
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
          name: 'serverUrl',
          displayName: 'Server URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'appToken',
          displayName: 'Application Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientToken',
          displayName: 'Client Token',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('registers exactly three config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(3)
    })
  })

  // ── Messages ──

  describe('createMessage', () => {
    it('sends POST /message with the app token and required params only', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 25, message: 'Hi' })

      const result = await service.createMessage('Hi')

      expect(result).toEqual({ id: 25, message: 'Hi' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/message`)
      expect(mock.history[0].body).toEqual({ message: 'Hi' })
    })

    it('authenticates with the app token via X-Gotify-Key header', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 26 })

      await service.createMessage('Hi')

      expect(mock.history[0].headers).toMatchObject({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Gotify-Key': APP_TOKEN,
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 27 })

      await service.createMessage('Body', 'Title', 5, {
        'client::display': { contentType: 'text/markdown' },
      })

      expect(mock.history[0].body).toEqual({
        message: 'Body',
        title: 'Title',
        priority: 5,
        extras: { 'client::display': { contentType: 'text/markdown' } },
      })
    })

    it('coerces a string priority to a number', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 28 })

      await service.createMessage('Body', undefined, '8')

      expect(mock.history[0].body).toEqual({ message: 'Body', priority: 8 })
    })

    it('includes priority 0 (falsy but valid)', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 29 })

      await service.createMessage('Body', undefined, 0)

      expect(mock.history[0].body).toEqual({ message: 'Body', priority: 0 })
    })

    it('omits an empty extras object', async () => {
      mock.onPost(`${ BASE }/message`).reply({ id: 30 })

      await service.createMessage('Body', undefined, undefined, {})

      expect(mock.history[0].body).toEqual({ message: 'Body' })
    })

    it('throws a wrapped error with status and description on API failure', async () => {
      mock.onPost(`${ BASE }/message`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: 'unauthorized', errorDescription: 'you need to provide a valid access token' },
      })

      await expect(service.createMessage('Hi')).rejects.toThrow(
        'Gotify API error (401): you need to provide a valid access token'
      )
    })

    it('falls back to error.message when no error body is present', async () => {
      mock.onPost(`${ BASE }/message`).replyWithError({ message: 'Network down' })

      await expect(service.createMessage('Hi')).rejects.toThrow('Gotify API error: Network down')
    })
  })

  describe('getMessages', () => {
    it('sends GET /message with the client token and no query when no params', async () => {
      mock.onGet(`${ BASE }/message`).reply({ messages: [], paging: { size: 0 } })

      const result = await service.getMessages()

      expect(result).toEqual({ messages: [], paging: { size: 0 } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/message`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes limit and since as numbers', async () => {
      mock.onGet(`${ BASE }/message`).reply({ messages: [] })

      await service.getMessages('50', '100')

      expect(mock.history[0].query).toEqual({ limit: 50, since: 100 })
    })

    it('does not send a Content-Type header on a GET without a body', async () => {
      mock.onGet(`${ BASE }/message`).reply({ messages: [] })

      await service.getMessages()

      expect(mock.history[0].headers['Content-Type']).toBeUndefined()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/message`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getMessages()).rejects.toThrow('Gotify API error (500): Boom')
    })
  })

  describe('getApplicationMessages', () => {
    it('sends GET /application/{id}/message with the client token', async () => {
      mock.onGet(`${ BASE }/application/5/message`).reply({ messages: [] })

      const result = await service.getApplicationMessages(5)

      expect(result).toEqual({ messages: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/application/5/message`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes limit and since as numbers', async () => {
      mock.onGet(`${ BASE }/application/5/message`).reply({ messages: [] })

      await service.getApplicationMessages(5, 10, 20)

      expect(mock.history[0].query).toEqual({ limit: 10, since: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/application/5/message`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getApplicationMessages(5)).rejects.toThrow('Gotify API error (404): Not found')
    })
  })

  describe('deleteMessage', () => {
    it('sends DELETE /message/{id} and returns success', async () => {
      mock.onDelete(`${ BASE }/message/25`).reply(undefined)

      const result = await service.deleteMessage(25)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/message/25`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/message/25`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.deleteMessage(25)).rejects.toThrow('Gotify API error (500): Boom')
    })
  })

  describe('deleteAllMessages', () => {
    it('sends DELETE /message and returns success', async () => {
      mock.onDelete(`${ BASE }/message`).reply(undefined)

      const result = await service.deleteAllMessages()

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/message`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/message`).replyWithError({ message: 'Boom' })

      await expect(service.deleteAllMessages()).rejects.toThrow('Gotify API error: Boom')
    })
  })

  // ── Applications ──

  describe('getApplications', () => {
    it('sends GET /application with the client token', async () => {
      const apps = [{ id: 5, name: 'Backup', token: 'AWH.r' }]
      mock.onGet(`${ BASE }/application`).reply(apps)

      const result = await service.getApplications()

      expect(result).toEqual(apps)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/application`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/application`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getApplications()).rejects.toThrow('Gotify API error (500): Boom')
    })
  })

  describe('createApplication', () => {
    it('sends POST /application with required params only', async () => {
      mock.onPost(`${ BASE }/application`).reply({ id: 6, name: 'CI' })

      const result = await service.createApplication('CI')

      expect(result).toEqual({ id: 6, name: 'CI' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/application`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
      expect(mock.history[0].body).toEqual({ name: 'CI' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/application`).reply({ id: 7 })

      await service.createApplication('CI', 'Build notifications', 4)

      expect(mock.history[0].body).toEqual({
        name: 'CI',
        description: 'Build notifications',
        defaultPriority: 4,
      })
    })

    it('coerces a string default priority to a number', async () => {
      mock.onPost(`${ BASE }/application`).reply({ id: 8 })

      await service.createApplication('CI', undefined, '6')

      expect(mock.history[0].body).toEqual({ name: 'CI', defaultPriority: 6 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/application`).replyWithError({ message: 'Boom' })

      await expect(service.createApplication('CI')).rejects.toThrow('Gotify API error: Boom')
    })
  })

  describe('updateApplication', () => {
    it('sends PUT /application/{id} with required params', async () => {
      mock.onPut(`${ BASE }/application/6`).reply({ id: 6, name: 'CI' })

      const result = await service.updateApplication(6, 'CI')

      expect(result).toEqual({ id: 6, name: 'CI' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/application/6`)
      expect(mock.history[0].body).toEqual({ name: 'CI' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPut(`${ BASE }/application/6`).reply({ id: 6 })

      await service.updateApplication(6, 'CI', 'Updated', 6)

      expect(mock.history[0].body).toEqual({
        name: 'CI',
        description: 'Updated',
        defaultPriority: 6,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/application/6`).replyWithError({ message: 'Boom', status: 400 })

      await expect(service.updateApplication(6, 'CI')).rejects.toThrow('Gotify API error (400): Boom')
    })
  })

  describe('deleteApplication', () => {
    it('sends DELETE /application/{id} and returns success', async () => {
      mock.onDelete(`${ BASE }/application/6`).reply(undefined)

      const result = await service.deleteApplication(6)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/application/6`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/application/6`).replyWithError({ message: 'Boom' })

      await expect(service.deleteApplication(6)).rejects.toThrow('Gotify API error: Boom')
    })
  })

  describe('uploadApplicationImage', () => {
    it('downloads the image and posts multipart form data with the client token', async () => {
      const imageUrl = 'https://cdn.example.com/logo.png'
      mock.onGet(imageUrl).reply(Buffer.from('fake-image-bytes'))
      mock.onPost(`${ BASE }/application/6/image`).reply({ id: 6, image: 'image/abc.png' })

      const result = await service.uploadApplicationImage(6, imageUrl)

      expect(result).toEqual({ id: 6, image: 'image/abc.png' })
      expect(mock.history).toHaveLength(2)

      // First call: image download with null encoding (binary)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(imageUrl)
      expect(mock.history[0].encoding).toBeNull()

      // Second call: multipart upload
      const upload = mock.history[1]
      expect(upload.method).toBe('post')
      expect(upload.url).toBe(`${ BASE }/application/6/image`)
      expect(upload.headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
      expect(upload.formData).toBeDefined()
      expect(upload.formData._fields).toHaveLength(1)
      expect(upload.formData._fields[0]).toMatchObject({ name: 'file', filename: 'logo.png' })
      expect(Buffer.isBuffer(upload.formData._fields[0].value)).toBe(true)
    })

    it('derives the filename from the URL, stripping query strings', async () => {
      const imageUrl = 'https://cdn.example.com/path/icon.jpg?v=123'
      mock.onGet(imageUrl).reply(Buffer.from('bytes'))
      mock.onPost(`${ BASE }/application/9/image`).reply({ id: 9 })

      await service.uploadApplicationImage(9, imageUrl)

      expect(mock.history[1].formData._fields[0].filename).toBe('icon.jpg')
    })

    it('does not send a Content-Type header (multipart sets its own boundary)', async () => {
      const imageUrl = 'https://cdn.example.com/logo.png'
      mock.onGet(imageUrl).reply(Buffer.from('bytes'))
      mock.onPost(`${ BASE }/application/6/image`).reply({ id: 6 })

      await service.uploadApplicationImage(6, imageUrl)

      expect(mock.history[1].headers['Content-Type']).toBeUndefined()
    })
  })

  // ── Clients ──

  describe('getClients', () => {
    it('sends GET /client with the client token', async () => {
      const clients = [{ id: 1, name: 'Android', token: 'Cdv.i0' }]
      mock.onGet(`${ BASE }/client`).reply(clients)

      const result = await service.getClients()

      expect(result).toEqual(clients)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/client`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/client`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.getClients()).rejects.toThrow('Gotify API error (500): Boom')
    })
  })

  describe('createClient', () => {
    it('sends POST /client with the name', async () => {
      mock.onPost(`${ BASE }/client`).reply({ id: 2, name: 'Workflow' })

      const result = await service.createClient('Workflow')

      expect(result).toEqual({ id: 2, name: 'Workflow' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/client`)
      expect(mock.history[0].body).toEqual({ name: 'Workflow' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/client`).replyWithError({ message: 'Boom' })

      await expect(service.createClient('Workflow')).rejects.toThrow('Gotify API error: Boom')
    })
  })

  describe('deleteClient', () => {
    it('sends DELETE /client/{id} and returns success', async () => {
      mock.onDelete(`${ BASE }/client/2`).reply(undefined)

      const result = await service.deleteClient(2)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/client/2`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/client/2`).replyWithError({ message: 'Boom' })

      await expect(service.deleteClient(2)).rejects.toThrow('Gotify API error: Boom')
    })
  })

  // ── System (no auth) ──

  describe('getHealth', () => {
    it('sends GET /health without an auth header', async () => {
      mock.onGet(`${ BASE }/health`).reply({ health: 'green', database: 'green' })

      const result = await service.getHealth()

      expect(result).toEqual({ health: 'green', database: 'green' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/health`)
      expect(mock.history[0].headers['X-Gotify-Key']).toBeUndefined()
      expect(mock.history[0].headers).toMatchObject({ 'Accept': 'application/json' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/health`).replyWithError({ message: 'Unreachable' })

      await expect(service.getHealth()).rejects.toThrow('Gotify API error: Unreachable')
    })
  })

  describe('getVersion', () => {
    it('sends GET /version without an auth header', async () => {
      mock.onGet(`${ BASE }/version`).reply({ version: '2.4.0', commit: 'abc' })

      const result = await service.getVersion()

      expect(result).toEqual({ version: '2.4.0', commit: 'abc' })
      expect(mock.history[0].url).toBe(`${ BASE }/version`)
      expect(mock.history[0].headers['X-Gotify-Key']).toBeUndefined()
    })
  })

  // ── Dictionary ──

  describe('getApplicationsDictionary', () => {
    const applications = [
      { id: 5, name: 'Backup Server', description: 'Backup for the interwebs' },
      { id: 6, name: 'CI Pipeline', description: 'Build notifications' },
      { id: 7, name: 'Alerts', description: '' },
    ]

    it('maps applications to dictionary items and hits GET /application', async () => {
      mock.onGet(`${ BASE }/application`).reply(applications)

      const result = await service.getApplicationsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/application`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': CLIENT_TOKEN })
      expect(result).toEqual({
        items: [
          { label: 'Backup Server', value: '5', note: 'Backup for the interwebs' },
          { label: 'CI Pipeline', value: '6', note: 'Build notifications' },
          { label: 'Alerts', value: '7', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters applications by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/application`).reply(applications)

      const result = await service.getApplicationsDictionary({ search: 'backup' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: '5' })
    })

    it('handles a null payload (returns all)', async () => {
      mock.onGet(`${ BASE }/application`).reply(applications)

      const result = await service.getApplicationsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles a non-array API response', async () => {
      mock.onGet(`${ BASE }/application`).reply({ notAnArray: true })

      const result = await service.getApplicationsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('returns no items when the search term matches nothing', async () => {
      mock.onGet(`${ BASE }/application`).reply(applications)

      const result = await service.getApplicationsDictionary({ search: 'nonexistent' })

      expect(result.items).toEqual([])
    })
  })
})

// ── Server URL normalization (isolated sandbox) ──

describe('Gotify Service - server URL normalization', () => {
  afterEach(() => {
    delete global.Flowrunner
  })

  it('strips a trailing slash from the configured server URL', async () => {
    const local = createSandbox({
      serverUrl: 'https://gotify.example.com/',
      appToken: APP_TOKEN,
      clientToken: CLIENT_TOKEN,
    })
    // Force a fresh evaluation so addService() re-runs against this sandbox.
    jest.isolateModules(() => {
      require('../src/index.js')
    })
    const localService = local.getService()
    const localMock = local.getRequestMock()

    localMock.onGet('https://gotify.example.com/health').reply({ health: 'green' })

    await localService.getHealth()

    expect(localMock.history[0].url).toBe('https://gotify.example.com/health')

    local.cleanup()
  })

  it('strips multiple trailing slashes', async () => {
    const local = createSandbox({
      serverUrl: 'https://gotify.example.com///',
      appToken: APP_TOKEN,
      clientToken: CLIENT_TOKEN,
    })
    jest.isolateModules(() => {
      require('../src/index.js')
    })
    const localService = local.getService()
    const localMock = local.getRequestMock()

    localMock.onGet('https://gotify.example.com/version').reply({ version: '2.4.0' })

    await localService.getVersion()

    expect(localMock.history[0].url).toBe('https://gotify.example.com/version')

    local.cleanup()
  })
})

// ── Client token requirement (isolated sandbox without a client token) ──

describe('Gotify Service - client token requirement', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      serverUrl: SERVER_URL,
      appToken: APP_TOKEN,
      // clientToken intentionally omitted
    })
    // Force a fresh evaluation so addService() re-runs against this sandbox.
    jest.isolateModules(() => {
      require('../src/index.js')
    })
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('throws a clear error when a client-token operation runs without a client token', async () => {
    await expect(service.getMessages()).rejects.toThrow(
      'Gotify API error: a Client Token is required for this operation. Add one in the service configuration (Gotify -> Clients).'
    )
    // No HTTP request should have been made.
    expect(mock.history).toHaveLength(0)
  })

  it('still allows app-token operations (createMessage) without a client token', async () => {
    mock.onPost(`${ BASE }/message`).reply({ id: 99 })

    const result = await service.createMessage('Hi')

    expect(result).toEqual({ id: 99 })
    expect(mock.history[0].headers).toMatchObject({ 'X-Gotify-Key': APP_TOKEN })
  })

  it('still allows no-auth operations (getHealth) without a client token', async () => {
    mock.onGet(`${ BASE }/health`).reply({ health: 'green' })

    const result = await service.getHealth()

    expect(result).toEqual({ health: 'green' })
  })
})
