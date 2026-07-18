'use strict'

const AUTHENTICATE_URL = 'https://authenticate.trustpilot.com'
const TOKEN_URL = 'https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken'
const REFRESH_TOKEN_URL = 'https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/refresh'
const API_BASE_URL = 'https://api.trustpilot.com/v1'
const INVITATIONS_API_BASE_URL = 'https://invitations-api.trustpilot.com/v1'

const DEFAULT_PER_PAGE = 20

const STARS_OPTIONS = {
  '1 Star': '1',
  '2 Stars': '2',
  '3 Stars': '3',
  '4 Stars': '4',
  '5 Stars': '5',
}

const ORDER_BY_OPTIONS = {
  'Newest First': 'createdat.desc',
  'Oldest First': 'createdat.asc',
  'Highest Rating First': 'stars.desc',
  'Lowest Rating First': 'stars.asc',
}

const logger = {
  info: (...args) => console.log('[Trustpilot] info:', ...args),
  debug: (...args) => console.log('[Trustpilot] debug:', ...args),
  error: (...args) => console.log('[Trustpilot] error:', ...args),
  warn: (...args) => console.log('[Trustpilot] warn:', ...args),
}

/**
 * @typedef {Object} DictionaryItem
 * @property {String} label
 * @property {any} value
 * @property {String} note
 */

/**
 * @typedef {Object} DictionaryResponse
 * @property {Array<DictionaryItem>} items
 * @property {String} cursor
 */

/**
 * @typedef {Object} getBusinessUnitsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Company name or website domain to search for (e.g. 'example.com'). Trustpilot requires a search term, so an empty search returns no items."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of business units."}
 */

/**
 * @typedef {Object} getInvitationTemplatesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","description":"The business unit whose invitation templates populate the list."}
 */

/**
 * @typedef {Object} getInvitationTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter templates by name. Filtering is applied locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Trustpilot returns all templates in one response, so this is unused."}
 * @paramDef {"type":"getInvitationTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The business unit whose invitation templates to list."}
 */

/**
 * @requireOAuth
 * @integrationName Trustpilot
 * @integrationIcon /icon.svg
 **/
class TrustpilotService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  // Single request helper for all Trustpilot API calls.
  // auth: 'public'  -> Trustpilot public endpoints authenticated with the API key ('apikey' header = OAuth Client ID)
  // auth: 'oauth'   -> Trustpilot private endpoints authenticated with the connected user's OAuth Bearer token
  async #apiRequest({ url, method = 'get', body, query, auth = 'oauth', logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] auth=${ auth } q=[${ JSON.stringify(query) }]`)

      const headers = auth === 'public'
        ? { 'apikey': this.clientId }
        : { 'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }` }

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Several write endpoints (reply, delete reply, email invitations) return 2xx with an empty body.
      // Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Trustpilot API error: ${ message }`)
    }
  }

  // Trustpilot errors arrive either as { fault: { faultstring } } (API gateway),
  // { message, details } (API), or { error, error_description } (auth server).
  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.fault?.faultstring) {
        return body.fault.faultstring
      }

      if (body.message) {
        return body.details ? `${ body.message } (${ body.details })` : body.message
      }

      if (body.details) {
        return body.details
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }
    }

    const status = error.status || error.statusCode

    return status ? `${ error.message } (status ${ status })` : error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds a query string supporting the repeated 'stars' parameter (?stars=4&stars=5).
  #buildReviewsQueryString(params, stars) {
    const queryString = new URLSearchParams()

    Object.entries(cleanupObject(params)).forEach(([key, value]) => queryString.append(key, value))

    toArray(stars)
      .map(star => this.#resolveChoice(star, STARS_OPTIONS))
      .filter(Boolean)
      .forEach(star => queryString.append('stars', star))

    return queryString.toString()
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('state', `flowrunner_${ Date.now() }`)

    const connectionURL = `${ AUTHENTICATE_URL }/?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: parseInt(tokenResponse.expires_in, 10) || undefined,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: 'Trustpilot Business Account',
      overwrite: true,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const tokenResponse = await Flowrunner.Request.post(REFRESH_TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: tokenResponse.access_token,
        expirationInSeconds: parseInt(tokenResponse.expires_in, 10) || undefined,
        refreshToken: tokenResponse.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Business Units Dictionary
   * @description Searches Trustpilot business units (companies) by name or domain for selection in dependent parameters. Uses the public search endpoint, so a search term is required — an empty search returns no items. Returns the company display name as the label and the business unit id as the value.
   * @route POST /get-business-units-dictionary
   * @paramDef {"type":"getBusinessUnitsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Example Store","value":"46d466a0000064000500e0c3","note":"example.com"}],"cursor":"2"}
   */
  async getBusinessUnitsDictionary(payload) {
    const { search, cursor } = payload || {}

    if (!search) {
      return { items: [] }
    }

    const page = cursor ? parseInt(cursor, 10) || 1 : 1
    const perPage = 50

    const response = await this.#apiRequest({
      logTag: 'getBusinessUnitsDictionary',
      url: `${ API_BASE_URL }/business-units/search`,
      query: { query: search, page, perpage: perPage },
      auth: 'public',
    })

    const businessUnits = Array.isArray(response.businessUnits) ? response.businessUnits : []

    return {
      cursor: businessUnits.length === perPage ? String(page + 1) : undefined,
      items: businessUnits.map(unit => ({
        label: unit.displayName || unit.name?.identifying || unit.id,
        value: unit.id,
        note: unit.name?.identifying || '',
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invitation Templates Dictionary
   * @description Lists the review invitation templates of a business unit for selection in dependent parameters. Requires the connected Trustpilot business user to have access to the business unit. Returns the template name as the label and the template id as the value.
   * @route POST /get-invitation-templates-dictionary
   * @paramDef {"type":"getInvitationTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the business unit criteria whose templates to list."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Default Invitation","value":"507f191e810c19729de860ea","note":"en-US"}]}
   */
  async getInvitationTemplatesDictionary(payload) {
    const { search, criteria } = payload || {}
    const businessUnitId = criteria?.businessUnitId

    if (!businessUnitId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'getInvitationTemplatesDictionary',
      url: `${ INVITATIONS_API_BASE_URL }/private/business-units/${ encodeURIComponent(businessUnitId) }/templates`,
    })

    const templates = Array.isArray(response.templates) ? response.templates : []

    const filtered = search
      ? templates.filter(template => template?.name && template.name.toLowerCase().includes(search.toLowerCase()))
      : templates

    return {
      items: filtered.map(template => ({
        label: template.name || template.id,
        value: template.id,
        note: template.locale || (template.isDefaultTemplate ? 'default' : ''),
      })),
    }
  }

  // ========================================= BUSINESS UNITS ==========================================

  /**
   * @description Finds a Trustpilot business unit (company profile) by its website domain name, e.g. 'example.com'. Public endpoint authenticated with the API key — no account connection needed. Returns the full public profile including the business unit id, display name, country, status, star rating, TrustScore, and review count breakdown. Use this to resolve a domain to a business unit id for other actions.
   *
   * @route GET /find-business-unit
   * @operationName Find Business Unit
   * @category Business Units
   *
   * @paramDef {"type":"String","label":"Website Domain","name":"name","required":true,"description":"The website domain name of the company, e.g. 'example.com' (without 'https://' or 'www.')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"46d466a0000064000500e0c3","displayName":"Example Store","name":{"identifying":"example.com","referring":["example.com"]},"websiteUrl":"http://example.com","country":"US","status":"active","score":{"stars":4.5,"trustScore":4.6},"numberOfReviews":{"total":1450,"oneStar":32,"twoStars":18,"threeStars":60,"fourStars":340,"fiveStars":1000}}
   */
  async findBusinessUnit(name) {
    if (!name) {
      throw new Error('"Website Domain" is required')
    }

    return this.#apiRequest({
      logTag: 'findBusinessUnit',
      url: `${ API_BASE_URL }/business-units/find`,
      query: { name },
      auth: 'public',
    })
  }

  /**
   * @description Retrieves a Trustpilot business unit (company profile) by its id. Public endpoint authenticated with the API key — no account connection needed. Returns the public profile including display name, website, country, status, star rating (1-5), TrustScore, and the review count broken down by star rating.
   *
   * @route GET /get-business-unit
   * @operationName Get Business Unit
   * @category Business Units
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id. Search for a company by name or domain, or paste an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"46d466a0000064000500e0c3","displayName":"Example Store","name":{"identifying":"example.com","referring":["example.com"]},"websiteUrl":"http://example.com","country":"US","status":"active","score":{"stars":4.5,"trustScore":4.6},"numberOfReviews":{"total":1450,"oneStar":32,"twoStars":18,"threeStars":60,"fourStars":340,"fiveStars":1000}}
   */
  async getBusinessUnit(businessUnitId) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    return this.#apiRequest({
      logTag: 'getBusinessUnit',
      url: `${ API_BASE_URL }/business-units/${ encodeURIComponent(businessUnitId) }`,
      auth: 'public',
    })
  }

  /**
   * @description Retrieves the public Trustpilot web links of a business unit for a given locale: the company's review profile page URL and the evaluate (write-a-review) URLs. Public endpoint authenticated with the API key — no account connection needed. Useful for linking customers directly to a company's Trustpilot page.
   *
   * @route GET /get-business-unit-web-links
   * @operationName Get Business Unit Web Links
   * @category Business Units
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id. Search for a company by name or domain, or paste an id directly."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","defaultValue":"en-US","description":"The locale for the links, e.g. 'en-US', 'en-GB', 'da-DK'. Default: 'en-US'."}
   *
   * @returns {Object}
   * @sampleResult {"locale":"en-US","profileUrl":"https://www.trustpilot.com/review/example.com","evaluateUrl":"https://www.trustpilot.com/evaluate/example.com","evaluateEmbedUrl":"https://www.trustpilot.com/evaluate-bgl/example.com"}
   */
  async getBusinessUnitWebLinks(businessUnitId, locale) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    return this.#apiRequest({
      logTag: 'getBusinessUnitWebLinks',
      url: `${ API_BASE_URL }/business-units/${ encodeURIComponent(businessUnitId) }/web-links`,
      query: { locale: locale || 'en-US' },
      auth: 'public',
    })
  }

  /**
   * @description Searches Trustpilot business units (companies) by name or website domain, paginated. Public endpoint authenticated with the API key — no account connection needed. Matches against identifying and referring names. Returns basic company records (id, display name, identifying domain) — use Get Business Unit for ratings and review counts.
   *
   * @route GET /search-business-units
   * @operationName Search Business Units
   * @category Business Units
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search term: a company name or website domain, e.g. 'example' or 'example.com'."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to restrict results to companies from that country."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve, starting at 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of business units per page. Range: 1-100. Default: 20."}
   *
   * @returns {Object}
   * @sampleResult {"businessUnits":[{"id":"46d466a0000064000500e0c3","displayName":"Example Store","name":{"identifying":"example.com","referring":["example.com"]}}]}
   */
  async searchBusinessUnits(query, country, page, perPage) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    return this.#apiRequest({
      logTag: 'searchBusinessUnits',
      url: `${ API_BASE_URL }/business-units/search`,
      query: {
        query,
        country,
        page,
        perpage: perPage || DEFAULT_PER_PAGE,
      },
      auth: 'public',
    })
  }

  // ========================================= PUBLIC REVIEWS ==========================================

  /**
   * @description Retrieves the published public reviews of a business unit, paginated. Public endpoint authenticated with the API key — no account connection needed. Filter by star ratings (multi-select), review language, and whether the company has responded; order by creation date or rating. Returns review objects with stars, title, text, language, creation date, consumer display name, and any company reply. Public reviews do NOT include consumer emails or order references — use List Private Reviews for that.
   *
   * @route GET /list-public-reviews
   * @operationName List Public Reviews
   * @category Public Reviews
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id. Search for a company by name or domain, or paste an id directly."}
   * @paramDef {"type":"Array<String>","label":"Star Ratings","name":"stars","uiComponent":{"type":"DROPDOWN","options":{"values":["1 Star","2 Stars","3 Stars","4 Stars","5 Stars"]}},"description":"Optional star ratings to filter by. Select one or more; when omitted, reviews of all ratings are returned."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO 639-1 language code (e.g. 'en') to only return reviews written in that language."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","defaultValue":"Newest First","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First","Highest Rating First","Lowest Rating First"]}},"description":"Sort order of the reviews. Default: 'Newest First'."}
   * @paramDef {"type":"Boolean","label":"Responded","name":"responded","uiComponent":{"type":"CHECKBOX"},"description":"Optional filter on company response: true returns only reviews the company has replied to, false only reviews without a reply. Leave unset to return both."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve, starting at 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reviews per page. Range: 1-100. Default: 20."}
   *
   * @returns {Object}
   * @sampleResult {"reviews":[{"id":"507f191e810c19729de860ea","stars":5,"title":"Great service","text":"Fast delivery and friendly support.","language":"en","createdAt":"2026-01-15T10:30:00Z","consumer":{"id":"1abc2def","displayName":"John D."},"companyReply":null,"isVerified":true}]}
   */
  async listPublicReviews(businessUnitId, stars, language, orderBy, responded, page, perPage) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    const queryString = this.#buildReviewsQueryString({
      language,
      orderBy: this.#resolveChoice(orderBy, ORDER_BY_OPTIONS),
      responded,
      page,
      perPage: perPage || DEFAULT_PER_PAGE,
    }, stars)

    return this.#apiRequest({
      logTag: 'listPublicReviews',
      url: `${ API_BASE_URL }/business-units/${ encodeURIComponent(businessUnitId) }/reviews?${ queryString }`,
      auth: 'public',
    })
  }

  /**
   * @description Retrieves a single published service review by its review id. Public endpoint authenticated with the API key — no account connection needed. Returns the public review data: stars, title, text, language, creation date, consumer display name, the reviewed business unit, and any company reply. Does NOT include the consumer's email or order reference — use Get Private Review for that.
   *
   * @route GET /get-public-review
   * @operationName Get Public Review
   * @category Public Reviews
   *
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The id of the review, e.g. '507f191e810c19729de860ea'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"507f191e810c19729de860ea","stars":5,"title":"Great service","text":"Fast delivery and friendly support.","language":"en","createdAt":"2026-01-15T10:30:00Z","consumer":{"id":"1abc2def","displayName":"John D."},"businessUnit":{"id":"46d466a0000064000500e0c3","displayName":"Example Store"},"companyReply":null}
   */
  async getPublicReview(reviewId) {
    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getPublicReview',
      url: `${ API_BASE_URL }/reviews/${ encodeURIComponent(reviewId) }`,
      auth: 'public',
    })
  }

  // =========================================== CATEGORIES ============================================

  /**
   * @description Lists Trustpilot's business categories, optionally filtered by country, locale, or a parent category (to list child categories). Public endpoint authenticated with the API key — no account connection needed. Returns category records with id and localized name, usable with Get Business Units in Category.
   *
   * @route GET /list-categories
   * @operationName List Categories
   * @category Categories
   *
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to return categories relevant to that country."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional locale for localized category names, e.g. 'en-US', 'da-DK'."}
   * @paramDef {"type":"String","label":"Parent Category ID","name":"parentId","description":"Optional parent category id (e.g. 'animals_pets') to list only its child categories."}
   *
   * @returns {Object}
   * @sampleResult {"categories":[{"categoryId":"electronics_store","name":"Electronics Store","localizedName":"Electronics Store","isPredicted":false}]}
   */
  async listCategories(country, locale, parentId) {
    return this.#apiRequest({
      logTag: 'listCategories',
      url: `${ API_BASE_URL }/categories`,
      query: { country, locale, parentId },
      auth: 'public',
    })
  }

  /**
   * @description Lists the business units (companies) registered within a Trustpilot category, paginated. Public endpoint authenticated with the API key — no account connection needed. Useful for competitor discovery and market research within a business sector.
   *
   * @route GET /get-business-units-in-category
   * @operationName Get Business Units in Category
   * @category Categories
   *
   * @paramDef {"type":"String","label":"Category ID","name":"categoryId","required":true,"description":"The category id, e.g. 'electronics_store' or 'pet_store'. Use List Categories to discover ids."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional ISO 3166-1 alpha-2 country code (e.g. 'US') to restrict results to companies from that country."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional locale for localized content, e.g. 'en-US'."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve, starting at 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of business units per page. Range: 1-100. Default: 20."}
   *
   * @returns {Object}
   * @sampleResult {"businessUnits":[{"id":"46d466a0000064000500e0c3","displayName":"Example Store","name":{"identifying":"example.com"},"score":{"stars":4.5,"trustScore":4.6},"numberOfReviews":{"total":1450}}]}
   */
  async getBusinessUnitsInCategory(categoryId, country, locale, page, perPage) {
    if (!categoryId) {
      throw new Error('"Category ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getBusinessUnitsInCategory',
      url: `${ API_BASE_URL }/categories/${ encodeURIComponent(categoryId) }/business-units`,
      query: {
        country,
        locale,
        page,
        perPage: perPage || DEFAULT_PER_PAGE,
      },
      auth: 'public',
    })
  }

  // ============================================ CONSUMERS ============================================

  /**
   * @description Retrieves the public profile of a Trustpilot consumer (reviewer) by their consumer id, as found in review objects. Public endpoint authenticated with the API key — no account connection needed. Returns the consumer's display name, country, and number of reviews written. Does NOT expose private consumer data such as email addresses.
   *
   * @route GET /get-consumer-profile
   * @operationName Get Consumer Profile
   * @category Consumers
   *
   * @paramDef {"type":"String","label":"Consumer ID","name":"consumerId","required":true,"description":"The id of the consumer, e.g. taken from the 'consumer.id' field of a review."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1abc2def3ghi","displayName":"John Doe","countryCode":"US","numberOfReviews":12,"hasImage":false}
   */
  async getConsumerProfile(consumerId) {
    if (!consumerId) {
      throw new Error('"Consumer ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getConsumerProfile',
      url: `${ API_BASE_URL }/consumers/${ encodeURIComponent(consumerId) }/profile`,
      auth: 'public',
    })
  }

  // ========================================= PRIVATE REVIEWS =========================================

  /**
   * @description Retrieves the reviews of a business unit including PRIVATE data: the consumer's email address and the order/reference id from the invitation. Requires a connected Trustpilot business user with access to the business unit (OAuth). Filter by star ratings, language, company response, reported state, reference id, and creation date range; order by creation date or rating. Use this instead of List Public Reviews when you need to match reviews to customers or orders.
   *
   * @route GET /list-private-reviews
   * @operationName List Private Reviews
   * @category Private Reviews
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id. The connected business user must have access to it."}
   * @paramDef {"type":"Array<String>","label":"Star Ratings","name":"stars","uiComponent":{"type":"DROPDOWN","options":{"values":["1 Star","2 Stars","3 Stars","4 Stars","5 Stars"]}},"description":"Optional star ratings to filter by. Select one or more; when omitted, reviews of all ratings are returned."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO 639-1 language code (e.g. 'en') to only return reviews written in that language."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","defaultValue":"Newest First","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First","Highest Rating First","Lowest Rating First"]}},"description":"Sort order of the reviews. Default: 'Newest First'."}
   * @paramDef {"type":"Boolean","label":"Responded","name":"responded","uiComponent":{"type":"CHECKBOX"},"description":"Optional filter on company response: true returns only reviews the company has replied to, false only reviews without a reply. Leave unset to return both."}
   * @paramDef {"type":"Boolean","label":"Reported","name":"reported","uiComponent":{"type":"CHECKBOX"},"description":"Optional filter on reported state: true returns only reviews the company has reported, false only non-reported reviews. Leave unset to return both."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Optional order/reference id to only return reviews created from invitations with that reference."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDateTime","description":"Optional ISO 8601 date-time (e.g. '2026-01-01T00:00:00Z'); only reviews created at or after this time are returned."}
   * @paramDef {"type":"String","label":"End Date","name":"endDateTime","description":"Optional ISO 8601 date-time (e.g. '2026-06-30T23:59:59Z'); only reviews created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The page number to retrieve, starting at 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reviews per page. Range: 1-100. Default: 20."}
   *
   * @returns {Object}
   * @sampleResult {"reviews":[{"id":"507f191e810c19729de860ea","stars":4,"title":"Good experience","text":"Quick support response.","language":"en","createdAt":"2026-01-15T10:30:00Z","email":"customer@example.com","referenceId":"order-1001","consumer":{"id":"1abc2def","displayName":"John D."},"companyReply":null}]}
   */
  async listPrivateReviews(
    businessUnitId,
    stars,
    language,
    orderBy,
    responded,
    reported,
    referenceId,
    startDateTime,
    endDateTime,
    page,
    perPage
  ) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    const queryString = this.#buildReviewsQueryString({
      language,
      orderBy: this.#resolveChoice(orderBy, ORDER_BY_OPTIONS),
      responded,
      reported,
      referenceId,
      startDateTime,
      endDateTime,
      page,
      perPage: perPage || DEFAULT_PER_PAGE,
    }, stars)

    return this.#apiRequest({
      logTag: 'listPrivateReviews',
      url: `${ API_BASE_URL }/private/business-units/${ encodeURIComponent(businessUnitId) }/reviews?${ queryString }`,
    })
  }

  /**
   * @description Retrieves a single review by its id including PRIVATE data: the consumer's email address, the order/reference id, and internal state fields. Requires a connected Trustpilot business user with access to the review's business unit (OAuth).
   *
   * @route GET /get-private-review
   * @operationName Get Private Review
   * @category Private Reviews
   *
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The id of the review, e.g. '507f191e810c19729de860ea'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"507f191e810c19729de860ea","stars":4,"title":"Good experience","text":"Quick support response.","language":"en","createdAt":"2026-01-15T10:30:00Z","email":"customer@example.com","referenceId":"order-1001","consumer":{"id":"1abc2def","displayName":"John D."},"companyReply":null,"tags":[]}
   */
  async getPrivateReview(reviewId) {
    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getPrivateReview',
      url: `${ API_BASE_URL }/private/reviews/${ encodeURIComponent(reviewId) }`,
    })
  }

  /**
   * @description Posts a public company reply to a review on behalf of the connected Trustpilot business user (OAuth). The reply is shown publicly beneath the review on the company's Trustpilot profile. Posting a reply to a review that already has one replaces the existing reply.
   *
   * @route POST /reply-to-review
   * @operationName Reply to Review
   * @category Private Reviews
   *
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The id of the review to reply to."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The reply text, shown publicly under the review on Trustpilot."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async replyToReview(reviewId, message) {
    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    if (!message) {
      throw new Error('"Message" is required')
    }

    return this.#apiRequest({
      logTag: 'replyToReview',
      method: 'post',
      url: `${ API_BASE_URL }/private/reviews/${ encodeURIComponent(reviewId) }/reply`,
      body: { message },
    })
  }

  /**
   * @description Deletes the company's reply to a review on behalf of the connected Trustpilot business user (OAuth). The reply is removed from the public review on the company's Trustpilot profile.
   *
   * @route DELETE /delete-review-reply
   * @operationName Delete Review Reply
   * @category Private Reviews
   *
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The id of the review whose company reply to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteReviewReply(reviewId) {
    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteReviewReply',
      method: 'delete',
      url: `${ API_BASE_URL }/private/reviews/${ encodeURIComponent(reviewId) }/reply`,
    })
  }

  // =========================================== INVITATIONS ===========================================

  /**
   * @description Sends a service review invitation email to a customer through Trustpilot on behalf of the connected business user (OAuth). Trustpilot delivers the email using the selected invitation template and links the resulting review to your reference number (e.g. an order id). The sender email must be verified in your Trustpilot account. For product review invitations or other advanced fields, supply the raw body via Advanced Options — its top-level fields override the convenience parameters.
   *
   * @route POST /send-email-invitation
   * @operationName Send Email Invitation
   * @category Invitations
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id to send the invitation for. The connected business user must have access to it."}
   * @paramDef {"type":"String","label":"Consumer Email","name":"consumerEmail","required":true,"description":"The email address of the customer to invite."}
   * @paramDef {"type":"String","label":"Consumer Name","name":"consumerName","description":"The customer's name, used in the invitation email."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Your reference for this invitation, e.g. an order id. It is attached to the resulting review as its reference id."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"The locale of the invitation email, e.g. 'en-US'. When omitted, the template's locale is used."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","dictionary":"getInvitationTemplatesDictionary","dependsOn":["businessUnitId"],"description":"The invitation template to use. Choose the business unit above to pick from its templates, or paste a template id."}
   * @paramDef {"type":"String","label":"Redirect URI","name":"redirectUri","description":"Optional URL the customer is redirected to after submitting their review."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Optional sender name shown in the invitation email."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Optional sender email address. Must be a sender address verified in your Trustpilot account."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Optional reply-to email address for the invitation email."}
   * @paramDef {"type":"Object","label":"Advanced Options","name":"advancedOptions","description":"Optional raw invitation body fields per Trustpilot's Invitation API (e.g. 'serviceReviewInvitation' with tags and preferredSendTime, or 'productReviewInvitation'). Top-level fields override the convenience parameters."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async sendEmailInvitation(
    businessUnitId,
    consumerEmail,
    consumerName,
    referenceNumber,
    locale,
    templateId,
    redirectUri,
    senderName,
    senderEmail,
    replyTo,
    advancedOptions
  ) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    if (!consumerEmail) {
      throw new Error('"Consumer Email" is required')
    }

    const serviceReviewInvitation = cleanupObject({ templateId, redirectUri })

    const body = {
      ...cleanupObject({
        consumerEmail,
        consumerName,
        referenceNumber,
        locale,
        senderName,
        senderEmail,
        replyTo,
      }),
      ...(Object.keys(serviceReviewInvitation).length ? { serviceReviewInvitation } : {}),
      ...(advancedOptions || {}),
    }

    return this.#apiRequest({
      logTag: 'sendEmailInvitation',
      method: 'post',
      url: `${ INVITATIONS_API_BASE_URL }/private/business-units/${ encodeURIComponent(businessUnitId) }/email-invitations`,
      body,
    })
  }

  /**
   * @description Lists the review invitation templates available to a business unit, including Trustpilot's standard templates and any custom templates. Requires a connected Trustpilot business user with access to the business unit (OAuth). Template ids are used when sending email invitations.
   *
   * @route GET /list-invitation-templates
   * @operationName List Invitation Templates
   * @category Invitations
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id whose templates to list. The connected business user must have access to it."}
   *
   * @returns {Object}
   * @sampleResult {"templates":[{"id":"507f191e810c19729de860ea","name":"Default Invitation","locale":"en-US","isDefaultTemplate":true}]}
   */
  async listInvitationTemplates(businessUnitId) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    return this.#apiRequest({
      logTag: 'listInvitationTemplates',
      url: `${ INVITATIONS_API_BASE_URL }/private/business-units/${ encodeURIComponent(businessUnitId) }/templates`,
    })
  }

  /**
   * @description Generates a unique service review invitation link for a specific customer, to distribute through your own channels (SMS, chat, custom emails, etc.). Requires a connected Trustpilot business user with access to the business unit (OAuth). The review submitted through the link is connected to the customer name, email, and reference id you provide. Each link is single-use per customer and should not be reused for different customers.
   *
   * @route POST /generate-review-invitation-link
   * @operationName Generate Review Invitation Link
   * @category Invitations
   *
   * @paramDef {"type":"String","label":"Business Unit","name":"businessUnitId","required":true,"dictionary":"getBusinessUnitsDictionary","description":"The Trustpilot business unit id to generate the link for. The connected business user must have access to it."}
   * @paramDef {"type":"String","label":"Customer Email","name":"email","required":true,"description":"The email address of the customer the link is for."}
   * @paramDef {"type":"String","label":"Customer Name","name":"name","required":true,"description":"The name of the customer the link is for."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","required":true,"description":"Your reference for this invitation, e.g. an order id. It is attached to the resulting review as its reference id."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","defaultValue":"en-US","description":"The locale of the review flow the customer lands on, e.g. 'en-US'. Default: 'en-US'."}
   * @paramDef {"type":"String","label":"Redirect URI","name":"redirectUri","description":"Optional URL the customer is redirected to after submitting their review."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5","url":"https://www.trustpilot.com/evaluate-link/a1b2c3d4e5"}
   */
  async generateReviewInvitationLink(businessUnitId, email, name, referenceId, locale, redirectUri) {
    if (!businessUnitId) {
      throw new Error('"Business Unit" is required')
    }

    if (!email) {
      throw new Error('"Customer Email" is required')
    }

    if (!name) {
      throw new Error('"Customer Name" is required')
    }

    if (!referenceId) {
      throw new Error('"Reference ID" is required')
    }

    return this.#apiRequest({
      logTag: 'generateReviewInvitationLink',
      method: 'post',
      url: `${ INVITATIONS_API_BASE_URL }/private/business-units/${ encodeURIComponent(businessUnitId) }/invitation-links`,
      body: cleanupObject({
        email,
        name,
        referenceId,
        locale: locale || 'en-US',
        redirectUri,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(TrustpilotService, [
  {
    displayName: 'Client ID',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The API key (Client ID) of your Trustpilot API application. It is also sent as the "apikey" header for public endpoints. Trustpilot API access requires a business account with API access enabled — request credentials via your Trustpilot Customer Success Manager.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The API secret (Client Secret) of your Trustpilot API application.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function toArray(value) {
  if (value === undefined || value === null) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
