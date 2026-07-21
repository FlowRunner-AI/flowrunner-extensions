'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-circle-token'
const BASE = 'https://circleci.com/api/v2'

const AUTH_HEADERS = {
  'Circle-Token': API_TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

describe('CircleCI Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Circle-Token auth header on requests', async () => {
      mock.onGet(`${ BASE }/me`).reply({ id: 'u1', login: 'jane', name: 'Jane Doe' })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── Pipelines ──

  describe('triggerPipeline', () => {
    it('posts to the project pipeline endpoint with an encoded slug and empty body', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).reply({ id: 'p1', state: 'pending', number: 25 })

      const result = await service.triggerPipeline('gh/acme/app')

      expect(result).toEqual({ id: 'p1', state: 'pending', number: 25 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes branch and parameters when provided', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).reply({ id: 'p2', number: 26 })

      await service.triggerPipeline('gh/acme/app', 'main', undefined, { deploy: true })

      expect(mock.history[0].body).toEqual({
        branch: 'main',
        parameters: { deploy: true },
      })
    })

    it('includes tag when provided instead of branch', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).reply({ id: 'p3', number: 27 })

      await service.triggerPipeline('gh/acme/app', undefined, 'v1.2.3')

      expect(mock.history[0].body).toEqual({ tag: 'v1.2.3' })
    })

    it('wraps API errors with status and message', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).replyWithError({
        status: 400,
        body: { message: 'Branch not found' },
      })

      await expect(service.triggerPipeline('gh/acme/app', 'nope')).rejects.toThrow(
        'CircleCI API error (400): Branch not found'
      )
    })
  })

  describe('getPipeline', () => {
    it('gets a pipeline by encoded id', async () => {
      mock.onGet(`${ BASE }/pipeline/pipe-1`).reply({ id: 'pipe-1', state: 'created', number: 25 })

      const result = await service.getPipeline('pipe-1')

      expect(result).toEqual({ id: 'pipe-1', state: 'created', number: 25 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/pipeline/pipe-1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('wraps API errors using error.message when body is absent', async () => {
      mock.onGet(`${ BASE }/pipeline/bad`).replyWithError({ message: 'Not Found' })

      await expect(service.getPipeline('bad')).rejects.toThrow('CircleCI API error: Not Found')
    })
  })

  describe('getPipelineByNumber', () => {
    it('gets a pipeline by project slug and number', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/25`).reply({ id: 'pipe-1', number: 25 })

      const result = await service.getPipelineByNumber('gh/acme/app', 25)

      expect(result).toEqual({ id: 'pipe-1', number: 25 })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/25`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/99`).replyWithError({
        statusCode: 404,
        message: 'Pipeline not found',
      })

      await expect(service.getPipelineByNumber('gh/acme/app', 99)).rejects.toThrow(
        'CircleCI API error (404): Pipeline not found'
      )
    })
  })

  describe('listProjectPipelines', () => {
    it('lists pipelines with no query params when only the slug is given', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).reply({ items: [], next_page_token: null })

      const result = await service.listProjectPipelines('gh/acme/app')

      expect(result).toEqual({ items: [], next_page_token: null })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes branch and page-token query params when provided', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).reply({ items: [{ id: 'p1' }] })

      await service.listProjectPipelines('gh/acme/app', 'main', 'token-abc')

      expect(mock.history[0].query).toEqual({ branch: 'main', 'page-token': 'token-abc' })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline`).replyWithError({ message: 'Boom' })

      await expect(service.listProjectPipelines('gh/acme/app')).rejects.toThrow(
        'CircleCI API error: Boom'
      )
    })
  })

  describe('listMyPipelines', () => {
    it('lists the caller pipelines with no page token', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/mine`).reply({ items: [] })

      const result = await service.listMyPipelines('gh/acme/app')

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/mine`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the page-token query param when provided', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/pipeline/mine`).reply({ items: [] })

      await service.listMyPipelines('gh/acme/app', 'token-xyz')

      expect(mock.history[0].query).toEqual({ 'page-token': 'token-xyz' })
    })
  })

  describe('getPipelineConfig', () => {
    it('gets the config for a pipeline id', async () => {
      mock.onGet(`${ BASE }/pipeline/pipe-1/config`).reply({ source: 'version: 2.1', compiled: 'version: 2' })

      const result = await service.getPipelineConfig('pipe-1')

      expect(result).toEqual({ source: 'version: 2.1', compiled: 'version: 2' })
      expect(mock.history[0].url).toBe(`${ BASE }/pipeline/pipe-1/config`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/pipeline/pipe-1/config`).replyWithError({ message: 'Boom' })

      await expect(service.getPipelineConfig('pipe-1')).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  describe('getPipelineWorkflows', () => {
    it('lists workflows for a pipeline with no page token', async () => {
      mock.onGet(`${ BASE }/pipeline/pipe-1/workflow`).reply({ items: [{ id: 'wf1' }], next_page_token: null })

      const result = await service.getPipelineWorkflows('pipe-1')

      expect(result).toEqual({ items: [{ id: 'wf1' }], next_page_token: null })
      expect(mock.history[0].url).toBe(`${ BASE }/pipeline/pipe-1/workflow`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the page-token query param when provided', async () => {
      mock.onGet(`${ BASE }/pipeline/pipe-1/workflow`).reply({ items: [] })

      await service.getPipelineWorkflows('pipe-1', 'tok')

      expect(mock.history[0].query).toEqual({ 'page-token': 'tok' })
    })
  })

  // ── Workflows ──

  describe('getWorkflow', () => {
    it('gets a workflow by id', async () => {
      mock.onGet(`${ BASE }/workflow/wf-1`).reply({ id: 'wf-1', name: 'build-and-test', status: 'success' })

      const result = await service.getWorkflow('wf-1')

      expect(result).toEqual({ id: 'wf-1', name: 'build-and-test', status: 'success' })
      expect(mock.history[0].url).toBe(`${ BASE }/workflow/wf-1`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/workflow/wf-1`).replyWithError({ status: 404, message: 'no workflow' })

      await expect(service.getWorkflow('wf-1')).rejects.toThrow('CircleCI API error (404): no workflow')
    })
  })

  describe('getWorkflowJobs', () => {
    it('lists jobs for a workflow with no page token', async () => {
      mock.onGet(`${ BASE }/workflow/wf-1/job`).reply({ items: [{ id: 'j1' }], next_page_token: null })

      const result = await service.getWorkflowJobs('wf-1')

      expect(result).toEqual({ items: [{ id: 'j1' }], next_page_token: null })
      expect(mock.history[0].url).toBe(`${ BASE }/workflow/wf-1/job`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the page-token query param when provided', async () => {
      mock.onGet(`${ BASE }/workflow/wf-1/job`).reply({ items: [] })

      await service.getWorkflowJobs('wf-1', 'tok')

      expect(mock.history[0].query).toEqual({ 'page-token': 'tok' })
    })
  })

  describe('cancelWorkflow', () => {
    it('posts to the cancel endpoint with no body', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/cancel`).reply({ message: 'Accepted.' })

      const result = await service.cancelWorkflow('wf-1')

      expect(result).toEqual({ message: 'Accepted.' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/workflow/wf-1/cancel`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/cancel`).replyWithError({ status: 400, message: 'not running' })

      await expect(service.cancelWorkflow('wf-1')).rejects.toThrow('CircleCI API error (400): not running')
    })
  })

  describe('rerunWorkflow', () => {
    it('posts an empty body when fromFailed is not provided', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/rerun`).reply({ workflow_id: 'wf-2' })

      const result = await service.rerunWorkflow('wf-1')

      expect(result).toEqual({ workflow_id: 'wf-2' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/workflow/wf-1/rerun`)
      expect(mock.history[0].body).toEqual({})
    })

    it('sends from_failed true when requested', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/rerun`).reply({ workflow_id: 'wf-3' })

      await service.rerunWorkflow('wf-1', true)

      expect(mock.history[0].body).toEqual({ from_failed: true })
    })

    it('sends from_failed false when explicitly false', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/rerun`).reply({ workflow_id: 'wf-4' })

      await service.rerunWorkflow('wf-1', false)

      expect(mock.history[0].body).toEqual({ from_failed: false })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/workflow/wf-1/rerun`).replyWithError({ message: 'Boom' })

      await expect(service.rerunWorkflow('wf-1')).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  // ── Jobs ──

  describe('getJobDetails', () => {
    it('gets job details by slug and job number', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/job/42`).reply({ number: 42, name: 'build', status: 'success' })

      const result = await service.getJobDetails('gh/acme/app', 42)

      expect(result).toEqual({ number: 42, name: 'build', status: 'success' })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/job/42`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/job/42`).replyWithError({ status: 404, message: 'no job' })

      await expect(service.getJobDetails('gh/acme/app', 42)).rejects.toThrow(
        'CircleCI API error (404): no job'
      )
    })
  })

  describe('cancelJob', () => {
    it('posts to the job cancel endpoint with no body', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/job/42/cancel`).reply({ message: 'Job cancelled successfully.' })

      const result = await service.cancelJob('gh/acme/app', 42)

      expect(result).toEqual({ message: 'Job cancelled successfully.' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/job/42/cancel`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/job/42/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelJob('gh/acme/app', 42)).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  describe('getJobArtifacts', () => {
    it('gets artifacts using the (project/{slug}/{jobNumber}/artifacts) path', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/42/artifacts`).reply({ items: [{ path: 'a.txt' }] })

      const result = await service.getJobArtifacts('gh/acme/app', 42)

      expect(result).toEqual({ items: [{ path: 'a.txt' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/42/artifacts`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/42/artifacts`).replyWithError({ message: 'Boom' })

      await expect(service.getJobArtifacts('gh/acme/app', 42)).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  describe('getTestMetadata', () => {
    it('gets test metadata using the (project/{slug}/{jobNumber}/tests) path', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/42/tests`).reply({ items: [{ name: 'renders header' }] })

      const result = await service.getTestMetadata('gh/acme/app', 42)

      expect(result).toEqual({ items: [{ name: 'renders header' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/42/tests`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/42/tests`).replyWithError({ message: 'Boom' })

      await expect(service.getTestMetadata('gh/acme/app', 42)).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  // ── Project ──

  describe('getProject', () => {
    it('gets a project by slug', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp`).reply({ slug: 'gh/acme/app', name: 'app' })

      const result = await service.getProject('gh/acme/app')

      expect(result).toEqual({ slug: 'gh/acme/app', name: 'app' })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp`).replyWithError({ status: 404, message: 'no project' })

      await expect(service.getProject('gh/acme/app')).rejects.toThrow(
        'CircleCI API error (404): no project'
      )
    })
  })

  describe('listEnvVars', () => {
    it('lists env vars with no page token', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/envvar`).reply({ items: [{ name: 'API_KEY', value: 'xxxx1234' }] })

      const result = await service.listEnvVars('gh/acme/app')

      expect(result).toEqual({ items: [{ name: 'API_KEY', value: 'xxxx1234' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/envvar`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the page-token query param when provided', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/envvar`).reply({ items: [] })

      await service.listEnvVars('gh/acme/app', 'tok')

      expect(mock.history[0].query).toEqual({ 'page-token': 'tok' })
    })
  })

  describe('createEnvVar', () => {
    it('posts name and value to the envvar endpoint', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/envvar`).reply({ name: 'API_KEY', value: 'xxxx1234' })

      const result = await service.createEnvVar('gh/acme/app', 'API_KEY', 'super-secret')

      expect(result).toEqual({ name: 'API_KEY', value: 'xxxx1234' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/envvar`)
      expect(mock.history[0].body).toEqual({ name: 'API_KEY', value: 'super-secret' })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/project/gh%2Facme%2Fapp/envvar`).replyWithError({ status: 400, message: 'bad name' })

      await expect(service.createEnvVar('gh/acme/app', 'X', 'v')).rejects.toThrow(
        'CircleCI API error (400): bad name'
      )
    })
  })

  describe('deleteEnvVar', () => {
    it('deletes an env var by name', async () => {
      mock.onDelete(`${ BASE }/project/gh%2Facme%2Fapp/envvar/API_KEY`).reply({ message: 'Deleted successfully.' })

      const result = await service.deleteEnvVar('gh/acme/app', 'API_KEY')

      expect(result).toEqual({ message: 'Deleted successfully.' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/envvar/API_KEY`)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/project/gh%2Facme%2Fapp/envvar/API_KEY`).replyWithError({ message: 'Boom' })

      await expect(service.deleteEnvVar('gh/acme/app', 'API_KEY')).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  describe('listCheckoutKeys', () => {
    it('lists checkout keys with no page token', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/checkout-key`).reply({ items: [{ type: 'deploy-key' }] })

      const result = await service.listCheckoutKeys('gh/acme/app')

      expect(result).toEqual({ items: [{ type: 'deploy-key' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/project/gh%2Facme%2Fapp/checkout-key`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the page-token query param when provided', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/checkout-key`).reply({ items: [] })

      await service.listCheckoutKeys('gh/acme/app', 'tok')

      expect(mock.history[0].query).toEqual({ 'page-token': 'tok' })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/project/gh%2Facme%2Fapp/checkout-key`).replyWithError({ message: 'Boom' })

      await expect(service.listCheckoutKeys('gh/acme/app')).rejects.toThrow('CircleCI API error: Boom')
    })
  })

  // ── Account ──

  describe('getCurrentUser', () => {
    it('gets the current user', async () => {
      mock.onGet(`${ BASE }/me`).reply({ id: 'u1', login: 'jane', name: 'Jane Doe' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 'u1', login: 'jane', name: 'Jane Doe' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/me`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({ status: 401, message: 'Unauthorized' })

      await expect(service.getCurrentUser()).rejects.toThrow('CircleCI API error (401): Unauthorized')
    })
  })
})
