'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google BigQuery Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bigquery')
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

  // A unique-ish suffix so repeated e2e runs don't collide on dataset/table ids.
  // BigQuery identifiers allow only letters, numbers, and underscores.
  const suffix = Date.now()
  const datasetId = `e2e_dataset_${ suffix }`
  const tableId = 'e2e_table'

  // ── Datasets ──

  describe('createDataset + listDatasets + deleteDataset', () => {
    it('creates a dataset', async () => {
      // location defaults to the Location config item (or US) when not passed.
      const response = await service.createDataset(datasetId, testValues.datasetLocation, 'E2E test dataset')

      expect(response).toHaveProperty('datasetId', datasetId)
      expect(response).toHaveProperty('projectId')
      expect(response).toHaveProperty('location')
    })

    it('lists datasets and includes the created one', async () => {
      const response = await service.listDatasets(1000)

      expect(response).toHaveProperty('datasets')
      expect(Array.isArray(response.datasets)).toBe(true)
      expect(response.datasets.some(d => d.datasetId === datasetId)).toBe(true)
    })

    // Dataset is deleted at the very end (after the table lifecycle) via afterAll below.
  })

  describe('getDatasetsDictionary', () => {
    it('returns dictionary items array with a cursor field', async () => {
      const result = await service.getDatasetsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Tables ──

  describe('createTable + getTable + listTables + deleteTable', () => {
    it('creates a table with a typed schema', async () => {
      const response = await service.createTable(
        datasetId,
        tableId,
        [
          { name: 'id', type: 'Integer', mode: 'Required' },
          { name: 'name', type: 'String' },
          { name: 'active', type: 'Boolean' },
          { name: 'created_at', type: 'Timestamp' },
        ],
        'E2E test table'
      )

      expect(response).toHaveProperty('tableId', tableId)
      expect(response).toHaveProperty('schema')
      expect(response.schema).toHaveProperty('fields')
    })

    it('retrieves the table metadata', async () => {
      const response = await service.getTable(datasetId, tableId)

      expect(response).toHaveProperty('tableId', tableId)
      expect(response).toHaveProperty('datasetId', datasetId)
      expect(response.schema.fields.length).toBe(4)
    })

    it('lists tables in the dataset', async () => {
      const response = await service.listTables(datasetId)

      expect(response).toHaveProperty('tables')
      expect(Array.isArray(response.tables)).toBe(true)
      expect(response.tables.some(t => t.tableId === tableId)).toBe(true)
    })

    // Table is deleted in the afterAll below.
  })

  describe('getTablesDictionary', () => {
    it('returns items for the dataset criteria', async () => {
      const result = await service.getTablesDictionary({ criteria: { datasetId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns empty items without a dataset criterion', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })

  // ── Table Data + Queries ──

  describe('insertRows + listRows', () => {
    it('streams rows into the table', async () => {
      const response = await service.insertRows(datasetId, tableId, [
        { id: 1, name: 'Alice', active: true, created_at: '2025-01-01T00:00:00Z' },
        { id: 2, name: 'Bob', active: false, created_at: '2025-01-02T00:00:00Z' },
      ])

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('insertedRowCount', 2)
      expect(response).toHaveProperty('failedRowCount', 0)
    })

    it('reads rows back from the table', async () => {
      // Streamed rows can take a moment to be readable; shape check only.
      const response = await service.listRows(datasetId, tableId, 10, 0)

      expect(response).toHaveProperty('rows')
      expect(Array.isArray(response.rows)).toBe(true)
      expect(response).toHaveProperty('totalRows')
    })
  })

  describe('runQuery + getQueryResults', () => {
    it('runs a simple SELECT and returns typed rows', async () => {
      const response = await service.runQuery(
        'SELECT @n AS n, @label AS label, @flag AS flag',
        { n: 7, label: 'seven', flag: true }
      )

      expect(response).toHaveProperty('jobComplete')
      expect(response).toHaveProperty('jobId')

      if (response.jobComplete) {
        expect(Array.isArray(response.rows)).toBe(true)
        expect(response.rows[0]).toMatchObject({ n: 7, label: 'seven', flag: true })
      }
    })

    it('queries the created table', async () => {
      const response = await service.runQuery(
        `SELECT id, name FROM \`${ datasetId }.${ tableId }\` ORDER BY id`
      )

      expect(response).toHaveProperty('jobComplete')
      expect(response).toHaveProperty('totalRows')
    })

    it('fetches results for a completed job by id', async () => {
      const run = await service.runQuery('SELECT 1 AS one')

      // Only a completed job with a jobId can be re-fetched.
      if (run.jobComplete && run.jobId) {
        const results = await service.getQueryResults(run.jobId)

        expect(results).toHaveProperty('jobComplete')
        expect(results).toHaveProperty('jobId', run.jobId)
      }
    })
  })

  // ── Cleanup: drop the table then the dataset (with contents) ──

  afterAll(async () => {
    try {
      await service.deleteTable(datasetId, tableId)
    } catch (e) {
      // ignore cleanup errors (table may not exist if creation failed)
    }

    try {
      await service.deleteDataset(datasetId, true)
    } catch (e) {
      // ignore cleanup errors
    }
  })
})
