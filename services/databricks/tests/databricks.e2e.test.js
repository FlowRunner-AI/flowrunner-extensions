'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Databricks Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('databricks')
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

  // ── Account / connectivity ──

  describe('getCurrentUser', () => {
    it('returns the SCIM profile of the token owner', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('userName')
      expect(response).toHaveProperty('id')
    })
  })

  // ── SQL: Warehouses ──

  describe('listWarehouses', () => {
    it('returns warehouses with expected shape', async () => {
      const response = await service.listWarehouses()

      // The warehouses field is present when any warehouse exists; on an empty
      // workspace the API returns an object without it, so just assert it's an object.
      expect(typeof response).toBe('object')
      if (response.warehouses !== undefined) {
        expect(Array.isArray(response.warehouses)).toBe(true)
      }
    })
  })

  describe('getWarehousesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getWarehousesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getWarehouse', () => {
    // Needs a real warehouse id; supply testValues.warehouseId to enable.
    it('retrieves a warehouse when a warehouse id is configured', async () => {
      if (!testValues.warehouseId) {
        console.log('Skipping getWarehouse: set testValues.warehouseId')
        return
      }

      const response = await service.getWarehouse(testValues.warehouseId)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('state')
    })
  })

  // ── SQL: Statement Execution lifecycle ──

  describe('executeStatement + getStatementResult', () => {
    // Running a statement needs a real, reachable warehouse. Supply
    // testValues.warehouseId (and optionally testValues.sqlStatement).
    const canRun = () => Boolean(testValues.warehouseId)

    it('executes a SQL statement and reads its result', async () => {
      if (!canRun()) {
        console.log('Skipping executeStatement: set testValues.warehouseId')
        return
      }

      const statement = testValues.sqlStatement || 'SELECT 1 AS one'

      const execResponse = await service.executeStatement(
        testValues.warehouseId,
        statement,
        undefined,
        undefined,
        undefined,
        30
      )

      expect(execResponse).toHaveProperty('statement_id')
      expect(execResponse).toHaveProperty('status')

      // Poll once via getStatementResult to exercise the read path.
      const resultResponse = await service.getStatementResult(execResponse.statement_id)

      expect(resultResponse).toHaveProperty('statement_id', execResponse.statement_id)
      expect(resultResponse).toHaveProperty('status')
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('returns jobs with expected shape', async () => {
      const response = await service.listJobs(undefined, 5)

      expect(typeof response).toBe('object')
      if (response.jobs !== undefined) {
        expect(Array.isArray(response.jobs)).toBe(true)
      }
    })
  })

  describe('getJobsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getJob', () => {
    // Needs a real job id; supply testValues.jobId to enable.
    it('retrieves a job when a job id is configured', async () => {
      if (!testValues.jobId) {
        console.log('Skipping getJob: set testValues.jobId')
        return
      }

      const response = await service.getJob(testValues.jobId)

      expect(response).toHaveProperty('job_id')
      expect(response).toHaveProperty('settings')
    })
  })

  describe('listRuns', () => {
    it('returns runs with expected shape', async () => {
      const response = await service.listRuns(undefined, undefined, undefined, 5)

      expect(typeof response).toBe('object')
      if (response.runs !== undefined) {
        expect(Array.isArray(response.runs)).toBe(true)
      }
    })
  })

  describe('runJobNow + getRun', () => {
    // Triggering a real run needs a runnable job; supply testValues.jobId.
    // This consumes compute, so it only runs when explicitly opted in via
    // testValues.runJob === true.
    const canRun = () => Boolean(testValues.jobId && testValues.runJob === true)

    it('runs a job and retrieves the triggered run', async () => {
      if (!canRun()) {
        console.log('Skipping runJobNow: set testValues.jobId and testValues.runJob=true')
        return
      }

      const runResponse = await service.runJobNow(testValues.jobId)

      expect(runResponse).toHaveProperty('run_id')

      const getResponse = await service.getRun(runResponse.run_id)

      expect(getResponse).toHaveProperty('run_id', runResponse.run_id)
      expect(getResponse).toHaveProperty('state')

      // Best-effort cleanup: cancel the run we just started.
      try {
        await service.cancelRun(runResponse.run_id)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Clusters ──

  describe('listClusters', () => {
    it('returns clusters with expected shape', async () => {
      const response = await service.listClusters()

      expect(typeof response).toBe('object')
      if (response.clusters !== undefined) {
        expect(Array.isArray(response.clusters)).toBe(true)
      }
    })
  })

  describe('getCluster', () => {
    // Needs a real cluster id; supply testValues.clusterId to enable.
    it('retrieves a cluster when a cluster id is configured', async () => {
      if (!testValues.clusterId) {
        console.log('Skipping getCluster: set testValues.clusterId')
        return
      }

      const response = await service.getCluster(testValues.clusterId)

      expect(response).toHaveProperty('cluster_id')
      expect(response).toHaveProperty('state')
    })
  })

  // ── Unity Catalog ──

  describe('listCatalogs', () => {
    it('returns catalogs with expected shape', async () => {
      const response = await service.listCatalogs()

      expect(typeof response).toBe('object')
      if (response.catalogs !== undefined) {
        expect(Array.isArray(response.catalogs)).toBe(true)
      }
    })
  })

  describe('listSchemas', () => {
    // Requires a catalog name; supply testValues.catalogName (defaults to 'main').
    it('returns schemas for a catalog', async () => {
      const catalog = testValues.catalogName || 'main'

      const response = await service.listSchemas(catalog)

      expect(typeof response).toBe('object')
      if (response.schemas !== undefined) {
        expect(Array.isArray(response.schemas)).toBe(true)
      }
    })
  })

  describe('listTables', () => {
    // Requires catalog + schema; supply testValues.catalogName and testValues.schemaName.
    it('returns tables when catalog and schema are configured', async () => {
      if (!testValues.catalogName || !testValues.schemaName) {
        console.log('Skipping listTables: set testValues.catalogName and testValues.schemaName')
        return
      }

      const response = await service.listTables(testValues.catalogName, testValues.schemaName)

      expect(typeof response).toBe('object')
      if (response.tables !== undefined) {
        expect(Array.isArray(response.tables)).toBe(true)
      }
    })
  })

  // ── DBFS / Workspace ──

  describe('listDbfs', () => {
    it('lists a DBFS path', async () => {
      const path = testValues.dbfsPath || '/'

      const response = await service.listDbfs(path)

      expect(typeof response).toBe('object')
      if (response.files !== undefined) {
        expect(Array.isArray(response.files)).toBe(true)
      }
    })
  })

  describe('listWorkspace', () => {
    it('lists a workspace path', async () => {
      const path = testValues.workspacePath || '/'

      const response = await service.listWorkspace(path)

      expect(typeof response).toBe('object')
      if (response.objects !== undefined) {
        expect(Array.isArray(response.objects)).toBe(true)
      }
    })
  })
})
