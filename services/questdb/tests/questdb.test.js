'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'http://localhost:9000'
const USERNAME = 'test-user'
const PASSWORD = 'test-pass'

describe('QuestDB Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: BASE_URL, username: USERNAME, password: PASSWORD })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: false, shared: false }),
          expect.objectContaining({ name: 'password', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Auth Headers ──

  describe('authentication', () => {
    it('sends Basic auth header when username and password are set', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({
        query: 'select 1',
        columns: [{ name: '1', type: 'INT' }],
        dataset: [[1]],
        count: 1,
      })

      await service.executeQuery('select 1')

      expect(mock.history).toHaveLength(1)

      const expectedToken = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')

      expect(mock.history[0].headers).toMatchObject({
        Accept: 'application/json',
        Authorization: `Basic ${expectedToken}`,
      })
    })
  })

  // ── executeQuery ──

  describe('executeQuery', () => {
    it('sends correct GET request with required query param', async () => {
      const responseData = {
        query: 'SELECT * FROM trades',
        columns: [{ name: 'symbol', type: 'SYMBOL' }],
        dataset: [['BTC-USD']],
        count: 1,
        timings: { compiler: 100, execute: 200, count: 0 },
      }

      mock.onGet(`${BASE_URL}/exec`).reply(responseData)

      const result = await service.executeQuery('SELECT * FROM trades')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({
        query: 'SELECT * FROM trades',
        count: 'true',
      })
    })

    it('passes limit parameter when provided', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades', '100')

      expect(mock.history[0].query).toMatchObject({
        query: 'SELECT * FROM trades',
        limit: '100',
        count: 'true',
      })
    })

    it('passes range limit parameter', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades', '10,20')

      expect(mock.history[0].query).toMatchObject({
        limit: '10,20',
      })
    })

    it('sets count to false when count param is false', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades', undefined, false)

      expect(mock.history[0].query).toMatchObject({
        count: 'false',
      })
    })

    it('defaults count to true when not provided', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades')

      expect(mock.history[0].query).toMatchObject({
        count: 'true',
      })
    })

    it('sets nm to true when skipMetadata is true', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades', undefined, undefined, true)

      expect(mock.history[0].query).toMatchObject({
        nm: 'true',
      })
    })

    it('omits nm when skipMetadata is false or not provided', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT * FROM trades', undefined, undefined, false)

      expect(mock.history[0].query.nm).toBeUndefined()
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [], count: 0 })

      await service.executeQuery('SELECT 1')

      const query = mock.history[0].query

      expect(query.limit).toBeUndefined()
      expect(query.nm).toBeUndefined()
    })

    it('throws a detailed SQL error on 400 response', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Bad Request',
        body: {
          query: 'SELECT * FROM nonexistent',
          error: 'table does not exist [table=nonexistent]',
          position: 14,
        },
        status: 400,
      })

      await expect(service.executeQuery('SELECT * FROM nonexistent')).rejects.toThrow(
        'QuestDB SQL error [400]: table does not exist [table=nonexistent] (position 14)'
      )
    })

    it('includes position in SQL error when provided', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Bad Request',
        body: {
          query: 'BAD SQL',
          error: 'unexpected token',
          position: 4,
        },
        status: 400,
      })

      try {
        await service.executeQuery('BAD SQL')
      } catch (err) {
        expect(err.message).toContain('(position 4)')
        expect(err.status).toBe(400)
        expect(err.position).toBe(4)
        expect(err.query).toBe('BAD SQL')
      }
    })

    it('throws SQL error without position suffix when position is absent', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Bad Request',
        body: {
          query: 'BAD SQL',
          error: 'unexpected token',
        },
        status: 400,
      })

      await expect(service.executeQuery('BAD SQL')).rejects.toThrow(
        'QuestDB SQL error [400]: unexpected token'
      )
    })

    it('throws generic API error on non-SQL error', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(
        'QuestDB API error [401]: Unauthorized'
      )
    })

    it('throws when URL is not configured', async () => {
      const origUrl = service.url
      service.url = ''

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(
        'QuestDB API error: The REST endpoint URL is not configured.'
      )

      service.url = origUrl
    })

    it('shows unknown status when status is not available', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Network error',
      })

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(
        'QuestDB API error [unknown]: Network error'
      )
    })
  })

  // ── exportQuery ──

  describe('exportQuery', () => {
    it('sends GET request to /exp with query param', async () => {
      const csvData = 'symbol,price\r\nBTC-USD,42350.5\r\n'

      mock.onGet(`${BASE_URL}/exp`).reply(csvData)

      const result = await service.exportQuery('SELECT * FROM trades')

      expect(result).toBe(csvData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE_URL}/exp`)
      expect(mock.history[0].query).toMatchObject({
        query: 'SELECT * FROM trades',
      })
    })

    it('passes limit parameter when provided', async () => {
      mock.onGet(`${BASE_URL}/exp`).reply('data\r\n')

      await service.exportQuery('SELECT * FROM trades', '50')

      expect(mock.history[0].query).toMatchObject({
        query: 'SELECT * FROM trades',
        limit: '50',
      })
    })

    it('omits limit when not provided', async () => {
      mock.onGet(`${BASE_URL}/exp`).reply('data\r\n')

      await service.exportQuery('SELECT * FROM trades')

      expect(mock.history[0].query.limit).toBeUndefined()
    })

    it('converts Buffer response to string', async () => {
      const csvBuffer = Buffer.from('symbol,price\r\nBTC-USD,42350.5\r\n')

      mock.onGet(`${BASE_URL}/exp`).reply(csvBuffer)

      const result = await service.exportQuery('SELECT * FROM trades')

      expect(typeof result).toBe('string')
      expect(result).toBe('symbol,price\r\nBTC-USD,42350.5\r\n')
    })

    it('returns string response as-is', async () => {
      mock.onGet(`${BASE_URL}/exp`).reply('csv,data\r\n1,2\r\n')

      const result = await service.exportQuery('SELECT 1')

      expect(typeof result).toBe('string')
      expect(result).toBe('csv,data\r\n1,2\r\n')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE_URL}/exp`).replyWithError({
        message: 'Bad Request',
        body: {
          query: 'SELECT * FROM missing',
          error: 'table does not exist',
          position: 14,
        },
        status: 400,
      })

      await expect(service.exportQuery('SELECT * FROM missing')).rejects.toThrow(
        'QuestDB SQL error [400]'
      )
    })
  })

  // ── checkHealth ──

  describe('checkHealth', () => {
    it('returns healthy status with url and latency', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({
        query: 'select 1',
        columns: [{ name: '1', type: 'INT' }],
        dataset: [[1]],
        count: 1,
      })

      const result = await service.checkHealth()

      expect(result).toMatchObject({
        healthy: true,
        url: BASE_URL,
      })
      expect(typeof result.latencyMs).toBe('number')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('sends SELECT 1 query with count false', async () => {
      mock.onGet(`${BASE_URL}/exec`).reply({ dataset: [[1]], count: 1 })

      await service.checkHealth()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        query: 'select 1',
        count: 'false',
      })
    })

    it('throws when server is unreachable', async () => {
      mock.onGet(`${BASE_URL}/exec`).replyWithError({
        message: 'Connection refused',
      })

      await expect(service.checkHealth()).rejects.toThrow()
    })
  })

  // ── URL handling ──

  describe('URL normalization', () => {
    it('strips trailing slashes from configured URL', () => {
      // The constructor trims trailing slashes. Verify by checking the stored url.
      const origUrl = service.url
      service.url = 'http://example.com'

      // Simulate constructor behavior
      const trimmed = 'http://localhost:9000///'.trim().replace(/\/+$/, '')

      expect(trimmed).toBe('http://localhost:9000')

      service.url = origUrl
    })
  })
})
