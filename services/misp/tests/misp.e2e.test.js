'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MISP Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('misp')
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

  // ── Events: list ──

  describe('listEvents', () => {
    it('returns an array of events', async () => {
      const result = await service.listEvents()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Events: CRUD lifecycle ──

  describe('event lifecycle (add, get, update, publish, delete)', () => {
    let createdEventId

    it('creates a new event', async () => {
      const result = await service.addEvent(
        'E2E Test Event - automated',
        'Your organisation only',
        'Low',
        'Initial',
        undefined,
        false
      )

      expect(result).toHaveProperty('Event')
      expect(result.Event).toHaveProperty('id')
      expect(result.Event).toHaveProperty('uuid')
      expect(result.Event.info).toBe('E2E Test Event - automated')

      createdEventId = result.Event.id
    })

    it('retrieves the created event', async () => {
      const result = await service.getEvent(createdEventId)

      expect(result).toHaveProperty('Event')
      expect(result.Event.id).toBe(createdEventId)
      expect(result.Event.info).toBe('E2E Test Event - automated')
    })

    it('updates the event', async () => {
      const result = await service.updateEvent(
        createdEventId,
        'E2E Test Event - updated',
        undefined,
        'Medium'
      )

      expect(result).toHaveProperty('Event')
      expect(result.Event.info).toBe('E2E Test Event - updated')
    })

    it('publishes the event', async () => {
      const result = await service.publishEvent(createdEventId)

      expect(result).toHaveProperty('message')
    })

    it('deletes the event', async () => {
      const result = await service.deleteEvent(createdEventId)

      expect(result).toHaveProperty('message')
    })
  })

  // ── Search Events ──

  describe('searchEvents', () => {
    it('returns results array', async () => {
      const result = await service.searchEvents(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        5,
        1
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Attributes: CRUD lifecycle ──

  describe('attribute lifecycle (add, get, edit, search, delete)', () => {
    let eventId
    let attributeId

    beforeAll(async () => {
      const event = await service.addEvent(
        'E2E Attribute Test Event',
        'Your organisation only',
        'Low',
        'Initial',
        undefined,
        false
      )

      eventId = event.Event.id
    })

    afterAll(async () => {
      if (eventId) {
        await service.deleteEvent(eventId)
      }
    })

    it('adds an attribute to the event', async () => {
      const result = await service.addAttribute(
        eventId,
        'domain',
        'e2e-test-evil.example.com',
        'Network activity',
        false,
        'E2E test attribute'
      )

      expect(result).toHaveProperty('Attribute')
      expect(result.Attribute).toHaveProperty('id')
      expect(result.Attribute.type).toBe('domain')
      expect(result.Attribute.value).toBe('e2e-test-evil.example.com')

      attributeId = result.Attribute.id
    })

    it('retrieves the attribute by ID', async () => {
      const result = await service.getAttribute(attributeId)

      expect(result).toHaveProperty('Attribute')
      expect(result.Attribute.id).toBe(attributeId)
      expect(result.Attribute.value).toBe('e2e-test-evil.example.com')
    })

    it('edits the attribute', async () => {
      const result = await service.editAttribute(
        attributeId,
        undefined,
        undefined,
        undefined,
        undefined,
        'Updated e2e comment'
      )

      expect(result).toHaveProperty('Attribute')
    })

    it('searches for the attribute by value', async () => {
      const result = await service.searchAttributes('e2e-test-evil.example.com')

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the attribute', async () => {
      const result = await service.deleteAttribute(attributeId)

      expect(result).toHaveProperty('message')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns tags with expected shape', async () => {
      const result = await service.listTags()

      expect(result).toHaveProperty('Tag')
      expect(Array.isArray(result.Tag)).toBe(true)

      if (result.Tag.length > 0) {
        expect(result.Tag[0]).toHaveProperty('id')
        expect(result.Tag[0]).toHaveProperty('name')
      }
    })
  })

  describe('tag event lifecycle (add tag, remove tag)', () => {
    let eventId
    let tagId

    beforeAll(async () => {
      const event = await service.addEvent(
        'E2E Tag Test Event',
        'Your organisation only',
        'Low',
        'Initial',
        undefined,
        false
      )

      eventId = event.Event.id

      // Get the first available tag to use for testing
      const tags = await service.listTags()

      if (tags.Tag && tags.Tag.length > 0) {
        tagId = tags.Tag[0].id
      }
    })

    afterAll(async () => {
      if (eventId) {
        await service.deleteEvent(eventId)
      }
    })

    it('adds a tag to the event', async () => {
      if (!tagId) {
        console.log('No tags available on MISP instance, skipping tag add test')
        return
      }

      const result = await service.addTagToEvent(eventId, String(tagId))

      expect(result).toHaveProperty('saved', true)
    })

    it('removes the tag from the event', async () => {
      if (!tagId) {
        console.log('No tags available on MISP instance, skipping tag remove test')
        return
      }

      const result = await service.removeTagFromEvent(eventId, String(tagId))

      expect(result).toHaveProperty('saved', true)
    })
  })

  // ── Sightings ──

  describe('addSighting', () => {
    let eventId

    beforeAll(async () => {
      const event = await service.addEvent(
        'E2E Sighting Test Event',
        'Your organisation only',
        'Low',
        'Initial',
        undefined,
        false
      )

      eventId = event.Event.id

      await service.addAttribute(eventId, 'domain', 'sighting-test.example.com', 'Network activity')
    })

    afterAll(async () => {
      if (eventId) {
        await service.deleteEvent(eventId)
      }
    })

    it('records a sighting for an attribute value', async () => {
      const result = await service.addSighting('sighting-test.example.com', 'Sighting')

      expect(result).toHaveProperty('message')
    })
  })
})
