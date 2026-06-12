const logger = {
  info: (...args) => console.log('[Leafy Plant] info:', ...args),
  debug: (...args) => console.log('[Leafy Plant] debug:', ...args),
  error: (...args) => console.log('[Leafy Plant] error:', ...args),
  warn: (...args) => console.log('[Leafy Plant] warn:', ...args),
}

const API_BASE_URL = 'https://leafyplant.app/v1'

const DEFAULT_SEARCH_LIMIT = 10

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
 * @integrationName Leafy Plant
 * @integrationIcon /logo.png
 */
class LeafyPlantService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(body) : await request

      if (response && response.status === 'error') {
        throw new Error(`Leafy Plant API error: ${ response.message || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Leafy Plant API error:')) {
        throw error
      }

      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Leafy Plant API error: ${ message }`)
    }
  }

  /**
   * @operationName Identify Plant
   * @category Identification
   * @description Identifies a plant from a publicly accessible image URL. Returns ranked candidate species with scientific and common names, a confidence label, and a description of what was seen. Use a candidate's scientific name with Get Care Guide or Get Toxicity.
   * @route POST /identify-url
   * @appearanceColor #3CB371 #5FD392
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Public URL of the plant image (jpg/png/webp). Leafy fetches and processes it server-side."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for returned names and notes. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"candidates":[{"scientificName":"Monstera deliciosa","commonName":"Swiss Cheese Plant","genus":"Monstera","taxon":"plant","cosine":0.8275}],"genus":"Monstera","genus_fallback":[{"genus":"Monstera","cosine":0.8275}],"confidence":"probable","top_cosine":0.8275,"photos":1,"model":"gemini-2.5-flash","is_plant":true,"notes":"Large climbing Aroid with deeply lobed, fenestrated dark green leaves, typical of Monstera deliciosa."}
   */
  async identifyPlant(imageUrl, language) {
    const logTag = '[identifyPlant]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/identify/url`,
      method: 'post',
      body: clean({
        url: imageUrl,
        language: language || 'en',
      }),
    })
  }

  /**
   * @operationName Get Care Guide
   * @category Care
   * @description Returns a care guide for a plant species, including watering, light, soil, and temperature guidance. Accepts a scientific or common plant name.
   * @route GET /care
   * @appearanceColor #3CB371 #5FD392
   *
   * @paramDef {"type":"String","label":"Species","name":"species","required":true,"dictionary":"searchPlantsDictionary","description":"Scientific or common plant name. Search and select a plant, or type a name directly."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for the returned care guide. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"scientific_name":"Monstera deliciosa","common_en":"Monstera deliciosa","family":"Araceae","slug":"monstera-deliciosa","watering":{"days":7,"summary":"Moderate watering. Let the topsoil dry between waterings."},"light":{"level":"brightIndirect","summary":"Bright indirect light, no prolonged direct sun."},"soil":{"summary":"Peat-free, loam-based, humus-rich and well-drained compost, acid to neutral."},"temperature_c":{"min":18,"max":27}}
   */
  async getCareGuide(species, language) {
    const logTag = '[getCareGuide]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/care`,
      method: 'get',
      query: {
        species,
        lang: language || 'en',
      },
    })
  }

  /**
   * @operationName Search Plants
   * @category Identification
   * @description Searches the Leafy plant database by common or scientific name. Returns a list of matching plants with their family, genus, slug, and care/toxicity availability flags. Use a result's scientific name with Get Care Guide or Get Toxicity.
   * @route GET /search
   * @appearanceColor #3CB371 #5FD392
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search term (common or scientific plant name)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results (1-50). Defaults to 10."}
   *
   * @returns {Object}
   * @sampleResult {"query":"monstera","count":2,"results":[{"scientific_name":"Monstera deliciosa","common_en":"Monstera deliciosa","family":"Araceae","genus":"Monstera","slug":"monstera-deliciosa","care_available":true},{"scientific_name":"Monstera adansonii","common_en":"Swiss cheese vine","family":"Araceae","genus":"Monstera","slug":"monstera-adansonii","toxicity_level":"toxic"}]}
   */
  async searchPlants(query, limit) {
    const logTag = '[searchPlants]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'get',
      query: {
        q: query,
        limit: limit || DEFAULT_SEARCH_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Toxicity
   * @category Care
   * @description Returns plant toxicity information for humans and pets. Provide a plant species and optionally an animal to check (e.g. cat, dog, horse). Indicates whether toxicity data is available and any notes.
   * @route GET /toxicity
   * @appearanceColor #3CB371 #5FD392
   *
   * @paramDef {"type":"String","label":"Species","name":"species","required":true,"dictionary":"searchPlantsDictionary","description":"Scientific or common plant name. Search and select a plant, or type a name directly."}
   * @paramDef {"type":"String","label":"Animal","name":"animal","description":"Optional animal to check toxicity for, e.g. cat, dog, horse. Leave empty for general toxicity information."}
   *
   * @returns {Object}
   * @sampleResult {"scientific_name":"Monstera deliciosa","common_en":"Monstera deliciosa","family":"Araceae","slug":"monstera-deliciosa","toxicity_data_available":false,"note":"Toxicity data not yet sourced for this species."}
   */
  async getToxicity(species, animal) {
    const logTag = '[getToxicity]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/toxicity`,
      method: 'get',
      query: {
        species,
        animal,
      },
    })
  }

  /**
   * @typedef {Object} searchPlantsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter plants by common or scientific name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Leafy search returns results in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Search Plants Dictionary
   * @description Provides a searchable list of plants from the Leafy database for selecting a species in Get Care Guide and Get Toxicity. The option value is the scientific name expected by those operations.
   * @route POST /search-plants-dictionary
   * @paramDef {"type":"searchPlantsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter plants by common or scientific name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monstera deliciosa","value":"Monstera deliciosa","note":"Araceae - Swiss cheese plant"}],"cursor":null}
   */
  async searchPlantsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[searchPlantsDictionary]'

    if (!search) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'get',
      query: {
        q: search,
        limit: DEFAULT_SEARCH_LIMIT,
      },
    })

    const results = response.results || []

    return {
      items: results.map(plant => {
        const name = plant.scientific_name
        const noteParts = [plant.family, plant.common_en].filter(Boolean)

        return {
          label: plant.common_en ? `${ name } (${ plant.common_en })` : name,
          value: name,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(LeafyPlantService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Leafy Plant API key (sent as the x-api-key header). Get it from https://leafyplant.app/developers',
  },
])
