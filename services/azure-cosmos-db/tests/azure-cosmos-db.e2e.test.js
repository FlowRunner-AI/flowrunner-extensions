'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure Cosmos DB Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-cosmos-db')
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

  // ── Databases ──

  describe('listDatabases', () => {
    it('returns databases array with expected shape', async () => {
      const result = await service.listDatabases()

      expect(result).toHaveProperty('Databases')
      expect(Array.isArray(result.Databases)).toBe(true)
      expect(result).toHaveProperty('_count')
    })
  })

  describe('getDatabasesDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      const result = await service.getDatabasesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Database')
      }
    })
  })

  // ── Database CRUD (create + get + delete) ──

  describe('database lifecycle', () => {
    const testDbId = `e2e-test-db-${Date.now()}`

    it('creates a database', async () => {
      const result = await service.createDatabase(testDbId)

      expect(result).toHaveProperty('id', testDbId)
      expect(result).toHaveProperty('_rid')
    })

    it('retrieves the created database', async () => {
      const result = await service.getDatabase(testDbId)

      expect(result).toHaveProperty('id', testDbId)
    })

    it('deletes the created database', async () => {
      const result = await service.deleteDatabase(testDbId)

      expect(result).toEqual({ deleted: true, database: testDbId })
    })
  })

  // ── Containers & Documents (using testValues database) ──

  describe('containers and documents', () => {
    const testContainerId = `e2e-test-coll-${Date.now()}`
    const pkPath = '/pk'
    let database

    beforeAll(() => {
      database = testValues.database

      if (!database) {
        throw new Error(
          'testValues.database is required for container/document tests. ' +
          'Set it in e2e-config.json under azure-cosmos-db.testValues.database.'
        )
      }
    })

    // ── Container CRUD ──

    it('lists containers in the database', async () => {
      const result = await service.listContainers(database)

      expect(result).toHaveProperty('DocumentCollections')
      expect(Array.isArray(result.DocumentCollections)).toBe(true)
    })

    it('creates a container with partition key', async () => {
      const result = await service.createContainer(database, testContainerId, pkPath)

      expect(result).toHaveProperty('id', testContainerId)
      expect(result).toHaveProperty('partitionKey')
      expect(result.partitionKey.paths).toContain(pkPath)
    })

    it('retrieves the created container', async () => {
      const result = await service.getContainer(database, testContainerId)

      expect(result).toHaveProperty('id', testContainerId)
    })

    it('returns containers dictionary items', async () => {
      const result = await service.getContainersDictionary({ criteria: { database } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      const found = result.items.find(item => item.value === testContainerId)

      expect(found).toBeDefined()
    })

    // ── Document CRUD ──

    describe('document operations', () => {
      const docId = `e2e-doc-${Date.now()}`
      const pkValue = 'test-partition'

      it('creates a document', async () => {
        const doc = { id: docId, pk: pkValue, name: 'E2E Test', status: 'active' }
        const result = await service.createDocument(database, testContainerId, doc, pkValue)

        expect(result).toHaveProperty('id', docId)
        expect(result).toHaveProperty('_rid')
      })

      it('retrieves the document by id', async () => {
        const result = await service.getDocument(database, testContainerId, docId, pkValue)

        expect(result).toHaveProperty('id', docId)
        expect(result).toHaveProperty('name', 'E2E Test')
      })

      it('lists documents in the container', async () => {
        const result = await service.listDocuments(database, testContainerId, 10)

        expect(result).toHaveProperty('documents')
        expect(Array.isArray(result.documents)).toBe(true)
        expect(result).toHaveProperty('count')
        expect(result.documents.length).toBeGreaterThan(0)
      })

      it('queries documents with SQL', async () => {
        const result = await service.queryDocuments(
          database,
          testContainerId,
          'SELECT * FROM c WHERE c.id = @id',
          [{ name: '@id', value: docId }],
          10
        )

        expect(result).toHaveProperty('documents')
        expect(result.documents.length).toBe(1)
        expect(result.documents[0].id).toBe(docId)
      })

      it('replaces the document', async () => {
        const updatedDoc = { id: docId, pk: pkValue, name: 'Updated E2E', status: 'replaced' }
        const result = await service.replaceDocument(database, testContainerId, docId, updatedDoc, pkValue)

        expect(result).toHaveProperty('name', 'Updated E2E')
        expect(result).toHaveProperty('status', 'replaced')
      })

      it('upserts a document', async () => {
        const upsertDoc = { id: docId, pk: pkValue, name: 'Upserted E2E', status: 'upserted' }
        const result = await service.upsertDocument(database, testContainerId, upsertDoc, pkValue)

        expect(result).toHaveProperty('name', 'Upserted E2E')
      })

      it('deletes the document', async () => {
        const result = await service.deleteDocument(database, testContainerId, docId, pkValue)

        expect(result).toEqual({ deleted: true, documentId: docId })
      })
    })

    // ── Container cleanup (must run last) ──

    it('deletes the created container', async () => {
      const result = await service.deleteContainer(database, testContainerId)

      expect(result).toEqual({ deleted: true, database, container: testContainerId })
    })
  })
})
