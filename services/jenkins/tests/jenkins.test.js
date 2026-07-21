'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'https://jenkins.example.com'
const USERNAME = 'admin'
const API_TOKEN = 'test-api-token'
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ USERNAME }:${ API_TOKEN }`).toString('base64') }`

describe('Jenkins Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, username: USERNAME, apiToken: API_TOKEN })
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
          name: 'baseUrl',
          displayName: 'Jenkins URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'username',
          displayName: 'Username',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Basic auth header derived from username:apiToken', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })

      await service.listJobs()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: EXPECTED_AUTH,
      })
    })
  })

  // ── CSRF Crumb (must run before other POST tests to avoid cached crumb) ──

  describe('CSRF crumb handling', () => {
    it('fetches and includes crumb header on write requests when crumb issuer is enabled', async () => {
      mock.onGet(`${ BASE_URL }/crumbIssuer/api/json`).reply({
        crumbRequestField: 'Jenkins-Crumb',
        crumb: 'abc123',
      })
      mock.onPost(`${ BASE_URL }/job/my-app/enable`).reply(undefined)

      await service.enableJob('my-app')

      expect(mock.history).toHaveLength(2)
      // First request is the crumb fetch
      expect(mock.history[0].url).toBe(`${ BASE_URL }/crumbIssuer/api/json`)
      // Second request is the POST with crumb header
      expect(mock.history[1].headers).toMatchObject({
        'Jenkins-Crumb': 'abc123',
        Authorization: EXPECTED_AUTH,
      })
    })

    it('caches the crumb and reuses it on subsequent write requests', async () => {
      // Crumb is already cached from previous test, no crumb fetch should happen
      mock.onPost(`${ BASE_URL }/job/my-app/disable`).reply(undefined)

      await service.disableJob('my-app')

      // Only 1 request (the POST), no additional crumb fetch
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Jenkins-Crumb': 'abc123',
      })
    })

    it('does not fetch crumb for GET requests', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })

      await service.listJobs()

      // Only 1 request, no crumb fetch
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).not.toHaveProperty('Jenkins-Crumb')
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('lists top-level jobs without sub-folders by default', async () => {
      const mockResponse = {
        jobs: [
          { name: 'my-app', url: `${ BASE_URL }/job/my-app/`, color: 'blue' },
        ],
      }

      mock.onGet(`${ BASE_URL }/api/json`).reply(mockResponse)
      const result = await service.listJobs()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ tree: 'jobs[name,url,color]' })
      expect(mock.history[0].headers).toMatchObject({ Accept: 'application/json' })
    })

    it('uses recursive tree query when includeFolders is true', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })
      await service.listJobs(true)

      expect(mock.history[0].query).toMatchObject({
        tree: 'jobs[name,url,color,jobs[name,url,color,jobs[name,url,color]]]',
      })
    })

    it('uses flat tree query when includeFolders is false', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })
      await service.listJobs(false)

      expect(mock.history[0].query).toMatchObject({ tree: 'jobs[name,url,color]' })
    })
  })

  describe('getJob', () => {
    it('fetches job details for a simple job name', async () => {
      const mockJob = { name: 'my-app', buildable: true, color: 'blue' }

      mock.onGet(`${ BASE_URL }/job/my-app/api/json`).reply(mockJob)
      const result = await service.getJob('my-app')

      expect(result).toEqual(mockJob)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: EXPECTED_AUTH })
    })

    it('handles folder paths correctly', async () => {
      mock.onGet(`${ BASE_URL }/job/folder/job/sub-job/api/json`).reply({ name: 'sub-job' })
      await service.getJob('folder/sub-job')

      expect(mock.history).toHaveLength(1)
    })

    it('throws when job path is empty', async () => {
      await expect(service.getJob('')).rejects.toThrow('A job name or path is required')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE_URL }/job/missing/api/json`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getJob('missing')).rejects.toThrow('Jenkins API error')
    })
  })

  describe('getJobConfig', () => {
    it('fetches config.xml as text and wraps in object', async () => {
      const xmlContent = '<?xml version="1.0"?><project/>'

      // isText path uses .setEncoding(null).unwrapBody(false) so response shape is { body }
      mock.onGet(`${ BASE_URL }/job/my-app/config.xml`).reply({ body: xmlContent })
      const result = await service.getJobConfig('my-app')

      expect(result).toEqual({ jobPath: 'my-app', configXml: xmlContent })
      expect(mock.history[0].headers).toMatchObject({ Accept: 'application/xml' })
      expect(mock.history[0].encoding).toBeNull()
    })
  })

  describe('createJob', () => {
    const configXml = '<?xml version="1.0"?><project/>'

    it('creates a job at top level', async () => {
      mock.onPost(`${ BASE_URL }/createItem`).reply(undefined)

      const result = await service.createJob('new-job', configXml)

      expect(result).toEqual({ created: true, name: 'new-job', folderPath: null })
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({ name: 'new-job' })
      expect(postCall.body).toBe(configXml)
      expect(postCall.headers).toMatchObject({
        'Content-Type': 'application/xml',
        Authorization: EXPECTED_AUTH,
      })
    })

    it('creates a job inside a folder', async () => {
      mock.onPost(`${ BASE_URL }/job/my-folder/createItem`).reply(undefined)

      const result = await service.createJob('new-job', configXml, 'my-folder')

      expect(result).toEqual({ created: true, name: 'new-job', folderPath: 'my-folder' })
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({ name: 'new-job' })
    })
  })

  describe('copyJob', () => {
    it('copies a job at top level', async () => {
      mock.onPost(`${ BASE_URL }/createItem`).reply(undefined)

      const result = await service.copyJob('copy-job', 'source-job')

      expect(result).toEqual({ copied: true, name: 'copy-job', from: 'source-job', folderPath: null })
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({
        name: 'copy-job',
        mode: 'copy',
        from: 'source-job',
      })
    })

    it('copies a job inside a folder', async () => {
      mock.onPost(`${ BASE_URL }/job/my-folder/createItem`).reply(undefined)

      const result = await service.copyJob('copy-job', 'source-job', 'my-folder')

      expect(result).toEqual({
        copied: true,
        name: 'copy-job',
        from: 'source-job',
        folderPath: 'my-folder',
      })
    })
  })

  describe('enableJob', () => {
    it('enables a job and returns confirmation', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/enable`).reply(undefined)

      const result = await service.enableJob('my-app')

      expect(result).toEqual({ enabled: true, jobPath: 'my-app' })
    })
  })

  describe('disableJob', () => {
    it('disables a job and returns confirmation', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/disable`).reply(undefined)

      const result = await service.disableJob('my-app')

      expect(result).toEqual({ disabled: true, jobPath: 'my-app' })
    })
  })

  describe('deleteJob', () => {
    it('deletes a job and returns confirmation', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/doDelete`).reply(undefined)

      const result = await service.deleteJob('my-app')

      expect(result).toEqual({ deleted: true, jobPath: 'my-app' })
    })
  })

  // ── Builds ──

  describe('triggerBuild', () => {
    it('triggers a plain build without parameters', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/build`).reply({
        headers: { location: `${ BASE_URL }/queue/item/531/` },
        body: null,
      })

      const result = await service.triggerBuild('my-app')

      expect(result).toMatchObject({
        triggered: true,
        jobPath: 'my-app',
        parameterized: false,
      })
    })

    it('triggers a parameterized build', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/buildWithParameters`).reply({
        headers: { location: `${ BASE_URL }/queue/item/532/` },
        body: null,
      })

      const result = await service.triggerBuild('my-app', { BRANCH: 'main', DEPLOY: 'true' })

      expect(result).toMatchObject({
        triggered: true,
        jobPath: 'my-app',
        parameterized: true,
      })
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({ BRANCH: 'main', DEPLOY: 'true' })
    })

    it('extracts queueItemId from Location header', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/build`).reply({
        headers: { location: `${ BASE_URL }/queue/item/531/` },
        body: null,
      })

      const result = await service.triggerBuild('my-app')

      expect(result.queueLocation).toBe(`${ BASE_URL }/queue/item/531/`)
      expect(result.queueItemId).toBe(531)
    })

    it('handles missing Location header gracefully', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/build`).reply({
        headers: {},
        body: null,
      })

      const result = await service.triggerBuild('my-app')

      expect(result.queueLocation).toBeNull()
      expect(result.queueItemId).toBeNull()
    })

    it('converts object parameter values to JSON strings', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/buildWithParameters`).reply({
        headers: {},
        body: null,
      })

      await service.triggerBuild('my-app', { config: { nested: true } })

      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({
        config: '{"nested":true}',
      })
    })

    it('does not trigger parameterized build for empty parameters object', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/build`).reply({
        headers: {},
        body: null,
      })

      const result = await service.triggerBuild('my-app', {})

      expect(result.parameterized).toBe(false)
    })
  })

  describe('getBuild', () => {
    it('fetches build details by number', async () => {
      const mockBuild = { number: 42, result: 'SUCCESS', building: false }

      mock.onGet(`${ BASE_URL }/job/my-app/42/api/json`).reply(mockBuild)
      const result = await service.getBuild('my-app', '42')

      expect(result).toEqual(mockBuild)
    })

    it('accepts build aliases like lastBuild', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/lastBuild/api/json`).reply({ number: 42 })
      const result = await service.getBuild('my-app', 'lastBuild')

      expect(result).toEqual({ number: 42 })
    })
  })

  describe('getBuildConsoleOutput', () => {
    it('returns console text wrapped in an object', async () => {
      const logText = 'Started by user admin\nFinished: SUCCESS\n'

      // isText uses .setEncoding(null).unwrapBody(false) so response shape is { body }
      mock.onGet(`${ BASE_URL }/job/my-app/42/consoleText`).reply({ body: logText })
      const result = await service.getBuildConsoleOutput('my-app', '42')

      expect(result).toEqual({
        jobPath: 'my-app',
        buildNumber: '42',
        consoleOutput: logText,
      })
      expect(mock.history[0].headers).toMatchObject({ Accept: 'text/plain' })
      expect(mock.history[0].encoding).toBeNull()
    })
  })

  describe('getBuildLogTail', () => {
    const fullLog = Array.from({ length: 100 }, (_, i) => `line ${ i + 1 }`).join('\n')

    it('returns last 50 lines by default', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/lastBuild/consoleText`).reply({ body: fullLog })
      const result = await service.getBuildLogTail('my-app', 'lastBuild')

      expect(result.lines).toBe(50)
      expect(result.totalLines).toBe(100)
      expect(result.jobPath).toBe('my-app')
      expect(result.buildNumber).toBe('lastBuild')
    })

    it('returns custom number of lines', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/lastBuild/consoleText`).reply({ body: fullLog })
      const result = await service.getBuildLogTail('my-app', 'lastBuild', 10)

      expect(result.lines).toBe(10)
      expect(result.logTail).toContain('line 91')
      expect(result.logTail).toContain('line 100')
    })

    it('caps lines at 1000', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/lastBuild/consoleText`).reply({ body: fullLog })
      const result = await service.getBuildLogTail('my-app', 'lastBuild', 5000)

      expect(result.lines).toBe(1000)
    })

    it('defaults to 50 for invalid line count', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/lastBuild/consoleText`).reply({ body: fullLog })
      const result = await service.getBuildLogTail('my-app', 'lastBuild', -1)

      expect(result.lines).toBe(50)
    })
  })

  describe('stopBuild', () => {
    it('stops a build and returns confirmation', async () => {
      mock.onPost(`${ BASE_URL }/job/my-app/42/stop`).reply(undefined)

      const result = await service.stopBuild('my-app', '42')

      expect(result).toEqual({ stopped: true, jobPath: 'my-app', buildNumber: '42' })
    })
  })

  // ── Queue ──

  describe('getQueue', () => {
    it('returns queue items', async () => {
      const mockQueue = { items: [{ id: 531, blocked: false }] }

      mock.onGet(`${ BASE_URL }/queue/api/json`).reply(mockQueue)
      const result = await service.getQueue()

      expect(result).toEqual(mockQueue)
      expect(mock.history[0].headers).toMatchObject({ Accept: 'application/json' })
    })
  })

  describe('cancelQueueItem', () => {
    it('cancels a queue item and returns confirmation', async () => {
      mock.onPost(`${ BASE_URL }/queue/cancelItem`).reply(undefined)

      const result = await service.cancelQueueItem(531)

      expect(result).toEqual({ cancelled: true, id: 531 })
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.query).toMatchObject({ id: 531 })
    })
  })

  // ── System ──

  describe('getJenkinsInfo', () => {
    it('extracts version from X-Jenkins header and parses body', async () => {
      // rawResponse path uses .setEncoding(null).unwrapBody(false), response is the raw object
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        headers: { 'x-jenkins': '2.452.3' },
        body: {
          mode: 'NORMAL',
          nodeName: '',
          numExecutors: 2,
          quietingDown: false,
          useSecurity: true,
          jobs: [{ name: 'my-app', url: `${ BASE_URL }/job/my-app/`, color: 'blue' }],
        },
      })

      const result = await service.getJenkinsInfo()

      expect(result).toEqual({
        version: '2.452.3',
        mode: 'NORMAL',
        nodeName: '',
        numExecutors: 2,
        quietingDown: false,
        useSecurity: true,
        jobs: [{ name: 'my-app', url: `${ BASE_URL }/job/my-app/`, color: 'blue' }],
      })
      expect(mock.history[0].encoding).toBeNull()
    })

    it('returns null version when X-Jenkins header is missing', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        headers: {},
        body: { mode: 'NORMAL', jobs: [] },
      })

      const result = await service.getJenkinsInfo()

      expect(result.version).toBeNull()
    })
  })

  describe('getViews', () => {
    it('returns views with tree query', async () => {
      const mockViews = {
        views: [
          { name: 'all', url: `${ BASE_URL }/` },
          { name: 'Deployments', url: `${ BASE_URL }/view/Deployments/` },
        ],
      }

      mock.onGet(`${ BASE_URL }/api/json`).reply(mockViews)
      const result = await service.getViews()

      expect(result).toEqual(mockViews)
      expect(mock.history[0].query).toMatchObject({ tree: 'views[name,url]' })
    })
  })

  // ── Dictionaries ──

  describe('getJobsDictionary', () => {
    it('returns dictionary items from jobs list', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        jobs: [
          { name: 'my-app', url: `${ BASE_URL }/job/my-app/`, color: 'blue', _class: 'hudson.model.FreeStyleProject' },
          { name: 'nightly', url: `${ BASE_URL }/job/nightly/`, color: 'red', _class: 'hudson.model.FreeStyleProject' },
        ],
      })

      const result = await service.getJobsDictionary({})

      expect(result.items).toEqual([
        { label: 'my-app', value: 'my-app', note: 'blue' },
        { label: 'nightly', value: 'nightly', note: 'red' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters jobs by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        jobs: [
          { name: 'my-app', color: 'blue', _class: 'x' },
          { name: 'nightly', color: 'red', _class: 'x' },
        ],
      })

      const result = await service.getJobsDictionary({ search: 'NIGHT' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('nightly')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        jobs: [
          { name: 'a', color: 'blue', _class: 'x' },
          { name: 'b', color: 'red', _class: 'x' },
        ],
      })

      const result = await service.getJobsDictionary({ search: '' })

      expect(result.items).toHaveLength(2)
    })

    it('marks folders with a descriptive note', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({
        jobs: [
          { name: 'my-folder', _class: 'com.cloudbees.hudson.plugins.folder.Folder', color: null },
        ],
      })

      const result = await service.getJobsDictionary({})

      expect(result.items[0].note).toBe('folder (open and use folder/job path)')
    })

    it('handles null payload gracefully', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })

      const result = await service.getJobsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses correct tree query', async () => {
      mock.onGet(`${ BASE_URL }/api/json`).reply({ jobs: [] })

      await service.getJobsDictionary({})

      expect(mock.history[0].query).toMatchObject({
        tree: 'jobs[name,url,color,_class]',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('appends auth hint for 401 errors', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/api/json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getJob('my-app')).rejects.toThrow('Check that your username and API token')
    })

    it('appends not-found hint for 404 errors', async () => {
      mock.onGet(`${ BASE_URL }/job/missing/api/json`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getJob('missing')).rejects.toThrow('not found')
    })

    it('sanitizes HTML error messages', async () => {
      mock.onGet(`${ BASE_URL }/job/broken/api/json`).replyWithError({
        message: '<html><body>Error</body></html>',
        status: 500,
      })

      await expect(service.getJob('broken')).rejects.toThrow('Jenkins returned an error page')
    })
  })

  // ── Job path handling ──

  describe('job path encoding', () => {
    it('encodes special characters in job names', async () => {
      mock.onGet(`${ BASE_URL }/job/my%20app/api/json`).reply({ name: 'my app' })
      await service.getJob('my app')

      expect(mock.history).toHaveLength(1)
    })

    it('handles nested folder paths with multiple segments', async () => {
      mock.onGet(`${ BASE_URL }/job/a/job/b/job/c/api/json`).reply({ name: 'c' })
      await service.getJob('a/b/c')

      expect(mock.history).toHaveLength(1)
    })

    it('strips leading and trailing slashes', async () => {
      mock.onGet(`${ BASE_URL }/job/my-app/api/json`).reply({ name: 'my-app' })
      await service.getJob('/my-app/')

      expect(mock.history).toHaveLength(1)
    })
  })
})
