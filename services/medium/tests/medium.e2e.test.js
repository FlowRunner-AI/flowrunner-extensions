'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Medium Service (e2e)', () => {
  let sandbox
  let service
  let userId

  beforeAll(() => {
    sandbox = createE2ESandbox('medium')
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

  // ── User ──

  describe('getCurrentUser', () => {
    it('returns authenticated user with expected shape', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('username')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('url')

      // Save userId for subsequent tests
      userId = result.id
    })
  })

  // ── Publications ──

  describe('listUserPublications', () => {
    it('returns an array of publications', async () => {
      expect(userId).toBeDefined()

      const result = await service.listUserPublications(userId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('url')
      }
    })
  })

  // ── Dictionary ──

  describe('getPublicationsDictionary', () => {
    it('returns empty items when no userId provided', async () => {
      const result = await service.getPublicationsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns dictionary items for user', async () => {
      expect(userId).toBeDefined()

      const result = await service.getPublicationsDictionary({ criteria: { userId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Posts ──

  describe('createPost', () => {
    it('creates a draft post and returns post data', async () => {
      expect(userId).toBeDefined()

      const result = await service.createPost(
        userId,
        'E2E Test Post - ' + Date.now(),
        'HTML',
        '<h1>E2E Test</h1><p>This post was created by an automated e2e test and can be safely deleted.</p>',
        ['e2e-test'],
        undefined,
        'Draft',
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('authorId', userId)
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('publishStatus', 'draft')
    })
  })

  // ── Publication Contributors ──

  describe('listPublicationContributors', () => {
    it('returns contributors for a publication if available', async () => {
      expect(userId).toBeDefined()

      const publications = await service.listUserPublications(userId)

      if (publications.length === 0) {
        console.log('No publications found for user, skipping contributors test')

        return
      }

      const pubId = publications[0].id
      const result = await service.listPublicationContributors(pubId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('publicationId')
        expect(result[0]).toHaveProperty('userId')
        expect(result[0]).toHaveProperty('role')
      }
    })
  })
})
