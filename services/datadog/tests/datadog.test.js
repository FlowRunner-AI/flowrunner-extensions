'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const APP_KEY = 'test-app-key'
const SITE = 'datadoghq.com'
const BASE = `https://api.${ SITE }`
const LOGS_BASE = `https://http-intake.logs.${ SITE }`

describe('Datadog Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, appKey: APP_KEY, site: SITE })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'apiKey', displayName: 'API Key', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'appKey', displayName: 'Application Key', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'site', displayName: 'Site', required: true, shared: false, type: 'CHOICE' }),
      ])
    })

    it('sends DD-API-KEY and DD-APPLICATION-KEY headers on app-key requests', async () => {
      mock.onGet(`${ BASE }/api/v1/validate`).reply({ valid: true })

      await service.validateApiKey()

      expect(mock.history[0].headers).toMatchObject({
        'DD-API-KEY': API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
        'Content-Type': 'application/json',
      })
    })

    it('omits DD-APPLICATION-KEY on the logs intake request', async () => {
      mock.onPost(`${ LOGS_BASE }/api/v2/logs`).reply({})

      await service.sendLog('hello')

      expect(mock.history[0].headers).toMatchObject({
        'DD-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].headers).not.toHaveProperty('DD-APPLICATION-KEY')
    })
  })

  // ── Events ──

  describe('postEvent', () => {
    it('sends required params only', async () => {
      mock.onPost(`${ BASE }/api/v1/events`).reply({ status: 'ok' })

      const result = await service.postEvent('Title', 'Body text')

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'Title', text: 'Body text' })
    })

    it('includes and maps all optional params', async () => {
      mock.onPost(`${ BASE }/api/v1/events`).reply({ status: 'ok' })

      await service.postEvent(
        'Title', 'Body', 'Warning', 'Low', ['env:prod'], 'web-01', 'agg-1', 'jenkins', 1752700000
      )

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        text: 'Body',
        alert_type: 'warning',
        priority: 'low',
        tags: ['env:prod'],
        host: 'web-01',
        aggregation_key: 'agg-1',
        source_type_name: 'jenkins',
        date_happened: 1752700000,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/v1/events`).replyWithError({ message: 'Bad Request' })

      await expect(service.postEvent('t', 'x')).rejects.toThrow('Datadog API error: Bad Request')
    })

    it('surfaces the structured error body errors array', async () => {
      mock.onPost(`${ BASE }/api/v1/events`).replyWithError({
        message: 'Unprocessable',
        body: { errors: ['title too long', 'text required'] },
      })

      await expect(service.postEvent('t', 'x')).rejects.toThrow('Datadog API error: title too long; text required')
    })
  })

  describe('listEvents', () => {
    it('sends required params only', async () => {
      mock.onGet(`${ BASE }/api/v1/events`).reply({ events: [] })

      await service.listEvents(1752690000, 1752700000)

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ start: 1752690000, end: 1752700000 })
    })

    it('includes and maps all optional params', async () => {
      mock.onGet(`${ BASE }/api/v1/events`).reply({ events: [] })

      await service.listEvents(1752690000, 1752700000, 'Normal', 'jenkins,github', 'env:prod', true)

      expect(mock.history[0].query).toEqual({
        start: 1752690000,
        end: 1752700000,
        priority: 'normal',
        sources: 'jenkins,github',
        tags: 'env:prod',
        unaggregated: true,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/events`).replyWithError({ message: 'Forbidden' })

      await expect(service.listEvents(1, 2)).rejects.toThrow('Datadog API error: Forbidden')
    })
  })

  describe('searchEvents', () => {
    it('uses defaults when nothing is provided', async () => {
      mock.onPost(`${ BASE }/api/v2/events/search`).reply({ data: [] })

      await service.searchEvents()

      // page is cleaned to {} (not dropped) since an empty object is truthy for clean().
      expect(mock.history[0].body).toEqual({
        filter: { query: '*', from: 'now-15m', to: 'now' },
        page: {},
      })
    })

    it('includes and maps all optional params', async () => {
      mock.onPost(`${ BASE }/api/v2/events/search`).reply({ data: [] })

      await service.searchEvents('source:alert', 'now-1h', 'now', 'Newest First', 25, 'cur-1')

      expect(mock.history[0].body).toEqual({
        filter: { query: 'source:alert', from: 'now-1h', to: 'now' },
        sort: '-timestamp',
        page: { limit: 25, cursor: 'cur-1' },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/events/search`).replyWithError({ message: 'Boom' })

      await expect(service.searchEvents()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Metrics ──

  describe('submitMetric', () => {
    it('sends required params only with generated timestamp', async () => {
      mock.onPost(`${ BASE }/api/v2/series`).reply({ errors: [] })

      const before = Math.floor(Date.now() / 1000)
      await service.submitMetric('myapp.orders', 42)
      const after = Math.floor(Date.now() / 1000)

      const series = mock.history[0].body.series[0]
      expect(series.metric).toBe('myapp.orders')
      expect(series.points).toHaveLength(1)
      expect(series.points[0].value).toBe(42)
      expect(series.points[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(series.points[0].timestamp).toBeLessThanOrEqual(after)
      expect(mock.history[0].url).toBe(`${ BASE }/api/v2/series`)
    })

    it('includes and maps all optional params', async () => {
      mock.onPost(`${ BASE }/api/v2/series`).reply({ errors: [] })

      await service.submitMetric('myapp.orders', 42, 'Count', 1752700000, ['env:prod'], 'web-01', 'order')

      expect(mock.history[0].body).toEqual({
        series: [{
          metric: 'myapp.orders',
          type: 1,
          points: [{ timestamp: 1752700000, value: 42 }],
          tags: ['env:prod'],
          resources: [{ name: 'web-01', type: 'host' }],
          unit: 'order',
        }],
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/series`).replyWithError({ message: 'Boom' })

      await expect(service.submitMetric('m', 1)).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('queryTimeseries', () => {
    it('sends the query params', async () => {
      mock.onGet(`${ BASE }/api/v1/query`).reply({ status: 'ok', series: [] })

      await service.queryTimeseries('avg:system.cpu.user{*}', 1752696400, 1752700000)

      expect(mock.history[0].query).toEqual({
        query: 'avg:system.cpu.user{*}',
        from: 1752696400,
        to: 1752700000,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/query`).replyWithError({ message: 'Boom' })

      await expect(service.queryTimeseries('q', 1, 2)).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listMetrics', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v2/metrics`).reply({ data: [] })

      await service.listMetrics()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps filter tags and window seconds to bracketed params', async () => {
      mock.onGet(`${ BASE }/api/v2/metrics`).reply({ data: [] })

      await service.listMetrics('env:prod,service:web', 3600)

      expect(mock.history[0].query).toEqual({
        'filter[tags]': 'env:prod,service:web',
        'window[seconds]': 3600,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/metrics`).replyWithError({ message: 'Boom' })

      await expect(service.listMetrics()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getMetricMetadata', () => {
    it('fetches metadata with url-encoded metric name', async () => {
      mock.onGet(`${ BASE }/api/v1/metrics/system.cpu.user`).reply({ type: 'gauge' })

      const result = await service.getMetricMetadata('system.cpu.user')

      expect(result).toEqual({ type: 'gauge' })
      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/metrics/system.cpu.user`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/metrics/x`).replyWithError({ message: 'Not found' })

      await expect(service.getMetricMetadata('x')).rejects.toThrow('Datadog API error: Not found')
    })
  })

  describe('updateMetricMetadata', () => {
    it('sends an empty body when only the metric name is given', async () => {
      mock.onPut(`${ BASE }/api/v1/metrics/myapp.orders`).reply({ type: 'count' })

      await service.updateMetricMetadata('myapp.orders')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes and maps all optional params', async () => {
      mock.onPut(`${ BASE }/api/v1/metrics/myapp.orders`).reply({ type: 'count' })

      await service.updateMetricMetadata('myapp.orders', 'Count', 'desc', 'orders', 'order', 'second', 15)

      expect(mock.history[0].body).toEqual({
        type: 'count',
        description: 'desc',
        short_name: 'orders',
        unit: 'order',
        per_unit: 'second',
        statsd_interval: 15,
      })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/api/v1/metrics/m`).replyWithError({ message: 'Boom' })

      await expect(service.updateMetricMetadata('m', 'Count')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Logs ──

  describe('sendLog', () => {
    it('sends required params only (no app key, array body)', async () => {
      mock.onPost(`${ LOGS_BASE }/api/v2/logs`).reply({})

      await service.sendLog('hello world')

      expect(mock.history[0].url).toBe(`${ LOGS_BASE }/api/v2/logs`)
      expect(mock.history[0].body).toEqual([{ message: 'hello world' }])
    })

    it('includes tags joined and merges additional attributes', async () => {
      mock.onPost(`${ LOGS_BASE }/api/v2/logs`).reply({})

      await service.sendLog('msg', 'nodejs', 'web', 'web-01', ['env:prod', 'v:2'], { user_id: '123', status: 'error' })

      expect(mock.history[0].body).toEqual([{
        message: 'msg',
        ddsource: 'nodejs',
        service: 'web',
        hostname: 'web-01',
        ddtags: 'env:prod,v:2',
        user_id: '123',
        status: 'error',
      }])
    })

    it('throws on API error', async () => {
      mock.onPost(`${ LOGS_BASE }/api/v2/logs`).replyWithError({ message: 'Boom' })

      await expect(service.sendLog('x')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('searchLogs', () => {
    it('uses defaults when nothing is provided', async () => {
      mock.onPost(`${ BASE }/api/v2/logs/events/search`).reply({ data: [] })

      await service.searchLogs()

      // page is cleaned to {} (not dropped) since an empty object is truthy for clean().
      expect(mock.history[0].body).toEqual({
        filter: { query: '*', from: 'now-15m', to: 'now' },
        page: {},
      })
    })

    it('includes and maps all optional params', async () => {
      mock.onPost(`${ BASE }/api/v2/logs/events/search`).reply({ data: [] })

      await service.searchLogs('service:web status:error', 'now-1h', 'now', ['main'], 'Newest First', 50, 'cur-1')

      expect(mock.history[0].body).toEqual({
        filter: {
          query: 'service:web status:error',
          from: 'now-1h',
          to: 'now',
          indexes: ['main'],
        },
        sort: '-timestamp',
        page: { limit: 50, cursor: 'cur-1' },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/logs/events/search`).replyWithError({ message: 'Boom' })

      await expect(service.searchLogs()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Monitors ──

  describe('createMonitor', () => {
    it('sends required params only', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor`).reply({ id: 1 })

      await service.createMonitor('High CPU', 'Metric Alert', 'avg(last_5m):avg:system.cpu.user{*} > 90')

      expect(mock.history[0].body).toEqual({
        name: 'High CPU',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 90',
      })
    })

    it('includes and maps all optional params', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor`).reply({ id: 2 })

      await service.createMonitor(
        'Errors', 'Log Alert', 'logs("status:error").index("*").rollup("count").last("5m") > 100',
        'Too many errors @slack-ops', ['team:payments'], 2, { thresholds: { critical: 100 } }
      )

      expect(mock.history[0].body).toEqual({
        name: 'Errors',
        type: 'log alert',
        query: 'logs("status:error").index("*").rollup("count").last("5m") > 100',
        message: 'Too many errors @slack-ops',
        tags: ['team:payments'],
        priority: 2,
        options: { thresholds: { critical: 100 } },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor`).replyWithError({ message: 'Boom' })

      await expect(service.createMonitor('n', 'Metric Alert', 'q')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listMonitors', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply([])

      await service.listMonitors()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps all optional params to snake_case', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply([])

      await service.listMonitors('High', 'host:web-01', 'team:payments', 'alert,warn', 1, 50)

      expect(mock.history[0].query).toEqual({
        name: 'High',
        tags: 'host:web-01',
        monitor_tags: 'team:payments',
        group_states: 'alert,warn',
        page: 1,
        page_size: 50,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).replyWithError({ message: 'Boom' })

      await expect(service.listMonitors()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getMonitor', () => {
    it('fetches by id with url encoding', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/12345678`).reply({ id: 12345678 })

      await service.getMonitor('12345678')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/monitor/12345678`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes group states', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/12345678`).reply({ id: 12345678 })

      await service.getMonitor('12345678', 'all')

      expect(mock.history[0].query).toEqual({ group_states: 'all' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/1`).replyWithError({ message: 'Boom' })

      await expect(service.getMonitor('1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('updateMonitor', () => {
    it('sends an empty body when only the id is given', async () => {
      mock.onPut(`${ BASE }/api/v1/monitor/12345678`).reply({ id: 12345678 })

      await service.updateMonitor('12345678')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes and maps all optional params', async () => {
      mock.onPut(`${ BASE }/api/v1/monitor/12345678`).reply({ id: 12345678 })

      await service.updateMonitor('12345678', 'New name', 'q > 95', 'msg', ['t:1'], 3, { notify_no_data: true })

      expect(mock.history[0].body).toEqual({
        name: 'New name',
        query: 'q > 95',
        message: 'msg',
        tags: ['t:1'],
        priority: 3,
        options: { notify_no_data: true },
      })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/api/v1/monitor/1`).replyWithError({ message: 'Boom' })

      await expect(service.updateMonitor('1', 'n')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('deleteMonitor', () => {
    it('sends delete', async () => {
      mock.onDelete(`${ BASE }/api/v1/monitor/12345678`).reply({ deleted_monitor_id: 12345678 })

      const result = await service.deleteMonitor('12345678')

      expect(result).toEqual({ deleted_monitor_id: 12345678 })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v1/monitor/1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteMonitor('1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('muteMonitor', () => {
    it('sends no query params when only id is given', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/12345678/mute`).reply({ id: 12345678 })

      await service.muteMonitor('12345678')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/monitor/12345678/mute`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes scope and end', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/12345678/mute`).reply({ id: 12345678 })

      await service.muteMonitor('12345678', 'host:web-01', 1752710000)

      expect(mock.history[0].query).toEqual({ scope: 'host:web-01', end: 1752710000 })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/1/mute`).replyWithError({ message: 'Boom' })

      await expect(service.muteMonitor('1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('unmuteMonitor', () => {
    it('sends no query params when only id is given', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/12345678/unmute`).reply({ id: 12345678 })

      await service.unmuteMonitor('12345678')

      expect(mock.history[0].query).toEqual({})
    })

    it('passes scope and all_scopes', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/12345678/unmute`).reply({ id: 12345678 })

      await service.unmuteMonitor('12345678', 'host:web-01', true)

      expect(mock.history[0].query).toEqual({ scope: 'host:web-01', all_scopes: true })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/monitor/1/unmute`).replyWithError({ message: 'Boom' })

      await expect(service.unmuteMonitor('1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('searchMonitors', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/search`).reply({ monitors: [] })

      await service.searchMonitors()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps all optional params', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/search`).reply({ monitors: [] })

      await service.searchMonitors('status:alert', 0, 30, 'name,asc')

      expect(mock.history[0].query).toEqual({
        query: 'status:alert',
        page: 0,
        per_page: 30,
        sort: 'name,asc',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor/search`).replyWithError({ message: 'Boom' })

      await expect(service.searchMonitors()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Downtimes ──

  describe('createDowntime', () => {
    it('targets a specific monitor by id (numeric)', async () => {
      mock.onPost(`${ BASE }/api/v2/downtime`).reply({ data: {} })

      await service.createDowntime('env:staging', '12345678')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'downtime',
          attributes: {
            scope: 'env:staging',
            monitor_identifier: { monitor_id: 12345678 },
          },
        },
      })
    })

    it('targets by monitor tags with schedule and mute flag', async () => {
      mock.onPost(`${ BASE }/api/v2/downtime`).reply({ data: {} })

      await service.createDowntime(
        'env:staging', undefined, ['team:payments'], 'Maintenance', '2026-07-20T02:00:00Z', '2026-07-20T04:00:00Z', true
      )

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'downtime',
          attributes: {
            scope: 'env:staging',
            monitor_identifier: { monitor_tags: ['team:payments'] },
            message: 'Maintenance',
            schedule: { start: '2026-07-20T02:00:00Z', end: '2026-07-20T04:00:00Z' },
            mute_first_recovery_notification: true,
          },
        },
      })
    })

    it('throws when neither monitor nor monitor tags are provided', async () => {
      await expect(service.createDowntime('env:staging')).rejects.toThrow(
        'Datadog API error: provide either Monitor or Monitor Tags to target the downtime'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/downtime`).replyWithError({ message: 'Boom' })

      await expect(service.createDowntime('env:staging', '1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listDowntimes', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v2/downtime`).reply({ data: [] })

      await service.listDowntimes()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps current-only and page params', async () => {
      mock.onGet(`${ BASE }/api/v2/downtime`).reply({ data: [] })

      await service.listDowntimes(true, 10, 30)

      expect(mock.history[0].query).toEqual({
        current_only: true,
        'page[offset]': 10,
        'page[limit]': 30,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/downtime`).replyWithError({ message: 'Boom' })

      await expect(service.listDowntimes()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getDowntime', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v2/downtime/dt-1`).reply({ data: {} })

      await service.getDowntime('dt-1')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v2/downtime/dt-1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/downtime/dt-1`).replyWithError({ message: 'Boom' })

      await expect(service.getDowntime('dt-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('cancelDowntime', () => {
    it('sends delete and returns a canceled envelope', async () => {
      mock.onDelete(`${ BASE }/api/v2/downtime/dt-1`).reply(undefined)

      const result = await service.cancelDowntime('dt-1')

      expect(result).toEqual({ canceled: true, downtimeId: 'dt-1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v2/downtime/dt-1`).replyWithError({ message: 'Boom' })

      await expect(service.cancelDowntime('dt-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Incidents ──

  describe('createIncident', () => {
    it('sends required params only with customer_impacted false', async () => {
      mock.onPost(`${ BASE }/api/v2/incidents`).reply({ data: {} })

      await service.createIncident('Checkout latency')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'incidents',
          attributes: { title: 'Checkout latency', customer_impacted: false },
        },
      })
    })

    it('includes scope and severity when customer impacted', async () => {
      mock.onPost(`${ BASE }/api/v2/incidents`).reply({ data: {} })

      await service.createIncident('Checkout latency', true, 'EU checkout down', 'SEV-2')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'incidents',
          attributes: {
            title: 'Checkout latency',
            customer_impacted: true,
            customer_impact_scope: 'EU checkout down',
            fields: { severity: { type: 'dropdown', value: 'SEV-2' } },
          },
        },
      })
    })

    it('omits impact scope when not customer impacted', async () => {
      mock.onPost(`${ BASE }/api/v2/incidents`).reply({ data: {} })

      await service.createIncident('Title', false, 'ignored scope')

      expect(mock.history[0].body.data.attributes).toEqual({ title: 'Title', customer_impacted: false })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/incidents`).replyWithError({ message: 'Boom' })

      await expect(service.createIncident('t')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listIncidents', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v2/incidents`).reply({ data: [] })

      await service.listIncidents()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps page size and offset', async () => {
      mock.onGet(`${ BASE }/api/v2/incidents`).reply({ data: [] })

      await service.listIncidents(10, 20)

      expect(mock.history[0].query).toEqual({ 'page[size]': 10, 'page[offset]': 20 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/incidents`).replyWithError({ message: 'Boom' })

      await expect(service.listIncidents()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getIncident', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v2/incidents/inc-1`).reply({ data: {} })

      await service.getIncident('inc-1')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v2/incidents/inc-1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/incidents/inc-1`).replyWithError({ message: 'Boom' })

      await expect(service.getIncident('inc-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('updateIncident', () => {
    it('sends only the id-carrying envelope when nothing changes', async () => {
      mock.onPatch(`${ BASE }/api/v2/incidents/inc-1`).reply({ data: {} })

      await service.updateIncident('inc-1')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({
        data: { type: 'incidents', id: 'inc-1', attributes: {} },
      })
    })

    it('maps state, severity, and impact fields', async () => {
      mock.onPatch(`${ BASE }/api/v2/incidents/inc-1`).reply({ data: {} })

      await service.updateIncident('inc-1', 'New title', 'Resolved', 'SEV-2', true, 'scope')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'incidents',
          id: 'inc-1',
          attributes: {
            title: 'New title',
            customer_impacted: true,
            customer_impact_scope: 'scope',
            fields: {
              state: { type: 'dropdown', value: 'resolved' },
              severity: { type: 'dropdown', value: 'SEV-2' },
            },
          },
        },
      })
    })

    it('throws on API error', async () => {
      mock.onPatch(`${ BASE }/api/v2/incidents/inc-1`).replyWithError({ message: 'Boom' })

      await expect(service.updateIncident('inc-1', 't')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('deleteIncident', () => {
    it('sends delete and returns a deleted envelope', async () => {
      mock.onDelete(`${ BASE }/api/v2/incidents/inc-1`).reply(undefined)

      const result = await service.deleteIncident('inc-1')

      expect(result).toEqual({ deleted: true, incidentId: 'inc-1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v2/incidents/inc-1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteIncident('inc-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Dashboards ──

  describe('createDashboard', () => {
    it('sends required params only with an empty widgets fallback', async () => {
      mock.onPost(`${ BASE }/api/v1/dashboard`).reply({ id: 'd1' })

      await service.createDashboard('Overview', 'Ordered', undefined)

      expect(mock.history[0].body).toEqual({
        title: 'Overview',
        layout_type: 'ordered',
        widgets: [],
      })
    })

    it('maps layout type and passes widgets and description', async () => {
      mock.onPost(`${ BASE }/api/v1/dashboard`).reply({ id: 'd2' })

      const widgets = [{ definition: { type: 'timeseries', requests: [{ q: 'avg:system.cpu.user{*}' }] } }]
      await service.createDashboard('Free board', 'Free', widgets, 'desc')

      expect(mock.history[0].body).toEqual({
        title: 'Free board',
        layout_type: 'free',
        widgets,
        description: 'desc',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/dashboard`).replyWithError({ message: 'Boom' })

      await expect(service.createDashboard('t', 'Ordered', [])).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listDashboards', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({ dashboards: [] })

      await service.listDashboards()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps filter and pagination params', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({ dashboards: [] })

      await service.listDashboards(true, false, 50, 10)

      expect(mock.history[0].query).toEqual({
        'filter[shared]': true,
        'filter[deleted]': false,
        count: 50,
        start: 10,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).replyWithError({ message: 'Boom' })

      await expect(service.listDashboards()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getDashboard', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard/abc-def-ghi`).reply({ id: 'abc-def-ghi' })

      await service.getDashboard('abc-def-ghi')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/dashboard/abc-def-ghi`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard/d1`).replyWithError({ message: 'Boom' })

      await expect(service.getDashboard('d1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('deleteDashboard', () => {
    it('sends delete', async () => {
      mock.onDelete(`${ BASE }/api/v1/dashboard/d1`).reply({ deleted_dashboard_id: 'd1' })

      const result = await service.deleteDashboard('d1')

      expect(result).toEqual({ deleted_dashboard_id: 'd1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v1/dashboard/d1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteDashboard('d1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── SLOs ──

  describe('createSlo', () => {
    it('creates a metric SLO with a query and no monitor ids', async () => {
      mock.onPost(`${ BASE }/api/v1/slo`).reply({ data: [] })

      await service.createSlo(
        'API availability', 'Metric', '30 Days', 99.9, 99.95,
        'sum:requests.success{*}.as_count()', 'sum:requests.total{*}.as_count()'
      )

      expect(mock.history[0].body).toEqual({
        name: 'API availability',
        type: 'metric',
        thresholds: [{ timeframe: '30d', target: 99.9, warning: 99.95 }],
        query: {
          numerator: 'sum:requests.success{*}.as_count()',
          denominator: 'sum:requests.total{*}.as_count()',
        },
      })
    })

    it('creates a monitor SLO with numeric monitor ids', async () => {
      mock.onPost(`${ BASE }/api/v1/slo`).reply({ data: [] })

      await service.createSlo(
        'Uptime', 'Monitor', '7 Days', 99, undefined, undefined, undefined, ['12345678'], 'desc', ['team:payments']
      )

      expect(mock.history[0].body).toEqual({
        name: 'Uptime',
        type: 'monitor',
        thresholds: [{ timeframe: '7d', target: 99 }],
        monitor_ids: [12345678],
        description: 'desc',
        tags: ['team:payments'],
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/slo`).replyWithError({ message: 'Boom' })

      await expect(service.createSlo('n', 'Metric', '30 Days', 99)).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('listSlos', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).reply({ data: [] })

      await service.listSlos()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps all optional params', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).reply({ data: [] })

      await service.listSlos('id1,id2', 'API', 'team:payments', 'requests.total', 100, 20)

      expect(mock.history[0].query).toEqual({
        ids: 'id1,id2',
        query: 'API',
        tags_query: 'team:payments',
        metrics_query: 'requests.total',
        limit: 100,
        offset: 20,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).replyWithError({ message: 'Boom' })

      await expect(service.listSlos()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getSlo', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1`).reply({ data: {} })

      await service.getSlo('slo-1')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/slo/slo-1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the configured alert ids flag', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1`).reply({ data: {} })

      await service.getSlo('slo-1', true)

      expect(mock.history[0].query).toEqual({ with_configured_alert_ids: true })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1`).replyWithError({ message: 'Boom' })

      await expect(service.getSlo('slo-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('updateSlo', () => {
    it('fetches the existing SLO then merges changes (metric type)', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1`).reply({
        data: {
          name: 'Old name',
          type: 'metric',
          description: 'old desc',
          tags: ['team:old'],
          thresholds: [{ timeframe: '30d', target: 99, warning: 99.5 }],
          query: { numerator: 'old_num', denominator: 'old_den' },
        },
      })
      mock.onPut(`${ BASE }/api/v1/slo/slo-1`).reply({ data: [] })

      await service.updateSlo('slo-1', 'New name', undefined, 99.9)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].body).toEqual({
        name: 'New name',
        type: 'metric',
        description: 'old desc',
        tags: ['team:old'],
        thresholds: [{ timeframe: '30d', target: 99.9, warning: 99.5 }],
        query: { numerator: 'old_num', denominator: 'old_den' },
      })
    })

    it('preserves monitor ids for monitor-type SLOs when unchanged', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-2`).reply({
        data: {
          name: 'Uptime',
          type: 'monitor',
          thresholds: [{ timeframe: '7d', target: 99 }],
          monitor_ids: [111],
        },
      })
      mock.onPut(`${ BASE }/api/v1/slo/slo-2`).reply({ data: [] })

      await service.updateSlo('slo-2', undefined, undefined, undefined, undefined, undefined, undefined, ['222', '333'])

      expect(mock.history[1].body.monitor_ids).toEqual([222, 333])
      expect(mock.history[1].body.type).toBe('monitor')
      expect(mock.history[1].body.query).toBeUndefined()
    })

    it('throws on API error while fetching the existing SLO', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1`).replyWithError({ message: 'Boom' })

      await expect(service.updateSlo('slo-1', 'n')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('deleteSlo', () => {
    it('sends delete', async () => {
      mock.onDelete(`${ BASE }/api/v1/slo/slo-1`).reply({ data: ['slo-1'] })

      const result = await service.deleteSlo('slo-1')

      expect(result).toEqual({ data: ['slo-1'] })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v1/slo/slo-1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteSlo('slo-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getSloHistory', () => {
    it('sends required params only', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1/history`).reply({ data: {} })

      await service.getSloHistory('slo-1', 1752096400, 1752700000)

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/slo/slo-1/history`)
      expect(mock.history[0].query).toEqual({ from_ts: 1752096400, to_ts: 1752700000 })
    })

    it('passes the apply correction flag', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1/history`).reply({ data: {} })

      await service.getSloHistory('slo-1', 1, 2, true)

      expect(mock.history[0].query).toEqual({ from_ts: 1, to_ts: 2, apply_correction: true })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/slo/slo-1/history`).replyWithError({ message: 'Boom' })

      await expect(service.getSloHistory('slo-1', 1, 2)).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Hosts ──

  describe('listHosts', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/hosts`).reply({ host_list: [] })

      await service.listHosts()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps all optional params and sort direction', async () => {
      mock.onGet(`${ BASE }/api/v1/hosts`).reply({ host_list: [] })

      await service.listHosts('env:prod', 'status', 'Descending', 0, 100, true, false)

      expect(mock.history[0].query).toEqual({
        filter: 'env:prod',
        sort_field: 'status',
        sort_dir: 'desc',
        start: 0,
        count: 100,
        include_muted_hosts_data: true,
        include_hosts_metadata: false,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/hosts`).replyWithError({ message: 'Boom' })

      await expect(service.listHosts()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getHostTotals', () => {
    it('fetches host totals', async () => {
      mock.onGet(`${ BASE }/api/v1/hosts/totals`).reply({ total_active: 42, total_up: 40 })

      const result = await service.getHostTotals()

      expect(result).toEqual({ total_active: 42, total_up: 40 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/hosts/totals`).replyWithError({ message: 'Boom' })

      await expect(service.getHostTotals()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('muteHost', () => {
    it('sends an empty body when only host name is given', async () => {
      mock.onPost(`${ BASE }/api/v1/host/web-01/mute`).reply({ action: 'Muted' })

      await service.muteHost('web-01')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/host/web-01/mute`)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes message, end, and override', async () => {
      mock.onPost(`${ BASE }/api/v1/host/web-01/mute`).reply({ action: 'Muted' })

      await service.muteHost('web-01', 'Maintenance', 1752710000, true)

      expect(mock.history[0].body).toEqual({ message: 'Maintenance', end: 1752710000, override: true })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/host/web-01/mute`).replyWithError({ message: 'Boom' })

      await expect(service.muteHost('web-01')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('unmuteHost', () => {
    it('sends an empty body', async () => {
      mock.onPost(`${ BASE }/api/v1/host/web-01/unmute`).reply({ action: 'Unmuted' })

      await service.unmuteHost('web-01')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/host/web-01/unmute`)
      expect(mock.history[0].body).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/host/web-01/unmute`).replyWithError({ message: 'Boom' })

      await expect(service.unmuteHost('web-01')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Host Tags ──

  describe('listAllHostTags', () => {
    it('sends no query params when no source', async () => {
      mock.onGet(`${ BASE }/api/v1/tags/hosts`).reply({ tags: {} })

      await service.listAllHostTags()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes the source', async () => {
      mock.onGet(`${ BASE }/api/v1/tags/hosts`).reply({ tags: {} })

      await service.listAllHostTags('user')

      expect(mock.history[0].query).toEqual({ source: 'user' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/tags/hosts`).replyWithError({ message: 'Boom' })

      await expect(service.listAllHostTags()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getHostTags', () => {
    it('fetches tags for a host', async () => {
      mock.onGet(`${ BASE }/api/v1/tags/hosts/web-01`).reply({ tags: ['env:prod'] })

      await service.getHostTags('web-01', 'user')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/tags/hosts/web-01`)
      expect(mock.history[0].query).toEqual({ source: 'user' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/tags/hosts/web-01`).replyWithError({ message: 'Boom' })

      await expect(service.getHostTags('web-01')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('addHostTags', () => {
    it('posts tags in the body with an optional source query', async () => {
      mock.onPost(`${ BASE }/api/v1/tags/hosts/web-01`).reply({ host: 'web-01', tags: ['env:prod'] })

      await service.addHostTags('web-01', ['env:prod', 'role:web'], 'user')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ tags: ['env:prod', 'role:web'] })
      expect(mock.history[0].query).toEqual({ source: 'user' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/tags/hosts/web-01`).replyWithError({ message: 'Boom' })

      await expect(service.addHostTags('web-01', ['x'])).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('updateHostTags', () => {
    it('puts the replacement tag set', async () => {
      mock.onPut(`${ BASE }/api/v1/tags/hosts/web-01`).reply({ host: 'web-01', tags: ['env:prod'] })

      await service.updateHostTags('web-01', ['env:prod'])

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ tags: ['env:prod'] })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/api/v1/tags/hosts/web-01`).replyWithError({ message: 'Boom' })

      await expect(service.updateHostTags('web-01', ['x'])).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('removeHostTags', () => {
    it('sends delete and returns a removed envelope', async () => {
      mock.onDelete(`${ BASE }/api/v1/tags/hosts/web-01`).reply(undefined)

      const result = await service.removeHostTags('web-01', 'user')

      expect(result).toEqual({ removed: true, host: 'web-01' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ source: 'user' })
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v1/tags/hosts/web-01`).replyWithError({ message: 'Boom' })

      await expect(service.removeHostTags('web-01')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v2/users`).reply({ data: [] })

      await service.listUsers()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps filter, status, sort, and pagination', async () => {
      mock.onGet(`${ BASE }/api/v2/users`).reply({ data: [] })

      await service.listUsers('jane', 'Active', '-modified_at', 25, 1)

      expect(mock.history[0].query).toEqual({
        filter: 'jane',
        'filter[status]': 'Active',
        sort: '-modified_at',
        'page[size]': 25,
        'page[number]': 1,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/users`).replyWithError({ message: 'Boom' })

      await expect(service.listUsers()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getUser', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v2/users/user-1`).reply({ data: {} })

      await service.getUser('user-1')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v2/users/user-1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v2/users/user-1`).replyWithError({ message: 'Boom' })

      await expect(service.getUser('user-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('createUser', () => {
    it('creates a user and sends an invitation by default', async () => {
      mock.onPost(`${ BASE }/api/v2/users`).reply({ data: { id: 'user-2', type: 'users' } })
      mock.onPost(`${ BASE }/api/v2/user_invitations`).reply({ data: [{ id: 'inv-1', type: 'user_invitations' }] })

      const result = await service.createUser('john@example.com', 'John Smith', 'Engineer')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body).toEqual({
        data: { type: 'users', attributes: { email: 'john@example.com', name: 'John Smith', title: 'Engineer' } },
      })
      expect(mock.history[1].url).toBe(`${ BASE }/api/v2/user_invitations`)
      expect(mock.history[1].body).toEqual({
        data: [{
          type: 'user_invitations',
          relationships: { user: { data: { type: 'users', id: 'user-2' } } },
        }],
      })
      expect(result).toEqual({
        user: { id: 'user-2', type: 'users' },
        invitation: { id: 'inv-1', type: 'user_invitations' },
      })
    })

    it('skips the invitation when sendInvitation is false', async () => {
      mock.onPost(`${ BASE }/api/v2/users`).reply({ data: { id: 'user-3', type: 'users' } })

      const result = await service.createUser('nobody@example.com', undefined, undefined, false)

      expect(mock.history).toHaveLength(1)
      expect(result).toEqual({ user: { id: 'user-3', type: 'users' }, invitation: null })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v2/users`).replyWithError({ message: 'Boom' })

      await expect(service.createUser('x@example.com')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('disableUser', () => {
    it('sends delete and returns a disabled envelope', async () => {
      mock.onDelete(`${ BASE }/api/v2/users/user-1`).reply(undefined)

      const result = await service.disableUser('user-1')

      expect(result).toEqual({ disabled: true, userId: 'user-1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/api/v2/users/user-1`).replyWithError({ message: 'Boom' })

      await expect(service.disableUser('user-1')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Synthetics ──

  describe('listSyntheticsTests', () => {
    it('fetches all tests', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests`).reply({ tests: [] })

      const result = await service.listSyntheticsTests()

      expect(result).toEqual({ tests: [] })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests`).replyWithError({ message: 'Boom' })

      await expect(service.listSyntheticsTests()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getSyntheticsTest', () => {
    it('fetches a test by public id', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests/abc-123-def`).reply({ public_id: 'abc-123-def' })

      await service.getSyntheticsTest('abc-123-def')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/synthetics/tests/abc-123-def`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests/x`).replyWithError({ message: 'Boom' })

      await expect(service.getSyntheticsTest('x')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('triggerSyntheticsCiTests', () => {
    it('maps public ids into the tests array', async () => {
      mock.onPost(`${ BASE }/api/v1/synthetics/tests/trigger/ci`).reply({ batch_id: 'b1' })

      await service.triggerSyntheticsCiTests(['abc-123-def', 'xyz-789'])

      expect(mock.history[0].body).toEqual({
        tests: [{ public_id: 'abc-123-def' }, { public_id: 'xyz-789' }],
      })
    })

    it('handles an undefined ids list', async () => {
      mock.onPost(`${ BASE }/api/v1/synthetics/tests/trigger/ci`).reply({ batch_id: 'b2' })

      await service.triggerSyntheticsCiTests()

      expect(mock.history[0].body).toEqual({ tests: [] })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/synthetics/tests/trigger/ci`).replyWithError({ message: 'Boom' })

      await expect(service.triggerSyntheticsCiTests(['x'])).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getSyntheticsTestResults', () => {
    it('routes to the API results endpoint by default', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests/abc-123-def/results`).reply({ results: [] })

      await service.getSyntheticsTestResults('abc-123-def')

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/synthetics/tests/abc-123-def/results`)
      expect(mock.history[0].query).toEqual({})
    })

    it('routes to the browser results endpoint and maps params', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests/browser/abc-123-def/results`).reply({ results: [] })

      await service.getSyntheticsTestResults('abc-123-def', 'Browser Test', 1000, 2000, ['aws:us-east-1'])

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/synthetics/tests/browser/abc-123-def/results`)
      expect(mock.history[0].query).toEqual({
        from_ts: 1000,
        to_ts: 2000,
        probe_dc: ['aws:us-east-1'],
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/synthetics/tests/x/results`).replyWithError({ message: 'Boom' })

      await expect(service.getSyntheticsTestResults('x')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Service Checks ──

  describe('submitServiceCheck', () => {
    it('sends required params only with mapped status', async () => {
      mock.onPost(`${ BASE }/api/v1/check_run`).reply({ status: 'ok' })

      await service.submitServiceCheck('app.is_ok', 'web-01', 'OK')

      expect(mock.history[0].body).toEqual({
        check: 'app.is_ok',
        host_name: 'web-01',
        status: 0,
      })
    })

    it('includes message and tags with a Critical status', async () => {
      mock.onPost(`${ BASE }/api/v1/check_run`).reply({ status: 'ok' })

      await service.submitServiceCheck('app.is_ok', 'web-01', 'Critical', 'down', ['env:prod'])

      expect(mock.history[0].body).toEqual({
        check: 'app.is_ok',
        host_name: 'web-01',
        status: 2,
        message: 'down',
        tags: ['env:prod'],
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/api/v1/check_run`).replyWithError({ message: 'Boom' })

      await expect(service.submitServiceCheck('c', 'h', 'OK')).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Notebooks ──

  describe('listNotebooks', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/api/v1/notebooks`).reply({ data: [] })

      await service.listNotebooks()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps query, sort field/dir, and pagination', async () => {
      mock.onGet(`${ BASE }/api/v1/notebooks`).reply({ data: [] })

      await service.listNotebooks('incident', 'Name', 'Ascending', 20, 0)

      expect(mock.history[0].query).toEqual({
        query: 'incident',
        sort_field: 'name',
        sort_dir: 'asc',
        count: 20,
        start: 0,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/notebooks`).replyWithError({ message: 'Boom' })

      await expect(service.listNotebooks()).rejects.toThrow('Datadog API error: Boom')
    })
  })

  describe('getNotebook', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/api/v1/notebooks/123456`).reply({ data: {} })

      await service.getNotebook(123456)

      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/notebooks/123456`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/notebooks/1`).replyWithError({ message: 'Boom' })

      await expect(service.getNotebook(1)).rejects.toThrow('Datadog API error: Boom')
    })
  })

  // ── Account ──

  describe('validateApiKey', () => {
    it('validates the key', async () => {
      mock.onGet(`${ BASE }/api/v1/validate`).reply({ valid: true })

      const result = await service.validateApiKey()

      expect(result).toEqual({ valid: true })
      expect(mock.history[0].url).toBe(`${ BASE }/api/v1/validate`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/api/v1/validate`).replyWithError({ message: 'Forbidden' })

      await expect(service.validateApiKey()).rejects.toThrow('Datadog API error: Forbidden')
    })
  })

  // ── Dictionaries ──

  describe('getMonitorsDictionary', () => {
    it('maps monitors to items and requests the first page', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply([
        { id: 12345678, name: 'High CPU', type: 'metric alert' },
        { id: 87654321, name: 'Errors', type: 'log alert' },
      ])

      const result = await service.getMonitorsDictionary({})

      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 50 })
      expect(result.items).toEqual([
        { label: 'High CPU', value: '12345678', note: 'metric alert' },
        { label: 'Errors', value: '87654321', note: 'log alert' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes the search term as the name filter', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply([])

      await service.getMonitorsDictionary({ search: 'cpu' })

      expect(mock.history[0].query).toMatchObject({ name: 'cpu' })
    })

    it('uses the cursor as the page number and returns the next cursor when full', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply(
        Array.from({ length: 50 }, (_, i) => ({ id: i, name: `m${ i }`, type: 'metric alert' }))
      )

      const result = await service.getMonitorsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
      expect(result.cursor).toBe('3')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/api/v1/monitor`).reply([])

      const result = await service.getMonitorsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getDashboardsDictionary', () => {
    it('maps dashboards to items and requests a page', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({
        dashboards: [
          { id: 'abc-def-ghi', title: 'Service Overview', layout_type: 'ordered' },
          { id: 'jkl-mno-pqr', title: 'DB Health', layout_type: 'free' },
        ],
      })

      const result = await service.getDashboardsDictionary({})

      expect(mock.history[0].query).toMatchObject({ start: 0, count: 100 })
      expect(result.items).toEqual([
        { label: 'Service Overview', value: 'abc-def-ghi', note: 'ordered' },
        { label: 'DB Health', value: 'jkl-mno-pqr', note: 'free' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term over title', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({
        dashboards: [
          { id: 'd1', title: 'Service Overview', layout_type: 'ordered' },
          { id: 'd2', title: 'DB Health', layout_type: 'free' },
        ],
      })

      const result = await service.getDashboardsDictionary({ search: 'health' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('d2')
    })

    it('uses the cursor as offset and returns the next cursor when full', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({
        dashboards: Array.from({ length: 100 }, (_, i) => ({ id: `d${ i }`, title: `Dash ${ i }`, layout_type: 'ordered' })),
      })

      const result = await service.getDashboardsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ start: 100 })
      expect(result.cursor).toBe('200')
    })

    it('handles a missing dashboards array', async () => {
      mock.onGet(`${ BASE }/api/v1/dashboard`).reply({})

      const result = await service.getDashboardsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getSlosDictionary', () => {
    it('maps SLOs to items and passes search as query', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).reply({
        data: [
          { id: 'slo-1', name: 'API availability', type: 'metric' },
          { id: 'slo-2', name: 'Uptime', type: 'monitor' },
        ],
      })

      const result = await service.getSlosDictionary({ search: 'api' })

      expect(mock.history[0].query).toMatchObject({ query: 'api', limit: 50, offset: 0 })
      expect(result.items).toEqual([
        { label: 'API availability', value: 'slo-1', note: 'metric' },
        { label: 'Uptime', value: 'slo-2', note: 'monitor' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('uses the cursor as offset and returns the next cursor when full', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).reply({
        data: Array.from({ length: 50 }, (_, i) => ({ id: `slo-${ i }`, name: `SLO ${ i }`, type: 'metric' })),
      })

      const result = await service.getSlosDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ offset: 50 })
      expect(result.cursor).toBe('100')
    })

    it('handles a missing data array', async () => {
      mock.onGet(`${ BASE }/api/v1/slo`).reply({})

      const result = await service.getSlosDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })
})

// ── Site / region base URL branching ──
//
// Each case needs a fresh service instance built with a different `site` config,
// so the service module is (re)required in an isolated module registry. This suite
// is kept separate from the main one so its sandbox swaps don't clobber it.

describe('Datadog Service — site-scoped base URL', () => {
  function withSite(config) {
    let sandbox
    let svc
    let mk

    jest.isolateModules(() => {
      sandbox = createSandbox(config)
      require('../src/index.js')
      svc = sandbox.getService()
      mk = sandbox.getRequestMock()
    })

    return { sandbox, service: svc, mock: mk }
  }

  it('defaults to datadoghq.com when no site is configured', async () => {
    const { sandbox, service, mock } = withSite({ apiKey: 'k', appKey: 'a' })

    mock.onGet('https://api.datadoghq.com/api/v1/validate').reply({ valid: true })
    await service.validateApiKey()

    expect(mock.history[0].url).toBe('https://api.datadoghq.com/api/v1/validate')
    expect(mock.history[0].headers).toMatchObject({ 'DD-API-KEY': 'k', 'DD-APPLICATION-KEY': 'a' })
    sandbox.cleanup()
  })

  it('routes the API host and logs intake host to the EU site', async () => {
    const { sandbox, service, mock } = withSite({ apiKey: 'k', appKey: 'a', site: 'datadoghq.eu' })

    mock.onGet('https://api.datadoghq.eu/api/v1/validate').reply({ valid: true })
    await service.validateApiKey()
    expect(mock.history[0].url).toBe('https://api.datadoghq.eu/api/v1/validate')

    mock.onPost('https://http-intake.logs.datadoghq.eu/api/v2/logs').reply({})
    await service.sendLog('eu log')
    expect(mock.history[1].url).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')

    sandbox.cleanup()
  })

  it('routes to a US regional site (us5.datadoghq.com)', async () => {
    const { sandbox, service, mock } = withSite({ apiKey: 'k', appKey: 'a', site: 'us5.datadoghq.com' })

    mock.onGet('https://api.us5.datadoghq.com/api/v1/validate').reply({ valid: true })
    await service.validateApiKey()

    expect(mock.history[0].url).toBe('https://api.us5.datadoghq.com/api/v1/validate')
    sandbox.cleanup()
  })
})
