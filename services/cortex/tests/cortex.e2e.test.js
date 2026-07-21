'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Cortex Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cortex')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Analyzers ──

  describe('listAnalyzers', () => {
    it('returns an array of analyzers', async () => {
      const result = await service.listAnalyzers()

      expect(Array.isArray(result)).toBe(true)

      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  describe('getAnalyzersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getAnalyzersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports a search filter', async () => {
      const result = await service.getAnalyzersDictionary({ search: 'abuse' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getAnalyzer', () => {
    it('retrieves a single analyzer discovered via the dictionary', async () => {
      const dict = await service.getAnalyzersDictionary({})

      if (!dict.items.length) {
        console.log('Skipping getAnalyzer: no analyzers enabled on this Cortex instance')
        return
      }

      const analyzerId = dict.items[0].value
      const result = await service.getAnalyzer(analyzerId)

      expect(result).toHaveProperty('id', analyzerId)
    })
  })

  describe('getAnalyzersByType', () => {
    it('returns analyzers able to process an IP observable', async () => {
      const result = await service.getAnalyzersByType('IP')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Run Analysis ──

  describe('runAnalyzer + getJob + getJobReport + deleteJob', () => {
    // Running a real analyzer requires a specific analyzer id and a valid
    // observable, so this only runs when the developer supplies
    // testValues.analyzerId (+ optional observable/dataType overrides).
    const canRun = () => Boolean(testValues.analyzerId)

    let jobId

    it('runs an analyzer and creates a job', async () => {
      if (!canRun()) {
        console.log('Skipping runAnalyzer: set testValues.analyzerId (and optionally observable/dataType)')
        return
      }

      const observable = testValues.observable || '8.8.8.8'
      const dataType = testValues.dataType || 'IP'

      const result = await service.runAnalyzer(testValues.analyzerId, observable, dataType, 'AMBER')

      expect(result).toHaveProperty('id')
      jobId = result.id
    })

    it('retrieves the created job', async () => {
      if (!jobId) {
        console.log('Skipping getJob: no job was created')
        return
      }

      const result = await service.getJob(jobId)

      expect(result).toHaveProperty('id', jobId)
      expect(result).toHaveProperty('status')
    })

    it('retrieves the job report', async () => {
      if (!jobId) {
        console.log('Skipping getJobReport: no job was created')
        return
      }

      const result = await service.getJobReport(jobId)

      expect(result).toHaveProperty('id', jobId)
    })

    it('waits for the job report', async () => {
      if (!jobId) {
        console.log('Skipping waitForJobReport: no job was created')
        return
      }

      const result = await service.waitForJobReport(jobId)

      expect(result).toHaveProperty('id', jobId)
      expect(result).toHaveProperty('status')
    })

    it('deletes the created job', async () => {
      if (!jobId) {
        console.log('Skipping deleteJob: no job was created')
        return
      }

      const result = await service.deleteJob(jobId)

      expect(result).toEqual({ success: true, id: jobId })
    })
  })

  describe('listJobs', () => {
    it('returns an array of jobs', async () => {
      const result = await service.listJobs()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Responders ──

  describe('listResponders', () => {
    it('returns an array of responders', async () => {
      const result = await service.listResponders()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('runResponder + getResponderJob', () => {
    // Running a responder takes a real action (e.g. sends mail / blocks an
    // indicator), so this only runs when the developer explicitly supplies
    // testValues.responderId along with observable/dataType.
    const canRun = () =>
      Boolean(testValues.responderId && testValues.responderObservable && testValues.responderDataType)

    let responderJobId

    it('runs a responder when configured', async () => {
      if (!canRun()) {
        console.log(
          'Skipping runResponder: set testValues.responderId, responderObservable and responderDataType'
        )
        return
      }

      const result = await service.runResponder(
        testValues.responderId,
        testValues.responderObservable,
        testValues.responderDataType,
        'AMBER'
      )

      expect(result).toHaveProperty('id')
      responderJobId = result.id
    })

    it('retrieves the responder job', async () => {
      if (!responderJobId) {
        console.log('Skipping getResponderJob: no responder job was created')
        return
      }

      const result = await service.getResponderJob(responderJobId)

      expect(result).toHaveProperty('id', responderJobId)
    })
  })
})
