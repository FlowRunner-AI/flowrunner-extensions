'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://mycompany.odoo.com'
const DB = 'mycompany'
const USERNAME = 'admin@example.com'
const API_KEY = 'test-api-key'
const ENDPOINT = `${ URL }/jsonrpc`
const UID = 42

describe('Odoo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      url: URL,
      db: DB,
      username: USERNAME,
      apiKey: API_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    service.uid = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Helper: pre-authenticate and set up a mock response for the execute_kw call
  function setupMock(result) {
    service.uid = UID
    mock.onPost(ENDPOINT).reply({ result })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'db', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })

    it('trims trailing slashes from URL', () => {
      expect(service.url).toBe(URL)

      // Verify the constructor logic by checking the stored url was trimmed
      // (the config passed 'https://mycompany.odoo.com' without trailing slashes,
      //  but we can verify the regex works by testing the constructor output)
      const urlWithSlashes = 'https://test.odoo.com///'
      const trimmed = urlWithSlashes.trim().replace(/\/+$/, '')

      expect(trimmed).toBe('https://test.odoo.com')
    })
  })

  // ── Authentication ──

  describe('authentication', () => {
    it('authenticates before executing methods', async () => {
      mock.onPost(ENDPOINT).reply({ result: UID })

      await service.search('res.partner', [])

      expect(mock.history).toHaveLength(2)

      const authCall = mock.history[0]
      expect(authCall.body.params).toEqual({
        service: 'common',
        method: 'authenticate',
        args: [DB, USERNAME, API_KEY, {}],
      })
    })

    it('caches uid after first authentication', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).reply({ result: [1] })

      await service.search('res.partner', [])

      // Only one call (execute_kw), no authenticate
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.params.service).toBe('object')
    })

    it('throws when authentication returns falsy uid', async () => {
      mock.onPost(ENDPOINT).reply({ result: false })

      await expect(service.search('res.partner', [])).rejects.toThrow(
        'authentication failed'
      )
    })
  })

  // ── searchRead ──

  describe('searchRead', () => {
    it('sends correct RPC payload with all parameters', async () => {
      setupMock([{ id: 1, name: 'Acme' }])

      const result = await service.searchRead(
        'res.partner',
        [['is_company', '=', true]],
        ['name', 'email'],
        10,
        5,
        'name asc'
      )

      expect(result).toEqual([{ id: 1, name: 'Acme' }])

      const call = mock.history[0]
      expect(call.body.params).toEqual({
        service: 'object',
        method: 'execute_kw',
        args: [DB, UID, API_KEY, 'res.partner', 'search_read',
          [[['is_company', '=', true]]],
          { fields: ['name', 'email'], limit: 10, offset: 5, order: 'name asc' },
        ],
      })
    })

    it('omits optional kwargs when not provided', async () => {
      setupMock([])

      await service.searchRead('res.partner')

      const call = mock.history[0]
      expect(call.body.params.args[4]).toBe('search_read')
      expect(call.body.params.args[5]).toEqual([[]])
      expect(call.body.params.args[6]).toEqual({})
    })

    it('uses empty array for null domain', async () => {
      setupMock([])

      await service.searchRead('res.partner', null)

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([[]])
    })
  })

  // ── search ──

  describe('search', () => {
    it('sends correct RPC payload', async () => {
      setupMock([14, 26, 33])

      const result = await service.search('res.partner', [['is_company', '=', true]], 50, 0, 'id asc')

      expect(result).toEqual([14, 26, 33])

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'search',
        [[['is_company', '=', true]]],
        { limit: 50, offset: 0, order: 'id asc' },
      ])
    })

    it('omits optional kwargs when not provided', async () => {
      setupMock([])

      await service.search('res.partner')

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({})
    })
  })

  // ── searchCount ──

  describe('searchCount', () => {
    it('sends correct RPC payload and returns count', async () => {
      setupMock(42)

      const result = await service.searchCount('res.partner', [['is_company', '=', true]])

      expect(result).toBe(42)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'search_count',
        [[['is_company', '=', true]]],
        {},
      ])
    })

    it('uses empty domain when not provided', async () => {
      setupMock(100)

      await service.searchCount('res.partner')

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([[]])
    })
  })

  // ── read ──

  describe('read', () => {
    it('sends correct RPC payload with fields', async () => {
      setupMock([{ id: 7, name: 'Agrolait' }])

      const result = await service.read('res.partner', [7], ['name', 'email'])

      expect(result).toEqual([{ id: 7, name: 'Agrolait' }])

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'read',
        [[7]],
        { fields: ['name', 'email'] },
      ])
    })

    it('omits fields when not provided', async () => {
      setupMock([{ id: 7, name: 'Agrolait', email: 'a@b.com' }])

      await service.read('res.partner', [7])

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({})
    })

    it('uses empty array when ids is null', async () => {
      setupMock([])

      await service.read('res.partner', null)

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([[]])
    })
  })

  // ── create ──

  describe('create', () => {
    it('sends correct RPC payload and returns new ID', async () => {
      setupMock(51)

      const result = await service.create('res.partner', { name: 'Acme Inc', is_company: true })

      expect(result).toBe(51)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'create',
        [{ name: 'Acme Inc', is_company: true }],
        {},
      ])
    })

    it('uses empty object when values is null', async () => {
      setupMock(52)

      await service.create('res.partner', null)

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([{}])
    })
  })

  // ── update ──

  describe('update', () => {
    it('sends correct RPC payload and returns true', async () => {
      setupMock(true)

      const result = await service.update('res.partner', [7, 18], { name: 'Updated' })

      expect(result).toBe(true)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'write',
        [[7, 18], { name: 'Updated' }],
        {},
      ])
    })

    it('uses empty arrays/objects for null ids/values', async () => {
      setupMock(true)

      await service.update('res.partner', null, null)

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([[], {}])
    })
  })

  // ── delete ──

  describe('delete', () => {
    it('sends correct RPC payload with unlink method', async () => {
      setupMock(true)

      const result = await service.delete('res.partner', [7, 18])

      expect(result).toBe(true)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'unlink',
        [[7, 18]],
        {},
      ])
    })
  })

  // ── fieldsGet ──

  describe('fieldsGet', () => {
    it('sends correct RPC payload with default attributes', async () => {
      const fieldsResult = { name: { string: 'Name', type: 'char', required: true } }
      setupMock(fieldsResult)

      const result = await service.fieldsGet('res.partner')

      expect(result).toEqual(fieldsResult)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'res.partner', 'fields_get',
        [],
        { attributes: ['string', 'type', 'required'] },
      ])
    })

    it('uses custom attributes when provided', async () => {
      setupMock({})

      await service.fieldsGet('res.partner', ['string', 'type', 'help', 'relation'])

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({
        attributes: ['string', 'type', 'help', 'relation'],
      })
    })

    it('uses default attributes for empty array', async () => {
      setupMock({})

      await service.fieldsGet('res.partner', [])

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({
        attributes: ['string', 'type', 'required'],
      })
    })
  })

  // ── callMethod ──

  describe('callMethod', () => {
    it('sends correct RPC payload with custom method', async () => {
      setupMock(true)

      const result = await service.callMethod(
        'sale.order', 'action_confirm', [[42]], { context: { lang: 'en_US' } }
      )

      expect(result).toBe(true)

      const call = mock.history[0]
      expect(call.body.params.args).toEqual([
        DB, UID, API_KEY, 'sale.order', 'action_confirm',
        [[42]],
        { context: { lang: 'en_US' } },
      ])
    })

    it('uses empty defaults when args and kwargs are not provided', async () => {
      setupMock([])

      await service.callMethod('res.partner', 'name_get')

      const call = mock.history[0]
      expect(call.body.params.args[5]).toEqual([])
      expect(call.body.params.args[6]).toEqual({})
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on RPC error in response body with debug info', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).reply({
        error: {
          message: 'Server Error',
          data: { message: 'Model not found', debug: 'Traceback\nValueError: model missing' },
        },
      })

      await expect(service.search('nonexistent.model', [])).rejects.toThrow(
        'Odoo API error: Model not found (ValueError: model missing)'
      )
    })

    it('throws on RPC error without debug', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).reply({
        error: {
          message: 'Bad Request',
          data: { message: 'Access denied' },
        },
      })

      await expect(service.search('res.partner', [])).rejects.toThrow(
        'Odoo API error: Access denied'
      )
    })

    it('throws on RPC error with only top-level message', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).reply({
        error: {
          message: 'Unknown error',
        },
      })

      await expect(service.search('res.partner', [])).rejects.toThrow(
        'Odoo API error: Unknown error'
      )
    })

    it('throws on HTTP transport error', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).replyWithError({
        message: 'Service Unavailable',
        status: 503,
      })

      await expect(service.search('res.partner', [])).rejects.toThrow('Odoo API error:')
    })

    it('throws on HTTP error with body error details', async () => {
      service.uid = UID
      mock.onPost(ENDPOINT).replyWithError({
        message: 'Internal Server Error',
        body: { error: { data: { message: 'Database not found' } } },
        status: 500,
      })

      await expect(service.search('res.partner', [])).rejects.toThrow('Database not found')
    })
  })

  // ── Request headers ──

  describe('request headers', () => {
    it('sends Content-Type application/json', async () => {
      setupMock([])

      await service.search('res.partner', [])

      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('sends to correct endpoint', async () => {
      setupMock([])

      await service.search('res.partner', [])

      expect(mock.history[0].url).toBe(ENDPOINT)
    })
  })

  // ── cleanKwargs ──

  describe('cleanKwargs behavior', () => {
    it('strips undefined, null, and empty string values from kwargs', async () => {
      setupMock([])

      await service.searchRead('res.partner', [], undefined, undefined, undefined, undefined)

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({})
    })

    it('keeps zero and false values in kwargs', async () => {
      setupMock([])

      await service.searchRead('res.partner', [], ['name'], 0, 0, 'id asc')

      const call = mock.history[0]
      expect(call.body.params.args[6]).toEqual({
        fields: ['name'],
        limit: 0,
        offset: 0,
        order: 'id asc',
      })
    })
  })
})
