'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * E2E tests for the Chroma vector database service.
 *
 * Requires a reachable Chroma server. Fill in service-sandbox/e2e-config.json
 * under the "chroma" key:
 *
 *   "chroma": {
 *     "configs": {
 *       "baseUrl": "http://localhost:8000",   // required — Chroma Cloud or self-hosted URL
 *       "apiKey": "",                          // optional — Chroma Cloud x-chroma-token
 *       "tenant": "default_tenant",            // optional — defaults to default_tenant
 *       "database": "default_database"         // optional — defaults to default_database
 *     },
 *     "testValues": {}                          // no extra values required
 *   }
 *
 * The suite creates its own throwaway collection (and cleans it up), so no
 * pre-existing collection is needed. Records are added with explicit small
 * embeddings so the collection does not need an embedding function.
 */
describe('Chroma Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('chroma')
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

  // Unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()
  const collectionName = `e2e_collection_${ suffix }`

  // ── Collections + full record lifecycle ──

  describe('collection + record lifecycle', () => {
    it('creates a collection', async () => {
      const response = await service.createCollection(collectionName, { source: 'e2e' })

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name', collectionName)
    })

    it('lists collections including the new one', async () => {
      const response = await service.listCollections(100, 0)

      expect(Array.isArray(response)).toBe(true)
      expect(response.some(c => c.name === collectionName)).toBe(true)
    })

    it('gets the collection by name', async () => {
      const response = await service.getCollection(collectionName)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('name', collectionName)
    })

    it('counts collections', async () => {
      const response = await service.countCollections()

      expect(response).toHaveProperty('count')
      expect(typeof response.count).toBe('number')
    })

    it('adds records with explicit embeddings', async () => {
      const response = await service.addRecords(
        collectionName,
        ['doc1', 'doc2'],
        [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        [{ source: 'web' }, { source: 'pdf' }],
        ['first document', 'second document']
      )

      // Chroma returns an empty body on success → service normalizes to {success:true}.
      expect(response).toBeDefined()
    })

    it('counts records in the collection', async () => {
      const response = await service.countRecords(collectionName)

      expect(response).toHaveProperty('count')
      expect(response.count).toBeGreaterThanOrEqual(2)
    })

    it('gets records by id', async () => {
      const response = await service.getRecords(
        collectionName,
        ['doc1', 'doc2'],
        undefined,
        undefined,
        undefined,
        undefined,
        ['documents', 'metadatas']
      )

      expect(response).toHaveProperty('ids')
      expect(Array.isArray(response.ids)).toBe(true)
      expect(response.ids).toEqual(expect.arrayContaining(['doc1', 'doc2']))
    })

    it('queries records by embedding similarity', async () => {
      const response = await service.queryRecords(
        collectionName,
        [[0.1, 0.2, 0.3]],
        2,
        undefined,
        undefined,
        ['documents', 'distances']
      )

      expect(response).toHaveProperty('ids')
      expect(Array.isArray(response.ids)).toBe(true)
      // Query results are grouped per query embedding.
      expect(Array.isArray(response.ids[0])).toBe(true)
    })

    it('upserts a record', async () => {
      const response = await service.upsertRecords(
        collectionName,
        ['doc3'],
        [[0.7, 0.8, 0.9]],
        [{ source: 'api' }],
        ['third document']
      )

      expect(response).toBeDefined()
    })

    it('updates an existing record', async () => {
      const response = await service.updateRecords(
        collectionName,
        ['doc1'],
        undefined,
        [{ source: 'updated' }],
        ['first document updated']
      )

      expect(response).toBeDefined()
    })

    it('deletes records by id', async () => {
      const response = await service.deleteRecords(collectionName, ['doc2'])

      expect(response).toBeDefined()
    })

    it('deletes records by metadata filter', async () => {
      const response = await service.deleteRecords(collectionName, undefined, { source: 'api' })

      expect(response).toBeDefined()
    })

    it('deletes the collection', async () => {
      const response = await service.deleteCollection(collectionName)

      expect(response).toBeDefined()
    })

    // Safety net: remove the collection even if an assertion above failed.
    afterAll(async () => {
      try {
        await service.deleteCollection(collectionName)
      } catch (e) {
        // ignore cleanup errors (already deleted / never created)
      }
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
