'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const ACCOUNT_ID = 'test-account-id'
const BASE = 'https://api.cloudflare.com/client/v4'
const ZONE_ID = 'zone123'
const RECORD_ID = 'rec456'
const NS_ID = 'ns789'

// Cloudflare wraps every JSON response in this envelope.
function envelope(result, extra = {}) {
  return { success: true, errors: [], messages: [], result, ...extra }
}

describe('Cloudflare Service', () => {
  let sandbox
  let service
  let mock
  let mainFlowrunner

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN, accountId: ACCOUNT_ID })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    // Capture the active global so suites that swap it can restore it.
    mainFlowrunner = global.Flowrunner
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
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accountId',
          displayName: 'Account ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Bearer auth and JSON content-type headers', async () => {
      mock.onGet(`${ BASE }/zones`).reply(envelope([], { result_info: { page: 1, total_pages: 1 } }))

      await service.listZones()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Zones ──

  describe('listZones', () => {
    it('sends default pagination and unwraps result + result_info', async () => {
      const zones = [{ id: 'z1', name: 'example.com', status: 'active' }]
      const info = { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 }
      mock.onGet(`${ BASE }/zones`).reply(envelope(zones, { result_info: info }))

      const result = await service.listZones()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
      expect(result).toEqual({ result: zones, result_info: info })
    })

    it('maps status choice and passes name/page/perPage', async () => {
      mock.onGet(`${ BASE }/zones`).reply(envelope([], { result_info: {} }))

      await service.listZones('example.com', 'Active', 2, 50)

      expect(mock.history[0].query).toEqual({
        name: 'example.com',
        status: 'active',
        page: 2,
        per_page: 50,
      })
    })

    it('passes an unmapped status value through unchanged', async () => {
      mock.onGet(`${ BASE }/zones`).reply(envelope([], { result_info: {} }))

      await service.listZones(undefined, 'custom-status')

      expect(mock.history[0].query).toMatchObject({ status: 'custom-status' })
    })

    it('throws a wrapped error on envelope failure', async () => {
      mock.onGet(`${ BASE }/zones`).reply({
        success: false,
        errors: [{ message: 'Invalid request headers' }],
      })

      await expect(service.listZones()).rejects.toThrow(
        'Cloudflare API error: Invalid request headers'
      )
    })

    it('throws a wrapped error on request rejection with body.errors', async () => {
      mock.onGet(`${ BASE }/zones`).replyWithError({
        message: 'Request failed',
        body: { errors: [{ message: 'Authentication error' }] },
      })

      await expect(service.listZones()).rejects.toThrow('Cloudflare API error: Authentication error')
    })
  })

  describe('getZone', () => {
    it('fetches a single zone and unwraps result', async () => {
      const zone = { id: ZONE_ID, name: 'example.com', status: 'active' }
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }`).reply(envelope(zone))

      const result = await service.getZone(ZONE_ID)

      expect(result).toEqual(zone)
      expect(mock.history[0].url).toBe(`${ BASE }/zones/${ ZONE_ID }`)
      expect(mock.history[0].method).toBe('get')
    })

    it('url-encodes the zone id', async () => {
      mock.onGet(`${ BASE }/zones/a%2Fb`).reply(envelope({ id: 'a/b' }))

      await service.getZone('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/zones/a%2Fb`)
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }`).replyWithError({
        message: 'Not found',
        body: { errors: [{ message: 'Zone not found' }] },
      })

      await expect(service.getZone(ZONE_ID)).rejects.toThrow('Cloudflare API error: Zone not found')
    })
  })

  describe('purgeCache', () => {
    it('sends purge_everything when purgeEverything is true and ignores other targets', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/purge_cache`).reply(envelope({ id: ZONE_ID }))

      const result = await service.purgeCache(ZONE_ID, true, ['https://x/a.png'], ['tag'])

      expect(result).toEqual({ id: ZONE_ID })
      expect(mock.history[0].url).toBe(`${ BASE }/zones/${ ZONE_ID }/purge_cache`)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ purge_everything: true })
    })

    it('sends only the provided non-empty targets', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/purge_cache`).reply(envelope({ id: ZONE_ID }))

      await service.purgeCache(
        ZONE_ID,
        false,
        ['https://example.com/logo.png'],
        [],
        ['assets.example.com'],
        undefined
      )

      expect(mock.history[0].body).toEqual({
        files: ['https://example.com/logo.png'],
        hosts: ['assets.example.com'],
      })
    })

    it('sends an empty body when no targets are provided', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/purge_cache`).reply(envelope({ id: ZONE_ID }))

      await service.purgeCache(ZONE_ID, false)

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on failure', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/purge_cache`).reply({
        success: false,
        errors: [{ message: 'You must provide something to purge' }],
      })

      await expect(service.purgeCache(ZONE_ID, false)).rejects.toThrow(
        'Cloudflare API error: You must provide something to purge'
      )
    })
  })

  // ── DNS Records ──

  describe('listDnsRecords', () => {
    it('sends default pagination and unwraps result + result_info', async () => {
      const records = [{ id: RECORD_ID, type: 'A', name: 'www.example.com', content: '198.51.100.4' }]
      const info = { page: 1, per_page: 20, total_pages: 1 }
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(envelope(records, { result_info: info }))

      const result = await service.listDnsRecords(ZONE_ID)

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
      expect(result).toEqual({ result: records, result_info: info })
    })

    it('passes all filters when provided', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(envelope([], { result_info: {} }))

      await service.listDnsRecords(ZONE_ID, 'A', 'www.example.com', '198.51.100.4', 3, 100)

      expect(mock.history[0].query).toEqual({
        type: 'A',
        name: 'www.example.com',
        content: '198.51.100.4',
        page: 3,
        per_page: 100,
      })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Invalid zone' }] },
      })

      await expect(service.listDnsRecords(ZONE_ID)).rejects.toThrow('Cloudflare API error: Invalid zone')
    })
  })

  describe('createDnsRecord', () => {
    it('sends required params with default ttl of 1', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(envelope({ id: RECORD_ID }))

      const result = await service.createDnsRecord(ZONE_ID, 'A', 'www.example.com', '198.51.100.4')

      expect(result).toEqual({ id: RECORD_ID })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        type: 'A',
        name: 'www.example.com',
        content: '198.51.100.4',
        ttl: 1,
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(envelope({ id: RECORD_ID }))

      await service.createDnsRecord(ZONE_ID, 'MX', 'example.com', 'mail.example.com', 3600, true, 10, 'note')

      expect(mock.history[0].body).toEqual({
        type: 'MX',
        name: 'example.com',
        content: 'mail.example.com',
        ttl: 3600,
        proxied: true,
        priority: 10,
        comment: 'note',
      })
    })

    it('keeps proxied:false in the body (clean() only strips undefined/null/empty)', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(envelope({ id: RECORD_ID }))

      await service.createDnsRecord(ZONE_ID, 'A', 'x', '1.1.1.1', undefined, false)

      // clean() only strips undefined/null/'' — boolean false is kept.
      expect(mock.history[0].body).toEqual({
        type: 'A',
        name: 'x',
        content: '1.1.1.1',
        ttl: 1,
        proxied: false,
      })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onPost(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply({
        success: false,
        errors: [{ message: 'Record already exists' }],
      })

      await expect(
        service.createDnsRecord(ZONE_ID, 'A', 'x', '1.1.1.1')
      ).rejects.toThrow('Cloudflare API error: Record already exists')
    })
  })

  describe('getDnsRecord', () => {
    it('fetches a single record and unwraps result', async () => {
      const record = { id: RECORD_ID, type: 'A', name: 'www.example.com' }
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope(record))

      const result = await service.getDnsRecord(ZONE_ID, RECORD_ID)

      expect(result).toEqual(record)
      expect(mock.history[0].url).toBe(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`)
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Record not found' }] },
      })

      await expect(service.getDnsRecord(ZONE_ID, RECORD_ID)).rejects.toThrow(
        'Cloudflare API error: Record not found'
      )
    })
  })

  describe('updateDnsRecord', () => {
    it('sends a PUT with required params and default ttl', async () => {
      mock.onPut(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope({ id: RECORD_ID }))

      const result = await service.updateDnsRecord(ZONE_ID, RECORD_ID, 'A', 'www.example.com', '198.51.100.5')

      expect(result).toEqual({ id: RECORD_ID })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        type: 'A',
        name: 'www.example.com',
        content: '198.51.100.5',
        ttl: 1,
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPut(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope({ id: RECORD_ID }))

      await service.updateDnsRecord(ZONE_ID, RECORD_ID, 'A', 'x', '1.1.1.1', 3600, false, 5, 'c')

      expect(mock.history[0].body).toEqual({
        type: 'A',
        name: 'x',
        content: '1.1.1.1',
        ttl: 3600,
        proxied: false,
        priority: 5,
        comment: 'c',
      })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onPut(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Invalid content' }] },
      })

      await expect(
        service.updateDnsRecord(ZONE_ID, RECORD_ID, 'A', 'x', 'bad')
      ).rejects.toThrow('Cloudflare API error: Invalid content')
    })
  })

  describe('patchDnsRecord', () => {
    it('sends a PATCH with only the provided fields (no default ttl)', async () => {
      mock.onPatch(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope({ id: RECORD_ID }))

      const result = await service.patchDnsRecord(ZONE_ID, RECORD_ID, undefined, undefined, undefined, undefined, false)

      expect(result).toEqual({ id: RECORD_ID })
      expect(mock.history[0].method).toBe('patch')
      // patch does not default ttl; only proxied:false survives clean()
      expect(mock.history[0].body).toEqual({ proxied: false })
    })

    it('includes all provided fields', async () => {
      mock.onPatch(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope({ id: RECORD_ID }))

      await service.patchDnsRecord(ZONE_ID, RECORD_ID, 'CNAME', 'alias', 'target.example.com', 120, true, 1, 'c')

      expect(mock.history[0].body).toEqual({
        type: 'CNAME',
        name: 'alias',
        content: 'target.example.com',
        ttl: 120,
        proxied: true,
        priority: 1,
        comment: 'c',
      })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onPatch(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Bad patch' }] },
      })

      await expect(
        service.patchDnsRecord(ZONE_ID, RECORD_ID, 'A')
      ).rejects.toThrow('Cloudflare API error: Bad patch')
    })
  })

  describe('deleteDnsRecord', () => {
    it('sends a DELETE and unwraps result', async () => {
      mock.onDelete(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).reply(envelope({ id: RECORD_ID }))

      const result = await service.deleteDnsRecord(ZONE_ID, RECORD_ID)

      expect(result).toEqual({ id: RECORD_ID })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on failure', async () => {
      mock.onDelete(`${ BASE }/zones/${ ZONE_ID }/dns_records/${ RECORD_ID }`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Cannot delete' }] },
      })

      await expect(service.deleteDnsRecord(ZONE_ID, RECORD_ID)).rejects.toThrow(
        'Cloudflare API error: Cannot delete'
      )
    })
  })

  // ── Rulesets ──

  describe('listRulesets', () => {
    it('lists rulesets and unwraps the result array', async () => {
      const rulesets = [{ id: 'rs1', name: 'Managed', phase: 'http_request_firewall_managed' }]
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/rulesets`).reply(envelope(rulesets))

      const result = await service.listRulesets(ZONE_ID)

      expect(result).toEqual(rulesets)
      expect(mock.history[0].url).toBe(`${ BASE }/zones/${ ZONE_ID }/rulesets`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/rulesets`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'No access' }] },
      })

      await expect(service.listRulesets(ZONE_ID)).rejects.toThrow('Cloudflare API error: No access')
    })
  })

  describe('getRuleset', () => {
    it('fetches a single ruleset and unwraps result', async () => {
      const ruleset = { id: 'rs1', name: 'Managed', rules: [] }
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/rulesets/rs1`).reply(envelope(ruleset))

      const result = await service.getRuleset(ZONE_ID, 'rs1')

      expect(result).toEqual(ruleset)
      expect(mock.history[0].url).toBe(`${ BASE }/zones/${ ZONE_ID }/rulesets/rs1`)
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/rulesets/rs1`).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Ruleset not found' }] },
      })

      await expect(service.getRuleset(ZONE_ID, 'rs1')).rejects.toThrow(
        'Cloudflare API error: Ruleset not found'
      )
    })
  })

  // ── Workers KV ──

  describe('listKvNamespaces', () => {
    const nsUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces`

    it('sends default pagination and unwraps result + result_info', async () => {
      const namespaces = [{ id: NS_ID, title: 'My Namespace' }]
      const info = { page: 1, per_page: 20, total_pages: 1 }
      mock.onGet(nsUrl).reply(envelope(namespaces, { result_info: info }))

      const result = await service.listKvNamespaces()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 20 })
      expect(result).toEqual({ result: namespaces, result_info: info })
    })

    it('passes custom pagination', async () => {
      mock.onGet(nsUrl).reply(envelope([], { result_info: {} }))

      await service.listKvNamespaces(2, 100)

      expect(mock.history[0].query).toEqual({ page: 2, per_page: 100 })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(nsUrl).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'KV disabled' }] },
      })

      await expect(service.listKvNamespaces()).rejects.toThrow('Cloudflare API error: KV disabled')
    })
  })

  describe('listKvKeys', () => {
    const keysUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces/${ NS_ID }/keys`

    it('sends the request and unwraps result + result_info', async () => {
      const keys = [{ name: 'user:123' }]
      const info = { count: 1, cursor: 'abc' }
      mock.onGet(keysUrl).reply(envelope(keys, { result_info: info }))

      const result = await service.listKvKeys(NS_ID)

      // prefix/limit/cursor undefined -> stripped by clean()
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ result: keys, result_info: info })
    })

    it('passes prefix, limit and cursor when provided', async () => {
      mock.onGet(keysUrl).reply(envelope([], { result_info: {} }))

      await service.listKvKeys(NS_ID, 'user:', 100, 'cur123')

      expect(mock.history[0].query).toEqual({ prefix: 'user:', limit: 100, cursor: 'cur123' })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(keysUrl).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'Namespace not found' }] },
      })

      await expect(service.listKvKeys(NS_ID)).rejects.toThrow('Cloudflare API error: Namespace not found')
    })
  })

  describe('getKvValue', () => {
    const valueUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces/${ NS_ID }/values/mykey`

    it('returns the raw stored value wrapped in { value }', async () => {
      mock.onGet(valueUrl).reply('hello world')

      const result = await service.getKvValue(NS_ID, 'mykey')

      expect(result).toEqual({ value: 'hello world' })
      expect(mock.history[0].url).toBe(valueUrl)
    })

    it('url-encodes the key', async () => {
      mock.onGet(`${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces/${ NS_ID }/values/a%2Fb`).reply('v')

      const result = await service.getKvValue(NS_ID, 'a/b')

      expect(result).toEqual({ value: 'v' })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(valueUrl).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'key not found' }] },
      })

      await expect(service.getKvValue(NS_ID, 'mykey')).rejects.toThrow(
        'Cloudflare API error: key not found'
      )
    })
  })

  describe('putKvValue', () => {
    const valueUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces/${ NS_ID }/values/mykey`

    it('writes a value via multipart form and returns success', async () => {
      mock.onPut(valueUrl).reply({ success: true })

      const result = await service.putKvValue(NS_ID, 'mykey', 'the-value')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ API_TOKEN }` })
      // value + metadata fields appended to the form
      const fields = mock.history[0].formData._fields
      expect(fields).toEqual([
        { name: 'value', value: 'the-value', filename: undefined },
        { name: 'metadata', value: '{}', filename: undefined },
      ])
      // no expiration ttl -> empty query
      expect(mock.history[0].query).toEqual({})
    })

    it('passes expiration_ttl as a query param when provided', async () => {
      mock.onPut(valueUrl).reply({ success: true })

      await service.putKvValue(NS_ID, 'mykey', 'v', 3600)

      expect(mock.history[0].query).toEqual({ expiration_ttl: 3600 })
    })

    it('throws when the envelope reports success:false', async () => {
      mock.onPut(valueUrl).reply({ success: false, errors: [{ message: 'invalid expiration' }] })

      await expect(service.putKvValue(NS_ID, 'mykey', 'v')).rejects.toThrow(
        'Cloudflare API error: invalid expiration'
      )
    })

    it('throws a wrapped error on request rejection', async () => {
      mock.onPut(valueUrl).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'write failed' }] },
      })

      await expect(service.putKvValue(NS_ID, 'mykey', 'v')).rejects.toThrow(
        'Cloudflare API error: write failed'
      )
    })
  })

  describe('deleteKvValue', () => {
    const valueUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces/${ NS_ID }/values/mykey`

    it('deletes the key and returns success', async () => {
      mock.onDelete(valueUrl).reply(envelope(null))

      const result = await service.deleteKvValue(NS_ID, 'mykey')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(valueUrl)
    })

    it('throws a wrapped error on failure', async () => {
      mock.onDelete(valueUrl).replyWithError({
        message: 'boom',
        body: { errors: [{ message: 'delete failed' }] },
      })

      await expect(service.deleteKvValue(NS_ID, 'mykey')).rejects.toThrow(
        'Cloudflare API error: delete failed'
      )
    })
  })

  // ── Account ID requirement ──

  describe('account id requirement', () => {
    let noAccountSandbox
    let noAccountService

    beforeAll(() => {
      // Re-register the service in a fresh sandbox without an accountId.
      // The module is cached after the first require, so use jest.isolateModules
      // to re-run addService against the new sandbox global.
      noAccountSandbox = createSandbox({ apiToken: API_TOKEN })
      jest.isolateModules(() => {
        require('../src/index.js')
      })
      noAccountService = noAccountSandbox.getService()
    })

    afterAll(() => {
      noAccountSandbox.cleanup()
      // Restore the primary sandbox's global so later suites keep working.
      global.Flowrunner = mainFlowrunner
    })

    it('throws for listKvNamespaces without an account id', async () => {
      await expect(noAccountService.listKvNamespaces()).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })

    it('throws for listKvKeys without an account id', async () => {
      await expect(noAccountService.listKvKeys(NS_ID)).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })

    it('throws for getKvValue without an account id', async () => {
      await expect(noAccountService.getKvValue(NS_ID, 'k')).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })

    it('throws for putKvValue without an account id', async () => {
      await expect(noAccountService.putKvValue(NS_ID, 'k', 'v')).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })

    it('throws for deleteKvValue without an account id', async () => {
      await expect(noAccountService.deleteKvValue(NS_ID, 'k')).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })

    it('throws for getKvNamespacesDictionary without an account id', async () => {
      await expect(noAccountService.getKvNamespacesDictionary({})).rejects.toThrow(
        'This operation requires an Account ID'
      )
    })
  })

  // ── Dictionaries ──

  describe('getZonesDictionary', () => {
    it('maps zones to items and requests page 1 by default', async () => {
      mock.onGet(`${ BASE }/zones`).reply(
        envelope(
          [
            { id: 'z1', name: 'a.com', status: 'active' },
            { id: 'z2', name: 'b.com', status: 'pending' },
          ],
          { result_info: { page: 1, total_pages: 1 } }
        )
      )

      const result = await service.getZonesDictionary({})

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
      expect(result.items).toEqual([
        { label: 'a.com', value: 'z1', note: 'active' },
        { label: 'b.com', value: 'z2', note: 'pending' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('passes search as name filter', async () => {
      mock.onGet(`${ BASE }/zones`).reply(envelope([], { result_info: { page: 1, total_pages: 1 } }))

      await service.getZonesDictionary({ search: 'example.com' })

      expect(mock.history[0].query).toMatchObject({ name: 'example.com' })
    })

    it('uses the cursor as the page number and returns a next cursor when more pages exist', async () => {
      mock.onGet(`${ BASE }/zones`).reply(
        envelope([{ id: 'z1', name: 'a.com', status: 'active' }], {
          result_info: { page: 2, total_pages: 5 },
        })
      )

      const result = await service.getZonesDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
      expect(result.cursor).toBe('3')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/zones`).reply(envelope([], { result_info: { page: 1, total_pages: 1 } }))

      const result = await service.getZonesDictionary(null)

      expect(result.items).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })
  })

  describe('getDnsRecordsDictionary', () => {
    it('returns empty items without a zone id in criteria', async () => {
      const result = await service.getDnsRecordsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })

    it('maps records for a given zone', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(
        envelope(
          [
            { id: 'r1', name: 'www.example.com', type: 'A', content: '198.51.100.4' },
            { id: 'r2', name: 'mail.example.com', type: 'MX', content: 'mx.example.com' },
          ],
          { result_info: { page: 1, total_pages: 1 } }
        )
      )

      const result = await service.getDnsRecordsDictionary({ criteria: { zoneId: ZONE_ID } })

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
      expect(result.items).toEqual([
        { label: 'www.example.com', value: 'r1', note: 'A - 198.51.100.4' },
        { label: 'mail.example.com', value: 'r2', note: 'MX - mx.example.com' },
      ])
    })

    it('passes search as name filter and cursor as page', async () => {
      mock.onGet(`${ BASE }/zones/${ ZONE_ID }/dns_records`).reply(
        envelope([], { result_info: { page: 3, total_pages: 4 } })
      )

      const result = await service.getDnsRecordsDictionary({
        search: 'www',
        cursor: '3',
        criteria: { zoneId: ZONE_ID },
      })

      expect(mock.history[0].query).toMatchObject({ name: 'www', page: 3 })
      expect(result.cursor).toBe('4')
    })
  })

  describe('getKvNamespacesDictionary', () => {
    const nsUrl = `${ BASE }/accounts/${ ACCOUNT_ID }/storage/kv/namespaces`

    it('maps namespaces to items', async () => {
      mock.onGet(nsUrl).reply(
        envelope(
          [
            { id: 'ns1', title: 'Alpha' },
            { id: 'ns2', title: 'Beta' },
          ],
          { result_info: { page: 1, total_pages: 1 } }
        )
      )

      const result = await service.getKvNamespacesDictionary({})

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
      expect(result.items).toEqual([
        { label: 'Alpha', value: 'ns1', note: undefined },
        { label: 'Beta', value: 'ns2', note: undefined },
      ])
    })

    it('filters namespaces client-side by search term', async () => {
      mock.onGet(nsUrl).reply(
        envelope(
          [
            { id: 'ns1', title: 'Alpha' },
            { id: 'ns2', title: 'Beta' },
          ],
          { result_info: { page: 1, total_pages: 1 } }
        )
      )

      const result = await service.getKvNamespacesDictionary({ search: 'beta' })

      expect(result.items).toEqual([{ label: 'Beta', value: 'ns2', note: undefined }])
    })

    it('returns a next cursor when more pages exist', async () => {
      mock.onGet(nsUrl).reply(
        envelope([{ id: 'ns1', title: 'Alpha' }], { result_info: { page: 1, total_pages: 3 } })
      )

      const result = await service.getKvNamespacesDictionary({ cursor: '1' })

      expect(result.cursor).toBe('2')
    })
  })
})
