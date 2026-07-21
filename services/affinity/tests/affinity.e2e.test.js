'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Affinity Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('affinity')
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

  // ── Account ──

  describe('getCurrentUser', () => {
    it('returns user and tenant info', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('tenant')
      expect(result).toHaveProperty('user')
      expect(result.tenant).toHaveProperty('id')
      expect(result.user).toHaveProperty('id')
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('returns an array of lists', async () => {
      const result = await service.getLists()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getList', () => {
    it('returns a single list with fields', async () => {
      const lists = await service.getLists()

      if (lists.length === 0) {
        console.log('No lists available to test getList')
        return
      }

      const result = await service.getList(String(lists[0].id))

      expect(result).toHaveProperty('id', lists[0].id)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('fields')
    })
  })

  describe('getListEntries', () => {
    it('returns list entries with pagination', async () => {
      const lists = await service.getLists()

      if (lists.length === 0) {
        console.log('No lists available to test getListEntries')
        return
      }

      const result = await service.getListEntries(String(lists[0].id), 5)

      expect(result).toHaveProperty('list_entries')
      expect(Array.isArray(result.list_entries)).toBe(true)
    })
  })

  // ── Persons ──

  describe('getPersons', () => {
    it('returns persons with expected shape', async () => {
      const result = await service.getPersons(undefined, 5)

      expect(result).toHaveProperty('persons')
      expect(Array.isArray(result.persons)).toBe(true)
    })
  })

  describe('person CRUD lifecycle', () => {
    let createdPersonId

    it('creates a person', async () => {
      const result = await service.createPerson(
        'E2ETest',
        'AffinityBot',
        ['e2e-test-affinity@example.com']
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('first_name', 'E2ETest')
      createdPersonId = result.id
    })

    it('retrieves the created person', async () => {
      const result = await service.getPerson(String(createdPersonId))

      expect(result).toHaveProperty('id', createdPersonId)
      expect(result).toHaveProperty('first_name', 'E2ETest')
    })

    it('searches for the created person', async () => {
      const result = await service.searchPersons('E2ETest', 5)

      expect(result).toHaveProperty('persons')
      expect(Array.isArray(result.persons)).toBe(true)
    })

    it('updates the created person', async () => {
      const result = await service.updatePerson(String(createdPersonId), 'E2EUpdated')

      expect(result).toHaveProperty('id', createdPersonId)
      expect(result).toHaveProperty('first_name', 'E2EUpdated')
    })

    it('deletes the created person', async () => {
      const result = await service.deletePerson(String(createdPersonId))

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Organizations ──

  describe('getOrganizations', () => {
    it('returns organizations with expected shape', async () => {
      const result = await service.getOrganizations(undefined, 5)

      expect(result).toHaveProperty('organizations')
      expect(Array.isArray(result.organizations)).toBe(true)
    })
  })

  describe('organization CRUD lifecycle', () => {
    let createdOrgId

    it('creates an organization', async () => {
      const result = await service.createOrganization(
        'E2E Test Org',
        'e2e-test-affinity.example.com'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Org')
      createdOrgId = result.id
    })

    it('retrieves the created organization', async () => {
      const result = await service.getOrganization(String(createdOrgId))

      expect(result).toHaveProperty('id', createdOrgId)
      expect(result).toHaveProperty('name', 'E2E Test Org')
    })

    it('searches for the created organization', async () => {
      const result = await service.searchOrganizations('E2E Test Org', 5)

      expect(result).toHaveProperty('organizations')
      expect(Array.isArray(result.organizations)).toBe(true)
    })

    it('updates the created organization', async () => {
      const result = await service.updateOrganization(String(createdOrgId), 'E2E Updated Org')

      expect(result).toHaveProperty('id', createdOrgId)
      expect(result).toHaveProperty('name', 'E2E Updated Org')
    })

    it('deletes the created organization', async () => {
      const result = await service.deleteOrganization(String(createdOrgId))

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Fields ──

  describe('getFields', () => {
    it('returns an array of field definitions', async () => {
      const result = await service.getFields()

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  // ── Notes ──

  describe('getNotes', () => {
    it('returns notes with expected shape', async () => {
      const result = await service.getNotes(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('notes')
      expect(Array.isArray(result.notes)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getListsDictionary', () => {
    it('returns dictionary items with label, value, and note', async () => {
      const result = await service.getListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getFieldsDictionary', () => {
    it('returns dictionary items for fields', async () => {
      const result = await service.getFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })
})
