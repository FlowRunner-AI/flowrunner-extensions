'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://cortex.example.com'
const API_KEY = 'test-api-key'
const BASE = `${ URL }/api`

describe('Cortex Service', () => {
  let sandbox
  let service
  let mock
  let sharedFlowrunner

  beforeAll(() => {
    sandbox = createSandbox({ url: URL, apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    sharedFlowrunner = global.Flowrunner
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
          name: 'url',
          displayName: 'Instance URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Authorization bearer + Content-Type headers on requests', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply([])

      await service.listAnalyzers()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── URL normalization ──

  describe('base URL normalization', () => {
    // Re-require the service in an isolated module registry so addService()
    // runs again against a fresh sandbox with a trailing-slash URL.
    it('strips trailing slashes from the instance URL before appending /api', async () => {
      let slashSandbox

      jest.isolateModules(() => {
        slashSandbox = createSandbox({ url: 'https://cortex.example.com///', apiKey: API_KEY })
        require('../src/index.js')
      })

      const slashService = slashSandbox.getService()
      const slashMock = slashSandbox.getRequestMock()

      slashMock.onGet(`${ URL }/api/analyzer`).reply([])

      await slashService.listAnalyzers()

      expect(slashMock.history[0].url).toBe(`${ URL }/api/analyzer`)

      slashSandbox.cleanup()

      // Restore the shared sandbox's Flowrunner global for the remaining tests.
      global.Flowrunner = sharedFlowrunner
    })
  })

  // ── Analyzers ──

  describe('listAnalyzers', () => {
    it('sends a GET to /api/analyzer and returns the response', async () => {
      const analyzers = [{ id: 'a1', name: 'Abuse_Finder_2_0', version: '2.0' }]
      mock.onGet(`${ BASE }/analyzer`).reply(analyzers)

      const result = await service.listAnalyzers()

      expect(result).toEqual(analyzers)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/analyzer`)
    })

    it('throws a Cortex API error with status and message on failure', async () => {
      mock.onGet(`${ BASE }/analyzer`).replyWithError({
        status: 401,
        body: { type: 'AuthenticationError', message: 'Not authenticated' },
      })

      await expect(service.listAnalyzers()).rejects.toThrow('Cortex API error (401): Not authenticated')
    })

    it('falls back to the error type when no message is present', async () => {
      mock.onGet(`${ BASE }/analyzer`).replyWithError({
        status: 500,
        body: { type: 'InternalError' },
      })

      await expect(service.listAnalyzers()).rejects.toThrow('Cortex API error (500): InternalError')
    })

    it('throws without a status segment when none is provided', async () => {
      mock.onGet(`${ BASE }/analyzer`).replyWithError({
        message: 'Network down',
      })

      await expect(service.listAnalyzers()).rejects.toThrow('Cortex API error: Network down')
    })
  })

  describe('getAnalyzer', () => {
    it('sends a GET to /api/analyzer/{id}', async () => {
      const analyzer = { id: 'a1', name: 'Abuse_Finder_2_0' }
      mock.onGet(`${ BASE }/analyzer/a1`).reply(analyzer)

      const result = await service.getAnalyzer('a1')

      expect(result).toEqual(analyzer)
      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/a1`)
    })

    it('URL-encodes the analyzer id', async () => {
      mock.onGet(`${ BASE }/analyzer/a%2Fb`).reply({ id: 'a/b' })

      await service.getAnalyzer('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/a%2Fb`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/analyzer/bad`).replyWithError({ status: 404, body: { message: 'Not found' } })

      await expect(service.getAnalyzer('bad')).rejects.toThrow('Cortex API error (404): Not found')
    })
  })

  describe('getAnalyzersByType', () => {
    it('maps a friendly data type label to the API value in the URL', async () => {
      mock.onGet(`${ BASE }/analyzer/type/ip`).reply([{ id: 'a1' }])

      const result = await service.getAnalyzersByType('IP')

      expect(result).toEqual([{ id: 'a1' }])
      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/type/ip`)
    })

    it('maps each friendly label to its Cortex value', async () => {
      const cases = [
        ['Domain', 'domain'],
        ['FQDN', 'fqdn'],
        ['URL', 'url'],
        ['Hash', 'hash'],
        ['Mail', 'mail'],
        ['File', 'file'],
        ['Other', 'other'],
      ]

      for (const [label, apiValue] of cases) {
        mock.onGet(`${ BASE }/analyzer/type/${ apiValue }`).reply([])
        await service.getAnalyzersByType(label)
      }

      expect(mock.history.map(h => h.url)).toEqual(
        cases.map(([, apiValue]) => `${ BASE }/analyzer/type/${ apiValue }`)
      )
    })

    it('passes through an unmapped data type value unchanged', async () => {
      mock.onGet(`${ BASE }/analyzer/type/custom`).reply([])

      await service.getAnalyzersByType('custom')

      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/type/custom`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/analyzer/type/ip`).replyWithError({ status: 400, body: { message: 'Bad type' } })

      await expect(service.getAnalyzersByType('IP')).rejects.toThrow('Cortex API error (400): Bad type')
    })
  })

  // ── Run Analysis ──

  describe('runAnalyzer', () => {
    it('sends a POST with required params, mapped dataType and empty parameters object', async () => {
      mock.onPost(`${ BASE }/analyzer/a1/run`).reply({ id: 'job1', status: 'Waiting' })

      const result = await service.runAnalyzer('a1', '8.8.8.8', 'IP')

      expect(result).toEqual({ id: 'job1', status: 'Waiting' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/a1/run`)
      expect(mock.history[0].body).toEqual({
        data: '8.8.8.8',
        dataType: 'ip',
        parameters: {},
      })
    })

    it('includes all optional params with TLP/PAP mapped to numeric codes', async () => {
      mock.onPost(`${ BASE }/analyzer/a1/run`).reply({ id: 'job2' })

      await service.runAnalyzer('a1', 'evil.com', 'Domain', 'RED', 'GREEN', 'context note', { foo: 'bar' })

      expect(mock.history[0].body).toEqual({
        data: 'evil.com',
        dataType: 'domain',
        tlp: 3,
        pap: 1,
        message: 'context note',
        parameters: { foo: 'bar' },
      })
    })

    it('maps every TLP label to its numeric code', async () => {
      const cases = [
        ['WHITE', 0],
        ['GREEN', 1],
        ['AMBER', 2],
        ['RED', 3],
      ]

      for (const [label, code] of cases) {
        mock.onPost(`${ BASE }/analyzer/a1/run`).reply({ id: 'job' })
        await service.runAnalyzer('a1', '1.1.1.1', 'IP', label)
      }

      expect(mock.history.map(h => h.body.tlp)).toEqual(cases.map(([, code]) => code))
    })

    it('URL-encodes the analyzer id in the run path', async () => {
      mock.onPost(`${ BASE }/analyzer/a%2Fb/run`).reply({ id: 'job' })

      await service.runAnalyzer('a/b', '1.1.1.1', 'IP')

      expect(mock.history[0].url).toBe(`${ BASE }/analyzer/a%2Fb/run`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/analyzer/a1/run`).replyWithError({ status: 400, body: { message: 'Invalid observable' } })

      await expect(service.runAnalyzer('a1', 'bad', 'IP')).rejects.toThrow('Cortex API error (400): Invalid observable')
    })
  })

  describe('getJob', () => {
    it('sends a GET to /api/job/{id}', async () => {
      mock.onGet(`${ BASE }/job/job1`).reply({ id: 'job1', status: 'Success' })

      const result = await service.getJob('job1')

      expect(result).toEqual({ id: 'job1', status: 'Success' })
      expect(mock.history[0].url).toBe(`${ BASE }/job/job1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/job/bad`).replyWithError({ status: 404, body: { message: 'Job not found' } })

      await expect(service.getJob('bad')).rejects.toThrow('Cortex API error (404): Job not found')
    })
  })

  describe('getJobReport', () => {
    it('sends a GET to /api/job/{id}/report', async () => {
      const report = { id: 'job1', status: 'Success', report: { summary: {}, full: {}, artifacts: [] } }
      mock.onGet(`${ BASE }/job/job1/report`).reply(report)

      const result = await service.getJobReport('job1')

      expect(result).toEqual(report)
      expect(mock.history[0].url).toBe(`${ BASE }/job/job1/report`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/job/bad/report`).replyWithError({ status: 404, body: { message: 'No report' } })

      await expect(service.getJobReport('bad')).rejects.toThrow('Cortex API error (404): No report')
    })
  })

  describe('waitForJobReport', () => {
    it('sends a GET to /api/job/{id}/waitreport with the atMost query param', async () => {
      const report = { id: 'job1', status: 'Success', report: {} }
      mock.onGet(`${ BASE }/job/job1/waitreport`).reply(report)

      const result = await service.waitForJobReport('job1')

      expect(result).toEqual(report)
      expect(mock.history[0].url).toBe(`${ BASE }/job/job1/waitreport`)
      expect(mock.history[0].query).toEqual({ atMost: '1minute' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/job/bad/waitreport`).replyWithError({ status: 500, body: { message: 'Timeout' } })

      await expect(service.waitForJobReport('bad')).rejects.toThrow('Cortex API error (500): Timeout')
    })
  })

  describe('listJobs', () => {
    it('sends a GET to /api/job', async () => {
      const jobs = [{ id: 'job1', status: 'Success' }]
      mock.onGet(`${ BASE }/job`).reply(jobs)

      const result = await service.listJobs()

      expect(result).toEqual(jobs)
      expect(mock.history[0].url).toBe(`${ BASE }/job`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/job`).replyWithError({ status: 401, body: { message: 'Unauthorized' } })

      await expect(service.listJobs()).rejects.toThrow('Cortex API error (401): Unauthorized')
    })
  })

  describe('deleteJob', () => {
    it('sends a DELETE to /api/job/{id} and returns a success envelope', async () => {
      mock.onDelete(`${ BASE }/job/job1`).reply(undefined)

      const result = await service.deleteJob('job1')

      expect(result).toEqual({ success: true, id: 'job1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/job/job1`)
    })

    it('URL-encodes the job id', async () => {
      mock.onDelete(`${ BASE }/job/a%2Fb`).reply(undefined)

      await service.deleteJob('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/job/a%2Fb`)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/job/bad`).replyWithError({ status: 404, body: { message: 'Not found' } })

      await expect(service.deleteJob('bad')).rejects.toThrow('Cortex API error (404): Not found')
    })
  })

  // ── Responders ──

  describe('listResponders', () => {
    it('sends a GET to /api/responder', async () => {
      const responders = [{ id: 'r1', name: 'Mailer_1_0' }]
      mock.onGet(`${ BASE }/responder`).reply(responders)

      const result = await service.listResponders()

      expect(result).toEqual(responders)
      expect(mock.history[0].url).toBe(`${ BASE }/responder`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/responder`).replyWithError({ status: 403, body: { message: 'Forbidden' } })

      await expect(service.listResponders()).rejects.toThrow('Cortex API error (403): Forbidden')
    })
  })

  describe('runResponder', () => {
    it('sends a POST with required params and mapped dataType', async () => {
      mock.onPost(`${ BASE }/responder/r1/run`).reply({ id: 'rjob1', status: 'Waiting' })

      const result = await service.runResponder('r1', 'analyst@example.com', 'Mail')

      expect(result).toEqual({ id: 'rjob1', status: 'Waiting' })
      expect(mock.history[0].url).toBe(`${ BASE }/responder/r1/run`)
      expect(mock.history[0].body).toEqual({
        data: 'analyst@example.com',
        dataType: 'mail',
      })
    })

    it('includes optional TLP (mapped) and message', async () => {
      mock.onPost(`${ BASE }/responder/r1/run`).reply({ id: 'rjob2' })

      await service.runResponder('r1', 'analyst@example.com', 'Mail', 'AMBER', 'please notify')

      expect(mock.history[0].body).toEqual({
        data: 'analyst@example.com',
        dataType: 'mail',
        tlp: 2,
        message: 'please notify',
      })
    })

    it('URL-encodes the responder id', async () => {
      mock.onPost(`${ BASE }/responder/r%2F1/run`).reply({ id: 'rjob' })

      await service.runResponder('r/1', 'x', 'Other')

      expect(mock.history[0].url).toBe(`${ BASE }/responder/r%2F1/run`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/responder/r1/run`).replyWithError({ status: 400, body: { message: 'Bad responder' } })

      await expect(service.runResponder('r1', 'x', 'Mail')).rejects.toThrow('Cortex API error (400): Bad responder')
    })
  })

  describe('getResponderJob', () => {
    // Correct by design: Cortex has no responder-specific job endpoint. JobCtrl
    // serves both analyzer and responder jobs from GET /api/job/{id}
    // (conf/routes -> JobCtrl.get), so this action shares that path with getJob.
    it('sends a GET to /api/job/{id}', async () => {
      mock.onGet(`${ BASE }/job/rjob1`).reply({ id: 'rjob1', status: 'Success' })

      const result = await service.getResponderJob('rjob1')

      expect(result).toEqual({ id: 'rjob1', status: 'Success' })
      expect(mock.history[0].url).toBe(`${ BASE }/job/rjob1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/job/bad`).replyWithError({ status: 404, body: { message: 'Not found' } })

      await expect(service.getResponderJob('bad')).rejects.toThrow('Cortex API error (404): Not found')
    })
  })

  // ── Dictionary ──

  describe('getAnalyzersDictionary', () => {
    const analyzers = [
      { id: 'a1', name: 'Abuse_Finder_2_0', version: '2.0' },
      { id: 'a2', name: 'VirusTotal_GetReport_3_0', version: '3.0' },
      { id: 'a3', name: 'Shodan_Host_1_0' },
    ]

    it('maps analyzers to label/value/note items', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply(analyzers)

      const result = await service.getAnalyzersDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/analyzer`)
      expect(result.items).toEqual([
        { label: 'Abuse_Finder_2_0', value: 'a1', note: 'v2.0' },
        { label: 'VirusTotal_GetReport_3_0', value: 'a2', note: 'v3.0' },
        { label: 'Shodan_Host_1_0', value: 'a3', note: undefined },
      ])
    })

    it('filters analyzers by a case-insensitive search term', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply(analyzers)

      const result = await service.getAnalyzersDictionary({ search: 'virustotal' })

      expect(result.items).toEqual([
        { label: 'VirusTotal_GetReport_3_0', value: 'a2', note: 'v3.0' },
      ])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply(analyzers)

      const result = await service.getAnalyzersDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('returns an empty items array when the API returns a non-array', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply({ notAnArray: true })

      const result = await service.getAnalyzersDictionary({})

      expect(result.items).toEqual([])
    })

    it('falls back to id for the label when name is missing', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply([{ id: 'a9' }])

      const result = await service.getAnalyzersDictionary({})

      expect(result.items).toEqual([{ label: 'a9', value: 'a9', note: undefined }])
    })

    it('returns no items when the search matches nothing', async () => {
      mock.onGet(`${ BASE }/analyzer`).reply(analyzers)

      const result = await service.getAnalyzersDictionary({ search: 'no-such-analyzer' })

      expect(result.items).toEqual([])
    })
  })
})
