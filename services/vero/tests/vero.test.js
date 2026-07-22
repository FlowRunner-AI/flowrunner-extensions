'use strict'

const { createSandbox } = require('../../../service-sandbox')

const AUTH_TOKEN = 'test-auth-token'
const BASE = 'https://api.getvero.com/api/v2'

describe('Vero Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ authToken: AUTH_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'authToken',
            required: true,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── identifyUser ──

  describe('identifyUser', () => {
    it('sends POST with id, email, and data', async () => {
      mock.onPost(`${BASE}/users/track.json`).reply({ status: 200, message: 'success' })

      const result = await service.identifyUser('user-1', 'jane@example.com', { first_name: 'Jane' })

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
        email: 'jane@example.com',
        data: { first_name: 'Jane' },
      })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('omits email and data when not provided', async () => {
      mock.onPost(`${BASE}/users/track.json`).reply({ status: 200, message: 'success' })

      await service.identifyUser('user-1')

      expect(mock.history[0].body).toEqual({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
      })
      expect(mock.history[0].body).not.toHaveProperty('email')
      expect(mock.history[0].body).not.toHaveProperty('data')
    })

    it('omits empty string email via clean()', async () => {
      mock.onPost(`${BASE}/users/track.json`).reply({ status: 200, message: 'success' })

      await service.identifyUser('user-1', '', null)

      expect(mock.history[0].body).toEqual({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE}/users/track.json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.identifyUser('user-1')).rejects.toThrow('Vero API error (401)')
    })
  })

  // ── updateUser ──

  describe('updateUser', () => {
    it('sends PUT with id and changes', async () => {
      mock.onPut(`${BASE}/users/edit.json`).reply({ status: 200, message: 'success' })

      const result = await service.updateUser('user-1', { plan: 'enterprise' })

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
        changes: { plan: 'enterprise' },
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPut(`${BASE}/users/edit.json`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.updateUser('user-1', { plan: 'pro' })).rejects.toThrow('Vero API error (404)')
    })
  })

  // ── editUserTags ──

  describe('editUserTags', () => {
    it('sends PUT with id, add, and remove tags', async () => {
      mock.onPut(`${BASE}/users/tags/edit.json`).reply({ status: 200, message: 'success' })

      const result = await service.editUserTags('user-1', ['trial', 'newsletter'], ['old-tag'])

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
        add: ['trial', 'newsletter'],
        remove: ['old-tag'],
      })
    })

    it('omits add when not provided', async () => {
      mock.onPut(`${BASE}/users/tags/edit.json`).reply({ status: 200, message: 'success' })

      await service.editUserTags('user-1', undefined, ['old-tag'])

      expect(mock.history[0].body).not.toHaveProperty('add')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
        remove: ['old-tag'],
      })
    })

    it('omits remove when not provided', async () => {
      mock.onPut(`${BASE}/users/tags/edit.json`).reply({ status: 200, message: 'success' })

      await service.editUserTags('user-1', ['trial'])

      expect(mock.history[0].body).not.toHaveProperty('remove')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
        add: ['trial'],
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPut(`${BASE}/users/tags/edit.json`).replyWithError({
        message: 'Bad Request',
        status: 400,
      })

      await expect(service.editUserTags('user-1', ['x'])).rejects.toThrow('Vero API error (400)')
    })
  })

  // ── unsubscribeUser ──

  describe('unsubscribeUser', () => {
    it('sends POST with id', async () => {
      mock.onPost(`${BASE}/users/unsubscribe.json`).reply({ status: 200, message: 'success' })

      const result = await service.unsubscribeUser('user-1')

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE}/users/unsubscribe.json`).replyWithError({
        message: 'Server Error',
        status: 500,
      })

      await expect(service.unsubscribeUser('user-1')).rejects.toThrow('Vero API error (500)')
    })
  })

  // ── resubscribeUser ──

  describe('resubscribeUser', () => {
    it('sends POST with id', async () => {
      mock.onPost(`${BASE}/users/resubscribe.json`).reply({ status: 200, message: 'success' })

      const result = await service.resubscribeUser('user-1')

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE}/users/resubscribe.json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.resubscribeUser('user-1')).rejects.toThrow('Vero API error (401)')
    })
  })

  // ── deleteUser ──

  describe('deleteUser', () => {
    it('sends POST with id', async () => {
      mock.onPost(`${BASE}/users/delete.json`).reply({ status: 200, message: 'success' })

      const result = await service.deleteUser('user-1')

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        auth_token: AUTH_TOKEN,
        id: 'user-1',
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE}/users/delete.json`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.deleteUser('user-1')).rejects.toThrow('Vero API error (404)')
    })
  })

  // ── reidentifyUser ──

  describe('reidentifyUser', () => {
    it('sends PUT with id and new_id', async () => {
      mock.onPut(`${BASE}/users/reidentify.json`).reply({ status: 200, message: 'success' })

      const result = await service.reidentifyUser('old-id', 'new-id')

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        id: 'old-id',
        new_id: 'new-id',
      })
    })

    it('throws on HTTP error', async () => {
      mock.onPut(`${BASE}/users/reidentify.json`).replyWithError({
        message: 'Bad Request',
        status: 400,
      })

      await expect(service.reidentifyUser('old-id', 'new-id')).rejects.toThrow('Vero API error (400)')
    })
  })

  // ── trackEvent ──

  describe('trackEvent', () => {
    it('sends POST with identity, event_name, data, and extras', async () => {
      mock.onPost(`${BASE}/events/track.json`).reply({ status: 200, message: 'success' })

      const result = await service.trackEvent(
        'user-1',
        'jane@example.com',
        'purchased_item',
        { product: 'Widget', amount: 29.99 },
        { scheduled: true }
      )

      expect(result).toEqual({ status: 200, message: 'success' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        identity: { id: 'user-1', email: 'jane@example.com' },
        event_name: 'purchased_item',
        data: { product: 'Widget', amount: 29.99 },
        extras: { scheduled: true },
      })
    })

    it('sends with id only in identity when email is not provided', async () => {
      mock.onPost(`${BASE}/events/track.json`).reply({ status: 200, message: 'success' })

      await service.trackEvent('user-1', undefined, 'viewed_page')

      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        identity: { id: 'user-1' },
        event_name: 'viewed_page',
      })
      expect(mock.history[0].body.identity).not.toHaveProperty('email')
    })

    it('sends with email only in identity when id is not provided', async () => {
      mock.onPost(`${BASE}/events/track.json`).reply({ status: 200, message: 'success' })

      await service.trackEvent(undefined, 'jane@example.com', 'signed_up')

      expect(mock.history[0].body).toMatchObject({
        auth_token: AUTH_TOKEN,
        identity: { email: 'jane@example.com' },
        event_name: 'signed_up',
      })
      expect(mock.history[0].body.identity).not.toHaveProperty('id')
    })

    it('omits data and extras when not provided', async () => {
      mock.onPost(`${BASE}/events/track.json`).reply({ status: 200, message: 'success' })

      await service.trackEvent('user-1', null, 'logged_in')

      expect(mock.history[0].body).not.toHaveProperty('data')
      expect(mock.history[0].body).not.toHaveProperty('extras')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE}/events/track.json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.trackEvent('user-1', null, 'event')).rejects.toThrow('Vero API error (401)')
    })
  })

  // ── API-level error handling ──

  describe('API-level error handling', () => {
    it('throws when response status >= 400', async () => {
      mock.onPost(`${BASE}/users/track.json`).reply({
        status: 400,
        message: 'Missing required parameter: id',
      })

      await expect(service.identifyUser('user-1')).rejects.toThrow(
        'Vero API error (400): Missing required parameter: id'
      )
    })

    it('throws with Unknown error when response message is missing', async () => {
      mock.onPost(`${BASE}/users/track.json`).reply({
        status: 500,
      })

      await expect(service.identifyUser('user-1')).rejects.toThrow(
        'Vero API error (500): Unknown error'
      )
    })

    it('uses error.body.message when available', async () => {
      mock.onPost(`${BASE}/users/track.json`).replyWithError({
        message: 'Request failed',
        body: { message: 'Invalid auth token' },
        status: 403,
      })

      await expect(service.identifyUser('user-1')).rejects.toThrow(
        'Vero API error (403): Invalid auth token'
      )
    })

    it('uses error.message as fallback when body is absent', async () => {
      mock.onPost(`${BASE}/users/track.json`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.identifyUser('user-1')).rejects.toThrow(
        'Vero API error: Network timeout'
      )
    })
  })
})
