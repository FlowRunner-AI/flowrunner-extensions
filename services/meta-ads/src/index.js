const crypto = require('crypto')

const API_VERSION = 'v25.0'
const API_BASE_WWW_URL = `https://www.facebook.com/${ API_VERSION }`
const API_BASE_GRAPH_URL = `https://graph.facebook.com/${ API_VERSION }`
const OAUTH_BASE_URL = `${ API_BASE_WWW_URL }/dialog/oauth`

const DEFAULT_LIMIT = 25

const DEFAULT_SCOPE_LIST = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Meta Ads] info:', ...args),
  debug: (...args) => console.log('[Meta Ads] debug:', ...args),
  error: (...args) => console.log('[Meta Ads] error:', ...args),
  warn: (...args) => console.log('[Meta Ads] warn:', ...args),
}

// Remove undefined/null/'' entries so they are not sent to the Graph API.
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
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Meta Ads
 * @integrationIcon /icon.svg
 */
class MetaAdsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  // Ad Account ids must be prefixed with "act_". Accept either form from the user
  // and normalize so "123456789" and "act_123456789" both work.
  #normalizeAccountId(accountId) {
    const id = String(accountId || '').trim()

    return id.startsWith('act_') ? id : `act_${ id }`
  }

  // Maps a friendly dropdown label to its Graph API value. Unmapped values pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Maps an array of friendly dropdown labels to their Graph API values.
  #resolveChoices(values, mapping) {
    if (!Array.isArray(values)) {
      return undefined
    }

    return values
      .map(value => this.#resolveChoice(value, mapping))
      .filter(value => value !== undefined)
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const cleanedQuery = clean(query)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const metaError = error.body?.error
      const message = metaError?.message || error.message

      logger.error(`${ logTag } - failed: ${ message } (trace: ${ metaError?.fbtrace_id || 'n/a' })`)

      const parts = [`Meta Ads API error: ${ message }`]

      if (metaError?.type) {
        parts.push(`type=${ metaError.type }`)
      }

      if (metaError?.code !== undefined) {
        parts.push(`code=${ metaError.code }`)
      }

      if (metaError?.error_subcode !== undefined) {
        parts.push(`error_subcode=${ metaError.error_subcode }`)
      }

      if (metaError?.fbtrace_id) {
        parts.push(`fbtrace_id=${ metaError.fbtrace_id }`)
      }

      throw new Error(parts.join(' | '))
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const connectionURL = `${ OAUTH_BASE_URL }/?${ params.toString() }`

    logger.debug(`OAuth2 connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug(`executeCallback: ${ JSON.stringify({ redirectURI: callbackObject?.redirectURI }) }`)

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .query(Object.fromEntries(params))
        .send()

      const shortLivedToken = response.access_token

      // Exchange the short-lived token for a long-lived one (~60 days) via fb_exchange_token.
      const exchange = await Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .query({
          grant_type: 'fb_exchange_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: shortLivedToken,
        })
        .send()

      const accessToken = exchange.access_token || shortLivedToken
      const expiresIn = exchange.expires_in || response.expires_in

      const profile = await Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/me?fields=id,name`)
        .set({ Authorization: `Bearer ${ accessToken }` })
        .send()

      return {
        token: accessToken,
        refreshToken: accessToken,
        overwrite: true,
        expirationInSeconds: expiresIn,
        connectionIdentityName: profile.name || 'Meta User',
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error.message || error }`)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {Object}
   */
  async refreshToken(refreshToken) {
    // Meta issues long-lived user tokens rather than OAuth refresh tokens. The stored
    // long-lived token is re-exchanged via fb_exchange_token to extend its lifetime.
    try {
      const exchange = await Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .query({
          grant_type: 'fb_exchange_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          fb_exchange_token: refreshToken,
        })
        .send()

      return {
        token: exchange.access_token,
        expirationInSeconds: exchange.expires_in,
        refreshToken: exchange.access_token,
      }
    } catch (error) {
      logger.error(`Error refreshing token: ${ error.message || error }`)

      throw error
    }
  }

  /**
   * @operationName List Ad Accounts
   * @category Ad Accounts
   * @description Lists all ad accounts the authenticated user can access via GET /me/adaccounts. Returns id, account_id, name, account_status, currency, timezone_name, amount_spent, and balance for each account. Note that amount_spent and balance are in the account's minor currency units (e.g. cents for USD). Supports pagination via Limit and After Cursor.
   * @route GET /list-ad-accounts
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of ad accounts to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"act_123456789","account_id":"123456789","name":"My Ad Account","account_status":1,"currency":"USD","timezone_name":"America/Los_Angeles","amount_spent":"152340","balance":"0"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listAdAccounts(limit, after) {
    return await this.#apiRequest({
      logTag: '[listAdAccounts]',
      url: `${ API_BASE_GRAPH_URL }/me/adaccounts`,
      method: 'get',
      query: {
        fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Ad Account
   * @category Ad Accounts
   * @description Retrieves a single ad account by id via GET /act_{accountId}. The Ad Account ID may be supplied with or without the "act_" prefix; it is normalized automatically. Returns id, account_id, name, account_status, currency, timezone_name, amount_spent, balance, spend_cap, and business. Monetary fields (amount_spent, balance, spend_cap) are in the account's minor currency units (cents for USD).
   * @route GET /get-ad-account
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix (e.g. act_123456789 or 123456789)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields to return. Defaults to id,account_id,name,account_status,currency,timezone_name,amount_spent,balance,spend_cap,business."}
   * @returns {Object}
   * @sampleResult {"id":"act_123456789","account_id":"123456789","name":"My Ad Account","account_status":1,"currency":"USD","timezone_name":"America/Los_Angeles","amount_spent":"152340","balance":"0","spend_cap":"0"}
   */
  async getAdAccount(accountId, fields) {
    return await this.#apiRequest({
      logTag: '[getAdAccount]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }`,
      method: 'get',
      query: {
        fields: fields || 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance,spend_cap,business',
      },
    })
  }

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists campaigns within an ad account via GET /act_{accountId}/campaigns. Returns id, name, objective, status, effective_status, daily_budget, lifetime_budget, created_time, start_time, and stop_time. Budgets are in the account's minor currency units (cents for USD). Optionally filter by one or more effective statuses (e.g. ACTIVE, PAUSED). Supports pagination via Limit and After Cursor.
   * @route GET /list-campaigns
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix."}
   * @paramDef {"type":"Array<String>","label":"Effective Status","name":"effectiveStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Deleted","Pending Review","Disapproved","Preapproved","Pending Billing Info","Campaign Paused","Archived","In Process","With Issues"]}},"description":"Optional filter on one or more effective statuses. Only campaigns currently in a selected status are returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaigns to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"120210000000000000","name":"Summer Sale","objective":"OUTCOME_TRAFFIC","status":"ACTIVE","effective_status":"ACTIVE","daily_budget":"5000","created_time":"2026-06-01T10:00:00-0700","start_time":"2026-06-01T10:00:00-0700"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listCampaigns(accountId, effectiveStatus, limit, after) {
    const statuses = this.#resolveChoices(effectiveStatus, {
      'Active': 'ACTIVE',
      'Paused': 'PAUSED',
      'Deleted': 'DELETED',
      'Pending Review': 'PENDING_REVIEW',
      'Disapproved': 'DISAPPROVED',
      'Preapproved': 'PREAPPROVED',
      'Pending Billing Info': 'PENDING_BILLING_INFO',
      'Campaign Paused': 'CAMPAIGN_PAUSED',
      'Archived': 'ARCHIVED',
      'In Process': 'IN_PROCESS',
      'With Issues': 'WITH_ISSUES',
    })

    return await this.#apiRequest({
      logTag: '[listCampaigns]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/campaigns`,
      method: 'get',
      query: {
        fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,start_time,stop_time',
        effective_status: statuses && statuses.length ? JSON.stringify(statuses) : undefined,
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single campaign by id via GET /{campaignId}. Returns id, name, objective, status, effective_status, daily_budget, lifetime_budget, buying_type, special_ad_categories, created_time, start_time, and stop_time. Budgets are in the account's minor currency units (cents for USD).
   * @route GET /get-campaign
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["accountId"],"description":"The campaign id to retrieve."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Campaign picker. Not sent to the API."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields to return. Defaults to a standard campaign field set."}
   * @returns {Object}
   * @sampleResult {"id":"120210000000000000","name":"Summer Sale","objective":"OUTCOME_TRAFFIC","status":"ACTIVE","effective_status":"ACTIVE","daily_budget":"5000","buying_type":"AUCTION","special_ad_categories":[],"created_time":"2026-06-01T10:00:00-0700"}
   */
  async getCampaign(campaignId, accountId, fields) {
    return await this.#apiRequest({
      logTag: '[getCampaign]',
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }`,
      method: 'get',
      query: {
        fields: fields || 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,created_time,start_time,stop_time',
      },
    })
  }

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Creates a new campaign in an ad account via POST /act_{accountId}/campaigns. Choose an Objective (Outcome-based) and an initial Status (defaults to Paused so nothing spends until you activate it). Special Ad Categories is required by Meta — select None when the campaign does not fall under a regulated category. Daily Budget and Lifetime Budget are optional here (you may instead set budgets at the ad set level) and are expressed in the account's minor currency units (cents for USD). Returns the new campaign id.
   * @route POST /create-campaign
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to create the campaign under, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the campaign."}
   * @paramDef {"type":"String","label":"Objective","name":"objective","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Traffic","Sales","Leads","Awareness","Engagement","App Promotion"]}},"description":"The advertising outcome the campaign should drive."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paused","Active"]}},"defaultValue":"Paused","description":"Initial delivery status. Paused (default) is recommended so the campaign does not spend until reviewed."}
   * @paramDef {"type":"Array<String>","label":"Special Ad Categories","name":"specialAdCategories","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["None","Housing","Employment","Credit","Financial Products And Services","Issues Elections Politics"]}},"description":"Regulated ad categories that apply to this campaign. Choose None if none apply; an empty set is sent to Meta in that case."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional daily budget in the account's minor currency units (cents for USD, e.g. 5000 = $50.00). Set this OR Lifetime Budget when using campaign budget optimization."}
   * @paramDef {"type":"Number","label":"Lifetime Budget","name":"lifetimeBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional total budget for the campaign's lifetime, in the account's minor currency units (cents for USD). Requires a stop_time on the ad sets when used."}
   * @paramDef {"type":"String","label":"Buying Type","name":"buyingType","uiComponent":{"type":"DROPDOWN","options":{"values":["Auction","Reserved"]}},"defaultValue":"Auction","description":"How inventory is purchased. Auction (default) suits most campaigns; Reserved is for reach-and-frequency buys."}
   * @returns {Object}
   * @sampleResult {"id":"120210000000000000"}
   */
  async createCampaign(accountId, name, objective, status, specialAdCategories, dailyBudget, lifetimeBudget, buyingType) {
    const categories = this.#resolveChoices(specialAdCategories, {
      'None': undefined,
      'Housing': 'HOUSING',
      'Employment': 'EMPLOYMENT',
      'Credit': 'CREDIT',
      'Financial Products And Services': 'FINANCIAL_PRODUCTS_SERVICES',
      'Issues Elections Politics': 'ISSUES_ELECTIONS_POLITICS',
    }) || []

    return await this.#apiRequest({
      logTag: '[createCampaign]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/campaigns`,
      method: 'post',
      body: clean({
        name,
        objective: this.#resolveChoice(objective, {
          'Traffic': 'OUTCOME_TRAFFIC',
          'Sales': 'OUTCOME_SALES',
          'Leads': 'OUTCOME_LEADS',
          'Awareness': 'OUTCOME_AWARENESS',
          'Engagement': 'OUTCOME_ENGAGEMENT',
          'App Promotion': 'OUTCOME_APP_PROMOTION',
        }),
        status: this.#resolveChoice(status, { 'Paused': 'PAUSED', 'Active': 'ACTIVE' }) || 'PAUSED',
        special_ad_categories: categories,
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
        buying_type: this.#resolveChoice(buyingType, { 'Auction': 'AUCTION', 'Reserved': 'RESERVED' }) || 'AUCTION',
      }),
    })
  }

  /**
   * @operationName Update Campaign
   * @category Campaigns
   * @description Updates an existing campaign via POST /{campaignId}. Any field left empty is unchanged. Use this to rename a campaign, pause or activate it, or adjust its budget. Budgets are in the account's minor currency units (cents for USD). Returns {"success":true} on success.
   * @route POST /update-campaign
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["accountId"],"description":"The campaign id to update."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Campaign picker. Not sent to the API."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the campaign."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Archived"]}},"description":"New delivery status for the campaign."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New daily budget in the account's minor currency units (cents for USD, e.g. 5000 = $50.00)."}
   * @paramDef {"type":"Number","label":"Lifetime Budget","name":"lifetimeBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New lifetime budget in the account's minor currency units (cents for USD)."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateCampaign(campaignId, accountId, name, status, dailyBudget, lifetimeBudget) {
    return await this.#apiRequest({
      logTag: '[updateCampaign]',
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }`,
      method: 'post',
      body: clean({
        name,
        status: this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Paused': 'PAUSED', 'Archived': 'ARCHIVED' }),
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
      }),
    })
  }

  /**
   * @operationName Delete Campaign
   * @category Campaigns
   * @description Permanently deletes a campaign via DELETE /{campaignId}. All ad sets and ads under the campaign are also deleted. This cannot be undone. Returns {"success":true} on success.
   * @route DELETE /delete-campaign
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["accountId"],"description":"The campaign id to delete."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Campaign picker. Not sent to the API."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCampaign(campaignId, accountId) {
    return await this.#apiRequest({
      logTag: '[deleteCampaign]',
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Ad Sets
   * @category Ad Sets
   * @description Lists ad sets via GET /act_{accountId}/adsets, or scoped to a single campaign via GET /{campaignId}/adsets when a Campaign ID is provided. Returns id, name, campaign_id, status, effective_status, daily_budget, optimization_goal, billing_event, targeting, start_time, and end_time. Budgets are in the account's minor currency units (cents for USD). Supports pagination via Limit and After Cursor.
   * @route GET /list-ad-sets
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix. Used when no Campaign ID is given."}
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","dictionary":"getCampaignsDictionary","dependsOn":["accountId"],"description":"Optional campaign id. When set, only ad sets belonging to that campaign are returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of ad sets to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"120211000000000000","name":"US Adults 18-65","campaign_id":"120210000000000000","status":"ACTIVE","effective_status":"ACTIVE","daily_budget":"3000","optimization_goal":"LINK_CLICKS","billing_event":"IMPRESSIONS"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listAdSets(accountId, campaignId, limit, after) {
    const url = campaignId
      ? `${ API_BASE_GRAPH_URL }/${ campaignId }/adsets`
      : `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adsets`

    return await this.#apiRequest({
      logTag: '[listAdSets]',
      url,
      method: 'get',
      query: {
        fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,start_time,end_time',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Ad Set
   * @category Ad Sets
   * @description Retrieves a single ad set by id via GET /{adSetId}. Returns id, name, campaign_id, status, effective_status, daily_budget, lifetime_budget, optimization_goal, billing_event, bid_strategy, bid_amount, targeting, promoted_object, start_time, and end_time. Budgets and bid amounts are in the account's minor currency units (cents for USD).
   * @route GET /get-ad-set
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"dictionary":"getAdSetsDictionary","dependsOn":["accountId"],"description":"The ad set id to retrieve."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Ad Set picker. Not sent to the API."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields to return. Defaults to a standard ad set field set."}
   * @returns {Object}
   * @sampleResult {"id":"120211000000000000","name":"US Adults 18-65","campaign_id":"120210000000000000","status":"ACTIVE","effective_status":"ACTIVE","daily_budget":"3000","optimization_goal":"LINK_CLICKS","billing_event":"IMPRESSIONS","targeting":{"geo_locations":{"countries":["US"]},"age_min":18,"age_max":65}}
   */
  async getAdSet(adSetId, accountId, fields) {
    return await this.#apiRequest({
      logTag: '[getAdSet]',
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }`,
      method: 'get',
      query: {
        fields: fields || 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,targeting,promoted_object,start_time,end_time',
      },
    })
  }

  /**
   * @operationName Create Ad Set
   * @category Ad Sets
   * @description Creates a new ad set under a campaign via POST /act_{accountId}/adsets. Set exactly one of Daily Budget or Lifetime Budget (in the account's minor currency units — cents for USD), unless the parent campaign uses campaign budget optimization. Provide a Targeting object describing the audience (see the hint for an example). Bid Amount is required when Bid Strategy is Cost Cap or Bid Cap and is also in minor currency units. Use Promoted Object for conversion/lead optimization goals. Status defaults to Paused. Returns the new ad set id.
   * @route POST /create-ad-set
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to create the ad set under, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the ad set."}
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["accountId"],"description":"The parent campaign this ad set belongs to."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Daily budget in the account's minor currency units (cents for USD, e.g. 3000 = $30.00). Provide this OR Lifetime Budget."}
   * @paramDef {"type":"Number","label":"Lifetime Budget","name":"lifetimeBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total budget across the ad set's schedule, in the account's minor currency units (cents for USD). Requires an End Time. Provide this OR Daily Budget."}
   * @paramDef {"type":"String","label":"Billing Event","name":"billingEvent","uiComponent":{"type":"DROPDOWN","options":{"values":["Impressions","Link Clicks","Post Engagement","Thruplay"]}},"defaultValue":"Impressions","description":"The event Meta charges you for. Impressions (default) is the most common."}
   * @paramDef {"type":"String","label":"Optimization Goal","name":"optimizationGoal","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Link Clicks","Impressions","Reach","Landing Page Views","Conversions","Lead Generation","Post Engagement","Thruplay"]}},"description":"What Meta's delivery system optimizes for."}
   * @paramDef {"type":"String","label":"Bid Strategy","name":"bidStrategy","uiComponent":{"type":"DROPDOWN","options":{"values":["Lowest Cost","Cost Cap","Bid Cap"]}},"description":"How bidding is controlled. Lowest Cost has no cap; Cost Cap and Bid Cap require a Bid Amount."}
   * @paramDef {"type":"Number","label":"Bid Amount","name":"bidAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Bid or cost cap in the account's minor currency units (cents for USD). Required when Bid Strategy is Cost Cap or Bid Cap."}
   * @paramDef {"type":"Object","label":"Targeting","name":"targeting","required":true,"description":"Targeting spec object. Example: {\"geo_locations\":{\"countries\":[\"US\"]},\"age_min\":18,\"age_max\":65}."}
   * @paramDef {"type":"Object","label":"Promoted Object","name":"promotedObject","description":"Optional promoted object for conversion/lead goals, e.g. {\"pixel_id\":\"123\",\"custom_event_type\":\"PURCHASE\"} or {\"page_id\":\"123\"}."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional start time in ISO 8601 format (e.g. 2026-06-01T10:00:00-0700). Defaults to immediate."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end time in ISO 8601 format. Required when using a Lifetime Budget."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paused","Active"]}},"defaultValue":"Paused","description":"Initial delivery status. Paused (default) is recommended until the ad set is reviewed."}
   * @returns {Object}
   * @sampleResult {"id":"120211000000000000"}
   */
  async createAdSet(accountId, name, campaignId, dailyBudget, lifetimeBudget, billingEvent, optimizationGoal, bidStrategy, bidAmount, targeting, promotedObject, startTime, endTime, status) {
    return await this.#apiRequest({
      logTag: '[createAdSet]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adsets`,
      method: 'post',
      body: clean({
        name,
        campaign_id: campaignId,
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
        billing_event: this.#resolveChoice(billingEvent, {
          'Impressions': 'IMPRESSIONS',
          'Link Clicks': 'LINK_CLICKS',
          'Post Engagement': 'POST_ENGAGEMENT',
          'Thruplay': 'THRUPLAY',
        }) || 'IMPRESSIONS',
        optimization_goal: this.#resolveChoice(optimizationGoal, {
          'Link Clicks': 'LINK_CLICKS',
          'Impressions': 'IMPRESSIONS',
          'Reach': 'REACH',
          'Landing Page Views': 'LANDING_PAGE_VIEWS',
          'Conversions': 'OFFSITE_CONVERSIONS',
          'Lead Generation': 'LEAD_GENERATION',
          'Post Engagement': 'POST_ENGAGEMENT',
          'Thruplay': 'THRUPLAY',
        }),
        bid_strategy: this.#resolveChoice(bidStrategy, {
          'Lowest Cost': 'LOWEST_COST_WITHOUT_CAP',
          'Cost Cap': 'COST_CAP',
          'Bid Cap': 'LOWEST_COST_WITH_BID_CAP',
        }),
        bid_amount: bidAmount,
        targeting,
        promoted_object: promotedObject,
        start_time: startTime,
        end_time: endTime,
        status: this.#resolveChoice(status, { 'Paused': 'PAUSED', 'Active': 'ACTIVE' }) || 'PAUSED',
      }),
    })
  }

  /**
   * @operationName Update Ad Set
   * @category Ad Sets
   * @description Updates an existing ad set via POST /{adSetId}. Any field left empty is unchanged. Use this to rename, pause/activate, adjust budgets or bids, change the optimization goal, or replace the targeting spec. Budgets and bid amounts are in the account's minor currency units (cents for USD). Returns {"success":true} on success.
   * @route POST /update-ad-set
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"dictionary":"getAdSetsDictionary","dependsOn":["accountId"],"description":"The ad set id to update."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Ad Set picker. Not sent to the API."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the ad set."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Archived"]}},"description":"New delivery status for the ad set."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New daily budget in the account's minor currency units (cents for USD, e.g. 3000 = $30.00)."}
   * @paramDef {"type":"Number","label":"Lifetime Budget","name":"lifetimeBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New lifetime budget in the account's minor currency units (cents for USD)."}
   * @paramDef {"type":"Number","label":"Bid Amount","name":"bidAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New bid or cost cap in the account's minor currency units (cents for USD)."}
   * @paramDef {"type":"String","label":"Optimization Goal","name":"optimizationGoal","uiComponent":{"type":"DROPDOWN","options":{"values":["Link Clicks","Impressions","Reach","Landing Page Views","Conversions","Lead Generation","Post Engagement","Thruplay"]}},"description":"New optimization goal for delivery."}
   * @paramDef {"type":"Object","label":"Targeting","name":"targeting","description":"Replacement targeting spec object, e.g. {\"geo_locations\":{\"countries\":[\"US\"]},\"age_min\":18,\"age_max\":65}."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in ISO 8601 format (e.g. 2026-06-01T10:00:00-0700)."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New end time in ISO 8601 format."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateAdSet(adSetId, accountId, name, status, dailyBudget, lifetimeBudget, bidAmount, optimizationGoal, targeting, startTime, endTime) {
    return await this.#apiRequest({
      logTag: '[updateAdSet]',
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }`,
      method: 'post',
      body: clean({
        name,
        status: this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Paused': 'PAUSED', 'Archived': 'ARCHIVED' }),
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
        bid_amount: bidAmount,
        optimization_goal: this.#resolveChoice(optimizationGoal, {
          'Link Clicks': 'LINK_CLICKS',
          'Impressions': 'IMPRESSIONS',
          'Reach': 'REACH',
          'Landing Page Views': 'LANDING_PAGE_VIEWS',
          'Conversions': 'OFFSITE_CONVERSIONS',
          'Lead Generation': 'LEAD_GENERATION',
          'Post Engagement': 'POST_ENGAGEMENT',
          'Thruplay': 'THRUPLAY',
        }),
        targeting,
        start_time: startTime,
        end_time: endTime,
      }),
    })
  }

  /**
   * @operationName Delete Ad Set
   * @category Ad Sets
   * @description Permanently deletes an ad set via DELETE /{adSetId}. All ads under the ad set are also deleted. This cannot be undone. Returns {"success":true} on success.
   * @route DELETE /delete-ad-set
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"dictionary":"getAdSetsDictionary","dependsOn":["accountId"],"description":"The ad set id to delete."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Ad Set picker. Not sent to the API."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteAdSet(adSetId, accountId) {
    return await this.#apiRequest({
      logTag: '[deleteAdSet]',
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Ads
   * @category Ads
   * @description Lists ads via GET /act_{accountId}/ads, or scoped to a single ad set via GET /{adSetId}/ads when an Ad Set ID is provided. Returns id, name, adset_id, campaign_id, status, effective_status, and creative for each ad. Supports pagination via Limit and After Cursor.
   * @route GET /list-ads
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix. Used when no Ad Set ID is given."}
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","dictionary":"getAdSetsDictionary","dependsOn":["accountId"],"description":"Optional ad set id. When set, only ads belonging to that ad set are returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of ads to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"120212000000000000","name":"Summer Sale Ad 1","adset_id":"120211000000000000","campaign_id":"120210000000000000","status":"ACTIVE","effective_status":"ACTIVE","creative":{"id":"120213000000000000"}}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listAds(accountId, adSetId, limit, after) {
    const url = adSetId
      ? `${ API_BASE_GRAPH_URL }/${ adSetId }/ads`
      : `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/ads`

    return await this.#apiRequest({
      logTag: '[listAds]',
      url,
      method: 'get',
      query: {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Ad
   * @category Ads
   * @description Retrieves a single ad by id via GET /{adId}. Returns id, name, adset_id, campaign_id, status, effective_status, creative, and created_time.
   * @route GET /get-ad
   * @paramDef {"type":"String","label":"Ad ID","name":"adId","required":true,"description":"The ad id to retrieve."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields to return. Defaults to id,name,adset_id,campaign_id,status,effective_status,creative,created_time."}
   * @returns {Object}
   * @sampleResult {"id":"120212000000000000","name":"Summer Sale Ad 1","adset_id":"120211000000000000","campaign_id":"120210000000000000","status":"ACTIVE","effective_status":"ACTIVE","creative":{"id":"120213000000000000"},"created_time":"2026-06-01T10:05:00-0700"}
   */
  async getAd(adId, fields) {
    return await this.#apiRequest({
      logTag: '[getAd]',
      url: `${ API_BASE_GRAPH_URL }/${ adId }`,
      method: 'get',
      query: {
        fields: fields || 'id,name,adset_id,campaign_id,status,effective_status,creative,created_time',
      },
    })
  }

  /**
   * @operationName Create Ad
   * @category Ads
   * @description Creates a new ad under an ad set via POST /act_{accountId}/ads. Links an existing ad creative (by creative id) to the ad set. Status defaults to Paused so the ad does not deliver until you activate it. Returns the new ad id.
   * @route POST /create-ad
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to create the ad under, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the ad."}
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"dictionary":"getAdSetsDictionary","dependsOn":["accountId"],"description":"The ad set this ad belongs to."}
   * @paramDef {"type":"String","label":"Creative ID","name":"creativeId","required":true,"description":"The id of an existing ad creative to use for this ad (from Create Link Ad Creative or List Ad Creatives)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paused","Active"]}},"defaultValue":"Paused","description":"Initial delivery status. Paused (default) is recommended until the ad is reviewed."}
   * @returns {Object}
   * @sampleResult {"id":"120212000000000000"}
   */
  async createAd(accountId, name, adSetId, creativeId, status) {
    return await this.#apiRequest({
      logTag: '[createAd]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/ads`,
      method: 'post',
      body: clean({
        name,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: this.#resolveChoice(status, { 'Paused': 'PAUSED', 'Active': 'ACTIVE' }) || 'PAUSED',
      }),
    })
  }

  /**
   * @operationName Update Ad
   * @category Ads
   * @description Updates an existing ad via POST /{adId}. Use this to rename the ad or change its delivery status (pause/activate/archive). Any field left empty is unchanged. Returns {"success":true} on success.
   * @route POST /update-ad
   * @paramDef {"type":"String","label":"Ad ID","name":"adId","required":true,"description":"The ad id to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the ad."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Archived"]}},"description":"New delivery status for the ad."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateAd(adId, name, status) {
    return await this.#apiRequest({
      logTag: '[updateAd]',
      url: `${ API_BASE_GRAPH_URL }/${ adId }`,
      method: 'post',
      body: clean({
        name,
        status: this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Paused': 'PAUSED', 'Archived': 'ARCHIVED' }),
      }),
    })
  }

  /**
   * @operationName Delete Ad
   * @category Ads
   * @description Permanently deletes an ad via DELETE /{adId}. This cannot be undone. Returns {"success":true} on success.
   * @route DELETE /delete-ad
   * @paramDef {"type":"String","label":"Ad ID","name":"adId","required":true,"description":"The ad id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteAd(adId) {
    return await this.#apiRequest({
      logTag: '[deleteAd]',
      url: `${ API_BASE_GRAPH_URL }/${ adId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Ad Creatives
   * @category Creatives
   * @description Lists ad creatives in an ad account via GET /act_{accountId}/adcreatives. Returns id, name, title, body, object_story_spec, and thumbnail_url for each creative. Supports pagination via Limit and After Cursor.
   * @route GET /list-ad-creatives
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of creatives to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"120213000000000000","name":"Summer Link Creative","title":"Big Summer Sale","body":"Up to 50% off","thumbnail_url":"https://scontent.example.com/thumb.jpg"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listAdCreatives(accountId, limit, after) {
    return await this.#apiRequest({
      logTag: '[listAdCreatives]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adcreatives`,
      method: 'get',
      query: {
        fields: 'id,name,title,body,object_story_spec,thumbnail_url',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Ad Creative
   * @category Creatives
   * @description Retrieves a single ad creative by id via GET /{creativeId}. Returns id, name, title, body, object_story_spec, image_hash, image_url, and thumbnail_url.
   * @route GET /get-ad-creative
   * @paramDef {"type":"String","label":"Creative ID","name":"creativeId","required":true,"description":"The ad creative id to retrieve."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated fields to return. Defaults to id,name,title,body,object_story_spec,image_hash,image_url,thumbnail_url."}
   * @returns {Object}
   * @sampleResult {"id":"120213000000000000","name":"Summer Link Creative","title":"Big Summer Sale","body":"Up to 50% off","object_story_spec":{"page_id":"1122334455","link_data":{"link":"https://example.com","message":"Shop now"}},"thumbnail_url":"https://scontent.example.com/thumb.jpg"}
   */
  async getAdCreative(creativeId, fields) {
    return await this.#apiRequest({
      logTag: '[getAdCreative]',
      url: `${ API_BASE_GRAPH_URL }/${ creativeId }`,
      method: 'get',
      query: {
        fields: fields || 'id,name,title,body,object_story_spec,image_hash,image_url,thumbnail_url',
      },
    })
  }

  /**
   * @operationName Create Link Ad Creative
   * @category Creatives
   * @description Creates a link ad creative via POST /act_{accountId}/adcreatives. This convenience action builds the object_story_spec for a single-image link ad from friendly parameters: Page ID, destination Link, primary text (Message), Headline, Description, an optional Call To Action, and an image (either an Image Hash from Upload Ad Image or a public Picture URL). For full control you may instead pass a raw Object Story Spec, which overrides all convenience fields. Returns the new creative id.
   * @route POST /create-link-ad-creative
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to create the creative under, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the creative (internal, not shown to users)."}
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Facebook Page the ad is published from. Required unless a raw Object Story Spec is provided."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"The destination URL the ad links to. Required unless a raw Object Story Spec is provided."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The primary text shown above the ad."}
   * @paramDef {"type":"String","label":"Headline","name":"headline","description":"The bold headline shown under the image (maps to link_data.name)."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"The link description shown below the headline."}
   * @paramDef {"type":"String","label":"Call To Action","name":"callToAction","uiComponent":{"type":"DROPDOWN","options":{"values":["Learn More","Shop Now","Sign Up","Subscribe","Contact Us","Download"]}},"description":"Optional call-to-action button. Uses the destination Link as its target."}
   * @paramDef {"type":"String","label":"Image Hash","name":"imageHash","description":"Image hash from Upload Ad Image to use as the ad image. Provide this OR a Picture URL."}
   * @paramDef {"type":"String","label":"Picture URL","name":"picture","description":"Public image URL to use as the ad image when no Image Hash is provided."}
   * @paramDef {"type":"Object","label":"Object Story Spec","name":"objectStorySpec","description":"Advanced: a raw object_story_spec that fully replaces the convenience fields above. See the Marketing API docs for its structure."}
   * @returns {Object}
   * @sampleResult {"id":"120213000000000000"}
   */
  async createLinkAdCreative(accountId, name, pageId, link, message, headline, description, callToAction, imageHash, picture, objectStorySpec) {
    let storySpec = objectStorySpec

    if (!storySpec) {
      const linkData = clean({
        link,
        message,
        name: headline,
        description,
        image_hash: imageHash,
        picture,
      })

      const ctaType = this.#resolveChoice(callToAction, {
        'Learn More': 'LEARN_MORE',
        'Shop Now': 'SHOP_NOW',
        'Sign Up': 'SIGN_UP',
        'Subscribe': 'SUBSCRIBE',
        'Contact Us': 'CONTACT_US',
        'Download': 'DOWNLOAD',
      })

      if (ctaType) {
        linkData.call_to_action = { type: ctaType, value: { link } }
      }

      storySpec = {
        page_id: pageId,
        link_data: linkData,
      }
    }

    return await this.#apiRequest({
      logTag: '[createLinkAdCreative]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adcreatives`,
      method: 'post',
      body: clean({
        name,
        object_story_spec: storySpec,
      }),
    })
  }

  /**
   * @operationName Upload Ad Image
   * @category Ad Images
   * @description Uploads an image to an ad account's image library via POST /act_{accountId}/adimages, reading the bytes from a Flowrunner file. The response maps the uploaded image name to its hash; this action returns the hash directly (plus the raw response), which you then pass to Create Link Ad Creative as the Image Hash. Returns {"hash":"...","name":"...","images":{...}}.
   * @route POST /upload-ad-image
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to upload the image to, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"A Flowrunner file (JPG or PNG) to upload as an ad image."}
   * @returns {Object}
   * @sampleResult {"hash":"e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","name":"a1b2c3.jpg","images":{"a1b2c3.jpg":{"hash":"e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0","url":"https://scontent.example.com/adimage.jpg"}}}
   */
  async uploadAdImage(accountId, fileUrl) {
    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const base64 = buffer.toString('base64')

    const response = await this.#apiRequest({
      logTag: '[uploadAdImage]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adimages`,
      method: 'post',
      body: { bytes: base64 },
    })

    const images = response.images || {}
    const firstKey = Object.keys(images)[0]
    const first = firstKey ? images[firstKey] : undefined

    return {
      hash: first?.hash,
      name: firstKey,
      images,
    }
  }

  /**
   * @operationName Get Insights
   * @category Insights
   * @description Retrieves performance insights for any ads object via GET /{objectId}/insights. The Object ID can be an ad account (act_...), campaign, ad set, or ad id; use Level to aggregate results (Account, Campaign, Ad Set, or Ad). Choose the metrics to return via Fields (e.g. Impressions, Clicks, Spend, CTR, Reach). Bound the range with a Date Preset, or with explicit Since/Until dates (both required, sent as a time_range). Optionally split results with Breakdowns (e.g. Age, Gender, Country, Platform) and set Time Increment to 1 for a daily time series. Spend and cost metrics are returned in the account's currency (major units, e.g. dollars). Supports pagination via Limit and After Cursor.
   * @route GET /get-insights
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"description":"The ads object to report on: an ad account (act_123), campaign, ad set, or ad id."}
   * @paramDef {"type":"String","label":"Level","name":"level","uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","Ad Set","Ad"]}},"description":"The aggregation level for the returned rows."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","uiComponent":{"type":"DROPDOWN","options":{"values":["Impressions","Clicks","Spend","CPC","CPM","CTR","Reach","Frequency","Actions","Cost Per Action","Unique Clicks"]}},"description":"Metrics to return. Defaults to Impressions, Clicks, Spend, CPC, CPM, CTR, Reach when none are selected."}
   * @paramDef {"type":"String","label":"Date Preset","name":"datePreset","uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 Days","Last 14 Days","Last 30 Days","This Month","Last Month","Maximum"]}},"description":"A predefined reporting window. Ignored when both Since and Until are provided."}
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_PICKER"},"description":"Start date (YYYY-MM-DD) of a custom range. Provide together with Until; overrides Date Preset."}
   * @paramDef {"type":"String","label":"Until","name":"until","uiComponent":{"type":"DATE_PICKER"},"description":"End date (YYYY-MM-DD) of a custom range. Provide together with Since; overrides Date Preset."}
   * @paramDef {"type":"Array<String>","label":"Breakdowns","name":"breakdowns","uiComponent":{"type":"DROPDOWN","options":{"values":["Age","Gender","Country","Region","Platform","Placement"]}},"description":"Optional dimensions to split results by (e.g. Age, Gender, Platform)."}
   * @paramDef {"type":"Number","label":"Time Increment","name":"timeIncrement","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Set to 1 to return a daily time series. Omit for a single aggregated row across the range."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"impressions":"10520","clicks":"312","spend":"152.34","cpc":"0.49","cpm":"14.48","ctr":"2.97","reach":"8410","date_start":"2026-06-01","date_stop":"2026-06-30"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async getInsights(objectId, level, fields, datePreset, since, until, breakdowns, timeIncrement, limit, after) {
    const resolvedFields = this.#resolveChoices(fields, {
      'Impressions': 'impressions',
      'Clicks': 'clicks',
      'Spend': 'spend',
      'CPC': 'cpc',
      'CPM': 'cpm',
      'CTR': 'ctr',
      'Reach': 'reach',
      'Frequency': 'frequency',
      'Actions': 'actions',
      'Cost Per Action': 'cost_per_action_type',
      'Unique Clicks': 'unique_clicks',
    })

    const resolvedBreakdowns = this.#resolveChoices(breakdowns, {
      'Age': 'age',
      'Gender': 'gender',
      'Country': 'country',
      'Region': 'region',
      'Platform': 'publisher_platform',
      'Placement': 'platform_position',
    })

    const useTimeRange = since && until

    return await this.#apiRequest({
      logTag: '[getInsights]',
      url: `${ API_BASE_GRAPH_URL }/${ objectId }/insights`,
      method: 'get',
      query: {
        fields: resolvedFields && resolvedFields.length
          ? resolvedFields.join(',')
          : 'impressions,clicks,spend,cpc,cpm,ctr,reach',
        level: this.#resolveChoice(level, {
          'Account': 'account',
          'Campaign': 'campaign',
          'Ad Set': 'adset',
          'Ad': 'ad',
        }),
        date_preset: useTimeRange ? undefined : this.#resolveChoice(datePreset, {
          'Today': 'today',
          'Yesterday': 'yesterday',
          'Last 7 Days': 'last_7d',
          'Last 14 Days': 'last_14d',
          'Last 30 Days': 'last_30d',
          'This Month': 'this_month',
          'Last Month': 'last_month',
          'Maximum': 'maximum',
        }),
        time_range: useTimeRange ? JSON.stringify({ since, until }) : undefined,
        breakdowns: resolvedBreakdowns && resolvedBreakdowns.length ? resolvedBreakdowns.join(',') : undefined,
        time_increment: timeIncrement,
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName List Custom Audiences
   * @category Custom Audiences
   * @description Lists custom audiences in an ad account via GET /act_{accountId}/customaudiences. Returns id, name, subtype, approximate_count_lower_bound, and delivery_status for each audience. Supports pagination via Limit and After Cursor.
   * @route GET /list-custom-audiences
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id, with or without the act_ prefix."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of audiences to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"120214000000000000","name":"Newsletter Subscribers","subtype":"CUSTOM","approximate_count_lower_bound":10200,"delivery_status":{"code":200,"description":"This audience is ready for use."}}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listCustomAudiences(accountId, limit, after) {
    return await this.#apiRequest({
      logTag: '[listCustomAudiences]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/customaudiences`,
      method: 'get',
      query: {
        fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Create Custom Audience
   * @category Custom Audiences
   * @description Creates a new customer-file custom audience (subtype CUSTOM) in an ad account via POST /act_{accountId}/customaudiences. After creating, use Add Users to Audience to populate it with hashed contact data. Customer File Source declares where the data originated, which is required for compliance. Returns the new audience id.
   * @route POST /create-custom-audience
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The ad account id to create the audience under, with or without the act_ prefix."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the custom audience."}
   * @paramDef {"type":"String","label":"Customer File Source","name":"customerFileSource","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User Provided Only","Partner Provided Only","Both"]}},"description":"Declares the origin of the customer data being uploaded."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the audience for your own reference."}
   * @returns {Object}
   * @sampleResult {"id":"120214000000000000"}
   */
  async createCustomAudience(accountId, name, customerFileSource, description) {
    return await this.#apiRequest({
      logTag: '[createCustomAudience]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/customaudiences`,
      method: 'post',
      body: clean({
        name,
        subtype: 'CUSTOM',
        customer_file_source: this.#resolveChoice(customerFileSource, {
          'User Provided Only': 'USER_PROVIDED_ONLY',
          'Partner Provided Only': 'PARTNER_PROVIDED_ONLY',
          'Both': 'BOTH_USER_AND_PARTNER_PROVIDED',
        }),
        description,
      }),
    })
  }

  // Normalizes and SHA256-hashes a single email or phone value per Meta's requirements:
  // trim, lowercase (email) / strip non-digits (phone), then hex-encode the digest.
  #hashIdentifier(value, schema) {
    let normalized = String(value || '').trim().toLowerCase()

    if (schema === 'PHONE_SHA256') {
      normalized = normalized.replace(/[^0-9]/g, '').replace(/^0+/, '')
    }

    return crypto.createHash('sha256').update(normalized).digest('hex')
  }

  /**
   * @operationName Add Users to Audience
   * @category Custom Audiences
   * @description Adds users to a custom audience via POST /{audienceId}/users. Supply plain email addresses or phone numbers — this action normalizes (trims, lowercases emails; strips non-digits from phones) and SHA256-hashes each value before sending, as Meta requires. Choose Schema to indicate whether you are uploading emails or phone numbers. Returns the number of records received and matched.
   * @route POST /add-users-to-audience
   * @paramDef {"type":"String","label":"Audience ID","name":"audienceId","required":true,"dictionary":"getCustomAudiencesDictionary","dependsOn":["accountId"],"description":"The custom audience id to add users to."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Audience picker. Not sent to the API."}
   * @paramDef {"type":"Array<String>","label":"Users","name":"users","required":true,"description":"Plain email addresses or phone numbers to add. They are hashed client-side before upload."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone"]}},"defaultValue":"Email","description":"The type of identifier in the Users list."}
   * @returns {Object}
   * @sampleResult {"audience_id":"120214000000000000","session_id":9778993,"num_received":250,"num_invalid_entries":0}
   */
  async addUsersToAudience(audienceId, accountId, users, schema) {
    const schemaValue = this.#resolveChoice(schema, { 'Email': 'EMAIL_SHA256', 'Phone': 'PHONE_SHA256' }) || 'EMAIL_SHA256'
    const data = (users || []).map(value => [this.#hashIdentifier(value, schemaValue)])

    return await this.#apiRequest({
      logTag: '[addUsersToAudience]',
      url: `${ API_BASE_GRAPH_URL }/${ audienceId }/users`,
      method: 'post',
      body: {
        payload: {
          schema: [schemaValue],
          data,
        },
      },
    })
  }

  /**
   * @operationName Remove Users from Audience
   * @category Custom Audiences
   * @description Removes users from a custom audience via DELETE /{audienceId}/users. Supply plain email addresses or phone numbers — this action normalizes and SHA256-hashes each value before sending, matching how they were added. Choose Schema to indicate the identifier type. Returns the number of records processed.
   * @route DELETE /remove-users-from-audience
   * @paramDef {"type":"String","label":"Audience ID","name":"audienceId","required":true,"dictionary":"getCustomAudiencesDictionary","dependsOn":["accountId"],"description":"The custom audience id to remove users from."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Audience picker. Not sent to the API."}
   * @paramDef {"type":"Array<String>","label":"Users","name":"users","required":true,"description":"Plain email addresses or phone numbers to remove. They are hashed client-side before upload."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone"]}},"defaultValue":"Email","description":"The type of identifier in the Users list."}
   * @returns {Object}
   * @sampleResult {"audience_id":"120214000000000000","session_id":9778994,"num_received":120,"num_invalid_entries":0}
   */
  async removeUsersFromAudience(audienceId, accountId, users, schema) {
    const schemaValue = this.#resolveChoice(schema, { 'Email': 'EMAIL_SHA256', 'Phone': 'PHONE_SHA256' }) || 'EMAIL_SHA256'
    const data = (users || []).map(value => [this.#hashIdentifier(value, schemaValue)])

    return await this.#apiRequest({
      logTag: '[removeUsersFromAudience]',
      url: `${ API_BASE_GRAPH_URL }/${ audienceId }/users`,
      method: 'delete',
      body: {
        payload: {
          schema: [schemaValue],
          data,
        },
      },
    })
  }

  /**
   * @operationName Delete Custom Audience
   * @category Custom Audiences
   * @description Permanently deletes a custom audience via DELETE /{audienceId}. Any ad sets targeting it will no longer use it. This cannot be undone. Returns {"success":true} on success.
   * @route DELETE /delete-custom-audience
   * @paramDef {"type":"String","label":"Audience ID","name":"audienceId","required":true,"dictionary":"getCustomAudiencesDictionary","dependsOn":["accountId"],"description":"The custom audience id to delete."}
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","dictionary":"getAdAccountsDictionary","description":"The ad account id used only to populate the Audience picker. Not sent to the API."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCustomAudience(audienceId, accountId) {
    return await this.#apiRequest({
      logTag: '[deleteCustomAudience]',
      url: `${ API_BASE_GRAPH_URL }/${ audienceId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List My Pages
   * @category Pages
   * @description Lists the Facebook Pages the authenticated user manages via GET /me/accounts. Returns id and name for each Page. Use a Page id when creating link ad creatives (as the Page the ad is published from). Supports pagination via Limit and After Cursor.
   * @route GET /list-my-pages
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of Pages to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"1122334455","name":"Acme Store"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listMyPages(limit, after) {
    return await this.#apiRequest({
      logTag: '[listMyPages]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @typedef {Object} getAdAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ad accounts by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of ad accounts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ad Accounts Dictionary
   * @description Lists the ad accounts accessible to the authenticated user (via GET /me/adaccounts) for selecting an ad account id in dependent parameters. The option value is the ad account id including the act_ prefix.
   * @route POST /get-ad-accounts-dictionary
   * @paramDef {"type":"getAdAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing ad accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Ad Account","value":"act_123456789","note":"USD"}],"cursor":"MjQ"}
   */
  async getAdAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getAdAccountsDictionary]',
      url: `${ API_BASE_GRAPH_URL }/me/adaccounts`,
      method: 'get',
      query: {
        fields: 'id,name,currency',
        limit: 100,
        after: cursor,
      },
    })

    const accounts = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? accounts.filter(account => (account.name || '').toLowerCase().includes(term)) : accounts

    return {
      items: filtered.map(account => ({
        label: account.name || account.id,
        value: account.id,
        note: account.currency || undefined,
      })),
      cursor: response.paging?.cursors?.after || undefined,
    }
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"description":"The ad account id whose campaigns to list, with or without the act_ prefix."}
   */

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of campaigns."}
   * @paramDef {"type":"getCampaignsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the ad account whose campaigns to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Lists campaigns within a selected ad account (via GET /act_{accountId}/campaigns) for selecting a campaign id in dependent parameters. Requires an ad account id in criteria. The option value is the campaign id.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (ad account id) for listing campaigns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Summer Sale","value":"120210000000000000","note":"ACTIVE | OUTCOME_TRAFFIC"}],"cursor":"MjQ"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const accountId = criteria?.accountId

    if (!accountId) {
      return { items: [], cursor: undefined }
    }

    const response = await this.#apiRequest({
      logTag: '[getCampaignsDictionary]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/campaigns`,
      method: 'get',
      query: {
        fields: 'id,name,status,objective',
        limit: 100,
        after: cursor,
      },
    })

    const campaigns = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? campaigns.filter(campaign => (campaign.name || '').toLowerCase().includes(term)) : campaigns

    return {
      items: filtered.map(campaign => ({
        label: campaign.name || campaign.id,
        value: campaign.id,
        note: [campaign.status, campaign.objective].filter(Boolean).join(' | ') || undefined,
      })),
      cursor: response.paging?.cursors?.after || undefined,
    }
  }

  /**
   * @typedef {Object} getAdSetsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"description":"The ad account id whose ad sets to list, with or without the act_ prefix."}
   */

  /**
   * @typedef {Object} getAdSetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ad sets by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of ad sets."}
   * @paramDef {"type":"getAdSetsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the ad account whose ad sets to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ad Sets Dictionary
   * @description Lists ad sets within a selected ad account (via GET /act_{accountId}/adsets) for selecting an ad set id in dependent parameters. Requires an ad account id in criteria. The option value is the ad set id.
   * @route POST /get-ad-sets-dictionary
   * @paramDef {"type":"getAdSetsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (ad account id) for listing ad sets."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"US Adults 18-65","value":"120211000000000000","note":"ACTIVE"}],"cursor":"MjQ"}
   */
  async getAdSetsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const accountId = criteria?.accountId

    if (!accountId) {
      return { items: [], cursor: undefined }
    }

    const response = await this.#apiRequest({
      logTag: '[getAdSetsDictionary]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/adsets`,
      method: 'get',
      query: {
        fields: 'id,name,status',
        limit: 100,
        after: cursor,
      },
    })

    const adSets = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? adSets.filter(adSet => (adSet.name || '').toLowerCase().includes(term)) : adSets

    return {
      items: filtered.map(adSet => ({
        label: adSet.name || adSet.id,
        value: adSet.id,
        note: adSet.status || undefined,
      })),
      cursor: response.paging?.cursors?.after || undefined,
    }
  }

  /**
   * @typedef {Object} getCustomAudiencesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Ad Account ID","name":"accountId","required":true,"description":"The ad account id whose custom audiences to list, with or without the act_ prefix."}
   */

  /**
   * @typedef {Object} getCustomAudiencesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter audiences by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of audiences."}
   * @paramDef {"type":"getCustomAudiencesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the ad account whose custom audiences to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Audiences Dictionary
   * @description Lists custom audiences within a selected ad account (via GET /act_{accountId}/customaudiences) for selecting an audience id in dependent parameters. Requires an ad account id in criteria. The option value is the audience id.
   * @route POST /get-custom-audiences-dictionary
   * @paramDef {"type":"getCustomAudiencesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and criteria (ad account id) for listing custom audiences."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":"120214000000000000","note":"CUSTOM"}],"cursor":"MjQ"}
   */
  async getCustomAudiencesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const accountId = criteria?.accountId

    if (!accountId) {
      return { items: [], cursor: undefined }
    }

    const response = await this.#apiRequest({
      logTag: '[getCustomAudiencesDictionary]',
      url: `${ API_BASE_GRAPH_URL }/${ this.#normalizeAccountId(accountId) }/customaudiences`,
      method: 'get',
      query: {
        fields: 'id,name,subtype',
        limit: 100,
        after: cursor,
      },
    })

    const audiences = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? audiences.filter(audience => (audience.name || '').toLowerCase().includes(term)) : audiences

    return {
      items: filtered.map(audience => ({
        label: audience.name || audience.id,
        value: audience.id,
        note: audience.subtype || undefined,
      })),
      cursor: response.paging?.cursors?.after || undefined,
    }
  }

  /**
   * @typedef {Object} getPagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter your managed Pages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of managed Pages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages Dictionary
   * @description Lists the Facebook Pages the authenticated user manages (via GET /me/accounts) for selecting a Page id when creating ad creatives. The option value is the Page id.
   * @route POST /get-pages-dictionary
   * @paramDef {"type":"getPagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing managed Pages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Store","value":"1122334455"}],"cursor":"MjQ"}
   */
  async getPagesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getPagesDictionary]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name',
        limit: 100,
        after: cursor,
      },
    })

    const pages = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? pages.filter(page => (page.name || '').toLowerCase().includes(term)) : pages

    return {
      items: filtered.map(page => ({
        label: page.name || page.id,
        value: page.id,
      })),
      cursor: response.paging?.cursors?.after || undefined,
    }
  }
}

Flowrunner.ServerCode.addService(MetaAdsService, [
  {
    name: 'clientId',
    displayName: 'App Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App ID from your Meta app dashboard (developers.facebook.com/apps). The app must have the Marketing API product added.',
  },
  {
    name: 'clientSecret',
    displayName: 'App Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App Secret from your Meta app dashboard, found under App Settings > Basic. Keep this value confidential.',
  },
])
