'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Firestore Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('google-firestore')
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

  // Use a dedicated test collection so e2e runs never touch production data.
  // Override via testValues.collection in e2e-config.json if desired.
  const collection = (testValues && testValues.collection) || 'e2e_firestore'
  // Unique-ish document id so repeated runs don't collide.
  const documentId = `doc_${ Date.now() }`
  const documentPath = `${ collection }/${ documentId }`
  const secondPath = `${ collection }/${ documentId }_b`

  // ── Documents lifecycle ──

  describe('createDocument + getDocument + updateDocument + deleteDocument', () => {
    it('creates a document with a rich set of field types', async () => {
      const result = await service.createDocument(
        collection,
        {
          name: 'Alice',
          age: 30,
          score: 1.5,
          active: true,
          deleted: null,
          tags: ['a', 'b', 2],
          address: { city: 'Paris', zip: 75001 },
          when: { timestampValue: '2026-01-01T00:00:00Z' },
        },
        documentId
      )

      expect(result).toHaveProperty('id', documentId)
      expect(result).toHaveProperty('path', documentPath)
      expect(result).toHaveProperty('name')
      expect(result.data).toMatchObject({
        name: 'Alice',
        age: 30,
        score: 1.5,
        active: true,
        deleted: null,
        tags: ['a', 'b', 2],
        address: { city: 'Paris', zip: 75001 },
      })
      // Explicit wire-format timestamp round-trips as an ISO string.
      expect(typeof result.data.when).toBe('string')
    })

    it('gets the created document back with decoded fields', async () => {
      const result = await service.getDocument(documentPath)

      expect(result).toHaveProperty('id', documentId)
      expect(result.data).toMatchObject({ name: 'Alice', age: 30, active: true })
      expect(result).toHaveProperty('createTime')
      expect(result).toHaveProperty('updateTime')
    })

    it('merges an update into the document', async () => {
      const result = await service.updateDocument(documentPath, { age: 31, active: false }, true)

      expect(result.data).toMatchObject({ age: 31, active: false })
      // Untouched fields remain.
      expect(result.data).toHaveProperty('name', 'Alice')
    })

    // Deleted in the afterAll cleanup.
  })

  // ── List / batch reads ──

  describe('listDocuments', () => {
    it('lists documents in the collection', async () => {
      const result = await service.listDocuments(collection, 50)

      expect(result).toHaveProperty('documents')
      expect(Array.isArray(result.documents)).toBe(true)
      expect(result).toHaveProperty('nextPageToken')
      expect(result.documents.some(d => d.id === documentId)).toBe(true)
    })
  })

  describe('batchGetDocuments', () => {
    it('returns found and missing documents split correctly', async () => {
      const result = await service.batchGetDocuments([documentPath, `${ collection }/does_not_exist`])

      expect(result).toHaveProperty('found')
      expect(result).toHaveProperty('missing')
      expect(result.found.some(d => d.id === documentId)).toBe(true)
      expect(result.missing).toContain(`${ collection }/does_not_exist`)
    })
  })

  // ── Queries ──

  describe('queryDocuments', () => {
    it('queries the collection with a field filter', async () => {
      const result = await service.queryDocuments(
        collection,
        [{ field: 'name', op: '==', value: 'Alice' }]
      )

      expect(result).toHaveProperty('documents')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.documents)).toBe(true)
      expect(result.documents.some(d => d.id === documentId)).toBe(true)
    })

    it('queries the whole collection with a limit', async () => {
      const result = await service.queryDocuments(collection, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('count')
      expect(result.count).toBeLessThanOrEqual(5)
    })
  })

  describe('runAggregationQuery', () => {
    it('counts documents in the collection', async () => {
      const result = await service.runAggregationQuery(collection, 'Count')

      expect(result).toHaveProperty('aggregation', 'Count')
      expect(typeof result.value).toBe('number')
      expect(result.value).toBeGreaterThanOrEqual(1)
    })

    it('sums a numeric field across the collection', async () => {
      const result = await service.runAggregationQuery(collection, 'Sum', 'age')

      expect(result).toHaveProperty('aggregation', 'Sum')
      expect(typeof result.value).toBe('number')
    })
  })

  // ── Collections ──

  describe('listCollectionIds', () => {
    it('lists root collection ids and includes the test collection', async () => {
      const result = await service.listCollectionIds()

      expect(result).toHaveProperty('collectionIds')
      expect(Array.isArray(result.collectionIds)).toBe(true)
      expect(result.collectionIds).toContain(collection)
    })
  })

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items with a cursor field', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('filters collection ids by search term', async () => {
      const result = await service.getCollectionsDictionary({ search: collection })

      expect(result.items.every(i => i.value.includes(collection))).toBe(true)
    })
  })

  // ── Upsert via update (creates when missing) ──

  describe('updateDocument (upsert)', () => {
    it('creates a missing document when mustExist is not set', async () => {
      const result = await service.updateDocument(secondPath, { name: 'Bob', age: 25 })

      expect(result).toHaveProperty('path', secondPath)
      expect(result.data).toMatchObject({ name: 'Bob', age: 25 })
    })
  })

  // ── Cleanup: remove both test documents ──

  afterAll(async () => {
    try {
      await service.deleteDocument(documentPath)
    } catch (e) {
      // ignore cleanup errors
    }

    try {
      await service.deleteDocument(secondPath)
    } catch (e) {
      // ignore cleanup errors
    }
  })
})
