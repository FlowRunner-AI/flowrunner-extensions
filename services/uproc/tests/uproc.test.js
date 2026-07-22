'use strict'

const { createSandbox } = require('../../../service-sandbox')

const EMAIL = 'john@doe.com'
const API_KEY = 'test-api-key'
const BASE = 'https://api.uproc.io/api/v2'
const AUTH = `Basic ${ Buffer.from(`${ EMAIL }:${ API_KEY }`).toString('base64') }`

describe('uProc Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ email: EMAIL, apiKey: API_KEY })
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
    it('registers email and apiKey config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(2)
      expect(configItems.map(item => item.name)).toEqual(['email', 'apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'email', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })
  })

  // ── Auth ──

  describe('authentication', () => {
    it('sends basic auth built from email and api key', async () => {
      mock.onGet(`${ BASE }/profile`).reply({ email: EMAIL, credits: 100 })

      await service.getProfile()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Run Tool ──

  describe('runTool', () => {
    it('posts the processor and params and unwraps result', async () => {
      mock.onPost(`${ BASE }/process`).reply({
        result: { exists: 'yes' },
        message: 'success',
      })

      const result = await service.runTool('email-check-exists', { email: 'john@doe.com' })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/process`)

      expect(mock.history[0].body).toEqual({
        processor: 'email-check-exists',
        params: { email: 'john@doe.com' },
      })

      expect(result).toEqual({
        processor: 'email-check-exists',
        result: { exists: 'yes' },
        message: 'success',
        raw: { result: { exists: 'yes' }, message: 'success' },
      })
    })

    it('falls back to the response field when result is absent', async () => {
      mock.onPost(`${ BASE }/process`).reply({ response: { value: 42 }, message: 'ok' })

      const result = await service.runTool('text-to-uppercase', { text: 'a' })

      expect(result.result).toEqual({ value: 42 })
      expect(result.message).toBe('ok')
    })

    it('returns the whole envelope when neither result nor response exists', async () => {
      mock.onPost(`${ BASE }/process`).reply({ message: 'nothing here' })

      const result = await service.runTool('some-tool', {})

      expect(result.result).toEqual({ message: 'nothing here' })
      expect(result.raw).toEqual({ message: 'nothing here' })
    })

    it('handles a null result value', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: null, message: 'empty' })

      const result = await service.runTool('some-tool', {})

      expect(result.result).toBeNull()
      expect(result.message).toBe('empty')
    })

    it('handles an undefined response body', async () => {
      mock.onPost(`${ BASE }/process`).reply(undefined)

      const result = await service.runTool('some-tool', {})

      expect(result).toEqual({
        processor: 'some-tool',
        result: undefined,
        message: undefined,
        raw: undefined,
      })
    })

    it('cleans empty, null and undefined params', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.runTool('email-check-exists', {
        email: 'john@doe.com',
        blank: '',
        nothing: null,
        missing: undefined,
      })

      expect(mock.history[0].body.params).toEqual({ email: 'john@doe.com' })
    })

    it('sends an empty params object when params are omitted', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.runTool('email-check-exists')

      expect(mock.history[0].body.params).toEqual({})
    })

    it('sends an empty query object', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.runTool('email-check-exists', { email: 'a@b.com' })

      expect(mock.history[0].query).toEqual({})
    })

    it('throws using error.body.message', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'Unknown processor' },
      })

      await expect(service.runTool('nope', {})).rejects.toThrow('uProc API error: Unknown processor')
    })

    it('throws using error.body.error', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({
        message: 'Bad Request',
        body: { error: 'No credits left' },
      })

      await expect(service.runTool('nope', {})).rejects.toThrow('uProc API error: No credits left')
    })

    it('falls back to error.message', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({ message: 'Network unreachable' })

      await expect(service.runTool('nope', {})).rejects.toThrow(
        'uProc API error: Network unreachable'
      )
    })
  })

  // ── Email ──

  describe('verifyEmail', () => {
    it('runs the email-check-exists processor', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: { exists: 'yes' }, message: 'success' })

      const result = await service.verifyEmail('john@doe.com')

      expect(mock.history[0].body).toEqual({
        processor: 'email-check-exists',
        params: { email: 'john@doe.com' },
      })

      expect(result.processor).toBe('email-check-exists')
      expect(result.result).toEqual({ exists: 'yes' })
    })

    it('sends empty params when no email is provided', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.verifyEmail()

      expect(mock.history[0].body.params).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({ body: { message: 'invalid email' } })

      await expect(service.verifyEmail('bad')).rejects.toThrow('uProc API error: invalid email')
    })
  })

  // ── Phone ──

  describe('verifyPhone', () => {
    it('runs the phone-check-exists processor with phone and country', async () => {
      mock.onPost(`${ BASE }/process`).reply({
        result: { exists: 'yes', type: 'mobile' },
        message: 'success',
      })

      const result = await service.verifyPhone('+14155552671', 'US')

      expect(mock.history[0].body).toEqual({
        processor: 'phone-check-exists',
        params: { phone: '+14155552671', country: 'US' },
      })

      expect(result.result.type).toBe('mobile')
    })

    it('omits a missing country from params', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.verifyPhone('+14155552671')

      expect(mock.history[0].body.params).toEqual({ phone: '+14155552671' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({ message: 'boom' })

      await expect(service.verifyPhone('+1', 'US')).rejects.toThrow('uProc API error: boom')
    })
  })

  // ── Gender ──

  describe('getGenderByName', () => {
    it('runs the name-get-gender processor', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: { gender: 'female' }, message: 'success' })

      const result = await service.getGenderByName('Alexandra')

      expect(mock.history[0].body).toEqual({
        processor: 'name-get-gender',
        params: { name: 'Alexandra' },
      })

      expect(result.result.gender).toBe('female')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({ body: { error: 'bad name' } })

      await expect(service.getGenderByName('')).rejects.toThrow('uProc API error: bad name')
    })
  })

  // ── Company Search ──

  describe('companySearch', () => {
    it('runs the company-search-by-name processor', async () => {
      mock.onPost(`${ BASE }/process`).reply({
        result: { name: 'uProc', country: 'ES' },
        message: 'success',
      })

      const result = await service.companySearch('uProc', 'ES')

      expect(mock.history[0].body).toEqual({
        processor: 'company-search-by-name',
        params: { name: 'uProc', country: 'ES' },
      })

      expect(result.result.name).toBe('uProc')
    })

    it('omits an empty country', async () => {
      mock.onPost(`${ BASE }/process`).reply({ result: {} })

      await service.companySearch('uProc', '')

      expect(mock.history[0].body.params).toEqual({ name: 'uProc' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/process`).replyWithError({ message: 'search failed' })

      await expect(service.companySearch('uProc', 'ES')).rejects.toThrow(
        'uProc API error: search failed'
      )
    })
  })

  // ── Catalog ──

  describe('listGroups', () => {
    it('issues a GET to the groups endpoint', async () => {
      mock.onGet(`${ BASE }/groups`).reply({ groups: [{ name: 'email', title: 'Email' }] })

      const result = await service.listGroups()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/groups`)
      expect(mock.history[0].body).toBeUndefined()
      expect(mock.history[0].query).toEqual({})
      expect(result.groups).toHaveLength(1)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/groups`).replyWithError({ body: { message: 'unauthorized' } })

      await expect(service.listGroups()).rejects.toThrow('uProc API error: unauthorized')
    })
  })

  describe('listTools', () => {
    it('lists all tools when no group is provided', async () => {
      mock.onGet(`${ BASE }/tools`).reply({ tools: [{ name: 'email-check-exists' }] })

      const result = await service.listTools()

      expect(mock.history[0].url).toBe(`${ BASE }/tools`)
      expect(mock.history[0].query).toEqual({})
      expect(result.tools[0].name).toBe('email-check-exists')
    })

    it('passes the group filter as a query param', async () => {
      mock.onGet(`${ BASE }/tools`).reply({ tools: [] })

      await service.listTools('email')

      expect(mock.history[0].query).toEqual({ group: 'email' })
    })

    it('drops an empty group filter', async () => {
      mock.onGet(`${ BASE }/tools`).reply({ tools: [] })

      await service.listTools('')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/tools`).replyWithError({ message: 'nope' })

      await expect(service.listTools('email')).rejects.toThrow('uProc API error: nope')
    })
  })

  // ── Account ──

  describe('getProfile', () => {
    it('issues a GET to the profile endpoint', async () => {
      mock.onGet(`${ BASE }/profile`).reply({ email: EMAIL, credits: 9500, plan: 'pro' })

      const result = await service.getProfile()

      expect(mock.history[0].url).toBe(`${ BASE }/profile`)
      expect(result).toEqual({ email: EMAIL, credits: 9500, plan: 'pro' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/profile`).replyWithError({
        body: { message: 'Invalid credentials' },
      })

      await expect(service.getProfile()).rejects.toThrow('uProc API error: Invalid credentials')
    })
  })
})
