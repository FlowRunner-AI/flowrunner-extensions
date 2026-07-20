'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.cloudconvert.com/v2'

// Attaches a fake FlowRunner Files API to the service so #collectExportFiles
// can "upload" export outputs without touching real storage. Runtime-injected
// in production; stubbing here is the documented sandbox contract.
function stubFiles(service) {
  const calls = []

  service.flowrunner = {
    Files: {
      async uploadFile(buffer, options) {
        calls.push({ buffer, options })

        return { url: `https://files.flowrunner.example/${ options.filename }` }
      },
    },
  }

  return calls
}

// Convenience builder for a "finished" job with a single export/url task that
// produced one file, used by the wait-for-completion paths.
function finishedJobWithExport(jobId = 'job-1', file = { filename: 'out.pdf', size: 100, url: 'https://storage.cloudconvert.com/out.pdf' }) {
  return {
    id: jobId,
    status: 'finished',
    tag: null,
    tasks: [
      { name: 'export-1', operation: 'export/url', status: 'finished', result: { files: [file] } },
    ],
  }
}

describe('CloudConvert Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, environment: 'Production' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Remove any Files stub between tests so each test controls its own.
    delete service.flowrunner
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'environment',
          displayName: 'Environment',
          type: 'CHOICE',
          options: ['Production', 'Sandbox'],
          defaultValue: 'Production',
          required: true,
          shared: false,
        }),
      ])
    })

    it('sends the Authorization bearer header on requests', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ data: { id: 1 } })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Conversion: Convert File ──

  describe('convertFile', () => {
    it('builds an import/url + convert + export graph from a file URL and waits', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-1', status: 'processing', tag: null, tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-1`).reply({ data: finishedJobWithExport('job-1', { filename: 'report.pdf', size: 51234, url: 'https://storage.cloudconvert.com/report.pdf' }) })
      mock.onGet('https://storage.cloudconvert.com/report.pdf').reply(Buffer.from('PDFDATA'))

      const uploads = stubFiles(service)

      const result = await service.convertFile(
        'https://example.com/source.docx',
        undefined,
        'docx',
        'pdf'
      )

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks).toEqual({
        'import-1': { operation: 'import/url', url: 'https://example.com/source.docx' },
        'convert-1': { operation: 'convert', input: 'import-1', input_format: 'docx', output_format: 'pdf' },
        'export-1': { operation: 'export/url', input: 'convert-1' },
      })
      expect(result).toEqual({
        jobId: 'job-1',
        status: 'finished',
        tag: null,
        files: [{ fileName: 'report.pdf', url: 'https://files.flowrunner.example/report.pdf', sizeBytes: 51234 }],
      })
      expect(uploads).toHaveLength(1)
      expect(uploads[0].options).toMatchObject({ filename: 'report.pdf', generateUrl: true, overwrite: true, scope: 'FLOW' })
    })

    it('merges engine, filename, and freeform options into the convert task', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-2', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-2`).reply({ data: finishedJobWithExport('job-2') })
      mock.onGet('https://storage.cloudconvert.com/out.pdf').reply(Buffer.from('DATA'))
      stubFiles(service)

      await service.convertFile(
        'https://example.com/source.docx',
        undefined,
        'DOCX',
        'PDF',
        'office',
        'report.pdf',
        { pages: '1-3' }
      )

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['convert-1']).toEqual({
        operation: 'convert',
        input: 'import-1',
        input_format: 'docx',
        output_format: 'pdf',
        engine: 'office',
        filename: 'report.pdf',
        pages: '1-3',
      })
    })

    it('uploads FlowRunner file bytes and returns the job id without waiting', async () => {
      mock.onGet('https://files.example/report.docx').reply(Buffer.from('SOURCE'))
      mock.onPost(`${ BASE }/jobs`).reply({
        data: {
          id: 'job-3',
          status: 'waiting',
          tag: null,
          tasks: [{ name: 'import-1', operation: 'import/upload', result: { form: { url: 'https://upload.cloudconvert.com/form', parameters: { key: 'abc' } } } }],
        },
      })
      mock.onPost('https://upload.cloudconvert.com/form').reply({})

      const result = await service.convertFile(
        undefined,
        'https://files.example/report.docx',
        undefined,
        'pdf',
        undefined,
        undefined,
        undefined,
        false
      )

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['import-1']).toEqual({ operation: 'import/upload' })

      // The signed upload form was posted with a FormData that carries the file field.
      const uploadCall = mock.history.find(h => h.url === 'https://upload.cloudconvert.com/form')

      expect(uploadCall).toBeDefined()
      expect(uploadCall.formData._fields).toEqual(
        expect.arrayContaining([
          { name: 'key', value: 'abc', filename: undefined },
          { name: 'file', value: expect.any(Buffer), filename: { filename: 'report.docx' } },
        ])
      )
      expect(result).toEqual({ jobId: 'job-3', status: 'waiting', tag: null, files: [] })
    })

    it('throws when neither File URL nor File is provided', async () => {
      await expect(service.convertFile(undefined, undefined, undefined, 'pdf')).rejects.toThrow(
        'Provide the source file: set either File URL or File.'
      )
    })

    it('throws when both File URL and File are provided', async () => {
      await expect(
        service.convertFile('https://example.com/a.docx', 'https://files.example/b.docx', undefined, 'pdf')
      ).rejects.toThrow('Provide exactly one source: File URL or File, not both.')
    })

    it('wraps API errors from job creation', async () => {
      mock.onPost(`${ BASE }/jobs`).replyWithError({ message: 'Unauthorized', body: { message: 'Invalid API key' } })

      await expect(
        service.convertFile('https://example.com/a.docx', undefined, undefined, 'pdf')
      ).rejects.toThrow('CloudConvert API error: Invalid API key')
    })

    it('throws when the job finishes in error state', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-err', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-err`).reply({
        data: {
          id: 'job-err',
          status: 'error',
          tasks: [{ name: 'convert-1', operation: 'convert', status: 'error', message: 'Unsupported format' }],
        },
      })

      await expect(
        service.convertFile('https://example.com/a.docx', undefined, undefined, 'xyz')
      ).rejects.toThrow('CloudConvert job job-err failed. convert-1 (convert): Unsupported format')
    })
  })

  // ── Conversion: Merge Files to PDF ──

  describe('mergeFilesToPdf', () => {
    it('builds import/url tasks per url plus a merge and export task', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-m', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-m`).reply({ data: finishedJobWithExport('job-m', { filename: 'merged.pdf', size: 2048, url: 'https://storage.cloudconvert.com/merged.pdf' }) })
      mock.onGet('https://storage.cloudconvert.com/merged.pdf').reply(Buffer.from('MERGED'))
      stubFiles(service)

      const result = await service.mergeFilesToPdf(
        ['https://example.com/a.pdf', 'https://example.com/b.docx'],
        undefined,
        'merged.pdf'
      )

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks).toEqual({
        'import-1': { operation: 'import/url', url: 'https://example.com/a.pdf' },
        'import-2': { operation: 'import/url', url: 'https://example.com/b.docx' },
        'merge-1': { operation: 'merge', input: ['import-1', 'import-2'], output_format: 'pdf', filename: 'merged.pdf' },
        'export-1': { operation: 'export/url', input: 'merge-1' },
      })
      expect(result.files[0].fileName).toBe('merged.pdf')
    })

    it('appends a FlowRunner file as an import/upload input after url inputs', async () => {
      mock.onGet('https://files.example/extra.png').reply(Buffer.from('IMG'))
      mock.onPost(`${ BASE }/jobs`).reply({
        data: {
          id: 'job-m2',
          status: 'waiting',
          tasks: [{ name: 'import-upload', operation: 'import/upload', result: { form: { url: 'https://upload.cloudconvert.com/f', parameters: {} } } }],
        },
      })
      mock.onPost('https://upload.cloudconvert.com/f').reply({})

      await service.mergeFilesToPdf(['https://example.com/a.pdf'], 'https://files.example/extra.png', undefined, false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['import-upload']).toEqual({ operation: 'import/upload' })
      expect(createCall.body.tasks['merge-1'].input).toEqual(['import-1', 'import-upload'])
    })

    it('throws when fewer than two inputs are provided', async () => {
      await expect(
        service.mergeFilesToPdf(['https://example.com/only.pdf'], undefined)
      ).rejects.toThrow('This operation needs at least 2 input file(s).')
    })
  })

  // ── Conversion: Capture Website ──

  describe('captureWebsite', () => {
    it('builds a capture-website + export graph with defaults', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-c', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-c`).reply({ data: finishedJobWithExport('job-c', { filename: 'homepage.pdf', size: 98304, url: 'https://storage.cloudconvert.com/homepage.pdf' }) })
      mock.onGet('https://storage.cloudconvert.com/homepage.pdf').reply(Buffer.from('PAGE'))
      stubFiles(service)

      await service.captureWebsite('https://example.com')

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['capture-1']).toEqual({
        operation: 'capture-website',
        url: 'https://example.com',
        output_format: 'pdf',
      })
      expect(createCall.body.tasks['export-1']).toEqual({ operation: 'export/url', input: 'capture-1' })
    })

    it('maps display choices and includes viewport, waiting, and page options', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-c2', status: 'waiting', tasks: [] } })

      await service.captureWebsite(
        'https://example.com',
        'PNG',
        1920,
        1080,
        'Network Idle (No Connections)',
        2000,
        '1-2',
        'shot.png',
        false
      )

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['capture-1']).toEqual({
        operation: 'capture-website',
        url: 'https://example.com',
        output_format: 'png',
        screen_width: 1920,
        screen_height: 1080,
        wait_until: 'networkidle0',
        wait_time: 2000,
        pages: '1-2',
        filename: 'shot.png',
      })
    })
  })

  // ── Conversion: Optimize File ──

  describe('optimizeFile', () => {
    it('builds an optimize graph mapping the profile choice', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-o', status: 'waiting', tasks: [] } })

      await service.optimizeFile('https://example.com/a.pdf', undefined, 'pdf', 'Print', 80, false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['optimize-1']).toEqual({
        operation: 'optimize',
        input: 'import-1',
        input_format: 'pdf',
        profile: 'print',
        quality: 80,
      })
    })

    it('omits profile and quality when not provided', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-o2', status: 'waiting', tasks: [] } })

      await service.optimizeFile('https://example.com/a.pdf', undefined, undefined, undefined, undefined, false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['optimize-1']).toEqual({ operation: 'optimize', input: 'import-1' })
    })
  })

  // ── Conversion: Create Archive ──

  describe('createArchive', () => {
    it('builds an archive graph with mapped format and single input', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-a', status: 'waiting', tasks: [] } })

      await service.createArchive(['https://example.com/a.txt'], undefined, '7Z', 'bundle.7z', false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['archive-1']).toEqual({
        operation: 'archive',
        input: ['import-1'],
        output_format: '7z',
        filename: 'bundle.7z',
      })
    })

    it('defaults to zip when no format is provided', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-a2', status: 'waiting', tasks: [] } })

      await service.createArchive(['https://example.com/a.txt'], undefined, undefined, undefined, false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['archive-1'].output_format).toBe('zip')
    })

    it('throws when no input files are provided', async () => {
      await expect(service.createArchive([], undefined)).rejects.toThrow(
        'This operation needs at least 1 input file(s).'
      )
    })
  })

  // ── Conversion: Create Thumbnail ──

  describe('createThumbnail', () => {
    it('builds a thumbnail graph mapping format and fit choices', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-t', status: 'waiting', tasks: [] } })

      await service.createThumbnail('https://example.com/a.png', undefined, 'JPG', 200, 150, 'Crop To Fill', false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['thumbnail-1']).toEqual({
        operation: 'thumbnail',
        input: 'import-1',
        output_format: 'jpg',
        width: 200,
        height: 150,
        fit: 'crop',
      })
    })

    it('defaults the thumbnail format to png', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-t2', status: 'waiting', tasks: [] } })

      await service.createThumbnail('https://example.com/a.png', undefined, undefined, undefined, undefined, undefined, false)

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['thumbnail-1']).toEqual({
        operation: 'thumbnail',
        input: 'import-1',
        output_format: 'png',
      })
    })
  })

  // ── Conversion: Extract Metadata ──

  describe('extractMetadata', () => {
    it('creates a metadata job, waits, and returns the metadata result', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-md', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-md`).reply({
        data: {
          id: 'job-md',
          status: 'finished',
          tasks: [{ name: 'metadata-1', operation: 'metadata', status: 'finished', result: { metadata: { Author: 'Jane', PageCount: 12 } } }],
        },
      })

      const result = await service.extractMetadata('https://example.com/a.pdf', undefined, 'pdf')

      const createCall = mock.history.find(h => h.method === 'post' && h.url === `${ BASE }/jobs`)

      expect(createCall.body.tasks['metadata-1']).toEqual({ operation: 'metadata', input: 'import-1', input_format: 'pdf' })
      expect(result).toEqual({
        jobId: 'job-md',
        status: 'finished',
        metadata: { Author: 'Jane', PageCount: 12 },
      })
    })

    it('returns empty metadata when the task has none', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-md2', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-md2`).reply({
        data: { id: 'job-md2', status: 'finished', tasks: [{ name: 'metadata-1', operation: 'metadata', status: 'finished', result: {} }] },
      })

      const result = await service.extractMetadata('https://example.com/a.pdf')

      expect(result.metadata).toEqual({})
    })
  })

  // ── Jobs ──

  describe('createJob', () => {
    it('rejects a non-object tasks graph', async () => {
      await expect(service.createJob(null)).rejects.toThrow('Tasks must be a non-empty JSON object keyed by task name.')
      await expect(service.createJob({})).rejects.toThrow('Tasks must be a non-empty JSON object keyed by task name.')
      expect(mock.history).toHaveLength(0)
    })

    it('creates a job and returns it immediately when not waiting', async () => {
      const job = { id: 'job-raw', status: 'waiting', tasks: [] }

      mock.onPost(`${ BASE }/jobs`).reply({ data: job })

      const tasks = { 'import-1': { operation: 'import/url', url: 'https://example.com/a.docx' } }
      const result = await service.createJob(tasks, 'my-tag', false)

      expect(mock.history[0].body).toEqual({ tasks, tag: 'my-tag' })
      expect(result).toEqual(job)
    })

    it('creates a job and waits for completion by default', async () => {
      mock.onPost(`${ BASE }/jobs`).reply({ data: { id: 'job-raw2', status: 'processing', tasks: [] } })
      mock.onGet(`${ BASE }/jobs/job-raw2`).reply({ data: { id: 'job-raw2', status: 'finished', tasks: [] } })

      const result = await service.createJob({ 'a': { operation: 'import/url', url: 'https://x/y' } })

      expect(result).toEqual({ id: 'job-raw2', status: 'finished', tasks: [] })
    })
  })

  describe('getJob', () => {
    it('fetches a job by id and returns response.data', async () => {
      mock.onGet(`${ BASE }/jobs/job-1`).reply({ data: { id: 'job-1', status: 'finished' } })

      const result = await service.getJob('job-1')

      expect(result).toEqual({ id: 'job-1', status: 'finished' })
      expect(mock.history[0].url).toBe(`${ BASE }/jobs/job-1`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/jobs/nope`).replyWithError({ message: 'Not found' })

      await expect(service.getJob('nope')).rejects.toThrow('CloudConvert API error: Not found')
    })
  })

  describe('listJobs', () => {
    it('lists jobs with no filters', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ data: [{ id: 'j1' }], meta: { current_page: 1 } })

      const result = await service.listJobs()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ jobs: [{ id: 'j1' }], meta: { current_page: 1 } })
    })

    it('maps status choice and passes filters and pagination', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({ data: [], meta: null })

      await service.listJobs('Finished', 'my-tag', true, 25, 2)

      expect(mock.history[0].query).toEqual({
        'filter[status]': 'finished',
        'filter[tag]': 'my-tag',
        'include': 'tasks',
        'per_page': 25,
        'page': 2,
      })
    })

    it('defaults meta to null and jobs to empty when absent', async () => {
      mock.onGet(`${ BASE }/jobs`).reply({})

      const result = await service.listJobs()

      expect(result).toEqual({ jobs: [], meta: null })
    })
  })

  describe('deleteJob', () => {
    it('sends delete and returns success with the job id', async () => {
      mock.onDelete(`${ BASE }/jobs/job-1`).reply(undefined)

      const result = await service.deleteJob('job-1')

      expect(result).toEqual({ success: true, jobId: 'job-1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/jobs/job-1`)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/jobs/job-1`).replyWithError({ message: 'Forbidden' })

      await expect(service.deleteJob('job-1')).rejects.toThrow('CloudConvert API error: Forbidden')
    })
  })

  // ── Tasks ──

  describe('getTask', () => {
    it('fetches a task by id', async () => {
      mock.onGet(`${ BASE }/tasks/task-1`).reply({ data: { id: 'task-1', operation: 'convert' } })

      const result = await service.getTask('task-1')

      expect(result).toEqual({ id: 'task-1', operation: 'convert' })
      expect(mock.history[0].url).toBe(`${ BASE }/tasks/task-1`)
    })
  })

  describe('listTasks', () => {
    it('lists tasks with no filters', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ data: [{ id: 't1' }], meta: { current_page: 1 } })

      const result = await service.listTasks()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ tasks: [{ id: 't1' }], meta: { current_page: 1 } })
    })

    it('maps status and operation choices and passes all filters', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ data: [], meta: null })

      await service.listTasks('job-1', 'Processing', 'Capture Website', 10, 3)

      expect(mock.history[0].query).toEqual({
        'filter[job_id]': 'job-1',
        'filter[status]': 'processing',
        'filter[operation]': 'capture-website',
        'per_page': 10,
        'page': 3,
      })
    })

    it('defaults tasks and meta when absent', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({})

      const result = await service.listTasks()

      expect(result).toEqual({ tasks: [], meta: null })
    })
  })

  // ── Reference / Account ──

  describe('listSupportedFormats', () => {
    it('lists formats with no filters', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({ data: [{ input_format: 'docx', output_format: 'pdf' }] })

      const result = await service.listSupportedFormats()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual([{ input_format: 'docx', output_format: 'pdf' }])
    })

    it('normalizes and passes input/output format filters', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({ data: [] })

      await service.listSupportedFormats(' DOCX ', 'PDF')

      expect(mock.history[0].query).toEqual({
        'filter[input_format]': 'docx',
        'filter[output_format]': 'pdf',
      })
    })

    it('returns an empty array when data is absent', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({})

      const result = await service.listSupportedFormats()

      expect(result).toEqual([])
    })
  })

  describe('getCurrentUser', () => {
    it('fetches the current user and returns response.data', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ data: { id: 1, username: 'john', credits: 2500 } })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 1, username: 'john', credits: 2500 })
      expect(mock.history[0].url).toBe(`${ BASE }/users/me`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getCurrentUser()).rejects.toThrow('CloudConvert API error: Unauthorized')
    })
  })

  // ── Dictionary ──

  describe('getOutputFormatsDictionary', () => {
    it('maps unique output formats to sorted, uppercased items', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({
        data: [
          { output_format: 'pdf', meta: { group: 'document' } },
          { output_format: 'png', meta: { group: 'image' } },
          { output_format: 'pdf', meta: { group: 'document' } },
          { output_format: 'docx', meta: { group: 'document' } },
        ],
      })

      const result = await service.getOutputFormatsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'DOCX', value: 'docx', note: 'document' },
          { label: 'PDF', value: 'pdf', note: 'document' },
          { label: 'PNG', value: 'png', note: 'image' },
        ],
        cursor: null,
      })
    })

    it('narrows the list by input format from criteria', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({ data: [{ output_format: 'pdf', meta: { group: 'document' } }] })

      await service.getOutputFormatsDictionary({ criteria: { inputFormat: 'DOCX' } })

      expect(mock.history[0].query).toEqual({ 'filter[input_format]': 'docx' })
    })

    it('filters output formats by search text', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({
        data: [
          { output_format: 'pdf', meta: { group: 'document' } },
          { output_format: 'png', meta: { group: 'image' } },
        ],
      })

      const result = await service.getOutputFormatsDictionary({ search: 'pn' })

      expect(result.items).toEqual([{ label: 'PNG', value: 'png', note: 'image' }])
    })

    it('handles a null payload and missing group notes', async () => {
      mock.onGet(`${ BASE }/convert/formats`).reply({ data: [{ output_format: 'zip' }] })

      const result = await service.getOutputFormatsDictionary(null)

      expect(result).toEqual({ items: [{ label: 'ZIP', value: 'zip', note: undefined }], cursor: null })
    })

    it('propagates API errors (no error swallowing)', async () => {
      mock.onGet(`${ BASE }/convert/formats`).replyWithError({ message: 'Boom' })

      await expect(service.getOutputFormatsDictionary({})).rejects.toThrow('CloudConvert API error: Boom')
    })
  })
})
