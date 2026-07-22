'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-rundeck-token'
const SERVER_URL = 'https://rundeck.example.com'
const API_VERSION = '47'
const BASE = `${SERVER_URL}/api/${API_VERSION}`

const AUTH_HEADERS = {
  'X-Rundeck-Auth-Token': API_TOKEN,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
}

describe('Rundeck Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: SERVER_URL, apiToken: API_TOKEN, apiVersion: API_VERSION })
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
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
          expect.objectContaining({ name: 'apiVersion', required: false, shared: false, defaultValue: '47' }),
        ])
      )
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    const projectsUrl = `${BASE}/projects`

    it('sends correct request and returns all projects', async () => {
      const mockProjects = [
        { name: 'production', description: 'Prod' },
        { name: 'staging', description: 'Stage' },
      ]

      mock.onGet(projectsUrl).reply(mockProjects)
      const result = await service.listProjects()

      expect(result).toEqual(mockProjects)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })

    it('filters projects by case-insensitive search', async () => {
      mock.onGet(projectsUrl).reply([
        { name: 'production', description: 'Prod' },
        { name: 'staging', description: 'Stage' },
      ])

      const result = await service.listProjects('PROD')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('production')
    })

    it('returns all projects when search is empty string', async () => {
      mock.onGet(projectsUrl).reply([{ name: 'a' }, { name: 'b' }])

      const result = await service.listProjects('')

      expect(result).toHaveLength(2)
    })

    it('returns non-array response as-is when no search', async () => {
      mock.onGet(projectsUrl).reply({ error: 'unexpected' })

      const result = await service.listProjects()

      expect(result).toEqual({ error: 'unexpected' })
    })

    it('returns non-array response as-is even with search', async () => {
      mock.onGet(projectsUrl).reply({ error: 'unexpected' })

      const result = await service.listProjects('test')

      expect(result).toEqual({ error: 'unexpected' })
    })

    it('throws on API error', async () => {
      mock.onGet(projectsUrl).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid token', errorCode: 'api.error.api-token.invalid' },
        status: 401,
      })

      await expect(service.listProjects()).rejects.toThrow('Rundeck API error')
    })
  })

  describe('getProject', () => {
    it('sends correct request with encoded project name', async () => {
      const mockProject = { name: 'my project', description: 'Test' }

      mock.onGet(`${BASE}/project/my%20project`).reply(mockProject)
      const result = await service.getProject('my project')

      expect(result).toEqual(mockProject)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('sends correct request with all parameters', async () => {
      const mockJobs = [{ id: 'job-1', name: 'Deploy' }]

      mock.onGet(`${BASE}/project/production/jobs`).reply(mockJobs)
      const result = await service.listJobs('production', 'Deploy', 'deploy')

      expect(result).toEqual(mockJobs)
      expect(mock.history[0].query).toMatchObject({ jobFilter: 'Deploy', groupPath: 'deploy' })
    })

    it('omits optional parameters when not provided', async () => {
      mock.onGet(`${BASE}/project/production/jobs`).reply([])
      await service.listJobs('production')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getJobDefinition', () => {
    it('sends correct request with format=json query', async () => {
      const mockDef = [{ id: 'job-1', name: 'Deploy', sequence: { commands: [] } }]

      mock.onGet(`${BASE}/job/job-1`).reply(mockDef)
      const result = await service.getJobDefinition('job-1')

      expect(result).toEqual(mockDef)
      expect(mock.history[0].query).toMatchObject({ format: 'json' })
    })
  })

  describe('runJob', () => {
    const runUrl = `${BASE}/job/job-1/executions`

    it('sends POST with options object', async () => {
      const mockExecution = { id: 42, status: 'running' }

      mock.onPost(runUrl).reply(mockExecution)
      const result = await service.runJob('job-1', { version: '1.2.3', env: 'prod' })

      expect(result).toEqual(mockExecution)
      expect(mock.history[0].body).toMatchObject({
        options: { version: '1.2.3', env: 'prod' },
      })
      // argString should NOT be in body when options provided
      expect(mock.history[0].body.argString).toBeUndefined()
    })

    it('sends argString when options is not provided', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', undefined, '-version 1.2.3')

      expect(mock.history[0].body).toMatchObject({ argString: '-version 1.2.3' })
      expect(mock.history[0].body.options).toBeUndefined()
    })

    it('ignores argString when options is provided', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', { version: '1.0' }, '-version 2.0')

      expect(mock.history[0].body.options).toEqual({ version: '1.0' })
      expect(mock.history[0].body.argString).toBeUndefined()
    })

    it('sends all optional parameters', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', { v: '1' }, undefined, 'tags: web', 'Debug', 'admin', '2026-11-23T12:20:55-0800')

      expect(mock.history[0].body).toMatchObject({
        options: { v: '1' },
        filter: 'tags: web',
        loglevel: 'DEBUG',
        asUser: 'admin',
        runAtTime: '2026-11-23T12:20:55-0800',
      })
    })

    it('maps log level labels to API values', async () => {
      const levels = [
        ['Debug', 'DEBUG'],
        ['Verbose', 'VERBOSE'],
        ['Info', 'INFO'],
        ['Warn', 'WARN'],
        ['Error', 'ERROR'],
      ]

      for (const [label, expected] of levels) {
        mock.reset()
        mock.onPost(runUrl).reply({ id: 42 })
        await service.runJob('job-1', undefined, undefined, undefined, label)

        expect(mock.history[0].body).toMatchObject({ loglevel: expected })
      }
    })

    it('normalizes empty options object to undefined', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', {}, '-arg val')

      // empty object should be normalized away, so argString should be used
      expect(mock.history[0].body).toMatchObject({ argString: '-arg val' })
      expect(mock.history[0].body.options).toBeUndefined()
    })

    it('normalizes non-object options (array) to undefined', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', ['bad'], '-arg val')

      expect(mock.history[0].body).toMatchObject({ argString: '-arg val' })
      expect(mock.history[0].body.options).toBeUndefined()
    })

    it('normalizes null options to undefined', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1', null, '-arg val')

      expect(mock.history[0].body).toMatchObject({ argString: '-arg val' })
      expect(mock.history[0].body.options).toBeUndefined()
    })

    it('sends minimal body when no optional params', async () => {
      mock.onPost(runUrl).reply({ id: 42 })
      await service.runJob('job-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('retryJobExecution', () => {
    const retryUrl = `${BASE}/job/job-1/retry/99`

    it('sends POST with correct path and body', async () => {
      mock.onPost(retryUrl).reply({ id: 43, status: 'running' })
      const result = await service.retryJobExecution('job-1', 99, { v: '2' }, undefined, true, 'admin')

      expect(result).toEqual({ id: 43, status: 'running' })
      expect(mock.history[0].body).toMatchObject({
        options: { v: '2' },
        failedNodes: true,
        asUser: 'admin',
      })
    })

    it('sends argString when options not provided', async () => {
      mock.onPost(retryUrl).reply({ id: 43 })
      await service.retryJobExecution('job-1', 99, undefined, '-v 2')

      expect(mock.history[0].body).toMatchObject({ argString: '-v 2' })
    })

    it('sends failedNodes=false explicitly', async () => {
      mock.onPost(retryUrl).reply({ id: 43 })
      await service.retryJobExecution('job-1', 99, undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ failedNodes: false })
    })
  })

  // ── Executions ──

  describe('getExecution', () => {
    it('sends correct GET request', async () => {
      const mockExec = { id: 42, status: 'succeeded' }

      mock.onGet(`${BASE}/execution/42`).reply(mockExec)
      const result = await service.getExecution(42)

      expect(result).toEqual(mockExec)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getExecutionState', () => {
    it('sends correct GET request', async () => {
      const mockState = { executionId: 42, completed: true, executionState: 'SUCCEEDED' }

      mock.onGet(`${BASE}/execution/42/state`).reply(mockState)
      const result = await service.getExecutionState(42)

      expect(result).toEqual(mockState)
    })
  })

  describe('getExecutionOutput', () => {
    it('sends correct request with all params', async () => {
      const mockOutput = { id: '42', entries: [{ log: 'hello' }] }

      mock.onGet(`${BASE}/execution/42/output`).reply(mockOutput)
      const result = await service.getExecutionOutput(42, 1024, 50)

      expect(result).toEqual(mockOutput)
      expect(mock.history[0].query).toMatchObject({ offset: 1024, maxlines: 50 })
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(`${BASE}/execution/42/output`).reply({ id: '42', entries: [] })
      await service.getExecutionOutput(42)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('abortExecution', () => {
    it('sends POST with asUser in query', async () => {
      const mockAbort = { abort: { status: 'pending' }, execution: { id: '42', status: 'running' } }

      mock.onPost(`${BASE}/execution/42/abort`).reply(mockAbort)
      const result = await service.abortExecution(42, 'admin')

      expect(result).toEqual(mockAbort)
      expect(mock.history[0].query).toMatchObject({ asUser: 'admin' })
    })

    it('omits asUser when not provided', async () => {
      mock.onPost(`${BASE}/execution/42/abort`).reply({ abort: { status: 'pending' } })
      await service.abortExecution(42)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('listProjectExecutions', () => {
    const execsUrl = `${BASE}/project/production/executions`

    it('sends correct request with defaults', async () => {
      const mockResult = { paging: { count: 0, total: 0 }, executions: [] }

      mock.onGet(execsUrl).reply(mockResult)
      const result = await service.listProjectExecutions('production')

      expect(result).toEqual(mockResult)
      expect(mock.history[0].query).toMatchObject({ max: 20 })
    })

    it('sends all filter parameters', async () => {
      mock.onGet(execsUrl).reply({ paging: {}, executions: [] })
      await service.listProjectExecutions('production', ['id-1', 'id-2'], 'Succeeded', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        jobIdListFilter: 'id-1,id-2',
        statusFilter: 'succeeded',
        max: 10,
        offset: 5,
      })
    })

    it('maps status filter labels to API values', async () => {
      const statusMap = [
        ['Running', 'running'],
        ['Succeeded', 'succeeded'],
        ['Failed', 'failed'],
        ['Aborted', 'aborted'],
        ['Timed Out', 'timedout'],
        ['Failed With Retry', 'failed-with-retry'],
        ['Scheduled', 'scheduled'],
      ]

      for (const [label, expected] of statusMap) {
        mock.reset()
        mock.onGet(execsUrl).reply({ paging: {}, executions: [] })
        await service.listProjectExecutions('production', undefined, label)

        expect(mock.history[0].query).toMatchObject({ statusFilter: expected })
      }
    })

    it('handles string jobIdListFilter', async () => {
      mock.onGet(execsUrl).reply({ paging: {}, executions: [] })
      await service.listProjectExecutions('production', 'single-id')

      expect(mock.history[0].query).toMatchObject({ jobIdListFilter: 'single-id' })
    })

    it('filters out empty job IDs from array', async () => {
      mock.onGet(execsUrl).reply({ paging: {}, executions: [] })
      await service.listProjectExecutions('production', ['id-1', '', null, 'id-2'])

      expect(mock.history[0].query).toMatchObject({ jobIdListFilter: 'id-1,id-2' })
    })
  })

  describe('deleteExecution', () => {
    it('sends DELETE request and returns result', async () => {
      mock.onDelete(`${BASE}/execution/42`).reply({ success: true })
      const result = await service.deleteExecution(42)

      expect(result).toEqual({ success: true })
    })

    it('returns fallback success object on empty response (204)', async () => {
      mock.onDelete(`${BASE}/execution/42`).reply(null)
      const result = await service.deleteExecution(42)

      expect(result).toEqual({ success: true, message: 'Execution 42 deleted' })
    })

    it('returns fallback success object on undefined response', async () => {
      mock.onDelete(`${BASE}/execution/42`).reply(undefined)
      const result = await service.deleteExecution(42)

      expect(result).toEqual({ success: true, message: 'Execution 42 deleted' })
    })
  })

  // ── Adhoc ──

  describe('runAdhocCommand', () => {
    const cmdUrl = `${BASE}/project/production/run/command`

    it('sends POST with required params', async () => {
      const mockResult = { execution: { id: 44 }, message: 'Scheduled' }

      mock.onPost(cmdUrl).reply(mockResult)
      const result = await service.runAdhocCommand('production', 'echo hello')

      expect(result).toEqual(mockResult)
      expect(mock.history[0].body).toMatchObject({
        project: 'production',
        exec: 'echo hello',
      })
    })

    it('sends all optional params', async () => {
      mock.onPost(cmdUrl).reply({ execution: { id: 44 } })
      await service.runAdhocCommand('production', 'echo hi', 'tags: web', 4, true, 'admin')

      expect(mock.history[0].body).toMatchObject({
        project: 'production',
        exec: 'echo hi',
        filter: 'tags: web',
        nodeThreadcount: 4,
        nodeKeepgoing: true,
        asUser: 'admin',
      })
    })

    it('sends nodeKeepgoing=false explicitly', async () => {
      mock.onPost(cmdUrl).reply({ execution: { id: 44 } })
      await service.runAdhocCommand('production', 'echo hi', undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ nodeKeepgoing: false })
    })
  })

  describe('runAdhocScript', () => {
    const scriptUrl = `${BASE}/project/production/run/script`

    it('sends POST with required params', async () => {
      mock.onPost(scriptUrl).reply({ execution: { id: 45 } })
      const result = await service.runAdhocScript('production', '#!/bin/bash\necho hello')

      expect(result).toEqual({ execution: { id: 45 } })
      expect(mock.history[0].body).toMatchObject({
        project: 'production',
        script: '#!/bin/bash\necho hello',
      })
    })

    it('sends all optional params', async () => {
      mock.onPost(scriptUrl).reply({ execution: { id: 45 } })
      await service.runAdhocScript('production', 'echo hi', '-name val', 'tags: web', '/bin/bash', 4, true, 'admin')

      expect(mock.history[0].body).toMatchObject({
        project: 'production',
        script: 'echo hi',
        argString: '-name val',
        filter: 'tags: web',
        scriptInterpreter: '/bin/bash',
        nodeThreadcount: 4,
        nodeKeepgoing: true,
        asUser: 'admin',
      })
    })
  })

  // ── System ──

  describe('getSystemInfo', () => {
    it('sends correct GET request', async () => {
      const mockInfo = { system: { rundeck: { version: '5.0.0' } } }

      mock.onGet(`${BASE}/system/info`).reply(mockInfo)
      const result = await service.getSystemInfo()

      expect(result).toEqual(mockInfo)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    const projectsUrl = `${BASE}/projects`

    it('returns mapped items with label and value', async () => {
      mock.onGet(projectsUrl).reply([
        { name: 'production', description: 'Prod env' },
        { name: 'staging', description: '' },
      ])

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'production', value: 'production', note: 'Prod env' },
          { label: 'staging', value: 'staging' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(projectsUrl).reply([
        { name: 'production' },
        { name: 'staging' },
      ])

      const result = await service.getProjectsDictionary({ search: 'PROD' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('production')
    })

    it('handles null payload', async () => {
      mock.onGet(projectsUrl).reply([{ name: 'a' }])

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles non-array response', async () => {
      mock.onGet(projectsUrl).reply(null)

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getJobsDictionary', () => {
    const jobsUrl = `${BASE}/project/production/jobs`

    it('returns mapped items with group/name label', async () => {
      mock.onGet(jobsUrl).reply([
        { id: 'uuid-1', name: 'Deploy', group: 'deploy', description: 'Deploys app' },
        { id: 'uuid-2', name: 'Test', group: '', description: '' },
      ])

      const result = await service.getJobsDictionary({ criteria: { project: 'production' } })

      expect(result).toEqual({
        items: [
          { label: 'deploy/Deploy', value: 'uuid-1', note: 'Deploys app' },
          { label: 'Test', value: 'uuid-2' },
        ],
        cursor: null,
      })
    })

    it('passes search as jobFilter query param', async () => {
      mock.onGet(jobsUrl).reply([])
      await service.getJobsDictionary({ search: 'deploy', criteria: { project: 'production' } })

      expect(mock.history[0].query).toMatchObject({ jobFilter: 'deploy' })
    })

    it('returns empty items when no project in criteria', async () => {
      const result = await service.getJobsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getJobsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles non-array response', async () => {
      mock.onGet(jobsUrl).reply(null)

      const result = await service.getJobsDictionary({ criteria: { project: 'production' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes errorCode in error message when present', async () => {
      mock.onGet(`${BASE}/projects`).replyWithError({
        message: 'Not Found',
        body: { message: 'Project not found', errorCode: 'api.error.item.doesnotexist' },
        status: 404,
      })

      await expect(service.listProjects()).rejects.toThrow('Rundeck API error (api.error.item.doesnotexist): Project not found')
    })

    it('uses error.message when body is missing', async () => {
      mock.onGet(`${BASE}/projects`).replyWithError({ message: 'Network timeout' })

      await expect(service.listProjects()).rejects.toThrow('Rundeck API error: Network timeout')
    })

    it('falls back to default message when no body message', async () => {
      mock.onGet(`${BASE}/projects`).replyWithError({})

      await expect(service.listProjects()).rejects.toThrow('Rundeck API error')
    })
  })

  // ── Constructor ──

  describe('constructor', () => {
    it('builds correct base URL from config', async () => {
      // The sandbox was created with url=https://rundeck.example.com, apiVersion=47
      // Verify the service sends requests to the correct base URL
      mock.onGet(`${BASE}/system/info`).reply({ system: {} })
      await service.getSystemInfo()

      expect(mock.history[0].url).toBe(`${BASE}/system/info`)
    })
  })
})
