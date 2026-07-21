'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Grafana Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('grafana')
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

  // ── Health / Org / Users ──

  describe('healthCheck', () => {
    it('returns health status with a database field', async () => {
      const response = await service.healthCheck()

      expect(response).toHaveProperty('database')
    })
  })

  describe('getOrg', () => {
    it('returns the current organization', async () => {
      const response = await service.getOrg()

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name')
    })
  })

  describe('listOrgUsers', () => {
    it('returns an array of org users', async () => {
      const response = await service.listOrgUsers()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getCurrentUser', () => {
    it('returns the authenticated identity', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('id')
    })
  })

  // ── Dashboards ──

  describe('searchDashboards', () => {
    it('returns an array of dashboards', async () => {
      const response = await service.searchDashboards(undefined, 'Dashboards', undefined, 10)

      expect(Array.isArray(response)).toBe(true)
    })

    it('returns an array of folders', async () => {
      const response = await service.searchDashboards(undefined, 'Folders', undefined, 10)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getHomeDashboard', () => {
    it('returns the home dashboard with a dashboard model', async () => {
      const response = await service.getHomeDashboard()

      expect(response).toHaveProperty('dashboard')
    })
  })

  describe('createOrUpdateDashboard + getDashboardByUid + deleteDashboard', () => {
    let uid

    it('creates a dashboard', async () => {
      const response = await service.createOrUpdateDashboard(
        {
          uid: null,
          title: `E2E Dashboard ${ suffix }`,
          tags: ['e2e'],
          schemaVersion: 39,
          panels: [],
        },
        undefined,
        true,
        'created by e2e test'
      )

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('status', 'success')
      uid = response.uid
    })

    it('retrieves the created dashboard', async () => {
      const response = await service.getDashboardByUid(uid)

      expect(response).toHaveProperty('dashboard')
      expect(response.dashboard).toHaveProperty('uid', uid)
    })

    it('deletes the created dashboard', async () => {
      const response = await service.deleteDashboard(uid)

      expect(response).toHaveProperty('title')
    })
  })

  // ── Folders ──

  describe('listFolders', () => {
    it('returns an array of folders', async () => {
      const response = await service.listFolders(10)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createFolder + getFolder + deleteFolder', () => {
    let uid

    it('creates a folder', async () => {
      const response = await service.createFolder(`E2E Folder ${ suffix }`)

      expect(response).toHaveProperty('uid')
      expect(response).toHaveProperty('title')
      uid = response.uid
    })

    it('retrieves the created folder', async () => {
      const response = await service.getFolder(uid)

      expect(response).toHaveProperty('uid', uid)
    })

    it('deletes the created folder', async () => {
      const response = await service.deleteFolder(uid)

      expect(response).toHaveProperty('message')
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFoldersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Data Sources ──

  describe('listDataSources', () => {
    it('returns an array of data sources', async () => {
      const response = await service.listDataSources()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getDataSourcesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDataSourcesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDataSource', () => {
    // Needs a real data source UID. Runs only when a data source already exists.
    it('retrieves a data source by uid when one exists', async () => {
      const sources = await service.listDataSources()

      if (!Array.isArray(sources) || sources.length === 0) {
        console.log('Skipping getDataSource: no data sources configured in this Grafana instance')
        return
      }

      const response = await service.getDataSource(sources[0].uid)

      expect(response).toHaveProperty('uid', sources[0].uid)
    })
  })

  describe('queryDataSource', () => {
    // Querying needs a real datasource uid and a valid model, so this only runs
    // when the developer supplies testValues.queryDatasourceUid and queryExpr.
    const canQuery = () => Boolean(testValues.queryDatasourceUid && testValues.queryExpr)

    it('runs a query against a configured data source', async () => {
      if (!canQuery()) {
        console.log('Skipping queryDataSource: set testValues.queryDatasourceUid and testValues.queryExpr')
        return
      }

      const response = await service.queryDataSource(
        [
          {
            refId: 'A',
            datasource: { uid: testValues.queryDatasourceUid },
            expr: testValues.queryExpr,
          },
        ],
        'now-1h',
        'now'
      )

      expect(response).toHaveProperty('results')
    })
  })

  // ── Annotations ──

  describe('createAnnotation + listAnnotations + deleteAnnotation', () => {
    let annotationId

    it('creates a global annotation', async () => {
      const response = await service.createAnnotation(
        `E2E annotation ${ suffix }`,
        Date.now(),
        undefined,
        undefined,
        undefined,
        ['e2e']
      )

      expect(response).toHaveProperty('id')
      annotationId = response.id
    })

    it('lists annotations filtered by tag', async () => {
      const response = await service.listAnnotations(undefined, undefined, ['e2e'], undefined, 50)

      expect(Array.isArray(response)).toBe(true)
    })

    it('deletes the created annotation', async () => {
      const response = await service.deleteAnnotation(annotationId)

      expect(response).toHaveProperty('message')
    })
  })

  // ── Alerting ──

  describe('listAlertRules', () => {
    it('returns an array of alert rules', async () => {
      const response = await service.listAlertRules()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getAlertRule', () => {
    // Needs a real alert rule UID. Runs only when a rule already exists.
    it('retrieves an alert rule by uid when one exists', async () => {
      const rules = await service.listAlertRules()

      if (!Array.isArray(rules) || rules.length === 0) {
        console.log('Skipping getAlertRule: no alert rules configured in this Grafana instance')
        return
      }

      const response = await service.getAlertRule(rules[0].uid)

      expect(response).toHaveProperty('uid', rules[0].uid)
    })
  })

  describe('listContactPoints', () => {
    it('returns an array of contact points', async () => {
      const response = await service.listContactPoints()

      expect(Array.isArray(response)).toBe(true)
    })
  })
})
