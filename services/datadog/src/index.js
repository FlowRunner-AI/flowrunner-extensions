const logger = {
  info: (...args) => console.log('[Datadog] info:', ...args),
  debug: (...args) => console.log('[Datadog] debug:', ...args),
  error: (...args) => console.log('[Datadog] error:', ...args),
  warn: (...args) => console.log('[Datadog] warn:', ...args),
}

const DEFAULT_SITE = 'datadoghq.com'
const DICTIONARY_PAGE_SIZE = 50

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
 * @integrationName Datadog
 * @integrationIcon /icon.png
 */
class DatadogService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.appKey = config.appKey
    this.site = config.site || DEFAULT_SITE
    this.apiBaseUrl = `https://api.${ this.site }`
    this.logsIntakeUrl = `https://http-intake.logs.${ this.site }`
  }

  async #apiRequest({ url, method = 'get', body, query, logTag, includeAppKey = true }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const headers = {
        'DD-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      }

      if (includeAppKey) {
        headers['DD-APPLICATION-KEY'] = this.appKey
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.errors?.join?.('; ') ||
        error.body?.errors?.[0]?.detail ||
        error.body?.message ||
        error.message

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Datadog API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * @operationName Post Event
   * @category Events
   * @description Posts a custom event to the Datadog event stream. Events show up in the Events Explorer and can trigger event monitors. The title is limited to 100 characters and the text body to 4000 characters; text supports markdown when wrapped in %%% markers. Use tags, an aggregation key, and a source type name to group and route related events.
   * @route POST /post-event
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Event title, shown in the event stream (max 100 characters)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Event body (max 4000 characters). Supports markdown when wrapped in %%% at the start and end."}
   * @paramDef {"type":"String","label":"Alert Type","name":"alertType","uiComponent":{"type":"DROPDOWN","options":{"values":["Info","Warning","Error","Success"]}},"description":"Event alert type. Controls the event's severity styling in the stream. Defaults to Info."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Normal","Low"]}},"description":"Event priority. Defaults to Normal."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the event, e.g. [\"env:prod\", \"team:payments\"]."}
   * @paramDef {"type":"String","label":"Host","name":"host","description":"Host name to associate the event with."}
   * @paramDef {"type":"String","label":"Aggregation Key","name":"aggregationKey","description":"Arbitrary key (max 100 characters). Events sharing the same key within a short time window are aggregated in the stream."}
   * @paramDef {"type":"String","label":"Source Type Name","name":"sourceTypeName","description":"The integration name the event comes from, e.g. \"jenkins\" or \"nagios\"."}
   * @paramDef {"type":"Number","label":"Date Happened","name":"dateHappened","description":"POSIX timestamp (epoch seconds) of the event. Must be within the last 18 hours. Defaults to now."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","event":{"id":7423651868493214000,"title":"Deployment finished","text":"Deployed v2.4.1 to production","date_happened":1752700000,"priority":"normal","tags":["env:prod"],"url":"https://app.datadoghq.com/event/event?id=7423651868493214000"}}
   */
  async postEvent(title, text, alertType, priority, tags, host, aggregationKey, sourceTypeName, dateHappened) {
    const logTag = '[postEvent]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/events`,
      method: 'post',
      body: clean({
        title,
        text,
        alert_type: this.#resolveChoice(alertType, { Info: 'info', Warning: 'warning', Error: 'error', Success: 'success' }),
        priority: this.#resolveChoice(priority, { Normal: 'normal', Low: 'low' }),
        tags,
        host,
        aggregation_key: aggregationKey,
        source_type_name: sourceTypeName,
        date_happened: dateHappened,
      }),
    })
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Queries the event stream for events between two timestamps. Returns the most recent 1000 matching events, optionally filtered by priority, sources, and tags. The time range may be up to 32 days.
   * @route GET /list-events
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Number","label":"Start","name":"start","required":true,"description":"POSIX timestamp (epoch seconds) for the start of the query window."}
   * @paramDef {"type":"Number","label":"End","name":"end","required":true,"description":"POSIX timestamp (epoch seconds) for the end of the query window."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Normal","Low"]}},"description":"Only return events with this priority."}
   * @paramDef {"type":"String","label":"Sources","name":"sources","description":"Comma-separated list of sources to filter by, e.g. \"jenkins,github\"."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to filter by, e.g. \"env:prod,team:payments\"."}
   * @paramDef {"type":"Boolean","label":"Unaggregated","name":"unaggregated","uiComponent":{"type":"CHECKBOX"},"description":"Return each event individually instead of aggregated groups."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":7423651868493214000,"title":"Deployment finished","text":"Deployed v2.4.1 to production","date_happened":1752700000,"priority":"normal","alert_type":"success","tags":["env:prod"],"source":"api","host":"web-01"}]}
   */
  async listEvents(start, end, priority, sources, tags, unaggregated) {
    const logTag = '[listEvents]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/events`,
      query: {
        start,
        end,
        priority: this.#resolveChoice(priority, { Normal: 'normal', Low: 'low' }),
        sources,
        tags,
        unaggregated,
      },
    })
  }

  /**
   * @operationName Search Events
   * @category Events
   * @description Searches events with the full Datadog events query syntax (e.g. "source:alert env:prod"). Supports relative time expressions like "now-15m" and cursor-based pagination, making it the best choice for high-volume or precise event lookups.
   * @route POST /search-events
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Events search query, e.g. \"source:alert status:error\". Defaults to \"*\" (all events)."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Start of the time window: ISO-8601, epoch milliseconds, or relative like \"now-15m\". Defaults to \"now-15m\"."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"End of the time window: ISO-8601, epoch milliseconds, or relative like \"now\". Defaults to \"now\"."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Oldest First","Newest First"]}},"description":"Result order by event timestamp. Defaults to Oldest First."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events per page (max 1000). Defaults to 10."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response (meta.page.after) to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"AAAAAYcLpKgvXm9vAAAAAA","type":"event","attributes":{"timestamp":"2026-07-16T20:15:00Z","message":"Deployment finished","tags":["env:prod"]}}],"meta":{"page":{"after":"eyJhZnRlciI6IkFBQUFBWWNMcEtndlhtOXZBQUFBQUEifQ"}}}
   */
  async searchEvents(query, from, to, sort, limit, cursor) {
    const logTag = '[searchEvents]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/events/search`,
      method: 'post',
      body: clean({
        filter: clean({
          query: query || '*',
          from: from || 'now-15m',
          to: to || 'now',
        }),
        sort: this.#resolveChoice(sort, { 'Oldest First': 'timestamp', 'Newest First': '-timestamp' }),
        page: clean({ limit, cursor }),
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  /**
   * @operationName Submit Metric
   * @category Metrics
   * @description Submits a single data point for a custom metric via the v2 series intake. Creates the metric automatically on first submission. Timestamps must be no more than 10 minutes in the future or 1 hour in the past. Optionally associates the point with a host and applies tags.
   * @route POST /submit-metric
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Metric Name","name":"metricName","required":true,"description":"Metric name, e.g. \"myapp.orders.processed\". Names are case sensitive and should use dot notation."}
   * @paramDef {"type":"Number","label":"Value","name":"value","required":true,"description":"The numeric value of the data point."}
   * @paramDef {"type":"String","label":"Metric Type","name":"metricType","uiComponent":{"type":"DROPDOWN","options":{"values":["Unspecified","Count","Rate","Gauge"]}},"description":"Metric type. Defaults to Unspecified."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"timestamp","description":"POSIX timestamp (epoch seconds) of the point. Defaults to now."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the data point, e.g. [\"env:prod\", \"region:us-east-1\"]."}
   * @paramDef {"type":"String","label":"Host","name":"hostName","description":"Host name to associate with the data point."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Unit of the metric, e.g. \"byte\", \"second\", \"request\"."}
   *
   * @returns {Object}
   * @sampleResult {"errors":[]}
   */
  async submitMetric(metricName, value, metricType, timestamp, tags, hostName, unit) {
    const logTag = '[submitMetric]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/series`,
      method: 'post',
      body: {
        series: [clean({
          metric: metricName,
          type: this.#resolveChoice(metricType, { Unspecified: 0, Count: 1, Rate: 2, Gauge: 3 }),
          points: [{ timestamp: timestamp || Math.floor(Date.now() / 1000), value }],
          tags,
          resources: hostName ? [{ name: hostName, type: 'host' }] : undefined,
          unit,
        })],
      },
    })
  }

  /**
   * @operationName Query Timeseries
   * @category Metrics
   * @description Queries timeseries data for any metric using the full Datadog query syntax, including aggregations, filters, and functions (e.g. "avg:system.cpu.user{env:prod} by {host}"). Returns series of [timestamp, value] points for the requested window.
   * @route GET /query-timeseries
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Datadog metric query, e.g. \"avg:system.cpu.user{env:prod} by {host}\"."}
   * @paramDef {"type":"Number","label":"From","name":"from","required":true,"description":"Start of the query window as a POSIX timestamp (epoch seconds)."}
   * @paramDef {"type":"Number","label":"To","name":"to","required":true,"description":"End of the query window as a POSIX timestamp (epoch seconds)."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","query":"avg:system.cpu.user{*}","from_date":1752696400000,"to_date":1752700000000,"series":[{"metric":"system.cpu.user","display_name":"system.cpu.user","pointlist":[[1752696400000,12.4],[1752696700000,13.1]],"scope":"*","expression":"avg:system.cpu.user{*}"}]}
   */
  async queryTimeseries(query, from, to) {
    const logTag = '[queryTimeseries]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/query`,
      query: { query, from, to },
    })
  }

  /**
   * @operationName List Metrics
   * @category Metrics
   * @description Lists metrics known to your organization via the v2 metrics endpoint. Optionally filters to metrics carrying specific tags and restricts the lookback window used to decide whether a metric is actively reporting.
   * @route GET /list-metrics
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Filter Tags","name":"filterTags","description":"Filter metrics by tags, e.g. \"env:prod,service:web\". Only metrics reporting with all listed tags are returned."}
   * @paramDef {"type":"Number","label":"Window Seconds","name":"windowSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Lookback window in seconds used to determine actively reporting metrics (max 2,592,000 = 30 days). Defaults to about 2 days."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"metrics","id":"system.cpu.user"},{"type":"metrics","id":"myapp.orders.processed"}]}
   */
  async listMetrics(filterTags, windowSeconds) {
    const logTag = '[listMetrics]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/metrics`,
      query: {
        'filter[tags]': filterTags,
        'window[seconds]': windowSeconds,
      },
    })
  }

  /**
   * @operationName Get Metric Metadata
   * @category Metrics
   * @description Retrieves the metadata of a metric: type, description, units, per-unit, short name, StatsD interval, and integration source.
   * @route GET /get-metric-metadata
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Metric Name","name":"metricName","required":true,"description":"Name of the metric, e.g. \"system.cpu.user\"."}
   *
   * @returns {Object}
   * @sampleResult {"description":"CPU time in user space","short_name":"cpu user","integration":"system","statsd_interval":15,"per_unit":null,"type":"gauge","unit":"percent"}
   */
  async getMetricMetadata(metricName) {
    const logTag = '[getMetricMetadata]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/metrics/${ encodeURIComponent(metricName) }`,
    })
  }

  /**
   * @operationName Update Metric Metadata
   * @category Metrics
   * @description Updates a metric's metadata: type, description, short name, units, and StatsD interval. Only the fields you provide are changed.
   * @route PUT /update-metric-metadata
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Metric Name","name":"metricName","required":true,"description":"Name of the metric to update, e.g. \"myapp.orders.processed\"."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Gauge","Count","Rate"]}},"description":"Metric type."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Human-readable description of the metric."}
   * @paramDef {"type":"String","label":"Short Name","name":"shortName","description":"Short name displayed in graphs."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Primary unit, e.g. \"byte\", \"request\", \"second\"."}
   * @paramDef {"type":"String","label":"Per Unit","name":"perUnit","description":"Per-unit for rates, e.g. \"second\" in bytes per second."}
   * @paramDef {"type":"Number","label":"StatsD Interval","name":"statsdInterval","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"StatsD flush interval in seconds, if applicable."}
   *
   * @returns {Object}
   * @sampleResult {"description":"Number of processed orders","short_name":"orders","statsd_interval":15,"per_unit":null,"type":"count","unit":"order"}
   */
  async updateMetricMetadata(metricName, type, description, shortName, unit, perUnit, statsdInterval) {
    const logTag = '[updateMetricMetadata]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/metrics/${ encodeURIComponent(metricName) }`,
      method: 'put',
      body: clean({
        type: this.#resolveChoice(type, { Gauge: 'gauge', Count: 'count', Rate: 'rate' }),
        description,
        short_name: shortName,
        unit,
        per_unit: perUnit,
        statsd_interval: statsdInterval,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Log
   * @category Logs
   * @description Sends a log entry to Datadog Log Management via the HTTP intake (host http-intake.logs.{site}). Set source, service, hostname, and tags for indexing and correlation; arbitrary extra attributes can be attached as JSON and become searchable log facets.
   * @route POST /send-log
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The log message body."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"The integration or technology emitting the log (ddsource), e.g. \"nodejs\", \"nginx\". Drives log pipeline selection."}
   * @paramDef {"type":"String","label":"Service","name":"service","description":"The service name the log belongs to, used for APM/log correlation."}
   * @paramDef {"type":"String","label":"Hostname","name":"hostname","description":"Originating host name."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach (ddtags), e.g. [\"env:prod\", \"version:2.4.1\"]."}
   * @paramDef {"type":"Object","label":"Additional Attributes","name":"additionalAttributes","description":"Arbitrary JSON attributes merged into the log entry, e.g. {\"user_id\":\"123\",\"status\":\"error\"}. They become searchable facets."}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async sendLog(message, source, service, hostname, tags, additionalAttributes) {
    const logTag = '[sendLog]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.logsIntakeUrl }/api/v2/logs`,
      method: 'post',
      includeAppKey: false,
      body: [clean({
        message,
        ddsource: source,
        service,
        hostname,
        ddtags: tags?.length ? tags.join(',') : undefined,
        ...(additionalAttributes || {}),
      })],
    })
  }

  /**
   * @operationName Search Logs
   * @category Logs
   * @description Searches indexed logs with the Datadog log search syntax (e.g. "service:web status:error @http.status_code:500"). Supports absolute or relative time bounds, index selection, sorting, and cursor-based pagination.
   * @route POST /search-logs
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Log search query, e.g. \"service:web status:error\". Defaults to \"*\" (all logs)."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Start of the time window: ISO-8601, epoch milliseconds, or relative like \"now-15m\". Defaults to \"now-15m\"."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"End of the time window: ISO-8601, epoch milliseconds, or relative like \"now\". Defaults to \"now\"."}
   * @paramDef {"type":"Array<String>","label":"Indexes","name":"indexes","description":"Log indexes to search, e.g. [\"main\"]. Defaults to all indexes."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Oldest First","Newest First"]}},"description":"Result order by log timestamp. Defaults to Oldest First."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of logs per page (max 1000). Defaults to 10."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response (meta.page.after) to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"AQAAAYcLpKgvXm9vAAAAAA","type":"log","attributes":{"timestamp":"2026-07-16T20:15:00Z","status":"error","service":"web","message":"Request failed","tags":["env:prod"]}}],"meta":{"page":{"after":"eyJhZnRlciI6IkFRQUFBWWNMcEtndlhtOXZBQUFBQUEifQ"}}}
   */
  async searchLogs(query, from, to, indexes, sort, limit, cursor) {
    const logTag = '[searchLogs]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/logs/events/search`,
      method: 'post',
      body: clean({
        filter: clean({
          query: query || '*',
          from: from || 'now-15m',
          to: to || 'now',
          indexes: indexes?.length ? indexes : undefined,
        }),
        sort: this.#resolveChoice(sort, { 'Oldest First': 'timestamp', 'Newest First': '-timestamp' }),
        page: clean({ limit, cursor }),
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Monitors
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Monitor
   * @category Monitors
   * @description Creates a monitor that alerts on a metric, log, event, process, or other data source. The query must follow the syntax of the selected monitor type (e.g. "avg(last_5m):avg:system.cpu.user{env:prod} > 90" for a metric alert). The message supports @-notification handles and template variables. Advanced settings (thresholds, notify_no_data, renotify_interval, etc.) go in Options.
   * @route POST /create-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Monitor name shown in the monitors list and notifications."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Metric Alert","Query Alert","Service Check","Event Alert","Log Alert","Composite","Process Alert","Trace Analytics Alert","RUM Alert","SLO Alert","Audit Alert","Synthetics Alert"]}},"description":"Monitor type. Determines the required query syntax."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Monitor query in the syntax of the selected type, e.g. \"avg(last_5m):avg:system.cpu.user{env:prod} > 90\"."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notification message. Supports markdown, template variables like {{value}}, and @-handles, e.g. \"CPU is high @slack-ops\"."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the monitor itself, e.g. [\"team:payments\"]."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monitor priority from 1 (highest) to 5 (lowest)."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Raw monitor options JSON, e.g. {\"thresholds\":{\"critical\":90,\"warning\":80},\"notify_no_data\":true,\"renotify_interval\":60}. See the Datadog monitor API docs for all options."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345678,"name":"High CPU on prod","type":"metric alert","query":"avg(last_5m):avg:system.cpu.user{env:prod} > 90","message":"CPU is high @slack-ops","tags":["team:payments"],"priority":2,"options":{"thresholds":{"critical":90,"warning":80}},"overall_state":"No Data","created":"2026-07-16T20:15:00.000000+00:00"}
   */
  async createMonitor(name, type, query, message, tags, priority, options) {
    const logTag = '[createMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor`,
      method: 'post',
      body: clean({
        name,
        type: this.#resolveChoice(type, {
          'Metric Alert': 'metric alert',
          'Query Alert': 'query alert',
          'Service Check': 'service check',
          'Event Alert': 'event-v2 alert',
          'Log Alert': 'log alert',
          'Composite': 'composite',
          'Process Alert': 'process alert',
          'Trace Analytics Alert': 'trace-analytics alert',
          'RUM Alert': 'rum alert',
          'SLO Alert': 'slo alert',
          'Audit Alert': 'audit alert',
          'Synthetics Alert': 'synthetics alert',
        }),
        query,
        message,
        tags,
        priority,
        options,
      }),
    })
  }

  /**
   * @operationName List Monitors
   * @category Monitors
   * @description Lists monitors with optional filtering by name, monitor tags, scope tags, and group states. Supports page-based pagination.
   * @route GET /list-monitors
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter monitors by name (substring match)."}
   * @paramDef {"type":"String","label":"Scope Tags","name":"tags","description":"Comma-separated list of scope tags the monitor query must include, e.g. \"host:web-01,env:prod\"."}
   * @paramDef {"type":"String","label":"Monitor Tags","name":"monitorTags","description":"Comma-separated list of tags on the monitor itself, e.g. \"team:payments\"."}
   * @paramDef {"type":"String","label":"Group States","name":"groupStates","description":"Comma-separated group states to include, from: all, alert, warn, no data. Example: \"alert,warn\"."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monitors per page (max 1000). Defaults to 100."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":12345678,"name":"High CPU on prod","type":"metric alert","query":"avg(last_5m):avg:system.cpu.user{env:prod} > 90","overall_state":"OK","tags":["team:payments"],"priority":2,"creator":{"email":"admin@example.com"}}]
   */
  async listMonitors(name, tags, monitorTags, groupStates, page, pageSize) {
    const logTag = '[listMonitors]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor`,
      query: {
        name,
        tags,
        monitor_tags: monitorTags,
        group_states: groupStates,
        page,
        page_size: pageSize,
      },
    })
  }

  /**
   * @operationName Get Monitor
   * @category Monitors
   * @description Retrieves the full definition and current state of a monitor, optionally including per-group states.
   * @route GET /get-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","required":true,"dictionary":"getMonitorsDictionary","description":"The monitor to retrieve. Select from the list or provide a monitor ID."}
   * @paramDef {"type":"String","label":"Group States","name":"groupStates","description":"Comma-separated group states to include, from: all, alert, warn, no data."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345678,"name":"High CPU on prod","type":"metric alert","query":"avg(last_5m):avg:system.cpu.user{env:prod} > 90","message":"CPU is high @slack-ops","overall_state":"OK","tags":["team:payments"],"priority":2,"options":{"thresholds":{"critical":90,"warning":80}}}
   */
  async getMonitor(monitorId, groupStates) {
    const logTag = '[getMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/${ encodeURIComponent(monitorId) }`,
      query: { group_states: groupStates },
    })
  }

  /**
   * @operationName Update Monitor
   * @category Monitors
   * @description Updates an existing monitor. Only the fields you provide are changed; the monitor type cannot be changed after creation.
   * @route PUT /update-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","required":true,"dictionary":"getMonitorsDictionary","description":"The monitor to update. Select from the list or provide a monitor ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New monitor name."}
   * @paramDef {"type":"String","label":"Query","name":"query","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New monitor query. Must match the monitor's existing type syntax."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notification message."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement set of monitor tags."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monitor priority from 1 (highest) to 5 (lowest)."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Raw monitor options JSON to merge in, e.g. {\"thresholds\":{\"critical\":95}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345678,"name":"High CPU on prod (updated)","type":"metric alert","query":"avg(last_5m):avg:system.cpu.user{env:prod} > 95","overall_state":"OK","tags":["team:payments"],"modified":"2026-07-16T21:00:00.000000+00:00"}
   */
  async updateMonitor(monitorId, name, query, message, tags, priority, options) {
    const logTag = '[updateMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/${ encodeURIComponent(monitorId) }`,
      method: 'put',
      body: clean({ name, query, message, tags, priority, options }),
    })
  }

  /**
   * @operationName Delete Monitor
   * @category Monitors
   * @description Permanently deletes a monitor. Fails if the monitor is referenced by other resources (e.g. composite monitors or SLOs) unless those references are removed first.
   * @route DELETE /delete-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","required":true,"dictionary":"getMonitorsDictionary","description":"The monitor to delete. Select from the list or provide a monitor ID."}
   *
   * @returns {Object}
   * @sampleResult {"deleted_monitor_id":12345678}
   */
  async deleteMonitor(monitorId) {
    const logTag = '[deleteMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/${ encodeURIComponent(monitorId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Mute Monitor
   * @category Monitors
   * @description Mutes a monitor so it stops sending notifications, either entirely or for a specific scope (e.g. one host), optionally until a given time.
   * @route POST /mute-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","required":true,"dictionary":"getMonitorsDictionary","description":"The monitor to mute. Select from the list or provide a monitor ID."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","description":"Scope to mute, e.g. \"host:web-01\". Leave empty to mute the whole monitor."}
   * @paramDef {"type":"Number","label":"End","name":"end","description":"POSIX timestamp (epoch seconds) when the mute expires. Leave empty to mute indefinitely."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345678,"name":"High CPU on prod","options":{"silenced":{"*":null}},"overall_state":"OK"}
   */
  async muteMonitor(monitorId, scope, end) {
    const logTag = '[muteMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/${ encodeURIComponent(monitorId) }/mute`,
      method: 'post',
      query: { scope, end },
    })
  }

  /**
   * @operationName Unmute Monitor
   * @category Monitors
   * @description Unmutes a monitor, either for a specific scope or across all scopes, so it resumes sending notifications.
   * @route POST /unmute-monitor
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","required":true,"dictionary":"getMonitorsDictionary","description":"The monitor to unmute. Select from the list or provide a monitor ID."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","description":"Scope to unmute, e.g. \"host:web-01\". Leave empty to unmute the whole monitor."}
   * @paramDef {"type":"Boolean","label":"All Scopes","name":"allScopes","uiComponent":{"type":"CHECKBOX"},"description":"Clear muting across all scopes of the monitor."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345678,"name":"High CPU on prod","options":{"silenced":{}},"overall_state":"OK"}
   */
  async unmuteMonitor(monitorId, scope, allScopes) {
    const logTag = '[unmuteMonitor]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/${ encodeURIComponent(monitorId) }/unmute`,
      method: 'post',
      query: { scope, all_scopes: allScopes },
    })
  }

  /**
   * @operationName Search Monitors
   * @category Monitors
   * @description Searches monitors with the monitor search query syntax (e.g. "status:alert type:\"metric alert\" team:payments"). Returns matching monitors with facet counts, supporting pagination and sorting.
   * @route GET /search-monitors
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Monitor search query, e.g. \"status:alert env:prod\". Leave empty to return all monitors."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (max 1000). Defaults to 30."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Sort as \"field,direction\", e.g. \"name,asc\" or \"status,desc\". Fields: name, status, tags."}
   *
   * @returns {Object}
   * @sampleResult {"monitors":[{"id":12345678,"name":"High CPU on prod","type":"metric alert","status":"OK","tags":["team:payments"],"creator":{"handle":"admin@example.com"}}],"metadata":{"total_count":1,"page":0,"per_page":30,"page_count":1}}
   */
  async searchMonitors(query, page, perPage, sort) {
    const logTag = '[searchMonitors]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor/search`,
      query: { query, page, per_page: perPage, sort },
    })
  }

  // ---------------------------------------------------------------------------
  // Downtimes
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Downtime
   * @category Downtimes
   * @description Schedules a downtime (v2) that mutes matching monitors for a scope. Target either a specific monitor by ID or all monitors carrying certain tags. Without a schedule the downtime starts immediately and runs until canceled; provide ISO-8601 start/end for a one-time window.
   * @route POST /create-downtime
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":true,"description":"Scope the downtime applies to, e.g. \"host:web-01\" or \"env:staging\". Use \"*\" for everything."}
   * @paramDef {"type":"String","label":"Monitor","name":"monitorId","dictionary":"getMonitorsDictionary","description":"Specific monitor to silence. Provide this or Monitor Tags."}
   * @paramDef {"type":"Array<String>","label":"Monitor Tags","name":"monitorTags","description":"Silence all monitors carrying every listed tag, e.g. [\"team:payments\"]. Use [\"*\"] for all monitors. Provide this or Monitor."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message attached to notifications about this downtime."}
   * @paramDef {"type":"String","label":"Start","name":"start","description":"ISO-8601 start time, e.g. \"2026-07-20T02:00:00Z\". Leave empty to start immediately."}
   * @paramDef {"type":"String","label":"End","name":"end","description":"ISO-8601 end time, e.g. \"2026-07-20T04:00:00Z\". Leave empty for an open-ended downtime."}
   * @paramDef {"type":"Boolean","label":"Mute First Recovery Notification","name":"muteFirstRecovery","uiComponent":{"type":"CHECKBOX"},"description":"Also mute the first recovery notification for alerts that recover during the downtime."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"downtime","id":"00000000-0000-1234-0000-000000000000","attributes":{"scope":"env:staging","monitor_identifier":{"monitor_tags":["*"]},"message":"Planned maintenance","status":"active","schedule":{"start":"2026-07-20T02:00:00Z","end":"2026-07-20T04:00:00Z"}}}}
   */
  async createDowntime(scope, monitorId, monitorTags, message, start, end, muteFirstRecovery) {
    const logTag = '[createDowntime]'

    let monitorIdentifier

    if (monitorId) {
      monitorIdentifier = { monitor_id: Number(monitorId) }
    } else if (monitorTags?.length) {
      monitorIdentifier = { monitor_tags: monitorTags }
    } else {
      throw new Error('Datadog API error: provide either Monitor or Monitor Tags to target the downtime')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/downtime`,
      method: 'post',
      body: {
        data: {
          type: 'downtime',
          attributes: clean({
            scope,
            monitor_identifier: monitorIdentifier,
            message,
            schedule: (start || end) ? clean({ start, end }) : undefined,
            mute_first_recovery_notification: muteFirstRecovery,
          }),
        },
      },
    })
  }

  /**
   * @operationName List Downtimes
   * @category Downtimes
   * @description Lists scheduled downtimes (v2), optionally restricted to only currently active ones, with offset-based pagination.
   * @route GET /list-downtimes
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Boolean","label":"Current Only","name":"currentOnly","uiComponent":{"type":"CHECKBOX"},"description":"Only return downtimes that are active right now."}
   * @paramDef {"type":"Number","label":"Page Offset","name":"pageOffset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of records to skip)."}
   * @paramDef {"type":"Number","label":"Page Limit","name":"pageLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of downtimes to return. Defaults to 30."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"downtime","id":"00000000-0000-1234-0000-000000000000","attributes":{"scope":"env:staging","status":"active","message":"Planned maintenance","schedule":{"start":"2026-07-20T02:00:00Z","end":"2026-07-20T04:00:00Z"}}}],"meta":{"page":{"total_filtered_count":1}}}
   */
  async listDowntimes(currentOnly, pageOffset, pageLimit) {
    const logTag = '[listDowntimes]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/downtime`,
      query: {
        current_only: currentOnly,
        'page[offset]': pageOffset,
        'page[limit]': pageLimit,
      },
    })
  }

  /**
   * @operationName Get Downtime
   * @category Downtimes
   * @description Retrieves a downtime's full definition and current status by its ID.
   * @route GET /get-downtime
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Downtime ID","name":"downtimeId","required":true,"description":"The downtime UUID, e.g. from Create Downtime or List Downtimes."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"downtime","id":"00000000-0000-1234-0000-000000000000","attributes":{"scope":"env:staging","monitor_identifier":{"monitor_tags":["*"]},"status":"active","message":"Planned maintenance"}}}
   */
  async getDowntime(downtimeId) {
    const logTag = '[getDowntime]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/downtime/${ encodeURIComponent(downtimeId) }`,
    })
  }

  /**
   * @operationName Cancel Downtime
   * @category Downtimes
   * @description Cancels a scheduled or active downtime so its monitors resume notifying. Returns no content on success.
   * @route DELETE /cancel-downtime
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Downtime ID","name":"downtimeId","required":true,"description":"The downtime UUID to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"canceled":true,"downtimeId":"00000000-0000-1234-0000-000000000000"}
   */
  async cancelDowntime(downtimeId) {
    const logTag = '[cancelDowntime]'

    await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/downtime/${ encodeURIComponent(downtimeId) }`,
      method: 'delete',
    })

    return { canceled: true, downtimeId }
  }

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Incident
   * @category Incidents
   * @description Declares a new incident in Datadog Incident Management. Requires Incident Management to be enabled for the organization (the API is in preview). Set the customer-impact flag and optional severity to drive response workflows.
   * @route POST /create-incident
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Incident title, e.g. \"Checkout latency spike\"."}
   * @paramDef {"type":"Boolean","label":"Customer Impacted","name":"customerImpacted","uiComponent":{"type":"CHECKBOX"},"description":"Whether customers are impacted by this incident."}
   * @paramDef {"type":"String","label":"Customer Impact Scope","name":"customerImpactScope","description":"Description of the customer impact, e.g. \"EU checkout unavailable\". Only used when Customer Impacted is on."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["SEV-1","SEV-2","SEV-3","SEV-4","SEV-5","UNKNOWN"]}},"description":"Incident severity level."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"incidents","id":"00000000-0000-abcd-0000-000000000000","attributes":{"title":"Checkout latency spike","public_id":42,"customer_impacted":true,"state":"active","fields":{"severity":{"type":"dropdown","value":"SEV-2"}},"created":"2026-07-16T20:15:00Z"}}}
   */
  async createIncident(title, customerImpacted, customerImpactScope, severity) {
    const logTag = '[createIncident]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/incidents`,
      method: 'post',
      body: {
        data: {
          type: 'incidents',
          attributes: clean({
            title,
            customer_impacted: Boolean(customerImpacted),
            customer_impact_scope: customerImpacted ? customerImpactScope : undefined,
            fields: severity ? { severity: { type: 'dropdown', value: severity } } : undefined,
          }),
        },
      },
    })
  }

  /**
   * @operationName List Incidents
   * @category Incidents
   * @description Lists incidents for the organization with offset-based pagination. Requires Incident Management to be enabled (the API is in preview).
   * @route GET /list-incidents
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Incidents per page (max 100). Defaults to 10."}
   * @paramDef {"type":"Number","label":"Page Offset","name":"pageOffset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of records to skip)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"incidents","id":"00000000-0000-abcd-0000-000000000000","attributes":{"title":"Checkout latency spike","public_id":42,"state":"active","customer_impacted":true,"created":"2026-07-16T20:15:00Z"}}],"meta":{"pagination":{"offset":0,"size":10,"next_offset":10}}}
   */
  async listIncidents(pageSize, pageOffset) {
    const logTag = '[listIncidents]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/incidents`,
      query: {
        'page[size]': pageSize,
        'page[offset]': pageOffset,
      },
    })
  }

  /**
   * @operationName Get Incident
   * @category Incidents
   * @description Retrieves an incident's full details, including state, severity, impact, and timeline metadata. Requires Incident Management to be enabled (the API is in preview).
   * @route GET /get-incident
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Incident ID","name":"incidentId","required":true,"description":"The incident UUID (data.id), e.g. from Create Incident or List Incidents."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"incidents","id":"00000000-0000-abcd-0000-000000000000","attributes":{"title":"Checkout latency spike","public_id":42,"state":"stable","customer_impacted":true,"fields":{"severity":{"type":"dropdown","value":"SEV-2"}}}}}
   */
  async getIncident(incidentId) {
    const logTag = '[getIncident]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/incidents/${ encodeURIComponent(incidentId) }`,
    })
  }

  /**
   * @operationName Update Incident
   * @category Incidents
   * @description Updates an incident's title, state, severity, or customer impact. Only the fields you provide are changed. Requires Incident Management to be enabled (the API is in preview).
   * @route PATCH /update-incident
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Incident ID","name":"incidentId","required":true,"description":"The incident UUID (data.id) to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New incident title."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Stable","Resolved"]}},"description":"New incident state."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["SEV-1","SEV-2","SEV-3","SEV-4","SEV-5","UNKNOWN"]}},"description":"New incident severity."}
   * @paramDef {"type":"Boolean","label":"Customer Impacted","name":"customerImpacted","uiComponent":{"type":"CHECKBOX"},"description":"Whether customers are impacted."}
   * @paramDef {"type":"String","label":"Customer Impact Scope","name":"customerImpactScope","description":"Description of the customer impact."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"incidents","id":"00000000-0000-abcd-0000-000000000000","attributes":{"title":"Checkout latency spike","state":"resolved","fields":{"severity":{"type":"dropdown","value":"SEV-2"},"state":{"type":"dropdown","value":"resolved"}}}}}
   */
  async updateIncident(incidentId, title, state, severity, customerImpacted, customerImpactScope) {
    const logTag = '[updateIncident]'

    const fields = clean({
      state: state ? { type: 'dropdown', value: this.#resolveChoice(state, { Active: 'active', Stable: 'stable', Resolved: 'resolved' }) } : undefined,
      severity: severity ? { type: 'dropdown', value: severity } : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/incidents/${ encodeURIComponent(incidentId) }`,
      method: 'patch',
      body: {
        data: {
          type: 'incidents',
          id: incidentId,
          attributes: clean({
            title,
            customer_impacted: customerImpacted,
            customer_impact_scope: customerImpactScope,
            fields: Object.keys(fields).length ? fields : undefined,
          }),
        },
      },
    })
  }

  /**
   * @operationName Delete Incident
   * @category Incidents
   * @description Permanently deletes an incident and its timeline. Requires Incident Management to be enabled (the API is in preview). Returns no content on success.
   * @route DELETE /delete-incident
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Incident ID","name":"incidentId","required":true,"description":"The incident UUID (data.id) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"incidentId":"00000000-0000-abcd-0000-000000000000"}
   */
  async deleteIncident(incidentId) {
    const logTag = '[deleteIncident]'

    await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/incidents/${ encodeURIComponent(incidentId) }`,
      method: 'delete',
    })

    return { deleted: true, incidentId }
  }

  // ---------------------------------------------------------------------------
  // Dashboards
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Dashboard
   * @category Dashboards
   * @description Creates a dashboard from raw widget JSON. Widgets follow the Datadog widget JSON schema (each item has a "definition" object, e.g. {"definition":{"type":"timeseries","requests":[{"q":"avg:system.cpu.user{*}"}]}}). Choose an ordered (top-to-bottom) or free (drag-anywhere) layout.
   * @route POST /create-dashboard
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Dashboard title."}
   * @paramDef {"type":"String","label":"Layout Type","name":"layoutType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Ordered","Free"]}},"description":"Dashboard layout: Ordered stacks widgets automatically; Free allows manual placement (widgets then need a \"layout\" object)."}
   * @paramDef {"type":"Array<Object>","label":"Widgets","name":"widgets","required":true,"description":"Array of widget JSON objects per the Datadog widget schema, e.g. [{\"definition\":{\"type\":\"timeseries\",\"requests\":[{\"q\":\"avg:system.cpu.user{*}\",\"display_type\":\"line\"}]}}]."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Dashboard description shown under the title."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc-def-ghi","title":"Service Overview","url":"/dashboard/abc-def-ghi/service-overview","layout_type":"ordered","widgets":[{"id":1234567890,"definition":{"type":"timeseries","requests":[{"q":"avg:system.cpu.user{*}"}]}}],"created_at":"2026-07-16T20:15:00.000000+00:00"}
   */
  async createDashboard(title, layoutType, widgets, description) {
    const logTag = '[createDashboard]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/dashboard`,
      method: 'post',
      body: clean({
        title,
        layout_type: this.#resolveChoice(layoutType, { Ordered: 'ordered', Free: 'free' }),
        widgets: widgets || [],
        description,
      }),
    })
  }

  /**
   * @operationName List Dashboards
   * @category Dashboards
   * @description Lists all dashboards in the organization with summary information (ID, title, author, URL). Optionally filters to shared or deleted dashboards, with offset-based pagination.
   * @route GET /list-dashboards
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Boolean","label":"Shared Only","name":"filterShared","uiComponent":{"type":"CHECKBOX"},"description":"Only return dashboards shared with a public URL."}
   * @paramDef {"type":"Boolean","label":"Deleted Only","name":"filterDeleted","uiComponent":{"type":"CHECKBOX"},"description":"Only return recently deleted dashboards."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of dashboards to return."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of dashboards to skip)."}
   *
   * @returns {Object}
   * @sampleResult {"dashboards":[{"id":"abc-def-ghi","title":"Service Overview","description":null,"layout_type":"ordered","url":"/dashboard/abc-def-ghi/service-overview","is_read_only":false,"author_handle":"admin@example.com","created_at":"2026-07-16T20:15:00.000000+00:00"}]}
   */
  async listDashboards(filterShared, filterDeleted, count, start) {
    const logTag = '[listDashboards]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/dashboard`,
      query: {
        'filter[shared]': filterShared,
        'filter[deleted]': filterDeleted,
        count,
        start,
      },
    })
  }

  /**
   * @operationName Get Dashboard
   * @category Dashboards
   * @description Retrieves a dashboard's full definition, including all widget JSON, template variables, and layout settings.
   * @route GET /get-dashboard
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Dashboard","name":"dashboardId","required":true,"dictionary":"getDashboardsDictionary","description":"The dashboard to retrieve. Select from the list or provide a dashboard ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc-def-ghi","title":"Service Overview","layout_type":"ordered","widgets":[{"id":1234567890,"definition":{"type":"timeseries","requests":[{"q":"avg:system.cpu.user{*}"}]}}],"template_variables":[],"url":"/dashboard/abc-def-ghi/service-overview"}
   */
  async getDashboard(dashboardId) {
    const logTag = '[getDashboard]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/dashboard/${ encodeURIComponent(dashboardId) }`,
    })
  }

  /**
   * @operationName Delete Dashboard
   * @category Dashboards
   * @description Deletes a dashboard. Recently deleted dashboards can be listed via List Dashboards with the Deleted Only filter.
   * @route DELETE /delete-dashboard
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Dashboard","name":"dashboardId","required":true,"dictionary":"getDashboardsDictionary","description":"The dashboard to delete. Select from the list or provide a dashboard ID."}
   *
   * @returns {Object}
   * @sampleResult {"deleted_dashboard_id":"abc-def-ghi"}
   */
  async deleteDashboard(dashboardId) {
    const logTag = '[deleteDashboard]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/dashboard/${ encodeURIComponent(dashboardId) }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // SLOs
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create SLO
   * @category SLOs
   * @description Creates a service level objective. A metric-based SLO computes the ratio of a numerator query over a denominator query (e.g. good requests / total requests); a monitor-based SLO tracks the uptime of one or more monitors. The threshold defines the target percentage over a timeframe.
   * @route POST /create-slo
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"SLO name, e.g. \"API availability\"."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Metric","Monitor"]}},"description":"SLO type: Metric computes a good/total ratio from metric queries; Monitor tracks monitor uptime."}
   * @paramDef {"type":"String","label":"Timeframe","name":"timeframe","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["7 Days","30 Days","90 Days"]}},"description":"Rolling window the target applies to."}
   * @paramDef {"type":"Number","label":"Target","name":"target","required":true,"description":"Target percentage, e.g. 99.9."}
   * @paramDef {"type":"Number","label":"Warning","name":"warning","description":"Warning percentage, must be above the target, e.g. 99.95."}
   * @paramDef {"type":"String","label":"Metric Numerator","name":"metricNumerator","description":"For Metric SLOs: query for good events, e.g. \"sum:requests.success{env:prod}.as_count()\"."}
   * @paramDef {"type":"String","label":"Metric Denominator","name":"metricDenominator","description":"For Metric SLOs: query for total events, e.g. \"sum:requests.total{env:prod}.as_count()\"."}
   * @paramDef {"type":"Array<Number>","label":"Monitor IDs","name":"monitorIds","description":"For Monitor SLOs: IDs of the monitors to track, e.g. [12345678]."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"SLO description."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the SLO, e.g. [\"team:payments\"]."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"abc123def456ghi789","name":"API availability","type":"metric","thresholds":[{"timeframe":"30d","target":99.9,"warning":99.95}],"query":{"numerator":"sum:requests.success{env:prod}.as_count()","denominator":"sum:requests.total{env:prod}.as_count()"},"tags":["team:payments"],"created_at":1752700000}],"error":null}
   */
  async createSlo(name, type, timeframe, target, warning, metricNumerator, metricDenominator, monitorIds, description, tags) {
    const logTag = '[createSlo]'

    const sloType = this.#resolveChoice(type, { Metric: 'metric', Monitor: 'monitor' })

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo`,
      method: 'post',
      body: clean({
        name,
        type: sloType,
        thresholds: [clean({
          timeframe: this.#resolveChoice(timeframe, { '7 Days': '7d', '30 Days': '30d', '90 Days': '90d' }),
          target,
          warning,
        })],
        query: sloType === 'metric' ? { numerator: metricNumerator, denominator: metricDenominator } : undefined,
        monitor_ids: sloType === 'monitor' ? monitorIds?.map(Number) : undefined,
        description,
        tags,
      }),
    })
  }

  /**
   * @operationName List SLOs
   * @category SLOs
   * @description Lists service level objectives, optionally filtered by IDs, name query, SLO tags, or underlying metric queries, with offset-based pagination.
   * @route GET /list-slos
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"IDs","name":"ids","description":"Comma-separated list of SLO IDs to fetch."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Filter SLOs whose name contains this text."}
   * @paramDef {"type":"String","label":"Tags Query","name":"tagsQuery","description":"Filter by SLO tags, e.g. \"team:payments\"."}
   * @paramDef {"type":"String","label":"Metrics Query","name":"metricsQuery","description":"Filter metric-based SLOs whose queries reference this metric, e.g. \"requests.total\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of SLOs to return. Defaults to 1000."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of SLOs to skip)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"abc123def456ghi789","name":"API availability","type":"metric","thresholds":[{"timeframe":"30d","target":99.9}],"tags":["team:payments"]}],"error":null}
   */
  async listSlos(ids, query, tagsQuery, metricsQuery, limit, offset) {
    const logTag = '[listSlos]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo`,
      query: {
        ids,
        query,
        tags_query: tagsQuery,
        metrics_query: metricsQuery,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Get SLO
   * @category SLOs
   * @description Retrieves a service level objective's full definition, optionally including the IDs of alerts configured against it.
   * @route GET /get-slo
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"SLO","name":"sloId","required":true,"dictionary":"getSlosDictionary","description":"The SLO to retrieve. Select from the list or provide an SLO ID."}
   * @paramDef {"type":"Boolean","label":"With Configured Alert IDs","name":"withConfiguredAlertIds","uiComponent":{"type":"CHECKBOX"},"description":"Include IDs of SLO monitors configured against this SLO."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"abc123def456ghi789","name":"API availability","type":"metric","thresholds":[{"timeframe":"30d","target":99.9,"warning":99.95}],"query":{"numerator":"sum:requests.success{env:prod}.as_count()","denominator":"sum:requests.total{env:prod}.as_count()"},"tags":["team:payments"]}}
   */
  async getSlo(sloId, withConfiguredAlertIds) {
    const logTag = '[getSlo]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo/${ encodeURIComponent(sloId) }`,
      query: { with_configured_alert_ids: withConfiguredAlertIds },
    })
  }

  /**
   * @operationName Update SLO
   * @category SLOs
   * @description Updates a service level objective. Fetches the current definition first and merges your changes, so only the fields you provide are modified. The SLO type cannot be changed after creation.
   * @route PUT /update-slo
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"SLO","name":"sloId","required":true,"dictionary":"getSlosDictionary","description":"The SLO to update. Select from the list or provide an SLO ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New SLO name."}
   * @paramDef {"type":"String","label":"Timeframe","name":"timeframe","uiComponent":{"type":"DROPDOWN","options":{"values":["7 Days","30 Days","90 Days"]}},"description":"New rolling window for the threshold."}
   * @paramDef {"type":"Number","label":"Target","name":"target","description":"New target percentage, e.g. 99.9."}
   * @paramDef {"type":"Number","label":"Warning","name":"warning","description":"New warning percentage, must be above the target."}
   * @paramDef {"type":"String","label":"Metric Numerator","name":"metricNumerator","description":"For Metric SLOs: new query for good events."}
   * @paramDef {"type":"String","label":"Metric Denominator","name":"metricDenominator","description":"For Metric SLOs: new query for total events."}
   * @paramDef {"type":"Array<Number>","label":"Monitor IDs","name":"monitorIds","description":"For Monitor SLOs: replacement list of monitor IDs."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New SLO description."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement set of SLO tags."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"abc123def456ghi789","name":"API availability","type":"metric","thresholds":[{"timeframe":"30d","target":99.95}],"modified_at":1752703600}],"error":null}
   */
  async updateSlo(sloId, name, timeframe, target, warning, metricNumerator, metricDenominator, monitorIds, description, tags) {
    const logTag = '[updateSlo]'

    const existing = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo/${ encodeURIComponent(sloId) }`,
    })

    const slo = existing.data || {}
    const currentThreshold = slo.thresholds?.[0] || {}

    const hasThresholdChange = timeframe !== undefined || target !== undefined || warning !== undefined

    const body = clean({
      name: name || slo.name,
      type: slo.type,
      description: description || slo.description,
      tags: tags?.length ? tags : slo.tags,
      thresholds: hasThresholdChange
        ? [clean({
          timeframe: this.#resolveChoice(timeframe, { '7 Days': '7d', '30 Days': '30d', '90 Days': '90d' }) || currentThreshold.timeframe,
          target: target !== undefined ? target : currentThreshold.target,
          warning: warning !== undefined ? warning : currentThreshold.warning,
        })]
        : slo.thresholds,
      query: slo.type === 'metric'
        ? {
          numerator: metricNumerator || slo.query?.numerator,
          denominator: metricDenominator || slo.query?.denominator,
        }
        : undefined,
      monitor_ids: slo.type === 'monitor'
        ? (monitorIds?.length ? monitorIds.map(Number) : slo.monitor_ids)
        : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo/${ encodeURIComponent(sloId) }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete SLO
   * @category SLOs
   * @description Permanently deletes a service level objective. Fails if the SLO is referenced by dashboards or SLO alerts unless those references are removed first.
   * @route DELETE /delete-slo
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"SLO","name":"sloId","required":true,"dictionary":"getSlosDictionary","description":"The SLO to delete. Select from the list or provide an SLO ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":["abc123def456ghi789"],"error":null}
   */
  async deleteSlo(sloId) {
    const logTag = '[deleteSlo]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo/${ encodeURIComponent(sloId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get SLO History
   * @category SLOs
   * @description Retrieves an SLO's history over a time window: overall uptime percentage, error budget remaining, and the series behind them. The window may span up to 90 days.
   * @route GET /get-slo-history
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"SLO","name":"sloId","required":true,"dictionary":"getSlosDictionary","description":"The SLO to query. Select from the list or provide an SLO ID."}
   * @paramDef {"type":"Number","label":"From","name":"fromTs","required":true,"description":"Start of the window as a POSIX timestamp (epoch seconds)."}
   * @paramDef {"type":"Number","label":"To","name":"toTs","required":true,"description":"End of the window as a POSIX timestamp (epoch seconds)."}
   * @paramDef {"type":"Boolean","label":"Apply Correction","name":"applyCorrection","uiComponent":{"type":"CHECKBOX"},"description":"Apply status corrections (maintenance exclusions) to the results. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"overall":{"sli_value":99.95,"span_precision":2,"name":"API availability"},"from_ts":1752096400,"to_ts":1752700000,"type":"metric","series":{"numerator":{"sum":998543},"denominator":{"sum":999042}}},"error":null}
   */
  async getSloHistory(sloId, fromTs, toTs, applyCorrection) {
    const logTag = '[getSloHistory]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo/${ encodeURIComponent(sloId) }/history`,
      query: {
        from_ts: fromTs,
        to_ts: toTs,
        apply_correction: applyCorrection,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Hosts
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Hosts
   * @category Hosts
   * @description Lists infrastructure hosts reporting to Datadog, with search filtering (e.g. "env:prod", a host name fragment, or a tag), sorting, pagination, and optional mute/metadata detail.
   * @route GET /list-hosts
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Host search query, e.g. \"env:prod\", \"web-\", or \"tag:role:db\"."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Field to sort by, e.g. \"status\", \"cpu\", \"apps\". Defaults to the host name."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of hosts to skip)."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of hosts to return (max 1000). Defaults to 100."}
   * @paramDef {"type":"Boolean","label":"Include Muted Hosts Data","name":"includeMutedHostsData","uiComponent":{"type":"CHECKBOX"},"description":"Include each host's mute status and mute expiry."}
   * @paramDef {"type":"Boolean","label":"Include Hosts Metadata","name":"includeHostsMetadata","uiComponent":{"type":"CHECKBOX"},"description":"Include host metadata (platform, agent version, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"total_returned":1,"total_matching":1,"host_list":[{"name":"web-01","id":1234567,"up":true,"is_muted":false,"apps":["agent","nginx"],"sources":["agent"],"tags_by_source":{"Datadog":["env:prod"]},"last_reported_time":1752700000}]}
   */
  async listHosts(filter, sortField, sortDir, start, count, includeMutedHostsData, includeHostsMetadata) {
    const logTag = '[listHosts]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/hosts`,
      query: {
        filter,
        sort_field: sortField,
        sort_dir: this.#resolveChoice(sortDir, { Ascending: 'asc', Descending: 'desc' }),
        start,
        count,
        include_muted_hosts_data: includeMutedHostsData,
        include_hosts_metadata: includeHostsMetadata,
      },
    })
  }

  /**
   * @operationName Get Host Totals
   * @category Hosts
   * @description Returns the total number of active and up hosts in the organization over roughly the last 2 hours.
   * @route GET /get-host-totals
   * @appearanceColor #632CA6 #8C51D9
   *
   * @returns {Object}
   * @sampleResult {"total_active":42,"total_up":40}
   */
  async getHostTotals() {
    const logTag = '[getHostTotals]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/hosts/totals`,
    })
  }

  /**
   * @operationName Mute Host
   * @category Hosts
   * @description Mutes a host so all monitors covering it stop sending notifications, optionally until a given time and with a note explaining why.
   * @route POST /mute-host
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Name of the host to mute, e.g. \"web-01\"."}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Note explaining why the host is muted."}
   * @paramDef {"type":"Number","label":"End","name":"end","description":"POSIX timestamp (epoch seconds) when the mute expires. Leave empty to mute indefinitely."}
   * @paramDef {"type":"Boolean","label":"Override","name":"override","uiComponent":{"type":"CHECKBOX"},"description":"Replace an existing mute's end time and message instead of failing if the host is already muted."}
   *
   * @returns {Object}
   * @sampleResult {"action":"Muted","hostname":"web-01","message":"Maintenance window","end":1752710000}
   */
  async muteHost(hostName, message, end, override) {
    const logTag = '[muteHost]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/host/${ encodeURIComponent(hostName) }/mute`,
      method: 'post',
      body: clean({ message, end, override }),
    })
  }

  /**
   * @operationName Unmute Host
   * @category Hosts
   * @description Unmutes a host so its monitors resume sending notifications.
   * @route POST /unmute-host
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Name of the host to unmute, e.g. \"web-01\"."}
   *
   * @returns {Object}
   * @sampleResult {"action":"Unmuted","hostname":"web-01"}
   */
  async unmuteHost(hostName) {
    const logTag = '[unmuteHost]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/host/${ encodeURIComponent(hostName) }/unmute`,
      method: 'post',
      body: {},
    })
  }

  // ---------------------------------------------------------------------------
  // Host Tags
  // ---------------------------------------------------------------------------

  /**
   * @operationName List All Host Tags
   * @category Host Tags
   * @description Returns a mapping of every host tag in the organization to the hosts carrying it, optionally restricted to one tag source (e.g. user, chef, aws).
   * @route GET /list-host-tags
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Only return tags from this source, e.g. \"user\", \"chef\", \"aws\"."}
   *
   * @returns {Object}
   * @sampleResult {"tags":{"env:prod":["web-01","web-02"],"role:db":["db-01"]}}
   */
  async listAllHostTags(source) {
    const logTag = '[listAllHostTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/tags/hosts`,
      query: { source },
    })
  }

  /**
   * @operationName Get Host Tags
   * @category Host Tags
   * @description Returns the list of tags applied to a specific host, optionally restricted to one tag source.
   * @route GET /get-host-tags
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Host to look up, e.g. \"web-01\"."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Only return tags from this source, e.g. \"user\", \"chef\", \"aws\"."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["env:prod","role:web"]}
   */
  async getHostTags(hostName, source) {
    const logTag = '[getHostTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/tags/hosts/${ encodeURIComponent(hostName) }`,
      query: { source },
    })
  }

  /**
   * @operationName Add Host Tags
   * @category Host Tags
   * @description Adds tags to a host without removing its existing tags. Tags apply to all metrics the host reports.
   * @route POST /add-host-tags
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Host to tag, e.g. \"web-01\"."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tags to add, e.g. [\"env:prod\", \"role:web\"]."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Tag source to attribute the tags to. Defaults to \"users\"."}
   *
   * @returns {Object}
   * @sampleResult {"host":"web-01","tags":["env:prod","role:web"]}
   */
  async addHostTags(hostName, tags, source) {
    const logTag = '[addHostTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/tags/hosts/${ encodeURIComponent(hostName) }`,
      method: 'post',
      query: { source },
      body: { tags },
    })
  }

  /**
   * @operationName Update Host Tags
   * @category Host Tags
   * @description Replaces all of a host's tags (for the given source) with a new set. Existing tags from that source not included in the new set are removed.
   * @route PUT /update-host-tags
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Host whose tags to replace, e.g. \"web-01\"."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"The full replacement set of tags, e.g. [\"env:prod\", \"role:web\"]."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Tag source whose tags are replaced. Defaults to \"users\"."}
   *
   * @returns {Object}
   * @sampleResult {"host":"web-01","tags":["env:prod","role:web"]}
   */
  async updateHostTags(hostName, tags, source) {
    const logTag = '[updateHostTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/tags/hosts/${ encodeURIComponent(hostName) }`,
      method: 'put',
      query: { source },
      body: { tags },
    })
  }

  /**
   * @operationName Remove Host Tags
   * @category Host Tags
   * @description Removes all tags from a host for the given source. Returns no content on success.
   * @route DELETE /remove-host-tags
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Host whose tags to remove, e.g. \"web-01\"."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Tag source whose tags are removed. Defaults to \"users\"."}
   *
   * @returns {Object}
   * @sampleResult {"removed":true,"host":"web-01"}
   */
  async removeHostTags(hostName, source) {
    const logTag = '[removeHostTags]'

    await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/tags/hosts/${ encodeURIComponent(hostName) }`,
      method: 'delete',
      query: { source },
    })

    return { removed: true, host: hostName }
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Users
   * @category Users
   * @description Lists organization users with optional text filtering, status filtering, sorting, and page-based pagination.
   * @route GET /list-users
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Search users by name, email, or handle."}
   * @paramDef {"type":"String","label":"Status","name":"filterStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Pending","Disabled"]}},"description":"Only return users with this status."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Sort field, prefix with - for descending, e.g. \"name\", \"-modified_at\", \"user_count\"."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Users per page (max 100). Defaults to 10."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"users","id":"00000000-0000-0000-0000-000000000001","attributes":{"name":"Jane Doe","email":"jane@example.com","handle":"jane@example.com","status":"Active","verified":true}}],"meta":{"page":{"total_count":1}}}
   */
  async listUsers(filter, filterStatus, sort, pageSize, pageNumber) {
    const logTag = '[listUsers]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/users`,
      query: {
        filter,
        'filter[status]': filterStatus,
        sort,
        'page[size]': pageSize,
        'page[number]': pageNumber,
      },
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a user's details, including name, email, status, and organization role relationships.
   * @route GET /get-user
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user's UUID, e.g. from List Users."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"users","id":"00000000-0000-0000-0000-000000000001","attributes":{"name":"Jane Doe","email":"jane@example.com","handle":"jane@example.com","status":"Active","verified":true,"created_at":"2026-01-10T09:00:00Z"}}}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/users/${ encodeURIComponent(userId) }`,
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a user in the organization and, by default, emails them an invitation to join. The user appears with Pending status until they accept.
   * @route POST /create-user
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The new user's email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The new user's full name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The new user's job title."}
   * @paramDef {"type":"Boolean","label":"Send Invitation","name":"sendInvitation","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Email an invitation to the user after creating them. Defaults to on."}
   *
   * @returns {Object}
   * @sampleResult {"user":{"type":"users","id":"00000000-0000-0000-0000-000000000002","attributes":{"name":"John Smith","email":"john@example.com","status":"Pending"}},"invitation":{"type":"user_invitations","id":"00000000-0000-0000-0000-00000000inv1"}}
   */
  async createUser(email, name, title, sendInvitation) {
    const logTag = '[createUser]'

    const created = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/users`,
      method: 'post',
      body: {
        data: {
          type: 'users',
          attributes: clean({ email, name, title }),
        },
      },
    })

    let invitation = null

    if (sendInvitation !== false && created.data?.id) {
      const invitationResponse = await this.#apiRequest({
        logTag,
        url: `${ this.apiBaseUrl }/api/v2/user_invitations`,
        method: 'post',
        body: {
          data: [{
            type: 'user_invitations',
            relationships: {
              user: { data: { type: 'users', id: created.data.id } },
            },
          }],
        },
      })

      invitation = invitationResponse.data?.[0] || null
    }

    return { user: created.data, invitation }
  }

  /**
   * @operationName Disable User
   * @category Users
   * @description Disables a user so they can no longer access the organization. Users are disabled rather than deleted, so their handle remains attached to past activity. Returns no content on success.
   * @route DELETE /disable-user
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The UUID of the user to disable, e.g. from List Users."}
   *
   * @returns {Object}
   * @sampleResult {"disabled":true,"userId":"00000000-0000-0000-0000-000000000002"}
   */
  async disableUser(userId) {
    const logTag = '[disableUser]'

    await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v2/users/${ encodeURIComponent(userId) }`,
      method: 'delete',
    })

    return { disabled: true, userId }
  }

  // ---------------------------------------------------------------------------
  // Synthetics
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Synthetics Tests
   * @category Synthetics
   * @description Lists all Synthetic tests (API and browser) configured in the organization, including their public IDs, status, locations, and tags.
   * @route GET /list-synthetics-tests
   * @appearanceColor #632CA6 #8C51D9
   *
   * @returns {Object}
   * @sampleResult {"tests":[{"public_id":"abc-123-def","name":"Checkout flow","type":"browser","status":"live","locations":["aws:us-east-1"],"tags":["env:prod"],"monitor_id":12345678}]}
   */
  async listSyntheticsTests() {
    const logTag = '[listSyntheticsTests]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/synthetics/tests`,
    })
  }

  /**
   * @operationName Get Synthetics Test
   * @category Synthetics
   * @description Retrieves the full configuration of a Synthetic test by its public ID, including request/steps definition, assertions, locations, and scheduling options.
   * @route GET /get-synthetics-test
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Test Public ID","name":"publicId","required":true,"description":"The test's public ID, e.g. \"abc-123-def\", from List Synthetics Tests."}
   *
   * @returns {Object}
   * @sampleResult {"public_id":"abc-123-def","name":"Checkout flow","type":"browser","status":"live","config":{"request":{"method":"GET","url":"https://shop.example.com"},"assertions":[]},"locations":["aws:us-east-1"],"options":{"tick_every":300}}
   */
  async getSyntheticsTest(publicId) {
    const logTag = '[getSyntheticsTest]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/synthetics/tests/${ encodeURIComponent(publicId) }`,
    })
  }

  /**
   * @operationName Trigger Synthetics CI Tests
   * @category Synthetics
   * @description Triggers one or more Synthetic tests on demand (CI mode) and returns the result IDs to poll for outcomes. Useful for gating deployments on synthetic checks.
   * @route POST /trigger-synthetics-ci-tests
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Array<String>","label":"Test Public IDs","name":"publicIds","required":true,"description":"Public IDs of the tests to trigger, e.g. [\"abc-123-def\"]."}
   *
   * @returns {Object}
   * @sampleResult {"batch_id":"00000000-0000-4321-0000-000000000000","results":[{"public_id":"abc-123-def","result_id":"1234567890123456789","location":30019}],"triggered_check_ids":["abc-123-def"]}
   */
  async triggerSyntheticsCiTests(publicIds) {
    const logTag = '[triggerSyntheticsCiTests]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/synthetics/tests/trigger/ci`,
      method: 'post',
      body: {
        tests: (publicIds || []).map(publicId => ({ public_id: publicId })),
      },
    })
  }

  /**
   * @operationName Get Synthetics Test Results
   * @category Synthetics
   * @description Retrieves the latest results of a Synthetic test, optionally bounded to a time window and filtered by probe locations. Choose the test type to route to the correct results endpoint.
   * @route GET /get-synthetics-test-results
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Test Public ID","name":"publicId","required":true,"description":"The test's public ID, e.g. \"abc-123-def\"."}
   * @paramDef {"type":"String","label":"Test Type","name":"testType","uiComponent":{"type":"DROPDOWN","options":{"values":["API Test","Browser Test"]}},"description":"The type of the test. Defaults to API Test."}
   * @paramDef {"type":"Number","label":"From","name":"fromTs","description":"Only return results after this POSIX timestamp in milliseconds."}
   * @paramDef {"type":"Number","label":"To","name":"toTs","description":"Only return results up to this POSIX timestamp in milliseconds."}
   * @paramDef {"type":"Array<String>","label":"Probe Locations","name":"probeDc","description":"Only return results from these probe locations, e.g. [\"aws:us-east-1\"]."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"result_id":"1234567890123456789","status":0,"check_time":1752700000000,"probe_dc":"aws:us-east-1","result":{"passed":true,"timings":{"total":312.5}}}]}
   */
  async getSyntheticsTestResults(publicId, testType, fromTs, toTs, probeDc) {
    const logTag = '[getSyntheticsTestResults]'

    const type = this.#resolveChoice(testType, { 'API Test': 'api', 'Browser Test': 'browser' }) || 'api'
    const path = type === 'browser'
      ? `/api/v1/synthetics/tests/browser/${ encodeURIComponent(publicId) }/results`
      : `/api/v1/synthetics/tests/${ encodeURIComponent(publicId) }/results`

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }${ path }`,
      query: {
        from_ts: fromTs,
        to_ts: toTs,
        probe_dc: probeDc?.length ? probeDc : undefined,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Service Checks
  // ---------------------------------------------------------------------------

  /**
   * @operationName Submit Service Check
   * @category Service Checks
   * @description Submits a service check status for a host. Service checks feed check-based monitors and the host status overview. The message is limited to 500 characters and is only shown for Warning and Critical statuses.
   * @route POST /submit-service-check
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Check Name","name":"check","required":true,"description":"Name of the check, e.g. \"app.is_ok\"."}
   * @paramDef {"type":"String","label":"Host Name","name":"hostName","required":true,"description":"Host the check reports for, e.g. \"web-01\"."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["OK","Warning","Critical","Unknown"]}},"description":"The check status to report."}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Description of the status (max 500 characters). Shown for Warning and Critical statuses."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the check run, e.g. [\"env:prod\"]."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok"}
   */
  async submitServiceCheck(check, hostName, status, message, tags) {
    const logTag = '[submitServiceCheck]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/check_run`,
      method: 'post',
      body: clean({
        check,
        host_name: hostName,
        status: this.#resolveChoice(status, { OK: 0, Warning: 1, Critical: 2, Unknown: 3 }),
        message,
        tags,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Notebooks
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Notebooks
   * @category Notebooks
   * @description Lists notebooks in the organization with summary information, supporting text search, sorting, and offset-based pagination.
   * @route GET /list-notebooks
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Return only notebooks whose name matches this text."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","uiComponent":{"type":"DROPDOWN","options":{"values":["Modified","Name","Created"]}},"description":"Field to sort by. Defaults to Modified."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to Descending."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of notebooks to return."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (number of notebooks to skip)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"notebooks","id":123456,"attributes":{"name":"Incident 42 investigation","status":"published","modified":"2026-07-16T20:15:00Z","author":{"email":"jane@example.com"}}}],"meta":{"page":{"total_count":1}}}
   */
  async listNotebooks(query, sortField, sortDir, count, start) {
    const logTag = '[listNotebooks]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/notebooks`,
      query: {
        query,
        sort_field: this.#resolveChoice(sortField, { Modified: 'modified', Name: 'name', Created: 'created' }),
        sort_dir: this.#resolveChoice(sortDir, { Ascending: 'asc', Descending: 'desc' }),
        count,
        start,
      },
    })
  }

  /**
   * @operationName Get Notebook
   * @category Notebooks
   * @description Retrieves a notebook's full content, including all cells (markdown, timeseries, log stream, etc.) and its global time frame.
   * @route GET /get-notebook
   * @appearanceColor #632CA6 #8C51D9
   *
   * @paramDef {"type":"Number","label":"Notebook ID","name":"notebookId","required":true,"description":"The notebook's numeric ID, e.g. from List Notebooks."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"type":"notebooks","id":123456,"attributes":{"name":"Incident 42 investigation","status":"published","cells":[{"type":"notebook_cells","id":"abcdef","attributes":{"definition":{"type":"markdown","text":"## Findings"}}}],"time":{"live_span":"1h"}}}}
   */
  async getNotebook(notebookId) {
    const logTag = '[getNotebook]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/notebooks/${ encodeURIComponent(notebookId) }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  /**
   * @operationName Validate API Key
   * @category Account
   * @description Checks that the configured API key is valid on the configured Datadog site. Useful as a connection test when setting up the integration.
   * @route GET /validate-api-key
   * @appearanceColor #632CA6 #8C51D9
   *
   * @returns {Object}
   * @sampleResult {"valid":true}
   */
  async validateApiKey() {
    const logTag = '[validateApiKey]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/validate`,
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getMonitorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter monitors by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (zero-based page number) from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Monitors Dictionary
   * @description Lists monitors for selection in monitor parameters. The option value is the monitor ID.
   * @route POST /get-monitors-dictionary
   * @paramDef {"type":"getMonitorsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"High CPU on prod","value":"12345678","note":"metric alert"}],"cursor":"1"}
   */
  async getMonitorsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getMonitorsDictionary]'
    const page = cursor ? Number(cursor) : 0

    const monitors = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/monitor`,
      query: {
        name: search,
        page,
        page_size: DICTIONARY_PAGE_SIZE,
      },
    })

    return {
      items: (monitors || []).map(monitor => ({
        label: monitor.name,
        value: String(monitor.id),
        note: monitor.type,
      })),
      cursor: monitors?.length === DICTIONARY_PAGE_SIZE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getDashboardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter dashboards by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Dashboards Dictionary
   * @description Lists dashboards for selection in dashboard parameters. The option value is the dashboard ID.
   * @route POST /get-dashboards-dictionary
   * @paramDef {"type":"getDashboardsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Service Overview","value":"abc-def-ghi","note":"ordered"}],"cursor":"100"}
   */
  async getDashboardsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getDashboardsDictionary]'
    const start = cursor ? Number(cursor) : 0
    const count = 100

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/dashboard`,
      query: { start, count },
    })

    const dashboards = response.dashboards || []
    const searchLower = (search || '').toLowerCase()
    const filtered = searchLower
      ? dashboards.filter(dashboard => (dashboard.title || '').toLowerCase().includes(searchLower))
      : dashboards

    return {
      items: filtered.map(dashboard => ({
        label: dashboard.title,
        value: dashboard.id,
        note: dashboard.layout_type,
      })),
      cursor: dashboards.length === count ? String(start + count) : null,
    }
  }

  /**
   * @typedef {Object} getSlosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter SLOs by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get SLOs Dictionary
   * @description Lists service level objectives for selection in SLO parameters. The option value is the SLO ID.
   * @route POST /get-slos-dictionary
   * @paramDef {"type":"getSlosDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"API availability","value":"abc123def456ghi789","note":"metric"}],"cursor":"50"}
   */
  async getSlosDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getSlosDictionary]'
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.apiBaseUrl }/api/v1/slo`,
      query: {
        query: search,
        limit: DICTIONARY_PAGE_SIZE,
        offset,
      },
    })

    const slos = response.data || []

    return {
      items: slos.map(slo => ({
        label: slo.name,
        value: slo.id,
        note: slo.type,
      })),
      cursor: slos.length === DICTIONARY_PAGE_SIZE ? String(offset + DICTIONARY_PAGE_SIZE) : null,
    }
  }
}

Flowrunner.ServerCode.addService(DatadogService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Datadog API key (sent as the DD-API-KEY header). Create one under Organization Settings > API Keys.',
  },
  {
    name: 'appKey',
    displayName: 'Application Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Datadog application key (sent as the DD-APPLICATION-KEY header). Create one under Organization Settings > Application Keys.',
  },
  {
    name: 'site',
    displayName: 'Site',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['datadoghq.com', 'us3.datadoghq.com', 'us5.datadoghq.com', 'datadoghq.eu', 'ap1.datadoghq.com', 'ddog-gov.com'],
    defaultValue: 'datadoghq.com',
    required: true,
    shared: false,
    hint: 'Your Datadog site (the domain you log in at, without \'app.\'). Determines the API endpoint, e.g. api.datadoghq.eu.',
  },
])
