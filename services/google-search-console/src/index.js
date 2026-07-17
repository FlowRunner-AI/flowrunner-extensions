'use strict'

const API_BASE_URL = 'https://www.googleapis.com/webmasters/v3'
const URL_INSPECTION_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DIMENSION_MAPPING = {
  'Date': 'date',
  'Query': 'query',
  'Page': 'page',
  'Country': 'country',
  'Device': 'device',
  'Search Appearance': 'searchAppearance',
  'Hour': 'hour',
}

const SEARCH_TYPE_MAPPING = {
  'Web': 'web',
  'Image': 'image',
  'Video': 'video',
  'News': 'news',
  'Discover': 'discover',
  'Google News': 'googleNews',
}

const AGGREGATION_TYPE_MAPPING = {
  'Auto': 'auto',
  'By Page': 'byPage',
  'By Property': 'byProperty',
  'By News Showcase Panel': 'byNewsShowcasePanel',
}

const DATA_STATE_MAPPING = {
  'Final': 'final',
  'All (Includes Fresh Data)': 'all',
  'Hourly (Includes Fresh Data)': 'hourly_all',
}

const FILTER_OPERATOR_MAPPING = {
  'Contains': 'contains',
  'Equals': 'equals',
  'Not Contains': 'notContains',
  'Not Equals': 'notEquals',
  'Including Regex': 'includingRegex',
  'Excluding Regex': 'excludingRegex',
}

const logger = {
  info: (...args) => console.log('[Google Search Console] info:', ...args),
  debug: (...args) => console.log('[Google Search Console] debug:', ...args),
  error: (...args) => console.log('[Google Search Console] error:', ...args),
  warn: (...args) => console.log('[Google Search Console] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Search Console
 * @integrationIcon /icon.png
 **/
class GoogleSearchConsoleService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Search Console API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #normalizeSiteUrl(siteUrl) {
    if (siteUrl === undefined || siteUrl === null || String(siteUrl).trim() === '') {
      throw new Error('"Site URL" is required')
    }

    return String(siteUrl).trim()
  }

  #normalizeFeedpath(feedpath) {
    if (feedpath === undefined || feedpath === null || String(feedpath).trim() === '') {
      throw new Error('"Sitemap URL" is required')
    }

    return String(feedpath).trim()
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoiceList(values, mapping) {
    const list = Array.isArray(values)
      ? values
      : typeof values === 'string'
        ? values.split(',')
        : []

    return list
      .map(item => String(item).trim())
      .filter(Boolean)
      .map(item => this.#resolveChoice(item, mapping))
  }

  // Converts the Search Console keys-array rows into plain row objects keyed by dimension names.
  #convertAnalyticsRows(response, dimensionNames) {
    const rows = (response.rows || []).map(row => {
      const record = {}

      dimensionNames.forEach((name, index) => {
        record[name] = row.keys?.[index]
      })

      record.clicks = row.clicks
      record.impressions = row.impressions
      record.ctr = row.ctr
      record.position = row.position

      return record
    })

    return {
      rows,
      rowCount: rows.length,
      responseAggregationType: response.responseAggregationType,
    }
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
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Search Console Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
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
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
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
   * @typedef {Object} getSitesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter properties by site URL. Filtering is applied locally to the full list."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used — the full list is returned in a single page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sites Dictionary
   * @description Lists the Search Console properties (sites) accessible to the connected user, for selection in dependent parameters. Returns the site URL as both label and value (URL-prefix properties like "https://www.example.com/" or domain properties like "sc-domain:example.com") and the user's permission level as the note.
   * @route POST /get-sites-dictionary
   * @paramDef {"type":"getSitesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"https://www.example.com/","value":"https://www.example.com/","note":"siteOwner"},{"label":"sc-domain:example.com","value":"sc-domain:example.com","note":"siteFullUser"}]}
   */
  async getSitesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getSitesDictionary',
      url: `${ API_BASE_URL }/sites`,
    })

    const sites = response.siteEntry || []

    const filteredSites = search
      ? searchFilter(sites, ['siteUrl'], search)
      : sites

    return {
      items: filteredSites.map(site => ({
        label: site.siteUrl,
        value: site.siteUrl,
        note: site.permissionLevel,
      })),
    }
  }

  /**
   * @typedef {Object} getSitemapsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","description":"The Search Console property whose sitemaps populate the list."}
   */

  /**
   * @typedef {Object} getSitemapsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sitemaps by URL. Filtering is applied locally to the full list."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used — the full list is returned in a single page."}
   * @paramDef {"type":"getSitemapsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The property whose sitemaps to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sitemaps Dictionary
   * @description Lists the sitemaps submitted for a Search Console property, for selection in dependent parameters. Returns the sitemap URL as both label and value and the sitemap type with error/warning counts as the note.
   * @route POST /get-sitemaps-dictionary
   * @paramDef {"type":"getSitemapsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and property criteria input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"https://www.example.com/sitemap.xml","value":"https://www.example.com/sitemap.xml","note":"sitemap — 0 errors, 0 warnings"}]}
   */
  async getSitemapsDictionary(payload) {
    const { search, criteria } = payload || {}

    if (!criteria?.siteUrl) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'getSitemapsDictionary',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(this.#normalizeSiteUrl(criteria.siteUrl)) }/sitemaps`,
    })

    const sitemaps = response.sitemap || []

    const filteredSitemaps = search
      ? searchFilter(sitemaps, ['path'], search)
      : sitemaps

    return {
      items: filteredSitemaps.map(sitemap => ({
        label: sitemap.path,
        value: sitemap.path,
        note: `${ sitemap.type || 'sitemap' } — ${ sitemap.errors || 0 } errors, ${ sitemap.warnings || 0 } warnings`,
      })),
    }
  }

  // ========================================= SEARCH ANALYTICS =========================================

  /**
   * @description Queries Google Search performance data (clicks, impressions, CTR, and average position) for a Search Console property. Rows are returned as plain objects keyed by the selected dimensions (e.g. {"query":"flowrunner","clicks":42,...}), sorted by clicks descending (or by date ascending when grouped by date). Dates use YYYY-MM-DD in America/Los_Angeles (PT) time; data typically has a delay of 2-3 days unless Data State includes fresh data. Group by up to several dimensions (Date, Query, Page, Country, Device, Search Appearance, Hour — Hour requires the hourly Data State), filter by search type (Web, Image, Video, News, Discover, Google News), and narrow results with a single convenience filter (dimension + operator + expression) or the full Dimension Filter Groups JSON structure. Returns up to 25,000 rows per request (default 1,000); use Start Row to paginate. Country values are ISO 3166-1 alpha-3 codes (e.g. "usa", "deu"); device values are DESKTOP, MOBILE, or TABLET.
   *
   * @route POST /query-search-analytics
   * @operationName Query Search Analytics
   * @category Search Analytics
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property to query. Select from the list or provide the exact property URL: URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"Start of the date range (inclusive) in YYYY-MM-DD format, in America/Los_Angeles (PT) time. Must be earlier than or equal to End Date."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"End of the date range (inclusive) in YYYY-MM-DD format, in America/Los_Angeles (PT) time. Search data typically lags 2-3 days behind unless Data State includes fresh data."}
   * @paramDef {"type":"Array<String>","label":"Dimensions","name":"dimensions","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","Query","Page","Country","Device","Search Appearance","Hour"]}},"description":"Dimensions to group results by, in order. Each selected dimension becomes a field on every result row. Leave empty for a single aggregate row over the whole date range. 'Hour' is only valid with the 'Hourly (Includes Fresh Data)' Data State."}
   * @paramDef {"type":"String","label":"Search Type","name":"searchType","defaultValue":"Web","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","Image","Video","News","Discover","Google News"]}},"description":"The type of search results to report on. Default: Web. 'Discover' and 'Google News' data is only available for properties that appear in those surfaces, and they do not support the Query dimension."}
   * @paramDef {"type":"String","label":"Filter Dimension","name":"filterDimension","uiComponent":{"type":"DROPDOWN","options":{"values":["Query","Page","Country","Device","Search Appearance"]}},"description":"Convenience single-filter: the dimension to filter rows by. Use together with Filter Operator and Filter Expression. For multiple filters, use Dimension Filter Groups instead."}
   * @paramDef {"type":"String","label":"Filter Operator","name":"filterOperator","defaultValue":"Equals","uiComponent":{"type":"DROPDOWN","options":{"values":["Contains","Equals","Not Contains","Not Equals","Including Regex","Excluding Regex"]}},"description":"Convenience single-filter: how to match Filter Expression against the filter dimension. Regex operators use RE2 syntax. Default: Equals."}
   * @paramDef {"type":"String","label":"Filter Expression","name":"filterExpression","description":"Convenience single-filter: the value or RE2 regex to match, e.g. a query string, a page URL, an ISO 3166-1 alpha-3 country code ('usa'), or a device type ('MOBILE'). Ignored unless Filter Dimension is set."}
   * @paramDef {"type":"Object","label":"Dimension Filter Groups","name":"dimensionFilterGroups","description":"Advanced filtering: the raw 'dimensionFilterGroups' structure passed to the API as-is — an array of groups (or a single group object), each {\"groupType\":\"and\",\"filters\":[{\"dimension\":\"query\",\"operator\":\"contains\",\"expression\":\"flowrunner\"}]}. Valid dimensions: query, page, country, device, searchAppearance; valid operators: contains, equals, notContains, notEquals, includingRegex, excludingRegex. When provided, the convenience Filter Dimension/Operator/Expression parameters are ignored."}
   * @paramDef {"type":"String","label":"Aggregation Type","name":"aggregationType","defaultValue":"Auto","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","By Page","By Property","By News Showcase Panel"]}},"description":"How metrics are aggregated. 'Auto' lets the API decide; 'By Page' counts per page; 'By Property' counts per property ('By Property' cannot be combined with a page filter or the Page dimension). Default: Auto."}
   * @paramDef {"type":"Number","label":"Row Limit","name":"rowLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return, 1-25,000. Default: 1,000 (API default)."}
   * @paramDef {"type":"Number","label":"Start Row","name":"startRow","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first row to return, for paginating beyond Row Limit rows. Default: 0. An empty 'rows' result means you have paginated past the end."}
   * @paramDef {"type":"String","label":"Data State","name":"dataState","defaultValue":"Final","uiComponent":{"type":"DROPDOWN","options":{"values":["Final","All (Includes Fresh Data)","Hourly (Includes Fresh Data)"]}},"description":"Which data to include. 'Final' returns only finalized data (2-3 day delay); 'All (Includes Fresh Data)' also includes fresh, still-changing data; 'Hourly (Includes Fresh Data)' is required when grouping by the Hour dimension. Default: Final."}
   *
   * @returns {Object}
   * @sampleResult {"rows":[{"query":"flowrunner automation","clicks":42,"impressions":1024,"ctr":0.041,"position":3.2},{"query":"workflow builder","clicks":17,"impressions":860,"ctr":0.0198,"position":6.8}],"rowCount":2,"responseAggregationType":"byProperty"}
   */
  async querySearchAnalytics(siteUrl, startDate, endDate, dimensions, searchType, filterDimension, filterOperator, filterExpression, dimensionFilterGroups, aggregationType, rowLimit, startRow, dataState) {
    const site = this.#normalizeSiteUrl(siteUrl)

    if (!startDate || !endDate) {
      throw new Error('"Start Date" and "End Date" are required (YYYY-MM-DD)')
    }

    const dimensionNames = this.#resolveChoiceList(dimensions, DIMENSION_MAPPING)

    let filterGroups = normalizeToArray(dimensionFilterGroups)

    if (!filterGroups?.length && filterDimension && filterExpression !== undefined && filterExpression !== null && filterExpression !== '') {
      filterGroups = [{
        filters: [{
          dimension: this.#resolveChoice(filterDimension, DIMENSION_MAPPING),
          operator: this.#resolveChoice(filterOperator, FILTER_OPERATOR_MAPPING) || 'equals',
          expression: filterExpression,
        }],
      }]
    }

    const body = cleanupObject({
      startDate,
      endDate,
      dimensions: dimensionNames.length ? dimensionNames : undefined,
      type: this.#resolveChoice(searchType, SEARCH_TYPE_MAPPING),
      dimensionFilterGroups: filterGroups?.length ? filterGroups : undefined,
      aggregationType: this.#resolveChoice(aggregationType, AGGREGATION_TYPE_MAPPING),
      rowLimit: rowLimit || undefined,
      startRow: startRow || undefined,
      dataState: this.#resolveChoice(dataState, DATA_STATE_MAPPING),
    })

    const response = await this.#apiRequest({
      logTag: 'querySearchAnalytics',
      method: 'post',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(site) }/searchAnalytics/query`,
      body,
    })

    return this.#convertAnalyticsRows(response, dimensionNames)
  }

  // ============================================== SITES ===============================================

  /**
   * @description Lists all Search Console properties (sites) accessible to the connected user, both verified and unverified. Each entry includes the site URL (URL-prefix properties like "https://www.example.com/" or domain properties like "sc-domain:example.com") and the user's permission level: siteOwner, siteFullUser, siteRestrictedUser, or siteUnverifiedUser.
   *
   * @route GET /list-sites
   * @operationName List Sites
   * @category Sites
   *
   * @returns {Object}
   * @sampleResult {"siteEntry":[{"siteUrl":"https://www.example.com/","permissionLevel":"siteOwner"},{"siteUrl":"sc-domain:example.com","permissionLevel":"siteFullUser"}]}
   */
  async listSites() {
    return this.#apiRequest({
      logTag: 'listSites',
      url: `${ API_BASE_URL }/sites`,
    })
  }

  /**
   * @description Retrieves a single Search Console property from the connected user's account, returning its site URL and the user's permission level (siteOwner, siteFullUser, siteRestrictedUser, or siteUnverifiedUser). Fails if the property is not in the user's Search Console account.
   *
   * @route GET /get-site
   * @operationName Get Site
   * @category Sites
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property to retrieve. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   *
   * @returns {Object}
   * @sampleResult {"siteUrl":"https://www.example.com/","permissionLevel":"siteOwner"}
   */
  async getSite(siteUrl) {
    return this.#apiRequest({
      logTag: 'getSite',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(this.#normalizeSiteUrl(siteUrl)) }`,
    })
  }

  /**
   * @description Adds a property (site) to the connected user's Search Console account. The property still has to be verified through Search Console before most data becomes available — adding it here does not verify ownership. Returns a confirmation object.
   *
   * @route PUT /add-site
   * @operationName Add Site
   * @category Sites
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"description":"The property to add. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"siteUrl":"https://www.example.com/"}
   */
  async addSite(siteUrl) {
    const site = this.#normalizeSiteUrl(siteUrl)

    await this.#apiRequest({
      logTag: 'addSite',
      method: 'put',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(site) }`,
    })

    return { success: true, siteUrl: site }
  }

  /**
   * @description Removes a property (site) from the connected user's Search Console account. This only unlinks the property from the user's account — it does not delete any Search Console data or affect the website itself. Returns a confirmation object.
   *
   * @route DELETE /delete-site
   * @operationName Delete Site
   * @category Sites
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The property to remove from the user's Search Console account. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"siteUrl":"https://www.example.com/"}
   */
  async deleteSite(siteUrl) {
    const site = this.#normalizeSiteUrl(siteUrl)

    await this.#apiRequest({
      logTag: 'deleteSite',
      method: 'delete',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(site) }`,
    })

    return { success: true, siteUrl: site }
  }

  // ============================================= SITEMAPS =============================================

  /**
   * @description Lists the sitemaps submitted for a Search Console property, or the sitemaps referenced by a specific sitemap index file. Each entry includes the sitemap URL, type (sitemap, rssFeed, atomFeed, patternSitemap, urlList, notSitemap), submission and last-download timestamps, pending status, error and warning counts, and per-content-type submitted/indexed URL counts.
   *
   * @route GET /list-sitemaps
   * @operationName List Sitemaps
   * @category Sitemaps
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property whose sitemaps to list. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Sitemap Index URL","name":"sitemapIndex","description":"Optional URL of a sitemap index file (e.g. 'https://www.example.com/sitemap_index.xml'). When provided, lists the sitemaps contained in that index instead of the property's directly submitted sitemaps."}
   *
   * @returns {Object}
   * @sampleResult {"sitemap":[{"path":"https://www.example.com/sitemap.xml","lastSubmitted":"2026-07-01T10:15:00.000Z","isPending":false,"isSitemapsIndex":false,"type":"sitemap","lastDownloaded":"2026-07-16T04:20:00.000Z","warnings":"0","errors":"0","contents":[{"type":"web","submitted":"120","indexed":"110"}]}]}
   */
  async listSitemaps(siteUrl, sitemapIndex) {
    return this.#apiRequest({
      logTag: 'listSitemaps',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(this.#normalizeSiteUrl(siteUrl)) }/sitemaps`,
      query: {
        sitemapIndex: sitemapIndex || undefined,
      },
    })
  }

  /**
   * @description Retrieves details about a specific sitemap submitted for a Search Console property: its type, submission and last-download timestamps, pending status, error and warning counts, and per-content-type submitted/indexed URL counts. Useful for checking whether Google has processed a sitemap and how many of its URLs were indexed.
   *
   * @route GET /get-sitemap
   * @operationName Get Sitemap
   * @category Sitemaps
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property the sitemap belongs to. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Sitemap URL","name":"feedpath","required":true,"dictionary":"getSitemapsDictionary","dependsOn":["siteUrl"],"description":"The full URL of the sitemap to retrieve, e.g. 'https://www.example.com/sitemap.xml'. Select from the list or provide the URL directly."}
   *
   * @returns {Object}
   * @sampleResult {"path":"https://www.example.com/sitemap.xml","lastSubmitted":"2026-07-01T10:15:00.000Z","isPending":false,"isSitemapsIndex":false,"type":"sitemap","lastDownloaded":"2026-07-16T04:20:00.000Z","warnings":"0","errors":"0","contents":[{"type":"web","submitted":"120","indexed":"110"}]}
   */
  async getSitemap(siteUrl, feedpath) {
    return this.#apiRequest({
      logTag: 'getSitemap',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(this.#normalizeSiteUrl(siteUrl)) }/sitemaps/${ encodeURIComponent(this.#normalizeFeedpath(feedpath)) }`,
    })
  }

  /**
   * @description Submits a sitemap for a Search Console property, asking Google to crawl and process it. The sitemap file must already be published on the website at the given URL. Re-submitting an existing sitemap requests reprocessing. Returns a confirmation object; use Get Sitemap afterwards to check processing status, errors, and indexed URL counts.
   *
   * @route PUT /submit-sitemap
   * @operationName Submit Sitemap
   * @category Sitemaps
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property to submit the sitemap for. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Sitemap URL","name":"feedpath","required":true,"description":"The full, publicly reachable URL of the sitemap to submit, e.g. 'https://www.example.com/sitemap.xml'."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"siteUrl":"https://www.example.com/","feedpath":"https://www.example.com/sitemap.xml"}
   */
  async submitSitemap(siteUrl, feedpath) {
    const site = this.#normalizeSiteUrl(siteUrl)
    const path = this.#normalizeFeedpath(feedpath)

    await this.#apiRequest({
      logTag: 'submitSitemap',
      method: 'put',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(site) }/sitemaps/${ encodeURIComponent(path) }`,
    })

    return { success: true, siteUrl: site, feedpath: path }
  }

  /**
   * @description Deletes a sitemap from a Search Console property. This removes the sitemap submission from Search Console — it does not delete the sitemap file from the website, and Google may still crawl URLs it already knows about. Returns a confirmation object.
   *
   * @route DELETE /delete-sitemap
   * @operationName Delete Sitemap
   * @category Sitemaps
   *
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property the sitemap belongs to. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Sitemap URL","name":"feedpath","required":true,"dictionary":"getSitemapsDictionary","dependsOn":["siteUrl"],"description":"The full URL of the sitemap to delete, e.g. 'https://www.example.com/sitemap.xml'. Select from the list or provide the URL directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"siteUrl":"https://www.example.com/","feedpath":"https://www.example.com/sitemap.xml"}
   */
  async deleteSitemap(siteUrl, feedpath) {
    const site = this.#normalizeSiteUrl(siteUrl)
    const path = this.#normalizeFeedpath(feedpath)

    await this.#apiRequest({
      logTag: 'deleteSitemap',
      method: 'delete',
      url: `${ API_BASE_URL }/sites/${ encodeURIComponent(site) }/sitemaps/${ encodeURIComponent(path) }`,
    })

    return { success: true, siteUrl: site, feedpath: path }
  }

  // ========================================== URL INSPECTION ==========================================

  /**
   * @description Inspects a URL through the Search Console URL Inspection API and returns Google's index status for it: whether the page is indexed (verdict PASS/FAIL/NEUTRAL), coverage state, last crawl time, crawling user agent, robots.txt and indexing allowance, the Google-selected vs. user-declared canonical URL, plus mobile usability, rich results, and AMP results when available. Also returns a link to the full report in Search Console. The URL must belong to the specified property, and the connected user needs at least full access to that property. Rate-limited by Google to about 2,000 inspections per property per day.
   *
   * @route POST /inspect-url
   * @operationName Inspect URL
   * @category URL Inspection
   *
   * @paramDef {"type":"String","label":"URL to Inspect","name":"inspectionUrl","required":true,"description":"The fully-qualified URL to inspect, e.g. 'https://www.example.com/pricing'. Must belong to the property specified in Site URL."}
   * @paramDef {"type":"String","label":"Site URL","name":"siteUrl","required":true,"dictionary":"getSitesDictionary","description":"The Search Console property that contains the inspected URL. URL-prefix properties include the protocol and a trailing slash (e.g. 'https://www.example.com/'); domain properties use the 'sc-domain:' prefix (e.g. 'sc-domain:example.com')."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","description":"Optional IETF BCP-47 language code for translated issue messages in the response, e.g. 'en-US', 'de', 'fr'. Default: 'en-US'."}
   *
   * @returns {Object}
   * @sampleResult {"inspectionResult":{"inspectionResultLink":"https://search.google.com/search-console/inspect?resource_id=https://www.example.com/&id=ABC123","indexStatusResult":{"verdict":"PASS","coverageState":"Submitted and indexed","robotsTxtState":"ALLOWED","indexingState":"INDEXING_ALLOWED","lastCrawlTime":"2026-07-14T06:12:00.000Z","pageFetchState":"SUCCESSFUL","googleCanonical":"https://www.example.com/pricing","userCanonical":"https://www.example.com/pricing","crawledAs":"MOBILE"},"mobileUsabilityResult":{"verdict":"PASS","issues":[]},"richResultsResult":{"verdict":"PASS","detectedItems":[{"richResultType":"Product snippets","items":[{"name":"Pro Plan"}]}]}}}
   */
  async inspectUrl(inspectionUrl, siteUrl, languageCode) {
    if (!inspectionUrl || !String(inspectionUrl).trim()) {
      throw new Error('"URL to Inspect" is required')
    }

    return this.#apiRequest({
      logTag: 'inspectUrl',
      method: 'post',
      url: URL_INSPECTION_URL,
      body: cleanupObject({
        inspectionUrl: String(inspectionUrl).trim(),
        siteUrl: this.#normalizeSiteUrl(siteUrl),
        languageCode: languageCode || undefined,
      }),
    })
  }
}

Flowrunner.ServerCode.addService(GoogleSearchConsoleService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function normalizeToArray(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}
