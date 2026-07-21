'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Action Network Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('action-network')
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

  // ── People ──

  describe('listPeople', () => {
    it('returns people list with expected shape', async () => {
      const result = await service.listPeople(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('_embedded')
      expect(result._embedded).toHaveProperty('osdi:people')
      expect(Array.isArray(result._embedded['osdi:people'])).toBe(true)
    })
  })

  describe('upsertPerson + getPerson + updatePerson', () => {
    let personId

    it('creates or upserts a person', async () => {
      const result = await service.upsertPerson(
        'flowrunner-e2e-test@example.com',
        'E2ETest',
        'Person',
      )

      expect(result).toHaveProperty('_links')
      expect(result._links).toHaveProperty('self')

      // Extract person ID from self link
      const selfHref = result._links.self.href
      personId = selfHref.split('/').pop()
      expect(personId).toBeTruthy()
    })

    it('retrieves the person by ID', async () => {
      const result = await service.getPerson(personId)

      expect(result).toHaveProperty('given_name', 'E2ETest')
      expect(result).toHaveProperty('family_name', 'Person')
      expect(result).toHaveProperty('email_addresses')
      expect(Array.isArray(result.email_addresses)).toBe(true)
    })

    it('updates the person', async () => {
      const result = await service.updatePerson(personId, {
        given_name: 'E2EUpdated',
      })

      expect(result).toHaveProperty('given_name', 'E2EUpdated')
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('returns events list with expected shape', async () => {
      const result = await service.listEvents(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('_embedded')
    })
  })

  describe('createEvent + getEvent', () => {
    let eventId

    it('creates an event', async () => {
      const result = await service.createEvent(
        'E2E Test Event',
        new Date(Date.now() + 86400000).toISOString(),
        '<p>E2E test event description</p>',
      )

      expect(result).toHaveProperty('_links')
      expect(result._links).toHaveProperty('self')

      const selfHref = result._links.self.href
      eventId = selfHref.split('/').pop()
      expect(eventId).toBeTruthy()
    })

    it('retrieves the created event', async () => {
      const result = await service.getEvent(eventId)

      expect(result).toHaveProperty('title', 'E2E Test Event')
      expect(result).toHaveProperty('_links')
    })
  })

  // ── Action Pages ──

  describe('listForms', () => {
    it('returns forms list with expected shape', async () => {
      const result = await service.listForms(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
    })
  })

  describe('listPetitions', () => {
    it('returns petitions list with expected shape', async () => {
      const result = await service.listPetitions(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
    })
  })

  describe('listFundraisingPages', () => {
    it('returns fundraising pages list with expected shape', async () => {
      const result = await service.listFundraisingPages(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
    })
  })

  describe('listAdvocacyCampaigns', () => {
    it('returns advocacy campaigns list with expected shape', async () => {
      const result = await service.listAdvocacyCampaigns(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns tags list with expected shape', async () => {
      const result = await service.listTags(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('_embedded')
    })
  })

  // ── Messages ──

  describe('listMessages', () => {
    it('returns messages list with expected shape', async () => {
      const result = await service.listMessages(1)

      expect(result).toHaveProperty('total_pages')
      expect(result).toHaveProperty('per_page')
    })
  })

  // ── Dictionary ──

  describe('getTagsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })
})
