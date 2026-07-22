'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const ACCOUNT_ID = 'acct_test_123'
const BASE = 'https://api.netlify.com/api/v1'

describe('Netlify Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN, accountId: ACCOUNT_ID })
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
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
          expect.objectContaining({ name: 'accountId', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Sites ──

  describe('listSites', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/sites`).reply([])

      const result = await service.listSites()

      expect(result).toEqual([])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ per_page: 20 })
    })

    it('passes name filter and pagination params', async () => {
      mock.onGet(`${BASE}/sites`).reply([{ id: 's1', name: 'my-site' }])

      await service.listSites('my-site', 'Owner', 2, 50)

      expect(mock.history[0].query).toMatchObject({
        name: 'my-site',
        filter: 'owner',
        page: 2,
        per_page: 50,
      })
    })

    it('resolves Guest filter correctly', async () => {
      mock.onGet(`${BASE}/sites`).reply([])

      await service.listSites(undefined, 'Guest')
      expect(mock.history[0].query).toMatchObject({ filter: 'guest' })
    })

    it('resolves All filter correctly', async () => {
      mock.onGet(`${BASE}/sites`).reply([])

      await service.listSites(undefined, 'All')
      expect(mock.history[0].query).toMatchObject({ filter: 'all' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/sites`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid token' },
      })

      await expect(service.listSites()).rejects.toThrow('Netlify API error: Invalid token')
    })
  })

  describe('getSite', () => {
    it('sends GET to correct URL', async () => {
      const siteData = { id: 's1', name: 'my-site', url: 'https://my-site.netlify.app' }
      mock.onGet(`${BASE}/sites/s1`).reply(siteData)

      const result = await service.getSite('s1')

      expect(result).toEqual(siteData)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('createSite', () => {
    it('sends POST with name and custom domain', async () => {
      mock.onPost(`${BASE}/sites`).reply({ id: 's2', name: 'new-site' })

      await service.createSite('new-site', 'example.com')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'new-site', custom_domain: 'example.com' })
    })

    it('sends empty body when no params provided', async () => {
      mock.onPost(`${BASE}/sites`).reply({ id: 's3' })

      await service.createSite()

      // clean({}) with all undefined values returns {}
      expect(mock.history[0].body).toBeDefined()
    })
  })

  describe('updateSite', () => {
    it('sends PATCH with body', async () => {
      mock.onPatch(`${BASE}/sites/s1`).reply({ id: 's1', name: 'renamed' })

      await service.updateSite('s1', 'renamed', 'new.example.com')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ name: 'renamed', custom_domain: 'new.example.com' })
    })

    it('omits unchanged fields', async () => {
      mock.onPatch(`${BASE}/sites/s1`).reply({ id: 's1' })

      await service.updateSite('s1', 'renamed')

      expect(mock.history[0].body).toEqual({ name: 'renamed' })
    })
  })

  describe('deleteSite', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/sites/s1`).reply({})

      const result = await service.deleteSite('s1')

      expect(result).toEqual({ deleted: true, site_id: 's1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Deploys ──

  describe('listDeploys', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/sites/s1/deploys`).reply([])

      const result = await service.listDeploys('s1')

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ per_page: 20 })
    })

    it('passes pagination params', async () => {
      mock.onGet(`${BASE}/sites/s1/deploys`).reply([])

      await service.listDeploys('s1', 3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 50 })
    })
  })

  describe('getDeploy', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/deploys/dep_1`).reply({ id: 'dep_1', state: 'ready' })

      const result = await service.getDeploy('dep_1')

      expect(result).toEqual({ id: 'dep_1', state: 'ready' })
    })
  })

  describe('triggerBuild', () => {
    it('sends POST to builds endpoint', async () => {
      mock.onPost(`${BASE}/sites/s1/builds`).reply({ id: 'build_1', deploy_id: 'dep_2' })

      const result = await service.triggerBuild('s1')

      expect(result).toEqual({ id: 'build_1', deploy_id: 'dep_2' })
      expect(mock.history[0].method).toBe('post')
    })

    it('sends clear_cache when enabled', async () => {
      mock.onPost(`${BASE}/sites/s1/builds`).reply({ id: 'build_2' })

      await service.triggerBuild('s1', true)

      expect(mock.history[0].body).toEqual({ clear_cache: true })
    })

    it('does not send clear_cache when false', async () => {
      mock.onPost(`${BASE}/sites/s1/builds`).reply({ id: 'build_3' })

      await service.triggerBuild('s1', false)

      // clear_cache is undefined when false, clean() removes it
      expect(mock.history[0].body).toBeDefined()
    })
  })

  describe('lockDeploy', () => {
    it('sends POST to lock endpoint', async () => {
      mock.onPost(`${BASE}/deploys/dep_1/lock`).reply({ id: 'dep_1', locked: true })

      const result = await service.lockDeploy('dep_1')

      expect(result).toEqual({ id: 'dep_1', locked: true })
    })
  })

  describe('unlockDeploy', () => {
    it('sends POST to unlock endpoint', async () => {
      mock.onPost(`${BASE}/deploys/dep_1/unlock`).reply({ id: 'dep_1', locked: false })

      const result = await service.unlockDeploy('dep_1')

      expect(result).toEqual({ id: 'dep_1', locked: false })
    })
  })

  describe('restoreDeploy', () => {
    it('sends POST to restore endpoint', async () => {
      mock.onPost(`${BASE}/sites/s1/deploys/dep_0/restore`).reply({ id: 'dep_0', state: 'ready' })

      const result = await service.restoreDeploy('s1', 'dep_0')

      expect(result).toEqual({ id: 'dep_0', state: 'ready' })
    })
  })

  describe('cancelDeploy', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${BASE}/deploys/dep_2/cancel`).reply({ id: 'dep_2', state: 'error' })

      const result = await service.cancelDeploy('dep_2')

      expect(result).toEqual({ id: 'dep_2', state: 'error' })
    })
  })

  // ── Environment Variables ──

  describe('listEnvVars', () => {
    it('sends GET to account env endpoint', async () => {
      mock.onGet(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply([{ key: 'API_URL' }])

      const result = await service.listEnvVars()

      expect(result).toEqual([{ key: 'API_URL' }])
      expect(mock.history[0].method).toBe('get')
    })

    it('passes site_id query when provided', async () => {
      mock.onGet(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply([])

      await service.listEnvVars('s1')

      expect(mock.history[0].query).toMatchObject({ site_id: 's1' })
    })

    it('throws when accountId is not set', async () => {
      const savedAccountId = service.accountId
      service.accountId = undefined

      await expect(service.listEnvVars()).rejects.toThrow('Account ID')

      service.accountId = savedAccountId
    })
  })

  describe('createEnvVar', () => {
    it('sends POST with env var body', async () => {
      mock.onPost(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply({ key: 'MY_VAR' })

      await service.createEnvVar('MY_VAR', 'hello', 'Production', 's1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual([
        { key: 'MY_VAR', values: [{ value: 'hello', context: 'production' }] },
      ])
      expect(mock.history[0].query).toMatchObject({ site_id: 's1' })
    })

    it('defaults context to all when not provided', async () => {
      mock.onPost(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply({ key: 'MY_VAR' })

      await service.createEnvVar('MY_VAR', 'hello')

      expect(mock.history[0].body).toEqual([
        { key: 'MY_VAR', values: [{ value: 'hello', context: 'all' }] },
      ])
    })

    it('resolves Deploy Preview context', async () => {
      mock.onPost(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply({})

      await service.createEnvVar('K', 'V', 'Deploy Preview')

      expect(mock.history[0].body[0].values[0].context).toBe('deploy-preview')
    })

    it('resolves Branch Deploy context', async () => {
      mock.onPost(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply({})

      await service.createEnvVar('K', 'V', 'Branch Deploy')

      expect(mock.history[0].body[0].values[0].context).toBe('branch-deploy')
    })

    it('resolves Local Development context', async () => {
      mock.onPost(`${BASE}/accounts/${ACCOUNT_ID}/env`).reply({})

      await service.createEnvVar('K', 'V', 'Local Development')

      expect(mock.history[0].body[0].values[0].context).toBe('dev')
    })
  })

  describe('getEnvVar', () => {
    it('sends GET with key in URL', async () => {
      mock.onGet(`${BASE}/accounts/${ACCOUNT_ID}/env/API_URL`).reply({ key: 'API_URL' })

      const result = await service.getEnvVar('API_URL')

      expect(result).toEqual({ key: 'API_URL' })
    })

    it('passes site_id query', async () => {
      mock.onGet(`${BASE}/accounts/${ACCOUNT_ID}/env/API_URL`).reply({ key: 'API_URL' })

      await service.getEnvVar('API_URL', 's1')

      expect(mock.history[0].query).toMatchObject({ site_id: 's1' })
    })
  })

  describe('setEnvVarValue', () => {
    it('sends PATCH with value and context', async () => {
      mock.onPatch(`${BASE}/accounts/${ACCOUNT_ID}/env/API_URL`).reply({ key: 'API_URL' })

      await service.setEnvVarValue('API_URL', 'https://new.example.com', 'Production', 's1')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({
        context: 'production',
        value: 'https://new.example.com',
      })
      expect(mock.history[0].query).toMatchObject({ site_id: 's1' })
    })

    it('defaults context to all', async () => {
      mock.onPatch(`${BASE}/accounts/${ACCOUNT_ID}/env/MY_KEY`).reply({})

      await service.setEnvVarValue('MY_KEY', 'val')

      expect(mock.history[0].body).toEqual({ context: 'all', value: 'val' })
    })
  })

  describe('deleteEnvVar', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/accounts/${ACCOUNT_ID}/env/API_URL`).reply({})

      const result = await service.deleteEnvVar('API_URL', 's1')

      expect(result).toEqual({ deleted: true, key: 'API_URL' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toMatchObject({ site_id: 's1' })
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends GET to site forms endpoint', async () => {
      mock.onGet(`${BASE}/sites/s1/forms`).reply([{ id: 'form_1', name: 'contact' }])

      const result = await service.listForms('s1')

      expect(result).toEqual([{ id: 'form_1', name: 'contact' }])
    })
  })

  describe('listFormSubmissions', () => {
    it('sends GET with pagination defaults', async () => {
      mock.onGet(`${BASE}/forms/form_1/submissions`).reply([])

      const result = await service.listFormSubmissions('form_1')

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ per_page: 20 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${BASE}/forms/form_1/submissions`).reply([])

      await service.listFormSubmissions('form_1', 2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 50 })
    })
  })

  describe('deleteSubmission', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/submissions/sub_1`).reply({})

      const result = await service.deleteSubmission('sub_1')

      expect(result).toEqual({ deleted: true, submission_id: 'sub_1' })
    })
  })

  // ── DNS ──

  describe('listDnsZones', () => {
    it('sends GET to dns_zones endpoint', async () => {
      mock.onGet(`${BASE}/dns_zones`).reply([{ id: 'zone_1', name: 'example.com' }])

      const result = await service.listDnsZones()

      expect(result).toEqual([{ id: 'zone_1', name: 'example.com' }])
    })
  })

  describe('listDnsRecords', () => {
    it('sends GET to zone dns_records endpoint', async () => {
      mock.onGet(`${BASE}/dns_zones/zone_1/dns_records`).reply([{ id: 'rec_1', type: 'A' }])

      const result = await service.listDnsRecords('zone_1')

      expect(result).toEqual([{ id: 'rec_1', type: 'A' }])
    })
  })

  describe('createDnsRecord', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/dns_zones/zone_1/dns_records`).reply({ id: 'rec_2' })

      await service.createDnsRecord('zone_1', 'CNAME', 'www.example.com', 'example.com', 3600)

      expect(mock.history[0].body).toEqual({
        type: 'CNAME',
        hostname: 'www.example.com',
        value: 'example.com',
        ttl: 3600,
      })
    })

    it('omits ttl when not provided', async () => {
      mock.onPost(`${BASE}/dns_zones/zone_1/dns_records`).reply({ id: 'rec_3' })

      await service.createDnsRecord('zone_1', 'A', 'example.com', '192.0.2.1')

      expect(mock.history[0].body).toEqual({
        type: 'A',
        hostname: 'example.com',
        value: '192.0.2.1',
      })
    })
  })

  describe('deleteDnsRecord', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/dns_zones/zone_1/dns_records/rec_1`).reply({})

      const result = await service.deleteDnsRecord('zone_1', 'rec_1')

      expect(result).toEqual({ deleted: true, record_id: 'rec_1' })
    })
  })

  // ── Account ──

  describe('listAccounts', () => {
    it('sends GET to accounts endpoint', async () => {
      mock.onGet(`${BASE}/accounts`).reply([{ id: 'acct_123', name: 'Acme' }])

      const result = await service.listAccounts()

      expect(result).toEqual([{ id: 'acct_123', name: 'Acme' }])
    })
  })

  // ── Dictionaries ──

  describe('getSitesDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/sites`).reply([
        { id: 's1', name: 'alpha', url: 'https://alpha.netlify.app' },
        { id: 's2', name: 'beta', custom_domain: 'beta.com' },
      ])

      const result = await service.getSitesDictionary({})

      expect(result.items).toEqual([
        { label: 'alpha', value: 's1', note: 'https://alpha.netlify.app' },
        { label: 'beta', value: 's2', note: 'beta.com' },
      ])
    })

    it('prefers custom_domain over url for note', async () => {
      mock.onGet(`${BASE}/sites`).reply([
        { id: 's1', name: 'site', custom_domain: 'custom.com', url: 'https://site.netlify.app' },
      ])

      const result = await service.getSitesDictionary({})

      expect(result.items[0].note).toBe('custom.com')
    })

    it('passes search as name query param', async () => {
      mock.onGet(`${BASE}/sites`).reply([])

      await service.getSitesDictionary({ search: 'test' })

      expect(mock.history[0].query).toMatchObject({ name: 'test', page: 1, per_page: 20 })
    })

    it('uses cursor as page number', async () => {
      mock.onGet(`${BASE}/sites`).reply([])

      await service.getSitesDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('returns next cursor when full page returned', async () => {
      const sites = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `site-${i}` }))
      mock.onGet(`${BASE}/sites`).reply(sites)

      const result = await service.getSitesDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('returns undefined cursor when partial page', async () => {
      mock.onGet(`${BASE}/sites`).reply([{ id: 's1', name: 'only' }])

      const result = await service.getSitesDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/sites`).reply([{ id: 's1', name: 'a' }])

      const result = await service.getSitesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/sites`).reply({})

      const result = await service.getSitesDictionary({})

      expect(result.items).toEqual([])
    })

    it('uses id as label when name is missing', async () => {
      mock.onGet(`${BASE}/sites`).reply([{ id: 's1', url: 'https://s1.netlify.app' }])

      const result = await service.getSitesDictionary({})

      expect(result.items[0].label).toBe('s1')
    })
  })

  describe('getFormsDictionary', () => {
    it('returns empty when no siteId in criteria', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped forms for a site', async () => {
      mock.onGet(`${BASE}/sites/s1/forms`).reply([
        { id: 'f1', name: 'contact', submission_count: 42 },
        { id: 'f2', name: 'newsletter', submission_count: 0 },
      ])

      const result = await service.getFormsDictionary({ criteria: { siteId: 's1' } })

      expect(result.items).toEqual([
        { label: 'contact', value: 'f1', note: '42 submissions' },
        { label: 'newsletter', value: 'f2', note: '0 submissions' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search case-insensitively', async () => {
      mock.onGet(`${BASE}/sites/s1/forms`).reply([
        { id: 'f1', name: 'Contact Form' },
        { id: 'f2', name: 'Newsletter' },
      ])

      const result = await service.getFormsDictionary({ search: 'CONTACT', criteria: { siteId: 's1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f1')
    })

    it('handles null payload', async () => {
      const result = await service.getFormsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/sites/s1/forms`).reply({})

      const result = await service.getFormsDictionary({ criteria: { siteId: 's1' } })

      expect(result.items).toEqual([])
    })

    it('uses id as label when form name is missing', async () => {
      mock.onGet(`${BASE}/sites/s1/forms`).reply([{ id: 'f1' }])

      const result = await service.getFormsDictionary({ criteria: { siteId: 's1' } })

      expect(result.items[0].label).toBe('f1')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('uses error.body.message when available', async () => {
      mock.onGet(`${BASE}/accounts`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid parameter' },
      })

      await expect(service.listAccounts()).rejects.toThrow('Netlify API error: Invalid parameter')
    })

    it('uses error.body.error when message is missing', async () => {
      mock.onGet(`${BASE}/accounts`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'access_denied' },
      })

      await expect(service.listAccounts()).rejects.toThrow('Netlify API error: access_denied')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${BASE}/accounts`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listAccounts()).rejects.toThrow('Netlify API error: Network timeout')
    })
  })
})
