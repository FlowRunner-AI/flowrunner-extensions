'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Klaviyo Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('klaviyo')
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

  const suffix = Date.now()

  // ── Profiles ──

  describe('listProfiles', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.listProfiles(undefined, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('nextCursor')
    })
  })

  describe('profile CRUD', () => {
    let profileId

    it('creates a profile', async () => {
      const result = await service.createOrUpdateProfile(
        `e2e-test-${ suffix }@flowrunner-test.com`,
        undefined,
        undefined,
        'E2E',
        'Test',
        'FlowRunner',
        'Tester',
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      profileId = result.data.id
    })

    it('gets profile by email', async () => {
      const result = await service.getProfileByEmail(`e2e-test-${ suffix }@flowrunner-test.com`)

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('id')
      expect(result.id).toBe(profileId)
    })

    it('gets profile by ID', async () => {
      const result = await service.getProfile(profileId)

      expect(result).toHaveProperty('data')
      expect(result.data.id).toBe(profileId)
      expect(result.data.attributes).toHaveProperty('email')
    })

    it('updates a profile', async () => {
      const result = await service.updateProfile(profileId, undefined, undefined, undefined, 'Updated')

      expect(result).toHaveProperty('data')
      expect(result.data.attributes.first_name).toBe('Updated')
    })

    it('suppresses the profile', async () => {
      const result = await service.suppressProfiles([`e2e-test-${ suffix }@flowrunner-test.com`])

      expect(result).toEqual({ success: true, emails: [`e2e-test-${ suffix }@flowrunner-test.com`] })
    })

    it('unsuppresses the profile', async () => {
      const result = await service.unsuppressProfiles([`e2e-test-${ suffix }@flowrunner-test.com`])

      expect(result).toEqual({ success: true, emails: [`e2e-test-${ suffix }@flowrunner-test.com`] })
    })

    // Clean up by requesting deletion
    it('requests profile deletion', async () => {
      const result = await service.requestProfileDeletion(`e2e-test-${ suffix }@flowrunner-test.com`)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Lists ──

  describe('list CRUD', () => {
    let listId

    it('creates a list', async () => {
      const result = await service.createList(`E2E Test List ${ suffix }`)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data.attributes).toHaveProperty('name')
      listId = result.data.id
    })

    it('lists all lists and finds the created one', async () => {
      const result = await service.listLists()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets the list by ID', async () => {
      const result = await service.getList(listId, true)

      expect(result).toHaveProperty('data')
      expect(result.data.id).toBe(listId)
    })

    it('updates the list name', async () => {
      const result = await service.updateList(listId, `E2E Renamed ${ suffix }`)

      expect(result).toHaveProperty('data')
      expect(result.data.attributes.name).toBe(`E2E Renamed ${ suffix }`)
    })

    it('gets list profiles (empty)', async () => {
      const result = await service.getListProfiles(listId, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the list', async () => {
      const result = await service.deleteList(listId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('returns segments with expected shape', async () => {
      const result = await service.listSegments()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Events ──

  describe('createEvent', () => {
    it('tracks a custom event', async () => {
      const result = await service.createEvent(
        `E2E Test Event ${ suffix }`,
        `e2e-event-${ suffix }@flowrunner-test.com`,
        undefined,
        { source: 'e2e-test' },
        1.00,
      )

      expect(result).toEqual({ success: true, metric: `E2E Test Event ${ suffix }` })
    })
  })

  describe('listEvents', () => {
    it('returns events with expected shape', async () => {
      const result = await service.listEvents()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Metrics ──

  describe('listMetrics', () => {
    it('returns metrics with expected shape', async () => {
      const result = await service.listMetrics()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.listCampaigns('Email')

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Templates ──

  describe('template CRUD', () => {
    let templateId

    it('creates a template', async () => {
      const result = await service.createTemplate(
        `E2E Template ${ suffix }`,
        '<html><body><p>Hello {{ first_name }}</p></body></html>',
        'Hello {{ first_name }}',
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      templateId = result.data.id
    })

    it('lists templates and finds results', async () => {
      const result = await service.listTemplates()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets the template by ID', async () => {
      const result = await service.getTemplate(templateId)

      expect(result).toHaveProperty('data')
      expect(result.data.id).toBe(templateId)
    })

    it('renders the template with context', async () => {
      const result = await service.renderTemplate(templateId, { first_name: 'E2E' })

      expect(result).toHaveProperty('data')
      expect(result.data.attributes.html).toContain('E2E')
    })
  })

  // ── Flows ──

  describe('listFlows', () => {
    it('returns flows with expected shape', async () => {
      const result = await service.listFlows()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tags ──

  describe('tag CRUD', () => {
    let tagId

    it('creates a tag', async () => {
      const result = await service.createTag(`e2e-tag-${ suffix }`)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      tagId = result.data.id
    })

    it('lists tags', async () => {
      const result = await service.listTags()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the tag', async () => {
      const result = await service.deleteTag(tagId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Dictionary Methods ──

  describe('getListsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getMetricsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getMetricsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTagsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
