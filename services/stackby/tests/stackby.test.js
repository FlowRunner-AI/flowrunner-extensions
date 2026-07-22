'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://stackby.com/api/v1'
const STACK_ID = 'stTestStack1'
const TABLE = 'My Table'
const TABLE_ENCODED = 'My%20Table'

const EXPECTED_HEADERS = { 'api-key': API_KEY, 'Content-Type': 'application/json' }

describe('Stackby Service', () => {
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

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('stores the api key from the config', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── listRows ──

  describe('listRows', () => {
    const url = `${ BASE }/rowlist/${ STACK_ID }/${ TABLE_ENCODED }`

    it('sends a GET request with auth headers and no optional query params', async () => {
      const rows = [{ id: 'rw1', field: { Name: 'Acme' } }]

      mock.onGet(url).reply(rows)

      const result = await service.listRows(STACK_ID, TABLE)

      expect(result).toEqual(rows)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('passes view, maxRecord and offset as query params', async () => {
      mock.onGet(url).reply([])

      await service.listRows(STACK_ID, TABLE, 'Grid View', 25, 50)

      expect(mock.history[0].query).toEqual({ view: 'Grid View', maxrecord: 25, offset: 50 })
    })

    it('includes a zero maxRecord and offset', async () => {
      mock.onGet(url).reply([])

      await service.listRows(STACK_ID, TABLE, undefined, 0, 0)

      expect(mock.history[0].query).toEqual({ maxrecord: 0, offset: 0 })
    })

    it('omits empty-string maxRecord and offset', async () => {
      mock.onGet(url).reply([])

      await service.listRows(STACK_ID, TABLE, '', '', '')

      expect(mock.history[0].query).toEqual({})
    })

    it('unwraps a data-wrapped payload', async () => {
      mock.onGet(url).reply({ data: [{ id: 'rw1' }] })

      const result = await service.listRows(STACK_ID, TABLE)

      expect(result).toEqual([{ id: 'rw1' }])
    })

    it('unwraps a rows-wrapped payload', async () => {
      mock.onGet(url).reply({ rows: [{ id: 'rw2' }] })

      const result = await service.listRows(STACK_ID, TABLE)

      expect(result).toEqual([{ id: 'rw2' }])
    })

    it('returns an empty array when the payload is empty', async () => {
      mock.onGet(url).reply(undefined)

      const result = await service.listRows(STACK_ID, TABLE)

      expect(result).toEqual([])
    })

    it('throws a descriptive error using the api error body message', async () => {
      mock.onGet(url).replyWithError({
        message: 'Request failed',
        status: 404,
        body: { message: 'Table not found' },
      })

      await expect(service.listRows(STACK_ID, TABLE)).rejects.toThrow('Stackby API error: Table not found')
    })

    it('falls back to body.error when no message is present', async () => {
      mock.onGet(url).replyWithError({ message: 'Request failed', body: { error: 'Invalid api key' } })

      await expect(service.listRows(STACK_ID, TABLE)).rejects.toThrow('Stackby API error: Invalid api key')
    })

    it('falls back to the transport error message when there is no body', async () => {
      mock.onGet(url).replyWithError({ message: 'Network timeout' })

      await expect(service.listRows(STACK_ID, TABLE)).rejects.toThrow('Stackby API error: Network timeout')
    })
  })

  // ── getRow ──

  describe('getRow', () => {
    const rowUrl = `${ BASE }/rowlist/${ STACK_ID }/${ TABLE_ENCODED }?rowIds[]=rw1`

    it('requests the row by id and returns the exact match', async () => {
      mock.onGet(rowUrl).reply([{ id: 'rw0' }, { id: 'rw1', field: { Name: 'Acme' } }])

      const result = await service.getRow(STACK_ID, TABLE, 'rw1')

      expect(result).toEqual({ id: 'rw1', field: { Name: 'Acme' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(rowUrl)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
    })

    it('falls back to the first row when no id matches', async () => {
      mock.onGet(rowUrl).reply([{ id: 'rwOther' }])

      const result = await service.getRow(STACK_ID, TABLE, 'rw1')

      expect(result).toEqual({ id: 'rwOther' })
    })

    it('unwraps a data-wrapped payload', async () => {
      mock.onGet(rowUrl).reply({ data: [{ id: 'rw1' }] })

      const result = await service.getRow(STACK_ID, TABLE, 'rw1')

      expect(result).toEqual({ id: 'rw1' })
    })

    it('returns null when no rows are returned', async () => {
      mock.onGet(rowUrl).reply([])

      const result = await service.getRow(STACK_ID, TABLE, 'rw1')

      expect(result).toBeNull()
    })

    it('url-encodes the row id', async () => {
      const encodedUrl = `${ BASE }/rowlist/${ STACK_ID }/${ TABLE_ENCODED }?rowIds[]=rw%2F1`

      mock.onGet(encodedUrl).reply([])

      await service.getRow(STACK_ID, TABLE, 'rw/1')

      expect(mock.history[0].url).toBe(encodedUrl)
    })

    it('throws on api errors', async () => {
      mock.onGet(rowUrl).replyWithError({ message: 'Boom', body: { message: 'Row lookup failed' } })

      await expect(service.getRow(STACK_ID, TABLE, 'rw1')).rejects.toThrow('Stackby API error: Row lookup failed')
    })
  })

  // ── createRows ──

  describe('createRows', () => {
    const url = `${ BASE }/rowcreate/${ STACK_ID }/${ TABLE_ENCODED }`

    it('wraps each field object in a record envelope', async () => {
      mock.onPost(url).reply([{ id: 'rw1', field: { Name: 'Acme' } }])

      const result = await service.createRows(STACK_ID, TABLE, [{ Name: 'Acme' }, { Name: 'Globex' }])

      expect(result).toEqual([{ id: 'rw1', field: { Name: 'Acme' } }])
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)

      expect(mock.history[0].body).toEqual({
        records: [{ field: { Name: 'Acme' } }, { field: { Name: 'Globex' } }],
      })
    })

    it('accepts a single object instead of an array', async () => {
      mock.onPost(url).reply([])

      await service.createRows(STACK_ID, TABLE, { Name: 'Acme' })

      expect(mock.history[0].body).toEqual({ records: [{ field: { Name: 'Acme' } }] })
    })

    it('throws when no rows are provided', async () => {
      await expect(service.createRows(STACK_ID, TABLE, [])).rejects.toThrow(
        'At least one row is required to create.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('throws when rows is null', async () => {
      await expect(service.createRows(STACK_ID, TABLE, null)).rejects.toThrow(
        'At least one row is required to create.'
      )
    })

    it('unwraps a data-wrapped response', async () => {
      mock.onPost(url).reply({ data: [{ id: 'rw1' }] })

      const result = await service.createRows(STACK_ID, TABLE, [{ Name: 'Acme' }])

      expect(result).toEqual([{ id: 'rw1' }])
    })

    it('throws on api errors', async () => {
      mock.onPost(url).replyWithError({ message: 'Bad Request', body: { message: 'Unknown column' } })

      await expect(service.createRows(STACK_ID, TABLE, [{ Nope: 1 }])).rejects.toThrow(
        'Stackby API error: Unknown column'
      )
    })
  })

  // ── updateRows ──

  describe('updateRows', () => {
    const url = `${ BASE }/rowupdate/${ STACK_ID }/${ TABLE_ENCODED }`

    it('sends a PATCH with id/field records', async () => {
      mock.onPatch(url).reply([{ id: 'rw1', field: { Status: 'Closed' } }])

      const result = await service.updateRows(STACK_ID, TABLE, [
        { id: 'rw1', field: { Status: 'Closed' } },
      ])

      expect(result).toEqual([{ id: 'rw1', field: { Status: 'Closed' } }])
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(url)

      expect(mock.history[0].body).toEqual({
        records: [{ id: 'rw1', field: { Status: 'Closed' } }],
      })
    })

    it('treats a flat row as its own field object', async () => {
      mock.onPatch(url).reply([])

      await service.updateRows(STACK_ID, TABLE, [{ id: 'rw1', Status: 'Closed' }])

      expect(mock.history[0].body).toEqual({
        records: [{ id: 'rw1', field: { id: 'rw1', Status: 'Closed' } }],
      })
    })

    it('accepts a single object instead of an array', async () => {
      mock.onPatch(url).reply([])

      await service.updateRows(STACK_ID, TABLE, { id: 'rw1', field: { A: 1 } })

      expect(mock.history[0].body).toEqual({ records: [{ id: 'rw1', field: { A: 1 } }] })
    })

    it('throws when no rows are provided', async () => {
      await expect(service.updateRows(STACK_ID, TABLE, [])).rejects.toThrow(
        'At least one row is required to update.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('throws when rows is undefined', async () => {
      await expect(service.updateRows(STACK_ID, TABLE, undefined)).rejects.toThrow(
        'At least one row is required to update.'
      )
    })

    it('unwraps a rows-wrapped response', async () => {
      mock.onPatch(url).reply({ rows: [{ id: 'rw1' }] })

      const result = await service.updateRows(STACK_ID, TABLE, [{ id: 'rw1', field: {} }])

      expect(result).toEqual([{ id: 'rw1' }])
    })

    it('throws on api errors', async () => {
      mock.onPatch(url).replyWithError({ message: 'Bad Request' })

      await expect(service.updateRows(STACK_ID, TABLE, [{ id: 'rw1', field: {} }])).rejects.toThrow(
        'Stackby API error: Bad Request'
      )
    })
  })

  // ── deleteRows ──

  describe('deleteRows', () => {
    it('builds a repeated rowIds query string', async () => {
      const url = `${ BASE }/rowdelete/${ STACK_ID }/${ TABLE_ENCODED }?rowIds[]=rw1&rowIds[]=rw2`

      mock.onDelete(url).reply({ records: [{ id: 'rw1', deleted: true }] })

      const result = await service.deleteRows(STACK_ID, TABLE, ['rw1', 'rw2'])

      expect(result).toEqual({ records: [{ id: 'rw1', deleted: true }] })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('accepts a single row id string', async () => {
      const url = `${ BASE }/rowdelete/${ STACK_ID }/${ TABLE_ENCODED }?rowIds[]=rw1`

      mock.onDelete(url).reply({ records: [] })

      await service.deleteRows(STACK_ID, TABLE, 'rw1')

      expect(mock.history[0].url).toBe(url)
    })

    it('throws when no row ids are provided', async () => {
      await expect(service.deleteRows(STACK_ID, TABLE, [])).rejects.toThrow(
        'At least one row ID is required to delete.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('throws when row ids is null', async () => {
      await expect(service.deleteRows(STACK_ID, TABLE, null)).rejects.toThrow(
        'At least one row ID is required to delete.'
      )
    })

    it('throws on api errors', async () => {
      const url = `${ BASE }/rowdelete/${ STACK_ID }/${ TABLE_ENCODED }?rowIds[]=rw1`

      mock.onDelete(url).replyWithError({ message: 'Forbidden', body: { error: 'Not allowed' } })

      await expect(service.deleteRows(STACK_ID, TABLE, ['rw1'])).rejects.toThrow(
        'Stackby API error: Not allowed'
      )
    })
  })
})
