'use strict'

const API_BASE_URL = 'https://generativelanguage.googleapis.com'
const UPLOAD_BASE_URL = 'https://generativelanguage.googleapis.com/upload'

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mov': 'video/mov',
  '.avi': 'video/avi',
  '.wmv': 'video/wmv',
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const logger = {
  info: (...args) => console.log('[Gemini AI Service] info:', ...args),
  debug: (...args) => console.log('[Gemini AI Service] debug:', ...args),
  error: (...args) => console.log('[Gemini AI Service] error:', ...args),
  warn: (...args) => console.log('[Gemini AI Service] warn:', ...args),
}

/**
 * @integrationName Gemini AI
 * @integrationIcon /icon.svg
 */
class GeminiAIService {
  constructor(config, context) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method, headers, body, query, form, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query)
        .set({ 'x-goog-api-key': this.apiKey })

      if (headers) {
        request.set(headers)
      }

      if (form) {
        request.form(form)
        request.set({ 'Content-Type': 'multipart/form-data' })

        return await request
      }

      if (body) {
        return await request
          .set({ 'Content-Type': 'application/json' })
          .send(body)
      }

      return await request
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  async #waitForFileActive(fileName, logTag) {
    const maxAttempts = 60
    const delayMs = 2000

    for (let i = 0; i < maxAttempts; i++) {
      const fileInfo = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1beta/${ fileName }`,
        logTag: `${ logTag } - polling file status (${ i + 1 }/${ maxAttempts })`,
      })

      if (fileInfo.state === 'ACTIVE') {
        return fileInfo
      }

      if (fileInfo.state === 'FAILED') {
        throw new Error(`File processing failed: ${ fileInfo.error?.message || 'unknown error' }`)
      }

      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('File processing timed out after 120 seconds')
  }

  #detectMimeType(url) {
    const pathname = url.split('?')[0].split('#')[0]
    const ext = ('.' + pathname.split('.').pop()).toLowerCase()

    return MIME_TYPES[ext] || 'application/octet-stream'
  }

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || 'file'
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable list of available Gemini models that support content generation for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini 2.5 Flash","value":"models/gemini-2.5-flash","note":"models/gemini-2.5-flash"},{"label":"Gemini 2.0 Flash","value":"models/gemini-2.0-flash","note":"models/gemini-2.0-flash"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { pageSize: 100 }

    if (cursor) {
      query.pageToken = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/models`,
      query,
      logTag: 'getModelsDictionary',
    })

    let models = (response.models || []).filter(model =>
      model.supportedGenerationMethods?.includes('generateContent')
    )

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model =>
        model.displayName?.toLowerCase().includes(searchLower) ||
        model.name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: models.map(model => ({
        label: model.displayName || model.name,
        value: model.name,
        note: model.name,
      })),
      cursor: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file to the Gemini Files API for use in content generation. Downloads the file from the provided URL, uploads it to Gemini, and polls until the file is processed and ready. Supports documents, images, audio, and video files.
   * @route POST /upload-file
   *
   * @appearanceColor #4285F4 #5E97F6
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the file to upload. Must be a publicly accessible URL pointing to a document, image, audio, or video file."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Optional display name for the uploaded file in Gemini. Defaults to the original filename from the URL."}
   * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","description":"MIME type of the file (e.g., 'application/pdf', 'image/png'). Auto-detected from the URL extension if not provided."}
   *
   * @returns {Object}
   * @sampleResult {"name":"files/abc123def456","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","expirationTime":"2025-01-17T10:30:00.000Z","uri":"https://generativelanguage.googleapis.com/v1beta/files/abc123def456","state":"ACTIVE"}
   */
  async uploadFile(fileUrl, displayName, mimeType) {
    const resolvedMimeType = mimeType || this.#detectMimeType(fileUrl)
    const resolvedDisplayName = displayName || this.#extractFileName(fileUrl)

    logger.debug(`uploadFile - downloading file from: ${ fileUrl }`)

    const fileBuffer = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    const form = new Flowrunner.Request.FormData()

    form.append('metadata', JSON.stringify({
      file: { displayName: resolvedDisplayName },
    }), { contentType: 'application/json' })

    form.append('file', fileBuffer, {
      filename: resolvedDisplayName,
      contentType: resolvedMimeType,
    })

    const uploadResponse = await this.#apiRequest({
      url: `${ UPLOAD_BASE_URL }/v1beta/files`,
      method: 'post',
      form,
      logTag: 'uploadFile',
    })

    const fileName = uploadResponse.file?.name

    if (!fileName) {
      throw new Error('Upload succeeded but no file name was returned')
    }

    return await this.#waitForFileActive(fileName, 'uploadFile')
  }

  /**
   * @operationName List Files
   * @category Files
   * @description Lists files uploaded to the Gemini Files API with pagination support. Returns file metadata including name, size, MIME type, and processing state.
   * @route POST /list-files
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of files to return per page. Defaults to 10, can be up to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous list response to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"files":[{"name":"files/abc123","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","state":"ACTIVE"}],"nextPageToken":null}
   */
  async listFiles(pageSize, pageToken) {
    const query = {}

    if (pageSize) {
      query.pageSize = pageSize
    }

    if (pageToken) {
      query.pageToken = pageToken
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/files`,
      query,
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File Info
   * @category Files
   * @description Retrieves metadata for a specific file uploaded to the Gemini Files API. Returns details including file name, MIME type, size, creation time, and processing state.
   * @route POST /get-file-info
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The resource name of the file (e.g., 'files/abc123def456'). Obtained from upload or list operations."}
   *
   * @returns {Object}
   * @sampleResult {"name":"files/abc123def456","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","expirationTime":"2025-01-17T10:30:00.000Z","uri":"https://generativelanguage.googleapis.com/v1beta/files/abc123def456","state":"ACTIVE"}
   */
  async getFileInfo(fileName) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ fileName }`,
      logTag: 'getFileInfo',
    })
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Deletes a file previously uploaded to the Gemini Files API. The file will no longer be available for content generation after deletion.
   * @route POST /delete-file
   *
   * @appearanceColor #EA4335 #F28B82
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The resource name of the file to delete (e.g., 'files/abc123def456'). Obtained from upload or list operations."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"fileName":"files/abc123def456"}
   */
  async deleteFile(fileName) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ fileName }`,
      method: 'delete',
      logTag: 'deleteFile',
    })

    return { success: true, fileName }
  }

  /**
   * @operationName Generate Content
   * @category Content Generation
   * @description Generates content using a Gemini model with a text prompt and optional file reference. Supports configurable temperature, max output tokens, and response format (text or JSON). Use this to analyze uploaded files, answer questions, generate text, or produce structured JSON output.
   * @route POST /generate-content
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The Gemini model to use for content generation. Select from available models via the dropdown."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text prompt or instruction for the model. Be specific about what you want the model to do."}
   * @paramDef {"type":"Array.<FileReference>","label":"Files","name":"files","description":"Optional list of files previously uploaded to Gemini to include in the request. Each file requires a URI and MIME type."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system-level instruction to guide model behavior. Sets the context and role for the model."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Controls randomness of the output. Values between 0.0 and 2.0. Lower values produce more deterministic results."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response. Limits the length of the output."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["text","json"]}},"description":"Output format. Use 'text' for natural language responses or 'json' for structured JSON output. Defaults to 'text'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The document contains an invoice from Acme Corp dated January 15, 2025, for $1,250.00.","model":"models/gemini-2.5-flash","usageMetadata":{"promptTokenCount":1250,"candidatesTokenCount":45,"totalTokenCount":1295}}
   */
  async generateContent(model, prompt, files, systemInstruction, temperature, maxOutputTokens, responseFormat) {
    const parts = []

    if (files && files.length) {
      for (const file of files) {
        parts.push({
          file_data: {
            mime_type: file.mimeType || 'application/octet-stream',
            file_uri: file.uri,
          },
        })
      }
    }

    parts.push({ text: prompt })

    const requestBody = {
      contents: [{ parts }],
    }

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      }
    }

    const generationConfig = {}

    if (temperature !== undefined && temperature !== null) {
      generationConfig.temperature = temperature
    }

    if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
      generationConfig.maxOutputTokens = maxOutputTokens
    }

    if (responseFormat === 'json') {
      generationConfig.responseMimeType = 'application/json'
    }

    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ model }:generateContent`,
      method: 'post',
      body: requestBody,
      logTag: 'generateContent',
    })

    const textContent = response.candidates?.[0]?.content?.parts
      ?.map(part => part.text)
      .filter(Boolean)
      .join('') || ''

    return {
      text: textContent,
      model,
      usageMetadata: response.usageMetadata || null,
    }
  }

}

/**
 * @typedef {Object} FileReference
 * @paramDef {"type":"String","label":"URI","name":"uri","required":true,"description":"URI of the file to include. Can be a Gemini Files API URI, Google Cloud Storage URI, or any publicly accessible URL."}
 * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","required":true,"description":"MIME type of the file (e.g., 'application/pdf', 'image/png')."}
 */

Flowrunner.ServerCode.addService(GeminiAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Gemini API key from https://aistudio.google.com/apikey',
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}
