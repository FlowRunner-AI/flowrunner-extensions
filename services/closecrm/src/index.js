'use strict'

const {
  OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL,
  API_BASE_URL,
  DEFAULT_SCOPE_STRING,
  DEFAULT_PAGE_LIMIT,
  SEARCH_PAGE_LIMIT,
  MAX_PAGES_DEFAULT,
  WEBHOOK_EVENT_MAP,
  EVENT_TO_METHOD,
} = require('./constants')

const { logger } = require('./helpers/logger')
const { deepClean, toArray, parseMaybeJSON, applySearch } = require('./helpers/utils')
const { makeApiRequest } = require('./helpers/http')
const { wrapError } = require('./helpers/errors')
const { paginateOffset, paginateCursor } = require('./helpers/pagination')
const { buildSearchQuery, smartViewNode } = require('./helpers/search')
const { verifySignature, rawBodyOf, headersOf } = require('./helpers/webhooks')

const CALL_TYPES = { SHAPE_EVENT: 'SHAPE_EVENT', FILTER_TRIGGER: 'FILTER_TRIGGER' }

// Friendly DROPDOWN label → Close API value. Dropdowns expose plain-string labels in the UI;
// these maps translate the chosen label back to the value the API expects (lossless transform).
const CHOICE_MAPS = {
  opportunityStatusType: { Active: 'active', Won: 'won', Lost: 'lost' },
  valuePeriod: { 'One-Time': 'one_time', Monthly: 'monthly', Annual: 'annual' },
  callDirection: { Inbound: 'inbound', Outbound: 'outbound' },
  emailStatus: {
    'Send Now (Outbox)': 'outbox',
    'Save as Draft': 'draft',
    'Log as Sent': 'sent',
    'Log as Received': 'inbox',
    'Schedule for Later': 'scheduled',
  },
  smsStatus: {
    'Send Now (Outbox)': 'outbox',
    'Log as Sent': 'sent',
    'Log as Received': 'inbox',
    'Save as Draft': 'draft',
  },
  taskType: {
    Lead: 'lead',
    'Missed Call': 'missed_call',
    'Incoming Email': 'incoming_email',
    'Answered Detached Call': 'answered_detached_call',
    Voicemail: 'voicemail',
    'Email Follow-Up': 'email_followup',
  },
  activityType: {
    Note: 'note',
    Call: 'call',
    Email: 'email',
    SMS: 'sms',
    Meeting: 'meeting',
    'Task Completed': 'task_completed',
    'Lead Status Change': 'lead_status_change',
    'Opportunity Status Change': 'opportunity_status_change',
    Created: 'created',
  },
  customFieldObjectType: { Lead: 'lead', Contact: 'contact', Opportunity: 'opportunity', Activity: 'activity', Shared: 'shared' },
  searchObjectType: { Lead: 'lead', Contact: 'contact', Opportunity: 'opportunity', Activity: 'activity', 'Custom Object': 'custom_object' },
  bulkEditType: { 'Set Lead Status': 'set_lead_status', 'Set Custom Field': 'set_custom_field', 'Clear Custom Field': 'clear_custom_field' },
  bulkEmailContactPreference: { 'Primary Contact Per Lead': 'lead', 'First Contact Per Lead': 'contact' },
  bulkActionKind: { Edit: 'edit', Delete: 'delete', Email: 'email' },
  webhookStatus: { Active: 'active', Paused: 'paused' },
}

// ════════════════════════════════════════════════════════════════════════════
// Index of @typedef payloads for DICTIONARY methods (placed before class for visibility)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} getPipelinesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getLeadStatusesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional label filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getOpportunityStatusesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional label filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name or email filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getLeadsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name or company search."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getContactsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Lead","name":"leadId","description":"Optional lead ID to restrict contacts."}
 */

/**
 * @typedef {Object} getContactsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name or email filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 * @paramDef {"type":"getContactsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional dependencies (leadId)."}
 */

/**
 * @typedef {Object} getOpportunitiesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Lead","name":"leadId","description":"Optional lead ID to restrict opportunities."}
 */

/**
 * @typedef {Object} getOpportunitiesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional opportunity note filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 * @paramDef {"type":"getOpportunitiesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional dependencies (leadId)."}
 */

/**
 * @typedef {Object} getSmartViewsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getSequencesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getCustomActivityTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getCustomFieldsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"description":"One of: lead, contact, opportunity, activity, shared, custom_object."}
 * @paramDef {"type":"String","label":"Custom Object Type","name":"customObjectTypeId","description":"Required when objectType is custom_object."}
 */

/**
 * @typedef {Object} getCustomFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 * @paramDef {"type":"getCustomFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required dependencies (objectType)."}
 */

/**
 * @typedef {Object} getEmailAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional email filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getEmailTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional template name filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getTasksDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Lead","name":"leadId","description":"Optional lead ID to restrict tasks."}
 */

/**
 * @typedef {Object} getTasksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional task text filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 * @paramDef {"type":"getTasksDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional dependencies (leadId)."}
 */

/**
 * @typedef {Object} getWebhooksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional URL filter."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} ContactEmail
 * @property {String} email - Email address.
 * @property {String} type - Where this email is used. One of: office, mobile, home, direct, other.
 */

/**
 * @typedef {Object} ContactPhone
 * @property {String} phone - Phone number. Include the country code (e.g., +15551234567).
 * @property {String} type - Where this phone is used. One of: office, mobile, home, direct, other.
 */

/**
 * @typedef {Object} ContactURL
 * @property {String} url - Full URL including https://.
 * @property {String} type - Label for the URL. Typically: url, other.
 */

/**
 * @typedef {Object} CloseContact
 * @property {String} name - Contact full name.
 * @property {String} title - Job title (e.g., "VP of Sales").
 * @property {Array.<ContactEmail>} emails - Email entries.
 * @property {Array.<ContactPhone>} phones - Phone entries.
 * @property {Array.<ContactURL>} urls - URL entries (LinkedIn, website, etc.).
 */

/**
 * @typedef {Object} CloseAddress
 * @property {String} label - Address label (e.g., "business", "mailing").
 * @property {String} address_1 - Street line 1.
 * @property {String} address_2 - Street line 2 (optional).
 * @property {String} city - City.
 * @property {String} state - State or region.
 * @property {String} zipcode - Postal / ZIP code.
 * @property {String} country - Two-letter country code (e.g., "US").
 */

/**
 * @typedef {Object} WebhookEventSpec
 * @property {String} object_type - Which kind of thing to listen for. Common values: "lead", "contact", "opportunity", "activity.note", "activity.call", "activity.email", "activity.sms", "task.lead", "task_completion", "lead_status_change", "opportunity_status_change". Use "*" to subscribe to every type.
 * @property {String} action - Which kind of change to listen for: "created", "updated", "deleted", "status_change", "merged", "completed", or "sent". Use "*" for every action.
 */

/**
 * @typedef {Object} AdvancedSearchFilter
 * @property {String} leadStatus - Filter by lead status name (e.g., "Qualified"). Applies when Object Type is Lead.
 * @property {String} opportunityStatus - Filter by opportunity status name. Applies when Object Type is Opportunity.
 * @property {String} pipelineId - Filter opportunities by pipeline. Find IDs via Get Pipelines Dictionary.
 * @property {String} contactId - Restrict results to records linked to this contact.
 * @property {String} userId - Restrict results to records created by this user.
 * @property {String} assignedToId - Restrict leads to those owned by this user.
 * @property {String} createdAfter - Only include records created on or after this date / time.
 * @property {String} createdBefore - Only include records created before this date / time.
 * @property {String} updatedAfter - Only include records updated on or after this date / time.
 * @property {String} updatedBefore - Only include records updated before this date / time.
 * @property {Object} customFields - Map of custom field IDs to required values (e.g., { "abcd1234": "High" }). Find IDs via Get Custom Fields Dictionary.
 * @property {Array<Object>} conditions - Power-user escape hatch: extra Close-native condition nodes to append.
 * @property {String} operator - How to combine the filters. Defaults to "and" (every condition must match). Use "or" if any condition is enough.
 */

/**
 * @requireOAuth
 * @integrationName Close CRM
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class CloseCRMService {
  constructor(config) {
    this.clientId = config?.clientId
    this.clientSecret = config?.clientSecret
    this.defaultEmailAccountId = config?.defaultEmailAccountId || null
    this.scopes = DEFAULT_SCOPE_STRING

    this.apiRequest = makeApiRequest(this)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Auth header helpers + token-aware request bootstrap
  // ═══════════════════════════════════════════════════════════════════════════

  getAuthHeader() {
    const token = this.#getAccessToken()

    return { Authorization: `Bearer ${ token }`, Accept: 'application/json' }
  }

  #getAccessToken() {
    return this?.request?.headers?.['oauth-access-token']
  }

  #getBasicAuthHeader() {
    const token = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return { Authorization: `Basic ${ token }` }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — OAuth2 system methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: this.scopes,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {Object}
   */
  async executeCallback(callbackObject) {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: callbackObject.code,
      redirect_uri: callbackObject.redirectURI,
    })

    let token

    try {
      token = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set(this.#getBasicAuthHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' })
        .send(form.toString())
    } catch (error) {
      logger.error(`[executeCallback] token exchange error: ${ error.message }`)
      throw wrapError(error, 'executeCallback')
    }

    let identityName = ''
    let identityImage

    try {
      const me = await Flowrunner.Request.get(`${ API_BASE_URL }/me/`)
        .set({ Authorization: `Bearer ${ token.access_token }`, Accept: 'application/json' })
      identityName = me?.email || me?.display_name || me?.first_name || 'Close CRM User'
      identityImage = me?.image
    } catch (error) {
      logger.warn(`[executeCallback] /me/ failed (non-fatal): ${ error.message }`)
    }

    return {
      token: token.access_token,
      refreshToken: token.refresh_token,
      expirationInSeconds: token.expires_in,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: identityImage,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {Object}
   */
  async refreshToken(refreshToken) {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })

    try {
      const token = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set(this.#getBasicAuthHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' })
        .send(form.toString())

      // Close rotates refresh tokens on every refresh — always overwrite.
      return {
        token: token.access_token,
        expirationInSeconds: token.expires_in,
        refreshToken: token.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`[refreshToken] error: ${ error.message }`)
      throw wrapError(error, 'refreshToken')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — Dictionaries
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines Dictionary
   * @description Lists Close opportunity pipelines for dropdown selection.
   * @route POST /get-pipelines-dictionary
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Optional search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales","value":"pipe_abc","note":"4 statuses"}],"cursor":null}
   */
  async getPipelinesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/pipeline/`, logTag: 'getPipelinesDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(p => ({ label: p.name, value: p.id, note: `${ (p.statuses || []).length } statuses` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Statuses Dictionary
   * @description Lists Close lead status labels for dropdown selection.
   * @route POST /get-lead-statuses-dictionary
   * @paramDef {"type":"getLeadStatusesDictionary__payload","label":"Payload","name":"payload","description":"Optional search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualified","value":"stat_xyz","note":"ID: stat_xyz"}],"cursor":null}
   */
  async getLeadStatusesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/status/lead/`, logTag: 'getLeadStatusesDictionary' })
    const items = applySearch(res?.data || [], search, ['label'])
      .map(s => ({ label: s.label, value: s.id, note: `ID: ${ s.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Opportunity Statuses Dictionary
   * @description Lists Close opportunity status labels for dropdown selection.
   * @route POST /get-opportunity-statuses-dictionary
   * @paramDef {"type":"getOpportunityStatusesDictionary__payload","label":"Payload","name":"payload","description":"Optional search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Won","value":"stat_oppA","note":"Type: won"}],"cursor":null}
   */
  async getOpportunityStatusesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/status/opportunity/`, logTag: 'getOpportunityStatusesDictionary' })
    const items = applySearch(res?.data || [], search, ['label'])
      .map(s => ({ label: s.label, value: s.id, note: s.status_type ? `Type: ${ s.status_type }` : undefined }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists active users in the connected Close organization for assignment.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Optional name/email search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Doe","value":"user_abc","note":"alex@acme.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/user/`, logTag: 'getUsersDictionary' })
    const items = applySearch(res?.data || [], search, ['first_name', 'last_name', 'email', 'display_name'])
      .map(u => ({
        label: u.display_name || `${ u.first_name || '' } ${ u.last_name || '' }`.trim() || u.email,
        value: u.id,
        note: u.email,
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Leads Dictionary
   * @description Searchable list of leads by display name or company. Useful when a user must pick a specific lead before another field.
   * @route POST /get-leads-dictionary
   * @paramDef {"type":"getLeadsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc.","value":"lead_abc","note":"Status: Qualified"}],"cursor":null}
   */
  async getLeadsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (search) query.query = search
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/lead/`, query, logTag: 'getLeadsDictionary' })
    const items = (res?.data || []).map(l => ({
      label: l.display_name || l.name || l.id,
      value: l.id,
      note: l.status_label ? `Status: ${ l.status_label }` : undefined,
    }))
    const nextCursor = res?.has_more ? String((cursor ? Number(cursor) : 0) + items.length) : null

    return { items, cursor: nextCursor }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Searchable list of contacts. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Optional search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"cont_abc","note":"jane@acme.com"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const leadId = criteria?.leadId
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (leadId) query.lead_id = leadId
    if (search) query.query = search
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/contact/`, query, logTag: 'getContactsDictionary' })
    const items = (res?.data || []).map(c => ({
      label: c.name || c.id,
      value: c.id,
      note: c?.emails?.[0]?.email,
    }))
    const nextCursor = res?.has_more ? String((cursor ? Number(cursor) : 0) + items.length) : null

    return { items, cursor: nextCursor }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Opportunities Dictionary
   * @description Searchable list of opportunities. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-opportunities-dictionary
   * @paramDef {"type":"getOpportunitiesDictionary__payload","label":"Payload","name":"payload","description":"Optional search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"$5,000 — Annual Plan","value":"oppo_abc","note":"Status: Active"}],"cursor":null}
   */
  async getOpportunitiesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const leadId = criteria?.leadId
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (leadId) query.lead_id = leadId
    if (search) query.query = search
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/opportunity/`, query, logTag: 'getOpportunitiesDictionary' })
    const items = (res?.data || []).map(o => {
      const amount = o.value_formatted || (o.value ? `$${ o.value }` : '')

      return {
        label: o.note ? `${ amount } — ${ o.note }`.trim() : (amount || o.id),
        value: o.id,
        note: o.status_label ? `Status: ${ o.status_label }` : undefined,
      }
    })
    const nextCursor = res?.has_more ? String((cursor ? Number(cursor) : 0) + items.length) : null

    return { items, cursor: nextCursor }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Smart Views Dictionary
   * @description Lists saved searches / smart views for dropdown selection.
   * @route POST /get-smart-views-dictionary
   * @paramDef {"type":"getSmartViewsDictionary__payload","label":"Payload","name":"payload","description":"Optional name search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Open Leads","value":"save_abc","note":"shared"}],"cursor":null}
   */
  async getSmartViewsDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/saved_search/`, logTag: 'getSmartViewsDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(s => ({ label: s.name, value: s.id, note: s.is_shared ? 'shared' : undefined }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequences Dictionary
   * @description Lists email sequences for selection when subscribing contacts.
   * @route POST /get-sequences-dictionary
   * @paramDef {"type":"getSequencesDictionary__payload","label":"Payload","name":"payload","description":"Optional name search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Cold Outreach v2","value":"seq_abc","note":"3 steps"}],"cursor":null}
   */
  async getSequencesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/sequence/`, logTag: 'getSequencesDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(s => ({ label: s.name, value: s.id, note: s.steps ? `${ s.steps.length } steps` : undefined }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Activity Types Dictionary
   * @description Lists custom activity types defined in the connected organization.
   * @route POST /get-custom-activity-types-dictionary
   * @paramDef {"type":"getCustomActivityTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional name search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Demo Booked","value":"actitype_abc","note":"id: actitype_abc"}],"cursor":null}
   */
  async getCustomActivityTypesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/custom_activity/`, logTag: 'getCustomActivityTypesDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(t => ({ label: t.name, value: t.id, note: `id: ${ t.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields Dictionary
   * @description Lists custom fields defined for a specific Close object type. Set criteria.objectType to one of: lead, contact, opportunity, activity, shared, custom_object.
   * @route POST /get-custom-fields-dictionary
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search, cursor, and criteria (objectType required, customObjectTypeId required when objectType=custom_object)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Industry","value":"cf_abc","note":"text"}],"cursor":null}
   */
  async getCustomFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const objectType = criteria?.objectType
    if (!objectType) return { items: [], cursor: null }

    let url = `${ API_BASE_URL }/custom_field/${ objectType }/`

    if (objectType === 'custom_object') {
      if (!criteria?.customObjectTypeId) return { items: [], cursor: null }
      url = `${ API_BASE_URL }/custom_field_schema/${ criteria.customObjectTypeId }/`
    }

    const res = await this.apiRequest({ url, logTag: 'getCustomFieldsDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(f => ({ label: f.name, value: f.id, note: f.type }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Email Accounts Dictionary
   * @description Lists connected email accounts available for sending. Required when sending email activities.
   * @route POST /get-email-accounts-dictionary
   * @paramDef {"type":"getEmailAccountsDictionary__payload","label":"Payload","name":"payload","description":"Optional email search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"alex@acme.com","value":"emailacct_abc","note":"gmail"}],"cursor":null}
   */
  async getEmailAccountsDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/connected_account/`, logTag: 'getEmailAccountsDictionary' })
    const items = applySearch(res?.data || [], search, ['email', 'identifier'])
      .map(a => ({ label: a.email || a.identifier || a.id, value: a.id, note: a.account_type || a.provider }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Email Templates Dictionary
   * @description Lists email templates for use when sending or drafting emails.
   * @route POST /get-email-templates-dictionary
   * @paramDef {"type":"getEmailTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Optional name search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome","value":"tmpl_abc","note":"id: tmpl_abc"}],"cursor":null}
   */
  async getEmailTemplatesDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/email_template/`, logTag: 'getEmailTemplatesDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(t => ({ label: t.name, value: t.id, note: `id: ${ t.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks Dictionary
   * @description Lists open tasks for selection, optionally restricted to one lead. Use it to pick a task instead of pasting a task ID.
   * @route POST /get-tasks-dictionary
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Optional task text search, cursor, and leadId dependency."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Follow up","value":"task_abc","note":"lead_abc"}],"cursor":null}
   */
  async getTasksDictionary(payload) {
    const { search, criteria } = payload || {}
    const query = { _limit: DEFAULT_PAGE_LIMIT, is_complete: false }
    if (criteria?.leadId) query.lead_id = criteria.leadId

    const res = await this.apiRequest({ url: `${ API_BASE_URL }/task/`, query, logTag: 'getTasksDictionary' })
    const items = applySearch(res?.data || [], search, ['text'])
      .map(t => ({ label: t.text || t.id, value: t.id, note: t.lead_id }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Webhooks Dictionary
   * @description Lists configured webhook subscriptions for selection. Use it to pick a webhook instead of pasting its ID.
   * @route POST /get-webhooks-dictionary
   * @paramDef {"type":"getWebhooksDictionary__payload","label":"Payload","name":"payload","description":"Optional URL search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"https://example.com/hook","value":"whsub_abc","note":"active"}],"cursor":null}
   */
  async getWebhooksDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/webhook/`, logTag: 'getWebhooksDictionary' })
    const items = applySearch(res?.data || [], search, ['url'])
      .map(w => ({ label: w.url || w.id, value: w.id, note: w.status }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Notes Dictionary
   * @description Lists note activities for selection, most recent first. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-notes-dictionary
   * @paramDef {"type":"getNotesDictionary__payload","label":"Payload","name":"payload","description":"Optional note-text search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Follow-up after demo","value":"acti_note_abc","note":"lead_abc"}],"cursor":null}
   */
  async getNotesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (criteria?.leadId) query.lead_id = criteria.leadId
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/activity/note/`, query, logTag: 'getNotesDictionary' })
    const items = applySearch(res?.data || [], search, ['note'])
      .map(n => ({ label: snippet(n.note) || n.id, value: n.id, note: n.lead_id }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calls Dictionary
   * @description Lists call activities for selection, most recent first. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-calls-dictionary
   * @paramDef {"type":"getCallsDictionary__payload","label":"Payload","name":"payload","description":"Optional note/phone search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Outbound call — +15551234567","value":"acti_call_abc","note":"120s"}],"cursor":null}
   */
  async getCallsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (criteria?.leadId) query.lead_id = criteria.leadId
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/activity/call/`, query, logTag: 'getCallsDictionary' })
    const items = applySearch(res?.data || [], search, ['note', 'phone'])
      .map(c => ({
        label: `${ titleCase(c.direction) || 'Call' }${ c.phone ? ` — ${ c.phone }` : '' }`,
        value: c.id,
        note: c.duration != null ? `${ c.duration }s` : c.lead_id,
      }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Emails Dictionary
   * @description Lists email activities for selection by subject, most recent first. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-emails-dictionary
   * @paramDef {"type":"getEmailsDictionary__payload","label":"Payload","name":"payload","description":"Optional subject search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Intro call follow-up","value":"acti_email_abc","note":"sent"}],"cursor":null}
   */
  async getEmailsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (criteria?.leadId) query.lead_id = criteria.leadId
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/activity/email/`, query, logTag: 'getEmailsDictionary' })
    const items = applySearch(res?.data || [], search, ['subject'])
      .map(e => ({ label: e.subject || '(no subject)', value: e.id, note: e.status }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get SMS Dictionary
   * @description Lists SMS activities for selection by message text, most recent first. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-sms-dictionary
   * @paramDef {"type":"getSmsDictionary__payload","label":"Payload","name":"payload","description":"Optional text search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Thanks for hopping on the call!","value":"acti_sms_abc","note":"outbound"}],"cursor":null}
   */
  async getSmsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (criteria?.leadId) query.lead_id = criteria.leadId
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/activity/sms/`, query, logTag: 'getSmsDictionary' })
    const items = applySearch(res?.data || [], search, ['text'])
      .map(s => ({ label: snippet(s.text) || s.id, value: s.id, note: s.direction }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Meetings Dictionary
   * @description Lists meeting activities for selection by title, most recent first. Optionally scoped to a single lead via criteria.leadId.
   * @route POST /get-meetings-dictionary
   * @paramDef {"type":"getMeetingsDictionary__payload","label":"Payload","name":"payload","description":"Optional title search, cursor, and criteria (leadId)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Demo","value":"acti_meet_abc","note":"2025-01-20T15:00:00Z"}],"cursor":null}
   */
  async getMeetingsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    if (criteria?.leadId) query.lead_id = criteria.leadId
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/activity/meeting/`, query, logTag: 'getMeetingsDictionary' })
    const items = applySearch(res?.data || [], search, ['title'])
      .map(m => ({ label: m.title || '(untitled meeting)', value: m.id, note: m.starts_at }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequence Subscriptions Dictionary
   * @description Lists a lead's sequence subscriptions for selection. Requires criteria.leadId — Close only returns subscriptions scoped to a lead, contact, or sequence.
   * @route POST /get-sequence-subscriptions-dictionary
   * @paramDef {"type":"getSequenceSubscriptionsDictionary__payload","label":"Payload","name":"payload","description":"Cursor and criteria (leadId required) to scope the subscriptions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Cold Outreach v2","value":"sub_abc","note":"active"}],"cursor":null}
   */
  async getSequenceSubscriptionsDictionary(payload) {
    const { cursor, criteria } = payload || {}
    const leadId = criteria?.leadId
    if (!leadId) return { items: [], cursor: null }

    const query = { lead_id: leadId, _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/sequence_subscription/`, query, logTag: 'getSequenceSubscriptionsDictionary' })
    const items = (res?.data || []).map(s => ({
      label: s.sequence_name || s.sequence_id || s.id,
      value: s.id,
      note: s.status,
    }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bulk Actions Dictionary
   * @description Lists bulk action jobs of a given kind for selection. Set criteria.kind to one of: edit, delete, email.
   * @route POST /get-bulk-actions-dictionary
   * @paramDef {"type":"getBulkActionsDictionary__payload","label":"Payload","name":"payload","description":"Cursor and criteria (kind required: edit, delete, or email)."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"set_lead_status — complete","value":"bulkact_abc","note":"complete"}],"cursor":null}
   */
  async getBulkActionsDictionary(payload) {
    const { cursor, criteria } = payload || {}
    const kind = this.#resolveChoice(criteria?.kind, CHOICE_MAPS.bulkActionKind)
    if (!kind) return { items: [], cursor: null }

    const query = { _limit: 50, _skip: cursor ? Number(cursor) : 0 }
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/bulk_action/${ kind }/`, query, logTag: 'getBulkActionsDictionary' })
    const items = (res?.data || []).map(b => ({
      label: `${ b.type || kind }${ b.status ? ` — ${ b.status }` : '' }`,
      value: b.id,
      note: b.date_created,
    }))

    return { items, cursor: nextCursorFrom(res, cursor) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Custom Fields Dictionary
   * @description Lists custom fields defined on the Lead object — use it to pick a field to set or clear in a bulk lead edit.
   * @route POST /get-lead-custom-fields-dictionary
   * @paramDef {"type":"getLeadCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Optional field-name search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Industry","value":"cf_abc","note":"text"}],"cursor":null}
   */
  async getLeadCustomFieldsDictionary(payload) {
    const { search } = payload || {}
    const res = await this.apiRequest({ url: `${ API_BASE_URL }/custom_field/lead/`, logTag: 'getLeadCustomFieldsDictionary' })
    const items = applySearch(res?.data || [], search, ['name'])
      .map(f => ({ label: f.name, value: f.id, note: f.type }))

    return { items, cursor: null }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — Sample Result Loaders
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /runAdvancedSearch_SampleResultLoader
   * @param {Object} payload
   * @returns {Object}
   */
  async runAdvancedSearch_SampleResultLoader({ criteria } = {}) {
    const objectType = criteria?.objectType || 'lead'

    if (objectType === 'opportunity') {
      return { data: [{ id: 'oppo_abc', value: 5000, value_formatted: '$5,000', status_label: 'Active', lead_id: 'lead_abc' }], cursor: null }
    }

    if (objectType === 'contact') {
      return { data: [{ id: 'cont_abc', name: 'Jane Doe', lead_id: 'lead_abc', emails: [{ email: 'jane@acme.com', type: 'office' }] }], cursor: null }
    }

    return { data: [{ id: 'lead_abc', display_name: 'Acme Inc.', status_label: 'Qualified' }], cursor: null }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — Leads
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Leads
   * @category Leads
   * @description Lists leads with optional free-text Smart View query, pagination, and field selection. Use the `query` parameter for Close's powerful filtering syntax (e.g., `status_label:"Qualified" date_created>=last_30_days`).
   * @route POST /list-leads
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional Close query string (Smart View syntax). Examples: 'status_label:\"Qualified\"', 'company:Acme'. Leave empty to list all."}
   * @paramDef {"type":"Array.<String>","label":"Fields","name":"fields","description":"Optional list of field names to return. Reduces payload size."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size (default 100, max 200)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for offset pagination. Close caps deep paging around 10000; use Advanced Search for deeper walks."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"When true, walks pages automatically up to the maxPages cap."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Hard cap when fetchAll is true (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"lead_abc","display_name":"Acme Inc.","status_label":"Qualified","contacts":[]}],"has_more":false,"total_results":1}
   */
  async listLeads(query, fields, limit, skip, fetchAll, maxPages) {
    const baseQuery = { _limit: limit || DEFAULT_PAGE_LIMIT }
    if (query) baseQuery.query = query
    if (fields && fields.length) baseQuery._fields = toArray(fields).join(',')

    if (fetchAll) {
      const all = await paginateOffset(
        params => this.apiRequest({ url: `${ API_BASE_URL }/lead/`, query: { ...baseQuery, ...params }, logTag: 'listLeads' }),
        { limit: limit || DEFAULT_PAGE_LIMIT, maxPages: maxPages || MAX_PAGES_DEFAULT }
      )

      return { data: all, has_more: false, total_results: all.length }
    }

    baseQuery._skip = skip || 0

    return this.apiRequest({ url: `${ API_BASE_URL }/lead/`, query: baseQuery, logTag: 'listLeads' })
  }

  /**
   * @operationName Get Lead
   * @category Leads
   * @description Fetches a single lead by ID, including its contacts, opportunities, and custom field values.
   * @route POST /get-lead
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to retrieve."}
   * @paramDef {"type":"Array.<String>","label":"Fields","name":"fields","description":"Optional list of fields to limit the response payload."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lead_abc","display_name":"Acme Inc.","status_label":"Qualified","contacts":[{"id":"cont_abc","name":"Jane Doe"}],"opportunities":[]}
   */
  async getLead(leadId, fields) {
    const query = fields && fields.length ? { _fields: toArray(fields).join(',') } : undefined

    return this.apiRequest({ url: `${ API_BASE_URL }/lead/${ leadId }/`, query, logTag: 'getLead' })
  }

  /**
   * @operationName Create Lead
   * @category Leads
   * @description Creates a new lead with optional inline contacts, addresses, status, and custom field values. Pass contacts as objects with name/title/emails/phones.
   * @route POST /create-lead
   *
   * @paramDef {"type":"String","label":"Company Name","name":"name","description":"Company / lead display name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form lead description."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Primary website URL of the lead."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Lead status ID. Leave empty to use the default 'Potential' status."}
   * @paramDef {"type":"Array.<CloseContact>","label":"Contacts","name":"contacts","description":"Optional inline contacts. Each: { name, title, emails:[{email,type}], phones:[{phone,type}] }."}
   * @paramDef {"type":"Array.<CloseAddress>","label":"Addresses","name":"addresses","description":"Optional postal addresses."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Optional map of custom field IDs to values. Find the IDs by running Get Custom Fields Dictionary and picking the right object type. Example: { \"abcd1234\": \"High\" }."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lead_abc","display_name":"Acme Inc.","status_label":"Potential","contacts":[{"id":"cont_abc","name":"Jane Doe"}]}
   */
  async createLead(name, description, url, statusId, contacts, addresses, customFields) {
    const body = deepClean({
      name,
      description,
      url,
      status_id: statusId,
      contacts,
      addresses,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/lead/`, method: 'post', body, logTag: 'createLead' })
  }

  /**
   * @operationName Update Lead
   * @category Leads
   * @description Updates a lead. Only sent fields change (partial update via PUT). Set status by name with statusLabel or by ID with statusId.
   * @route POST /update-lead
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to update."}
   * @paramDef {"type":"String","label":"Company Name","name":"name","description":"New display name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"New primary URL."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"New lead status ID."}
   * @paramDef {"type":"String","label":"Status Label","name":"statusLabel","description":"Alternative to statusId: pass status label text (e.g., 'Qualified')."}
   * @paramDef {"type":"Array.<CloseAddress>","label":"Addresses","name":"addresses","description":"Replace postal addresses."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Map of custom field IDs to new values. Find the IDs via Get Custom Fields Dictionary. Pass null for a field to clear its value."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lead_abc","display_name":"Acme Inc.","status_label":"Qualified"}
   */
  async updateLead(leadId, name, description, url, statusId, statusLabel, addresses, customFields) {
    const body = deepClean({
      name,
      description,
      url,
      status_id: statusId,
      status_label: statusLabel,
      addresses,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/lead/${ leadId }/`, method: 'put', body, logTag: 'updateLead' })
  }

  /**
   * @operationName Delete Lead
   * @category Leads
   * @description Permanently deletes a lead and all its activities/opportunities. This action cannot be undone.
   * @route POST /delete-lead
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"lead_abc"}
   */
  async deleteLead(leadId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/lead/${ leadId }/`, method: 'delete', logTag: 'deleteLead' })

    return { status: 'deleted', id: leadId }
  }

  /**
   * @operationName Merge Leads
   * @category Leads
   * @description Merges a source lead into a destination lead, combining all contacts, activities, and opportunities. The source lead is deleted.
   * @route POST /merge-leads
   *
   * @paramDef {"type":"String","label":"Source Lead","name":"sourceLeadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to merge from (will be deleted)."}
   * @paramDef {"type":"String","label":"Destination Lead","name":"destinationLeadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to merge into (kept)."}
   *
   * @returns {Object}
   * @sampleResult {"status":"merged","destination":"lead_def"}
   */
  async mergeLeads(sourceLeadId, destinationLeadId) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/lead/merge/`,
      method: 'post',
      body: { source: sourceLeadId, destination: destinationLeadId },
      logTag: 'mergeLeads',
    })
  }

  /**
   * @operationName Find Lead by Email
   * @category Leads
   * @description Searches leads by an email address present on any contact. Returns the first matching lead or null.
   * @route POST /find-lead-by-email
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address to search for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lead_abc","display_name":"Acme Inc.","status_label":"Qualified"}
   */
  async findLeadByEmail(email) {
    const res = await this.apiRequest({
      url: `${ API_BASE_URL }/lead/`,
      query: { query: `email:${ email }`, _limit: 1 },
      logTag: 'findLeadByEmail',
    })

    return res?.data?.[0] || null
  }

  /**
   * @operationName Find Lead by Phone
   * @category Leads
   * @description Searches leads by a phone number present on any contact. Returns the first matching lead or null.
   * @route POST /find-lead-by-phone
   *
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":true,"description":"Phone number to search by. Include the country code (e.g., +15551234567)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lead_abc","display_name":"Acme Inc."}
   */
  async findLeadByPhone(phone) {
    const res = await this.apiRequest({
      url: `${ API_BASE_URL }/lead/`,
      query: { query: `phone:${ phone }`, _limit: 1 },
      logTag: 'findLeadByPhone',
    })

    return res?.data?.[0] || null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — Contacts
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts, optionally scoped to a single lead. Supports the same query / pagination as List Leads.
   * @route POST /list-contacts
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead to restrict contacts to."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size (default 100, max 200)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"cont_abc","name":"Jane Doe","emails":[{"email":"jane@acme.com"}]}],"has_more":false}
   */
  async listContacts(leadId, query, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/contact/`,
      query: { lead_id: leadId, query, _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listContacts',
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID with all emails, phones, and URLs.
   * @route POST /get-contact
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cont_abc","name":"Jane Doe","lead_id":"lead_abc","emails":[{"email":"jane@acme.com","type":"office"}],"phones":[]}
   */
  async getContact(contactId) {
    return this.apiRequest({ url: `${ API_BASE_URL }/contact/${ contactId }/`, logTag: 'getContact' })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a contact under an existing lead with emails, phones, URLs, and optional custom fields.
   * @route POST /create-contact
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead the contact belongs to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full contact name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Job title."}
   * @paramDef {"type":"Array.<Object>","label":"Emails","name":"emails","description":"Email entries. Each: { email, type: 'office'|'mobile'|'home'|'direct'|'other' }."}
   * @paramDef {"type":"Array.<Object>","label":"Phones","name":"phones","description":"Phone entries. Each: { phone, type }."}
   * @paramDef {"type":"Array.<Object>","label":"URLs","name":"urls","description":"URL entries. Each: { url, type }."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Map of custom field IDs to values (without 'custom.' prefix)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cont_abc","name":"Jane Doe","lead_id":"lead_abc","emails":[{"email":"jane@acme.com","type":"office"}]}
   */
  async createContact(leadId, name, title, emails, phones, urls, customFields) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads, then create the contact under it.')
    if (!name) throw new Error('Name is required — provide the contact\'s full name.')

    const body = deepClean({
      lead_id: leadId,
      name,
      title,
      emails,
      phones,
      urls,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/contact/`, method: 'post', body, logTag: 'createContact' })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates a contact. Only sent fields change. Emails / phones / URLs arrays REPLACE existing values when provided.
   * @route POST /update-contact
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"Array.<Object>","label":"Emails","name":"emails","description":"Replace emails array."}
   * @paramDef {"type":"Array.<Object>","label":"Phones","name":"phones","description":"Replace phones array."}
   * @paramDef {"type":"Array.<Object>","label":"URLs","name":"urls","description":"Replace URLs array."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Map of custom field IDs to values. Find IDs via Get Custom Fields Dictionary."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cont_abc","name":"Jane Doe","title":"VP Sales"}
   */
  async updateContact(contactId, name, title, emails, phones, urls, customFields) {
    const body = deepClean({
      name,
      title,
      emails,
      phones,
      urls,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/contact/${ contactId }/`, method: 'put', body, logTag: 'updateContact' })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact from its lead.
   * @route POST /delete-contact
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"cont_abc"}
   */
  async deleteContact(contactId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/contact/${ contactId }/`, method: 'delete', logTag: 'deleteContact' })

    return { status: 'deleted', id: contactId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — Opportunities
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Opportunities
   * @category Opportunities
   * @description Lists opportunities with optional lead / pipeline / status filters and pagination.
   * @route POST /list-opportunities
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Optional pipeline filter."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getOpportunityStatusesDictionary","description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Status Type","name":"statusType","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Won","Lost"]}},"description":"Optional filter by status family (active, won, or lost)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size (default 100)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"oppo_abc","value":5000,"status_label":"Active","lead_id":"lead_abc"}],"has_more":false}
   */
  async listOpportunities(leadId, pipelineId, statusId, statusType, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/opportunity/`,
      query: {
        lead_id: leadId,
        pipeline_id: pipelineId,
        status_id: statusId,
        status_type: this.#resolveChoice(statusType, CHOICE_MAPS.opportunityStatusType),
        _limit: limit || DEFAULT_PAGE_LIMIT,
        _skip: skip || 0,
      },
      logTag: 'listOpportunities',
    })
  }

  /**
   * @operationName Get Opportunity
   * @category Opportunities
   * @description Retrieves a single opportunity by ID, including its status and value details.
   * @route POST /get-opportunity
   *
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"oppo_abc","value":5000,"value_formatted":"$5,000","status_label":"Active","lead_id":"lead_abc"}
   */
  async getOpportunity(opportunityId) {
    return this.apiRequest({ url: `${ API_BASE_URL }/opportunity/${ opportunityId }/`, logTag: 'getOpportunity' })
  }

  /**
   * @operationName Create Opportunity
   * @category Opportunities
   * @description Creates an opportunity on a lead with value, status, and optional confidence / expected-close date.
   * @route POST /create-opportunity
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead to attach the opportunity to."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","required":true,"dictionary":"getOpportunityStatusesDictionary","description":"Initial status."}
   * @paramDef {"type":"Number","label":"Value","name":"value","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value in cents (Close stores money as integer cents)."}
   * @paramDef {"type":"String","label":"Value Currency","name":"valueCurrency","description":"Three-letter currency code (USD, EUR, GBP, etc.). Defaults to your organization's currency, usually USD."}
   * @paramDef {"type":"String","label":"Value Period","name":"valuePeriod","uiComponent":{"type":"DROPDOWN","options":{"values":["One-Time","Monthly","Annual"]}},"description":"Recurrence."}
   * @paramDef {"type":"Number","label":"Confidence","name":"confidence","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Confidence 0-100."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form note."}
   * @paramDef {"type":"String","label":"Expected Close","name":"dateWon","uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date (YYYY-MM-DD)."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Map of custom field IDs to values. Find IDs via Get Custom Fields Dictionary."}
   *
   * @returns {Object}
   * @sampleResult {"id":"oppo_abc","value":500000,"value_formatted":"$5,000","status_label":"Active","lead_id":"lead_abc"}
   */
  async createOpportunity(leadId, statusId, value, valueCurrency, valuePeriod, confidence, note, dateWon, customFields) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads to create the opportunity under it.')

    const body = deepClean({
      lead_id: leadId,
      status_id: statusId,
      value,
      value_currency: valueCurrency,
      value_period: this.#resolveChoice(valuePeriod, CHOICE_MAPS.valuePeriod),
      confidence,
      note,
      date_won: dateWon,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/opportunity/`, method: 'post', body, logTag: 'createOpportunity' })
  }

  /**
   * @operationName Update Opportunity
   * @category Opportunities
   * @description Updates an opportunity. Only sent fields change. Move it through the pipeline by setting statusId.
   * @route POST /update-opportunity
   *
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to update."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getOpportunityStatusesDictionary","description":"New status."}
   * @paramDef {"type":"Number","label":"Value","name":"value","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value in cents."}
   * @paramDef {"type":"String","label":"Value Currency","name":"valueCurrency","description":"Three-letter currency code (USD, EUR, GBP, etc.)."}
   * @paramDef {"type":"String","label":"Value Period","name":"valuePeriod","uiComponent":{"type":"DROPDOWN","options":{"values":["One-Time","Monthly","Annual"]}},"description":"Recurrence."}
   * @paramDef {"type":"Number","label":"Confidence","name":"confidence","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Confidence 0-100."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New note."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","freeform":true,"description":"Map of custom field IDs to values. Find IDs via Get Custom Fields Dictionary."}
   *
   * @returns {Object}
   * @sampleResult {"id":"oppo_abc","status_label":"Won","value":750000}
   */
  async updateOpportunity(opportunityId, statusId, value, valueCurrency, valuePeriod, confidence, note, customFields) {
    const body = deepClean({
      status_id: statusId,
      value,
      value_currency: valueCurrency,
      value_period: this.#resolveChoice(valuePeriod, CHOICE_MAPS.valuePeriod),
      confidence,
      note,
      ...this.#expandCustomFields(customFields),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/opportunity/${ opportunityId }/`, method: 'put', body, logTag: 'updateOpportunity' })
  }

  /**
   * @operationName Delete Opportunity
   * @category Opportunities
   * @description Permanently deletes an opportunity.
   * @route POST /delete-opportunity
   *
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"oppo_abc"}
   */
  async deleteOpportunity(opportunityId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/opportunity/${ opportunityId }/`, method: 'delete', logTag: 'deleteOpportunity' })

    return { status: 'deleted', id: opportunityId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — Activities: Notes
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Notes
   * @category Notes
   * @description Lists note activities, optionally filtered by lead.
   * @route POST /list-notes
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_abc","note":"Followup next week","lead_id":"lead_abc"}],"has_more":false}
   */
  async listNotes(leadId, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/note/`,
      query: { lead_id: leadId, _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listNotes',
    })
  }

  /**
   * @operationName Create Note
   * @category Notes
   * @description Creates a note on a lead. Notes appear in the lead's activity timeline.
   * @route POST /create-note
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead to attach the note to."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note text (plain text or HTML)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_abc","note":"Followup next week","lead_id":"lead_abc"}
   */
  async createNote(leadId, note) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads to attach the note to it.')

    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/note/`,
      method: 'post',
      body: { lead_id: leadId, note },
      logTag: 'createNote',
    })
  }

  /**
   * @operationName Update Note
   * @category Notes
   * @description Updates an existing note's text.
   * @route POST /update-note
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The note's ID, returned by Create Note or visible in the Close URL when viewing a note."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New note text."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_abc","note":"Updated text","lead_id":"lead_abc"}
   */
  async updateNote(noteId, note) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/note/${ noteId }/`,
      method: 'put',
      body: { note },
      logTag: 'updateNote',
    })
  }

  /**
   * @operationName Delete Note
   * @category Notes
   * @description Permanently removes a note from the lead timeline.
   * @route POST /delete-note
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The note's ID, returned by Create Note."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"acti_abc"}
   */
  async deleteNote(noteId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/activity/note/${ noteId }/`, method: 'delete', logTag: 'deleteNote' })

    return { status: 'deleted', id: noteId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9 — Activities: Calls
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Calls
   * @category Calls
   * @description Lists call activities (Twilio-dialed or manually logged), optionally filtered by lead or direction.
   * @route POST /list-calls
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Optional direction filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_call_abc","direction":"outbound","duration":120,"lead_id":"lead_abc"}],"has_more":false}
   */
  async listCalls(leadId, direction, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/call/`,
      query: { lead_id: leadId, direction: this.#resolveChoice(direction, CHOICE_MAPS.callDirection), _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listCalls',
    })
  }

  /**
   * @operationName Log Call
   * @category Calls
   * @description Logs a call activity on a lead (does NOT actually dial — for that, use the Close in-app dialer). Useful for recording calls handled outside Close.
   * @route POST /log-call
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead the call is logged on."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["leadId"],"description":"Optional contact the call was with."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Call direction."}
   * @paramDef {"type":"Number","label":"Duration (seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Call length in seconds."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number called from / to."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Call notes / summary."}
   * @paramDef {"type":"String","label":"Recording URL","name":"recordingUrl","description":"Optional URL to an external call recording."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_call_abc","direction":"outbound","duration":120,"note":"Discussed pricing","lead_id":"lead_abc"}
   */
  async logCall(leadId, contactId, direction, duration, phone, note, recordingUrl) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads to log the call against it.')

    const body = deepClean({
      lead_id: leadId,
      contact_id: contactId,
      direction: this.#resolveChoice(direction, CHOICE_MAPS.callDirection),
      duration,
      phone,
      note,
      recording_url: recordingUrl,
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/activity/call/`, method: 'post', body, logTag: 'logCall' })
  }

  /**
   * @operationName Update Call
   * @category Calls
   * @description Updates a logged call's note, duration, or recording URL.
   * @route POST /update-call
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"dictionary":"getCallsDictionary","description":"The call's ID, returned by Log Call or found in the call's URL."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New note."}
   * @paramDef {"type":"Number","label":"Duration (seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated duration."}
   * @paramDef {"type":"String","label":"Recording URL","name":"recordingUrl","description":"Updated recording URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_call_abc","note":"Updated","duration":180}
   */
  async updateCall(callId, note, duration, recordingUrl) {
    const body = deepClean({ note, duration, recording_url: recordingUrl })

    return this.apiRequest({ url: `${ API_BASE_URL }/activity/call/${ callId }/`, method: 'put', body, logTag: 'updateCall' })
  }

  /**
   * @operationName Delete Call
   * @category Calls
   * @description Permanently removes a call activity record.
   * @route POST /delete-call
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"dictionary":"getCallsDictionary","description":"The call's ID, returned by Log Call."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"acti_call_abc"}
   */
  async deleteCall(callId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/activity/call/${ callId }/`, method: 'delete', logTag: 'deleteCall' })

    return { status: 'deleted', id: callId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10 — Activities: Emails
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Emails
   * @category Emails
   * @description Lists email activities, optionally filtered by lead.
   * @route POST /list-emails
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_email_abc","subject":"Hi","status":"sent","lead_id":"lead_abc"}],"has_more":false}
   */
  async listEmails(leadId, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/email/`,
      query: { lead_id: leadId, _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listEmails',
    })
  }

  /**
   * @operationName Send Email
   * @category Emails
   * @description Sends an email through a connected email account, OR logs/drafts an email without sending. Set `status` to `outbox` to actually send, `draft` to save as draft, `sent`/`inbox` to log a previously-sent email.
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead the email belongs to."}
   * @paramDef {"type":"String","label":"Email Account","name":"emailAccountId","dictionary":"getEmailAccountsDictionary","description":"Connected email account to send from. Required when status=outbox. Falls back to service config defaultEmailAccountId."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Send Now (Outbox)","Save as Draft","Log as Sent","Log as Received","Schedule for Later"]}},"description":"`outbox` = send now; `draft` = save draft; `sent`/`inbox` = log a previously-sent email; `scheduled` = schedule for later (needs date_scheduled)."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["leadId"],"description":"Optional contact to associate."}
   * @paramDef {"type":"Array.<String>","label":"To","name":"toAddresses","required":true,"description":"Recipient email addresses."}
   * @paramDef {"type":"Array.<String>","label":"CC","name":"ccAddresses","description":"CC recipients."}
   * @paramDef {"type":"Array.<String>","label":"BCC","name":"bccAddresses","description":"BCC recipients."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject."}
   * @paramDef {"type":"String","label":"Plain Body","name":"bodyText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body."}
   * @paramDef {"type":"String","label":"HTML Body","name":"bodyHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body. If both bodyText and bodyHtml are given, HTML is preferred."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","dictionary":"getEmailTemplatesDictionary","description":"Optional template ID to render."}
   * @paramDef {"type":"String","label":"Schedule For","name":"dateScheduled","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When to send the email. Required when status is 'scheduled'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_email_abc","status":"sent","subject":"Hi","lead_id":"lead_abc","to":["jane@acme.com"]}
   */
  async sendEmail(leadId, emailAccountId, status, contactId, toAddresses, ccAddresses, bccAddresses, subject, bodyText, bodyHtml, templateId, dateScheduled) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads to attach the email to it.')

    const account = emailAccountId || this.defaultEmailAccountId
    const effectiveStatus = this.#resolveChoice(status, CHOICE_MAPS.emailStatus) || 'outbox'

    if (effectiveStatus === 'outbox' && !account) {
      throw new Error('Email Account is required when status is "outbox" — pick a connected account via Get Email Accounts, or set a default in service config.')
    }

    if (effectiveStatus === 'scheduled' && !dateScheduled) {
      throw new Error('Schedule For is required when status is "scheduled" — provide the date/time to send.')
    }

    const body = deepClean({
      lead_id: leadId,
      contact_id: contactId,
      user_id: undefined,
      status: effectiveStatus,
      email_account_id: account,
      to: toArray(toAddresses),
      cc: toArray(ccAddresses),
      bcc: toArray(bccAddresses),
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      template_id: templateId,
      date_scheduled: dateScheduled,
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/activity/email/`, method: 'post', body, logTag: 'sendEmail' })
  }

  /**
   * @operationName Delete Email
   * @category Emails
   * @description Permanently removes an email activity (drafts or logged emails). Sent emails are removed from the Close timeline only.
   * @route POST /delete-email
   *
   * @paramDef {"type":"String","label":"Email ID","name":"emailId","required":true,"dictionary":"getEmailsDictionary","description":"The email activity ID, returned by Send Email or visible on the email in the Close timeline."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"acti_email_abc"}
   */
  async deleteEmail(emailId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/activity/email/${ emailId }/`, method: 'delete', logTag: 'deleteEmail' })

    return { status: 'deleted', id: emailId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11 — Activities: SMS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List SMS
   * @category SMS
   * @description Lists SMS activities, optionally filtered by lead.
   * @route POST /list-sms
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_sms_abc","direction":"outbound","text":"Hi","lead_id":"lead_abc"}],"has_more":false}
   */
  async listSMS(leadId, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/sms/`,
      query: { lead_id: leadId, _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listSMS',
    })
  }

  /**
   * @operationName Send SMS
   * @category SMS
   * @description Sends an SMS (status `outbox`) or logs an SMS (`sent`/`inbox`) on a lead. Sending requires a Close phone number provisioned for the org.
   * @route POST /send-sms
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead the SMS belongs to."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Send Now (Outbox)","Log as Sent","Log as Received","Save as Draft"]}},"description":"`outbox` to send live; `sent`/`inbox` to log; `draft` to save."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["leadId"],"description":"Optional contact ID."}
   * @paramDef {"type":"String","label":"From","name":"localPhone","description":"Your Close-provisioned sender phone number. Include the country code (e.g., +15551234567)."}
   * @paramDef {"type":"String","label":"To","name":"remotePhone","required":true,"description":"Recipient phone number. Include the country code (e.g., +15551234567)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message body (Close supports MMS-length up to 1600 chars; gateway will segment)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_sms_abc","status":"sent","direction":"outbound","text":"Hi","lead_id":"lead_abc"}
   */
  async sendSMS(leadId, status, contactId, localPhone, remotePhone, text) {
    const body = deepClean({
      lead_id: leadId,
      contact_id: contactId,
      status: this.#resolveChoice(status, CHOICE_MAPS.smsStatus) || 'outbox',
      local_phone: localPhone,
      remote_phone: remotePhone,
      text,
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/activity/sms/`, method: 'post', body, logTag: 'sendSMS' })
  }

  /**
   * @operationName Delete SMS
   * @category SMS
   * @description Permanently removes an SMS activity.
   * @route POST /delete-sms
   *
   * @paramDef {"type":"String","label":"SMS ID","name":"smsId","required":true,"dictionary":"getSmsDictionary","description":"The SMS activity ID, returned by Send SMS."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"acti_sms_abc"}
   */
  async deleteSMS(smsId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/activity/sms/${ smsId }/`, method: 'delete', logTag: 'deleteSMS' })

    return { status: 'deleted', id: smsId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12 — Activities: Meetings
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Meetings
   * @category Meetings
   * @description Lists meeting activities, optionally filtered by lead. Meetings are typically created via Calendar integrations.
   * @route POST /list-meetings
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_meet_abc","title":"Demo","starts_at":"2025-01-20T15:00:00Z","lead_id":"lead_abc"}],"has_more":false}
   */
  async listMeetings(leadId, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/meeting/`,
      query: { lead_id: leadId, _limit: limit || DEFAULT_PAGE_LIMIT, _skip: skip || 0 },
      logTag: 'listMeetings',
    })
  }

  /**
   * @operationName Get Meeting
   * @category Meetings
   * @description Retrieves a single meeting activity with attendees and conference URL details.
   * @route POST /get-meeting
   *
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting ID, visible on the meeting in the Close timeline."}
   *
   * @returns {Object}
   * @sampleResult {"id":"acti_meet_abc","title":"Demo","starts_at":"2025-01-20T15:00:00Z","attendees":[]}
   */
  async getMeeting(meetingId) {
    return this.apiRequest({ url: `${ API_BASE_URL }/activity/meeting/${ meetingId }/`, logTag: 'getMeeting' })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13 — Tasks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks with filters for assignee, lead, completion state, type, and date window.
   * @route POST /list-tasks
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedToId","dictionary":"getUsersDictionary","description":"Optional assignee filter."}
   * @paramDef {"type":"Boolean","label":"Is Completed","name":"isComplete","uiComponent":{"type":"TOGGLE"},"description":"Filter by completion state."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Missed Call","Incoming Email","Answered Detached Call","Voicemail","Email Follow-Up"]}},"description":"Optional task type filter."}
   * @paramDef {"type":"String","label":"Due After","name":"dateAfter","uiComponent":{"type":"DATE_PICKER"},"description":"Earliest due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Due Before","name":"dateBefore","uiComponent":{"type":"DATE_PICKER"},"description":"Latest due date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"task_abc","text":"Follow up","is_complete":false,"lead_id":"lead_abc"}],"has_more":false}
   */
  async listTasks(leadId, assignedToId, isComplete, type, dateAfter, dateBefore, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/task/`,
      query: {
        lead_id: leadId,
        assigned_to: assignedToId,
        is_complete: isComplete,
        _type: this.#resolveChoice(type, CHOICE_MAPS.taskType),
        date_after: dateAfter,
        date_before: dateBefore,
        _limit: limit || DEFAULT_PAGE_LIMIT,
        _skip: skip || 0,
      },
      logTag: 'listTasks',
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a lead task with optional due date and assignee.
   * @route POST /create-task
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"Lead the task belongs to."}
   * @paramDef {"type":"String","label":"Task Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Task description."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedToId","dictionary":"getUsersDictionary","description":"User to assign the task to. Defaults to current user."}
   * @paramDef {"type":"String","label":"Due Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Due date (YYYY-MM-DD)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"task_abc","text":"Follow up","is_complete":false,"lead_id":"lead_abc"}
   */
  async createTask(leadId, text, assignedToId, date) {
    if (!leadId) throw new Error('Lead is required — pick one via Get Leads to create the task under it.')
    if (!text) throw new Error('Task Text is required — describe what needs to be done.')

    const body = deepClean({ lead_id: leadId, text, assigned_to: assignedToId, date, _type: 'lead' })

    return this.apiRequest({ url: `${ API_BASE_URL }/task/`, method: 'post', body, logTag: 'createTask' })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates a task's text, due date, assignee, or completion state.
   * @route POST /update-task
   *
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to act on. Pick from open tasks, or paste a task ID returned by Create Task."}
   * @paramDef {"type":"String","label":"Task Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New text."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedToId","dictionary":"getUsersDictionary","description":"New assignee."}
   * @paramDef {"type":"String","label":"Due Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"New due date (YYYY-MM-DD)."}
   * @paramDef {"type":"Boolean","label":"Is Completed","name":"isComplete","uiComponent":{"type":"TOGGLE"},"description":"Mark complete / incomplete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"task_abc","text":"Updated","is_complete":true}
   */
  async updateTask(taskId, text, assignedToId, date, isComplete) {
    const body = deepClean({ text, assigned_to: assignedToId, date, is_complete: isComplete })

    return this.apiRequest({ url: `${ API_BASE_URL }/task/${ taskId }/`, method: 'put', body, logTag: 'updateTask' })
  }

  /**
   * @operationName Complete Task
   * @category Tasks
   * @description Shortcut for marking a task complete.
   * @route POST /complete-task
   *
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to act on. Pick from open tasks, or paste a task ID returned by Create Task."}
   *
   * @returns {Object}
   * @sampleResult {"id":"task_abc","is_complete":true}
   */
  async completeTask(taskId) {
    return this.apiRequest({ url: `${ API_BASE_URL }/task/${ taskId }/`, method: 'put', body: { is_complete: true }, logTag: 'completeTask' })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task.
   * @route POST /delete-task
   *
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to act on. Pick from open tasks, or paste a task ID returned by Create Task."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"task_abc"}
   */
  async deleteTask(taskId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/task/${ taskId }/`, method: 'delete', logTag: 'deleteTask' })

    return { status: 'deleted', id: taskId }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14 — Combined activity feed
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Activities
   * @category Activity Feed
   * @description Lists all activities (note, call, email, sms, meeting, task_completed, etc.) in chronological order, optionally filtered by lead and type.
   * @route POST /list-activities
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional lead filter."}
   * @paramDef {"type":"String","label":"Activity Type","name":"activityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Note","Call","Email","SMS","Meeting","Task Completed","Lead Status Change","Opportunity Status Change","Created"]}},"description":"Optional type filter."}
   * @paramDef {"type":"String","label":"Date After","name":"dateAfter","uiComponent":{"type":"DATE_PICKER"},"description":"Earliest activity date."}
   * @paramDef {"type":"String","label":"Date Before","name":"dateBefore","uiComponent":{"type":"DATE_PICKER"},"description":"Latest activity date."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records to skip."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"acti_abc","_type":"Note","note":"Hello","lead_id":"lead_abc"}],"has_more":false}
   */
  async listActivities(leadId, activityType, dateAfter, dateBefore, limit, skip) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/activity/`,
      query: {
        lead_id: leadId,
        _type: this.#resolveChoice(activityType, CHOICE_MAPS.activityType),
        date_created__gte: dateAfter,
        date_created__lte: dateBefore,
        _limit: limit || DEFAULT_PAGE_LIMIT,
        _skip: skip || 0,
      },
      logTag: 'listActivities',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 15 — Custom Fields, Pipelines, Statuses (read helpers)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Pipelines
   * @category Configuration
   * @description Lists opportunity pipelines defined in the org, including all statuses and their order.
   * @route POST /list-pipelines
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"pipe_abc","name":"Sales","statuses":[{"id":"stat_a","label":"Active"}]}]}
   */
  async listPipelines() {
    return this.apiRequest({ url: `${ API_BASE_URL }/pipeline/`, logTag: 'listPipelines' })
  }

  /**
   * @operationName List Lead Statuses
   * @category Configuration
   * @description Lists all lead statuses configured in the org.
   * @route POST /list-lead-statuses
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"stat_xyz","label":"Qualified"}]}
   */
  async listLeadStatuses() {
    return this.apiRequest({ url: `${ API_BASE_URL }/status/lead/`, logTag: 'listLeadStatuses' })
  }

  /**
   * @operationName List Opportunity Statuses
   * @category Configuration
   * @description Lists all opportunity statuses configured in the org, grouped by status type (active/won/lost).
   * @route POST /list-opportunity-statuses
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"stat_oppA","label":"Won","status_type":"won"}]}
   */
  async listOpportunityStatuses() {
    return this.apiRequest({ url: `${ API_BASE_URL }/status/opportunity/`, logTag: 'listOpportunityStatuses' })
  }

  /**
   * @operationName List Custom Fields
   * @category Configuration
   * @description Lists custom field definitions for a given object type (lead, contact, opportunity, activity, shared). Use this to map external field names to Close custom field IDs (`cf_*`).
   * @route POST /list-custom-fields
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Contact","Opportunity","Activity","Shared"]}},"description":"The object type to list custom fields for."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"cf_abc","name":"Industry","type":"text"}]}
   */
  async listCustomFields(objectType) {
    const resolvedType = this.#resolveChoice(objectType, CHOICE_MAPS.customFieldObjectType)

    return this.apiRequest({ url: `${ API_BASE_URL }/custom_field/${ resolvedType }/`, logTag: 'listCustomFields' })
  }

  /**
   * @operationName List Custom Object Types
   * @category Configuration
   * @description Lists custom object types defined in the org (Close's flexible structured-data feature).
   * @route POST /list-custom-object-types
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"cot_abc","name":"Subscription"}]}
   */
  async listCustomObjectTypes() {
    return this.apiRequest({ url: `${ API_BASE_URL }/custom_object_type/`, logTag: 'listCustomObjectTypes' })
  }

  /**
   * @operationName Get Me
   * @category Users
   * @description Returns information about the currently connected user, including their organizations.
   * @route POST /get-me
   *
   * @returns {Object}
   * @sampleResult {"id":"user_abc","email":"alex@acme.com","display_name":"Alex Doe","organizations":[{"id":"orga_abc","name":"Acme Sales"}]}
   */
  async getMe() {
    return this.apiRequest({ url: `${ API_BASE_URL }/me/`, logTag: 'getMe' })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists active users in the connected organization.
   * @route POST /list-users
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"user_abc","email":"alex@acme.com","display_name":"Alex Doe"}]}
   */
  async listUsers() {
    return this.apiRequest({ url: `${ API_BASE_URL }/user/`, logTag: 'listUsers' })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 16 — Search / Smart Views
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Run Advanced Search
   * @category Search
   * @description Executes a Close Smart View / Advanced Search query and returns matching objects. Provide a `query` filter object (simple form) OR a native Close query tree (advanced form). Cursors expire in 30 seconds — do not pause between pages.
   * @route POST /run-advanced-search
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Contact","Opportunity","Activity","Custom Object"]}},"description":"What kind of object to search."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","freeform":true,"description":"Either a simple filter object ({ status, leadStatus, opportunityStatus, pipelineId, contactId, userId, assignedToId, createdAfter, createdBefore, updatedAfter, updatedBefore, customFields, conditions, operator }) OR a native Close query tree."}
   * @paramDef {"type":"Array.<String>","label":"Fields","name":"fields","description":"Optional field list to limit response size."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size (default 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Cursor returned from the previous call. Expires in 30 seconds."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Walks pages automatically (max 10 000 results — Close cursor cap)."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap when fetchAll is true (default 50)."}
   *
   * @returns {Object}
   * @sampleResultLoader {"methodName":"runAdvancedSearch_SampleResultLoader","dependsOn":["objectType"]}
   */
  async runAdvancedSearch(objectType, filter, fields, limit, cursor, fetchAll, maxPages) {
    const resolvedType = this.#resolveChoice(objectType, CHOICE_MAPS.searchObjectType)
    const parsedFilter = typeof filter === 'string' ? parseMaybeJSON(filter) : filter
    const tree = buildSearchQuery({ objectType: resolvedType, ...(parsedFilter || {}) })

    const buildBody = c => deepClean({
      query: tree,
      _limit: limit || SEARCH_PAGE_LIMIT,
      cursor: c || undefined,
      _fields: fields && fields.length ? { [resolvedType]: toArray(fields) } : undefined,
    })

    if (fetchAll) {
      const all = await paginateCursor(
        ({ cursor: c }) => this.apiRequest({
          url: `${ API_BASE_URL }/data/search/`, method: 'post', body: buildBody(c), logTag: 'runAdvancedSearch',
        }),
        { limit: limit || SEARCH_PAGE_LIMIT, maxPages: maxPages || MAX_PAGES_DEFAULT }
      )

      return { data: all, cursor: null }
    }

    return this.apiRequest({
      url: `${ API_BASE_URL }/data/search/`, method: 'post', body: buildBody(cursor), logTag: 'runAdvancedSearch',
    })
  }

  /**
   * @operationName Run Smart View
   * @category Search
   * @description Runs a saved search (Smart View) by ID and returns matching results. Cursors expire in 30 seconds.
   * @route POST /run-smart-view
   *
   * @paramDef {"type":"String","label":"Smart View","name":"smartViewId","required":true,"dictionary":"getSmartViewsDictionary","description":"The saved search to run."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size (default 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Cursor for next page."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Walk all pages up to maxPages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap when fetchAll true."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"lead_abc","display_name":"Acme Inc."}],"cursor":null}
   */
  async runSmartView(smartViewId, limit, cursor, fetchAll, maxPages) {
    const buildBody = c => deepClean({
      query: smartViewNode(smartViewId),
      _limit: limit || SEARCH_PAGE_LIMIT,
      cursor: c || undefined,
    })

    if (fetchAll) {
      const all = await paginateCursor(
        ({ cursor: c }) => this.apiRequest({
          url: `${ API_BASE_URL }/data/search/`, method: 'post', body: buildBody(c), logTag: 'runSmartView',
        }),
        { limit: limit || SEARCH_PAGE_LIMIT, maxPages: maxPages || MAX_PAGES_DEFAULT }
      )

      return { data: all, cursor: null }
    }

    return this.apiRequest({
      url: `${ API_BASE_URL }/data/search/`, method: 'post', body: buildBody(cursor), logTag: 'runSmartView',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 17 — Sequences
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Sequences
   * @category Sequences
   * @description Lists available email sequences (drip campaigns) in the org.
   * @route POST /list-sequences
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"seq_abc","name":"Cold Outreach v2","steps":[]}]}
   */
  async listSequences() {
    return this.apiRequest({ url: `${ API_BASE_URL }/sequence/`, logTag: 'listSequences' })
  }

  /**
   * @operationName Subscribe Contact to Sequence
   * @category Sequences
   * @description Adds a contact to an email sequence. Close starts sending the first step on the next scheduled run.
   * @route POST /subscribe-to-sequence
   *
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","required":true,"dictionary":"getSequencesDictionary","description":"Sequence to enroll into."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"Contact to subscribe."}
   * @paramDef {"type":"String","label":"Sender Email Account","name":"senderAccountId","required":true,"dictionary":"getEmailAccountsDictionary","description":"Connected email account (emailacct_*) the sequence sends from."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","required":true,"description":"Which contact email address to send to (the contact's email). E.g., 'jane@acme.com'."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Display name shown on outgoing emails. Defaults to the connected user's name."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"From-address for the sequence. Defaults to the selected email account's address."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_abc","sequence_id":"seq_abc","contact_id":"cont_abc","status":"active"}
   */
  // docs: https://developer.close.com/api/resources/sequences/create-subscription.md
  async subscribeToSequence(sequenceId, contactId, senderAccountId, contactEmail, senderName, senderEmail) {
    if (!senderAccountId) throw new Error('Sender Email Account is required — pick one via Get Email Accounts Dictionary.')
    if (!contactEmail) throw new Error('Contact Email is required — provide the contact\'s email address to send to.')

    // Close requires sender_account_id (emailacct_*) plus sender_name/sender_email; resolve sensible defaults.
    let resolvedSenderEmail = senderEmail
    let resolvedSenderName = senderName

    if (!resolvedSenderEmail) {
      const account = await this.apiRequest({
        url: `${ API_BASE_URL }/connected_account/${ senderAccountId }/`, logTag: 'subscribeToSequence',
      }).catch(() => null)
      resolvedSenderEmail = account?.email || account?.identifier
    }

    if (!resolvedSenderName) {
      const me = await this.apiRequest({ url: `${ API_BASE_URL }/me/`, logTag: 'subscribeToSequence' }).catch(() => null)
      resolvedSenderName = me?.display_name || `${ me?.first_name || '' } ${ me?.last_name || '' }`.trim() || me?.email
    }

    const body = deepClean({
      sequence_id: sequenceId,
      contact_id: contactId,
      sender_account_id: senderAccountId,
      sender_name: resolvedSenderName,
      sender_email: resolvedSenderEmail,
      contact_email: contactEmail,
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/sequence_subscription/`, method: 'post', body, logTag: 'subscribeToSequence' })
  }

  /**
   * @operationName Pause Sequence Subscription
   * @category Sequences
   * @description Pauses an active sequence subscription. The contact will not receive further steps until resumed.
   * @route POST /pause-sequence-subscription
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional — pick the lead to narrow the Subscription picker to that lead's subscriptions."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"getSequenceSubscriptionsDictionary","dependsOn":["leadId"],"description":"The sequence subscription to pause. Pick a Lead first to list its subscriptions, or paste a subscription ID (sub_*)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_abc","status":"paused"}
   */
  async pauseSequenceSubscription(leadId, subscriptionId) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/sequence_subscription/${ subscriptionId }/`,
      method: 'put',
      body: { status: 'paused' },
      logTag: 'pauseSequenceSubscription',
    })
  }

  /**
   * @operationName Resume Sequence Subscription
   * @category Sequences
   * @description Resumes a paused sequence subscription.
   * @route POST /resume-sequence-subscription
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","dictionary":"getLeadsDictionary","description":"Optional — pick the lead to narrow the Subscription picker to that lead's subscriptions."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"getSequenceSubscriptionsDictionary","dependsOn":["leadId"],"description":"The sequence subscription to resume. Pick a Lead first to list its subscriptions, or paste a subscription ID (sub_*)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_abc","status":"active"}
   */
  async resumeSequenceSubscription(leadId, subscriptionId) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/sequence_subscription/${ subscriptionId }/`,
      method: 'put',
      body: { status: 'active' },
      logTag: 'resumeSequenceSubscription',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 18 — Bulk Actions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Bulk Edit Leads
   * @category Bulk Actions
   * @description Starts a background job that applies ONE field operation to every lead matched by the filter. Returns a job ID — poll Get Bulk Action Status (kind=edit) until status='complete'.
   * @route POST /bulk-edit-leads
   *
   * @paramDef {"type":"AdvancedSearchFilter","label":"Filter","name":"filter","required":true,"description":"Which leads to edit. A simple filter object (leadStatus, assignedToId, createdAfter, customFields, conditions, …) OR a native Close query tree."}
   * @paramDef {"type":"String","label":"Operation","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Set Lead Status","Set Custom Field","Clear Custom Field"]}},"description":"The single edit to apply to every matched lead."}
   * @paramDef {"type":"String","label":"Lead Status","name":"leadStatusId","dictionary":"getLeadStatusesDictionary","description":"Required when Operation is Set Lead Status: the status to set."}
   * @paramDef {"type":"String","label":"Custom Field","name":"customFieldId","dictionary":"getLeadCustomFieldsDictionary","description":"Required for Set/Clear Custom Field: the lead custom field ID. Find it via Get Custom Fields Dictionary (object type = lead)."}
   * @paramDef {"type":"String","label":"Custom Field Value","name":"customFieldValue","description":"Required when Operation is Set Custom Field: the value to set."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bulkact_abc","status":"queued","type":"set_lead_status"}
   */
  // docs: https://developer.close.com/api/resources/bulk-actions/edit/create.md
  async bulkEditLeads(filter, type, leadStatusId, customFieldId, customFieldValue) {
    if (!type) throw new Error('Operation is required — choose Set Lead Status, Set Custom Field, or Clear Custom Field.')

    const operation = this.#resolveChoice(type, CHOICE_MAPS.bulkEditType)
    const sQuery = this.#buildBulkQuery(filter, 'edit')

    const body = { type: operation, s_query: sQuery }

    if (operation === 'set_lead_status') {
      if (!leadStatusId) throw new Error('Lead Status is required for Set Lead Status — pick one via Get Lead Statuses Dictionary.')
      body.lead_status_id = leadStatusId
    } else if (operation === 'set_custom_field') {
      if (!customFieldId) throw new Error('Custom Field is required for Set Custom Field — find the ID via Get Custom Fields Dictionary.')
      body.custom_field_id = customFieldId
      body.custom_field_value = customFieldValue
    } else if (operation === 'clear_custom_field') {
      if (!customFieldId) throw new Error('Custom Field is required for Clear Custom Field — find the ID via Get Custom Fields Dictionary.')
      body.custom_field_id = customFieldId
    }

    return this.apiRequest({ url: `${ API_BASE_URL }/bulk_action/edit/`, method: 'post', body, logTag: 'bulkEditLeads' })
  }

  /**
   * @operationName Bulk Delete Leads
   * @category Bulk Actions
   * @description Starts a background job that deletes every lead matched by the filter. Returns a job ID. DESTRUCTIVE.
   * @route POST /bulk-delete-leads
   *
   * @paramDef {"type":"AdvancedSearchFilter","label":"Filter","name":"filter","required":true,"description":"Which leads to delete. A simple filter object (leadStatus, assignedToId, createdAfter, customFields, conditions, …) OR a native Close query tree."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bulkact_abc","status":"queued","type":"delete"}
   */
  // docs: https://developer.close.com/api/resources/bulk-actions/delete/create.md
  async bulkDeleteLeads(filter) {
    const sQuery = this.#buildBulkQuery(filter, 'delete')

    return this.apiRequest({
      url: `${ API_BASE_URL }/bulk_action/delete/`,
      method: 'post',
      body: { s_query: sQuery },
      logTag: 'bulkDeleteLeads',
    })
  }

  /**
   * @operationName Bulk Email
   * @category Bulk Actions
   * @description Starts a background job that sends a templated email to every lead/contact matched by the filter. Returns a job ID.
   * @route POST /bulk-email
   *
   * @paramDef {"type":"AdvancedSearchFilter","label":"Filter","name":"filter","required":true,"description":"Which leads to email. A simple filter object (leadStatus, assignedToId, createdAfter, customFields, conditions, …) OR a native Close query tree."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getEmailTemplatesDictionary","description":"Email template to render."}
   * @paramDef {"type":"String","label":"Contact Preference","name":"contactPreference","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Primary Contact Per Lead","First Contact Per Lead"]}},"description":"Which contacts the bulk email targets: 'lead' = the lead's primary contact; 'contact' = the first contact per lead."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bulkact_abc","status":"queued","type":"email"}
   */
  // docs: https://developer.close.com/api/resources/bulk-actions/email/create.md
  async bulkEmail(filter, templateId, contactPreference) {
    if (!templateId) throw new Error('Template is required — pick one via Get Email Templates Dictionary.')
    if (!contactPreference) throw new Error('Contact Preference is required — choose Primary Contact Only or All Contacts.')

    const sQuery = this.#buildBulkQuery(filter, 'email')

    const body = deepClean({
      s_query: sQuery,
      template_id: templateId,
      contact_preference: this.#resolveChoice(contactPreference, CHOICE_MAPS.bulkEmailContactPreference),
    })

    return this.apiRequest({ url: `${ API_BASE_URL }/bulk_action/email/`, method: 'post', body, logTag: 'bulkEmail' })
  }

  /**
   * @operationName Get Bulk Action Status
   * @category Bulk Actions
   * @description Polls the status of a bulk action job. status is one of: queued, in_progress, complete, errored.
   * @route POST /get-bulk-action-status
   *
   * @paramDef {"type":"String","label":"Kind","name":"kind","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Edit","Delete","Email"]}},"description":"Kind of bulk action."}
   * @paramDef {"type":"String","label":"Bulk Action ID","name":"bulkActionId","required":true,"dictionary":"getBulkActionsDictionary","dependsOn":["kind"],"description":"ID returned from the create bulk action call."}
   *
   * @returns {Object}
   * @sampleResult {"id":"bulkact_abc","status":"complete","processed":42,"errored":0}
   */
  async getBulkActionStatus(kind, bulkActionId) {
    const resolvedKind = this.#resolveChoice(kind, CHOICE_MAPS.bulkActionKind)

    return this.apiRequest({
      url: `${ API_BASE_URL }/bulk_action/${ resolvedKind }/${ bulkActionId }/`,
      logTag: 'getBulkActionStatus',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 19 — Webhooks (manual CRUD — separate from realtime trigger)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Lists all webhook subscriptions configured in the connected organization.
   * @route POST /list-webhooks
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"whsub_abc","url":"https://example.com/hook","status":"active"}]}
   */
  async listWebhooks() {
    return this.apiRequest({ url: `${ API_BASE_URL }/webhook/`, logTag: 'listWebhooks' })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Subscribes to Close events at an external URL. The returned signature_key is required to verify incoming requests and is shown ONLY ONCE — store it immediately.
   * @route POST /create-webhook
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Public URL Close will send events to. Must start with https:// and accept POST requests."}
   * @paramDef {"type":"Array.<WebhookEventSpec>","label":"Events","name":"events","required":true,"description":"Which Close events to listen for. Each entry is { object_type, action }. Use '*' as a wildcard. Example: [{ object_type: 'lead', action: '*' }] subscribes to every lead change."}
   * @paramDef {"type":"Boolean","label":"Verify SSL","name":"verifySSL","uiComponent":{"type":"TOGGLE"},"description":"When on, Close checks that the callback URL has a valid security certificate before sending events. Leave on unless you're testing with a self-signed cert."}
   *
   * @returns {Object}
   * @sampleResult {"id":"whsub_abc","url":"https://example.com/hook","signature_key":"abc...","status":"active"}
   */
  async createWebhook(url, events, verifySSL) {
    const body = deepClean({ url, events, verify_ssl: verifySSL !== false })

    return this.apiRequest({ url: `${ API_BASE_URL }/webhook/`, method: 'post', body, logTag: 'createWebhook' })
  }

  /**
   * @operationName Update Webhook
   * @category Webhooks
   * @description Updates a webhook's events list or status (active/paused). Use this to resume a webhook auto-paused after repeated delivery failures.
   * @route POST /update-webhook
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook to act on. Pick from configured webhooks, or paste a webhook ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused"]}},"description":"Subscription status."}
   * @paramDef {"type":"Array.<WebhookEventSpec>","label":"Events","name":"events","description":"Replaces the event subscriptions list. Each entry is { object_type, action }."}
   *
   * @returns {Object}
   * @sampleResult {"id":"whsub_abc","status":"active"}
   */
  async updateWebhook(webhookId, status, events) {
    const body = deepClean({ status: this.#resolveChoice(status, CHOICE_MAPS.webhookStatus), events })

    return this.apiRequest({ url: `${ API_BASE_URL }/webhook/${ webhookId }/`, method: 'put', body, logTag: 'updateWebhook' })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Permanently removes a webhook subscription.
   * @route POST /delete-webhook
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook to act on. Pick from configured webhooks, or paste a webhook ID."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"whsub_abc"}
   */
  async deleteWebhook(webhookId) {
    await this.apiRequest({ url: `${ API_BASE_URL }/webhook/${ webhookId }/`, method: 'delete', logTag: 'deleteWebhook' })

    return { status: 'deleted', id: webhookId }
  }

  /**
   * @operationName List Events
   * @category Audit Log
   * @description Lists organization audit events (object created / updated / deleted). Only ~30 days of history is retained — use webhooks for older data.
   * @route POST /list-events
   *
   * @paramDef {"type":"String","label":"Object Type","name":"objectType","description":"Filter by object type (lead, contact, opportunity, etc.)."}
   * @paramDef {"type":"String","label":"Action","name":"action","description":"Filter by action (created, updated, deleted)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Cursor for next page."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ev_abc","object_type":"lead","action":"updated","object_id":"lead_abc"}],"cursor":null}
   */
  async listEvents(objectType, action, cursor, limit) {
    return this.apiRequest({
      url: `${ API_BASE_URL }/event/`,
      query: { object_type: objectType, action, _cursor: cursor, _limit: limit || DEFAULT_PAGE_LIMIT },
      logTag: 'listEvents',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 20 — Files (multipart upload)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file to Close so you can attach it to notes, emails, or activities. Pick the file from FlowRunner storage or paste a public URL. Files up to 25 MB are supported.
   * @route POST /upload-file
   * @executionTimeoutInSeconds 90
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Select a file from FlowRunner storage, or paste any public file URL. Close downloads the file and stores its own copy."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional display name for the upload (e.g., 'contract.pdf'). If empty, the name is taken from the URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_abc","url":"https://app.close.com/files/abc.pdf","filename":"contract.pdf"}
   */
  async uploadFile(fileUrl, fileName) {
    if (!fileUrl) {
      throw new Error('File is required — select a file from FlowRunner storage or paste a public file URL.')
    }

    // Multipart upload can't go through #apiRequest (JSON factory), so normalize errors through wrapError here.
    try {
      const buffer = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const name = fileName || fileUrl.split('/').pop() || 'upload.bin'

      const form = new FormData()
      form.append('file', new Blob([buffer]), name || 'upload.bin')

      const req = Flowrunner.Request.post(`${ API_BASE_URL }/files/`).set(this.getAuthHeader())
      req.form(form)
      req.set({ 'Content-Type': 'multipart/form-data' })

      logger.debug('[uploadFile] uploading file to Close')

      return await req
    } catch (error) {
      logger.error(`[uploadFile] error: ${ error.message }`)
      throw wrapError(error, 'uploadFile')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 21 — Realtime Trigger system handlers
  // ═══════════════════════════════════════════════════════════════════════════

  #eventsForMethods(methodNames) {
    const out = []
    const seen = new Set()

    for (const name of methodNames) {
      const pairs = WEBHOOK_EVENT_MAP[name] || []

      for (const p of pairs) {
        const key = `${ p.object_type }:${ p.action }`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(p)
      }
    }

    return out
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify({ keys: Object.keys(invocation || {}) }) }`)

    const methodNames = (invocation?.events || []).map(e => e.name)
    const events = this.#eventsForMethods(methodNames)

    if (!events.length) {
      logger.warn('handleTriggerUpsertWebhook: no events to subscribe — skipping')

      return { webhookData: invocation.webhookData || null }
    }

    if (invocation?.webhookData?.id) {
      const updated = await this.apiRequest({
        url: `${ API_BASE_URL }/webhook/${ invocation.webhookData.id }/`,
        method: 'put',
        body: { events, status: 'active' },
        logTag: 'handleTriggerUpsertWebhook.update',
      })

      return {
        webhookData: {
          id: updated.id,
          signatureKey: invocation.webhookData.signatureKey,
          events,
        },
      }
    }

    const created = await this.apiRequest({
      url: `${ API_BASE_URL }/webhook/`,
      method: 'post',
      body: { url: invocation.callbackUrl, events, verify_ssl: true },
      logTag: 'handleTriggerUpsertWebhook.create',
    })

    return {
      webhookData: {
        id: created.id,
        signatureKey: created.signature_key,
        events,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const headers = headersOf(invocation)
    const signature = headers['close-sig-hash']
    const timestamp = headers['close-sig-timestamp']
    const rawBody = rawBodyOf(invocation)
    const signatureKey = invocation?.webhookData?.signatureKey

    if (signatureKey) {
      // A signing secret is configured (production): every delivery must carry valid signature headers.
      if (!signature || !timestamp) {
        logger.warn('handleTriggerResolveEvents: signature headers missing while a signatureKey is configured — rejecting event')

        return { events: [] }
      }

      if (!verifySignature({ signatureKey, timestamp, rawBody, signature })) {
        logger.warn('handleTriggerResolveEvents: signature mismatch — ignoring event')

        return { events: [] }
      }
    } else {
      logger.debug('handleTriggerResolveEvents: no signatureKey configured — accepting (test mode)')
    }

    const body = invocation?.body || (rawBody ? safeParse(rawBody) : null) || {}
    const evt = body.event || body

    if (!evt?.object_type || !evt?.action) {
      return { events: [] }
    }

    const key = `${ evt.object_type }:${ evt.action }`
    const methodName = EVENT_TO_METHOD[key]

    if (!methodName) {
      logger.debug(`handleTriggerResolveEvents: no method mapped for ${ key }`)

      return { events: [] }
    }

    const shaped = await this[methodName](CALL_TYPES.SHAPE_EVENT, evt)

    return { events: shaped }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const methodName = invocation?.eventName

    if (!methodName || typeof this[methodName] !== 'function') {
      return { ids: (invocation?.triggers || []).map(t => t.id) }
    }

    return await this[methodName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const id = invocation?.webhookData?.id
    if (!id) return

    try {
      await this.apiRequest({ url: `${ API_BASE_URL }/webhook/${ id }/`, method: 'delete', logTag: 'handleTriggerDeleteWebhook' })
    } catch (error) {
      logger.warn(`handleTriggerDeleteWebhook: ${ error.message }`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 22 — Realtime trigger user-facing methods
  //
  // Each method is dual-purpose: SHAPE_EVENT (turn raw Close event into trigger
  // events) and FILTER_TRIGGER (decide which configured triggers match the event).
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @operationName On Lead Created
   * @category Triggers
   * @description Triggers whenever a new lead is created in Close. Optionally filter by status or owner to react only to specific funnel stages.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-lead-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Only fire when the new lead has this status. Leave blank to fire for any status."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"Only fire when the lead is owned by this user."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ev_abc","object_type":"lead","action":"created","object_id":"lead_abc","data":{"display_name":"Acme Inc.","status_label":"Potential"}}
   */
  onLeadCreated(callType, payload) {
    return this.#defaultTriggerHandler('onLeadCreated', callType, payload, this.#leadFilter)
  }

  /**
   * @operationName On Lead Updated
   * @category Triggers
   * @description Triggers when any field on a lead changes. Optionally filter by status or owner.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-lead-updated
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Only fire when the lead has this status after the change."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"Only fire when the lead is owned by this user."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ev_abc","object_type":"lead","action":"updated","object_id":"lead_abc","changed_fields":["status_id"],"previous_data":{"status_label":"Potential"},"data":{"status_label":"Qualified"}}
   */
  onLeadUpdated(callType, payload) {
    return this.#defaultTriggerHandler('onLeadUpdated', callType, payload, this.#leadFilter)
  }

  /**
   * @operationName On Lead Status Changed
   * @category Triggers
   * @description Triggers when a lead transitions to a new status. Filter by destination status to react only to specific moves (e.g., "Qualified" → automation).
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-lead-status-changed
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"New Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Only fire when the lead reaches this status."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"lead","action":"status_change","object_id":"lead_abc","previous_data":{"status_id":"stat_p"},"data":{"status_id":"stat_q","status_label":"Qualified"}}
   */
  onLeadStatusChanged(callType, payload) {
    return this.#defaultTriggerHandler('onLeadStatusChanged', callType, payload, (trigger, evt) => {
      if (!trigger.data?.statusId) return true

      return evt?.data?.status_id === trigger.data.statusId
    })
  }

  /**
   * @operationName On Lead Deleted
   * @category Triggers
   * @description Triggers when a lead is permanently deleted.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-lead-deleted
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"lead","action":"deleted","object_id":"lead_abc"}
   */
  onLeadDeleted(callType, payload) {
    return this.#defaultTriggerHandler('onLeadDeleted', callType, payload)
  }

  /**
   * @operationName On Lead Merged
   * @category Triggers
   * @description Triggers when two leads are merged. The source lead's ID is in `object_id`; the destination is in `data.destination`.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-lead-merged
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"lead","action":"merged","object_id":"lead_src","data":{"destination":"lead_dst"}}
   */
  onLeadMerged(callType, payload) {
    return this.#defaultTriggerHandler('onLeadMerged', callType, payload)
  }

  /**
   * @operationName On Opportunity Created
   * @category Triggers
   * @description Triggers when a new opportunity is created. Filter by pipeline or status to scope to relevant deals.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-opportunity-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Only fire when the opportunity is in this pipeline."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getOpportunityStatusesDictionary","description":"Only fire when the opportunity starts in this status."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"opportunity","action":"created","object_id":"oppo_abc","data":{"value":500000,"status_label":"Active"}}
   */
  onOpportunityCreated(callType, payload) {
    return this.#defaultTriggerHandler('onOpportunityCreated', callType, payload, this.#opportunityFilter)
  }

  /**
   * @operationName On Opportunity Updated
   * @category Triggers
   * @description Triggers when an opportunity field changes. Filter by pipeline or status.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-opportunity-updated
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Pipeline filter."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getOpportunityStatusesDictionary","description":"Status filter."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"opportunity","action":"updated","object_id":"oppo_abc","changed_fields":["value"],"data":{"value":750000}}
   */
  onOpportunityUpdated(callType, payload) {
    return this.#defaultTriggerHandler('onOpportunityUpdated', callType, payload, this.#opportunityFilter)
  }

  /**
   * @operationName On Opportunity Status Changed
   * @category Triggers
   * @description Triggers when an opportunity moves to a new status (often used to detect wins / losses).
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-opportunity-status-changed
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"New Status","name":"statusId","dictionary":"getOpportunityStatusesDictionary","description":"Only fire when the opportunity reaches this status."}
   * @paramDef {"type":"String","label":"Status Type","name":"statusType","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Won","Lost"]}},"description":"Alternative: fire when the new status belongs to this status type (active/won/lost)."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"opportunity","action":"status_change","object_id":"oppo_abc","previous_data":{"status_type":"active"},"data":{"status_type":"won","status_label":"Closed Won"}}
   */
  onOpportunityStatusChanged(callType, payload) {
    return this.#defaultTriggerHandler('onOpportunityStatusChanged', callType, payload, (trigger, evt) => {
      if (trigger.data?.statusId && evt?.data?.status_id !== trigger.data.statusId) return false
      const wantStatusType = this.#resolveChoice(trigger.data?.statusType, CHOICE_MAPS.opportunityStatusType)
      if (wantStatusType && evt?.data?.status_type !== wantStatusType) return false

      return true
    })
  }

  /**
   * @operationName On Contact Created
   * @category Triggers
   * @description Triggers when a new contact is added to a lead.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-contact-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"contact","action":"created","object_id":"cont_abc","lead_id":"lead_abc","data":{"name":"Jane Doe","emails":[{"email":"jane@acme.com"}]}}
   */
  onContactCreated(callType, payload) {
    return this.#defaultTriggerHandler('onContactCreated', callType, payload)
  }

  /**
   * @operationName On Contact Updated
   * @category Triggers
   * @description Triggers when an existing contact is changed.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-contact-updated
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"contact","action":"updated","object_id":"cont_abc","changed_fields":["title"]}
   */
  onContactUpdated(callType, payload) {
    return this.#defaultTriggerHandler('onContactUpdated', callType, payload)
  }

  /**
   * @operationName On Task Created
   * @category Triggers
   * @description Triggers when a new task is created on a lead. Filter by assignee.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-task-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedToId","dictionary":"getUsersDictionary","description":"Only fire when the task is assigned to this user."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"task.lead","action":"created","object_id":"task_abc","data":{"text":"Follow up","assigned_to":"user_abc"}}
   */
  onTaskCreated(callType, payload) {
    return this.#defaultTriggerHandler('onTaskCreated', callType, payload, (trigger, evt) => {
      if (!trigger.data?.assignedToId) return true

      return evt?.data?.assigned_to === trigger.data.assignedToId
    })
  }

  /**
   * @operationName On Task Completed
   * @category Triggers
   * @description Triggers when a task is marked completed. Useful for follow-up automations (e.g., when "Send proposal" is done → next step).
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-task-completed
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedToId","dictionary":"getUsersDictionary","description":"Only fire when the completed task was assigned to this user."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"task_completion","action":"created","object_id":"taskcomp_abc","data":{"task":{"text":"Follow up","assigned_to":"user_abc"}}}
   */
  onTaskCompleted(callType, payload) {
    return this.#defaultTriggerHandler('onTaskCompleted', callType, payload, (trigger, evt) => {
      if (!trigger.data?.assignedToId) return true
      const assigned = evt?.data?.task?.assigned_to || evt?.data?.assigned_to

      return assigned === trigger.data.assignedToId
    })
  }

  /**
   * @operationName On Note Created
   * @category Triggers
   * @description Triggers when a new note is added to a lead.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-note-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.note","action":"created","object_id":"acti_abc","lead_id":"lead_abc","data":{"note":"Hello"}}
   */
  onNoteCreated(callType, payload) {
    return this.#defaultTriggerHandler('onNoteCreated', callType, payload)
  }

  /**
   * @operationName On Call Completed
   * @category Triggers
   * @description Triggers when a call activity is completed (either Twilio-dialed or manually logged).
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-call-completed
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Filter by call direction."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.call","action":"completed","object_id":"acti_call_abc","data":{"direction":"outbound","duration":120}}
   */
  onCallCompleted(callType, payload) {
    return this.#defaultTriggerHandler('onCallCompleted', callType, payload, (trigger, evt) => {
      const wantDirection = this.#resolveChoice(trigger.data?.direction, CHOICE_MAPS.callDirection)
      if (!wantDirection) return true

      return evt?.data?.direction === wantDirection
    })
  }

  /**
   * @operationName On Email Sent
   * @category Triggers
   * @description Triggers when an outbound email is sent through Close.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-email-sent
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.email","action":"sent","object_id":"acti_email_abc","data":{"subject":"Hi","to":["jane@acme.com"]}}
   */
  onEmailSent(callType, payload) {
    return this.#defaultTriggerHandler('onEmailSent', callType, payload)
  }

  /**
   * @operationName On Email Received
   * @category Triggers
   * @description Triggers when an inbound email is received into a connected email account associated with a lead.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-email-received
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.email","action":"created","object_id":"acti_email_abc","data":{"direction":"incoming","subject":"Re: Hi"}}
   */
  onEmailReceived(callType, payload) {
    return this.#defaultTriggerHandler('onEmailReceived', callType, payload)
  }

  /**
   * @operationName On SMS Sent
   * @category Triggers
   * @description Triggers when an outbound SMS is sent.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-sms-sent
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.sms","action":"sent","object_id":"acti_sms_abc","data":{"text":"Hi","remote_phone":"+15551234567"}}
   */
  onSmsSent(callType, payload) {
    return this.#defaultTriggerHandler('onSmsSent', callType, payload)
  }

  /**
   * @operationName On SMS Received
   * @category Triggers
   * @description Triggers when an inbound SMS arrives on a Close-provisioned number.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-sms-received
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.sms","action":"created","object_id":"acti_sms_abc","data":{"direction":"inbound","text":"Hi"}}
   */
  onSmsReceived(callType, payload) {
    return this.#defaultTriggerHandler('onSmsReceived', callType, payload)
  }

  /**
   * @operationName On Meeting Completed
   * @category Triggers
   * @description Triggers when a meeting activity transitions to completed.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-meeting-completed
   * @appearanceColor #006bff #0ee8f0
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.meeting","action":"completed","object_id":"acti_meet_abc","data":{"title":"Demo"}}
   */
  onMeetingCompleted(callType, payload) {
    return this.#defaultTriggerHandler('onMeetingCompleted', callType, payload)
  }

  /**
   * @operationName On Custom Activity Created
   * @category Triggers
   * @description Triggers when a custom activity instance is created. Filter by custom activity type ID to react only to specific kinds (e.g., "Demo Booked").
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-custom-activity-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @paramDef {"type":"String","label":"Activity Type","name":"customActivityTypeId","dictionary":"getCustomActivityTypesDictionary","description":"Only fire for this custom activity type."}
   *
   * @returns {Object}
   * @sampleResult {"object_type":"activity.custom","action":"created","object_id":"acti_cust_abc","data":{"custom_activity_type_id":"actitype_abc"}}
   */
  onCustomActivityCreated(callType, payload) {
    return this.#defaultTriggerHandler('onCustomActivityCreated', callType, payload, (trigger, evt) => {
      if (!trigger.data?.customActivityTypeId) return true

      return evt?.data?.custom_activity_type_id === trigger.data.customActivityTypeId
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 23 — Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  #defaultTriggerHandler(name, callType, payload, customFilter) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name, data: payload }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      const ids = []
      const evt = payload?.eventData || payload?.event || payload

      for (const trigger of payload?.triggers || []) {
        if (customFilter) {
          if (customFilter.call(this, trigger, evt)) ids.push(trigger.id)
        } else {
          ids.push(trigger.id)
        }
      }

      return { ids }
    }

    return null
  }

  #leadFilter(trigger, evt) {
    const data = trigger?.data || {}
    if (data.statusId && evt?.data?.status_id !== data.statusId) return false
    if (data.ownerId && evt?.data?.lead_owner_id !== data.ownerId && evt?.data?.user_id !== data.ownerId) return false

    return true
  }

  #opportunityFilter(trigger, evt) {
    const data = trigger?.data || {}
    if (data.pipelineId && evt?.data?.pipeline_id !== data.pipelineId) return false
    if (data.statusId && evt?.data?.status_id !== data.statusId) return false

    return true
  }

  // Translate a friendly DROPDOWN label back to its Close API value; pass through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #expandCustomFields(map) {
    if (!map || typeof map !== 'object') return {}
    const out = {}

    for (const [key, value] of Object.entries(map)) {
      if (value === undefined) continue
      const prefixed = key.startsWith('custom.') ? key : `custom.${ key }`
      out[prefixed] = value
    }

    return out
  }

  // Normalize a Filter param (JSON string or object) into the simple/declarative form buildSearchQuery accepts.
  #parseFilter(filter) {
    const parsed = typeof filter === 'string' ? parseMaybeJSON(filter) : filter

    return parsed || {}
  }

  // Builds the s_query for a bulk action and refuses to return one that matches every lead.
  // buildSearchQuery always yields at least the object_type node, so a missing or unusable
  // filter produces a truthy-but-unrestricted query — checking `!sQuery` alone is not enough.
  #buildBulkQuery(filter, action) {
    const sQuery = buildSearchQuery({ objectType: 'lead', ...this.#parseFilter(filter) })
    const unrestricted = !sQuery || (sQuery.type === 'object_type' && !sQuery.queries)

    if (unrestricted) {
      throw new Error(`Filter is required — provide a structured filter to select which leads to ${ action }. Refusing to ${ action } every lead in the organization.`)
    }

    return sQuery
  }
}

function safeParse(input) {
  try {
    return JSON.parse(input)
  } catch (_) {
    return null
  }
}

// Trim free-text (note/sms bodies) to a one-line dropdown label.
function snippet(text, max = 60) {
  if (!text) return ''
  const flat = String(text).replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${ flat.slice(0, max - 1) }…` : flat
}

// "outbound" -> "Outbound" for human-facing dropdown labels.
function titleCase(value) {
  if (!value) return ''

  return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

// Offset-pagination cursor for dictionary listings: advance by the raw page size
// (not the post-search item count) so paging doesn't skip records, null when exhausted.
function nextCursorFrom(res, cursor) {
  if (!res?.has_more) return null
  const base = cursor ? Number(cursor) : 0

  return String(base + (res?.data?.length || 0))
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 24 — Service registration
// ═══════════════════════════════════════════════════════════════════════════

Flowrunner.ServerCode.addService(CloseCRMService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: 'STRING',
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID issued by Close (https://app.close.com/settings/developer/oauth-apps/).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: 'STRING',
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret issued by Close.',
  },
  {
    name: 'defaultEmailAccountId',
    displayName: 'Default Email Account ID',
    type: 'STRING',
    required: false,
    shared: false,
    hint: 'Fallback email_account_id used by Send Email when none is supplied (find via Get Email Accounts dictionary).',
  },
])

module.exports = CloseCRMService
