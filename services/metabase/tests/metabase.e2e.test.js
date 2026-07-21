'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Metabase Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('metabase')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Users & Health ──

  describe('healthCheck', () => {
    it('returns ok status', async () => {
      const result = await service.healthCheck()

      expect(result).toHaveProperty('status', 'ok')
    })
  })

  describe('getCurrentUser', () => {
    it('returns user with expected shape', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('first_name')
    })
  })

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const result = await service.listUsers()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)

      expect(result.data[0]).toHaveProperty('id')
      expect(result.data[0]).toHaveProperty('email')
    })

    it('returns all users when status is All', async () => {
      const result = await service.listUsers('All')

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Databases ──

  describe('listDatabases', () => {
    it('returns databases with expected shape', async () => {
      const result = await service.listDatabases()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)

      expect(result.data[0]).toHaveProperty('id')
      expect(result.data[0]).toHaveProperty('name')
      expect(result.data[0]).toHaveProperty('engine')
    })

    it('includes tables when requested', async () => {
      const result = await service.listDatabases(true)

      expect(result).toHaveProperty('data')
      expect(result.data.length).toBeGreaterThan(0)

      expect(result.data[0]).toHaveProperty('tables')
    })
  })

  describe('getDatabase', () => {
    it('returns a database by id', async () => {
      const list = await service.listDatabases()
      const dbId = list.data[0].id

      const result = await service.getDatabase(dbId)

      expect(result).toHaveProperty('id', dbId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('engine')
    })
  })

  describe('getDatabaseMetadata', () => {
    it('returns metadata with tables and fields', async () => {
      const list = await service.listDatabases()
      const dbId = list.data[0].id

      const result = await service.getDatabaseMetadata(dbId)

      expect(result).toHaveProperty('id', dbId)
      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)
    })
  })

  describe('syncDatabaseSchema', () => {
    it('triggers sync without error', async () => {
      const list = await service.listDatabases()
      const dbId = list.data[0].id

      const result = await service.syncDatabaseSchema(dbId)

      expect(result).toBeDefined()
    })
  })

  // ── Collections ──

  describe('listCollections', () => {
    it('returns collections with expected shape', async () => {
      const result = await service.listCollections()

      expect(result).toHaveProperty('collections')
      expect(Array.isArray(result.collections)).toBe(true)
    })
  })

  describe('createCollection + getCollectionItems', () => {
    let createdCollectionId

    it('creates a collection', async () => {
      const result = await service.createCollection(
        'E2E Test Collection',
        'Created by e2e tests'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Collection')
      createdCollectionId = result.id
    })

    it('lists items in the created collection', async () => {
      const result = await service.getCollectionItems(createdCollectionId)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Dashboards ──

  describe('listDashboards', () => {
    it('returns dashboards with expected shape', async () => {
      const result = await service.listDashboards()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('createDashboard + getDashboard', () => {
    let createdDashboardId

    it('creates a dashboard', async () => {
      const result = await service.createDashboard(
        'E2E Test Dashboard',
        'Created by e2e tests'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Dashboard')
      createdDashboardId = result.id
    })

    it('retrieves the created dashboard', async () => {
      const result = await service.getDashboard(createdDashboardId)

      expect(result).toHaveProperty('id', createdDashboardId)
      expect(result).toHaveProperty('name', 'E2E Test Dashboard')
      expect(result).toHaveProperty('dashcards')
    })
  })

  // ── Cards (full lifecycle) ──

  describe('card lifecycle: create + get + update + run + delete', () => {
    let createdCardId
    let databaseId

    it('identifies a database to use', async () => {
      const list = await service.listDatabases()

      expect(list.data.length).toBeGreaterThan(0)
      databaseId = list.data[0].id
    })

    it('creates a card with SQL query', async () => {
      const result = await service.createCard(
        'E2E Test Card',
        databaseId,
        'SELECT 1 AS test_value'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Card')
      createdCardId = result.id
    })

    it('retrieves the created card', async () => {
      const result = await service.getCard(createdCardId)

      expect(result).toHaveProperty('id', createdCardId)
      expect(result).toHaveProperty('name', 'E2E Test Card')
      expect(result).toHaveProperty('dataset_query')
    })

    it('lists cards and finds the created one', async () => {
      const result = await service.listCards()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      const found = result.data.find(c => c.id === createdCardId)
      expect(found).toBeDefined()
    })

    it('updates the card name', async () => {
      const result = await service.updateCard(createdCardId, 'E2E Test Card Updated')

      expect(result).toHaveProperty('id', createdCardId)
      expect(result).toHaveProperty('name', 'E2E Test Card Updated')
    })

    it('runs the card query', async () => {
      const result = await service.runCardQuery(createdCardId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('rows')
      expect(Array.isArray(result.data.rows)).toBe(true)
    })

    it('exports the card query as JSON', async () => {
      const result = await service.runCardQueryExport(createdCardId, 'JSON')

      expect(result).toHaveProperty('format', 'json')
      expect(result).toHaveProperty('data')
    })

    it('deletes the created card', async () => {
      const result = await service.deleteCard(createdCardId)

      expect(result).toEqual({ deleted: true, id: createdCardId })
    })
  })

  // ── Datasets (ad-hoc queries) ──

  describe('runQuery', () => {
    it('runs an ad-hoc SQL query', async () => {
      const list = await service.listDatabases()
      const dbId = list.data[0].id

      const result = await service.runQuery(dbId, 'SELECT 1 AS val')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('rows')
      expect(result).toHaveProperty('status')
    })
  })

  describe('exportQuery', () => {
    it('exports an ad-hoc SQL query as JSON', async () => {
      const list = await service.listDatabases()
      const dbId = list.data[0].id

      const result = await service.exportQuery(dbId, 'JSON', 'SELECT 1 AS val')

      expect(result).toHaveProperty('format', 'json')
      expect(result).toHaveProperty('data')
    })
  })

  // ── Dictionaries ──

  describe('getCardsDictionary', () => {
    it('returns items with expected shape', async () => {
      const result = await service.getCardsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getDatabasesDictionary', () => {
    it('returns database items', async () => {
      const result = await service.getDatabasesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getCollectionsDictionary', () => {
    it('returns collection items', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
