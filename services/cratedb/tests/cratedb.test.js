'use strict'

const { createSandbox } = require('../../../service-sandbox')

const HOST = 'https://crate.example.com:4200'
const USERNAME = 'crate'
const PASSWORD = 's3cret'
const SQL_URL = `${ HOST }/_sql`
const SQL_URL_TYPES = `${ HOST }/_sql?types`

const basicToken = (user, pass) => Buffer.from(`${ user }:${ pass }`).toString('base64')

// Each createSandbox() replaces the global Flowrunner, so we build one per config
// scenario. The service file calls addService() at require time, so we reset the
// Jest module registry to force a fresh require that re-registers against the new
// sandbox.
function buildService(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()
  require('../src/index.js')

  return {
    sandbox,
    service: sandbox.getService(),
    mock: sandbox.getRequestMock(),
  }
}

describe('CrateDB Service', () => {
  let sandbox
  let service
  let mock

  beforeEach(() => {
    ;({ sandbox, service, mock } = buildService({
      url: HOST,
      username: USERNAME,
      password: PASSWORD,
    }))
  })

  afterEach(() => {
    mock.reset()
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'url',
          displayName: 'HTTP Endpoint URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'username',
          displayName: 'Username',
          required: false,
          shared: false,
          defaultValue: 'crate',
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'password',
          displayName: 'Password',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Auth / URL construction ──

  describe('headers and URL construction', () => {
    it('sends Basic auth header and JSON content type', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(SQL_URL)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ basicToken(USERNAME, PASSWORD) }`,
      })
    })

    it('strips trailing slashes from the configured URL', async () => {
      ;({ sandbox, service, mock } = buildService({
        url: `${ HOST }///`,
        username: USERNAME,
        password: PASSWORD,
      }))
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1')

      expect(mock.history[0].url).toBe(SQL_URL)
    })

    it('builds a Basic header for a user with a blank password', async () => {
      ;({ sandbox, service, mock } = buildService({
        url: HOST,
        username: USERNAME,
        password: '',
      }))
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Basic ${ basicToken(USERNAME, '') }`,
      })
    })

    it('omits the Authorization header when no username is configured', async () => {
      ;({ sandbox, service, mock } = buildService({ url: HOST }))
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1')

      expect(mock.history[0].headers).toEqual({ 'Content-Type': 'application/json' })
      expect(mock.history[0].headers).not.toHaveProperty('Authorization')
    })
  })

  // ── executeSQL ──

  describe('executeSQL', () => {
    it('sends the statement only when no args or types are given', async () => {
      const response = { cols: ['id', 'name'], rows: [[1, 'Earth']], rowcount: 1, duration: 1.23 }

      mock.onPost(SQL_URL).reply(response)

      const result = await service.executeSQL('SELECT * FROM locations')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(SQL_URL)
      expect(mock.history[0].body).toEqual({ stmt: 'SELECT * FROM locations' })
      expect(result).toEqual(response)
    })

    it('returns the { cols, rows } response passthrough', async () => {
      const response = {
        cols: ['id', 'name'],
        rows: [[1337, 'Earth'], [1338, 'Sun']],
        rowcount: 2,
        duration: 1.23,
      }

      mock.onPost(SQL_URL).reply(response)

      const result = await service.executeSQL('SELECT id, name FROM locations')

      expect(result.cols).toEqual(['id', 'name'])
      expect(result.rows).toEqual([[1337, 'Earth'], [1338, 'Sun']])
      expect(result.rowcount).toBe(2)
    })

    it('includes args when a non-empty array is provided', async () => {
      mock.onPost(SQL_URL).reply({ cols: ['id'], rows: [[42]], rowcount: 1, duration: 1 })

      await service.executeSQL('SELECT id FROM locations WHERE id = ?', [42])

      expect(mock.history[0].body).toEqual({
        stmt: 'SELECT id FROM locations WHERE id = ?',
        args: [42],
      })
    })

    it('omits args when an empty array is provided', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1', [])

      expect(mock.history[0].body).toEqual({ stmt: 'SELECT 1' })
      expect(mock.history[0].body).not.toHaveProperty('args')
    })

    it('omits args when a non-array value is provided', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1', 'not-an-array')

      expect(mock.history[0].body).toEqual({ stmt: 'SELECT 1' })
    })

    it('appends ?types to the URL when includeTypes is enabled', async () => {
      const response = {
        cols: ['id', 'name'],
        col_types: [10, 4],
        rows: [[1, 'Earth']],
        rowcount: 1,
        duration: 1,
      }

      mock.onPost(SQL_URL_TYPES).reply(response)

      const result = await service.executeSQL('SELECT id, name FROM locations', undefined, true)

      expect(mock.history[0].url).toBe(SQL_URL_TYPES)
      expect(result.col_types).toEqual([10, 4])
    })

    it('does not append ?types when includeTypes is falsy', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], rows: [], rowcount: 0, duration: 1 })

      await service.executeSQL('SELECT 1', undefined, false)

      expect(mock.history[0].url).toBe(SQL_URL)
    })

    it('sends args and ?types together when both are provided', async () => {
      mock.onPost(SQL_URL_TYPES).reply({ cols: ['id'], col_types: [10], rows: [[1]], rowcount: 1, duration: 1 })

      await service.executeSQL('SELECT id FROM locations WHERE id = ?', [1], true)

      expect(mock.history[0].url).toBe(SQL_URL_TYPES)
      expect(mock.history[0].body).toEqual({
        stmt: 'SELECT id FROM locations WHERE id = ?',
        args: [1],
      })
    })

    it('wraps a structured CrateDB error with message, code and status', async () => {
      mock.onPost(SQL_URL).replyWithError({
        message: 'HTTP 400',
        status: 400,
        body: { error: { message: 'line 1:1: mismatched input', code: 4000 } },
      })

      await expect(service.executeSQL('SELCT 1')).rejects.toThrow(
        'CrateDB error: line 1:1: mismatched input (code 4000) [HTTP 400]'
      )
    })

    it('wraps a plain error with just the message', async () => {
      mock.onPost(SQL_URL).replyWithError({ message: 'connection refused' })

      await expect(service.executeSQL('SELECT 1')).rejects.toThrow('CrateDB error: connection refused')
    })

    it('uses statusCode when status is absent', async () => {
      mock.onPost(SQL_URL).replyWithError({ message: 'Unauthorized', statusCode: 401 })

      await expect(service.executeSQL('SELECT 1')).rejects.toThrow(
        'CrateDB error: Unauthorized [HTTP 401]'
      )
    })
  })

  // ── executeBulkSQL ──

  describe('executeBulkSQL', () => {
    it('sends the statement with bulk_args', async () => {
      const response = {
        cols: [],
        results: [{ rowcount: 1 }, { rowcount: 1 }],
        duration: 2.45,
      }

      mock.onPost(SQL_URL).reply(response)

      const result = await service.executeBulkSQL('INSERT INTO locations (id, name) VALUES (?, ?)', [
        [1337, 'Earth'],
        [1338, 'Sun'],
      ])

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(SQL_URL)
      expect(mock.history[0].body).toEqual({
        stmt: 'INSERT INTO locations (id, name) VALUES (?, ?)',
        bulk_args: [
          [1337, 'Earth'],
          [1338, 'Sun'],
        ],
      })
      expect(result).toEqual(response)
    })

    it('returns the results passthrough with per-row rowcounts', async () => {
      mock.onPost(SQL_URL).reply({
        cols: [],
        results: [{ rowcount: 1 }, { rowcount: -2 }],
        duration: 3,
      })

      const result = await service.executeBulkSQL('INSERT INTO t (id) VALUES (?)', [[1], [2]])

      expect(result.results).toEqual([{ rowcount: 1 }, { rowcount: -2 }])
    })

    it('never appends ?types for bulk requests', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], results: [], duration: 1 })

      await service.executeBulkSQL('INSERT INTO t (id) VALUES (?)', [[1]])

      expect(mock.history[0].url).toBe(SQL_URL)
    })

    it('defaults bulk_args to an empty array when not an array', async () => {
      mock.onPost(SQL_URL).reply({ cols: [], results: [], duration: 1 })

      await service.executeBulkSQL('DELETE FROM t', undefined)

      expect(mock.history[0].body).toEqual({ stmt: 'DELETE FROM t', bulk_args: [] })
    })

    it('wraps a structured CrateDB error', async () => {
      mock.onPost(SQL_URL).replyWithError({
        message: 'HTTP 400',
        status: 400,
        body: { error: { message: 'relation unknown', code: 4041 } },
      })

      await expect(
        service.executeBulkSQL('INSERT INTO missing (id) VALUES (?)', [[1]])
      ).rejects.toThrow('CrateDB error: relation unknown (code 4041) [HTTP 400]')
    })

    it('wraps a plain error with just the message', async () => {
      mock.onPost(SQL_URL).replyWithError({ message: 'network down' })

      await expect(service.executeBulkSQL('INSERT INTO t (id) VALUES (?)', [[1]])).rejects.toThrow(
        'CrateDB error: network down'
      )
    })
  })
})
