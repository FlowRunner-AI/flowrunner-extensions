'use strict'

const path = require('path')

const { createSandbox } = require('../../../service-sandbox')

const SERVICE_PATH = path.join(__dirname, '..', 'src', 'index.js')

const API_TOKEN = 'test-api-token-123'
const APP_URL = 'https://myapp.bubbleapps.io'
const LIVE_BASE = `${ APP_URL }/api/1.1`
const DEV_BASE = `${ APP_URL }/version-test/api/1.1`

// The service entry file only registers via addService() at require-time, so it
// must be re-required after each new sandbox is created. jest.isolateModules gives
// the require a fresh module registry so addService() runs again against the new
// sandbox instead of returning the cached (already-registered) module.
function buildService(config) {
  const sandbox = createSandbox(config)

  jest.isolateModules(() => {
    require(SERVICE_PATH)
  })

  return {
    sandbox,
    service: sandbox.getService(),
    mock: sandbox.getRequestMock(),
    configItems: sandbox.getConfigItems(),
  }
}

describe('Bubble Service', () => {
  let sandbox
  let service
  let mock

  beforeEach(() => {
    const built = buildService({ appUrl: APP_URL, apiToken: API_TOKEN })

    sandbox = built.sandbox
    service = built.service
    mock = built.mock
  })

  afterEach(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'appUrl',
          displayName: 'App URL',
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
        expect.objectContaining({
          name: 'environment',
          displayName: 'Environment',
          required: false,
          shared: false,
          type: 'CHOICE',
          defaultValue: 'Live',
          options: ['Live', 'Development'],
        }),
      ])
    })

    it('sends the Bearer token and JSON content type on requests', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user/abc`).reply({ response: { _id: 'abc' } })

      await service.getThing('user', 'abc')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('defaults to the Live base URL when no environment is set', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user/abc`).reply({ response: { _id: 'abc' } })

      await service.getThing('user', 'abc')

      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)
    })
  })

  // ── Environment switch ──

  describe('environment resolution', () => {
    it('targets the version-test path when environment is Development', async () => {
      const built = buildService({
        appUrl: APP_URL,
        apiToken: API_TOKEN,
        environment: 'Development',
      })

      built.mock.onGet(`${ DEV_BASE }/obj/user/abc`).reply({ response: { _id: 'abc' } })

      await built.service.getThing('user', 'abc')

      expect(built.mock.history[0].url).toBe(`${ DEV_BASE }/obj/user/abc`)

      built.sandbox.cleanup()
    })

    it('targets the live path when environment is Live', async () => {
      const built = buildService({
        appUrl: APP_URL,
        apiToken: API_TOKEN,
        environment: 'Live',
      })

      built.mock.onGet(`${ LIVE_BASE }/obj/user/abc`).reply({ response: { _id: 'abc' } })

      await built.service.getThing('user', 'abc')

      expect(built.mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)

      built.sandbox.cleanup()
    })

    it('strips a trailing slash from the app URL before building the base path', async () => {
      const built = buildService({
        appUrl: `${ APP_URL }/`,
        apiToken: API_TOKEN,
      })

      built.mock.onGet(`${ LIVE_BASE }/obj/user/abc`).reply({ response: { _id: 'abc' } })

      await built.service.getThing('user', 'abc')

      expect(built.mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)

      built.sandbox.cleanup()
    })
  })

  // ── Data: Get Thing ──

  describe('getThing', () => {
    it('sends a GET to the object endpoint', async () => {
      const payload = { response: { _id: 'abc', name: 'Acme Corp' } }
      mock.onGet(`${ LIVE_BASE }/obj/user/abc`).reply(payload)

      const result = await service.getThing('user', 'abc')

      expect(result).toEqual(payload)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)
    })

    it('url-encodes the data type and id', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/blog%20post/12%2F34`).reply({ response: {} })

      await service.getThing('blog post', '12/34')

      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/blog%20post/12%2F34`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user/missing`).replyWithError({
        status: 404,
        body: { message: 'Not found' },
      })

      await expect(service.getThing('user', 'missing')).rejects.toThrow(
        'Bubble API error (404): Not found'
      )
    })
  })

  // ── Data: List / Search Things ──

  describe('listThings', () => {
    it('sends a GET with no query params for required params only', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user`).reply({ response: { results: [], cursor: 0, count: 0, remaining: 0 } })

      const result = await service.listThings('user')

      expect(result).toEqual({ response: { results: [], cursor: 0, count: 0, remaining: 0 } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user`)
      expect(mock.history[0].query).toEqual({})
    })

    it('serializes an array of constraints and passes sort/pagination params', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user`).reply({ response: { results: [], cursor: 0, count: 0, remaining: 0 } })

      const constraints = [{ key: 'status', constraint_type: 'equals', value: 'active' }]

      await service.listThings('user', constraints, 'Created Date', true, 25, 50)

      expect(mock.history[0].query).toEqual({
        constraints: JSON.stringify(constraints),
        sort_field: 'Created Date',
        descending: 'true',
        limit: 25,
        cursor: 50,
      })
    })

    it('passes constraints through unchanged when already a string', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user`).reply({ response: { results: [] } })

      const constraintsStr = '[{"key":"age","constraint_type":"greater than","value":18}]'

      await service.listThings('user', constraintsStr)

      expect(mock.history[0].query).toEqual({ constraints: constraintsStr })
    })

    it('omits descending when not explicitly true', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user`).reply({ response: { results: [] } })

      await service.listThings('user', undefined, 'name', false)

      expect(mock.history[0].query).toEqual({ sort_field: 'name' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ LIVE_BASE }/obj/user`).replyWithError({
        status: 401,
        body: { message: 'Unauthorized' },
      })

      await expect(service.listThings('user')).rejects.toThrow('Bubble API error (401): Unauthorized')
    })
  })

  // ── Data: Create Thing ──

  describe('createThing', () => {
    it('sends a POST with the fields object', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user`).reply({ status: 'success', id: '123' })

      const result = await service.createThing('user', { name: 'Acme', status: 'active' })

      expect(result).toEqual({ status: 'success', id: '123' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user`)
      expect(mock.history[0].body).toEqual({ name: 'Acme', status: 'active' })
    })

    it('sends an empty body when fields are omitted', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user`).reply({ status: 'success', id: '124' })

      await service.createThing('user')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user`).replyWithError({
        status: 400,
        body: { message: 'Invalid field' },
      })

      await expect(service.createThing('user', { name: 'X' })).rejects.toThrow(
        'Bubble API error (400): Invalid field'
      )
    })
  })

  // ── Data: Modify Thing ──

  describe('modifyThing', () => {
    it('sends a PATCH with the partial fields', async () => {
      mock.onPatch(`${ LIVE_BASE }/obj/user/abc`).reply({ status: 'success' })

      const result = await service.modifyThing('user', 'abc', { status: 'archived' })

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)
      expect(mock.history[0].body).toEqual({ status: 'archived' })
    })

    it('defaults to a success status when the API returns no body', async () => {
      mock.onPatch(`${ LIVE_BASE }/obj/user/abc`).reply(undefined)

      const result = await service.modifyThing('user', 'abc', { status: 'archived' })

      expect(result).toEqual({ status: 'success' })
    })

    it('sends an empty body when fields are omitted', async () => {
      mock.onPatch(`${ LIVE_BASE }/obj/user/abc`).reply({ status: 'success' })

      await service.modifyThing('user', 'abc')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ LIVE_BASE }/obj/user/abc`).replyWithError({
        status: 403,
        body: { message: 'Forbidden' },
      })

      await expect(service.modifyThing('user', 'abc', { x: 1 })).rejects.toThrow(
        'Bubble API error (403): Forbidden'
      )
    })
  })

  // ── Data: Replace Thing ──

  describe('replaceThing', () => {
    it('sends a PUT with the full fields object', async () => {
      mock.onPut(`${ LIVE_BASE }/obj/user/abc`).reply({ status: 'success' })

      const result = await service.replaceThing('user', 'abc', { name: 'Acme', status: 'active' })

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)
      expect(mock.history[0].body).toEqual({ name: 'Acme', status: 'active' })
    })

    it('defaults to a success status when the API returns no body', async () => {
      mock.onPut(`${ LIVE_BASE }/obj/user/abc`).reply(undefined)

      const result = await service.replaceThing('user', 'abc', { name: 'Acme' })

      expect(result).toEqual({ status: 'success' })
    })

    it('sends an empty body when fields are omitted', async () => {
      mock.onPut(`${ LIVE_BASE }/obj/user/abc`).reply({ status: 'success' })

      await service.replaceThing('user', 'abc')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ LIVE_BASE }/obj/user/abc`).replyWithError({
        status: 500,
        body: { message: 'Server error' },
      })

      await expect(service.replaceThing('user', 'abc', { name: 'X' })).rejects.toThrow(
        'Bubble API error (500): Server error'
      )
    })
  })

  // ── Data: Delete Thing ──

  describe('deleteThing', () => {
    it('sends a DELETE and returns success', async () => {
      mock.onDelete(`${ LIVE_BASE }/obj/user/abc`).reply(undefined)

      const result = await service.deleteThing('user', 'abc')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/abc`)
    })

    it('passes through a returned body when the API responds with one', async () => {
      mock.onDelete(`${ LIVE_BASE }/obj/user/abc`).reply({ status: 'deleted' })

      const result = await service.deleteThing('user', 'abc')

      expect(result).toEqual({ status: 'deleted' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ LIVE_BASE }/obj/user/abc`).replyWithError({
        status: 404,
        body: { message: 'Not found' },
      })

      await expect(service.deleteThing('user', 'abc')).rejects.toThrow(
        'Bubble API error (404): Not found'
      )
    })
  })

  // ── Data: Bulk Create Things ──

  describe('bulkCreateThings', () => {
    it('sends NDJSON with a text/plain content type and parses per-line results', async () => {
      const responseText = '{"status":"success","id":"111"}\n{"status":"success","id":"222"}'
      mock.onPost(`${ LIVE_BASE }/obj/user/bulk`).reply(responseText)

      const result = await service.bulkCreateThings('user', [{ name: 'A' }, { name: 'B' }])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/obj/user/bulk`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'text/plain' })
      expect(mock.history[0].body).toBe('{"name":"A"}\n{"name":"B"}')

      expect(result).toEqual({
        results: [
          { status: 'success', id: '111' },
          { status: 'success', id: '222' },
        ],
        raw: responseText,
      })
    })

    it('wraps a single (non-array) thing into an NDJSON body', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user/bulk`).reply('{"status":"success","id":"111"}')

      await service.bulkCreateThings('user', { name: 'Solo' })

      expect(mock.history[0].body).toBe('{"name":"Solo"}')
    })

    it('records an error result for unparsable lines', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user/bulk`).reply('{"status":"success","id":"111"}\nnot-json')

      const result = await service.bulkCreateThings('user', [{ name: 'A' }, { name: 'B' }])

      expect(result.results).toEqual([
        { status: 'success', id: '111' },
        { status: 'error', raw: 'not-json' },
      ])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ LIVE_BASE }/obj/user/bulk`).replyWithError({
        status: 400,
        body: { message: 'Bad bulk request' },
      })

      await expect(service.bulkCreateThings('user', [{ name: 'A' }])).rejects.toThrow(
        'Bubble API error (400): Bad bulk request'
      )
    })
  })

  // ── Workflow: Trigger Workflow ──

  describe('triggerWorkflow', () => {
    it('sends a POST to the workflow endpoint with parameters', async () => {
      mock.onPost(`${ LIVE_BASE }/wf/send_welcome_email`).reply({ status: 'success', response: { result: 'ok' } })

      const result = await service.triggerWorkflow('send_welcome_email', {
        user_id: '123',
        email: 'a@b.com',
      })

      expect(result).toEqual({ status: 'success', response: { result: 'ok' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/wf/send_welcome_email`)
      expect(mock.history[0].body).toEqual({ user_id: '123', email: 'a@b.com' })
    })

    it('url-encodes the workflow name and sends an empty body when no params given', async () => {
      mock.onPost(`${ LIVE_BASE }/wf/my%20workflow`).reply({ status: 'success' })

      await service.triggerWorkflow('my workflow')

      expect(mock.history[0].url).toBe(`${ LIVE_BASE }/wf/my%20workflow`)
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ LIVE_BASE }/wf/broken`).replyWithError({
        status: 404,
        body: { message: 'Workflow not found' },
      })

      await expect(service.triggerWorkflow('broken')).rejects.toThrow(
        'Bubble API error (404): Workflow not found'
      )
    })
  })
})
