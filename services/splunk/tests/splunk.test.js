'use strict'

const { createSandbox } = require('../../../service-sandbox')

const MANAGEMENT_URL = 'https://splunk.example.com:8089'
const HEC_URL = 'https://splunk.example.com:8088'
const AUTH_TOKEN = 'test-auth-token'
const HEC_TOKEN = 'test-hec-token'

const FULL_CONFIG = {
  // Trailing slashes must be stripped by the constructor.
  managementUrl: `${ MANAGEMENT_URL }//`,
  authToken: AUTH_TOKEN,
  hecUrl: `${ HEC_URL }/`,
  hecToken: HEC_TOKEN,
}

describe('Splunk Service', () => {
  let sandbox
  let service
  let mock

  /** Builds a fresh service instance with the given service configuration. */
  function build(config = FULL_CONFIG) {
    if (sandbox) {
      sandbox.cleanup()
    }

    jest.resetModules()

    sandbox = createSandbox(config)
    require('../src/index.js')

    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    return service
  }

  beforeEach(() => {
    build()
  })

  afterEach(() => {
    sandbox.cleanup()
    sandbox = null
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers the management and HEC config items', () => {
      const items = sandbox.getConfigItems()

      expect(items.map(item => item.name)).toEqual([
        'managementUrl',
        'authToken',
        'hecUrl',
        'hecToken',
      ])

      items.forEach(item => {
        expect(item.shared).toBe(false)
        expect(item.type).toBe('STRING')
        expect(typeof item.hint).toBe('string')
      })

      expect(items.find(item => item.name === 'managementUrl').required).toBe(true)
      expect(items.find(item => item.name === 'authToken').required).toBe(true)
      expect(items.find(item => item.name === 'hecUrl').required).toBe(false)
      expect(items.find(item => item.name === 'hecToken').required).toBe(false)
    })

    it('strips trailing slashes from both base URLs', () => {
      expect(service.managementUrl).toBe(MANAGEMENT_URL)
      expect(service.hecUrl).toBe(HEC_URL)
    })

    it('tolerates a configuration without any URLs', () => {
      build({})

      expect(service.managementUrl).toBe('')
      expect(service.hecUrl).toBe('')
    })
  })

  // ── Search ──

  describe('createSearchJob', () => {
    it('posts the search as a form with normal exec mode by default', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).reply({ sid: '1720000000.123' })

      const result = await service.createSearchJob('search index=main error')

      expect(result).toEqual({ sid: '1720000000.123' })
      expect(mock.history).toHaveLength(1)

      const call = mock.history[0]

      expect(call.method).toBe('post')
      expect(call.url).toBe(`${ MANAGEMENT_URL }/services/search/jobs`)

      expect(call.headers).toEqual({
        'Authorization': `Bearer ${ AUTH_TOKEN }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(call.query).toEqual({ output_mode: 'json' })
      expect(call.body).toEqual({ search: 'search index=main error', exec_mode: 'normal' })
    })

    it('includes the time range and maps the blocking exec mode label', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).reply({ sid: 'sid-1' })

      await service.createSearchJob('search index=main', '-24h', 'now', 'Blocking (wait for completion)')

      expect(mock.history[0].body).toEqual({
        search: 'search index=main',
        earliest_time: '-24h',
        latest_time: 'now',
        exec_mode: 'blocking',
      })
    })

    it('passes an unmapped exec mode through unchanged', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).reply({ sid: 'sid-2' })

      await service.createSearchJob('search index=main', null, '', 'oneshot')

      expect(mock.history[0].body).toEqual({ search: 'search index=main', exec_mode: 'oneshot' })
    })

    it('surfaces Splunk message bodies as errors', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { messages: [{ type: 'FATAL', text: 'Search not executed' }, { type: 'INFO' }] },
      })

      await expect(service.createSearchJob('bad spl')).rejects.toThrow(
        'Splunk API error: Search not executed (status 400)'
      )
    })
  })

  describe('getSearchJobStatus', () => {
    it('gets the job by an encoded sid', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/search/jobs/a%20b`).reply({ entry: [{ name: 'a b' }] })

      const result = await service.getSearchJobStatus('a b')

      expect(result).toEqual({ entry: [{ name: 'a b' }] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toEqual({ 'Authorization': `Bearer ${ AUTH_TOKEN }` })
      expect(mock.history[0].query).toEqual({ output_mode: 'json' })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('getSearchResults', () => {
    it('applies the default count and offset', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/search/jobs/sid-1/results`).reply({ results: [] })

      await service.getSearchResults('sid-1')

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 100, offset: 0 })
    })

    it('keeps an explicit count of 0 and a custom offset', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/search/jobs/sid-1/results`).reply({ results: [] })

      await service.getSearchResults('sid-1', 0, 50)

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 0, offset: 50 })
    })
  })

  describe('runOneshotSearch', () => {
    it('dispatches a oneshot job with the default count', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).reply({ results: [{ host: 'web01' }] })

      const result = await service.runOneshotSearch('search index=main | head 1')

      expect(result).toEqual({ results: [{ host: 'web01' }] })
      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 100 })

      expect(mock.history[0].body).toEqual({
        search: 'search index=main | head 1',
        exec_mode: 'oneshot',
      })
    })

    it('passes the time range and an explicit count', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs`).reply({ results: [] })

      await service.runOneshotSearch('search index=main', '-1h', 'now', 5)

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 5 })

      expect(mock.history[0].body).toEqual({
        search: 'search index=main',
        earliest_time: '-1h',
        latest_time: 'now',
        exec_mode: 'oneshot',
      })
    })
  })

  describe('cancelSearchJob', () => {
    it('posts the cancel control action', async () => {
      mock.onPost(`${ MANAGEMENT_URL }/services/search/jobs/sid-1/control`).reply({ messages: [] })

      const result = await service.cancelSearchJob('sid-1')

      expect(result).toEqual({ messages: [] })
      expect(mock.history[0].body).toEqual({ action: 'cancel' })
      expect(mock.history[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    })
  })

  // ── Saved searches ──

  describe('listSavedSearches', () => {
    it('applies the default paging', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/saved/searches`).reply({ entry: [] })

      await service.listSavedSearches()

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 30, offset: 0 })
    })

    it('passes explicit paging values', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/saved/searches`).reply({ entry: [] })

      await service.listSavedSearches(0, 10)

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 0, offset: 10 })
    })
  })

  describe('getSavedSearch', () => {
    it('encodes the saved search name', async () => {
      mock
        .onGet(`${ MANAGEMENT_URL }/services/saved/searches/Errors%20last%2024h`)
        .reply({ entry: [{ name: 'Errors last 24h' }] })

      const result = await service.getSavedSearch('Errors last 24h')

      expect(result.entry[0].name).toBe('Errors last 24h')
    })
  })

  describe('runSavedSearch', () => {
    it('dispatches without overrides', async () => {
      mock
        .onPost(`${ MANAGEMENT_URL }/services/saved/searches/Nightly/dispatch`)
        .reply({ sid: 'scheduler__sid' })

      const result = await service.runSavedSearch('Nightly')

      expect(result).toEqual({ sid: 'scheduler__sid' })
      expect(mock.history[0].body).toEqual({})
    })

    it('sends the dispatch time overrides', async () => {
      mock
        .onPost(`${ MANAGEMENT_URL }/services/saved/searches/Nightly/dispatch`)
        .reply({ sid: 'sid' })

      await service.runSavedSearch('Nightly', '-1h', 'now')

      expect(mock.history[0].body).toEqual({
        'dispatch.earliest_time': '-1h',
        'dispatch.latest_time': 'now',
      })
    })
  })

  // ── HTTP Event Collector ──

  describe('sendEvent', () => {
    it('parses a JSON event payload into an object', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).reply({ text: 'Success', code: 0 })

      const result = await service.sendEvent('{"action":"login","user":"alice"}', '_json', 'main', 'web01', 1720000000)

      expect(result).toEqual({ text: 'Success', code: 0 })

      const call = mock.history[0]

      expect(call.url).toBe(`${ HEC_URL }/services/collector/event`)

      expect(call.headers).toEqual({
        'Authorization': `Splunk ${ HEC_TOKEN }`,
        'Content-Type': 'application/json',
      })

      expect(call.query).toEqual({})

      expect(call.body).toEqual({
        event: { action: 'login', user: 'alice' },
        sourcetype: '_json',
        index: 'main',
        host: 'web01',
        time: 1720000000,
      })
    })

    it('keeps a plain log line as a string and drops empty optionals', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).reply({ text: 'Success', code: 0 })

      await service.sendEvent('user alice logged in', '', null, undefined)

      expect(mock.history[0].body).toEqual({ event: 'user alice logged in' })
    })

    it('keeps malformed JSON-looking text as a string', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).reply({ text: 'Success', code: 0 })

      await service.sendEvent('  {not json  ')

      expect(mock.history[0].body).toEqual({ event: '  {not json  ' })
    })

    it('passes a non-string event through untouched', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).reply({ text: 'Success', code: 0 })

      await service.sendEvent({ already: 'object' })

      expect(mock.history[0].body).toEqual({ event: { already: 'object' } })
    })

    it('parses a JSON array payload', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).reply({ text: 'Success', code: 0 })

      await service.sendEvent('[1, 2, 3]')

      expect(mock.history[0].body).toEqual({ event: [1, 2, 3] })
    })

    it('throws when HEC is not configured', async () => {
      build({ managementUrl: MANAGEMENT_URL, authToken: AUTH_TOKEN })

      await expect(service.sendEvent('hello')).rejects.toThrow(
        'Splunk API error: HEC URL and HEC Token must be configured to send events.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('surfaces the HEC error text', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/event`).replyWithError({
        message: 'Forbidden',
        statusCode: 403,
        body: { text: 'Invalid token', code: 4 },
      })

      await expect(service.sendEvent('hello')).rejects.toThrow(
        'Splunk API error: Invalid token (status 403)'
      )
    })
  })

  describe('sendRawEvent', () => {
    it('posts the raw body as text/plain with cleaned query params', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/raw`).reply({ text: 'Success', code: 0 })

      const result = await service.sendRawEvent('line one\nline two', 'my:app:logs', 'main', '')

      expect(result).toEqual({ text: 'Success', code: 0 })

      const call = mock.history[0]

      expect(call.headers).toEqual({
        'Authorization': `Splunk ${ HEC_TOKEN }`,
        'Content-Type': 'text/plain',
      })

      expect(call.query).toEqual({ sourcetype: 'my:app:logs', index: 'main' })
      expect(call.body).toBe('line one\nline two')
    })

    it('throws when HEC is not configured', async () => {
      build({ managementUrl: MANAGEMENT_URL, authToken: AUTH_TOKEN })

      await expect(service.sendRawEvent('raw')).rejects.toThrow(
        'Splunk API error: HEC URL and HEC Token must be configured to send events.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('wraps transport errors that carry no response body', async () => {
      mock.onPost(`${ HEC_URL }/services/collector/raw`).replyWithError({ message: 'socket hang up' })

      await expect(service.sendRawEvent('raw')).rejects.toThrow('Splunk API error: socket hang up')
    })
  })

  // ── Indexes & server ──

  describe('listIndexes', () => {
    it('applies the default paging', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/data/indexes`).reply({ entry: [] })

      await service.listIndexes()

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 30, offset: 0 })
    })

    it('passes explicit paging values', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/data/indexes`).reply({ entry: [] })

      await service.listIndexes(5, 5)

      expect(mock.history[0].query).toEqual({ output_mode: 'json', count: 5, offset: 5 })
    })
  })

  describe('getIndex', () => {
    it('encodes the index name', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/data/indexes/_internal`).reply({ entry: [{ name: '_internal' }] })

      const result = await service.getIndex('_internal')

      expect(result.entry[0].name).toBe('_internal')
    })

    it('reports the raw error message when the body has no messages', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/data/indexes/missing`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { messages: [] },
      })

      await expect(service.getIndex('missing')).rejects.toThrow(
        'Splunk API error: Not Found (status 404)'
      )
    })
  })

  describe('getServerInfo', () => {
    it('gets the server info endpoint', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/server/info`).reply({ entry: [{ name: 'server-info' }] })

      const result = await service.getServerInfo()

      expect(result.entry[0].name).toBe('server-info')
      expect(mock.history[0].query).toEqual({ output_mode: 'json' })
    })

    it('reports an error without a status when none is provided', async () => {
      mock.onGet(`${ MANAGEMENT_URL }/services/server/info`).replyWithError({ message: 'ECONNREFUSED' })

      await expect(service.getServerInfo()).rejects.toThrow('Splunk API error: ECONNREFUSED')
    })
  })
})
