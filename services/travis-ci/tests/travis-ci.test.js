'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-travis-token'
const BASE = 'https://api.travis-ci.com'

const AUTH_HEADERS = {
  'Authorization': `token ${API_TOKEN}`,
  'Travis-API-Version': '3',
  'Content-Type': 'application/json',
}

describe('Travis CI Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
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
          expect.objectContaining({ name: 'domain', required: true, shared: false }),
        ])
      )
    })

    it('has domain config with CHOICE type and correct options', () => {
      const configs = sandbox.getConfigItems()
      const domainConfig = configs.find(c => c.name === 'domain')

      expect(domainConfig.defaultValue).toBe('travis-ci.com')
      expect(domainConfig.options).toEqual(['travis-ci.com', 'travis-ci.org'])
    })
  })

  // ── Repositories ──

  describe('listRepositories', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      const result = await service.listRepositories()

      expect(result).toEqual({ '@type': 'repositories', repositories: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes activeOnly as string true', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      await service.listRepositories(true)

      expect(mock.history[0].query).toMatchObject({ active_only: 'true' })
    })

    it('omits active_only when false', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      await service.listRepositories(false)

      expect(mock.history[0].query.active_only).toBeUndefined()
    })

    it('passes limit and offset', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      await service.listRepositories(false, 10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('resolves sortBy choices correctly', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      await service.listRepositories(false, undefined, undefined, 'Last Build (Newest)')

      expect(mock.history[0].query).toMatchObject({ sort_by: 'current_build:desc' })
    })

    it('omits sort_by for Default choice', async () => {
      mock.onGet(`${BASE}/repos`).reply({ '@type': 'repositories', repositories: [] })

      await service.listRepositories(false, undefined, undefined, 'Default')

      expect(mock.history[0].query.sort_by).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/repos`).replyWithError({
        message: 'Unauthorized',
        body: { error_message: 'Invalid token' },
        status: 403,
      })

      await expect(service.listRepositories()).rejects.toThrow('Travis CI API error')
    })
  })

  describe('getRepository', () => {
    it('encodes slug in URL', async () => {
      mock.onGet(`${BASE}/repo/owner%2Fmy-project`).reply({ '@type': 'repository', id: 123 })

      const result = await service.getRepository('owner/my-project')

      expect(result).toMatchObject({ '@type': 'repository', id: 123 })
      expect(mock.history[0].url).toBe(`${BASE}/repo/owner%2Fmy-project`)
    })

    it('throws when slug is missing', async () => {
      await expect(service.getRepository()).rejects.toThrow('repository slug (owner/name) is required')
    })

    it('trims whitespace from slug', async () => {
      mock.onGet(`${BASE}/repo/owner%2Frepo`).reply({ '@type': 'repository', id: 1 })

      await service.getRepository('  owner/repo  ')

      expect(mock.history[0].url).toBe(`${BASE}/repo/owner%2Frepo`)
    })
  })

  describe('activateRepository', () => {
    it('sends POST to activate endpoint', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/activate`).reply({ '@type': 'repository', active: true })

      const result = await service.activateRepository('owner/repo')

      expect(result).toMatchObject({ active: true })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('deactivateRepository', () => {
    it('sends POST to deactivate endpoint', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/deactivate`).reply({ '@type': 'repository', active: false })

      const result = await service.deactivateRepository('owner/repo')

      expect(result).toMatchObject({ active: false })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('starRepository', () => {
    it('sends POST to star endpoint', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/star`).reply({ '@type': 'repository', starred: true })

      const result = await service.starRepository('owner/repo')

      expect(result).toMatchObject({ starred: true })
    })
  })

  describe('unstarRepository', () => {
    it('sends POST to unstar endpoint', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/unstar`).reply({ '@type': 'repository', starred: false })

      const result = await service.unstarRepository('owner/repo')

      expect(result).toMatchObject({ starred: false })
    })
  })

  // ── Builds ──

  describe('listBuilds', () => {
    it('sends GET with encoded slug and sort', async () => {
      mock.onGet(`${BASE}/repo/owner%2Frepo/builds`).reply({ '@type': 'builds', builds: [] })

      await service.listBuilds('owner/repo', 'Newest First', 5, 0)

      expect(mock.history[0].query).toMatchObject({
        sort_by: 'number:desc',
        limit: 5,
        offset: 0,
      })
    })

    it('resolves all sort choices', async () => {
      const sortTests = [
        ['Oldest First', 'number:asc'],
        ['Recently Started', 'started_at:desc'],
        ['Recently Finished', 'finished_at:desc'],
      ]

      for (const [choice, expected] of sortTests) {
        mock.onGet(`${BASE}/repo/owner%2Frepo/builds`).reply({ '@type': 'builds', builds: [] })
        await service.listBuilds('owner/repo', choice)
        expect(mock.history[mock.history.length - 1].query).toMatchObject({ sort_by: expected })
      }
    })
  })

  describe('getBuild', () => {
    it('sends GET with build ID', async () => {
      mock.onGet(`${BASE}/build/456`).reply({ '@type': 'build', id: 456, state: 'passed' })

      const result = await service.getBuild(456)

      expect(result).toMatchObject({ id: 456, state: 'passed' })
      expect(mock.history[0].url).toBe(`${BASE}/build/456`)
    })
  })

  describe('cancelBuild', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${BASE}/build/456/cancel`).reply({ '@type': 'pending', state_change: 'cancel' })

      const result = await service.cancelBuild(456)

      expect(result).toMatchObject({ state_change: 'cancel' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('restartBuild', () => {
    it('sends POST to restart endpoint', async () => {
      mock.onPost(`${BASE}/build/456/restart`).reply({ '@type': 'pending', state_change: 'restart' })

      const result = await service.restartBuild(456)

      expect(result).toMatchObject({ state_change: 'restart' })
    })
  })

  describe('triggerBuild', () => {
    it('sends POST with branch and message', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/requests`).reply({ '@type': 'pending', remaining_requests: 10 })

      await service.triggerBuild('owner/repo', 'main', 'Test build')

      expect(mock.history[0].body).toEqual({
        request: {
          branch: 'main',
          message: 'Test build',
        },
      })
    })

    it('sends POST with config override', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/requests`).reply({ '@type': 'pending' })

      await service.triggerBuild('owner/repo', 'main', 'Test', { language: 'node_js' })

      expect(mock.history[0].body).toEqual({
        request: {
          branch: 'main',
          message: 'Test',
          config: { language: 'node_js' },
        },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/requests`).reply({ '@type': 'pending' })

      await service.triggerBuild('owner/repo', 'main')

      expect(mock.history[0].body).toEqual({
        request: {
          branch: 'main',
        },
      })
    })
  })

  // ── Jobs ──

  describe('listBuildJobs', () => {
    it('sends GET with build ID', async () => {
      mock.onGet(`${BASE}/build/456/jobs`).reply({ '@type': 'jobs', jobs: [{ id: 789 }] })

      const result = await service.listBuildJobs(456)

      expect(result).toMatchObject({ '@type': 'jobs' })
      expect(result.jobs).toHaveLength(1)
    })
  })

  describe('getJob', () => {
    it('sends GET with job ID', async () => {
      mock.onGet(`${BASE}/job/789`).reply({ '@type': 'job', id: 789, state: 'passed' })

      const result = await service.getJob(789)

      expect(result).toMatchObject({ id: 789, state: 'passed' })
    })
  })

  describe('restartJob', () => {
    it('sends POST to restart endpoint', async () => {
      mock.onPost(`${BASE}/job/789/restart`).reply({ '@type': 'pending', state_change: 'restart' })

      const result = await service.restartJob(789)

      expect(result).toMatchObject({ state_change: 'restart' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('cancelJob', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${BASE}/job/789/cancel`).reply({ '@type': 'pending', state_change: 'cancel' })

      const result = await service.cancelJob(789)

      expect(result).toMatchObject({ state_change: 'cancel' })
    })
  })

  describe('getJobLog', () => {
    it('sends GET with raw encoding and returns log text', async () => {
      const logBuffer = Buffer.from('$ echo hello\nhello\nDone.\n')

      mock.onGet(`${BASE}/job/789/log.txt`).reply(logBuffer)

      const result = await service.getJobLog(789)

      expect(result).toEqual({ jobId: 789, log: '$ echo hello\nhello\nDone.\n' })
      expect(mock.history[0].encoding).toBeNull()
    })

    it('handles string response', async () => {
      mock.onGet(`${BASE}/job/789/log.txt`).reply('plain text log')

      const result = await service.getJobLog(789)

      expect(result).toEqual({ jobId: 789, log: 'plain text log' })
    })
  })

  // ── Environment Variables ──

  describe('listEnvVars', () => {
    it('sends GET to env_vars endpoint', async () => {
      mock.onGet(`${BASE}/repo/owner%2Frepo/env_vars`).reply({ '@type': 'env_vars', env_vars: [] })

      const result = await service.listEnvVars('owner/repo')

      expect(result).toMatchObject({ '@type': 'env_vars' })
    })
  })

  describe('createEnvVar', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/env_vars`).reply({ '@type': 'env_var', id: 'abc', name: 'MY_VAR' })

      const result = await service.createEnvVar('owner/repo', 'MY_VAR', 'secret123', false)

      expect(mock.history[0].body).toEqual({
        'env_var.name': 'MY_VAR',
        'env_var.value': 'secret123',
        'env_var.public': false,
      })
      expect(result).toMatchObject({ name: 'MY_VAR' })
    })

    it('includes public flag when true', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/env_vars`).reply({ '@type': 'env_var', id: 'abc' })

      await service.createEnvVar('owner/repo', 'MY_VAR', 'val', true)

      expect(mock.history[0].body['env_var.public']).toBe(true)
    })

    it('includes branch when provided', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/env_vars`).reply({ '@type': 'env_var', id: 'abc' })

      await service.createEnvVar('owner/repo', 'MY_VAR', 'val', false, 'main')

      expect(mock.history[0].body['env_var.branch']).toBe('main')
    })

    it('omits branch when not provided', async () => {
      mock.onPost(`${BASE}/repo/owner%2Frepo/env_vars`).reply({ '@type': 'env_var', id: 'abc' })

      await service.createEnvVar('owner/repo', 'MY_VAR', 'val', false)

      expect(mock.history[0].body).not.toHaveProperty('env_var.branch')
    })
  })

  describe('deleteEnvVar', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/repo/owner%2Frepo/env_var/abc123`).reply({})

      const result = await service.deleteEnvVar('owner/repo', 'abc123')

      expect(result).toEqual({ deleted: true, envVarId: 'abc123' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Branches & Caches ──

  describe('listBranches', () => {
    it('sends GET to branches endpoint', async () => {
      mock.onGet(`${BASE}/repo/owner%2Frepo/branches`).reply({ '@type': 'branches', branches: [] })

      const result = await service.listBranches('owner/repo')

      expect(result).toMatchObject({ '@type': 'branches' })
    })
  })

  describe('listCaches', () => {
    it('sends GET to caches endpoint', async () => {
      mock.onGet(`${BASE}/repo/owner%2Frepo/caches`).reply({ '@type': 'caches', caches: [] })

      const result = await service.listCaches('owner/repo')

      expect(result).toMatchObject({ '@type': 'caches' })
    })
  })

  // ── User ──

  describe('getCurrentUser', () => {
    it('sends GET to /user', async () => {
      mock.onGet(`${BASE}/user`).reply({ '@type': 'user', id: 42, login: 'octocat' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ '@type': 'user', id: 42, login: 'octocat' })
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes error_type in error message', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({
        message: 'Not Found',
        body: { error_type: 'not_found', error_message: 'resource not found' },
        status: 404,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Travis CI API error [404] (not_found): resource not found')
    })

    it('falls back to body.message', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({
        message: 'Forbidden',
        body: { message: 'insufficient permissions' },
        status: 403,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('insufficient permissions')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Network timeout')
    })

    it('handles non-string error.message', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({
        message: { detail: 'complex error' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('complex error')
    })
  })
})
