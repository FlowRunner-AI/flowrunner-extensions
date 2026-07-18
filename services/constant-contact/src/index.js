'use strict'

const AUTHORIZE_URL = 'https://authz.constantcontact.com/oauth2/default/v1/authorize'
const TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token'
const API_BASE_URL = 'https://api.cc.email/v3'

const DEFAULT_SCOPE_LIST = [
  'account_read',
  'contact_data',
  'campaign_data',
  'offline_access',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const CONTACT_STATUS_OPTIONS = {
  'All': 'all',
  'Active': 'active',
  'Deleted': 'deleted',
  'Not Set': 'not_set',
  'Pending Confirmation': 'pending_confirmation',
  'Temporary Hold': 'temp_hold',
  'Unsubscribed': 'unsubscribed',
}

const CONTACT_INCLUDE_OPTIONS = {
  'Custom Fields': 'custom_fields',
  'List Memberships': 'list_memberships',
  'Phone Numbers': 'phone_numbers',
  'Street Addresses': 'street_addresses',
}

const MEMBERSHIP_COUNT_OPTIONS = {
  'All': 'all',
  'Active': 'active',
}

const PHONE_KIND_OPTIONS = {
  'Home': 'home',
  'Work': 'work',
  'Mobile': 'mobile',
  'Other': 'other',
}

const ADDRESS_KIND_OPTIONS = {
  'Home': 'home',
  'Work': 'work',
  'Other': 'other',
}

const CUSTOM_FIELD_TYPE_OPTIONS = {
  'Text': 'string',
  'Date': 'date',
}

const SEGMENT_SORT_OPTIONS = {
  'Date Updated': 'date',
  'Name': 'name',
}

// The include list requested when fetching a contact before a full-replace PUT,
// so that unspecified sub-resources are preserved instead of being wiped.
const CONTACT_MERGE_INCLUDE = 'custom_fields,list_memberships,phone_numbers,street_addresses'

const logger = {
  info: (...args) => console.log('[Constant Contact] info:', ...args),
  debug: (...args) => console.log('[Constant Contact] debug:', ...args),
  error: (...args) => console.log('[Constant Contact] error:', ...args),
  warn: (...args) => console.log('[Constant Contact] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Constant Contact
 * @integrationIcon /icon.png
 **/
class ConstantContactService {
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

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Several Constant Contact write endpoints (delete contact, delete segment, unschedule, etc.)
      // return 204 No Content with an empty body. Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Constant Contact API error: ${ message }`)
    }
  }

  // Constant Contact v3 errors are shaped as [{ error_key, error_message }] (sometimes a single
  // object), while the auth server returns { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (Array.isArray(body) && body.length) {
        return body
          .map(item => item.error_message || item.error_key)
          .filter(Boolean)
          .join('; ') || 'Request failed'
      }

      if (body.error_message) {
        return body.error_key ? `${ body.error_message } [${ body.error_key }]` : body.error_message
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }

      if (body.message) {
        return body.message
      }
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Accepts an array or a comma-separated string and returns a clean string array.
  #toArray(value) {
    if (value === undefined || value === null || value === '') {
      return []
    }

    if (Array.isArray(value)) {
      return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean)
    }

    return String(value).split(',').map(item => item.trim()).filter(Boolean)
  }

  // Constant Contact paginates via _links.next.href (e.g. "/v3/contacts?cursor=bGltaXQ9NTA...").
  // Extracts the bare cursor value so it can be fed back through the "cursor" query parameter.
  #extractCursor(response) {
    const next = response?._links?.next?.href

    if (!next) {
      return undefined
    }

    const match = next.match(/[?&]cursor=([^&]+)/)

    return match ? decodeURIComponent(match[1]) : undefined
  }

  // Appends a top-level "cursor" convenience field extracted from _links.next.href.
  #withCursor(response) {
    const cursor = this.#extractCursor(response)

    return cursor ? { ...response, cursor } : response
  }

  #resolveIncludeList(include) {
    const list = this.#toArray(include).map(item => this.#resolveChoice(item, CONTACT_INCLUDE_OPTIONS))

    return list.length ? list.join(',') : undefined
  }

  #buildStreetAddresses(streetAddress) {
    if (!streetAddress || typeof streetAddress !== 'object' || !Object.keys(cleanupObject(streetAddress)).length) {
      return undefined
    }

    return [cleanupObject({
      kind: this.#resolveChoice(streetAddress.kind, ADDRESS_KIND_OPTIONS) || 'home',
      street: streetAddress.street,
      city: streetAddress.city,
      state: streetAddress.state,
      postal_code: streetAddress.postal_code,
      country: streetAddress.country,
    })]
  }

  #buildCustomFields(customFields) {
    const list = (Array.isArray(customFields) ? customFields : []).filter(field => field && field.custom_field_id)

    if (!list.length) {
      return undefined
    }

    return list.map(field => ({ custom_field_id: field.custom_field_id, value: field.value }))
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
    params.append('state', `flowrunner_${ Date.now() }`)

    // redirect_uri is injected by the FlowRunner platform (repo OAuth pattern) — do not append it here.
    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

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

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Constant Contact Account'

    try {
      userData = await Flowrunner.Request
        .get(`${ API_BASE_URL }/account/summary`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })

      connectionIdentityName = userData.organization_name || userData.contact_email || connectionIdentityName
    } catch (error) {
      logger.error(`[executeCallback] /account/summary error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
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
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // Constant Contact refresh tokens ROTATE: each refresh token is single-use and every
        // refresh response carries a new one, which MUST be stored for the next refresh.
        refreshToken: refresh_token || refreshToken,
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
   * @typedef {Object} getContactListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter contact lists by name. Filtering is applied locally to the retrieved lists."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of lists."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact Lists Dictionary
   * @description Lists the account's contact lists for selection in dependent parameters. Returns the list name as the label and the list id (UUID) as the value, with the active membership count as the note.
   * @route POST /get-contact-lists-dictionary
   * @paramDef {"type":"getContactListsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":"8a3e5c60-53bc-11ec-b5f8-fa163e5bc304","note":"1204 members"}]}
   */
  async getContactListsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getContactListsDictionary',
      url: `${ API_BASE_URL }/contact_lists`,
      query: { limit: 1000, include_membership_count: 'active', cursor },
    })

    const lists = Array.isArray(response.lists) ? response.lists : []

    const filtered = search
      ? lists.filter(list => list?.name && list.name.toLowerCase().includes(search.toLowerCase()))
      : lists

    return {
      cursor: this.#extractCursor(response),
      items: filtered.map(list => ({
        label: list.name,
        value: list.list_id,
        note: list.membership_count !== undefined ? `${ list.membership_count } members` : '',
      })),
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of tags."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Lists the account's contact tags for selection in dependent parameters. Returns the tag name as the label and the tag id (UUID) as the value.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"VIP","value":"27a11a10-4bfa-11ec-b1d4-fa163e5bc304","note":""}]}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getTagsDictionary',
      url: `${ API_BASE_URL }/contact_tags`,
      query: { limit: 500, cursor },
    })

    const tags = Array.isArray(response.tags) ? response.tags : []

    const filtered = search
      ? tags.filter(tag => tag?.name && tag.name.toLowerCase().includes(search.toLowerCase()))
      : tags

    return {
      cursor: this.#extractCursor(response),
      items: filtered.map(tag => ({
        label: tag.name,
        value: tag.tag_id,
        note: tag.contacts_count !== undefined ? `${ tag.contacts_count } contacts` : '',
      })),
    }
  }

  /**
   * @typedef {Object} getSegmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter segments by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of segments."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Lists the account's segments for selection in dependent parameters. Returns the segment name as the label and the numeric segment id as the value.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Recently Engaged","value":14,"note":"Updated 2026-06-10T15:30:00Z"}]}
   */
  async getSegmentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getSegmentsDictionary',
      url: `${ API_BASE_URL }/segments`,
      query: { cursor },
    })

    const segments = Array.isArray(response.segments) ? response.segments : []

    const filtered = search
      ? segments.filter(segment => segment?.name && segment.name.toLowerCase().includes(search.toLowerCase()))
      : segments

    return {
      cursor: this.#extractCursor(response),
      items: filtered.map(segment => ({
        label: segment.name,
        value: segment.segment_id,
        note: segment.edited_at ? `Updated ${ segment.edited_at }` : '',
      })),
    }
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of campaigns."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Lists the account's email campaigns (newest first) for selection in dependent parameters. Returns the campaign name as the label and the campaign id (UUID) as the value, with the current status as the note.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"July Newsletter","value":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","note":"DRAFT"}],"cursor":"bGltaXQ9NTAmbmV4dD0y"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getCampaignsDictionary',
      url: `${ API_BASE_URL }/emails`,
      query: { limit: 100, cursor },
    })

    const campaigns = Array.isArray(response.campaigns) ? response.campaigns : []

    const filtered = search
      ? campaigns.filter(campaign => campaign?.name && campaign.name.toLowerCase().includes(search.toLowerCase()))
      : campaigns

    return {
      cursor: this.#extractCursor(response),
      items: filtered.map(campaign => ({
        label: campaign.name,
        value: campaign.campaign_id,
        note: campaign.current_status || '',
      })),
    }
  }

  /**
   * @typedef {Object} getCustomFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter custom fields by label. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response, used to retrieve the next page of custom fields."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields Dictionary
   * @description Lists the account's contact custom fields for selection in dependent parameters. Returns the field label as the label and the custom field id (UUID) as the value, with the field type as the note.
   * @route POST /get-custom-fields-dictionary
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Membership Level","value":"c1f89af0-6c91-11ea-98c1-fa163e6b01c1","note":"string"}]}
   */
  async getCustomFieldsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getCustomFieldsDictionary',
      url: `${ API_BASE_URL }/contact_custom_fields`,
      query: { limit: 100, cursor },
    })

    const fields = Array.isArray(response.custom_fields) ? response.custom_fields : []

    const filtered = search
      ? fields.filter(field => field?.label && field.label.toLowerCase().includes(search.toLowerCase()))
      : fields

    return {
      cursor: this.#extractCursor(response),
      items: filtered.map(field => ({
        label: field.label,
        value: field.custom_field_id,
        note: field.type || '',
      })),
    }
  }

  // ============================================= ACCOUNT =============================================

  /**
   * @description Retrieves a summary of the connected Constant Contact account, including the organization name, contact email and phone, physical address country/state, time zone, and website. Useful as a connection check and for identifying which account is linked.
   *
   * @route GET /get-account-summary
   * @operationName Get Account Summary
   * @category Account
   *
   * @returns {Object}
   * @sampleResult {"contact_email":"owner@example.com","contact_phone":"555-017-2837","country_code":"US","encoded_account_id":"a07e1i1nxyz","first_name":"Jane","last_name":"Doe","organization_name":"Example Co","state_code":"MA","time_zone_id":"US/Eastern","website":"https://example.com"}
   */
  async getAccountSummary() {
    return this.#apiRequest({
      logTag: 'getAccountSummary',
      url: `${ API_BASE_URL }/account/summary`,
    })
  }

  // ============================================= CONTACTS ============================================

  /**
   * @description Retrieves contacts from the account, with optional filters by status, list membership, exact email address, and last-update time. Select sub-resources (custom fields, list memberships, phone numbers, street addresses) to embed in each contact. Returns up to 500 contacts per page; when more pages exist the response includes a top-level "cursor" convenience field to pass back through the Cursor parameter.
   *
   * @route GET /list-contacts
   * @operationName List Contacts
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Active","Deleted","Not Set","Pending Confirmation","Temporary Hold","Unsubscribed"]}},"description":"Optional email subscription status to filter by. When omitted, contacts of every status except deleted are returned."}
   * @paramDef {"type":"Array<String>","label":"Lists","name":"lists","dictionary":"getContactListsDictionary","description":"Optional contact list ids (UUIDs) to filter by; contacts belonging to any of the lists are returned. Up to 25 lists. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional exact email address to look up a single contact (e.g. 'jane@example.com')."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO-8601 date or date-time (e.g. 2026-07-01T00:00:00Z); only contacts updated after this moment are returned."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Fields","List Memberships","Phone Numbers","Street Addresses"]}},"description":"Optional contact sub-resources to embed in each returned contact."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page. Range: 1-500. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"contact_id":"2f67f3f0-cf51-11e9-bbee-fa163e56c9b0","email_address":{"address":"jane@example.com","permission_to_send":"implicit","confirm_status":"off"},"first_name":"Jane","last_name":"Doe","update_source":"Contact","create_source":"Account","created_at":"2026-01-15T10:12:00Z","updated_at":"2026-07-01T08:30:00Z"}],"contacts_count":1204,"cursor":"bGltaXQ9NTAmbmV4dD0y"}
   */
  async listContacts(status, lists, email, updatedAfter, include, limit, cursor) {
    const listIds = this.#toArray(lists)

    const response = await this.#apiRequest({
      logTag: 'listContacts',
      url: `${ API_BASE_URL }/contacts`,
      query: {
        status: this.#resolveChoice(status, CONTACT_STATUS_OPTIONS),
        lists: listIds.length ? listIds.join(',') : undefined,
        email,
        updated_after: updatedAfter,
        include: this.#resolveIncludeList(include),
        limit: limit || undefined,
        cursor,
      },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Retrieves a single contact by its id, including name, email address with permission status, and source/audit timestamps. Select sub-resources (custom fields, list memberships, phone numbers, street addresses) to embed in the result.
   *
   * @route GET /get-contact
   * @operationName Get Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact id (UUID) to retrieve. Use List Contacts with the Email filter to find a contact id by email address."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Fields","List Memberships","Phone Numbers","Street Addresses"]}},"description":"Optional contact sub-resources to embed in the returned contact."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"2f67f3f0-cf51-11e9-bbee-fa163e56c9b0","email_address":{"address":"jane@example.com","permission_to_send":"implicit","confirm_status":"off"},"first_name":"Jane","last_name":"Doe","job_title":"CTO","company_name":"Example Co","list_memberships":["8a3e5c60-53bc-11ec-b5f8-fa163e5bc304"],"created_at":"2026-01-15T10:12:00Z","updated_at":"2026-07-01T08:30:00Z"}
   */
  async getContact(contactId, include) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getContact',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      query: { include: this.#resolveIncludeList(include) },
    })
  }

  /**
   * @typedef {Object} CustomFieldValue
   * @paramDef {"type":"String","label":"Custom Field","name":"custom_field_id","required":true,"dictionary":"getCustomFieldsDictionary","description":"The custom field id (UUID)."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store in the custom field. For date fields use ISO-8601 format (e.g. 2026-07-01)."}
   */

  /**
   * @typedef {Object} StreetAddress
   * @paramDef {"type":"String","label":"Kind","name":"kind","uiComponent":{"type":"DROPDOWN","options":{"values":["Home","Work","Other"]}},"description":"The address kind. Default: 'Home'."}
   * @paramDef {"type":"String","label":"Street","name":"street","description":"The street address line."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The city name."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The state or province."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postal_code","description":"The ZIP or postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The country name or code."}
   */

  /**
   * @description Creates a new contact with an email address (stored with 'implicit' permission to send), optional profile fields, a phone number, street address, custom field values, and initial list memberships. Fails with a conflict error if a contact with the email already exists — use Create or Update Contact for upsert behavior. Returns the full created contact including its contact_id.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The contact's email address (e.g. 'jane@example.com'). Must be unique within the account."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"The contact's job title."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The name of the company the contact works for."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Optional phone number for the contact."}
   * @paramDef {"type":"String","label":"Phone Kind","name":"phoneKind","uiComponent":{"type":"DROPDOWN","options":{"values":["Home","Work","Mobile","Other"]}},"description":"The kind of the phone number. Default: 'Other'."}
   * @paramDef {"type":"Array<String>","label":"List Memberships","name":"listMemberships","dictionary":"getContactListsDictionary","description":"Optional contact list ids (UUIDs) to add the new contact to. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"Array<CustomFieldValue>","label":"Custom Fields","name":"customFields","description":"Optional custom field values to set on the contact."}
   * @paramDef {"type":"StreetAddress","label":"Street Address","name":"streetAddress","description":"Optional street address for the contact (a contact can have one street address)."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"2f67f3f0-cf51-11e9-bbee-fa163e56c9b0","email_address":{"address":"jane@example.com","permission_to_send":"implicit","confirm_status":"off"},"first_name":"Jane","last_name":"Doe","create_source":"Account","created_at":"2026-07-15T10:12:00Z","updated_at":"2026-07-15T10:12:00Z"}
   */
  async createContact(email, firstName, lastName, jobTitle, companyName, phoneNumber, phoneKind, listMemberships, customFields, streetAddress) {
    if (!email) {
      throw new Error('"Email" is required')
    }

    const listIds = this.#toArray(listMemberships)

    const body = cleanupObject({
      email_address: { address: email, permission_to_send: 'implicit' },
      first_name: firstName,
      last_name: lastName,
      job_title: jobTitle,
      company_name: companyName,
      create_source: 'Account',
      phone_numbers: phoneNumber
        ? [{ phone_number: phoneNumber, kind: this.#resolveChoice(phoneKind, PHONE_KIND_OPTIONS) || 'other' }]
        : undefined,
      list_memberships: listIds.length ? listIds : undefined,
      custom_fields: this.#buildCustomFields(customFields),
      street_addresses: this.#buildStreetAddresses(streetAddress),
    })

    return this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ API_BASE_URL }/contacts`,
      body,
    })
  }

  /**
   * @description Updates an existing contact by id. The underlying API performs a full replace, so this action first fetches the contact (with custom fields, list memberships, phone numbers, and street addresses) and merges your changes into it — omitted parameters keep their current values, making this behave like a partial update. Provided custom field values are merged by field id; a provided phone number replaces the contact's primary phone; provided list memberships replace the full membership set. Returns the updated contact.
   *
   * @route PUT /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact id (UUID) to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional new email address for the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Optional new first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Optional new last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"Optional new job title."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Optional new company name."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Optional phone number; replaces the contact's primary phone number."}
   * @paramDef {"type":"String","label":"Phone Kind","name":"phoneKind","uiComponent":{"type":"DROPDOWN","options":{"values":["Home","Work","Mobile","Other"]}},"description":"The kind of the provided phone number. When omitted, the existing kind (or 'Other') is used."}
   * @paramDef {"type":"Array<String>","label":"List Memberships","name":"listMemberships","dictionary":"getContactListsDictionary","description":"Optional contact list ids (UUIDs); when provided, REPLACES the contact's entire list membership set. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"Array<CustomFieldValue>","label":"Custom Fields","name":"customFields","description":"Optional custom field values; merged into the contact's existing custom field values by field id."}
   * @paramDef {"type":"StreetAddress","label":"Street Address","name":"streetAddress","description":"Optional street address; replaces the contact's existing street address."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"2f67f3f0-cf51-11e9-bbee-fa163e56c9b0","email_address":{"address":"jane@example.com","permission_to_send":"implicit","confirm_status":"off"},"first_name":"Jane","last_name":"Smith","job_title":"CEO","update_source":"Account","updated_at":"2026-07-16T09:00:00Z"}
   */
  async updateContact(contactId, email, firstName, lastName, jobTitle, companyName, phoneNumber, phoneKind, listMemberships, customFields, streetAddress) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    const existing = await this.#apiRequest({
      logTag: 'updateContact:fetch',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      query: { include: CONTACT_MERGE_INCLUDE },
    })

    // Phone numbers: a provided number replaces the primary entry, other entries are preserved.
    let phoneNumbers = (existing.phone_numbers || [])
      .filter(phone => phone && phone.phone_number)
      .map(phone => cleanupObject({ phone_number: phone.phone_number, kind: phone.kind || 'other' }))

    if (phoneNumber) {
      const entry = {
        phone_number: phoneNumber,
        kind: this.#resolveChoice(phoneKind, PHONE_KIND_OPTIONS) || phoneNumbers[0]?.kind || 'other',
      }

      phoneNumbers = [entry, ...phoneNumbers.slice(1)]
    }

    // Custom fields: provided values are merged into existing ones by field id.
    const mergedCustomFields = new Map(
      (existing.custom_fields || [])
        .filter(field => field && field.custom_field_id)
        .map(field => [field.custom_field_id, { custom_field_id: field.custom_field_id, value: field.value }])
    )

    for (const field of this.#buildCustomFields(customFields) || []) {
      mergedCustomFields.set(field.custom_field_id, field)
    }

    const providedListIds = this.#toArray(listMemberships)
    const listIds = providedListIds.length ? providedListIds : (existing.list_memberships || [])

    const streetAddresses = this.#buildStreetAddresses(streetAddress) ||
      (existing.street_addresses || []).map(address => cleanupObject({
        kind: address.kind || 'home',
        street: address.street,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country,
      }))

    const body = cleanupObject({
      update_source: 'Account',
      email_address: {
        address: email || existing.email_address?.address,
        permission_to_send: existing.email_address?.permission_to_send || 'implicit',
      },
      first_name: firstName !== undefined && firstName !== '' ? firstName : existing.first_name,
      last_name: lastName !== undefined && lastName !== '' ? lastName : existing.last_name,
      job_title: jobTitle !== undefined && jobTitle !== '' ? jobTitle : existing.job_title,
      company_name: companyName !== undefined && companyName !== '' ? companyName : existing.company_name,
      birthday_month: existing.birthday_month,
      birthday_day: existing.birthday_day,
      anniversary: existing.anniversary,
      phone_numbers: phoneNumbers.length ? phoneNumbers : undefined,
      list_memberships: listIds.length ? listIds : undefined,
      custom_fields: mergedCustomFields.size ? [...mergedCustomFields.values()] : undefined,
      street_addresses: streetAddresses && streetAddresses.length ? streetAddresses : undefined,
    })

    return this.#apiRequest({
      logTag: 'updateContact',
      method: 'put',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      body,
    })
  }

  /**
   * @description Deletes a contact by id. The contact's status becomes 'deleted', they are removed from all contact lists, and they no longer receive emails; historical tracking data is retained and deleted contacts can be reactivated by re-adding them. Returns a success status (the API returns no content).
   *
   * @route DELETE /delete-contact
   * @operationName Delete Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact id (UUID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteContact(contactId) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
    })
  }

  /**
   * @description Creates a new contact or updates an existing one, matched by email address (upsert). This is the simplest way to add subscribers: at least one contact list is required, and provided name fields update the existing contact when it already exists. Returns the contact_id and an "action" of either 'created' or 'updated'.
   *
   * @route POST /create-or-update-contact
   * @operationName Create or Update Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The contact's email address, used to identify the contact (e.g. 'jane@example.com')."}
   * @paramDef {"type":"Array<String>","label":"List Memberships","name":"listMemberships","required":true,"dictionary":"getContactListsDictionary","description":"Contact list ids (UUIDs) to add the contact to. At least 1 and at most 50 lists. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Optional first name; updates the existing value when the contact already exists."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Optional last name; updates the existing value when the contact already exists."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"2f67f3f0-cf51-11e9-bbee-fa163e56c9b0","action":"updated"}
   */
  async createOrUpdateContact(email, listMemberships, firstName, lastName) {
    if (!email) {
      throw new Error('"Email" is required')
    }

    const listIds = this.#toArray(listMemberships)

    if (!listIds.length) {
      throw new Error('At least one list in "List Memberships" is required')
    }

    const body = cleanupObject({
      email_address: email,
      first_name: firstName,
      last_name: lastName,
      list_memberships: listIds,
    })

    return this.#apiRequest({
      logTag: 'createOrUpdateContact',
      method: 'post',
      url: `${ API_BASE_URL }/contacts/sign_up_form`,
      body,
    })
  }

  // =========================================== CONTACT LISTS =========================================

  /**
   * @description Retrieves the account's contact lists (up to 1000 per account) with name, description, favorite flag, and audit timestamps. Optionally includes the total list count and per-list membership counts (all or active-only members).
   *
   * @route GET /list-contact-lists
   * @operationName List Contact Lists
   * @category Contact Lists
   *
   * @paramDef {"type":"Boolean","label":"Include Count","name":"includeCount","uiComponent":{"type":"CHECKBOX"},"description":"Whether to include the total number of contact lists (lists_count) in the response."}
   * @paramDef {"type":"String","label":"Include Membership Count","name":"includeMembershipCount","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Active"]}},"description":"Optionally include each list's membership_count, counting either all members or only active (subscribed) members."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of lists to return. Range: 1-1000. Default: 50."}
   *
   * @returns {Object}
   * @sampleResult {"lists":[{"list_id":"8a3e5c60-53bc-11ec-b5f8-fa163e5bc304","name":"Newsletter Subscribers","description":"Main newsletter audience","favorite":true,"membership_count":1204,"created_at":"2025-11-01T12:00:00Z","updated_at":"2026-07-01T08:30:00Z"}],"lists_count":6}
   */
  async listContactLists(includeCount, includeMembershipCount, limit) {
    return this.#apiRequest({
      logTag: 'listContactLists',
      url: `${ API_BASE_URL }/contact_lists`,
      query: {
        include_count: includeCount === undefined ? undefined : Boolean(includeCount),
        include_membership_count: this.#resolveChoice(includeMembershipCount, MEMBERSHIP_COUNT_OPTIONS),
        limit: limit || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single contact list by id, including its name, description, favorite flag, and audit timestamps. Optionally includes the list's membership count (all or active-only members).
   *
   * @route GET /get-contact-list
   * @operationName Get Contact List
   * @category Contact Lists
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getContactListsDictionary","description":"The contact list id (UUID) to retrieve."}
   * @paramDef {"type":"String","label":"Include Membership Count","name":"includeMembershipCount","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Active"]}},"description":"Optionally include the list's membership_count, counting either all members or only active (subscribed) members."}
   *
   * @returns {Object}
   * @sampleResult {"list_id":"8a3e5c60-53bc-11ec-b5f8-fa163e5bc304","name":"Newsletter Subscribers","description":"Main newsletter audience","favorite":true,"membership_count":1204,"created_at":"2025-11-01T12:00:00Z","updated_at":"2026-07-01T08:30:00Z"}
   */
  async getContactList(listId, includeMembershipCount) {
    if (!listId) {
      throw new Error('"List" is required')
    }

    return this.#apiRequest({
      logTag: 'getContactList',
      url: `${ API_BASE_URL }/contact_lists/${ encodeURIComponent(listId) }`,
      query: { include_membership_count: this.#resolveChoice(includeMembershipCount, MEMBERSHIP_COUNT_OPTIONS) },
    })
  }

  /**
   * @description Creates a new contact list with a name (must be unique in the account) and optional description and favorite flag. An account can have up to 1000 lists. Returns the created list including its list_id.
   *
   * @route POST /create-contact-list
   * @operationName Create Contact List
   * @category Contact Lists
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new list. Maximum 255 characters; must be unique within the account."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional internal description of the list, visible only inside the Constant Contact account."}
   * @paramDef {"type":"Boolean","label":"Favorite","name":"favorite","uiComponent":{"type":"CHECKBOX"},"description":"Whether to mark the list as a favorite. Default: false."}
   *
   * @returns {Object}
   * @sampleResult {"list_id":"8a3e5c60-53bc-11ec-b5f8-fa163e5bc304","name":"Webinar Attendees","description":"Signed up via July webinar","favorite":false,"created_at":"2026-07-15T10:12:00Z","updated_at":"2026-07-15T10:12:00Z"}
   */
  async createContactList(name, description, favorite) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const body = cleanupObject({
      name,
      description,
      favorite: favorite === undefined ? undefined : Boolean(favorite),
    })

    return this.#apiRequest({
      logTag: 'createContactList',
      method: 'post',
      url: `${ API_BASE_URL }/contact_lists`,
      body,
    })
  }

  /**
   * @description Updates an existing contact list's name, description, and/or favorite flag. The underlying API performs a full replace, so this action first fetches the list and merges your changes — omitted parameters keep their current values. Returns the updated list.
   *
   * @route PUT /update-contact-list
   * @operationName Update Contact List
   * @category Contact Lists
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getContactListsDictionary","description":"The contact list id (UUID) to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name for the list. Maximum 255 characters; must be unique within the account."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new internal description of the list."}
   * @paramDef {"type":"Boolean","label":"Favorite","name":"favorite","uiComponent":{"type":"CHECKBOX"},"description":"Optional new favorite setting for the list."}
   *
   * @returns {Object}
   * @sampleResult {"list_id":"8a3e5c60-53bc-11ec-b5f8-fa163e5bc304","name":"Newsletter Subscribers (2026)","description":"Main newsletter audience","favorite":true,"updated_at":"2026-07-16T09:00:00Z"}
   */
  async updateContactList(listId, name, description, favorite) {
    if (!listId) {
      throw new Error('"List" is required')
    }

    const existing = await this.#apiRequest({
      logTag: 'updateContactList:fetch',
      url: `${ API_BASE_URL }/contact_lists/${ encodeURIComponent(listId) }`,
    })

    const body = cleanupObject({
      name: name || existing.name,
      description: description !== undefined && description !== '' ? description : existing.description,
      favorite: favorite === undefined ? existing.favorite : Boolean(favorite),
    })

    return this.#apiRequest({
      logTag: 'updateContactList',
      method: 'put',
      url: `${ API_BASE_URL }/contact_lists/${ encodeURIComponent(listId) }`,
      body,
    })
  }

  /**
   * @description Deletes a contact list by id. Contacts that belong to the list are NOT deleted, only their membership in this list is removed. The deletion runs as an asynchronous background activity; the returned activity can be monitored with Get Activity Status.
   *
   * @route DELETE /delete-contact-list
   * @operationName Delete Contact List
   * @category Contact Lists
   *
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getContactListsDictionary","description":"The contact list id (UUID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"activity_id":"eb9dbd1a-fcb6-45ee-ae2d-1d0bb63fbc93","state":"processing","created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:00Z","percent_done":1,"activity_errors":[],"status":{"list_count":1}}
   */
  async deleteContactList(listId) {
    if (!listId) {
      throw new Error('"List" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteContactList',
      method: 'delete',
      url: `${ API_BASE_URL }/contact_lists/${ encodeURIComponent(listId) }`,
    })
  }

  /**
   * @description Adds up to 500 contacts to up to 50 contact lists in a single call. This runs as an asynchronous background activity — the returned activity object (with activity_id, state, and percent_done) can be monitored with Get Activity Status until its state is 'completed'.
   *
   * @route POST /add-contacts-to-lists
   * @operationName Add Contacts to Lists
   * @category Contact Lists
   *
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","required":true,"description":"The contact ids (UUIDs) to add. Maximum 500 per request. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"Array<String>","label":"Lists","name":"listIds","required":true,"dictionary":"getContactListsDictionary","description":"The contact list ids (UUIDs) to add the contacts to. Maximum 50 per request. Accepts a list or comma-separated ids."}
   *
   * @returns {Object}
   * @sampleResult {"activity_id":"eb9dbd1a-fcb6-45ee-ae2d-1d0bb63fbc93","state":"initialized","created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:00Z","percent_done":1,"activity_errors":[],"status":{"items_total_count":25,"list_count":2}}
   */
  async addContactsToLists(contactIds, listIds) {
    return this.#listMembershipActivity('add_list_memberships', contactIds, listIds, 'addContactsToLists')
  }

  /**
   * @description Removes up to 500 contacts from up to 50 contact lists in a single call. The contacts themselves are not deleted. This runs as an asynchronous background activity — the returned activity object can be monitored with Get Activity Status until its state is 'completed'.
   *
   * @route POST /remove-contacts-from-lists
   * @operationName Remove Contacts from Lists
   * @category Contact Lists
   *
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","required":true,"description":"The contact ids (UUIDs) to remove. Maximum 500 per request. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"Array<String>","label":"Lists","name":"listIds","required":true,"dictionary":"getContactListsDictionary","description":"The contact list ids (UUIDs) to remove the contacts from. Maximum 50 per request. Accepts a list or comma-separated ids."}
   *
   * @returns {Object}
   * @sampleResult {"activity_id":"a7f4d880-3ea9-4b39-b405-b26a5e1a4f95","state":"initialized","created_at":"2026-07-16T09:05:00Z","updated_at":"2026-07-16T09:05:00Z","percent_done":1,"activity_errors":[],"status":{"items_total_count":25,"list_count":2}}
   */
  async removeContactsFromLists(contactIds, listIds) {
    return this.#listMembershipActivity('remove_list_memberships', contactIds, listIds, 'removeContactsFromLists')
  }

  async #listMembershipActivity(activity, contactIds, listIds, logTag) {
    const contacts = this.#toArray(contactIds)
    const lists = this.#toArray(listIds)

    if (!contacts.length) {
      throw new Error('At least one contact in "Contact IDs" is required')
    }

    if (!lists.length) {
      throw new Error('At least one list in "Lists" is required')
    }

    return this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/activities/${ activity }`,
      body: {
        source: { contact_ids: contacts },
        list_ids: lists,
      },
    })
  }

  /**
   * @description Retrieves the status of an asynchronous background activity (such as Add Contacts to Lists, Remove Contacts from Lists, or Delete Contact List) by its activity id. The state progresses from 'initialized'/'processing' to 'completed', 'cancelled', 'failed', or 'timed_out'; percent_done and activity_errors provide progress detail.
   *
   * @route GET /get-activity-status
   * @operationName Get Activity Status
   * @category Contact Lists
   *
   * @paramDef {"type":"String","label":"Activity ID","name":"activityId","required":true,"description":"The activity id (UUID) returned by an asynchronous bulk action."}
   *
   * @returns {Object}
   * @sampleResult {"activity_id":"eb9dbd1a-fcb6-45ee-ae2d-1d0bb63fbc93","state":"completed","started_at":"2026-07-16T09:00:05Z","completed_at":"2026-07-16T09:00:12Z","created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:12Z","percent_done":100,"activity_errors":[],"status":{"items_total_count":25,"items_completed_count":25,"list_count":2}}
   */
  async getActivityStatus(activityId) {
    if (!activityId) {
      throw new Error('"Activity ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getActivityStatus',
      url: `${ API_BASE_URL }/activities/${ encodeURIComponent(activityId) }`,
    })
  }

  // =========================================== CUSTOM FIELDS =========================================

  /**
   * @description Retrieves the account's contact custom fields, including each field's label, generated internal name, type (string or date), and audit timestamps. Returns up to 100 fields per page with a top-level "cursor" convenience field when more pages exist.
   *
   * @route GET /list-custom-fields
   * @operationName List Custom Fields
   * @category Custom Fields
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of custom fields per page. Range: 1-100. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"custom_fields":[{"custom_field_id":"c1f89af0-6c91-11ea-98c1-fa163e6b01c1","label":"Membership Level","name":"membership_level","type":"string","updated_at":"2026-01-10T12:00:00Z","created_at":"2025-03-20T12:00:00Z"}]}
   */
  async listCustomFields(limit, cursor) {
    const response = await this.#apiRequest({
      logTag: 'listCustomFields',
      url: `${ API_BASE_URL }/contact_custom_fields`,
      query: { limit: limit || undefined, cursor },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Creates a new contact custom field with a display label and a data type of either Text (free-form string) or Date. An account can have up to 100 custom fields. Returns the created field including its custom_field_id, which is used when setting values on contacts.
   *
   * @route POST /create-custom-field
   * @operationName Create Custom Field
   * @category Custom Fields
   *
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"description":"The display name for the custom field, shown in the Constant Contact UI. Maximum 50 characters; must be unique within the account."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Date"]}},"description":"The data type of the field: 'Text' for free-form string values or 'Date' for date values."}
   *
   * @returns {Object}
   * @sampleResult {"custom_field_id":"c1f89af0-6c91-11ea-98c1-fa163e6b01c1","label":"Membership Level","name":"membership_level","type":"string","updated_at":"2026-07-16T09:00:00Z","created_at":"2026-07-16T09:00:00Z"}
   */
  async createCustomField(label, type) {
    if (!label) {
      throw new Error('"Label" is required')
    }

    return this.#apiRequest({
      logTag: 'createCustomField',
      method: 'post',
      url: `${ API_BASE_URL }/contact_custom_fields`,
      body: {
        label,
        type: this.#resolveChoice(type, CUSTOM_FIELD_TYPE_OPTIONS) || 'string',
      },
    })
  }

  /**
   * @description Deletes a contact custom field by id. The field and all values stored in it are removed from every contact in the account; this cannot be undone. Returns a success status (the API returns no content).
   *
   * @route DELETE /delete-custom-field
   * @operationName Delete Custom Field
   * @category Custom Fields
   *
   * @paramDef {"type":"String","label":"Custom Field","name":"customFieldId","required":true,"dictionary":"getCustomFieldsDictionary","description":"The custom field id (UUID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteCustomField(customFieldId) {
    if (!customFieldId) {
      throw new Error('"Custom Field" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteCustomField',
      method: 'delete',
      url: `${ API_BASE_URL }/contact_custom_fields/${ encodeURIComponent(customFieldId) }`,
    })
  }

  // ================================================ TAGS =============================================

  /**
   * @description Retrieves the account's contact tags, including each tag's name, id, and source. Returns up to 500 tags per page with a top-level "cursor" convenience field when more pages exist. Optionally includes the number of contacts assigned to each tag.
   *
   * @route GET /list-tags
   * @operationName List Tags
   * @category Tags
   *
   * @paramDef {"type":"Boolean","label":"Include Contacts Count","name":"includeCount","uiComponent":{"type":"CHECKBOX"},"description":"Whether to include the number of contacts assigned to each tag (contacts_count)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags per page. Range: 1-500. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"tags":[{"tag_id":"27a11a10-4bfa-11ec-b1d4-fa163e5bc304","name":"VIP","tag_source":"Account","contacts_count":37,"created_at":"2026-02-01T12:00:00Z","updated_at":"2026-07-01T08:30:00Z"}]}
   */
  async listTags(includeCount, limit, cursor) {
    const response = await this.#apiRequest({
      logTag: 'listTags',
      url: `${ API_BASE_URL }/contact_tags`,
      query: {
        include_count: includeCount === undefined ? undefined : Boolean(includeCount),
        limit: limit || undefined,
        cursor,
      },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Creates a new contact tag with the given name. Tags provide a flexible way to label and group contacts without using lists. Returns the created tag including its tag_id.
   *
   * @route POST /create-tag
   * @operationName Create Tag
   * @category Tags
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new tag. Maximum 255 characters; must be unique within the account."}
   *
   * @returns {Object}
   * @sampleResult {"tag_id":"27a11a10-4bfa-11ec-b1d4-fa163e5bc304","name":"VIP","tag_source":"Account","created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:00Z"}
   */
  async createTag(name) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'createTag',
      method: 'post',
      url: `${ API_BASE_URL }/contact_tags`,
      body: { name },
    })
  }

  /**
   * @description Deletes a contact tag by id and removes it from all contacts it is assigned to. The removal runs as an asynchronous background activity; the returned activity can be monitored with Get Activity Status.
   *
   * @route DELETE /delete-tag
   * @operationName Delete Tag
   * @category Tags
   *
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag id (UUID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"activity_id":"f2e04bd0-3f1a-4be9-9426-b41c62e5c2f1","state":"processing","created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:00Z","percent_done":1,"activity_errors":[]}
   */
  async deleteTag(tagId) {
    if (!tagId) {
      throw new Error('"Tag" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteTag',
      method: 'delete',
      url: `${ API_BASE_URL }/contact_tags/${ encodeURIComponent(tagId) }`,
    })
  }

  // ============================================= SEGMENTS ============================================

  /**
   * @description Retrieves the account's segments (saved dynamic groups of contacts based on criteria), sorted by last-update date (newest first) or by name. Includes each segment's name, numeric id, and edit timestamps, plus a top-level "cursor" convenience field when more pages exist.
   *
   * @route GET /list-segments
   * @operationName List Segments
   * @category Segments
   *
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date Updated","Name"]}},"description":"Sort order: 'Date Updated' returns the most recently updated segments first (default); 'Name' sorts alphabetically."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"segments":[{"name":"Recently Engaged","segment_id":14,"created_at":"2026-05-01T12:00:00Z","edited_at":"2026-06-10T15:30:00Z"}]}
   */
  async listSegments(sortBy, cursor) {
    const response = await this.#apiRequest({
      logTag: 'listSegments',
      url: `${ API_BASE_URL }/segments`,
      query: {
        sort_by: this.#resolveChoice(sortBy, SEGMENT_SORT_OPTIONS),
        cursor,
      },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Retrieves a single segment by its numeric id, including its name, full segment_criteria (as a JSON string), and edit timestamps.
   *
   * @route GET /get-segment
   * @operationName Get Segment
   * @category Segments
   *
   * @paramDef {"type":"Number","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The numeric segment id to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Recently Engaged","segment_criteria":"{\"version\":\"1.0.0\",\"criteria\":{\"type\":\"and\",\"group\":[{\"source\":\"tracking\",\"field\":\"opens\",\"op\":\"gte\",\"value\":1}]}}","segment_id":14,"created_at":"2026-05-01T12:00:00Z","edited_at":"2026-06-10T15:30:00Z"}
   */
  async getSegment(segmentId) {
    if (segmentId === undefined || segmentId === null || segmentId === '') {
      throw new Error('"Segment" is required')
    }

    return this.#apiRequest({
      logTag: 'getSegment',
      url: `${ API_BASE_URL }/segments/${ encodeURIComponent(segmentId) }`,
    })
  }

  /**
   * @description Creates a new segment from a unique name and segment criteria. The criteria must be a single-string JSON document following Constant Contact's segment criteria schema (e.g. {"version":"1.0.0","criteria":{...}}); this action validates that the provided string parses as JSON before sending. Returns the created segment including its numeric segment_id.
   *
   * @route POST /create-segment
   * @operationName Create Segment
   * @category Segments
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The unique name for the segment. Maximum 80 characters."}
   * @paramDef {"type":"String","label":"Segment Criteria","name":"segmentCriteria","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The segment criteria as a JSON string following Constant Contact's segment criteria schema, e.g. {\"version\":\"1.0.0\",\"criteria\":{\"type\":\"and\",\"group\":[...]}}. See the Constant Contact segmentation documentation for the full schema."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Recently Engaged","segment_criteria":"{\"version\":\"1.0.0\",\"criteria\":{\"type\":\"and\",\"group\":[{\"source\":\"tracking\",\"field\":\"opens\",\"op\":\"gte\",\"value\":1}]}}","segment_id":14,"created_at":"2026-07-16T09:00:00Z","edited_at":"2026-07-16T09:00:00Z"}
   */
  async createSegment(name, segmentCriteria) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    if (!segmentCriteria) {
      throw new Error('"Segment Criteria" is required')
    }

    return this.#apiRequest({
      logTag: 'createSegment',
      method: 'post',
      url: `${ API_BASE_URL }/segments`,
      body: {
        name,
        segment_criteria: this.#normalizeSegmentCriteria(segmentCriteria),
      },
    })
  }

  // The API requires segment_criteria as a single JSON string. Accept an object (stringify it)
  // or a string (validate that it parses as JSON) so malformed criteria fail fast with a clear error.
  #normalizeSegmentCriteria(segmentCriteria) {
    if (typeof segmentCriteria === 'object') {
      return JSON.stringify(segmentCriteria)
    }

    try {
      JSON.parse(segmentCriteria)
    } catch (error) {
      throw new Error(`"Segment Criteria" must be a valid JSON string: ${ error.message }`)
    }

    return segmentCriteria
  }

  /**
   * @description Renames an existing segment without changing its criteria. Returns the segment with its updated name.
   *
   * @route PATCH /update-segment-name
   * @operationName Update Segment Name
   * @category Segments
   *
   * @paramDef {"type":"Number","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The numeric segment id to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new unique name for the segment. Maximum 80 characters."}
   *
   * @returns {Object}
   * @sampleResult {"name":"Highly Engaged (2026)","segment_id":14,"created_at":"2026-05-01T12:00:00Z","edited_at":"2026-07-16T09:00:00Z"}
   */
  async updateSegmentName(segmentId, name) {
    if (segmentId === undefined || segmentId === null || segmentId === '') {
      throw new Error('"Segment" is required')
    }

    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'updateSegmentName',
      method: 'patch',
      url: `${ API_BASE_URL }/segments/${ encodeURIComponent(segmentId) }/name`,
      body: { name },
    })
  }

  /**
   * @description Deletes a segment by its numeric id. Contacts matched by the segment are not affected. Returns a success status (the API returns no content).
   *
   * @route DELETE /delete-segment
   * @operationName Delete Segment
   * @category Segments
   *
   * @paramDef {"type":"Number","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The numeric segment id to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteSegment(segmentId) {
    if (segmentId === undefined || segmentId === null || segmentId === '') {
      throw new Error('"Segment" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteSegment',
      method: 'delete',
      url: `${ API_BASE_URL }/segments/${ encodeURIComponent(segmentId) }`,
    })
  }

  // ========================================== EMAIL CAMPAIGNS ========================================

  /**
   * @description Retrieves the account's email campaigns (newest first), including each campaign's name, id, type, and current status (Draft, Scheduled, Executing, Done, Error, Removed). Optionally filter by creation date range. Returns up to 500 campaigns per page with a top-level "cursor" convenience field when more pages exist.
   *
   * @route GET /list-campaigns
   * @operationName List Campaigns
   * @category Email Campaigns
   *
   * @paramDef {"type":"String","label":"After Date","name":"afterDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO-8601 date or date-time; only campaigns created after this moment are returned."}
   * @paramDef {"type":"String","label":"Before Date","name":"beforeDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO-8601 date or date-time; only campaigns created before this moment are returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of campaigns per page. Range: 1-500. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"campaigns":[{"campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","name":"July Newsletter","current_status":"DRAFT","type":"CUSTOM_CODE_EMAIL","type_code":19,"created_at":"2026-07-10T12:00:00Z","updated_at":"2026-07-15T08:30:00Z"}],"cursor":"bGltaXQ9NTAmbmV4dD0y"}
   */
  async listCampaigns(afterDate, beforeDate, limit, cursor) {
    const response = await this.#apiRequest({
      logTag: 'listCampaigns',
      url: `${ API_BASE_URL }/emails`,
      query: {
        after_date: afterDate,
        before_date: beforeDate,
        limit: limit || undefined,
        cursor,
      },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Retrieves a single email campaign by id, including its name, status, and its campaign_activities array. Each activity has a role — the activity with role 'primary_email' is the one to use with the Campaign Activities actions (update content, send tests, schedule); 'permalink' is the web view.
   *
   * @route GET /get-campaign
   * @operationName Get Campaign
   * @category Email Campaigns
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The email campaign id (UUID) to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","name":"July Newsletter","current_status":"DRAFT","type":"CUSTOM_CODE_EMAIL","type_code":19,"created_at":"2026-07-10T12:00:00Z","updated_at":"2026-07-15T08:30:00Z","campaign_activities":[{"campaign_activity_id":"06a7a92a-2b9c-4f60-a205-c7a02fe0a2a9","role":"primary_email"},{"campaign_activity_id":"b1f9d3c1-13c9-4d84-8f5f-6e2a7c9f2c11","role":"permalink"}]}
   */
  async getCampaign(campaignId) {
    if (!campaignId) {
      throw new Error('"Campaign" is required')
    }

    return this.#apiRequest({
      logTag: 'getCampaign',
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(campaignId) }`,
    })
  }

  /**
   * @description Creates a new email campaign with a custom-code HTML email (format_type 5). The from address must be an email address verified in the Constant Contact account. The HTML content should include the required '[[trackingImage]]' token and an unsubscribe link for best deliverability. Returns the created campaign with its campaign_activities — use the 'primary_email' activity id to set recipients (Update Campaign Activity), send tests, and schedule.
   *
   * @route POST /create-campaign
   * @operationName Create Campaign
   * @category Email Campaigns
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The internal campaign name. Maximum 80 characters; must be unique within the account."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","required":true,"description":"The sender name recipients see (e.g. 'Example Co Marketing')."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"description":"The sender email address. Must be verified in the Constant Contact account."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The email subject line."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlContent","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The full HTML body of the email (custom code email). Include the '[[trackingImage]]' token to enable open tracking. Maximum 150000 characters."}
   * @paramDef {"type":"String","label":"Reply-To Email","name":"replyToEmail","description":"Optional reply-to email address. Must be verified in the account. Defaults to the From Email."}
   * @paramDef {"type":"String","label":"Preheader","name":"preheader","description":"Optional preview text shown after the subject line in most inboxes."}
   *
   * @returns {Object}
   * @sampleResult {"campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","name":"July Newsletter","current_status":"Draft","type":"CUSTOM_CODE_EMAIL","type_code":19,"created_at":"2026-07-16T09:00:00Z","updated_at":"2026-07-16T09:00:00Z","campaign_activities":[{"campaign_activity_id":"06a7a92a-2b9c-4f60-a205-c7a02fe0a2a9","role":"primary_email"}]}
   */
  async createCampaign(name, fromName, fromEmail, subject, htmlContent, replyToEmail, preheader) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    if (!fromName || !fromEmail || !subject || !htmlContent) {
      throw new Error('"From Name", "From Email", "Subject" and "HTML Content" are required')
    }

    return this.#apiRequest({
      logTag: 'createCampaign',
      method: 'post',
      url: `${ API_BASE_URL }/emails`,
      body: {
        name,
        email_campaign_activities: [cleanupObject({
          format_type: 5,
          from_name: fromName,
          from_email: fromEmail,
          reply_to_email: replyToEmail || fromEmail,
          subject,
          preheader,
          html_content: htmlContent,
        })],
      },
    })
  }

  /**
   * @description Renames an existing email campaign without changing its content or schedule. Returns a success status (the API returns no content).
   *
   * @route PATCH /update-campaign-name
   * @operationName Update Campaign Name
   * @category Email Campaigns
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The email campaign id (UUID) to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new internal campaign name. Maximum 80 characters; must be unique within the account."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async updateCampaignName(campaignId, name) {
    if (!campaignId) {
      throw new Error('"Campaign" is required')
    }

    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'updateCampaignName',
      method: 'patch',
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(campaignId) }`,
      body: { name },
    })
  }

  /**
   * @description Deletes an email campaign and all of its activities by campaign id. Sent campaigns are moved to a 'Removed' status. Returns a success status (the API returns no content).
   *
   * @route DELETE /delete-campaign
   * @operationName Delete Campaign
   * @category Email Campaigns
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The email campaign id (UUID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteCampaign(campaignId) {
    if (!campaignId) {
      throw new Error('"Campaign" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteCampaign',
      method: 'delete',
      url: `${ API_BASE_URL }/emails/${ encodeURIComponent(campaignId) }`,
    })
  }

  // ======================================== CAMPAIGN ACTIVITIES ======================================

  /**
   * @description Retrieves a single email campaign activity by id, including sender details, subject, preheader, HTML content, current status, and the contact lists / segments it will be sent to. Use Get Campaign to find the activity id with role 'primary_email'.
   *
   * @route GET /get-campaign-activity
   * @operationName Get Campaign Activity
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID). Use Get Campaign and pick the activity with role 'primary_email'."}
   *
   * @returns {Object}
   * @sampleResult {"campaign_activity_id":"06a7a92a-2b9c-4f60-a205-c7a02fe0a2a9","campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","role":"primary_email","current_status":"DRAFT","format_type":5,"from_name":"Example Co Marketing","from_email":"marketing@example.com","reply_to_email":"marketing@example.com","subject":"Our July News","preheader":"Fresh updates inside","contact_list_ids":["8a3e5c60-53bc-11ec-b5f8-fa163e5bc304"],"segment_ids":[]}
   */
  async getCampaignActivity(campaignActivityId) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getCampaignActivity',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }`,
    })
  }

  /**
   * @description Updates an email campaign activity's sender details, subject, preheader, HTML content, and/or recipients (contact lists and segments). The underlying API performs a full replace, so this action first fetches the activity and merges your changes into it — omitted parameters keep their current values. Only draft (unsent, unscheduled) activities can be updated. Setting recipients here is required before the campaign can be scheduled.
   *
   * @route PUT /update-campaign-activity
   * @operationName Update Campaign Activity
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID) to update. Use Get Campaign and pick the activity with role 'primary_email'."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","description":"Optional new sender name recipients see."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","description":"Optional new sender email address. Must be verified in the Constant Contact account."}
   * @paramDef {"type":"String","label":"Reply-To Email","name":"replyToEmail","description":"Optional new reply-to email address. Must be verified in the account."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional new email subject line."}
   * @paramDef {"type":"String","label":"Preheader","name":"preheader","description":"Optional new preview text shown after the subject line in most inboxes."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new full HTML body of the email. Include the '[[trackingImage]]' token to enable open tracking."}
   * @paramDef {"type":"Array<String>","label":"Contact Lists","name":"contactListIds","dictionary":"getContactListsDictionary","description":"Optional contact list ids (UUIDs) to send the campaign to; when provided, REPLACES the activity's current list selection. Accepts a list or comma-separated ids."}
   * @paramDef {"type":"Array<String>","label":"Segments","name":"segmentIds","dictionary":"getSegmentsDictionary","description":"Optional segment ids to send the campaign to; when provided, REPLACES the activity's current segment selection (a campaign is sent to either lists or one segment)."}
   *
   * @returns {Object}
   * @sampleResult {"campaign_activity_id":"06a7a92a-2b9c-4f60-a205-c7a02fe0a2a9","campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","role":"primary_email","current_status":"DRAFT","format_type":5,"from_name":"Example Co Marketing","from_email":"marketing@example.com","subject":"Our July News - Updated","contact_list_ids":["8a3e5c60-53bc-11ec-b5f8-fa163e5bc304"]}
   */
  async updateCampaignActivity(campaignActivityId, fromName, fromEmail, replyToEmail, subject, preheader, htmlContent, contactListIds, segmentIds) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    const existing = await this.#apiRequest({
      logTag: 'updateCampaignActivity:fetch',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }`,
    })

    const body = { ...existing }

    const overrides = {
      from_name: fromName,
      from_email: fromEmail,
      reply_to_email: replyToEmail,
      subject,
      preheader,
      html_content: htmlContent,
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null && value !== '') {
        body[key] = value
      }
    }

    const lists = this.#toArray(contactListIds)
    const segments = this.#toArray(segmentIds)

    if (lists.length) {
      body.contact_list_ids = lists
    }

    if (segments.length) {
      body.segment_ids = segments.map(Number)
    }

    return this.#apiRequest({
      logTag: 'updateCampaignActivity',
      method: 'put',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }`,
      body,
    })
  }

  /**
   * @description Sends a test version of an email campaign activity to up to 5 email addresses, with an optional personal message shown above the email content. Test sends do not affect campaign status or reporting.
   *
   * @route POST /send-test-email
   * @operationName Send Test Email
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID) to test. Use Get Campaign and pick the activity with role 'primary_email'."}
   * @paramDef {"type":"Array<String>","label":"Recipients","name":"emailAddresses","required":true,"description":"The email addresses to send the test to. Maximum 5 per request. Accepts a list or comma-separated addresses."}
   * @paramDef {"type":"String","label":"Personal Message","name":"personalMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note displayed above the email content in the test message."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async sendTestEmail(campaignActivityId, emailAddresses, personalMessage) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    const recipients = this.#toArray(emailAddresses)

    if (!recipients.length) {
      throw new Error('At least one address in "Recipients" is required')
    }

    return this.#apiRequest({
      logTag: 'sendTestEmail',
      method: 'post',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }/tests`,
      body: cleanupObject({
        email_addresses: recipients,
        personal_message: personalMessage,
      }),
    })
  }

  /**
   * @description Schedules an email campaign activity to be sent at a specific date and time, or immediately when no date is provided. The activity must be in DRAFT status and must already have recipients (contact lists or segments — see Update Campaign Activity) and a verified from address. Returns the resulting schedule.
   *
   * @route POST /schedule-campaign
   * @operationName Schedule Campaign
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID) to schedule. Use Get Campaign and pick the activity with role 'primary_email'."}
   * @paramDef {"type":"String","label":"Scheduled Date","name":"scheduledDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The ISO-8601 date-time to send the campaign (e.g. 2026-08-01T13:00:00Z). Must be in the future. Leave empty to send the campaign immediately."}
   *
   * @returns {Object}
   * @sampleResult [{"scheduled_date":"2026-08-01T13:00:00.000Z"}]
   */
  async scheduleCampaign(campaignActivityId, scheduledDate) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    return this.#apiRequest({
      logTag: 'scheduleCampaign',
      method: 'post',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }/schedules`,
      // "0" instructs Constant Contact to send the campaign immediately.
      body: { scheduled_date: scheduledDate || '0' },
    })
  }

  /**
   * @description Retrieves the current send schedule of an email campaign activity. Returns an array with the scheduled date when the activity is scheduled, or an empty array when it is not.
   *
   * @route GET /get-campaign-schedules
   * @operationName Get Campaign Schedules
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID) to inspect. Use Get Campaign and pick the activity with role 'primary_email'."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"scheduled_date":"2026-08-01T13:00:00.000Z"}]
   */
  async getCampaignSchedules(campaignActivityId) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getCampaignSchedules',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }/schedules`,
    })
  }

  /**
   * @description Unschedules a previously scheduled email campaign activity so it will not be sent, returning it to DRAFT status. Only works before the send begins. Returns a success status (the API returns no content).
   *
   * @route DELETE /unschedule-campaign
   * @operationName Unschedule Campaign
   * @category Campaign Activities
   *
   * @paramDef {"type":"String","label":"Campaign Activity ID","name":"campaignActivityId","required":true,"description":"The campaign activity id (UUID) to unschedule. Use Get Campaign and pick the activity with role 'primary_email'."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async unscheduleCampaign(campaignActivityId) {
    if (!campaignActivityId) {
      throw new Error('"Campaign Activity ID" is required')
    }

    return this.#apiRequest({
      logTag: 'unscheduleCampaign',
      method: 'delete',
      url: `${ API_BASE_URL }/emails/activities/${ encodeURIComponent(campaignActivityId) }/schedules`,
    })
  }

  // ============================================ REPORTING ============================================

  /**
   * @description Retrieves summary performance reports for the account's sent email campaigns (newest first). Each summary includes the campaign id and unique counts of sends, opens, clicks, forwards, opt-outs, bounces, and abuse reports. Returns up to 500 summaries per page with a top-level "cursor" convenience field when more pages exist.
   *
   * @route GET /get-campaign-summary-reports
   * @operationName Get Campaign Summary Reports
   * @category Reporting
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of campaign summaries per page. Range: 1-500. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response ('cursor' field) to retrieve the next page."}
   *
   * @returns {Object}
   * @sampleResult {"bulk_email_campaign_summaries":[{"campaign_id":"9e6cc8c2-77c6-4b00-92af-1c47e5e6c452","campaign_type":"NEWSLETTER","last_sent_date":"2026-07-01T13:00:00Z","unique_counts":{"sends":1180,"opens":642,"clicks":187,"forwards":4,"optouts":3,"abuse":0,"bounces":21,"not_opened":538}}],"cursor":"bGltaXQ9NTAmbmV4dD0y"}
   */
  async getCampaignSummaryReports(limit, cursor) {
    const response = await this.#apiRequest({
      logTag: 'getCampaignSummaryReports',
      url: `${ API_BASE_URL }/reports/summary_reports/email_campaign_summaries`,
      query: { limit: limit || undefined, cursor },
    })

    return this.#withCursor(response)
  }

  /**
   * @description Retrieves unique-count statistics for up to 25 email campaign activities in one call: sends, opens, clicks, bounces, opt-outs, forwards, and abuse reports per activity. This stats endpoint was chosen as the single per-activity reporting read because it returns stable aggregate counts in one request (rather than paging through individual tracking events). Use Get Campaign to find each campaign's 'primary_email' activity id.
   *
   * @route GET /get-campaign-activity-stats
   * @operationName Get Campaign Activity Stats
   * @category Reporting
   *
   * @paramDef {"type":"Array<String>","label":"Campaign Activity IDs","name":"campaignActivityIds","required":true,"description":"The campaign activity ids (UUIDs) to report on. Maximum 25 per request. Accepts a list or comma-separated ids."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"campaign_activity_id":"06a7a92a-2b9c-4f60-a205-c7a02fe0a2a9","stats":{"em_sends":1180,"em_opens":642,"em_clicks":187,"em_bounces":21,"em_optouts":3,"em_forwards":4,"em_abuse":0,"em_not_opened":538}}],"errors":[]}
   */
  async getCampaignActivityStats(campaignActivityIds) {
    const ids = this.#toArray(campaignActivityIds)

    if (!ids.length) {
      throw new Error('At least one id in "Campaign Activity IDs" is required')
    }

    if (ids.length > 25) {
      throw new Error('"Campaign Activity IDs" accepts at most 25 ids per request')
    }

    return this.#apiRequest({
      logTag: 'getCampaignActivityStats',
      url: `${ API_BASE_URL }/reports/stats/email_campaign_activities/${ ids.map(encodeURIComponent).join(',') }`,
    })
  }
}

Flowrunner.ServerCode.addService(ConstantContactService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The API Key (Client ID) of your application from the Constant Contact developer portal (https://app.constantcontact.com/pages/dma/portal/).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret generated for your application in the Constant Contact developer portal (https://app.constantcontact.com/pages/dma/portal/).',
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

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
