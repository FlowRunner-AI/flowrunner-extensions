const logger = {
  info: (...args) => console.log('[CloudConvert] info:', ...args),
  debug: (...args) => console.log('[CloudConvert] debug:', ...args),
  error: (...args) => console.log('[CloudConvert] error:', ...args),
  warn: (...args) => console.log('[CloudConvert] warn:', ...args),
}

const BASE_URLS = {
  'Production': 'https://api.cloudconvert.com/v2',
  'Sandbox': 'https://api.sandbox.cloudconvert.com/v2',
}

const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 240000

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @typedef {Object} getOutputFormatsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Input Format","name":"inputFormat","description":"Optional source format (e.g. docx) used to narrow the list to output formats reachable from it."}
 */

/**
 * @typedef {Object} getOutputFormatsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter formats by name (e.g. pdf, docx)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full list is returned in one call, so this is unused but kept for API compatibility."}
 * @paramDef {"type":"getOutputFormatsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional input format used to narrow the list of output formats."}
 */

/**
 * @usesFileStorage
 * @integrationName CloudConvert
 * @integrationIcon /icon.png
 */
class CloudConvertService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = BASE_URLS[config.environment] || BASE_URLS.Production
  }

  // ==========================================================================
  //  INTERNAL HELPERS
  // ==========================================================================

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const details = error.body?.errors ? ` Details: ${ JSON.stringify(error.body.errors) }` : ''

      logger.error(`${ logTag } - request failed: ${ message }${ details }`)

      throw new Error(`CloudConvert API error: ${ message }${ details }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeFormat(format) {
    return format ? String(format).trim().toLowerCase() : undefined
  }

  #filenameFromUrl(url) {
    try {
      return decodeURIComponent(String(url).split('/').pop().split('?')[0]) || 'file'
    } catch (error) {
      return 'file'
    }
  }

  async #downloadBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  /**
   * Builds an import task for a single source file: either an import/url task
   * (public URL) or an import/upload task (FlowRunner file, uploaded after job creation).
   */
  async #buildSingleImport(fileUrl, file, logTag) {
    if (!fileUrl && !file) {
      throw new Error('Provide the source file: set either File URL or File.')
    }

    if (fileUrl && file) {
      throw new Error('Provide exactly one source: File URL or File, not both.')
    }

    if (fileUrl) {
      return { taskName: 'import-1', task: { operation: 'import/url', url: fileUrl }, uploads: [] }
    }

    const buffer = await this.#downloadBuffer(file, logTag)

    return {
      taskName: 'import-1',
      task: { operation: 'import/upload' },
      uploads: [{ taskName: 'import-1', buffer, filename: this.#filenameFromUrl(file) }],
    }
  }

  /**
   * Builds import tasks for multi-input operations (merge, archive): one
   * import/url task per URL plus an optional import/upload task for a FlowRunner file.
   */
  async #buildMultiImport(fileUrls, file, minInputs, logTag) {
    const urls = (fileUrls || []).filter(Boolean)
    const tasks = {}
    const uploads = []
    const names = []

    urls.forEach((url, index) => {
      const name = `import-${ index + 1 }`

      tasks[name] = { operation: 'import/url', url }
      names.push(name)
    })

    if (file) {
      const buffer = await this.#downloadBuffer(file, logTag)
      const name = 'import-upload'

      tasks[name] = { operation: 'import/upload' }
      uploads.push({ taskName: name, buffer, filename: this.#filenameFromUrl(file) })
      names.push(name)
    }

    if (names.length < minInputs) {
      throw new Error(`This operation needs at least ${ minInputs } input file(s). ` +
        'Provide file URLs in File URLs and/or a FlowRunner file in File.')
    }

    return { tasks, uploads, names }
  }

  async #createJob(tasks, tag, logTag) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/jobs`,
      method: 'post',
      body: clean({ tasks, tag }),
    })

    return response.data
  }

  /**
   * Uploads FlowRunner file bytes to the signed upload forms of import/upload
   * tasks returned on job creation (task.result.form -> { url, parameters }).
   */
  async #performUploads(job, uploads, logTag) {
    for (const upload of uploads) {
      const uploadTask = (job.tasks || []).find(task => task.name === upload.taskName)
      const form = uploadTask?.result?.form

      if (!form || !form.url) {
        throw new Error(`CloudConvert did not return an upload form for task '${ upload.taskName }'.`)
      }

      logger.debug(`${ logTag } - uploading '${ upload.filename }' to task '${ upload.taskName }'`)

      // Do NOT set Content-Type manually - the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      for (const [key, value] of Object.entries(form.parameters || {})) {
        formData.append(key, value)
      }

      formData.append('file', upload.buffer, { filename: upload.filename })

      await Flowrunner.Request.post(form.url).form(formData)
    }
  }

  /**
   * Polls GET /jobs/{id} every 3 seconds until the job reaches a terminal
   * status. Throws with the failing task messages when the job errors.
   */
  async #waitForJob(jobId, logTag) {
    const startedAt = Date.now()

    while (true) {
      const response = await this.#apiRequest({ logTag, url: `${ this.baseUrl }/jobs/${ jobId }` })
      const job = response.data

      if (job.status === 'finished') {
        return job
      }

      if (job.status === 'error') {
        const failures = (job.tasks || [])
          .filter(task => task.status === 'error')
          .map(task => `${ task.name } (${ task.operation }): ${ task.message || task.code || 'unknown error' }`)

        throw new Error(`CloudConvert job ${ jobId } failed. ${ failures.join('; ') || 'No task error details available.' }`)
      }

      if (Date.now() - startedAt > MAX_WAIT_MS) {
        throw new Error(`CloudConvert job ${ jobId } is still '${ job.status }' after ${ Math.round(MAX_WAIT_MS / 1000) }s. ` +
          'Use the Get Job action later to check its result.')
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  /**
   * Downloads every file produced by finished export/url tasks and saves it to
   * FlowRunner file storage, returning the stored file URLs.
   */
  async #collectExportFiles(job, fileOptions, logTag) {
    const exportTasks = (job.tasks || []).filter(task => task.operation === 'export/url' && task.status === 'finished')
    const files = []

    for (const task of exportTasks) {
      for (const file of task.result?.files || []) {
        const buffer = await this.#downloadBuffer(file.url, logTag)

        const { url } = await this.flowrunner.Files.uploadFile(buffer, {
          filename: file.filename || `output_${ Date.now() }`,
          generateUrl: true,
          overwrite: true,
          ...(fileOptions || { scope: 'FLOW' }),
        })

        files.push({ fileName: file.filename || null, url, sizeBytes: file.size ?? buffer.length })
      }
    }

    return files
  }

  /**
   * Creates a job from a task graph, performs pending import/upload uploads,
   * optionally waits for completion and stores export outputs in FlowRunner Files.
   */
  async #executeGraph({ tasks, tag, uploads = [], wait, fileOptions, logTag }) {
    let job = await this.#createJob(tasks, tag, logTag)

    logger.info(`${ logTag } - created job ${ job.id }`)

    if (uploads.length) {
      await this.#performUploads(job, uploads, logTag)
    }

    if (!wait) {
      return { jobId: job.id, status: job.status, tag: job.tag || null, files: [] }
    }

    job = await this.#waitForJob(job.id, logTag)

    const files = await this.#collectExportFiles(job, fileOptions, logTag)

    return { jobId: job.id, status: job.status, tag: job.tag || null, files }
  }

  // ==========================================================================
  //  CONVERSION
  // ==========================================================================

  /**
   * @operationName Convert File
   * @category Conversion
   * @description Converts a file to another format using CloudConvert (200+ formats: documents, spreadsheets, presentations, images, audio, video, ebooks, and more). Provide the source as a public URL or a FlowRunner file, pick the target format (the dropdown narrows to reachable formats when Input Format is set), and optionally choose a conversion engine or pass engine-specific options (e.g. page ranges for PDF input). By default the action waits for the conversion to finish and saves the converted file to FlowRunner file storage, returning its URL. Use List Supported Formats to explore available conversions.
   * @route POST /convert-file
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"Publicly accessible URL of the source file. CloudConvert downloads it directly. Use this OR File, not both."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to convert (its URL). The file's bytes are uploaded to CloudConvert. Use this OR File URL, not both."}
   * @paramDef {"type":"String","label":"Input Format","name":"inputFormat","description":"Source format (e.g. docx). Usually detected from the file extension; set it to disambiguate extension-less files and to narrow the Output Format dropdown."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","required":true,"dictionary":"getOutputFormatsDictionary","dependsOn":["inputFormat"],"description":"Target format (e.g. pdf). Pick from the dropdown or type a format name."}
   * @paramDef {"type":"String","label":"Engine","name":"engine","description":"Optional conversion engine (e.g. office, libreoffice, imagemagick, graphicsmagick, mutool). Leave empty to let CloudConvert pick the default engine for the format pair."}
   * @paramDef {"type":"String","label":"Output Filename","name":"filename","description":"Filename for the converted file including extension (e.g. report.pdf). Defaults to the source name with the new extension."}
   * @paramDef {"type":"Object","label":"Conversion Options","name":"options","freeform":true,"description":"Engine-specific options merged into the convert task as a JSON object, e.g. {\"pages\":\"1-3\"} for PDF page ranges or {\"quality\":80} for image quality. See CloudConvert's docs or List Supported Formats for available options per format pair."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the conversion to finish and returns the stored output file URLs. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the converted file in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","status":"finished","tag":null,"files":[{"fileName":"report.pdf","url":"https://files.flowrunner.example/flow/report.pdf","sizeBytes":51234}]}
   */
  async convertFile(fileUrl, file, inputFormat, outputFormat, engine, filename, options, waitForCompletion, fileOptions) {
    const logTag = '[convertFile]'
    const { taskName, task, uploads } = await this.#buildSingleImport(fileUrl, file, logTag)

    const convertTask = clean({
      operation: 'convert',
      input: taskName,
      input_format: this.#normalizeFormat(inputFormat),
      output_format: this.#normalizeFormat(outputFormat),
      engine,
      filename,
    })

    Object.assign(convertTask, options || {})

    return await this.#executeGraph({
      logTag,
      uploads,
      fileOptions,
      wait: waitForCompletion !== false,
      tasks: {
        [taskName]: task,
        'convert-1': convertTask,
        'export-1': { operation: 'export/url', input: 'convert-1' },
      },
    })
  }

  /**
   * @operationName Merge Files to PDF
   * @category Conversion
   * @description Merges multiple files into a single PDF document. Accepts any mix of public file URLs plus optionally one FlowRunner file (at least two inputs in total); non-PDF inputs (images, Office documents, etc.) are converted automatically during the merge. Files are merged in the order provided, with the FlowRunner file last. By default the action waits for completion and saves the merged PDF to FlowRunner file storage, returning its URL.
   * @route POST /merge-files-to-pdf
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"File URLs","name":"fileUrls","description":"Publicly accessible URLs of the files to merge, in merge order. Provide at least two inputs in total (URLs plus the optional FlowRunner file)."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"Optional FlowRunner file to include in the merge (its URL). It is appended after the URL inputs."}
   * @paramDef {"type":"String","label":"Output Filename","name":"filename","description":"Filename for the merged PDF including extension (e.g. merged.pdf)."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the merge to finish and returns the stored output file URL. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the merged PDF in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"5b1f0c77-93d1-4a52-8e11-8f0f3a7f6f21","status":"finished","tag":null,"files":[{"fileName":"merged.pdf","url":"https://files.flowrunner.example/flow/merged.pdf","sizeBytes":204800}]}
   */
  async mergeFilesToPdf(fileUrls, file, filename, waitForCompletion, fileOptions) {
    const logTag = '[mergeFilesToPdf]'
    const { tasks, uploads, names } = await this.#buildMultiImport(fileUrls, file, 2, logTag)

    tasks['merge-1'] = clean({
      operation: 'merge',
      input: names,
      output_format: 'pdf',
      filename,
    })

    tasks['export-1'] = { operation: 'export/url', input: 'merge-1' }

    return await this.#executeGraph({
      logTag,
      tasks,
      uploads,
      fileOptions,
      wait: waitForCompletion !== false,
    })
  }

  /**
   * @operationName Capture Website
   * @category Conversion
   * @description Captures a website as a PDF document or a PNG/JPG screenshot using a headless browser. Control the viewport size, when the capture is taken (page load event, DOM ready, or network idle), an extra wait time, and for PDF output an optional page range. By default the action waits for completion and saves the capture to FlowRunner file storage, returning its URL.
   * @route POST /capture-website
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Website URL","name":"url","required":true,"description":"The URL of the website to capture, e.g. https://example.com."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","required":true,"defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","JPG"]}},"description":"Capture output: PDF document or PNG/JPG screenshot."}
   * @paramDef {"type":"Number","label":"Screen Width","name":"screenWidth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Browser viewport width in pixels (default 1366)."}
   * @paramDef {"type":"Number","label":"Screen Height","name":"screenHeight","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Browser viewport height in pixels (default 768)."}
   * @paramDef {"type":"String","label":"Wait Until","name":"waitUntil","uiComponent":{"type":"DROPDOWN","options":{"values":["Load Event","DOM Content Loaded","Network Idle (No Connections)","Network Idle (Max 2 Connections)"]}},"description":"Browser event that triggers the capture. Network Idle options wait until the page stops making requests - useful for JavaScript-heavy pages."}
   * @paramDef {"type":"Number","label":"Wait Time","name":"waitTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Additional milliseconds to wait after the Wait Until event before capturing, e.g. 2000 for pages with delayed rendering."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Page range for PDF output, e.g. 1-3. Ignored for PNG/JPG."}
   * @paramDef {"type":"String","label":"Output Filename","name":"filename","description":"Filename for the capture including extension (e.g. homepage.pdf)."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the capture to finish and returns the stored output file URL. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the capture in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"c7a9a7c1-6f3e-4e0c-b7a2-b5b6f9a41f77","status":"finished","tag":null,"files":[{"fileName":"homepage.pdf","url":"https://files.flowrunner.example/flow/homepage.pdf","sizeBytes":98304}]}
   */
  async captureWebsite(url, outputFormat, screenWidth, screenHeight, waitUntil, waitTime, pages, filename, waitForCompletion, fileOptions) {
    const logTag = '[captureWebsite]'

    const captureTask = clean({
      operation: 'capture-website',
      url,
      output_format: this.#resolveChoice(outputFormat, { 'PDF': 'pdf', 'PNG': 'png', 'JPG': 'jpg' }) || 'pdf',
      screen_width: screenWidth,
      screen_height: screenHeight,
      wait_until: this.#resolveChoice(waitUntil, {
        'Load Event': 'load',
        'DOM Content Loaded': 'domcontentloaded',
        'Network Idle (No Connections)': 'networkidle0',
        'Network Idle (Max 2 Connections)': 'networkidle2',
      }),
      wait_time: waitTime,
      pages,
      filename,
    })

    return await this.#executeGraph({
      logTag,
      fileOptions,
      wait: waitForCompletion !== false,
      tasks: {
        'capture-1': captureTask,
        'export-1': { operation: 'export/url', input: 'capture-1' },
      },
    })
  }

  /**
   * @operationName Optimize File
   * @category Conversion
   * @description Reduces the file size of a PDF, PNG, or JPG without changing its format. Choose an optimization profile tuned for web viewing, printing, or archiving, and optionally an image quality level (1-100) for JPG/PNG input. By default the action waits for completion and saves the optimized file to FlowRunner file storage, returning its URL.
   * @route POST /optimize-file
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"Publicly accessible URL of the file to optimize (PDF, PNG, or JPG). Use this OR File, not both."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to optimize (its URL). Use this OR File URL, not both."}
   * @paramDef {"type":"String","label":"Input Format","name":"inputFormat","description":"Source format (pdf, png, or jpg). Usually detected from the file extension; set it for extension-less files."}
   * @paramDef {"type":"String","label":"Profile","name":"profile","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","Print","Archive"]}},"description":"Optimization profile: Web optimizes for fast online viewing, Print preserves print quality, Archive balances size and long-term fidelity. Defaults to Web."}
   * @paramDef {"type":"Number","label":"Quality","name":"quality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image quality from 1 (smallest) to 100 (best) for JPG/PNG input."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the optimization to finish and returns the stored output file URL. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the optimized file in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"e2b0a6f4-90c4-4f0a-8a77-4a1f2c1d9b55","status":"finished","tag":null,"files":[{"fileName":"report.pdf","url":"https://files.flowrunner.example/flow/report.pdf","sizeBytes":20480}]}
   */
  async optimizeFile(fileUrl, file, inputFormat, profile, quality, waitForCompletion, fileOptions) {
    const logTag = '[optimizeFile]'
    const { taskName, task, uploads } = await this.#buildSingleImport(fileUrl, file, logTag)

    const optimizeTask = clean({
      operation: 'optimize',
      input: taskName,
      input_format: this.#normalizeFormat(inputFormat),
      profile: this.#resolveChoice(profile, { 'Web': 'web', 'Print': 'print', 'Archive': 'archive' }),
      quality,
    })

    return await this.#executeGraph({
      logTag,
      uploads,
      fileOptions,
      wait: waitForCompletion !== false,
      tasks: {
        [taskName]: task,
        'optimize-1': optimizeTask,
        'export-1': { operation: 'export/url', input: 'optimize-1' },
      },
    })
  }

  /**
   * @operationName Create Archive
   * @category Conversion
   * @description Bundles multiple files into a single archive (ZIP, RAR, 7Z, or TAR). Accepts any mix of public file URLs plus optionally one FlowRunner file (at least one input). By default the action waits for completion and saves the archive to FlowRunner file storage, returning its URL.
   * @route POST /create-archive
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"File URLs","name":"fileUrls","description":"Publicly accessible URLs of the files to include in the archive."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"Optional FlowRunner file to include in the archive (its URL)."}
   * @paramDef {"type":"String","label":"Archive Format","name":"outputFormat","defaultValue":"ZIP","uiComponent":{"type":"DROPDOWN","options":{"values":["ZIP","RAR","7Z","TAR"]}},"description":"Archive type to create. Defaults to ZIP."}
   * @paramDef {"type":"String","label":"Archive Filename","name":"filename","description":"Filename for the archive including extension (e.g. bundle.zip)."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the archive to be created and returns the stored output file URL. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the archive in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"a3d2b8f0-2c41-45cf-9d15-0f8f2f0a6b19","status":"finished","tag":null,"files":[{"fileName":"bundle.zip","url":"https://files.flowrunner.example/flow/bundle.zip","sizeBytes":307200}]}
   */
  async createArchive(fileUrls, file, outputFormat, filename, waitForCompletion, fileOptions) {
    const logTag = '[createArchive]'
    const { tasks, uploads, names } = await this.#buildMultiImport(fileUrls, file, 1, logTag)

    tasks['archive-1'] = clean({
      operation: 'archive',
      input: names,
      output_format: this.#resolveChoice(outputFormat, { 'ZIP': 'zip', 'RAR': 'rar', '7Z': '7z', 'TAR': 'tar' }) || 'zip',
      filename,
    })

    tasks['export-1'] = { operation: 'export/url', input: 'archive-1' }

    return await this.#executeGraph({
      logTag,
      tasks,
      uploads,
      fileOptions,
      wait: waitForCompletion !== false,
    })
  }

  /**
   * @operationName Create Thumbnail
   * @category Conversion
   * @description Creates a thumbnail image (PNG, JPG, or WEBP) from a document, image, or video file. Set the maximum width and height in pixels and how the source should fit: shrink to fit within the bounds, crop to fill them exactly, or stretch ignoring the aspect ratio. By default the action waits for completion and saves the thumbnail to FlowRunner file storage, returning its URL.
   * @route POST /create-thumbnail
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"Publicly accessible URL of the source file. Use this OR File, not both."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to create a thumbnail from (its URL). Use this OR File URL, not both."}
   * @paramDef {"type":"String","label":"Thumbnail Format","name":"outputFormat","defaultValue":"PNG","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","JPG","WEBP"]}},"description":"Image format of the thumbnail. Defaults to PNG."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Thumbnail width in pixels."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Thumbnail height in pixels."}
   * @paramDef {"type":"String","label":"Fit","name":"fit","defaultValue":"Fit Within Bounds","uiComponent":{"type":"DROPDOWN","options":{"values":["Fit Within Bounds","Crop To Fill","Stretch To Exact Size"]}},"description":"How the source maps to the thumbnail size: Fit Within Bounds keeps the aspect ratio inside width x height, Crop To Fill fills the exact size and crops overflow, Stretch To Exact Size ignores the aspect ratio."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits for the thumbnail to be created and returns the stored output file URL. When disabled, returns the job ID immediately; check it later with Get Job."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the thumbnail in FlowRunner file storage. Defaults to the FLOW scope."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"f1c4d0b9-7a55-4a3e-b6a1-2e7f0d9c8a34","status":"finished","tag":null,"files":[{"fileName":"photo.png","url":"https://files.flowrunner.example/flow/photo.png","sizeBytes":15360}]}
   */
  async createThumbnail(fileUrl, file, outputFormat, width, height, fit, waitForCompletion, fileOptions) {
    const logTag = '[createThumbnail]'
    const { taskName, task, uploads } = await this.#buildSingleImport(fileUrl, file, logTag)

    const thumbnailTask = clean({
      operation: 'thumbnail',
      input: taskName,
      output_format: this.#resolveChoice(outputFormat, { 'PNG': 'png', 'JPG': 'jpg', 'WEBP': 'webp' }) || 'png',
      width,
      height,
      fit: this.#resolveChoice(fit, {
        'Fit Within Bounds': 'max',
        'Crop To Fill': 'crop',
        'Stretch To Exact Size': 'scale',
      }),
    })

    return await this.#executeGraph({
      logTag,
      uploads,
      fileOptions,
      wait: waitForCompletion !== false,
      tasks: {
        [taskName]: task,
        'thumbnail-1': thumbnailTask,
        'export-1': { operation: 'export/url', input: 'thumbnail-1' },
      },
    })
  }

  /**
   * @operationName Extract Metadata
   * @category Conversion
   * @description Extracts metadata from a file (e.g. PDF author, title, page count, producer; image EXIF data; video codec details) and returns it as a JSON object. The metadata is read directly from the CloudConvert task result - no output file is produced.
   * @route POST /extract-metadata
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"Publicly accessible URL of the file to inspect. Use this OR File, not both."}
   * @paramDef {"type":"String","label":"File","name":"file","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to inspect (its URL). Use this OR File URL, not both."}
   * @paramDef {"type":"String","label":"Input Format","name":"inputFormat","description":"Source format (e.g. pdf). Usually detected from the file extension; set it for extension-less files."}
   *
   * @returns {Object}
   * @sampleResult {"jobId":"b8e1c2d3-4f56-47a8-9b01-2c3d4e5f6a78","status":"finished","metadata":{"Author":"Jane Doe","Title":"Quarterly Report","PageCount":12,"Producer":"LibreOffice 7.4"}}
   */
  async extractMetadata(fileUrl, file, inputFormat) {
    const logTag = '[extractMetadata]'
    const { taskName, task, uploads } = await this.#buildSingleImport(fileUrl, file, logTag)

    const tasks = {
      [taskName]: task,
      'metadata-1': clean({
        operation: 'metadata',
        input: taskName,
        input_format: this.#normalizeFormat(inputFormat),
      }),
    }

    let job = await this.#createJob(tasks, undefined, logTag)

    if (uploads.length) {
      await this.#performUploads(job, uploads, logTag)
    }

    job = await this.#waitForJob(job.id, logTag)

    const metadataTask = (job.tasks || []).find(jobTask => jobTask.operation === 'metadata')

    return {
      jobId: job.id,
      status: job.status,
      metadata: metadataTask?.result?.metadata || {},
    }
  }

  // ==========================================================================
  //  JOBS
  // ==========================================================================

  /**
   * @operationName Create Job
   * @category Jobs
   * @description Creates a CloudConvert job from a raw task graph - the escape hatch for arbitrary pipelines not covered by the convenience actions (e.g. one import fanned out to several conversions, watermarking, or webhook-driven jobs). Tasks is a JSON object keyed by task name; each task needs an operation (import/url, import/upload, convert, merge, archive, optimize, thumbnail, metadata, capture-website, export/url, ...) and its operation-specific parameters, with input referencing upstream task names. When waiting, the finished job is returned with each task's result (export/url tasks expose temporary download URLs in result.files); outputs are NOT auto-saved to FlowRunner file storage.
   * @route POST /create-job
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Object","label":"Tasks","name":"tasks","required":true,"freeform":true,"description":"The task graph as a JSON object keyed by task name, e.g. {\"import-1\":{\"operation\":\"import/url\",\"url\":\"https://example.com/file.docx\"},\"convert-1\":{\"operation\":\"convert\",\"input\":\"import-1\",\"output_format\":\"pdf\"},\"export-1\":{\"operation\":\"export/url\",\"input\":\"convert-1\"}}."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Arbitrary string stored with the job, useful for filtering in List Jobs."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), waits until the job finishes and returns it with all task results. When disabled, returns the job immediately after creation."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","tag":"invoice-run","status":"finished","created_at":"2026-07-18T10:00:00+00:00","started_at":"2026-07-18T10:00:01+00:00","ended_at":"2026-07-18T10:00:09+00:00","tasks":[{"id":"6df0e5c1-2f11-4c99-bb1a-d0c2f8a11e01","name":"export-1","operation":"export/url","status":"finished","result":{"files":[{"filename":"file.pdf","size":51234,"url":"https://storage.cloudconvert.com/tasks/file.pdf"}]}}]}
   */
  async createJob(tasks, tag, waitForCompletion) {
    const logTag = '[createJob]'

    if (!tasks || typeof tasks !== 'object' || !Object.keys(tasks).length) {
      throw new Error('Tasks must be a non-empty JSON object keyed by task name.')
    }

    const job = await this.#createJob(tasks, tag, logTag)

    if (waitForCompletion === false) {
      return job
    }

    return await this.#waitForJob(job.id, logTag)
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Retrieves a CloudConvert job by ID, including its status (waiting, processing, finished, or error), timestamps, tag, and all tasks with their results. For finished jobs with an export/url task, the temporary download URLs are available in the task's result.files. Use this to check on jobs started with Wait For Completion disabled.
   * @route GET /get-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The ID of the job to retrieve, as returned by the conversion actions or Create Job."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","tag":null,"status":"finished","created_at":"2026-07-18T10:00:00+00:00","started_at":"2026-07-18T10:00:01+00:00","ended_at":"2026-07-18T10:00:09+00:00","tasks":[{"id":"6df0e5c1-2f11-4c99-bb1a-d0c2f8a11e01","name":"convert-1","operation":"convert","status":"finished","credits":1}]}
   */
  async getJob(jobId) {
    const response = await this.#apiRequest({
      logTag: '[getJob]',
      url: `${ this.baseUrl }/jobs/${ jobId }`,
    })

    return response.data
  }

  /**
   * @operationName List Jobs
   * @category Jobs
   * @description Lists CloudConvert jobs for the account, newest first, with pagination. Filter by status (Processing, Finished, or Error) and/or by the tag assigned at creation. Optionally include each job's tasks in the response. Returns the jobs plus pagination metadata.
   * @route GET /list-jobs
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Processing","Finished","Error"]}},"description":"Only return jobs with this status. Leave empty for all jobs."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Only return jobs created with this tag."}
   * @paramDef {"type":"Boolean","label":"Include Tasks","name":"includeTasks","uiComponent":{"type":"TOGGLE"},"description":"When enabled, each job in the list includes its tasks array."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of jobs per page (default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Result page to fetch, starting at 1."}
   *
   * @returns {Object}
   * @sampleResult {"jobs":[{"id":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","tag":"invoice-run","status":"finished","created_at":"2026-07-18T10:00:00+00:00","ended_at":"2026-07-18T10:00:09+00:00"}],"meta":{"current_page":1,"per_page":100}}
   */
  async listJobs(status, tag, includeTasks, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listJobs]',
      url: `${ this.baseUrl }/jobs`,
      query: {
        'filter[status]': this.#resolveChoice(status, { 'Processing': 'processing', 'Finished': 'finished', 'Error': 'error' }),
        'filter[tag]': tag,
        'include': includeTasks ? 'tasks' : undefined,
        'per_page': perPage,
        'page': page,
      },
    })

    return { jobs: response.data || [], meta: response.meta || null }
  }

  /**
   * @operationName Delete Job
   * @category Jobs
   * @description Deletes a CloudConvert job together with all of its tasks and stored data. Note that CloudConvert deletes jobs automatically 24 hours after they end, so explicit deletion is mainly useful for removing sensitive files early.
   * @route DELETE /delete-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The ID of the job to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"jobId":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3"}
   */
  async deleteJob(jobId) {
    await this.#apiRequest({
      logTag: '[deleteJob]',
      url: `${ this.baseUrl }/jobs/${ jobId }`,
      method: 'delete',
    })

    return { success: true, jobId }
  }

  // ==========================================================================
  //  TASKS
  // ==========================================================================

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single CloudConvert task by ID, including its operation, status, timing, consumed credits, payload, and result (e.g. result.files with download URLs for export/url tasks, or result.metadata for metadata tasks). Useful for inspecting one step of a job in detail.
   * @route GET /get-task
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to retrieve (found in a job's tasks array)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"6df0e5c1-2f11-4c99-bb1a-d0c2f8a11e01","name":"convert-1","job_id":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","operation":"convert","status":"finished","credits":1,"created_at":"2026-07-18T10:00:01+00:00","ended_at":"2026-07-18T10:00:08+00:00","result":{"files":[{"filename":"file.pdf","size":51234}]}}
   */
  async getTask(taskId) {
    const response = await this.#apiRequest({
      logTag: '[getTask]',
      url: `${ this.baseUrl }/tasks/${ taskId }`,
    })

    return response.data
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists CloudConvert tasks for the account, newest first, with pagination. Filter by the job they belong to, by status (Waiting, Processing, Finished, or Error), and/or by operation type (Convert, Merge, Export URL, etc.). Returns the tasks plus pagination metadata.
   * @route GET /list-tasks
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","description":"Only return tasks belonging to this job."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Waiting","Processing","Finished","Error"]}},"description":"Only return tasks with this status. Leave empty for all tasks."}
   * @paramDef {"type":"String","label":"Operation","name":"operation","uiComponent":{"type":"DROPDOWN","options":{"values":["Convert","Merge","Archive","Optimize","Thumbnail","Metadata","Capture Website","Import URL","Import Upload","Export URL"]}},"description":"Only return tasks of this operation type. Leave empty for all operations."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tasks per page (default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Result page to fetch, starting at 1."}
   *
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":"6df0e5c1-2f11-4c99-bb1a-d0c2f8a11e01","name":"convert-1","job_id":"9de0f8a2-1e63-4a05-a266-8a3b0d24e4d3","operation":"convert","status":"finished","credits":1}],"meta":{"current_page":1,"per_page":100}}
   */
  async listTasks(jobId, status, operation, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listTasks]',
      url: `${ this.baseUrl }/tasks`,
      query: {
        'filter[job_id]': jobId,
        'filter[status]': this.#resolveChoice(status, {
          'Waiting': 'waiting',
          'Processing': 'processing',
          'Finished': 'finished',
          'Error': 'error',
        }),
        'filter[operation]': this.#resolveChoice(operation, {
          'Convert': 'convert',
          'Merge': 'merge',
          'Archive': 'archive',
          'Optimize': 'optimize',
          'Thumbnail': 'thumbnail',
          'Metadata': 'metadata',
          'Capture Website': 'capture-website',
          'Import URL': 'import/url',
          'Import Upload': 'import/upload',
          'Export URL': 'export/url',
        }),
        'per_page': perPage,
        'page': page,
      },
    })

    return { tasks: response.data || [], meta: response.meta || null }
  }

  // ==========================================================================
  //  REFERENCE
  // ==========================================================================

  /**
   * @operationName List Supported Formats
   * @category Reference
   * @description Lists the conversion format pairs CloudConvert supports, optionally filtered by input and/or output format. Each entry describes one supported input-to-output conversion with the engine used, the credits it costs, and its format group (document, image, video, audio, archive, ...). Use this to discover what a given file type can be converted to before calling Convert File.
   * @route GET /list-supported-formats
   *
   * @paramDef {"type":"String","label":"Input Format","name":"inputFormat","description":"Only return conversions from this source format (e.g. docx)."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","description":"Only return conversions to this target format (e.g. pdf)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"operation":"convert","input_format":"docx","output_format":"pdf","engine":"office","credits":1,"meta":{"group":"document"}}]
   */
  async listSupportedFormats(inputFormat, outputFormat) {
    const response = await this.#apiRequest({
      logTag: '[listSupportedFormats]',
      url: `${ this.baseUrl }/convert/formats`,
      query: {
        'filter[input_format]': this.#normalizeFormat(inputFormat),
        'filter[output_format]': this.#normalizeFormat(outputFormat),
      },
    })

    return response.data || []
  }

  /**
   * @operationName Get Current User
   * @category Account
   * @description Retrieves the CloudConvert account associated with the configured API key, including the remaining conversion credits. Useful for monitoring credit balance before running large conversion batches and for verifying that the API key is valid.
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"id":1234,"username":"john-doe","email":"john@example.com","credits":2500,"created_at":"2024-01-15T09:30:00+00:00"}
   */
  async getCurrentUser() {
    const response = await this.#apiRequest({
      logTag: '[getCurrentUser]',
      url: `${ this.baseUrl }/users/me`,
    })

    return response.data
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Output Formats Dictionary
   * @description Provides the list of output formats for the Convert File action, sourced from CloudConvert's supported conversions. When an input format is provided via criteria, the list is narrowed to formats reachable from it. The option value is the lowercase format name expected by the API.
   * @route POST /get-output-formats-dictionary
   * @paramDef {"type":"getOutputFormatsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the optional input format criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PDF","value":"pdf","note":"document"}],"cursor":null}
   */
  async getOutputFormatsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getOutputFormatsDictionary]'
    const inputFormat = this.#normalizeFormat(criteria?.inputFormat)

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/convert/formats`,
      query: {
        'filter[input_format]': inputFormat,
      },
    })

    const groupsByFormat = new Map()

    for (const entry of response.data || []) {
      if (entry.output_format && !groupsByFormat.has(entry.output_format)) {
        groupsByFormat.set(entry.output_format, entry.meta?.group)
      }
    }

    const searchText = search ? String(search).toLowerCase() : null
    const items = [...groupsByFormat.entries()]
      .filter(([format]) => !searchText || format.includes(searchText))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([format, group]) => ({
        label: format.toUpperCase(),
        value: format,
        note: group || undefined,
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(CloudConvertService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your CloudConvert API key. Create it at cloudconvert.com under Dashboard -> Authorization -> API Keys with at least the task.read and task.write scopes.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Production', 'Sandbox'],
    defaultValue: 'Production',
    required: true,
    shared: false,
    hint: 'Production uses api.cloudconvert.com; Sandbox uses api.sandbox.cloudconvert.com for free testing with whitelisted files. The Sandbox requires its own API key created in the CloudConvert Sandbox dashboard.',
  },
])
