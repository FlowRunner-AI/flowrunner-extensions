const logger = {
  info: (...args) => console.log('[Amplitude] info:', ...args),
  debug: (...args) => console.log('[Amplitude] debug:', ...args),
  error: (...args) => console.log('[Amplitude] error:', ...args),
  warn: (...args) => console.log('[Amplitude] warn:', ...args),
}

const REGION_HOSTS = {
  US: {
    ingestion: 'https://api2.amplitude.com',
    analytics: 'https://amplitude.com',
    profile: 'https://profile-api.amplitude.com',
  },
  EU: {
    ingestion: 'https://api.eu.amplitude.com',
    analytics: 'https://analytics.eu.amplitude.com',
    profile: null,
  },
}

const INTERVAL_VALUES = {
  'Real-time': '-300000',
  'Hourly': '-3600000',
  'Daily': '1',
  'Weekly': '7',
  'Monthly': '30',
}

const BASIC_INTERVAL_VALUES = {
  Daily: '1',
  Weekly: '7',
  Monthly: '30',
}

const SEGMENTATION_METRICS = {
  'Uniques': 'uniques',
  'Event Totals': 'totals',
  'Active %': 'pct_dau',
  'Average': 'average',
  'Frequency Histogram': 'histogram',
  'Property Sum': 'sums',
  'Property Average': 'value_avg',
  'Formula': 'formula',
}

const LTV_METRICS = {
  'ARPU': '0',
  'ARPPU': '1',
  'Total Revenue': '2',
  'Paying Users': '3',
}

const TAXONOMY_PROPERTY_TYPES = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Enum: 'enum',
  Any: 'any',
}

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
 * @typedef {Object} AmplitudeEvent
 * @paramDef {"type":"String","label":"Event Type","name":"event_type","required":true,"description":"Name of the event, e.g. button_clicked."}
 * @paramDef {"type":"String","label":"User ID","name":"user_id","description":"Unique user identifier (minimum 5 characters by default). Each event requires a user_id or a device_id."}
 * @paramDef {"type":"String","label":"Device ID","name":"device_id","description":"Device identifier (minimum 5 characters by default). Each event requires a user_id or a device_id."}
 * @paramDef {"type":"Number","label":"Time","name":"time","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event timestamp in milliseconds since epoch. Defaults to the time Amplitude receives the event."}
 * @paramDef {"type":"Object","label":"Event Properties","name":"event_properties","description":"Key-value properties describing the event, e.g. {\"source\":\"notification\"}."}
 * @paramDef {"type":"Object","label":"User Properties","name":"user_properties","description":"Key-value user properties to set on the user at event time."}
 * @paramDef {"type":"Object","label":"Groups","name":"groups","description":"Group memberships for account-level analytics, e.g. {\"company\":\"Acme\"}. Up to 5 group types per event."}
 * @paramDef {"type":"String","label":"Insert ID","name":"insert_id","description":"Unique identifier used to deduplicate the event within a 7-day window."}
 * @paramDef {"type":"Number","label":"Session ID","name":"session_id","description":"Session start timestamp in milliseconds since epoch, or -1 for events outside a session."}
 * @paramDef {"type":"String","label":"Platform","name":"platform","description":"Platform of the device, e.g. iOS, Android, Web."}
 * @paramDef {"type":"String","label":"Country","name":"country","description":"Country of the user."}
 * @paramDef {"type":"String","label":"IP Address","name":"ip","description":"IP of the user. Use $remote to let Amplitude derive location from the request IP."}
 * @paramDef {"type":"Number","label":"Price","name":"price","description":"Price of the item purchased. Required for revenue tracking unless revenue is set."}
 * @paramDef {"type":"Number","label":"Quantity","name":"quantity","description":"Quantity of items purchased. Defaults to 1 when revenue is tracked."}
 * @paramDef {"type":"Number","label":"Revenue","name":"revenue","description":"Total revenue for the event. Amplitude uses price * quantity when not set."}
 * @paramDef {"type":"String","label":"Product ID","name":"productId","description":"Identifier of the product purchased."}
 */

/**
 * @typedef {Object} SegmentationEvent
 * @paramDef {"type":"String","label":"Event Type","name":"event_type","required":true,"description":"Amplitude event name. Prefix custom events with ce: (e.g. ce:My Event). Retention also accepts the pseudo events _new, _active and _all."}
 * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","description":"Optional property filters. Each object has subprop_type (event or user), subprop_key (property name, prefix custom user properties with gp:), subprop_op (is, is not, contains, does not contain, less, less or equal, greater, greater or equal, set is, set is not) and subprop_value (array of values)."}
 * @paramDef {"type":"Array<Object>","label":"Group By","name":"group_by","description":"Optional grouping applied to this event. Each object has type (event or user) and value (the property name)."}
 */

/**
 * @integrationName Amplitude
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class AmplitudeService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.secretKey = config.secretKey
    this.region = (config.region || 'US').toUpperCase() === 'EU' ? 'EU' : 'US'
  }

  #getHosts() {
    return REGION_HOSTS[this.region] || REGION_HOSTS.US
  }

  #basicAuthHeader() {
    return `Basic ${ Buffer.from(`${ this.apiKey }:${ this.secretKey }`).toString('base64') }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildQueryString(pairs) {
    const params = new URLSearchParams()

    for (const [key, value] of pairs) {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value)
      }
    }

    return params.toString()
  }

  #buildPropertyOperations({ set, setOnce, add, append, prepend, unset }) {
    const operations = {}

    if (set && Object.keys(set).length) {
      operations.$set = set
    }

    if (setOnce && Object.keys(setOnce).length) {
      operations.$setOnce = setOnce
    }

    if (add && Object.keys(add).length) {
      operations.$add = add
    }

    if (append && Object.keys(append).length) {
      operations.$append = append
    }

    if (prepend && Object.keys(prepend).length) {
      operations.$prepend = prepend
    }

    if (unset && unset.length) {
      operations.$unset = unset.reduce((acc, propertyName) => ({ ...acc, [propertyName]: '-' }), {})
    }

    return Object.keys(operations).length ? operations : undefined
  }

  async #apiRequest({ url, method = 'get', headers, query, body, form, binary, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers || {})
        .query(clean(query) || {})

      if (binary) {
        request = request.setEncoding(null)
      }

      if (form !== undefined) {
        request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })

        return await request.send(new URLSearchParams(clean(form)).toString())
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const rawMessage = error.body?.error || error.body?.errors?.[0]?.message || error.body?.message || error.message
      const message = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Amplitude API error: ${ message }`)
    }
  }

  async #ingestionRequest({ path, body, form, logTag }) {
    return this.#apiRequest({
      url: `${ this.#getHosts().ingestion }${ path }`,
      method: 'post',
      body,
      form,
      logTag,
    })
  }

  async #analyticsRequest({ path, method = 'get', query, body, form, binary, logTag }) {
    return this.#apiRequest({
      url: `${ this.#getHosts().analytics }${ path }`,
      headers: { Authorization: this.#basicAuthHeader() },
      method,
      query,
      body,
      form,
      binary,
      logTag,
    })
  }

  // ---------------------------------------------------------------------------
  // Event Ingestion (HTTP V2 / Batch / Identify APIs — api_key sent in the body)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Track Event
   * @category Event Ingestion
   * @description Sends a single event to Amplitude through the HTTP V2 API. Requires a User ID or Device ID (minimum 5 characters by default). Supports event and user properties, group memberships, revenue fields and an insert ID for 7-day deduplication. Authenticated with the project API key in the request body.
   * @route POST /track-event
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getEventTypesDictionary","description":"Name of the event to record, e.g. button_clicked. Select an existing event type or type a new name."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Unique user identifier (minimum 5 characters by default). Either User ID or Device ID is required."}
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Device identifier (minimum 5 characters by default). Either User ID or Device ID is required."}
   * @paramDef {"type":"Object","label":"Event Properties","name":"eventProperties","description":"Key-value properties describing the event, e.g. {\"source\":\"notification\",\"load_time\":0.8}."}
   * @paramDef {"type":"Object","label":"User Properties","name":"userProperties","description":"Key-value user properties to set on the user at event time, e.g. {\"plan\":\"premium\"}."}
   * @paramDef {"type":"Object","label":"Groups","name":"groups","description":"Group memberships for account-level analytics, e.g. {\"company\":\"Acme\"}. Up to 5 group types per event."}
   * @paramDef {"type":"Number","label":"Time","name":"time","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event timestamp in milliseconds since epoch. Defaults to the time Amplitude receives the event."}
   * @paramDef {"type":"String","label":"Insert ID","name":"insertId","description":"Unique identifier used to deduplicate the event within a 7-day window. Recommended for safe retries."}
   * @paramDef {"type":"Number","label":"Session ID","name":"sessionId","description":"Session start timestamp in milliseconds since epoch, or -1 for events outside a session."}
   * @paramDef {"type":"Number","label":"Minimum ID Length","name":"minIdLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Overrides the default 5-character minimum length for user_id and device_id."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Extra top-level event fields merged into the payload, e.g. platform, os_name, country, city, language, price, quantity, revenue, productId, ip."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"events_ingested":1,"payload_size_bytes":311,"server_upload_time":1752739200000}
   */
  async trackEvent(eventType, userId, deviceId, eventProperties, userProperties, groups, time, insertId, sessionId, minIdLength, additionalFields) {
    const logTag = '[trackEvent]'

    if (!userId && !deviceId) {
      throw new Error('Either User ID or Device ID must be provided.')
    }

    const event = clean({
      event_type: eventType,
      user_id: userId,
      device_id: deviceId,
      event_properties: eventProperties,
      user_properties: userProperties,
      groups,
      time,
      insert_id: insertId,
      session_id: sessionId,
      ...(additionalFields || {}),
    })

    return await this.#ingestionRequest({
      logTag,
      path: '/2/httpapi',
      body: clean({
        api_key: this.apiKey,
        events: [event],
        options: minIdLength ? { min_id_length: minIdLength } : undefined,
      }),
    })
  }

  /**
   * @operationName Track Multiple Events
   * @category Event Ingestion
   * @description Sends up to 2000 events in one request through the HTTP V2 API. Each event needs an event_type plus a user_id or device_id, and may include properties, groups, revenue fields and an insert_id for deduplication. Keep the payload under 1 MB. Authenticated with the project API key in the request body.
   * @route POST /track-events
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Array<AmplitudeEvent>","label":"Events","name":"events","required":true,"description":"Array of event objects to ingest. Each requires event_type and a user_id or device_id."}
   * @paramDef {"type":"Number","label":"Minimum ID Length","name":"minIdLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Overrides the default 5-character minimum length for user_id and device_id."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"events_ingested":25,"payload_size_bytes":6421,"server_upload_time":1752739200000}
   */
  async trackEvents(events, minIdLength) {
    const logTag = '[trackEvents]'

    if (!events || !events.length) {
      throw new Error('At least one event must be provided.')
    }

    return await this.#ingestionRequest({
      logTag,
      path: '/2/httpapi',
      body: clean({
        api_key: this.apiKey,
        events: events.map(event => clean(event)),
        options: minIdLength ? { min_id_length: minIdLength } : undefined,
      }),
    })
  }

  /**
   * @operationName Batch Upload Events
   * @category Event Ingestion
   * @description Uploads events through the Batch Event Upload API, designed for high-volume and historical backfills. Accepts up to 2000 events and 20 MB per request with higher per-device throughput than the HTTP V2 endpoint. Events use the same shape as Track Multiple Events. Authenticated with the project API key in the request body.
   * @route POST /batch-upload-events
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Array<AmplitudeEvent>","label":"Events","name":"events","required":true,"description":"Array of event objects to upload. Each requires event_type and a user_id or device_id."}
   * @paramDef {"type":"Number","label":"Minimum ID Length","name":"minIdLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Overrides the default 5-character minimum length for user_id and device_id."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"events_ingested":2000,"payload_size_bytes":512044,"server_upload_time":1752739200000}
   */
  async batchUploadEvents(events, minIdLength) {
    const logTag = '[batchUploadEvents]'

    if (!events || !events.length) {
      throw new Error('At least one event must be provided.')
    }

    return await this.#ingestionRequest({
      logTag,
      path: '/batch',
      body: clean({
        api_key: this.apiKey,
        events: events.map(event => clean(event)),
        options: minIdLength ? { min_id_length: minIdLength } : undefined,
      }),
    })
  }

  /**
   * @operationName Identify User
   * @category Event Ingestion
   * @description Updates a user's properties in Amplitude without sending an event, using the Identify API. Supports set, set-once, numeric add, list append/prepend and unset operations, plus top-level identification fields such as platform, country or language. Requires a User ID or Device ID. Authenticated with the project API key in the form body.
   * @route POST /identify-user
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Unique user identifier. Either User ID or Device ID is required."}
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Device identifier. Either User ID or Device ID is required."}
   * @paramDef {"type":"Object","label":"Set Properties","name":"setProperties","description":"Properties to set on the user, overwriting existing values, e.g. {\"plan\":\"premium\"}."}
   * @paramDef {"type":"Object","label":"Set Once Properties","name":"setOnceProperties","description":"Properties to set only if they have no existing value, e.g. {\"signup_date\":\"2026-07-17\"}."}
   * @paramDef {"type":"Object","label":"Add Properties","name":"addProperties","description":"Numeric properties to increment by the given amount, e.g. {\"purchases\":1}."}
   * @paramDef {"type":"Object","label":"Append Properties","name":"appendProperties","description":"Values to append to list-type user properties, e.g. {\"tags\":\"beta\"}."}
   * @paramDef {"type":"Object","label":"Prepend Properties","name":"prependProperties","description":"Values to prepend to list-type user properties."}
   * @paramDef {"type":"Array<String>","label":"Unset Properties","name":"unsetProperties","description":"Names of user properties to remove from the user."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Extra top-level identification fields merged into the payload, e.g. platform, os_name, os_version, country, city, language, paying, start_version."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async identifyUser(userId, deviceId, setProperties, setOnceProperties, addProperties, appendProperties, prependProperties, unsetProperties, additionalFields) {
    const logTag = '[identifyUser]'

    if (!userId && !deviceId) {
      throw new Error('Either User ID or Device ID must be provided.')
    }

    const identification = clean({
      user_id: userId,
      device_id: deviceId,
      user_properties: this.#buildPropertyOperations({
        set: setProperties,
        setOnce: setOnceProperties,
        add: addProperties,
        append: appendProperties,
        prepend: prependProperties,
        unset: unsetProperties,
      }),
      ...(additionalFields || {}),
    })

    await this.#ingestionRequest({
      logTag,
      path: '/identify',
      form: {
        api_key: this.apiKey,
        identification: JSON.stringify(identification),
      },
    })

    return { success: true }
  }

  /**
   * @operationName Group Identify
   * @category Event Ingestion
   * @description Sets or updates properties of a group (e.g. a company or account) through the Group Identify API. Supports set, set-once, numeric add, list append/prepend and unset operations on group properties. Changes apply to future events only. Authenticated with the project API key in the form body.
   * @route POST /group-identify
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Group Type","name":"groupType","required":true,"description":"Type of the group, e.g. company or account. Must match a group type configured in your project."}
   * @paramDef {"type":"String","label":"Group Value","name":"groupValue","required":true,"description":"Value identifying the group instance, e.g. Acme Corp."}
   * @paramDef {"type":"Object","label":"Set Properties","name":"setProperties","description":"Group properties to set, overwriting existing values, e.g. {\"tier\":\"enterprise\",\"seats\":250}."}
   * @paramDef {"type":"Object","label":"Set Once Properties","name":"setOnceProperties","description":"Group properties to set only if they have no existing value."}
   * @paramDef {"type":"Object","label":"Add Properties","name":"addProperties","description":"Numeric group properties to increment by the given amount."}
   * @paramDef {"type":"Object","label":"Append Properties","name":"appendProperties","description":"Values to append to list-type group properties."}
   * @paramDef {"type":"Object","label":"Prepend Properties","name":"prependProperties","description":"Values to prepend to list-type group properties."}
   * @paramDef {"type":"Array<String>","label":"Unset Properties","name":"unsetProperties","description":"Names of group properties to remove from the group."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async groupIdentify(groupType, groupValue, setProperties, setOnceProperties, addProperties, appendProperties, prependProperties, unsetProperties) {
    const logTag = '[groupIdentify]'

    const identification = clean({
      group_type: groupType,
      group_value: groupValue,
      group_properties: this.#buildPropertyOperations({
        set: setProperties,
        setOnce: setOnceProperties,
        add: addProperties,
        append: appendProperties,
        prepend: prependProperties,
        unset: unsetProperties,
      }),
    })

    await this.#ingestionRequest({
      logTag,
      path: '/groupidentify',
      form: {
        api_key: this.apiKey,
        identification: JSON.stringify(identification),
      },
    })

    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Analytics (Dashboard REST API — Basic auth api_key:secret_key)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Events
   * @category Analytics
   * @description Retrieves all event types visible in your Amplitude project with totals and unique user counts for the current week, including whether each event is marked non-active or deleted. Useful for discovering event names to use in segmentation, funnel and retention queries.
   * @route GET /events-list
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @returns {Object}
   * @sampleResult {"data":[{"non_active":false,"value":"purchase","totals":10231,"totals_delta":120,"uniques":2410,"uniques_delta":35,"deleted":false}]}
   */
  async listEvents() {
    const logTag = '[listEvents]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/events/list',
    })
  }

  /**
   * @operationName Get Event Segmentation
   * @category Analytics
   * @description Runs an Event Segmentation query and returns metrics for one or two events over a date range, segmented and grouped by properties. Supports uniques, totals, active percentage, averages, histograms, property sums/averages and custom formulas, with real-time to monthly intervals.
   * @route GET /event-segmentation
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"SegmentationEvent","label":"Event","name":"event","required":true,"description":"Primary event to analyze."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   * @paramDef {"type":"SegmentationEvent","label":"Second Event","name":"event2","description":"Optional second event to compare against the primary event."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","defaultValue":"Uniques","uiComponent":{"type":"DROPDOWN","options":{"values":["Uniques","Event Totals","Active %","Average","Frequency Histogram","Property Sum","Property Average","Formula"]}},"description":"Metric to compute. Property Sum and Property Average require a numeric property group_by on the event; Formula requires the Formula parameter."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","defaultValue":"Daily","uiComponent":{"type":"DROPDOWN","options":{"values":["Real-time","Hourly","Daily","Weekly","Monthly"]}},"description":"Time bucket for the series. Real-time returns 5-minute granularity."}
   * @paramDef {"type":"String","label":"User Type","name":"userType","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Users","Active Users"]}},"description":"Whether to count any users or only active users. Defaults to Any Users."}
   * @paramDef {"type":"Array<Object>","label":"Segment Definitions","name":"segmentDefinitions","description":"Optional segment filters, e.g. [{\"prop\":\"country\",\"op\":\"is\",\"values\":[\"United States\"]}]. Prefix custom user properties with gp:."}
   * @paramDef {"type":"String","label":"Group By","name":"groupBy","description":"User property to group results by, e.g. country or gp:utm_source."}
   * @paramDef {"type":"String","label":"Second Group By","name":"groupBy2","description":"Optional second property to group results by."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of Group By values returned (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Formula","name":"formula","description":"Custom formula when Metric is Formula, e.g. UNIQUES(A)/UNIQUES(B). Events are referenced as A and B."}
   * @paramDef {"type":"Number","label":"Rolling Window","name":"rollingWindow","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rolling window size in days, weeks or months (matching the interval) for rolling metrics."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"series":[[1250,1330,1245]],"seriesLabels":[0],"seriesCollapsed":[[{"setId":"","value":3825}]],"xValues":["2026-07-01","2026-07-02","2026-07-03"]}}
   */
  async getEventSegmentation(event, startDate, endDate, event2, metric, interval, userType, segmentDefinitions, groupBy, groupBy2, limit, formula, rollingWindow) {
    const logTag = '[getEventSegmentation]'

    const queryString = this.#buildQueryString([
      ['e', JSON.stringify(event)],
      ['e', event2 ? JSON.stringify(event2) : undefined],
      ['start', startDate],
      ['end', endDate],
      ['m', this.#resolveChoice(metric, SEGMENTATION_METRICS)],
      ['i', this.#resolveChoice(interval, INTERVAL_VALUES)],
      ['n', this.#resolveChoice(userType, { 'Any Users': 'any', 'Active Users': 'active' })],
      ['s', segmentDefinitions && segmentDefinitions.length ? JSON.stringify(segmentDefinitions) : undefined],
      ['g', groupBy],
      ['g', groupBy2],
      ['limit', limit],
      ['formula', formula],
      ['rollingWindow', rollingWindow],
    ])

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/events/segmentation?${ queryString }`,
    })
  }

  /**
   * @operationName Get Funnel Analysis
   * @category Analytics
   * @description Runs a Funnel Analysis query for an ordered, unordered or sequential series of events over a date range. Returns step-by-step and cumulative conversion rates, raw counts, and average/median transition times, optionally segmented and grouped by a property.
   * @route GET /funnels
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<SegmentationEvent>","label":"Funnel Steps","name":"events","required":true,"description":"Ordered list of events forming the funnel steps."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","defaultValue":"Ordered","uiComponent":{"type":"DROPDOWN","options":{"values":["Ordered","Unordered","Sequential"]}},"description":"How steps must be completed: Ordered (this order, other events allowed in between), Unordered (any order) or Sequential (this exact order with no other events in between)."}
   * @paramDef {"type":"String","label":"User Type","name":"userType","uiComponent":{"type":"DROPDOWN","options":{"values":["New Users","Active Users"]}},"description":"Whether to count only new users or all active users. Defaults to Active Users."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["Daily","Weekly","Monthly"]}},"description":"Time bucket for the series. Defaults to Daily."}
   * @paramDef {"type":"Array<Object>","label":"Segment Definitions","name":"segmentDefinitions","description":"Optional segment filters, e.g. [{\"prop\":\"country\",\"op\":\"is\",\"values\":[\"United States\"]}]."}
   * @paramDef {"type":"String","label":"Group By","name":"groupBy","description":"User property to group results by, e.g. country or gp:utm_source."}
   * @paramDef {"type":"Number","label":"Conversion Window Seconds","name":"conversionWindowSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum time in seconds users have to complete the funnel. Defaults to 2592000 (30 days)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of Group By values returned (1-1000). Defaults to 100."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"events":["sign_up","purchase"],"stepByStep":[1,0.559],"cumulative":[1,0.559],"cumulativeRaw":[54492,30434],"avgTransTimes":[0,2422575],"medianTransTimes":[0,1216000],"dayFunnels":{"series":[],"xValues":[]}}]}
   */
  async getFunnels(events, startDate, endDate, mode, userType, interval, segmentDefinitions, groupBy, conversionWindowSeconds, limit) {
    const logTag = '[getFunnels]'

    if (!events || !events.length) {
      throw new Error('At least one funnel step event must be provided.')
    }

    const pairs = events.map(event => ['e', JSON.stringify(event)])

    pairs.push(
      ['start', startDate],
      ['end', endDate],
      ['mode', this.#resolveChoice(mode, { Ordered: 'ordered', Unordered: 'unordered', Sequential: 'sequential' })],
      ['n', this.#resolveChoice(userType, { 'New Users': 'new', 'Active Users': 'active' })],
      ['i', this.#resolveChoice(interval, BASIC_INTERVAL_VALUES)],
      ['s', segmentDefinitions && segmentDefinitions.length ? JSON.stringify(segmentDefinitions) : undefined],
      ['g', groupBy],
      ['cs', conversionWindowSeconds],
      ['limit', limit]
    )

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/funnels?${ this.#buildQueryString(pairs) }`,
    })
  }

  /**
   * @operationName Get Retention Analysis
   * @category Analytics
   * @description Runs a Retention Analysis query measuring how many users return and perform an event after a starting event. Supports n-day, rolling and bracket retention modes with daily, weekly or monthly intervals, optional segmentation and grouping.
   * @route GET /retention
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"SegmentationEvent","label":"Start Event","name":"startEvent","required":true,"description":"Event that starts the retention window. Use event_type _new for new users or _active for all active users, or any project event."}
   * @paramDef {"type":"SegmentationEvent","label":"Return Event","name":"returnEvent","required":true,"description":"Event that counts as a return. Use event_type _all for any event or _active for active usage, or any project event."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   * @paramDef {"type":"String","label":"Retention Mode","name":"retentionMode","uiComponent":{"type":"DROPDOWN","options":{"values":["N-Day","Rolling","Bracket"]}},"description":"Retention calculation mode. Defaults to N-Day. Bracket mode requires the Bracket parameter."}
   * @paramDef {"type":"String","label":"Bracket","name":"bracket","description":"Day brackets as a JSON array when Retention Mode is Bracket, e.g. [[0,4],[5,10]]."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["Daily","Weekly","Monthly"]}},"description":"Time bucket for the retention series. Defaults to Daily."}
   * @paramDef {"type":"Array<Object>","label":"Segment Definitions","name":"segmentDefinitions","description":"Optional segment filters, e.g. [{\"prop\":\"country\",\"op\":\"is\",\"values\":[\"United States\"]}]."}
   * @paramDef {"type":"String","label":"Group By","name":"groupBy","description":"User property to group results by, e.g. country or gp:utm_source."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"seriesLabels":[""],"series":[[{"count":1000,"outof":1000,"incomplete":false},{"count":410,"outof":1000,"incomplete":false}]],"xValues":["2026-07-01"]}}
   */
  async getRetention(startEvent, returnEvent, startDate, endDate, retentionMode, bracket, interval, segmentDefinitions, groupBy) {
    const logTag = '[getRetention]'

    const queryString = this.#buildQueryString([
      ['se', JSON.stringify(startEvent)],
      ['re', JSON.stringify(returnEvent)],
      ['start', startDate],
      ['end', endDate],
      ['rm', this.#resolveChoice(retentionMode, { 'N-Day': 'n-day', 'Rolling': 'rolling', 'Bracket': 'bracket' })],
      ['rb', bracket],
      ['i', this.#resolveChoice(interval, BASIC_INTERVAL_VALUES)],
      ['s', segmentDefinitions && segmentDefinitions.length ? JSON.stringify(segmentDefinitions) : undefined],
      ['g', groupBy],
    ])

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/retention?${ queryString }`,
    })
  }

  /**
   * @operationName Get Realtime Active Users
   * @category Analytics
   * @description Retrieves realtime active user counts with 5-minute granularity for today and yesterday, allowing side-by-side comparison of current activity against the previous day.
   * @route GET /realtime-active-users
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @returns {Object}
   * @sampleResult {"data":{"series":[[123,145,160],[110,128,142]],"seriesLabels":["Today","Yesterday"],"xValues":["00:00","00:05","00:10"]}}
   */
  async getRealtimeActiveUsers() {
    const logTag = '[getRealtimeActiveUsers]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/realtime',
    })
  }

  /**
   * @operationName Get Average Session Length
   * @category Analytics
   * @description Retrieves the average session length in seconds for each day in the specified date range.
   * @route GET /sessions-average
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"series":[[1141.9,1230.2]],"seriesLabels":[""],"xValues":["2026-07-01","2026-07-02"]}}
   */
  async getAverageSessionLength(startDate, endDate) {
    const logTag = '[getAverageSessionLength]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/sessions/average',
      query: { start: startDate, end: endDate },
    })
  }

  /**
   * @operationName Get Average Sessions Per User
   * @category Analytics
   * @description Retrieves the average number of sessions per user for each day in the specified date range.
   * @route GET /sessions-per-user
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"series":[[2.4,2.6]],"seriesLabels":[""],"xValues":["2026-07-01","2026-07-02"]}}
   */
  async getAverageSessionsPerUser(startDate, endDate) {
    const logTag = '[getAverageSessionsPerUser]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/sessions/peruser',
      query: { start: startDate, end: endDate },
    })
  }

  /**
   * @operationName Get Session Length Distribution
   * @category Analytics
   * @description Retrieves the distribution of session lengths within the specified date range, bucketed into configurable histogram bins.
   * @route GET /sessions-length-distribution
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   * @paramDef {"type":"String","label":"Bin Time Unit","name":"binTimeUnit","uiComponent":{"type":"DROPDOWN","options":{"values":["Hours","Minutes","Seconds"]}},"description":"Time unit used for the histogram bins."}
   * @paramDef {"type":"Number","label":"Bin Minimum","name":"binMin","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Lower bound of the histogram in the chosen time unit."}
   * @paramDef {"type":"Number","label":"Bin Maximum","name":"binMax","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound of the histogram in the chosen time unit."}
   * @paramDef {"type":"Number","label":"Bin Size","name":"binSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Size of each histogram bin in the chosen time unit."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"series":[[1024,845,410]],"seriesLabels":[""],"xValues":["0-1 min","1-2 min","2-3 min"]}}
   */
  async getSessionLengthDistribution(startDate, endDate, binTimeUnit, binMin, binMax, binSize) {
    const logTag = '[getSessionLengthDistribution]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/sessions/length',
      query: {
        start: startDate,
        end: endDate,
        timeHistogramConfigBinTimeUnit: this.#resolveChoice(binTimeUnit, { Hours: 'hours', Minutes: 'minutes', Seconds: 'seconds' }),
        timeHistogramConfigBinMin: binMin,
        timeHistogramConfigBinMax: binMax,
        timeHistogramConfigBinSize: binSize,
      },
    })
  }

  /**
   * @operationName Get Revenue LTV
   * @category Analytics
   * @description Runs a Revenue Lifetime Value query returning ARPU, ARPPU, total revenue or paying user counts for users grouped by their start date, optionally segmented and grouped by a property.
   * @route GET /revenue-ltv
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First date of the query range in YYYYMMDD format, e.g. 20260701."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"description":"Last date of the query range in YYYYMMDD format, e.g. 20260714."}
   * @paramDef {"type":"String","label":"Metric","name":"metric","uiComponent":{"type":"DROPDOWN","options":{"values":["ARPU","ARPPU","Total Revenue","Paying Users"]}},"description":"Revenue metric to compute. Defaults to ARPU (average revenue per user)."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","uiComponent":{"type":"DROPDOWN","options":{"values":["Daily","Weekly","Monthly"]}},"description":"Time bucket for grouping users by start date. Defaults to Daily."}
   * @paramDef {"type":"Array<Object>","label":"Segment Definitions","name":"segmentDefinitions","description":"Optional segment filters, e.g. [{\"prop\":\"country\",\"op\":\"is\",\"values\":[\"United States\"]}]."}
   * @paramDef {"type":"String","label":"Group By","name":"groupBy","description":"User property to group results by, e.g. country or gp:utm_source."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"seriesLabels":[""],"series":[{"dates":["2026-07-01"],"values":{"2026-07-01":{"r1d":9.99,"r7d":24.5,"count":100,"paid":12,"total_amount":119.88}}}]}}
   */
  async getRevenueLTV(startDate, endDate, metric, interval, segmentDefinitions, groupBy) {
    const logTag = '[getRevenueLTV]'

    const queryString = this.#buildQueryString([
      ['start', startDate],
      ['end', endDate],
      ['m', this.#resolveChoice(metric, LTV_METRICS)],
      ['i', this.#resolveChoice(interval, BASIC_INTERVAL_VALUES)],
      ['s', segmentDefinitions && segmentDefinitions.length ? JSON.stringify(segmentDefinitions) : undefined],
      ['g', groupBy],
    ])

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/revenue/ltv?${ queryString }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get User Activity
   * @category Users
   * @description Retrieves a user's summary (devices, location, usage totals) and paginated event stream for a specific Amplitude ID. Use Search Users first to resolve a User ID or Device ID to an Amplitude ID.
   * @route GET /user-activity
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Amplitude ID","name":"amplitudeId","required":true,"description":"Numeric Amplitude ID of the user. Resolve it with the Search Users operation."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-indexed offset into the user's event stream. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events returned (1-1000). Defaults to 1000."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Earliest","Latest"]}},"description":"Whether to page from the user's earliest or latest events. Defaults to Latest."}
   *
   * @returns {Object}
   * @sampleResult {"userData":{"user_id":"user@example.com","canonical_amplitude_id":2712988,"num_events":153,"num_sessions":36,"usage_time_length":2544452,"device_ids":["22b06a0f-3f3c"],"country":"United States","last_used":"2026-07-15"},"events":[{"event_type":"purchase","event_time":"2026-07-15 20:41:34.831000","event_properties":{"amount":20}}]}
   */
  async getUserActivity(amplitudeId, offset, limit, direction) {
    const logTag = '[getUserActivity]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/useractivity',
      query: {
        user: amplitudeId,
        offset,
        limit,
        direction: this.#resolveChoice(direction, { Earliest: 'earliest', Latest: 'latest' }),
      },
    })
  }

  /**
   * @operationName Search Users
   * @category Users
   * @description Searches for users by Amplitude ID, User ID, Device ID or User ID prefix. Returns matching users with their Amplitude IDs, which are required by Get User Activity and the deletion operations.
   * @route GET /user-search
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User","name":"user","required":true,"description":"Amplitude ID, User ID, Device ID or User ID prefix to search for."}
   *
   * @returns {Object}
   * @sampleResult {"matches":[{"amplitude_id":2712988,"user_id":"user@example.com"}],"type":"match_user_or_device_id"}
   */
  async searchUsers(user) {
    const logTag = '[searchUsers]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/usersearch',
      query: { user },
    })
  }

  /**
   * @operationName Get User Profile
   * @category Users
   * @description Retrieves a user's profile from the User Profile API, including Amplitude user properties, cohort membership IDs and recommendations. Requires a User ID or Device ID. Note: this API is served from profile-api.amplitude.com and is not available for EU-region projects.
   * @route GET /user-profile
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"User ID of the profile to fetch. Either User ID or Device ID is required."}
   * @paramDef {"type":"String","label":"Device ID","name":"deviceId","description":"Device ID of the profile to fetch. Either User ID or Device ID is required."}
   * @paramDef {"type":"Boolean","label":"Include User Properties","name":"includeUserProperties","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, returns the user's Amplitude user properties."}
   * @paramDef {"type":"Boolean","label":"Include Cohort IDs","name":"includeCohortIds","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, returns the IDs of cohorts the user belongs to."}
   * @paramDef {"type":"Boolean","label":"Include Recommendations","name":"includeRecommendations","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, returns Amplitude recommendation results for the user."}
   * @paramDef {"type":"String","label":"Recommendation ID","name":"recommendationId","description":"Comma-separated recommendation IDs to fetch specific recommendations."}
   *
   * @returns {Object}
   * @sampleResult {"userData":{"user_id":"user@example.com","device_id":"22b06a0f-3f3c","amp_props":{"plan":"pro","country":"United States"},"cohort_ids":["abc123"],"recommendations":null}}
   */
  async getUserProfile(userId, deviceId, includeUserProperties, includeCohortIds, includeRecommendations, recommendationId) {
    const logTag = '[getUserProfile]'

    const profileHost = this.#getHosts().profile

    if (!profileHost) {
      throw new Error('The Amplitude User Profile API is not available for EU-region projects.')
    }

    if (!userId && !deviceId) {
      throw new Error('Either User ID or Device ID must be provided.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ profileHost }/v1/userprofile`,
      headers: { Authorization: `Api-Key ${ this.secretKey }` },
      query: {
        user_id: userId,
        device_id: deviceId,
        get_amp_props: includeUserProperties ? 'true' : undefined,
        get_cohort_ids: includeCohortIds ? 'true' : undefined,
        get_recs: includeRecommendations ? 'true' : undefined,
        rec_id: recommendationId,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Chart Annotations
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Chart Annotations
   * @category Chart Annotations
   * @description Retrieves all chart annotations in the project, including their labels, timestamps, categories and optional chart associations.
   * @route GET /annotations
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"9befc3a6-abc1-4fca-8b45-0f1234567890","label":"Version 2.4 Release","start":"2026-07-01T07:00:00+00:00","end":null,"category":"Releases","chart_id":null,"details":"iOS rollout"}]}
   */
  async listChartAnnotations() {
    const logTag = '[listChartAnnotations]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/annotations',
    })
  }

  /**
   * @operationName Get Chart Annotation
   * @category Chart Annotations
   * @description Retrieves a single chart annotation by its ID.
   * @route GET /annotation
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Annotation ID","name":"annotationId","required":true,"description":"ID of the annotation to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"9befc3a6-abc1-4fca-8b45-0f1234567890","label":"Version 2.4 Release","start":"2026-07-01T07:00:00+00:00","end":null,"category":"Releases","chart_id":null,"details":"iOS rollout"}}
   */
  async getChartAnnotation(annotationId) {
    const logTag = '[getChartAnnotation]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/3/annotations/${ encodeURIComponent(annotationId) }`,
    })
  }

  /**
   * @operationName Create Chart Annotation
   * @category Chart Annotations
   * @description Creates a chart annotation marking a moment in time (e.g. a release or campaign launch) on Amplitude charts. Annotations can apply globally or to a specific chart and may span a time range.
   * @route POST /create-annotation
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"description":"Title of the annotation shown on charts."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"description":"Start timestamp in ISO 8601 format, e.g. 2026-07-01T07:00:00+00:00."}
   * @paramDef {"type":"String","label":"End","name":"end","description":"Optional end timestamp in ISO 8601 format for annotations spanning a time range."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Optional annotation category name used to group annotations."}
   * @paramDef {"type":"String","label":"Chart ID","name":"chartId","description":"Optional chart ID to attach the annotation to a single chart instead of all charts."}
   * @paramDef {"type":"String","label":"Details","name":"details","description":"Optional longer description of the annotation."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"9befc3a6-abc1-4fca-8b45-0f1234567890","label":"Version 2.4 Release","start":"2026-07-01T07:00:00+00:00","end":null,"category":"Releases","chart_id":null,"details":"iOS rollout"}}
   */
  async createChartAnnotation(label, start, end, category, chartId, details) {
    const logTag = '[createChartAnnotation]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/annotations',
      method: 'post',
      body: clean({ label, start, end, category, chart_id: chartId, details }),
    })
  }

  /**
   * @operationName Update Chart Annotation
   * @category Chart Annotations
   * @description Updates an existing chart annotation's label, timestamps, category, chart association or details.
   * @route PUT /update-annotation
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Annotation ID","name":"annotationId","required":true,"description":"ID of the annotation to update."}
   * @paramDef {"type":"String","label":"Label","name":"label","description":"New title of the annotation."}
   * @paramDef {"type":"String","label":"Start","name":"start","description":"New start timestamp in ISO 8601 format, e.g. 2026-07-01T07:00:00+00:00."}
   * @paramDef {"type":"String","label":"End","name":"end","description":"New end timestamp in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"New annotation category name."}
   * @paramDef {"type":"String","label":"Chart ID","name":"chartId","description":"Chart ID to attach the annotation to a single chart."}
   * @paramDef {"type":"String","label":"Details","name":"details","description":"New description of the annotation."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"9befc3a6-abc1-4fca-8b45-0f1234567890","label":"Version 2.4 Hotfix","start":"2026-07-02T07:00:00+00:00","end":null,"category":"Releases","chart_id":null,"details":"Patched crash on startup"}}
   */
  async updateChartAnnotation(annotationId, label, start, end, category, chartId, details) {
    const logTag = '[updateChartAnnotation]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/3/annotations/${ encodeURIComponent(annotationId) }`,
      method: 'put',
      body: clean({ label, start, end, category, chart_id: chartId, details }),
    })
  }

  /**
   * @operationName Delete Chart Annotation
   * @category Chart Annotations
   * @description Permanently deletes a chart annotation by its ID.
   * @route DELETE /delete-annotation
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Annotation ID","name":"annotationId","required":true,"description":"ID of the annotation to delete."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"9befc3a6-abc1-4fca-8b45-0f1234567890"}}
   */
  async deleteChartAnnotation(annotationId) {
    const logTag = '[deleteChartAnnotation]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/3/annotations/${ encodeURIComponent(annotationId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Behavioral Cohorts
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Cohorts
   * @category Cohorts
   * @description Retrieves all behavioral cohorts in the project with their IDs, names, sizes, owners and definitions. Optionally includes sync metadata for cohorts synced to destinations.
   * @route GET /cohorts
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Boolean","label":"Include Sync Info","name":"includeSyncInfo","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes sync metadata for each cohort."}
   *
   * @returns {Object}
   * @sampleResult {"cohorts":[{"id":"abc123","name":"Power Users","size":9520,"description":"Users with 10+ sessions","lastComputed":1752739200000,"owners":["owner@example.com"],"published":true,"archived":false}]}
   */
  async listCohorts(includeSyncInfo) {
    const logTag = '[listCohorts]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/cohorts',
      query: { includeSyncInfo: includeSyncInfo ? 'true' : undefined },
    })
  }

  /**
   * @operationName Request Cohort Download
   * @category Cohorts
   * @description Starts an asynchronous export of a cohort's members. Returns a request ID to poll with Get Cohort Download Status; once the job completes, fetch the member list with Download Cohort. Download requests count against a monthly quota (500 on Growth/Enterprise plans).
   * @route POST /request-cohort-download
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Cohort ID","name":"cohortId","required":true,"dictionary":"getCohortsDictionary","description":"ID of the cohort to export. Select a cohort or enter its ID."}
   * @paramDef {"type":"Boolean","label":"Include User Properties","name":"includeUserProperties","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, each exported member includes user properties."}
   * @paramDef {"type":"Array<String>","label":"Property Keys","name":"propertyKeys","description":"Specific user property names to include when Include User Properties is enabled. Leave empty to include all."}
   *
   * @returns {Object}
   * @sampleResult {"cohort_id":"abc123","request_id":"20260717-abc123-Ab3dE"}
   */
  async requestCohortDownload(cohortId, includeUserProperties, propertyKeys) {
    const logTag = '[requestCohortDownload]'

    const pairs = [['props', includeUserProperties ? '1' : undefined]]

    for (const key of propertyKeys || []) {
      pairs.push(['propKeys', key])
    }

    const queryString = this.#buildQueryString(pairs)

    return await this.#analyticsRequest({
      logTag,
      path: `/api/5/cohorts/request/${ encodeURIComponent(cohortId) }${ queryString ? `?${ queryString }` : '' }`,
    })
  }

  /**
   * @operationName Get Cohort Download Status
   * @category Cohorts
   * @description Checks the status of an asynchronous cohort download job started with Request Cohort Download. Returns JOB INPROGRESS while running and JOB COMPLETED when the file is ready to download.
   * @route GET /cohort-download-status
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"Request ID returned by Request Cohort Download."}
   *
   * @returns {Object}
   * @sampleResult {"async_status":"JOB COMPLETED","cohort_id":"abc123","request_id":"20260717-abc123-Ab3dE"}
   */
  async getCohortDownloadStatus(requestId) {
    const logTag = '[getCohortDownloadStatus]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/5/cohorts/request-status/${ encodeURIComponent(requestId) }`,
    })
  }

  /**
   * @operationName Download Cohort
   * @category Cohorts
   * @description Downloads the member list of a completed cohort export job. Call this after Get Cohort Download Status reports JOB COMPLETED. Large cohorts are served via a redirect and can contain up to 2 million users; prefer small cohorts when returning members directly into a flow.
   * @route GET /cohort-download-file
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"Request ID returned by Request Cohort Download."}
   *
   * @returns {Object}
   * @sampleResult {"users":[{"user_id":"user@example.com","amplitude_id":2712988}]}
   */
  async downloadCohort(requestId) {
    const logTag = '[downloadCohort]'

    const response = await this.#analyticsRequest({
      logTag,
      path: `/api/5/cohorts/request/${ encodeURIComponent(requestId) }/file`,
    })

    if (typeof response === 'string') {
      try {
        return JSON.parse(response)
      } catch (wholeParseError) {
        try {
          return { users: response.trim().split('\n').map(line => JSON.parse(line)) }
        } catch (lineParseError) {
          return { raw: response }
        }
      }
    }

    return response
  }

  /**
   * @operationName Get Cohort Download Usage
   * @category Cohorts
   * @description Retrieves the current month's cohort download usage and limit. The quota (500 requests per month on Growth/Enterprise plans) resets on the first of each month UTC.
   * @route GET /cohorts-usage
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @returns {Object}
   * @sampleResult {"limit":500,"count":12}
   */
  async getCohortDownloadUsage() {
    const logTag = '[getCohortDownloadUsage]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/cohorts/usage',
    })
  }

  /**
   * @operationName Upload Cohort
   * @category Cohorts
   * @description Creates a new static cohort (or replaces an existing one) from a list of user IDs or Amplitude IDs. Returns the number of matched users and a sample of invalid IDs. Maximum cohort size is 2 million users.
   * @route POST /upload-cohort
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the cohort to create."}
   * @paramDef {"type":"Number","label":"App ID","name":"appId","required":true,"description":"Numeric Amplitude project (app) ID the cohort belongs to."}
   * @paramDef {"type":"String","label":"ID Type","name":"idType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User ID","Amplitude ID"]}},"description":"Type of identifiers provided in the IDs list."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":true,"description":"User IDs or Amplitude IDs of the cohort members."}
   * @paramDef {"type":"String","label":"Owner","name":"owner","required":true,"description":"Login email of the cohort's owner in Amplitude."}
   * @paramDef {"type":"Boolean","label":"Published","name":"published","uiComponent":{"type":"CHECKBOX"},"description":"Whether the cohort is visible to the whole team (true) or private to the owner (false)."}
   * @paramDef {"type":"String","label":"Existing Cohort ID","name":"existingCohortId","dictionary":"getCohortsDictionary","description":"ID of an existing cohort to replace with this member list instead of creating a new one."}
   *
   * @returns {Object}
   * @sampleResult {"cohort_id":"abc123","matched_count":150,"skipped_ids":[]}
   */
  async uploadCohort(name, appId, idType, ids, owner, published, existingCohortId) {
    const logTag = '[uploadCohort]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/cohorts/upload',
      method: 'post',
      body: clean({
        name,
        app_id: appId,
        id_type: this.#resolveChoice(idType, { 'User ID': 'BY_USER_ID', 'Amplitude ID': 'BY_AMP_ID' }),
        ids,
        owner,
        published: published !== undefined ? published : true,
        existing_cohort_id: existingCohortId,
      }),
    })
  }

  /**
   * @operationName Update Cohort Membership
   * @category Cohorts
   * @description Incrementally adds or removes members of an existing cohort without re-uploading the full member list.
   * @route POST /update-cohort-membership
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Cohort ID","name":"cohortId","required":true,"dictionary":"getCohortsDictionary","description":"ID of the cohort to modify. Select a cohort or enter its ID."}
   * @paramDef {"type":"String","label":"Operation","name":"operation","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Add","Remove"]}},"description":"Whether to add the IDs to the cohort or remove them from it."}
   * @paramDef {"type":"String","label":"ID Type","name":"idType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User ID","Amplitude ID"]}},"description":"Type of identifiers provided in the IDs list."}
   * @paramDef {"type":"Array<String>","label":"IDs","name":"ids","required":true,"description":"User IDs or Amplitude IDs to add or remove."}
   *
   * @returns {Object}
   * @sampleResult {"cohort_id":"abc123","memberships_result":[{"operation":"ADD","matched_count":120,"skipped_ids":[]}]}
   */
  async updateCohortMembership(cohortId, operation, idType, ids) {
    const logTag = '[updateCohortMembership]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/3/cohorts/membership',
      method: 'post',
      body: {
        cohort_id: cohortId,
        memberships: [
          {
            ids,
            id_type: this.#resolveChoice(idType, { 'User ID': 'BY_USER_ID', 'Amplitude ID': 'BY_AMP_ID' }),
            operation: this.#resolveChoice(operation, { Add: 'ADD', Remove: 'REMOVE' }),
          },
        ],
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Taxonomy
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Event Categories
   * @category Taxonomy
   * @description Retrieves all event categories defined in the project's tracking plan taxonomy.
   * @route GET /taxonomy-categories
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":[{"id":412931,"name":"Onboarding"}]}
   */
  async listEventCategories() {
    const logTag = '[listEventCategories]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/category',
    })
  }

  /**
   * @operationName Create Event Category
   * @category Taxonomy
   * @description Creates a new event category in the project's tracking plan taxonomy. Requires the Amplitude Govern (Taxonomy) add-on.
   * @route POST /create-taxonomy-category
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Category Name","name":"categoryName","required":true,"description":"Name of the category to create, e.g. Onboarding."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async createEventCategory(categoryName) {
    const logTag = '[createEventCategory]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/category',
      method: 'post',
      form: { category_name: categoryName },
    })
  }

  /**
   * @operationName Update Event Category
   * @category Taxonomy
   * @description Renames an existing event category in the project's tracking plan taxonomy. Find category IDs with List Event Categories.
   * @route PUT /update-taxonomy-category
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"description":"Numeric ID of the category to rename."}
   * @paramDef {"type":"String","label":"Category Name","name":"categoryName","required":true,"description":"New name for the category."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateEventCategory(categoryId, categoryName) {
    const logTag = '[updateEventCategory]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/category/${ encodeURIComponent(categoryId) }`,
      method: 'put',
      form: { category_name: categoryName },
    })
  }

  /**
   * @operationName Delete Event Category
   * @category Taxonomy
   * @description Deletes an event category from the project's tracking plan taxonomy. Find category IDs with List Event Categories.
   * @route DELETE /delete-taxonomy-category
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"description":"Numeric ID of the category to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteEventCategory(categoryId) {
    const logTag = '[deleteEventCategory]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/category/${ encodeURIComponent(categoryId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Event Types
   * @category Taxonomy
   * @description Retrieves all event types in the project's tracking plan taxonomy with their category, description, visibility flags, tags and owner. Optionally includes deleted event types.
   * @route GET /taxonomy-event-types
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Boolean","label":"Show Deleted","name":"showDeleted","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes deleted event types in the response."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":[{"event_type":"purchase","category":{"name":"Revenue"},"description":"User completed a purchase","display_name":"Purchase","is_active":true,"is_hidden_from_dropdowns":false,"tags":["core"],"owner":null}]}
   */
  async listEventTypes(showDeleted) {
    const logTag = '[listEventTypes]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/event',
      query: { showDeleted: showDeleted ? 'true' : undefined },
    })
  }

  /**
   * @operationName Create Event Type
   * @category Taxonomy
   * @description Creates a new event type in the project's tracking plan taxonomy with an optional category, description, tags and owner. Requires the Amplitude Govern (Taxonomy) add-on.
   * @route POST /create-event-type
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"description":"Name of the event type to create, e.g. onboard_start."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Name of an existing category to assign the event type to."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Details describing the event type."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"Whether the event is marked active in the taxonomy."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the event type."}
   * @paramDef {"type":"String","label":"Owner","name":"owner","description":"Login email of the event type's owner in Amplitude."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async createEventType(eventType, category, description, isActive, tags, owner) {
    const logTag = '[createEventType]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/event',
      method: 'post',
      form: clean({
        event_type: eventType,
        category,
        description,
        is_active: isActive,
        tags: tags && tags.length ? tags.join(',') : undefined,
        owner,
      }),
    })
  }

  /**
   * @operationName Update Event Type
   * @category Taxonomy
   * @description Updates an event type in the project's tracking plan taxonomy: rename it, change its category, description, display name, tags or owner.
   * @route PUT /update-event-type
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getEventTypesDictionary","description":"Current name of the event type to update."}
   * @paramDef {"type":"String","label":"New Event Type","name":"newEventType","description":"New name for the event type."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Name of an existing category to move the event type to."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the event type."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Display name shown in the Amplitude UI instead of the raw event name."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the event type."}
   * @paramDef {"type":"String","label":"Owner","name":"owner","description":"Login email of the event type's owner in Amplitude."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateEventType(eventType, newEventType, category, description, displayName, tags, owner) {
    const logTag = '[updateEventType]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/event/${ encodeURIComponent(eventType) }`,
      method: 'put',
      form: clean({
        new_event_type: newEventType,
        category,
        description,
        display_name: displayName,
        tags: tags && tags.length ? tags.join(',') : undefined,
        owner,
      }),
    })
  }

  /**
   * @operationName Delete Event Type
   * @category Taxonomy
   * @description Deletes an event type from the project's tracking plan taxonomy. The event type stops appearing in the taxonomy but historical event data is not removed.
   * @route DELETE /delete-event-type
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getEventTypesDictionary","description":"Name of the event type to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteEventType(eventType) {
    const logTag = '[deleteEventType]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/event/${ encodeURIComponent(eventType) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Event Properties
   * @category Taxonomy
   * @description Retrieves event properties defined in the project's tracking plan taxonomy, optionally filtered to a single event type.
   * @route GET /taxonomy-event-properties
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Optional event type to list properties for. Leave empty to list properties across all events."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":[{"event_property":"source","event_type":"onboard_start","description":"Traffic source","type":"string","regex":null,"enum_values":null,"is_array_type":false,"is_required":false}]}
   */
  async listEventProperties(eventType) {
    const logTag = '[listEventProperties]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/event-property',
      query: { event_type: eventType },
    })
  }

  /**
   * @operationName Create Event Property
   * @category Taxonomy
   * @description Creates an event property definition in the project's tracking plan taxonomy, including its data type, validation rules and whether it is required. Requires the Amplitude Govern (Taxonomy) add-on.
   * @route POST /create-event-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Property","name":"eventProperty","required":true,"description":"Name of the event property to create, e.g. source."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"dictionary":"getEventTypesDictionary","description":"Event type the property belongs to."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Details describing the event property."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["String","Number","Boolean","Enum","Any"]}},"description":"Data type of the property."}
   * @paramDef {"type":"Boolean","label":"Is Array Type","name":"isArrayType","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property holds an array of values."}
   * @paramDef {"type":"Boolean","label":"Is Required","name":"isRequired","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property is required on the event."}
   * @paramDef {"type":"String","label":"Regex","name":"regex","description":"Regular expression used to validate string values."}
   * @paramDef {"type":"Array<String>","label":"Enum Values","name":"enumValues","description":"Allowed values when Type is Enum."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async createEventProperty(eventProperty, eventType, description, type, isArrayType, isRequired, regex, enumValues) {
    const logTag = '[createEventProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/event-property',
      method: 'post',
      form: clean({
        event_property: eventProperty,
        event_type: eventType,
        description,
        type: this.#resolveChoice(type, TAXONOMY_PROPERTY_TYPES),
        is_array_type: isArrayType,
        is_required: isRequired,
        regex,
        enum_values: enumValues && enumValues.length ? enumValues.join(',') : undefined,
      }),
    })
  }

  /**
   * @operationName Update Event Property
   * @category Taxonomy
   * @description Updates an event property definition in the project's tracking plan taxonomy: rename it or change its description, data type, validation rules or required flag.
   * @route PUT /update-event-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Property","name":"eventProperty","required":true,"description":"Current name of the event property to update."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Event type the property belongs to."}
   * @paramDef {"type":"String","label":"New Property Name","name":"newPropertyName","description":"New name for the event property."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the event property."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["String","Number","Boolean","Enum","Any"]}},"description":"Data type of the property."}
   * @paramDef {"type":"Boolean","label":"Is Array Type","name":"isArrayType","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property holds an array of values."}
   * @paramDef {"type":"Boolean","label":"Is Required","name":"isRequired","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property is required on the event."}
   * @paramDef {"type":"String","label":"Regex","name":"regex","description":"Regular expression used to validate string values."}
   * @paramDef {"type":"Array<String>","label":"Enum Values","name":"enumValues","description":"Allowed values when Type is Enum."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateEventProperty(eventProperty, eventType, newPropertyName, description, type, isArrayType, isRequired, regex, enumValues) {
    const logTag = '[updateEventProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/event-property/${ encodeURIComponent(eventProperty) }`,
      method: 'put',
      form: clean({
        event_type: eventType,
        new_event_property_value: newPropertyName,
        description,
        type: this.#resolveChoice(type, TAXONOMY_PROPERTY_TYPES),
        is_array_type: isArrayType,
        is_required: isRequired,
        regex,
        enum_values: enumValues && enumValues.length ? enumValues.join(',') : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Event Property
   * @category Taxonomy
   * @description Deletes an event property definition from the project's tracking plan taxonomy. Historical event data is not removed.
   * @route DELETE /delete-event-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Event Property","name":"eventProperty","required":true,"description":"Name of the event property to delete."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Event type the property belongs to."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteEventProperty(eventProperty, eventType) {
    const logTag = '[deleteEventProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/event-property/${ encodeURIComponent(eventProperty) }`,
      method: 'delete',
      form: clean({ event_type: eventType }),
    })
  }

  /**
   * @operationName List User Properties
   * @category Taxonomy
   * @description Retrieves user properties defined in the project's tracking plan taxonomy, optionally including deleted ones.
   * @route GET /taxonomy-user-properties
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Boolean","label":"Show Deleted","name":"showDeleted","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes deleted user properties in the response."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":[{"user_property":"gp:plan","description":"Subscription plan","type":"string","regex":null,"enum_values":["free","pro"],"is_array_type":false}]}
   */
  async listUserProperties(showDeleted) {
    const logTag = '[listUserProperties]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/user-property',
      query: { showDeleted: showDeleted ? 'true' : undefined },
    })
  }

  /**
   * @operationName Create User Property
   * @category Taxonomy
   * @description Creates a custom user property definition in the project's tracking plan taxonomy, including its data type and validation rules. Requires the Amplitude Govern (Taxonomy) add-on.
   * @route POST /create-user-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User Property","name":"userProperty","required":true,"description":"Name of the user property to create, e.g. plan."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Details describing the user property."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["String","Number","Boolean","Enum","Any"]}},"description":"Data type of the property."}
   * @paramDef {"type":"Boolean","label":"Is Array Type","name":"isArrayType","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property holds an array of values."}
   * @paramDef {"type":"String","label":"Regex","name":"regex","description":"Regular expression used to validate string values."}
   * @paramDef {"type":"Array<String>","label":"Enum Values","name":"enumValues","description":"Allowed values when Type is Enum."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async createUserProperty(userProperty, description, type, isArrayType, regex, enumValues) {
    const logTag = '[createUserProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/taxonomy/user-property',
      method: 'post',
      form: clean({
        user_property: userProperty,
        description,
        type: this.#resolveChoice(type, TAXONOMY_PROPERTY_TYPES),
        is_array_type: isArrayType,
        regex,
        enum_values: enumValues && enumValues.length ? enumValues.join(',') : undefined,
      }),
    })
  }

  /**
   * @operationName Update User Property
   * @category Taxonomy
   * @description Updates a custom user property definition in the project's tracking plan taxonomy: rename it or change its description, data type or validation rules. Prefix custom user properties with gp: when referencing them.
   * @route PUT /update-user-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User Property","name":"userProperty","required":true,"description":"Current name of the user property to update. Prefix custom properties with gp:, e.g. gp:plan."}
   * @paramDef {"type":"String","label":"New Property Name","name":"newPropertyName","description":"New name for the user property."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the user property."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["String","Number","Boolean","Enum","Any"]}},"description":"Data type of the property."}
   * @paramDef {"type":"Boolean","label":"Is Array Type","name":"isArrayType","uiComponent":{"type":"CHECKBOX"},"description":"Whether the property holds an array of values."}
   * @paramDef {"type":"String","label":"Regex","name":"regex","description":"Regular expression used to validate string values."}
   * @paramDef {"type":"Array<String>","label":"Enum Values","name":"enumValues","description":"Allowed values when Type is Enum."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateUserProperty(userProperty, newPropertyName, description, type, isArrayType, regex, enumValues) {
    const logTag = '[updateUserProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/user-property/${ encodeURIComponent(userProperty) }`,
      method: 'put',
      form: clean({
        new_user_property_value: newPropertyName,
        description,
        type: this.#resolveChoice(type, TAXONOMY_PROPERTY_TYPES),
        is_array_type: isArrayType,
        regex,
        enum_values: enumValues && enumValues.length ? enumValues.join(',') : undefined,
      }),
    })
  }

  /**
   * @operationName Delete User Property
   * @category Taxonomy
   * @description Deletes a custom user property definition from the project's tracking plan taxonomy. Historical data is not removed.
   * @route DELETE /delete-user-property
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"User Property","name":"userProperty","required":true,"description":"Name of the user property to delete. Prefix custom properties with gp:, e.g. gp:plan."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteUserProperty(userProperty) {
    const logTag = '[deleteUserProperty]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/taxonomy/user-property/${ encodeURIComponent(userProperty) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Privacy (User Privacy / Deletion API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create User Deletion Job
   * @category Privacy
   * @description Schedules a privacy deletion job that permanently removes all data for the specified users (GDPR/CCPA right to be forgotten). Jobs run within 30 days of the request; users can be removed from a job until 3 days before it executes. Accepts up to 100 users per request identified by User IDs and/or Amplitude IDs. Use with caution: executed deletions are irreversible.
   * @route POST /create-deletion-job
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","description":"User IDs of the users to delete. Provide User IDs and/or Amplitude IDs (100 users maximum per request)."}
   * @paramDef {"type":"Array<String>","label":"Amplitude IDs","name":"amplitudeIds","description":"Numeric Amplitude IDs of the users to delete. Resolve them with Search Users."}
   * @paramDef {"type":"String","label":"Requester","name":"requester","description":"Email or identifier of the person requesting the deletion, stored for auditing."}
   * @paramDef {"type":"Boolean","label":"Ignore Invalid IDs","name":"ignoreInvalidIds","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, invalid IDs are skipped instead of failing the whole request."}
   * @paramDef {"type":"Boolean","label":"Delete From Organization","name":"deleteFromOrg","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, deletes the users from all projects in the organization instead of only this project. Requires org admin permissions."}
   *
   * @returns {Object}
   * @sampleResult {"day":"2026-08-14","status":"staging","amplitude_ids":[{"amplitude_id":2712988,"requested_on_day":"2026-07-17","requester":"privacy@example.com"}],"app":12345}
   */
  async createUserDeletionJob(userIds, amplitudeIds, requester, ignoreInvalidIds, deleteFromOrg) {
    const logTag = '[createUserDeletionJob]'

    if ((!userIds || !userIds.length) && (!amplitudeIds || !amplitudeIds.length)) {
      throw new Error('At least one User ID or Amplitude ID must be provided.')
    }

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/deletions/users',
      method: 'post',
      body: clean({
        user_ids: userIds && userIds.length ? userIds : undefined,
        amplitude_ids: amplitudeIds && amplitudeIds.length
          ? amplitudeIds.map(id => (isNaN(Number(id)) ? id : Number(id)))
          : undefined,
        requester,
        ignore_invalid_id: ignoreInvalidIds ? 'true' : undefined,
        delete_from_org: deleteFromOrg ? 'true' : undefined,
      }),
    })
  }

  /**
   * @operationName List User Deletion Jobs
   * @category Privacy
   * @description Retrieves privacy deletion jobs scheduled to run in the specified date range, including each job's status and affected users. Check jobs regularly if you need to track deletion progress.
   * @route GET /deletion-jobs
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"String","label":"Start Day","name":"startDay","required":true,"description":"First scheduled day to include, in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Day","name":"endDay","required":true,"description":"Last scheduled day to include, in YYYY-MM-DD format."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"day":"2026-08-14","status":"staging","amplitude_ids":[{"amplitude_id":2712988,"requested_on_day":"2026-07-17","requester":"privacy@example.com"}],"app":12345}]
   */
  async listUserDeletionJobs(startDay, endDay) {
    const logTag = '[listUserDeletionJobs]'

    return await this.#analyticsRequest({
      logTag,
      path: '/api/2/deletions/users',
      query: { start_day: startDay, end_day: endDay },
    })
  }

  /**
   * @operationName Remove User From Deletion Job
   * @category Privacy
   * @description Removes a user from a scheduled privacy deletion job, cancelling their deletion. Only possible until 3 days before the job's scheduled execution day.
   * @route DELETE /remove-user-from-deletion-job
   * @appearanceColor #1E61F0 #4D89FF
   *
   * @paramDef {"type":"Number","label":"Amplitude ID","name":"amplitudeId","required":true,"description":"Amplitude ID of the user to remove from the deletion job."}
   * @paramDef {"type":"String","label":"Scheduled Day","name":"day","required":true,"description":"Scheduled execution day of the deletion job, in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"day":"2026-08-14","status":"staging","amplitude_ids":[],"app":12345}
   */
  async removeUserFromDeletionJob(amplitudeId, day) {
    const logTag = '[removeUserFromDeletionJob]'

    return await this.#analyticsRequest({
      logTag,
      path: `/api/2/deletions/users/${ encodeURIComponent(amplitudeId) }/${ encodeURIComponent(day) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * @operationName Export Raw Events
   * @category Export
   * @description Exports the project's raw event data for the given hour range via the Export API and stores the resulting ZIP archive (containing gzipped JSON files, one event per line) in FlowRunner file storage. Returns the stored file's URL and size; the archive is not unpacked. Export size is limited to 4 GB per request - split larger ranges into multiple calls.
   * @route GET /export-raw-events
   * @appearanceColor #1E61F0 #4D89FF
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"description":"First hour to export, in YYYYMMDDTHH format, e.g. 20260716T00."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":true,"description":"Last hour to export, in YYYYMMDDTHH format, e.g. 20260716T23."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the exported archive."}
   *
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://files.flowrunner.example/flow/amplitude_export_20260716T00_20260716T23.zip","sizeBytes":1048576,"start":"20260716T00","end":"20260716T23"}
   */
  async exportRawEvents(startTime, endTime, fileOptions) {
    const logTag = '[exportRawEvents]'

    const bytes = await this.#analyticsRequest({
      logTag,
      path: '/api/2/export',
      query: { start: startTime, end: endTime },
      binary: true,
    })

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `amplitude_export_${ startTime }_${ endTime }.zip`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      fileUrl: url,
      sizeBytes: buffer.length,
      start: startTime,
      end: endTime,
    }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getCohortsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter cohorts by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Cohorts are returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Cohorts Dictionary
   * @description Provides a searchable list of the project's behavioral cohorts for selecting a cohort in cohort operations. The option value is the cohort ID.
   * @route POST /get-cohorts-dictionary
   * @paramDef {"type":"getCohortsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter cohorts by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Power Users","value":"abc123","note":"9520 users"}],"cursor":null}
   */
  async getCohortsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getCohortsDictionary]'

    const response = await this.#analyticsRequest({
      logTag,
      path: '/api/3/cohorts',
    })

    const cohorts = response.cohorts || []
    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? cohorts.filter(cohort => (cohort.name || '').toLowerCase().includes(searchLower))
      : cohorts

    return {
      items: filtered.map(cohort => ({
        label: cohort.name || cohort.id,
        value: cohort.id,
        note: cohort.size !== undefined ? `${ cohort.size } users` : undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getEventTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter event types by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Event types are returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Types Dictionary
   * @description Provides a searchable list of the project's event types (from the Dashboard REST events list) for selecting an event name in tracking and taxonomy operations. The option value is the raw event type name.
   * @route POST /get-event-types-dictionary
   * @paramDef {"type":"getEventTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter event types by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"purchase","value":"purchase","note":"10231 events this week"}],"cursor":null}
   */
  async getEventTypesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getEventTypesDictionary]'

    const response = await this.#analyticsRequest({
      logTag,
      path: '/api/2/events/list',
    })

    const events = response.data || []
    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? events.filter(event => (event.value || '').toLowerCase().includes(searchLower))
      : events

    return {
      items: filtered.map(event => ({
        label: event.display || event.value,
        value: event.value,
        note: event.totals !== undefined ? `${ event.totals } events this week` : undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(AmplitudeService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Project API key. Find it in Amplitude under Settings -> Projects -> your project -> General. Used for event ingestion and as the Basic auth username for analytics APIs.',
  },
  {
    name: 'secretKey',
    displayName: 'Secret Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Project secret key from the same project settings page. Used for the Dashboard REST, Cohorts, Taxonomy, Export, Deletion and User Profile APIs. Keep it confidential.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['US', 'EU'],
    defaultValue: 'US',
    required: true,
    shared: false,
    hint: 'Data residency region of your Amplitude project. EU projects use the api.eu.amplitude.com and analytics.eu.amplitude.com endpoints. The User Profile API is US-only.',
  },
])
