const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Mixpanel] info:', ...args),
  debug: (...args) => console.log('[Mixpanel] debug:', ...args),
  error: (...args) => console.log('[Mixpanel] error:', ...args),
  warn: (...args) => console.log('[Mixpanel] warn:', ...args),
}

const REGION_HOSTS = {
  'US': {
    ingestion: 'https://api.mixpanel.com',
    query: 'https://mixpanel.com/api',
    data: 'https://data.mixpanel.com/api/2.0',
  },
  'EU': {
    ingestion: 'https://api-eu.mixpanel.com',
    query: 'https://eu.mixpanel.com/api',
    data: 'https://data-eu.mixpanel.com/api/2.0',
  },
  'India': {
    ingestion: 'https://api-in.mixpanel.com',
    query: 'https://in.mixpanel.com/api',
    data: 'https://data-in.mixpanel.com/api/2.0',
  },
}

const CHOICE_MAPS = {
  analysisType: { 'General': 'general', 'Unique': 'unique', 'Average': 'average' },
  segmentationUnit: { 'Minute': 'minute', 'Hour': 'hour', 'Day': 'day', 'Month': 'month' },
  eventCountsUnit: { 'Minute': 'minute', 'Hour': 'hour', 'Day': 'day', 'Week': 'week', 'Month': 'month' },
  funnelUnit: { 'Day': 'day', 'Week': 'week', 'Month': 'month' },
  funnelLengthUnit: { 'Second': 'second', 'Minute': 'minute', 'Hour': 'hour', 'Day': 'day' },
  retentionType: { 'Birth': 'birth', 'Compounded': 'compounded' },
  retentionUnit: { 'Day': 'day', 'Week': 'week', 'Month': 'month' },
  lexiconEntity: { 'Event': 'event', 'Profile': 'profile' },
}

const DEFAULT_EXPORT_LIMIT = 1000
const DICTIONARY_PAGE_SIZE = 255

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
 * Mixpanel product analytics service.
 *
 * @usesFileStorage
 * @integrationName Mixpanel
 * @integrationIcon /icon.svg
 */
class MixpanelService {
  constructor(config) {
    this.region = config.region || 'US'
    this.projectToken = config.projectToken
    this.serviceAccountUsername = config.serviceAccountUsername
    this.serviceAccountSecret = config.serviceAccountSecret
    this.projectId = config.projectId

    const hosts = REGION_HOSTS[this.region] || REGION_HOSTS['US']

    this.ingestionBase = hosts.ingestion
    this.queryBase = hosts.query
    this.dataBase = hosts.data
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #serviceAccountAuth() {
    if (!this.serviceAccountUsername || !this.serviceAccountSecret || !this.projectId) {
      throw new Error(
        'Mixpanel API error: this operation requires Service Account credentials. ' +
        'Set the Service Account Username, Service Account Secret and Project ID in the service configuration. ' +
        'Create a service account in Mixpanel under Organization Settings → Service Accounts.'
      )
    }

    const token = Buffer.from(`${ this.serviceAccountUsername }:${ this.serviceAccountSecret }`).toString('base64')

    return `Basic ${ token }`
  }

  async #apiRequest({ url, method = 'get', headers, query, body, formBody, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers || {})
        .query(cleanedQuery || {})

      if (formBody !== undefined) {
        const params = new URLSearchParams(clean(formBody))

        return await request
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(params.toString())
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      let message = error.body?.error || error.body?.message || error.message

      if (typeof message !== 'string') {
        message = JSON.stringify(message)
      }

      if (error.body?.failed_records) {
        message += ` | failed records (first 5): ${ JSON.stringify(error.body.failed_records.slice(0, 5)) }`
      }

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Mixpanel API error: ${ message }`)
    }
  }

  /**
   * Ingestion endpoints (/track, /engage, /groups) are called with verbose=1 so the
   * response is a JSON object { status: 1|0, error }. ip=0 prevents Mixpanel from
   * geolocating records by the FlowRunner server IP; pass an $ip property to set a
   * location explicitly.
   */
  async #ingest({ path, records, logTag }) {
    const response = await this.#apiRequest({
      url: `${ this.ingestionBase }${ path }`,
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      query: { verbose: 1, ip: 0 },
      body: records,
      logTag,
    })

    if (response && response.status === 0) {
      logger.error(`${ logTag } - payload rejected: ${ response.error }`)

      throw new Error(`Mixpanel API error: ${ response.error || 'the ingestion payload was rejected' }`)
    }

    return response
  }

  async #engageUpdate({ operation, distinctId, value, extra, logTag }) {
    const record = clean({
      '$token': this.projectToken,
      '$distinct_id': distinctId,
      ...extra,
    })

    record[operation] = value

    return await this.#ingest({ path: '/engage', records: [record], logTag })
  }

  async #groupUpdate({ operation, groupKey, groupId, value, logTag }) {
    const record = clean({
      '$token': this.projectToken,
      '$group_key': groupKey,
      '$group_id': groupId,
    })

    record[operation] = value

    return await this.#ingest({ path: '/groups', records: [record], logTag })
  }

  async #queryRequest({ path, method = 'get', query, formBody, logTag }) {
    const authorization = this.#serviceAccountAuth()

    return await this.#apiRequest({
      url: `${ this.queryBase }${ path }`,
      method,
      headers: { Authorization: authorization, Accept: 'application/json' },
      query: { project_id: this.projectId, ...query },
      formBody,
      logTag,
    })
  }

  // ===========================================================================
  // Event Ingestion
  // ===========================================================================

  /**
   * @operationName Track Event
   * @category Event Ingestion
   * @description Sends a single event to Mixpanel through the real-time /track ingestion endpoint using the Project Token. Intended for events from the last 5 days; use Import Events for older/historical data. Custom properties are merged into the event payload; reserved properties like $insert_id (deduplication key) and time can be set via dedicated parameters. Geolocation from the server IP is disabled (ip=0); include an $ip property to set a location explicitly.
   * @route POST /track-event
   *
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"Name of the event to record, e.g. 'Signed Up' or 'Purchase Completed'."}
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user who performed the event."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","description":"Custom event properties as key-value pairs, e.g. {\"plan\":\"pro\",\"amount\":49.99}. Reserved Mixpanel properties (prefixed with $) may also be included."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"time","description":"Event time as a Unix timestamp in seconds or milliseconds. Defaults to the time Mixpanel receives the event. Must be within the last 5 days for /track; older events must use Import Events."}
   * @paramDef {"type":"String","label":"Insert ID","name":"insertId","description":"Unique ID for deduplication ($insert_id). Events with the same insert ID, distinct ID, event name and time are deduplicated."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async trackEvent(eventName, distinctId, properties, time, insertId) {
    const event = {
      event: eventName,
      properties: {
        ...(properties || {}),
        ...clean({
          token: this.projectToken,
          distinct_id: distinctId,
          time,
          '$insert_id': insertId,
        }),
      },
    }

    return await this.#ingest({ path: '/track', records: [event], logTag: '[trackEvent]' })
  }

  /**
   * @typedef {Object} ImportEvent
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"Name of the event to import."}
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user who performed the event. Use an empty string only for events not tied to a user."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"time","required":true,"description":"Event time as a Unix timestamp in seconds or milliseconds. Required for imported events and may be any time in the past."}
   * @paramDef {"type":"String","label":"Insert ID","name":"insertId","description":"Unique deduplication ID ($insert_id, max 36 characters, alphanumeric and hyphens). Auto-generated when omitted."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","description":"Custom event properties as key-value pairs."}
   */

  /**
   * @operationName Import Events
   * @category Event Ingestion
   * @description Imports a batch of historical events through the /import endpoint using Service Account authentication (Project ID required). Unlike Track Event, imported events may have any past timestamp. Sends up to 2,000 events per call with strict validation enabled: invalid events are reported with per-record error details. A unique $insert_id is auto-generated for events that do not provide one.
   * @route POST /import-events
   *
   * @paramDef {"type":"Array<ImportEvent>","label":"Events","name":"events","required":true,"description":"Events to import (max 2,000 per call, 10 MB uncompressed)."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"num_records_imported":2,"status":"OK"}
   */
  async importEvents(events) {
    const authorization = this.#serviceAccountAuth()

    const records = (events || []).map(item => ({
      event: item.eventName,
      properties: {
        ...(item.properties || {}),
        ...clean({ time: item.time, distinct_id: item.distinctId }),
        '$insert_id': item.insertId || crypto.randomUUID(),
      },
    }))

    return await this.#apiRequest({
      url: `${ this.ingestionBase }/import`,
      method: 'post',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      query: { strict: 1, project_id: this.projectId },
      body: records,
      logTag: '[importEvents]',
    })
  }

  // ===========================================================================
  // User Profiles
  // ===========================================================================

  /**
   * @operationName Set Profile Properties
   * @category User Profiles
   * @description Sets properties on a Mixpanel user profile via the /engage $set operation, overwriting existing values and creating the profile if it does not exist. Supports reserved properties such as $name, $email, $phone and $avatar alongside custom properties. Geolocation from the server IP is disabled; include an $ip property to set the profile location explicitly.
   * @route POST /set-profile-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Properties to set, e.g. {\"$name\":\"Jane Doe\",\"$email\":\"jane@example.com\",\"plan\":\"pro\"}. Existing values for these keys are overwritten."}
   * @paramDef {"type":"Boolean","label":"Ignore Time","name":"ignoreTime","uiComponent":{"type":"CHECKBOX"},"description":"When enabled ($ignore_time), the update does not refresh the profile's Last Seen timestamp. Recommended for backfills and background jobs."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async setProfileProperties(distinctId, properties, ignoreTime) {
    return await this.#engageUpdate({
      operation: '$set',
      distinctId,
      value: properties,
      extra: ignoreTime ? { '$ignore_time': true } : undefined,
      logTag: '[setProfileProperties]',
    })
  }

  /**
   * @operationName Set Profile Properties Once
   * @category User Profiles
   * @description Sets properties on a user profile via the /engage $set_once operation only if they are not already set. Existing values are never overwritten, which makes this ideal for first-touch attribution data such as initial referrer or signup source. Creates the profile if it does not exist.
   * @route POST /set-profile-properties-once
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Properties to set only if currently absent, e.g. {\"first_seen_source\":\"newsletter\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async setProfilePropertiesOnce(distinctId, properties) {
    return await this.#engageUpdate({
      operation: '$set_once',
      distinctId,
      value: properties,
      logTag: '[setProfilePropertiesOnce]',
    })
  }

  /**
   * @operationName Increment Profile Properties
   * @category User Profiles
   * @description Increments numeric user profile properties via the /engage $add operation. Each key is increased by the given amount; negative values decrement. Properties that do not exist yet are created with the increment as the initial value. Useful for counters such as total purchases or lifetime revenue.
   * @route POST /increment-profile-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Increments","name":"properties","required":true,"description":"Numeric properties mapped to the amount to add, e.g. {\"purchase_count\":1,\"lifetime_value\":49.99}. Use negative numbers to subtract."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async incrementProfileProperties(distinctId, properties) {
    return await this.#engageUpdate({
      operation: '$add',
      distinctId,
      value: properties,
      logTag: '[incrementProfileProperties]',
    })
  }

  /**
   * @operationName Append To Profile List Properties
   * @category User Profiles
   * @description Appends values to list-type user profile properties via the /engage $append operation. Each key gets the given value added to the end of its list, even if the value already exists (duplicates allowed). Use Union Profile List Properties to add values without duplicates.
   * @route POST /append-to-profile-list-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Values","name":"properties","required":true,"description":"List properties mapped to the value to append, e.g. {\"purchased_items\":\"sku-123\",\"pages_visited\":\"/pricing\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async appendToProfileListProperties(distinctId, properties) {
    return await this.#engageUpdate({
      operation: '$append',
      distinctId,
      value: properties,
      logTag: '[appendToProfileListProperties]',
    })
  }

  /**
   * @operationName Union Profile List Properties
   * @category User Profiles
   * @description Merges values into list-type user profile properties via the /engage $union operation. Each key receives the given values with duplicates removed, so the list behaves like a set. Use Append To Profile List Properties when duplicates should be kept.
   * @route POST /union-profile-list-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Values","name":"properties","required":true,"description":"List properties mapped to an array of values to merge without duplicates, e.g. {\"tags\":[\"vip\",\"beta\"]}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async unionProfileListProperties(distinctId, properties) {
    return await this.#engageUpdate({
      operation: '$union',
      distinctId,
      value: properties,
      logTag: '[unionProfileListProperties]',
    })
  }

  /**
   * @operationName Remove From Profile List Properties
   * @category User Profiles
   * @description Removes a value from list-type user profile properties via the /engage $remove operation. Each key has the given value deleted from its list if present; other list entries are untouched.
   * @route POST /remove-from-profile-list-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Object","label":"Values","name":"properties","required":true,"description":"List properties mapped to the single value to remove, e.g. {\"tags\":\"beta\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async removeFromProfileListProperties(distinctId, properties) {
    return await this.#engageUpdate({
      operation: '$remove',
      distinctId,
      value: properties,
      logTag: '[removeFromProfileListProperties]',
    })
  }

  /**
   * @operationName Unset Profile Properties
   * @category User Profiles
   * @description Permanently removes properties from a user profile via the /engage $unset operation. The listed property names are deleted from the profile entirely; other properties are untouched.
   * @route POST /unset-profile-properties
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to update."}
   * @paramDef {"type":"Array<String>","label":"Property Names","name":"propertyNames","required":true,"description":"Names of the profile properties to remove, e.g. [\"legacy_plan\",\"trial_ends\"]."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async unsetProfileProperties(distinctId, propertyNames) {
    return await this.#engageUpdate({
      operation: '$unset',
      distinctId,
      value: propertyNames,
      logTag: '[unsetProfileProperties]',
    })
  }

  /**
   * @operationName Delete Profile
   * @category User Profiles
   * @description Permanently deletes a user profile from Mixpanel via the /engage $delete operation. Historical events for the user are NOT removed, only the profile record. Enable Ignore Alias when cleaning up duplicate profiles so the deletion does not follow the alias to the original profile.
   * @route DELETE /delete-profile
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"Unique identifier of the user profile to delete."}
   * @paramDef {"type":"Boolean","label":"Ignore Alias","name":"ignoreAlias","uiComponent":{"type":"CHECKBOX"},"description":"When enabled ($ignore_alias), the deletion targets the exact distinct ID without resolving aliases. Use when deleting duplicate profiles."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async deleteProfile(distinctId, ignoreAlias) {
    return await this.#engageUpdate({
      operation: '$delete',
      distinctId,
      value: null,
      extra: ignoreAlias ? { '$ignore_alias': true } : undefined,
      logTag: '[deleteProfile]',
    })
  }

  /**
   * @operationName Batch Update Profiles
   * @category User Profiles
   * @description Sends up to 2,000 raw user profile update objects to the /engage endpoint in a single request. Each update object uses the native Mixpanel engage format with a $distinct_id and exactly one operation key ($set, $set_once, $add, $append, $union, $remove, $unset or $delete). The $token is injected automatically when omitted. Use this for high-throughput profile synchronization.
   * @route POST /batch-update-profiles
   *
   * @paramDef {"type":"Array<Object>","label":"Updates","name":"updates","required":true,"description":"Raw engage update objects, e.g. [{\"$distinct_id\":\"user-1\",\"$set\":{\"plan\":\"pro\"}},{\"$distinct_id\":\"user-2\",\"$unset\":[\"trial_ends\"]}]. Max 2,000 per call."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async batchUpdateProfiles(updates) {
    const records = (updates || []).map(update => ({
      '$token': this.projectToken,
      ...update,
    }))

    return await this.#ingest({ path: '/engage', records, logTag: '[batchUpdateProfiles]' })
  }

  // ===========================================================================
  // Group Profiles
  // ===========================================================================

  /**
   * @operationName Set Group Properties
   * @category Group Profiles
   * @description Sets properties on a Mixpanel group profile via the /groups $set operation, overwriting existing values and creating the group profile if it does not exist. Group Analytics must be enabled on the project and the group key defined in project settings.
   * @route POST /set-group-properties
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company' or 'account_id'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group to update, e.g. 'acme-corp'."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Properties to set on the group profile, e.g. {\"$name\":\"Acme Corp\",\"industry\":\"Manufacturing\"}. Existing values for these keys are overwritten."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async setGroupProperties(groupKey, groupId, properties) {
    return await this.#groupUpdate({
      operation: '$set',
      groupKey,
      groupId,
      value: properties,
      logTag: '[setGroupProperties]',
    })
  }

  /**
   * @operationName Set Group Properties Once
   * @category Group Profiles
   * @description Sets properties on a group profile via the /groups $set_once operation only if they are not already set. Existing values are never overwritten. Creates the group profile if it does not exist.
   * @route POST /set-group-properties-once
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Properties to set only if currently absent, e.g. {\"first_contract_date\":\"2026-01-15\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async setGroupPropertiesOnce(groupKey, groupId, properties) {
    return await this.#groupUpdate({
      operation: '$set_once',
      groupKey,
      groupId,
      value: properties,
      logTag: '[setGroupPropertiesOnce]',
    })
  }

  /**
   * @operationName Union Group List Properties
   * @category Group Profiles
   * @description Merges values into list-type group profile properties via the /groups $union operation. Each key receives the given values with duplicates removed, so the list behaves like a set.
   * @route POST /union-group-list-properties
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group to update."}
   * @paramDef {"type":"Object","label":"Values","name":"properties","required":true,"description":"List properties mapped to an array of values to merge without duplicates, e.g. {\"products\":[\"analytics\",\"flows\"]}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async unionGroupListProperties(groupKey, groupId, properties) {
    return await this.#groupUpdate({
      operation: '$union',
      groupKey,
      groupId,
      value: properties,
      logTag: '[unionGroupListProperties]',
    })
  }

  /**
   * @operationName Remove From Group List Properties
   * @category Group Profiles
   * @description Removes a value from list-type group profile properties via the /groups $remove operation. Each key has the given value deleted from its list if present; other list entries are untouched.
   * @route POST /remove-from-group-list-properties
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group to update."}
   * @paramDef {"type":"Object","label":"Values","name":"properties","required":true,"description":"List properties mapped to the single value to remove, e.g. {\"products\":\"legacy-suite\"}."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async removeFromGroupListProperties(groupKey, groupId, properties) {
    return await this.#groupUpdate({
      operation: '$remove',
      groupKey,
      groupId,
      value: properties,
      logTag: '[removeFromGroupListProperties]',
    })
  }

  /**
   * @operationName Unset Group Properties
   * @category Group Profiles
   * @description Permanently removes properties from a group profile via the /groups $unset operation. The listed property names are deleted from the group profile entirely; other properties are untouched.
   * @route POST /unset-group-properties
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group to update."}
   * @paramDef {"type":"Array<String>","label":"Property Names","name":"propertyNames","required":true,"description":"Names of the group properties to remove, e.g. [\"deprecated_field\"]."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async unsetGroupProperties(groupKey, groupId, propertyNames) {
    return await this.#groupUpdate({
      operation: '$unset',
      groupKey,
      groupId,
      value: propertyNames,
      logTag: '[unsetGroupProperties]',
    })
  }

  /**
   * @operationName Delete Group Profile
   * @category Group Profiles
   * @description Permanently deletes a group profile from Mixpanel via the /groups $delete operation. Events attributed to the group are NOT removed, only the group profile record.
   * @route DELETE /delete-group-profile
   *
   * @paramDef {"type":"String","label":"Group Key","name":"groupKey","required":true,"description":"The group key defined in project settings, e.g. 'company'."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"Identifier of the specific group profile to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async deleteGroupProfile(groupKey, groupId) {
    return await this.#groupUpdate({
      operation: '$delete',
      groupKey,
      groupId,
      value: null,
      logTag: '[deleteGroupProfile]',
    })
  }

  /**
   * @operationName Batch Update Group Profiles
   * @category Group Profiles
   * @description Sends up to 200 raw group profile update objects to the /groups endpoint in a single request. Each update object uses the native Mixpanel groups format with $group_key, $group_id and exactly one operation key ($set, $set_once, $union, $remove, $unset or $delete). The $token is injected automatically when omitted.
   * @route POST /batch-update-group-profiles
   *
   * @paramDef {"type":"Array<Object>","label":"Updates","name":"updates","required":true,"description":"Raw group update objects, e.g. [{\"$group_key\":\"company\",\"$group_id\":\"acme\",\"$set\":{\"tier\":\"enterprise\"}}]. Max 200 per call."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async batchUpdateGroupProfiles(updates) {
    const records = (updates || []).map(update => ({
      '$token': this.projectToken,
      ...update,
    }))

    return await this.#ingest({ path: '/groups', records, logTag: '[batchUpdateGroupProfiles]' })
  }

  // ===========================================================================
  // Identity Management
  // ===========================================================================

  /**
   * @operationName Create Alias
   * @category Identity Management
   * @description Creates a $create_alias event linking a new alias to an existing distinct ID. Only applies to projects on the Legacy ID Management or Original ID Merge systems; it has no effect on projects using Simplified ID Merge, where identities are stitched automatically via $device_id and $user_id event properties. Aliasing is irreversible.
   * @route POST /create-alias
   *
   * @paramDef {"type":"String","label":"Distinct ID","name":"distinctId","required":true,"description":"The existing distinct ID the alias will point to."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","required":true,"description":"The new ID to merge into the original distinct ID. Must not already be in use as a distinct ID or alias."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async createAlias(distinctId, alias) {
    const event = {
      event: '$create_alias',
      properties: {
        distinct_id: distinctId,
        alias,
        token: this.projectToken,
      },
    }

    return await this.#ingest({ path: '/track', records: [event], logTag: '[createAlias]' })
  }

  /**
   * @operationName Create Identity
   * @category Identity Management
   * @description Sends a $identify event connecting an anonymous ID to an identified user ID. Only applies to projects on the Original ID Merge system; it has no effect on Simplified ID Merge projects, where identities are stitched automatically via $device_id and $user_id event properties. The anonymous ID must be a UUID that has not previously been merged.
   * @route POST /create-identity
   *
   * @paramDef {"type":"String","label":"Identified ID","name":"identifiedId","required":true,"description":"The identified (user) ID that events should merge toward, e.g. an internal user ID."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonId","required":true,"description":"The anonymous (device) ID to merge into the identified ID. Must be in UUID v4 format and not previously merged."}
   *
   * @returns {Object}
   * @sampleResult {"status":1,"error":null}
   */
  async createIdentity(identifiedId, anonId) {
    const event = {
      event: '$identify',
      properties: {
        '$identified_id': identifiedId,
        '$anon_id': anonId,
        token: this.projectToken,
      },
    }

    return await this.#ingest({ path: '/track', records: [event], logTag: '[createIdentity]' })
  }

  /**
   * @operationName Merge Identities
   * @category Identity Management
   * @description Sends a $merge event through the /import endpoint to merge two distinct IDs into a single identity cluster. Requires Service Account credentials. Only applies to projects on the Original ID Merge system; it has no effect on Simplified ID Merge projects. Merging is irreversible and identity clusters are limited in size, so use with care.
   * @route POST /merge-identities
   *
   * @paramDef {"type":"String","label":"First Distinct ID","name":"firstDistinctId","required":true,"description":"First distinct ID to merge."}
   * @paramDef {"type":"String","label":"Second Distinct ID","name":"secondDistinctId","required":true,"description":"Second distinct ID to merge with the first."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"num_records_imported":1,"status":"OK"}
   */
  async mergeIdentities(firstDistinctId, secondDistinctId) {
    const authorization = this.#serviceAccountAuth()

    const event = {
      event: '$merge',
      properties: {
        '$distinct_ids': [firstDistinctId, secondDistinctId],
      },
    }

    return await this.#apiRequest({
      url: `${ this.ingestionBase }/import`,
      method: 'post',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      query: { strict: 1, project_id: this.projectId },
      body: [event],
      logTag: '[mergeIdentities]',
    })
  }

  // ===========================================================================
  // Analytics Queries
  // ===========================================================================

  /**
   * @operationName Run Segmentation Query
   * @category Analytics Queries
   * @description Runs a Query API segmentation report for a single event over a date range, optionally segmented by a property expression and filtered by a where clause. Returns a time series of counts per segment. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /segmentation
   *
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"dictionary":"getEventNamesDictionary","description":"The event to analyze. Select from recent events or type an event name."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive). Must be within 365 days of From Date."}
   * @paramDef {"type":"String","label":"Segment By","name":"on","description":"Property expression to segment the event on, e.g. properties[\"$os\"] or user[\"plan\"]."}
   * @paramDef {"type":"String","label":"Time Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Month"]}},"defaultValue":"Day","description":"Time bucket for the returned series. Defaults to Day."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Filter expression applied to events, e.g. properties[\"$os\"] == \"Linux\"."}
   * @paramDef {"type":"String","label":"Analysis Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["General","Unique","Average"]}},"defaultValue":"General","description":"General counts all events, Unique counts distinct users, Average divides total by number of days."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of segment values to return (default 60, max 10,000)."}
   *
   * @returns {Object}
   * @sampleResult {"legend_size":1,"data":{"series":["2026-07-01","2026-07-02"],"values":{"Sign Up":{"2026-07-01":124,"2026-07-02":143}}}}
   */
  async runSegmentationQuery(event, fromDate, toDate, on, unit, where, type, limit) {
    return await this.#queryRequest({
      path: '/query/segmentation',
      query: {
        event,
        from_date: fromDate,
        to_date: toDate,
        on,
        unit: this.#resolveChoice(unit, CHOICE_MAPS.segmentationUnit),
        where,
        type: this.#resolveChoice(type, CHOICE_MAPS.analysisType),
        limit,
      },
      logTag: '[runSegmentationQuery]',
    })
  }

  /**
   * @operationName Query Event Counts
   * @category Analytics Queries
   * @description Returns aggregated counts for one or more events over a date range, bucketed by the chosen time unit, via the Query API /events endpoint. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /event-counts
   *
   * @paramDef {"type":"Array<String>","label":"Events","name":"events","required":true,"description":"Event names to count, e.g. [\"Sign Up\",\"Purchase\"]."}
   * @paramDef {"type":"String","label":"Analysis Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["General","Unique","Average"]}},"defaultValue":"General","description":"General counts all events, Unique counts distinct users, Average averages the counts."}
   * @paramDef {"type":"String","label":"Time Unit","name":"unit","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Minute","Hour","Day","Week","Month"]}},"defaultValue":"Day","description":"Time bucket for the returned series."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive)."}
   *
   * @returns {Object}
   * @sampleResult {"legend_size":2,"data":{"series":["2026-07-01","2026-07-02"],"values":{"Sign Up":{"2026-07-01":124,"2026-07-02":143},"Purchase":{"2026-07-01":31,"2026-07-02":40}}}}
   */
  async queryEventCounts(events, type, unit, fromDate, toDate) {
    return await this.#queryRequest({
      path: '/query/events',
      query: {
        event: JSON.stringify(events || []),
        type: this.#resolveChoice(type, CHOICE_MAPS.analysisType) || 'general',
        unit: this.#resolveChoice(unit, CHOICE_MAPS.eventCountsUnit) || 'day',
        from_date: fromDate,
        to_date: toDate,
      },
      logTag: '[queryEventCounts]',
    })
  }

  /**
   * @operationName Get Today's Top Events
   * @category Analytics Queries
   * @description Returns today's top events with their counts and the normalized percent change from yesterday, via the Query API /events/top endpoint. Requires Service Account credentials.
   * @route GET /top-events
   *
   * @paramDef {"type":"String","label":"Analysis Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["General","Unique","Average"]}},"defaultValue":"General","description":"General counts all events, Unique counts distinct users, Average averages the counts."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return (default 100)."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"amount":8451,"event":"Page View","percent_change":0.041,"type":"general"},{"amount":1203,"event":"Sign Up","percent_change":-0.02,"type":"general"}],"type":"general"}
   */
  async getTodaysTopEvents(type, limit) {
    return await this.#queryRequest({
      path: '/query/events/top',
      query: {
        type: this.#resolveChoice(type, CHOICE_MAPS.analysisType) || 'general',
        limit,
      },
      logTag: '[getTodaysTopEvents]',
    })
  }

  /**
   * @operationName List Top Event Names
   * @category Analytics Queries
   * @description Returns the names of the most common events over the last 31 days, via the Query API /events/names endpoint. Useful for discovering which events exist in a project. Requires Service Account credentials.
   * @route GET /top-event-names
   *
   * @paramDef {"type":"String","label":"Analysis Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["General","Unique","Average"]}},"defaultValue":"General","description":"General counts all events, Unique counts distinct users, Average averages the counts."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of event names to return (default and max 255)."}
   *
   * @returns {Array<String>}
   * @sampleResult ["Page View","Sign Up","Purchase"]
   */
  async listTopEventNames(type, limit) {
    return await this.#queryRequest({
      path: '/query/events/names',
      query: {
        type: this.#resolveChoice(type, CHOICE_MAPS.analysisType) || 'general',
        limit,
      },
      logTag: '[listTopEventNames]',
    })
  }

  /**
   * @operationName Query Insights Report
   * @category Analytics Queries
   * @description Returns the saved data of an existing Insights report by its bookmark ID via the Query API /insights endpoint. The bookmark ID is visible in the report URL in the Mixpanel UI. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /insights-report
   *
   * @paramDef {"type":"Number","label":"Bookmark ID","name":"bookmarkId","required":true,"description":"The ID of the saved Insights report, taken from the report URL in the Mixpanel UI."}
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","description":"The workspace ID, if the report lives in a workspace."}
   *
   * @returns {Object}
   * @sampleResult {"computed_at":"2026-07-16T10:00:00+00:00","date_range":{"from_date":"2026-07-01","to_date":"2026-07-16"},"headers":["$event"],"series":{"Sign Up":{"2026-07-01T00:00:00+00:00":124,"2026-07-02T00:00:00+00:00":143}}}
   */
  async queryInsightsReport(bookmarkId, workspaceId) {
    return await this.#queryRequest({
      path: '/query/insights',
      query: {
        bookmark_id: bookmarkId,
        workspace_id: workspaceId,
      },
      logTag: '[queryInsightsReport]',
    })
  }

  // ===========================================================================
  // Funnels & Retention
  // ===========================================================================

  /**
   * @operationName Run Funnel Query
   * @category Funnels & Retention
   * @description Runs a saved funnel over a date range via the Query API /funnels endpoint and returns per-step counts and conversion ratios. Use List Saved Funnels or the funnel picker to find the funnel ID. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /funnel
   *
   * @paramDef {"type":"String","label":"Funnel","name":"funnelId","required":true,"dictionary":"getFunnelsDictionary","description":"The saved funnel to query. Select from the list or provide a numeric funnel ID."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive). Must be within 60 days of From Date."}
   * @paramDef {"type":"Number","label":"Completion Window","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units each user has to complete the funnel (max 90 days total)."}
   * @paramDef {"type":"String","label":"Completion Window Unit","name":"lengthUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Second","Minute","Hour","Day"]}},"description":"Unit for the completion window. Defaults to Day."}
   * @paramDef {"type":"String","label":"Bucket Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month"]}},"description":"Time bucket for the returned date keys. Defaults to Day."}
   * @paramDef {"type":"String","label":"Segment By","name":"on","description":"Property expression to segment the funnel on, e.g. properties[\"$os\"]."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Filter expression applied to events, e.g. properties[\"plan\"] == \"pro\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of segment values to return (default 255, max 10,000). Only used together with Segment By."}
   *
   * @returns {Object}
   * @sampleResult {"meta":{"dates":["2026-07-01"]},"data":{"2026-07-01":{"steps":[{"count":312,"goal":"Sign Up","overall_conv_ratio":1,"step_conv_ratio":1},{"count":114,"goal":"Purchase","overall_conv_ratio":0.365,"step_conv_ratio":0.365}],"analysis":{"completion":114,"starting_amount":312,"steps":2,"worst":2}}}}
   */
  async runFunnelQuery(funnelId, fromDate, toDate, length, lengthUnit, unit, on, where, limit) {
    return await this.#queryRequest({
      path: '/query/funnels',
      query: {
        funnel_id: funnelId,
        from_date: fromDate,
        to_date: toDate,
        length,
        length_unit: this.#resolveChoice(lengthUnit, CHOICE_MAPS.funnelLengthUnit),
        unit: this.#resolveChoice(unit, CHOICE_MAPS.funnelUnit),
        on,
        where,
        limit,
      },
      logTag: '[runFunnelQuery]',
    })
  }

  /**
   * @operationName List Saved Funnels
   * @category Funnels & Retention
   * @description Lists all saved funnels of the project with their IDs and names via the Query API /funnels/list endpoint. Use the returned funnel_id with Run Funnel Query. Requires Service Account credentials.
   * @route GET /funnels
   *
   * @returns {Array<Object>}
   * @sampleResult [{"funnel_id":7509,"name":"Signup funnel"},{"funnel_id":9070,"name":"Onboarding funnel"}]
   */
  async listSavedFunnels() {
    return await this.#queryRequest({
      path: '/query/funnels/list',
      logTag: '[listSavedFunnels]',
    })
  }

  /**
   * @operationName Run Retention Query
   * @category Funnels & Retention
   * @description Runs a cohort retention analysis over a date range via the Query API /retention endpoint. Birth retention tracks how often users return after a first (born) event; Compounded retention measures rolling repeat usage. Returns per-cohort counts for each retention interval. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /retention
   *
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive)."}
   * @paramDef {"type":"String","label":"Retention Type","name":"retentionType","uiComponent":{"type":"DROPDOWN","options":{"values":["Birth","Compounded"]}},"defaultValue":"Birth","description":"Birth (first-time) retention or Compounded (rolling) retention. Defaults to Birth."}
   * @paramDef {"type":"String","label":"Born Event","name":"bornEvent","dictionary":"getEventNamesDictionary","description":"The first-time event that defines the cohort, e.g. 'Sign Up'. Required when Retention Type is Birth."}
   * @paramDef {"type":"String","label":"Return Event","name":"event","dictionary":"getEventNamesDictionary","description":"The event that counts as a return visit. When omitted, any event counts."}
   * @paramDef {"type":"String","label":"Born Where","name":"bornWhere","description":"Filter expression applied to the born event, e.g. properties[\"plan\"] == \"pro\"."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Filter expression applied to the return event."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units per retention bucket (default 1, max 90 days total)."}
   * @paramDef {"type":"Number","label":"Interval Count","name":"intervalCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of retention buckets to return (default 1)."}
   * @paramDef {"type":"String","label":"Time Unit","name":"unit","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month"]}},"defaultValue":"Day","description":"Time unit of the retention buckets. Defaults to Day."}
   * @paramDef {"type":"String","label":"Segment By","name":"on","description":"Property expression to segment the return events on."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of segment values to return. Only used together with Segment By."}
   * @paramDef {"type":"Boolean","label":"Unbounded Retention","name":"unboundedRetention","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, counts users retained in a bucket or any later bucket (unbounded retention). Defaults to disabled."}
   *
   * @returns {Object}
   * @sampleResult {"2026-07-01":{"counts":[312,124,88],"first":312},"2026-07-02":{"counts":[280,131,75],"first":280}}
   */
  async runRetentionQuery(fromDate, toDate, retentionType, bornEvent, event, bornWhere, where, interval, intervalCount, unit, on, limit, unboundedRetention) {
    return await this.#queryRequest({
      path: '/query/retention',
      query: {
        from_date: fromDate,
        to_date: toDate,
        retention_type: this.#resolveChoice(retentionType, CHOICE_MAPS.retentionType),
        born_event: bornEvent,
        event,
        born_where: bornWhere,
        where,
        interval,
        interval_count: intervalCount,
        unit: this.#resolveChoice(unit, CHOICE_MAPS.retentionUnit),
        on,
        limit,
        unbounded_retention: unboundedRetention ? true : undefined,
      },
      logTag: '[runRetentionQuery]',
    })
  }

  // ===========================================================================
  // Profiles & Cohorts
  // ===========================================================================

  /**
   * @operationName Query Profiles
   * @category Profiles & Cohorts
   * @description Queries user profiles via the Query API /engage endpoint. Supports filtering by an expression, by specific distinct IDs, or by a saved cohort, and selecting which properties to return. Results are paginated (1,000 profiles per page): pass the returned session_id and the next page number to fetch subsequent pages. Requires Service Account credentials.
   * @route GET /profiles
   *
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Filter expression for profiles, e.g. properties[\"$last_seen\"] > \"2026-06-01T00:00:00\" or properties[\"plan\"] == \"pro\"."}
   * @paramDef {"type":"Array<String>","label":"Output Properties","name":"outputProperties","description":"Profile properties to include in results, e.g. [\"$email\",\"$name\",\"plan\"]. Returns all properties when omitted; limiting output speeds up large queries."}
   * @paramDef {"type":"String","label":"Cohort","name":"cohortId","dictionary":"getCohortsDictionary","description":"Restrict results to members of a saved cohort. Select from the list or provide a numeric cohort ID."}
   * @paramDef {"type":"Array<String>","label":"Distinct IDs","name":"distinctIds","description":"Return only the profiles with these distinct IDs."}
   * @paramDef {"type":"String","label":"Data Group ID","name":"dataGroupId","description":"Group key ID for querying group profiles instead of user profiles. Found in the project's group keys settings."}
   * @paramDef {"type":"Boolean","label":"Include All Users","name":"includeAllUsers","uiComponent":{"type":"CHECKBOX"},"description":"When filtering by cohort, also include cohort members that have no profile record. Only used together with Cohort."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number starting at 0. Pages after the first also require the Session ID from the previous response."}
   * @paramDef {"type":"String","label":"Session ID","name":"sessionId","description":"The session_id returned by a previous call; required when requesting page 1 and beyond of the same query."}
   *
   * @returns {Object}
   * @sampleResult {"page":0,"page_size":1000,"session_id":"1689875040-engagetask","status":"ok","total":2,"results":[{"$distinct_id":"user-1","$properties":{"$email":"jane@example.com","$name":"Jane Doe","plan":"pro"}}]}
   */
  async queryProfiles(where, outputProperties, cohortId, distinctIds, dataGroupId, includeAllUsers, page, sessionId) {
    const formBody = {
      where,
      output_properties: outputProperties && outputProperties.length ? JSON.stringify(outputProperties) : undefined,
      filter_by_cohort: cohortId ? JSON.stringify({ id: Number(cohortId) }) : undefined,
      distinct_ids: distinctIds && distinctIds.length ? JSON.stringify(distinctIds) : undefined,
      data_group_id: dataGroupId,
      include_all_users: cohortId && includeAllUsers ? 'true' : undefined,
      page,
      session_id: sessionId,
    }

    return await this.#queryRequest({
      path: '/query/engage',
      method: 'post',
      formBody,
      logTag: '[queryProfiles]',
    })
  }

  /**
   * @operationName List Cohorts
   * @category Profiles & Cohorts
   * @description Lists all saved cohorts of the project with their ID, name, member count, description and visibility via the Query API /cohorts/list endpoint. Use a cohort ID with Query Profiles to fetch cohort members. Requires Service Account credentials.
   * @route GET /cohorts
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1150561,"name":"Power Users","count":1430,"description":"Users with 5+ sessions in the last week","created":"2026-05-21 17:51:08","is_visible":1,"project_id":1234567}]
   */
  async listCohorts() {
    return await this.#queryRequest({
      path: '/query/cohorts/list',
      method: 'post',
      formBody: {},
      logTag: '[listCohorts]',
    })
  }

  /**
   * @operationName Get Activity Stream
   * @category Profiles & Cohorts
   * @description Returns the chronological event activity feed for specific users over a date range via the Query API /stream/query endpoint. Useful for inspecting an individual user's behavior. Requires Service Account credentials. Rate limited to 60 queries per hour and 5 concurrent queries.
   * @route GET /activity-stream
   *
   * @paramDef {"type":"Array<String>","label":"Distinct IDs","name":"distinctIds","required":true,"description":"Distinct IDs of the users whose activity feed to fetch, e.g. [\"user-1\",\"user-2\"]."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive)."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","results":{"events":[{"event":"Page View","properties":{"time":1752585600,"distinct_id":"user-1","$browser":"Chrome","$city":"Berlin"}}]}}
   */
  async getActivityStream(distinctIds, fromDate, toDate) {
    return await this.#queryRequest({
      path: '/query/stream/query',
      query: {
        distinct_ids: JSON.stringify(distinctIds || []),
        from_date: fromDate,
        to_date: toDate,
      },
      logTag: '[getActivityStream]',
    })
  }

  // ===========================================================================
  // Data Export
  // ===========================================================================

  /**
   * @operationName Export Events
   * @category Data Export
   * @description Exports raw event data for a date range from the Raw Data Export API (data host, /api/2.0/export) with optional event and where filters. By default returns events inline as a parsed array capped at 1,000 rows (raise Limit up to 100,000 as needed). Enable Save To File for large exports: the raw JSONL output is stored via FlowRunner file storage and a download URL is returned instead of the inline events. Requires Service Account credentials. Rate limited to 60 queries per hour.
   * @route GET /export-events
   *
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date in yyyy-mm-dd format (inclusive, project timezone)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","required":true,"description":"End date in yyyy-mm-dd format (inclusive)."}
   * @paramDef {"type":"Array<String>","label":"Events","name":"events","description":"Limit the export to these event names, e.g. [\"Purchase\"]. Exports all events when omitted."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Filter expression applied to events, e.g. properties[\"$os\"] == \"Linux\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to export (API max 100,000). Defaults to 1,000 for inline results; unlimited when saving to a file."}
   * @paramDef {"type":"Boolean","label":"Time In Milliseconds","name":"timeInMs","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, event timestamps are exported with millisecond precision instead of seconds."}
   * @paramDef {"type":"Boolean","label":"Save To File","name":"saveToFile","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the raw JSONL export is saved to FlowRunner file storage and a download URL is returned instead of inline events."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the exported file when Save To File is enabled."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"savedToFile":false,"events":[{"event":"Sign Up","properties":{"time":1752585600,"distinct_id":"user-1","$insert_id":"a1b2c3d4","plan":"pro"}},{"event":"Purchase","properties":{"time":1752589200,"distinct_id":"user-1","amount":49.99}}]}
   */
  async exportEvents(fromDate, toDate, events, where, limit, timeInMs, saveToFile, fileOptions) {
    const authorization = this.#serviceAccountAuth()
    const logTag = '[exportEvents]'

    const effectiveLimit = limit || (saveToFile ? undefined : DEFAULT_EXPORT_LIMIT)

    const response = await this.#apiRequest({
      url: `${ this.dataBase }/export`,
      headers: { Authorization: authorization, Accept: 'text/plain' },
      query: {
        project_id: this.projectId,
        from_date: fromDate,
        to_date: toDate,
        event: events && events.length ? JSON.stringify(events) : undefined,
        where,
        limit: effectiveLimit,
        time_in_ms: timeInMs ? true : undefined,
      },
      logTag,
    })

    const text = typeof response === 'string' ? response : JSON.stringify(response)
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean)

    if (saveToFile) {
      const buffer = Buffer.from(lines.join('\n'), 'utf8')

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `mixpanel_export_${ fromDate }_${ toDate }_${ Date.now() }.jsonl`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      logger.info(`${ logTag } - saved ${ lines.length } events to file`)

      return { count: lines.length, savedToFile: true, fileUrl: url }
    }

    const parsedEvents = lines.map(line => {
      try {
        return JSON.parse(line)
      } catch (error) {
        logger.warn(`${ logTag } - skipping unparsable export line`)

        return null
      }
    }).filter(Boolean)

    return { count: parsedEvents.length, savedToFile: false, events: parsedEvents }
  }

  // ===========================================================================
  // Lexicon
  // ===========================================================================

  /**
   * @operationName List Lexicon Schemas
   * @category Lexicon
   * @description Lists the Lexicon data dictionary schemas of the project via the Schemas API, optionally filtered to a single entity type (event or profile). Each schema entry describes an event or the user profile with a JSON Schema document including descriptions and property metadata. Requires Service Account credentials.
   * @route GET /lexicon-schemas
   *
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Event","Profile"]}},"description":"Restrict results to schemas of this entity type. Returns all schemas when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","results":[{"entityType":"event","name":"Sign Up","schemaJson":{"$schema":"http://json-schema.org/draft-07/schema","description":"A user created an account","additionalProperties":true,"metadata":{"com.mixpanel":{"tags":["growth"]}}}}]}
   */
  async listLexiconSchemas(entityType) {
    const resolvedType = this.#resolveChoice(entityType, CHOICE_MAPS.lexiconEntity)
    const suffix = resolvedType ? `/${ resolvedType }` : ''

    return await this.#queryRequest({
      path: `/app/projects/${ this.projectId }/schemas${ suffix }`,
      logTag: '[listLexiconSchemas]',
    })
  }

  /**
   * @operationName Get Lexicon Schema
   * @category Lexicon
   * @description Retrieves a single Lexicon schema by entity type and name via the Schemas API. For the user profile schema, use entity type Profile with the name $user. Requires Service Account credentials.
   * @route GET /lexicon-schema
   *
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Event","Profile"]}},"description":"The entity type of the schema."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the entity, e.g. the event name 'Sign Up' or '$user' for the user profile schema."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","results":[{"entityType":"event","name":"Sign Up","schemaJson":{"$schema":"http://json-schema.org/draft-07/schema","description":"A user created an account","additionalProperties":true}}]}
   */
  async getLexiconSchema(entityType, name) {
    const resolvedType = this.#resolveChoice(entityType, CHOICE_MAPS.lexiconEntity)

    return await this.#queryRequest({
      path: `/app/projects/${ this.projectId }/schemas/${ resolvedType }/${ encodeURIComponent(name) }`,
      logTag: '[getLexiconSchema]',
    })
  }

  /**
   * @typedef {Object} LexiconSchemaEntry
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","required":true,"description":"The entity type of the schema: 'event' or 'profile'."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The entity name, e.g. the event name 'Sign Up' or '$user' for the user profile schema."}
   * @paramDef {"type":"Object","label":"Schema JSON","name":"schemaJson","required":true,"description":"JSON Schema document describing the entity, e.g. {\"$schema\":\"http://json-schema.org/draft-07/schema\",\"description\":\"A user created an account\",\"properties\":{\"plan\":{\"type\":\"string\"}}}."}
   */

  /**
   * @operationName Upload Lexicon Schemas
   * @category Lexicon
   * @description Creates or replaces Lexicon data dictionary schemas via the Schemas API, syncing an internal tracking plan into Mixpanel. Existing metadata for properties not present in the new schemas is merged; set a value to null to remove it. Enable Truncate to wipe the entire existing data dictionary before inserting the new entries. Requires Service Account credentials.
   * @route PUT /lexicon-schemas
   *
   * @paramDef {"type":"Array<LexiconSchemaEntry>","label":"Entries","name":"entries","required":true,"description":"Schema entries to create or replace."}
   * @paramDef {"type":"Boolean","label":"Truncate","name":"truncate","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, removes the entire existing data dictionary before inserting the new entries. Use for full tracking-plan replacements."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","results":[{"entityType":"event","name":"Sign Up"}]}
   */
  async uploadLexiconSchemas(entries, truncate) {
    const authorization = this.#serviceAccountAuth()

    const body = {
      entries: (entries || []).map(entry => ({
        entityType: entry.entityType,
        name: entry.name,
        schemaJson: entry.schemaJson,
      })),
      truncate: Boolean(truncate),
    }

    return await this.#apiRequest({
      url: `${ this.queryBase }/app/projects/${ this.projectId }/schemas`,
      method: 'post',
      headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      logTag: '[uploadLexiconSchemas]',
    })
  }

  // ===========================================================================
  // Dictionaries
  // ===========================================================================

  /**
   * @typedef {Object} getCohortsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to cohort names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The cohorts list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Cohorts Dictionary
   * @description Provides the project's saved cohorts for selection in dependent parameters such as the Cohort filter of Query Profiles. The option value is the numeric cohort ID.
   * @route POST /get-cohorts-dictionary
   * @paramDef {"type":"getCohortsDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter cohorts by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Power Users","value":"1150561","note":"1430 users"}],"cursor":null}
   */
  async getCohortsDictionary(payload) {
    const { search } = payload || {}

    const cohorts = await this.#queryRequest({
      path: '/query/cohorts/list',
      method: 'post',
      formBody: {},
      logTag: '[getCohortsDictionary]',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (cohorts || [])
      .filter(cohort => !searchLower || String(cohort.name || '').toLowerCase().includes(searchLower))
      .map(cohort => ({
        label: cohort.name,
        value: String(cohort.id),
        note: typeof cohort.count === 'number' ? `${ cohort.count } users` : undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getFunnelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to funnel names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The funnels list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Funnels Dictionary
   * @description Provides the project's saved funnels for selection in the Funnel parameter of Run Funnel Query. The option value is the numeric funnel ID.
   * @route POST /get-funnels-dictionary
   * @paramDef {"type":"getFunnelsDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter funnels by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Signup funnel","value":"7509"}],"cursor":null}
   */
  async getFunnelsDictionary(payload) {
    const { search } = payload || {}

    const funnels = await this.#queryRequest({
      path: '/query/funnels/list',
      logTag: '[getFunnelsDictionary]',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (funnels || [])
      .filter(funnel => !searchLower || String(funnel.name || '').toLowerCase().includes(searchLower))
      .map(funnel => ({
        label: funnel.name,
        value: String(funnel.funnel_id),
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getEventNamesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to event names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The event names list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Names Dictionary
   * @description Provides the names of the project's most common events over the last 31 days for selection in event parameters such as Run Segmentation Query and Run Retention Query. The option value is the event name.
   * @route POST /get-event-names-dictionary
   * @paramDef {"type":"getEventNamesDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter event names."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sign Up","value":"Sign Up"},{"label":"Purchase","value":"Purchase"}],"cursor":null}
   */
  async getEventNamesDictionary(payload) {
    const { search } = payload || {}

    const names = await this.#queryRequest({
      path: '/query/events/names',
      query: { type: 'general', limit: DICTIONARY_PAGE_SIZE },
      logTag: '[getEventNamesDictionary]',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (names || [])
      .filter(name => !searchLower || String(name).toLowerCase().includes(searchLower))
      .map(name => ({ label: name, value: name }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(MixpanelService, [
  {
    name: 'region',
    displayName: 'Data Residency Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    defaultValue: 'US',
    options: ['US', 'EU', 'India'],
    hint: 'The data residency region of your Mixpanel project. US uses api.mixpanel.com / mixpanel.com, EU uses api-eu.mixpanel.com / eu.mixpanel.com, India uses api-in.mixpanel.com / in.mixpanel.com. Check it in Project Settings → Overview.',
  },
  {
    name: 'projectToken',
    displayName: 'Project Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The project token used by ingestion operations (Track Event, profile/group updates, Create Alias). Find it in Mixpanel under Project Settings → Overview → Access Keys.',
  },
  {
    name: 'serviceAccountUsername',
    displayName: 'Service Account Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Service account username, required for query, import, export, identity merge and Lexicon operations. Create a service account in Mixpanel under Organization Settings → Service Accounts.',
  },
  {
    name: 'serviceAccountSecret',
    displayName: 'Service Account Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The secret of the service account. Shown only once when the service account is created.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The numeric project ID, required together with the service account credentials. Find it in Mixpanel under Project Settings → Overview.',
  },
])
