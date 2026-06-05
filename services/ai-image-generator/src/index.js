const crypto = require('crypto')

const API_BASE_URL = 'https://api.openai.com/v1/'
const SAVE_PATH = '___AI_GENERATED_IMAGES'

const PromptLimits = {
  'gpt-image-1': 32000,
  'dall-e-2': 1000,
  'dall-e-3': 4000,
}

const SizeOptions = {
  'gpt-image-1': [
    { label: '1024x1024', value: '1024x1024' },
    { label: '1024x1536', value: '1024x1536' },
    { label: 'auto', value: 'auto' },
  ],
  'dall-e-2': [
    { label: '256x256', value: '256x256' },
    { label: '512x512', value: '512x512' },
    { label: '1024x1024', value: '1024x1024' },
  ],
  'dall-e-3': [
    { label: '1024x1024', value: '1024x1024' },
    { label: '1792x1024', value: '1792x1024' },
    { label: '1024x1792', value: '1024x1792' },
  ],
}

const QualityOptions = {
  'gpt-image-1': [
    { label: 'auto', value: 'auto' },
    { label: 'high', value: 'high' },
    { label: 'medium', value: 'medium' },
    { label: 'low', value: 'low' },
  ],
  'dall-e-2': [{ label: 'standard', value: 'standard' }],
  'dall-e-3': [
    { label: 'hd', value: 'hd' },
    { label: 'standard', value: 'standard' },
  ],
}

const logger = {
  info: (...args) => console.log('[AI Image Generator Service] info:', ...args),
  debug: (...args) => console.log('[AI Image Generator Service] debug:', ...args),
  error: (...args) => console.log('[AI Image Generator Service] error:', ...args),
  warn: (...args) => console.log('[AI Image Generator Service] warn:', ...args),
}

/**
 *  @usesFileStorage
 *  @integrationName AI Image Generator
 *  @integrationIcon /icon.png
 **/
class AIImageGenerator {
  constructor(config) {
    this.openAIAPIKey = config.openAIAPIKey
  }

  /**
   * @operationName Generate Image
   * @description Generates high-quality AI images based on text prompts using OpenAI's DALL·E or GPT-Image models. Perfect for AI agents creating visual content, marketing materials, or concept art with customizable parameters for size, quality, and model-specific settings.
   *
   * @route POST /generateImage
   * @appearanceColor #7B32CC #7B32CC
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"description":"Detailed text description of the image to generate. Be specific about style, colors, composition, and objects. Example: 'A futuristic cityscape at sunset with flying cars and neon lights'.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"AI model for image generation. GPT-Image-1 offers advanced features, DALL·E-3 provides high quality, DALL·E-2 is cost-effective.","uiComponent":{"type":"DROPDOWN","options":{"values":["gpt-image-1","dall-e-3","dall-e-2"]}}}
   * @paramDef {"type":"String","label":"Size","name":"size","required":false,"description":"Image dimensions in pixels. Available options depend on the selected model. Default varies by model.","dependsOn":["model"],"dictionary":"getSizeOptionsDictionary"}
   * @paramDef {"type":"Number","label":"Number of Images","name":"numberOfImages","required":false,"description":"Number of image variations to generate (1-10). Higher numbers use more credits but provide more options.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Quality","name":"quality","required":false,"description":"Image quality setting. Higher quality takes longer but produces better results. Options vary by model.","dependsOn":["model"],"dictionary":"getQualityOptionsDictionary"}
   * @paramDef {"type":"Object","label":"Advanced Settings","name":"modelSettings","required":false,"dependsOn":["model"],"schemaLoader":"createModelSettingsSchemaLoader","description":"Model-specific advanced configuration options for fine-tuning generation parameters."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @sampleResult {"fileURLs":["https://files.example.com/___AI_GENERATED_IMAGES/abc123-def456.png"]}
   */
  async generateImage(prompt, model, size, numberOfImages, quality, modelSettings, fileOptions) {
    const logTag = '[generateImage]'

    prompt = prompt?.trim?.()
    modelSettings = modelSettings || {}

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('The "prompt" parameter is required and must be a non-empty string.')
    }

    const limit = PromptLimits[model]

    if (!limit) {
      throw new Error('You must select a valid model to perform prompt length validation.')
    }

    if (prompt.length > limit) {
      throw new Error(`The prompt exceeds the maximum allowed length of ${ limit } characters for model "${ model }".`)
    }

    const requestBody = cleanupObject({
      prompt: prompt.trim(),
      model: model || undefined,
      size: size || undefined,
      quality: quality || undefined,
      moderation: modelSettings.moderation || null,
      background: modelSettings.background || undefined,
      output_compression: modelSettings.output_compression || undefined,
      output_format: modelSettings.output_format || undefined,
    })

    if (typeof numberOfImages === 'number' && numberOfImages > 0) {
      requestBody.n = numberOfImages
    }

    if (requestBody.model !== 'gpt-image-1') {
      requestBody.response_format = 'b64_json'
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }images/generations`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${ this.openAIAPIKey }`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    })

    logger.debug(`${ logTag } Image generation completed`)

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Unexpected API response format: missing data array.')
    }

    const savedFiles = []

    for (const item of response.data) {
      if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, 'base64')
        const { url } = await this.flowrunner.Files.uploadFile(buffer, {
          filename: `${ crypto.randomUUID() }.png`,
          generateUrl: true,
          ...(fileOptions || { scope: 'FLOW' }),
        })
        savedFiles.push(url)
      } else {
        logger.warn(`${ logTag } Skipping item with missing b64_json.`)
      }
    }

    return {
      fileURLs: savedFiles,
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)
      logger.debug(`${ logTag } - api request body: [${ JSON.stringify(body) }]`)

      return await Flowrunner.Request[method](url)
        .set(headers)
        .query(query)
        .send(body)
    } catch (error) {
      error = normalizeAPIError(error)

      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  // =======================================  DICTIONARIES =================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   */

  /**
   * @typedef {Object} getSizeOptionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"The model for which to return available image size options."}
   */

  /**
   * @typedef {Object} getSizeOptionsDictionary__payload
   * @paramDef {"type":"getSizeOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the specific image generation model."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Size Options
   * @description Returns a list of available image size options for the selected AI image generation model.
   *
   * @route POST /get-size-options
   *
   * @paramDef {"type":"getSizeOptionsDictionary__payload","label":"Payload","name":"payload","description":"Contains the model for retrieving size options."}
   *
   * @sampleResult {"items":[{"label":"1024x1024","value":"1024x1024"}]}
   * @returns {DictionaryResponse}
   */
  async getSizeOptionsDictionary({ criteria: { model } }) {
    return {
      items: SizeOptions[model] || [],
    }
  }

  /**
   * @typedef {Object} getQualityOptionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"The model for which to return available image quality options."}
   */

  /**
   * @typedef {Object} getQualityOptionsDictionary__payload
   * @paramDef {"type":"getQualityOptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the specific image generation model."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Quality Options
   * @description Returns a list of available image quality options for the selected AI image generation model.
   *
   * @route POST /get-quality-options
   *
   * @paramDef {"type":"getQualityOptionsDictionary__payload","label":"Payload","name":"payload","description":"Contains the model for retrieving quality options."}
   *
   * @sampleResult {"items":[{"label":"auto","value":"auto"}]}
   * @returns {DictionaryResponse}
   */
  async getQualityOptionsDictionary({ criteria: { model } }) {
    return {
      items: QualityOptions[model] || [],
    }
  }

  // ======================================= END OF DICTIONARIES =================================

  // ======================================= DYNAMIC PARAM SCHEME LOADERS ========================

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object", "name":"model", "required":true}
   * @returns {Object}
   * */
  async createModelSettingsSchemaLoader({ criteria: { model } }) {
    if (model === 'gpt-image-1') {
      return [
        {
          type: 'String',
          label: 'Moderation',
          name: 'moderation',
          required: false,
          description: 'Control how moderation filtering is applied.',
          uiComponent: { type: 'DROPDOWN', options: { values: ['default', 'strict', 'none'] } },
        },
        {
          type: 'String',
          label: 'Background',
          name: 'background',
          required: false,
          description: 'Specify the background (e.g., transparent) for applicable models.',
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
        },
        {
          type: 'String',
          label: 'Output Compression',
          name: 'output_compression',
          required: false,
          description: 'Compression method for the output image.',
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
        },
        {
          type: 'String',
          label: 'Output Format',
          name: 'output_format',
          required: false,
          description: 'Format of the returned image file (e.g., png, jpeg).',
          uiComponent: { type: 'SINGLE_LINE_TEXT' },
        },
      ]
    }

    return null
  }

  // ======================================= END OF DYNAMIC PARAM SCHEME LOADERS =================
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function normalizeAPIError(error) {
  if (error.message && typeof error.message === 'object') {
    if (error.message.error && typeof error.message.error === 'object') {
      error = error.message.error

      if (error.message && error.type) {
        error = new Error(`[${ error.type }] ${ error.message }`)
      }
    }
  }

  return error
}

Flowrunner.ServerCode.addService(AIImageGenerator, [
  {
    order: 0,
    displayName: 'OpenAI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    name: 'openAIAPIKey',
    hint: 'Your OpenAI API (secret) key.',
  },
])
