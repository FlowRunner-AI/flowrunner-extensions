'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Datadog Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('datadog')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()
  const nowSec = Math.floor(Date.now() / 1000)

  // ── Account ──

  describe('validateApiKey', () => {
    it('confirms the configured API key is valid', async () => {
      const response = await service.validateApiKey()

      expect(response).toHaveProperty('valid', true)
    })
  })

  // ── Events ──

  describe('postEvent + listEvents + searchEvents', () => {
    it('posts a custom event', async () => {
      const response = await service.postEvent(
        `E2E event ${ suffix }`,
        'Automated e2e test event',
        'Info',
        undefined,
        ['env:test', 'source:flowrunner-e2e']
      )

      expect(response).toHaveProperty('status')
    })

    it('lists events in the recent window', async () => {
      const response = await service.listEvents(nowSec - 3600, nowSec)

      expect(response).toHaveProperty('events')
      expect(Array.isArray(response.events)).toBe(true)
    })

    it('searches events with the v2 syntax', async () => {
      const response = await service.searchEvents('*', 'now-1h', 'now', undefined, 10)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  // ── Metrics ──

  describe('submitMetric + queryTimeseries + listMetrics', () => {
    it('submits a custom metric data point', async () => {
      const response = await service.submitMetric(
        'flowrunner.e2e.test',
        1,
        'Count',
        nowSec,
        ['env:test']
      )

      expect(response).toHaveProperty('errors')
    })

    it('queries a timeseries for a common metric', async () => {
      const response = await service.queryTimeseries('avg:system.cpu.user{*}', nowSec - 3600, nowSec)

      expect(response).toHaveProperty('status')
      expect(response).toHaveProperty('series')
    })

    it('lists metrics', async () => {
      const response = await service.listMetrics()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('getMetricMetadata', () => {
    it('returns metadata for a metric when one is supplied', async () => {
      // A submitted custom metric may take time to be queryable, so this uses a
      // developer-supplied metric name or falls back to a common system metric.
      const metricName = testValues.metricName || 'system.cpu.user'

      const response = await service.getMetricMetadata(metricName)

      expect(response).toHaveProperty('type')
    })
  })

  // ── Logs ──

  describe('sendLog + searchLogs', () => {
    it('sends a log entry to the intake', async () => {
      const response = await service.sendLog(
        `E2E log ${ suffix }`,
        'flowrunner-e2e',
        'flowrunner-tests',
        'e2e-host',
        ['env:test'],
        { test_run: suffix }
      )

      // The logs intake returns an empty object / 202 on success.
      expect(response).toBeDefined()
    })

    it('searches logs with the v2 syntax', async () => {
      const response = await service.searchLogs('*', 'now-15m', 'now', undefined, 'Newest First', 10)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  // ── Monitors ──

  describe('createMonitor + getMonitor + updateMonitor + muteMonitor + unmuteMonitor + deleteMonitor', () => {
    let monitorId

    it('creates a monitor', async () => {
      const response = await service.createMonitor(
        `E2E Monitor ${ suffix }`,
        'Metric Alert',
        'avg(last_5m):avg:system.cpu.user{*} > 99',
        'E2E test monitor',
        ['env:test'],
        5
      )

      expect(response).toHaveProperty('id')
      monitorId = response.id
    })

    it('retrieves the created monitor', async () => {
      const response = await service.getMonitor(String(monitorId))

      expect(response).toHaveProperty('id', monitorId)
    })

    it('updates the monitor', async () => {
      const response = await service.updateMonitor(String(monitorId), `E2E Monitor Updated ${ suffix }`)

      expect(response).toHaveProperty('id', monitorId)
    })

    it('mutes then unmutes the monitor', async () => {
      const muted = await service.muteMonitor(String(monitorId))
      expect(muted).toHaveProperty('id', monitorId)

      const unmuted = await service.unmuteMonitor(String(monitorId), undefined, true)
      expect(unmuted).toHaveProperty('id', monitorId)
    })

    it('deletes the monitor', async () => {
      const response = await service.deleteMonitor(String(monitorId))

      expect(response).toHaveProperty('deleted_monitor_id')
    })

    afterAll(async () => {
      if (monitorId) {
        try {
          await service.deleteMonitor(String(monitorId))
        } catch (e) {
          // ignore cleanup errors (already deleted)
        }
      }
    })
  })

  describe('listMonitors + searchMonitors', () => {
    it('lists monitors with pagination', async () => {
      const response = await service.listMonitors(undefined, undefined, undefined, undefined, 0, 5)

      expect(Array.isArray(response)).toBe(true)
    })

    it('searches monitors', async () => {
      const response = await service.searchMonitors('', 0, 5)

      expect(response).toHaveProperty('monitors')
      expect(Array.isArray(response.monitors)).toBe(true)
    })
  })

  describe('getMonitorsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getMonitorsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Downtimes ──

  describe('createDowntime + getDowntime + listDowntimes + cancelDowntime', () => {
    let downtimeId

    it('creates a downtime targeting monitor tags', async () => {
      const response = await service.createDowntime(
        'env:test',
        undefined,
        ['env:test'],
        `E2E downtime ${ suffix }`
      )

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      downtimeId = response.data.id
    })

    it('retrieves the created downtime', async () => {
      const response = await service.getDowntime(downtimeId)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', downtimeId)
    })

    it('lists downtimes', async () => {
      const response = await service.listDowntimes(false, 0, 30)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('cancels the downtime', async () => {
      const response = await service.cancelDowntime(downtimeId)

      expect(response).toEqual({ canceled: true, downtimeId })
    })

    afterAll(async () => {
      if (downtimeId) {
        try {
          await service.cancelDowntime(downtimeId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Dashboards ──

  describe('createDashboard + getDashboard + listDashboards + deleteDashboard', () => {
    let dashboardId

    it('creates a dashboard', async () => {
      const response = await service.createDashboard(
        `E2E Dashboard ${ suffix }`,
        'Ordered',
        [{ definition: { type: 'timeseries', requests: [{ q: 'avg:system.cpu.user{*}', display_type: 'line' }] } }],
        'Automated e2e test dashboard'
      )

      expect(response).toHaveProperty('id')
      dashboardId = response.id
    })

    it('retrieves the created dashboard', async () => {
      const response = await service.getDashboard(dashboardId)

      expect(response).toHaveProperty('id', dashboardId)
      expect(response).toHaveProperty('widgets')
    })

    it('lists dashboards', async () => {
      const response = await service.listDashboards(undefined, undefined, 5, 0)

      expect(response).toHaveProperty('dashboards')
      expect(Array.isArray(response.dashboards)).toBe(true)
    })

    it('deletes the dashboard', async () => {
      const response = await service.deleteDashboard(dashboardId)

      expect(response).toHaveProperty('deleted_dashboard_id')
    })

    afterAll(async () => {
      if (dashboardId) {
        try {
          await service.deleteDashboard(dashboardId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('getDashboardsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDashboardsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── SLOs ──

  describe('createSlo + getSlo + updateSlo + getSloHistory + listSlos + deleteSlo', () => {
    let sloId

    it('creates a metric SLO', async () => {
      const response = await service.createSlo(
        `E2E SLO ${ suffix }`,
        'Metric',
        '30 Days',
        99.9,
        99.95,
        'sum:flowrunner.e2e.test{*}.as_count()',
        'sum:flowrunner.e2e.test{*}.as_count()',
        undefined,
        'Automated e2e SLO',
        ['env:test']
      )

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data[0]).toHaveProperty('id')
      sloId = response.data[0].id
    })

    it('retrieves the created SLO', async () => {
      const response = await service.getSlo(sloId)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', sloId)
    })

    it('updates the SLO target', async () => {
      const response = await service.updateSlo(sloId, undefined, undefined, 99.5)

      expect(response).toHaveProperty('data')
    })

    it('reads SLO history', async () => {
      const response = await service.getSloHistory(sloId, nowSec - 3600, nowSec)

      expect(response).toHaveProperty('data')
    })

    it('lists SLOs', async () => {
      const response = await service.listSlos(undefined, undefined, undefined, undefined, 5, 0)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('deletes the SLO', async () => {
      const response = await service.deleteSlo(sloId)

      expect(response).toHaveProperty('data')
    })

    afterAll(async () => {
      if (sloId) {
        try {
          await service.deleteSlo(sloId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('getSlosDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getSlosDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Hosts ──

  describe('listHosts + getHostTotals', () => {
    it('lists hosts', async () => {
      const response = await service.listHosts(undefined, undefined, undefined, 0, 5)

      expect(response).toHaveProperty('host_list')
      expect(Array.isArray(response.host_list)).toBe(true)
    })

    it('returns host totals', async () => {
      const response = await service.getHostTotals()

      expect(response).toHaveProperty('total_active')
    })
  })

  // ── Host operations (need a real reporting host) ──

  describe('mute/unmute host and host tags', () => {
    // These require a real host name reporting to the account.
    const hostName = () => testValues.hostName

    it('mutes then unmutes a host when a host name is configured', async () => {
      if (!hostName()) {
        console.log('Skipping host mute/unmute: set testValues.hostName to a reporting host')
        return
      }

      const muted = await service.muteHost(hostName(), 'E2E mute', undefined, true)
      expect(muted).toHaveProperty('action')

      const unmuted = await service.unmuteHost(hostName())
      expect(unmuted).toHaveProperty('action')
    })

    it('adds, reads, updates, and removes host tags when a host name is configured', async () => {
      if (!hostName()) {
        console.log('Skipping host tags: set testValues.hostName to a reporting host')
        return
      }

      const added = await service.addHostTags(hostName(), ['flowrunner-e2e:test'])
      expect(added).toHaveProperty('tags')

      const read = await service.getHostTags(hostName())
      expect(read).toHaveProperty('tags')

      const updated = await service.updateHostTags(hostName(), ['flowrunner-e2e:updated'])
      expect(updated).toHaveProperty('tags')

      const removed = await service.removeHostTags(hostName())
      expect(removed).toEqual({ removed: true, host: hostName() })
    })
  })

  describe('listAllHostTags', () => {
    it('returns the org host tag mapping', async () => {
      const response = await service.listAllHostTags()

      expect(response).toHaveProperty('tags')
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('lists org users with pagination', async () => {
      const response = await service.listUsers(undefined, undefined, undefined, 5, 0)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('retrieves the first listed user by id', async () => {
      const list = await service.listUsers(undefined, undefined, undefined, 1, 0)

      if (!list.data || !list.data.length) {
        console.log('Skipping getUser: no users returned')
        return
      }

      const response = await service.getUser(list.data[0].id)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', list.data[0].id)
    })
  })

  describe('createUser + disableUser', () => {
    // Creating a real user (and emailing an invite) is a side-effect, so this only
    // runs when the developer supplies testValues.newUserEmail.
    let userId

    it('creates then disables a user when an email is configured', async () => {
      if (!testValues.newUserEmail) {
        console.log('Skipping createUser/disableUser: set testValues.newUserEmail')
        return
      }

      const created = await service.createUser(testValues.newUserEmail, 'E2E User', 'Tester', false)
      expect(created).toHaveProperty('user')
      userId = created.user && created.user.id

      if (userId) {
        const disabled = await service.disableUser(userId)
        expect(disabled).toEqual({ disabled: true, userId })
      }
    })
  })

  // ── Synthetics ──

  describe('listSyntheticsTests', () => {
    it('lists synthetic tests', async () => {
      const response = await service.listSyntheticsTests()

      expect(response).toHaveProperty('tests')
      expect(Array.isArray(response.tests)).toBe(true)
    })
  })

  describe('getSyntheticsTest + getSyntheticsTestResults + triggerSyntheticsCiTests', () => {
    // These need a real synthetic test public id.
    const publicId = () => testValues.syntheticsPublicId

    it('retrieves a synthetic test when a public id is configured', async () => {
      if (!publicId()) {
        console.log('Skipping getSyntheticsTest: set testValues.syntheticsPublicId')
        return
      }

      const response = await service.getSyntheticsTest(publicId())

      expect(response).toHaveProperty('public_id', publicId())
    })

    it('reads results for a synthetic test when a public id is configured', async () => {
      if (!publicId()) {
        console.log('Skipping getSyntheticsTestResults: set testValues.syntheticsPublicId')
        return
      }

      const response = await service.getSyntheticsTestResults(publicId(), 'API Test')

      expect(response).toHaveProperty('results')
    })

    it('triggers a synthetic test when a public id is configured', async () => {
      if (!publicId()) {
        console.log('Skipping triggerSyntheticsCiTests: set testValues.syntheticsPublicId')
        return
      }

      const response = await service.triggerSyntheticsCiTests([publicId()])

      expect(response).toHaveProperty('results')
    })
  })

  // ── Service Checks ──

  describe('submitServiceCheck', () => {
    it('submits a service check status', async () => {
      const response = await service.submitServiceCheck(
        'flowrunner.e2e.check',
        testValues.hostName || 'e2e-host',
        'OK',
        undefined,
        ['env:test']
      )

      expect(response).toHaveProperty('status')
    })
  })

  // ── Notebooks ──

  describe('listNotebooks', () => {
    it('lists notebooks with pagination', async () => {
      const response = await service.listNotebooks(undefined, undefined, undefined, 5, 0)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('retrieves the first listed notebook by id', async () => {
      const list = await service.listNotebooks(undefined, undefined, undefined, 1, 0)

      if (!list.data || !list.data.length) {
        console.log('Skipping getNotebook: no notebooks returned')
        return
      }

      const response = await service.getNotebook(list.data[0].id)

      expect(response).toHaveProperty('data')
    })
  })

  // ── Incidents (Incident Management must be enabled — preview API) ──

  describe('createIncident + getIncident + updateIncident + listIncidents + deleteIncident', () => {
    // Incident Management is a preview feature that must be enabled for the org,
    // so this only runs when the developer opts in via testValues.incidentsEnabled.
    let incidentId

    const enabled = () => Boolean(testValues.incidentsEnabled)

    it('creates an incident when Incident Management is enabled', async () => {
      if (!enabled()) {
        console.log('Skipping incidents: set testValues.incidentsEnabled to true (needs Incident Management)')
        return
      }

      const response = await service.createIncident(`E2E Incident ${ suffix }`, false)

      expect(response).toHaveProperty('data')
      incidentId = response.data && response.data.id
    })

    it('retrieves, updates, and lists incidents when enabled', async () => {
      if (!enabled() || !incidentId) {
        return
      }

      const got = await service.getIncident(incidentId)
      expect(got).toHaveProperty('data')

      const updated = await service.updateIncident(incidentId, `E2E Incident Updated ${ suffix }`, 'Resolved')
      expect(updated).toHaveProperty('data')

      const list = await service.listIncidents(5, 0)
      expect(list).toHaveProperty('data')
    })

    it('deletes the incident when enabled', async () => {
      if (!enabled() || !incidentId) {
        return
      }

      const response = await service.deleteIncident(incidentId)
      expect(response).toEqual({ deleted: true, incidentId })
    })

    afterAll(async () => {
      if (incidentId) {
        try {
          await service.deleteIncident(incidentId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })
})
