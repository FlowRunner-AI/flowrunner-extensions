'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('CloudConvert Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cloudconvert')
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

  const suffix = Date.now()

  // ── Account / Reference (always safe, read-only, no credits) ──

  describe('getCurrentUser', () => {
    it('returns the account with a credits balance', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('credits')
    })
  })

  describe('listSupportedFormats', () => {
    it('returns an array of supported conversions', async () => {
      const response = await service.listSupportedFormats('docx', 'pdf')

      expect(Array.isArray(response)).toBe(true)
      if (response.length) {
        expect(response[0]).toHaveProperty('output_format')
      }
    })
  })

  describe('getOutputFormatsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getOutputFormatsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('narrows the list by input format criteria', async () => {
      const result = await service.getOutputFormatsDictionary({ criteria: { inputFormat: 'docx' } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Jobs / Tasks listing (read-only, no credits) ──

  describe('listJobs', () => {
    it('returns jobs with pagination metadata', async () => {
      const response = await service.listJobs(undefined, undefined, false, 5, 1)

      expect(response).toHaveProperty('jobs')
      expect(Array.isArray(response.jobs)).toBe(true)
    })
  })

  describe('listTasks', () => {
    it('returns tasks with pagination metadata', async () => {
      const response = await service.listTasks(undefined, undefined, undefined, 5, 1)

      expect(response).toHaveProperty('tasks')
      expect(Array.isArray(response.tasks)).toBe(true)
    })
  })

  // ── Conversion lifecycle (consumes credits; needs a whitelisted source URL) ──
  //
  // In the CloudConvert Sandbox, import/url only works with whitelisted files.
  // Supply a whitelisted, publicly reachable source URL as testValues.sourceFileUrl
  // (and its format as testValues.sourceFormat, defaulting to the URL extension)
  // to exercise the full convert -> wait -> store -> getJob -> deleteJob flow.
  describe('convertFile + getJob + deleteJob', () => {
    const sourceUrl = () => testValues.sourceFileUrl
    let jobId

    it('converts a whitelisted file and stores the output', async () => {
      if (!sourceUrl()) {
        console.log('Skipping convertFile: set testValues.sourceFileUrl to a whitelisted source file URL')
        return
      }

      const response = await service.convertFile(
        sourceUrl(),
        undefined,
        testValues.sourceFormat,
        testValues.targetFormat || 'pdf'
      )

      expect(response).toHaveProperty('jobId')
      expect(response).toHaveProperty('status', 'finished')
      expect(Array.isArray(response.files)).toBe(true)
      expect(response.files.length).toBeGreaterThan(0)
      expect(response.files[0]).toHaveProperty('url')
      jobId = response.jobId
    })

    it('retrieves the finished job by id', async () => {
      if (!jobId) {
        console.log('Skipping getJob: no job was created')
        return
      }

      const response = await service.getJob(jobId)

      expect(response).toHaveProperty('id', jobId)
      expect(response).toHaveProperty('tasks')
    })

    it('lists tasks for the created job', async () => {
      if (!jobId) {
        console.log('Skipping listTasks(jobId): no job was created')
        return
      }

      const response = await service.listTasks(jobId)

      expect(Array.isArray(response.tasks)).toBe(true)
    })

    it('deletes the created job', async () => {
      if (!jobId) {
        console.log('Skipping deleteJob: no job was created')
        return
      }

      const response = await service.deleteJob(jobId)

      expect(response).toEqual({ success: true, jobId })
    })
  })

  // ── Convert without waiting (returns a job id immediately) ──
  describe('convertFile (no wait) + deleteJob', () => {
    it('returns the job id immediately when wait is disabled', async () => {
      if (!testValues.sourceFileUrl) {
        console.log('Skipping convertFile (no wait): set testValues.sourceFileUrl')
        return
      }

      const response = await service.convertFile(
        testValues.sourceFileUrl,
        undefined,
        testValues.sourceFormat,
        testValues.targetFormat || 'pdf',
        undefined,
        undefined,
        undefined,
        false
      )

      expect(response).toHaveProperty('jobId')
      expect(response).toHaveProperty('files', [])

      // Clean up the job we just created.
      try {
        await service.deleteJob(response.jobId)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Extract metadata (consumes credits; needs a whitelisted source URL) ──
  describe('extractMetadata', () => {
    it('extracts metadata from a whitelisted file', async () => {
      if (!testValues.sourceFileUrl) {
        console.log('Skipping extractMetadata: set testValues.sourceFileUrl')
        return
      }

      const response = await service.extractMetadata(
        testValues.sourceFileUrl,
        undefined,
        testValues.sourceFormat
      )

      expect(response).toHaveProperty('status', 'finished')
      expect(response).toHaveProperty('metadata')
      expect(typeof response.metadata).toBe('object')
    })
  })

  // ── Capture website (needs a whitelisted output; capture-website has no import) ──
  describe('captureWebsite', () => {
    // capture-website is often disabled on Sandbox keys, so only run when the
    // developer opts in via testValues.captureUrl.
    it('captures a website to PDF when a capture URL is configured', async () => {
      if (!testValues.captureUrl) {
        console.log('Skipping captureWebsite: set testValues.captureUrl to run this test')
        return
      }

      const response = await service.captureWebsite(
        testValues.captureUrl,
        'PDF',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `e2e-capture-${ suffix }.pdf`
      )

      expect(response).toHaveProperty('status', 'finished')
      expect(Array.isArray(response.files)).toBe(true)

      if (response.jobId) {
        try {
          await service.deleteJob(response.jobId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Raw job graph (createJob) using a whitelisted source URL ──
  describe('createJob', () => {
    it('runs a raw import -> convert -> export graph', async () => {
      if (!testValues.sourceFileUrl) {
        console.log('Skipping createJob: set testValues.sourceFileUrl')
        return
      }

      const tasks = {
        'import-1': { operation: 'import/url', url: testValues.sourceFileUrl },
        'convert-1': { operation: 'convert', input: 'import-1', output_format: testValues.targetFormat || 'pdf' },
        'export-1': { operation: 'export/url', input: 'convert-1' },
      }

      const response = await service.createJob(tasks, `e2e-${ suffix }`)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('status', 'finished')

      // Verify getTask on the export task, then clean up.
      const exportTask = (response.tasks || []).find(t => t.operation === 'export/url')

      if (exportTask) {
        const taskResponse = await service.getTask(exportTask.id)

        expect(taskResponse).toHaveProperty('id', exportTask.id)
      }

      try {
        await service.deleteJob(response.id)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })
})
