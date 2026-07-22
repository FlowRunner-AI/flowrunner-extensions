'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-phantombuster-key'
const BASE = 'https://api.phantombuster.com/api/v2'

describe('Phantombuster Service', () => {
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
    it('registers the apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('reads the api key from the config', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Agents ──

  describe('listAgents', () => {
    it('sends a GET with the auth header', async () => {
      const agents = [{ id: '1', name: 'Scraper' }]

      mock.onGet(`${ BASE }/agents/fetch-all`).reply(agents)

      const result = await service.listAgents()

      expect(result).toEqual(agents)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')

      expect(mock.history[0].headers).toMatchObject({
        'X-Phantombuster-Key-1': API_KEY,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('wraps API errors with status and body error text', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { error: 'Invalid API key' },
      })

      await expect(service.listAgents()).rejects.toThrow(
        'Phantombuster API error (403): Invalid API key'
      )
    })

    it('falls back to the body message then the error message', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).replyWithError({
        message: 'Server Error',
        statusCode: 500,
        body: { message: 'boom' },
      })

      await expect(service.listAgents()).rejects.toThrow('Phantombuster API error (500): boom')

      mock.reset()
      mock.onGet(`${ BASE }/agents/fetch-all`).replyWithError({ message: 'Network timeout' })

      await expect(service.listAgents()).rejects.toThrow('Phantombuster API error: Network timeout')
    })
  })

  describe('getAgent', () => {
    it('sends the agent id as a query parameter', async () => {
      mock.onGet(`${ BASE }/agents/fetch`).reply({ id: '123', name: 'Scraper' })

      const result = await service.getAgent('123')

      expect(result).toEqual({ id: '123', name: 'Scraper' })
      expect(mock.history[0].query).toEqual({ id: '123' })
    })

    it('drops an empty id from the query', async () => {
      mock.onGet(`${ BASE }/agents/fetch`).reply({})

      await service.getAgent('')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('launchAgent', () => {
    it('sends only the id when no arguments are supplied', async () => {
      mock.onPost(`${ BASE }/agents/launch`).reply({ containerId: '999' })

      const result = await service.launchAgent('123')

      expect(result).toEqual({ containerId: '999' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ id: '123' })
    })

    it('parses JSON string arguments and coerces saveArgument', async () => {
      mock.onPost(`${ BASE }/agents/launch`).reply({ containerId: '999' })

      await service.launchAgent('123', '{"sessionCookie":"abc"}', { extra: 1 }, 1)

      expect(mock.history[0].body).toEqual({
        id: '123',
        argument: { sessionCookie: 'abc' },
        bonusArgument: { extra: 1 },
        saveArgument: true,
      })
    })

    it('keeps saveArgument false in the body', async () => {
      mock.onPost(`${ BASE }/agents/launch`).reply({ containerId: '999' })

      await service.launchAgent('123', undefined, undefined, false)

      expect(mock.history[0].body).toEqual({ id: '123', saveArgument: false })
    })

    it('throws when the argument is not valid JSON', async () => {
      await expect(service.launchAgent('123', 'not-json')).rejects.toThrow(
        /Argument must be a valid JSON object/
      )

      expect(mock.history).toHaveLength(0)
    })

    it('throws when the bonus argument is not valid JSON', async () => {
      await expect(service.launchAgent('123', undefined, '{oops')).rejects.toThrow(
        /Bonus Argument must be a valid JSON object/
      )
    })
  })

  describe('getAgentOutput', () => {
    it('maps the Most Recent mode label', async () => {
      mock.onGet(`${ BASE }/agents/fetch-output`).reply({ status: 'running' })

      await service.getAgentOutput('123', 'Most Recent')

      expect(mock.history[0].query).toEqual({ id: '123', mode: 'most-recent' })
    })

    it('maps the Last Finished mode label', async () => {
      mock.onGet(`${ BASE }/agents/fetch-output`).reply({ status: 'finished' })

      await service.getAgentOutput('123', 'Last Finished')

      expect(mock.history[0].query).toEqual({ id: '123', mode: 'last-finished' })
    })

    it('passes an unmapped mode through unchanged', async () => {
      mock.onGet(`${ BASE }/agents/fetch-output`).reply({ status: 'finished' })

      await service.getAgentOutput('123', 'custom-mode')

      expect(mock.history[0].query).toEqual({ id: '123', mode: 'custom-mode' })
    })

    it('omits the mode when not supplied', async () => {
      mock.onGet(`${ BASE }/agents/fetch-output`).reply({ status: 'finished' })

      await service.getAgentOutput('123')

      expect(mock.history[0].query).toEqual({ id: '123' })
    })
  })

  describe('abortAgent', () => {
    it('posts the agent id', async () => {
      mock.onPost(`${ BASE }/agents/abort`).reply({ nbAborted: 1 })

      const result = await service.abortAgent('123')

      expect(result).toEqual({ nbAborted: 1 })
      expect(mock.history[0].body).toEqual({ id: '123' })
    })
  })

  // ── Containers ──

  describe('getContainer', () => {
    it('sends the container id as a query parameter', async () => {
      mock.onGet(`${ BASE }/containers/fetch`).reply({ id: '999', status: 'finished' })

      const result = await service.getContainer('999')

      expect(result).toEqual({ id: '999', status: 'finished' })
      expect(mock.history[0].query).toEqual({ id: '999' })
    })
  })

  describe('getContainerResultObject', () => {
    it('fetches the result object for a container', async () => {
      mock.onGet(`${ BASE }/containers/fetch-result-object`).reply({ resultObject: '[]' })

      const result = await service.getContainerResultObject('999')

      expect(result).toEqual({ resultObject: '[]' })
      expect(mock.history[0].url).toBe(`${ BASE }/containers/fetch-result-object`)
      expect(mock.history[0].query).toEqual({ id: '999' })
    })
  })

  describe('listAgentContainers', () => {
    it('sends the agentId as a query parameter', async () => {
      mock.onGet(`${ BASE }/containers/fetch-all`).reply([{ id: '999' }])

      const result = await service.listAgentContainers('123')

      expect(result).toEqual([{ id: '999' }])
      expect(mock.history[0].query).toEqual({ agentId: '123' })
    })
  })

  // ── Organization ──

  describe('getOrganizationResources', () => {
    it('fetches organization resources', async () => {
      mock.onGet(`${ BASE }/orgs/fetch-resources`).reply({ executionTimeUsed: 10 })

      const result = await service.getOrganizationResources()

      expect(result).toEqual({ executionTimeUsed: 10 })
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Dictionary ──

  describe('getAgentsDictionary', () => {
    it('maps agents to dictionary items with a launches note', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).reply([
        { id: 1234, name: 'Scraper', nbLaunches: 12 },
      ])

      const result = await service.getAgentsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Scraper', value: '1234', note: '12 launches' }],
        cursor: null,
      })
    })

    it('falls back to the id as label and omits the note', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).reply([{ id: 1234 }])

      const result = await service.getAgentsDictionary(null)

      expect(result.items).toEqual([{ label: '1234', value: '1234', note: undefined }])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).reply([
        { id: '1', name: 'LinkedIn Scraper' },
        { id: '2', name: 'Twitter Poster' },
      ])

      const result = await service.getAgentsDictionary({ search: '  linkedin ' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('returns an empty list when the payload is not an array', async () => {
      mock.onGet(`${ BASE }/agents/fetch-all`).reply({ error: 'nope' })

      const result = await service.getAgentsDictionary({ search: 'x' })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
