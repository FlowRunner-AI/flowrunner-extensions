'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Eventbrite Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('eventbrite')
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

  // ── User / Me ──

  describe('getUser', () => {
    it('returns user profile with expected shape', async () => {
      const result = await service.getUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('emails')
      expect(Array.isArray(result.emails)).toBe(true)
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('returns categories with expected shape', async () => {
      const result = await service.listCategories()

      expect(result).toHaveProperty('categories')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.categories)).toBe(true)

      if (result.categories.length > 0) {
        expect(result.categories[0]).toHaveProperty('id')
        expect(result.categories[0]).toHaveProperty('name')
      }
    })
  })

  // ── Dictionaries ──

  describe('getOrganizationsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getOrganizationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Organization')
      }
    })
  })

  describe('getCategoriesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCategoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Category')
      }
    })

    it('filters by search term', async () => {
      const result = await service.getCategoriesDictionary({ search: 'Music' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Events (requires organizationId from testValues) ──

  describe('events lifecycle', () => {
    let organizationId
    let createdEventId

    beforeAll(() => {
      const testValues = sandbox.getTestValues()
      organizationId = testValues.organizationId

      if (!organizationId) {
        console.warn('Skipping events lifecycle tests: organizationId not set in testValues')
      }
    })

    it('lists events for the organization', async () => {
      if (!organizationId) {
        return
      }

      const result = await service.listEvents(organizationId)

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.events)).toBe(true)
    })

    it('creates a draft event', async () => {
      if (!organizationId) {
        return
      }

      const now = new Date()
      const start = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const end = new Date(start.getTime() + 3 * 60 * 60 * 1000)

      const result = await service.createEvent(
        organizationId,
        'E2E Test Event - FlowRunner',
        'America/New_York',
        start.toISOString().replace(/\.\d+Z$/, 'Z'),
        end.toISOString().replace(/\.\d+Z$/, 'Z'),
        'USD',
        true
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'draft')
      createdEventId = result.id
    })

    it('gets the created event', async () => {
      if (!createdEventId) {
        return
      }

      const result = await service.getEvent(createdEventId)

      expect(result).toHaveProperty('id', createdEventId)
      expect(result).toHaveProperty('name')
      expect(result.name).toHaveProperty('text')
    })

    it('updates the event name', async () => {
      if (!createdEventId) {
        return
      }

      const result = await service.updateEvent(createdEventId, 'E2E Updated Event - FlowRunner')

      expect(result).toHaveProperty('id', createdEventId)
    })

    it('gets events dictionary for the organization', async () => {
      if (!organizationId) {
        return
      }

      const result = await service.getEventsDictionary({
        criteria: { organizationId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    // Note: We do not publish/unpublish/cancel the draft event in e2e tests
    // because publishing requires at least one ticket class with valid settings,
    // and cancelling is irreversible in practice.
  })

  // ── Venues (requires organizationId from testValues) ──

  describe('venues', () => {
    let organizationId

    beforeAll(() => {
      const testValues = sandbox.getTestValues()
      organizationId = testValues.organizationId
    })

    it('lists venues for the organization', async () => {
      if (!organizationId) {
        return
      }

      const result = await service.listVenues(organizationId)

      expect(result).toHaveProperty('venues')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.venues)).toBe(true)
    })
  })

  // ── Orders (requires eventId or organizationId from testValues) ──

  describe('orders', () => {
    let organizationId

    beforeAll(() => {
      const testValues = sandbox.getTestValues()
      organizationId = testValues.organizationId
    })

    it('lists orders for the organization', async () => {
      if (!organizationId) {
        return
      }

      const result = await service.listOrders(undefined, organizationId)

      expect(result).toHaveProperty('orders')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.orders)).toBe(true)
    })

    it('throws when neither eventId nor organizationId is provided', async () => {
      await expect(service.listOrders()).rejects.toThrow()
    })
  })
})
